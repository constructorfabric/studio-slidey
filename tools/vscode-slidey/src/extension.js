'use strict';

const fs = require('fs');
const path = require('path');

const EXTENSION_ROOT = path.resolve(__dirname, '..');
const CHECKOUT_ROOT = path.resolve(__dirname, '..', '..', '..');
const PACKAGED_DIST_DIR = path.join(EXTENSION_ROOT, '.slidey-dist');
const PACKAGED_RUNTIME_DIR = path.join(EXTENSION_ROOT, '.slidey-runtime', 'src');
const CHECKOUT_DIST_DIR = path.join(CHECKOUT_ROOT, 'dist');
const CHECKOUT_RUNTIME_DIR = path.join(CHECKOUT_ROOT, 'src');
const PACKAGED_RUNTIME_READY = ['schema.js', 'trace.js', 'rrweb-viewer.js', 'narration.js', 'narration-preview.js', 'feedback-config.js']
  .every((name) => fs.existsSync(path.join(PACKAGED_RUNTIME_DIR, name)));
const CHECKOUT_RUNTIME_READY = ['schema.js', 'trace.js', 'rrweb-viewer.js', 'narration.js', 'narration-preview.js', 'feedback-config.js']
  .every((name) => fs.existsSync(path.join(CHECKOUT_RUNTIME_DIR, name)));
const DIST_DIR = fs.existsSync(path.join(CHECKOUT_DIST_DIR, 'index.html'))
  ? CHECKOUT_DIST_DIR
  : PACKAGED_DIST_DIR;
const RUNTIME_SRC_DIR = CHECKOUT_RUNTIME_READY
  ? CHECKOUT_RUNTIME_DIR
  : PACKAGED_RUNTIME_READY
    ? PACKAGED_RUNTIME_DIR
    : CHECKOUT_RUNTIME_DIR;
const {
  isRrwebFile,
  isRrwebSourceFile,
  readSpecOrRrwebInfo,
  rrwebSpecForFile,
  readSpecOrRrweb,
} = require(path.join(RUNTIME_SRC_DIR, 'rrweb-viewer'));
const { handleNarrationPreviewRequest } = require(path.join(RUNTIME_SRC_DIR, 'narration-preview'));
const { runtimeFeedbackConfig, appendLocalFeedback } = require(path.join(RUNTIME_SRC_DIR, 'feedback-config'));
const SPEC_EXT = new Set(['.json', '.jsonl']);
const READONLY_SUFFIX = '.readonly.slidey.json';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-render', 'dist-web-single', '.slidey-dist', '.slidey-runtime', '.git']);

// The sidebar tree only auto-lists specs that follow the `.slidey.json`
// convention (plus generated `.jsonl` traces). Plain `.json` files still
// preview when opened explicitly, they just don't clutter the picker.
function isDiscoverableSpec(name) {
  return /\.(?:readonly\.)?slidey\.json$/i.test(name) || /\.jsonl$/i.test(name) || isRrwebFile(name);
}

function isReadOnlySlideySpec(abs) {
  return new RegExp(`${READONLY_SUFFIX.replace('.', '\\.')}$`, 'i').test(abs);
}

function isEditableSpec(abs) {
  if (!/\.json$/i.test(abs) || isReadOnlySlideySpec(abs) || isRrwebFile(abs)) return false;
  if (/\.slidey\.json$/i.test(abs)) return true;
  return !isRrwebSourceFile(abs);
}

function defaultCloneTarget(sourceRel) {
  const normalized = sourceRel.replace(/\\/g, '/');
  const dir = path.posix.dirname(normalized);
  const base = path.posix.basename(normalized);
  const editableBase = base
    .replace(/\.rrweb\.json$/i, '.slidey.json')
    .replace(/^rrweb\.json$/i, 'rrweb.slidey.json')
    .replace(/\.readonly\.slidey\.json$/i, '.slidey.json')
    .replace(/\.jsonl$/i, '.slidey.json');
  const candidate = /\.slidey\.json$/i.test(editableBase)
    ? editableBase
    : `${editableBase.replace(/\.json$/i, '')}.slidey.json`;
  return dir === '.' ? candidate : path.posix.join(dir, candidate);
}

function uniqueRel(root, baseRel) {
  if (!baseRel) return baseRel;
  const normalized = baseRel.replace(/\\/g, '/');
  const parsed = path.posix.parse(normalized);
  let i = 0;
  let current = normalized;
  let currentAbs = safeResolve(root, current);
  while (currentAbs && fs.existsSync(currentAbs)) {
    i += 1;
    const suffix = `-${i}`;
    current = path.posix.join(
      path.posix.dirname(normalized),
      `${parsed.name}${suffix}${parsed.ext}`,
    );
    currentAbs = safeResolve(root, current);
  }
  return current;
}

function safeResolve(root, rel) {
  const abs = path.resolve(root, '.' + path.sep + (rel || ''));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

function posixRel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function buildTree(absDir, root, relDir = '') {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const dirs = [];
  const files = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      const childRel = relDir ? `${relDir}/${e.name}` : e.name;
      const children = buildTree(path.join(absDir, e.name), root, childRel);
      if (children.length) dirs.push({ name: e.name, type: 'dir', path: childRel, children });
    } else if (e.isFile() && isDiscoverableSpec(e.name)) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      files.push({ name: e.name, type: 'file', path: rel, editable: isEditableSpec(e.name) });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  dirs.sort(byName);
  files.sort(byName);
  return [...dirs, ...files];
}

function readSpec(absFile) {
  if (/\.jsonl$/i.test(absFile)) {
    return require(path.join(RUNTIME_SRC_DIR, 'trace')).buildSpecFromFile(absFile);
  }
  return readSpecOrRrweb(absFile);
}

function readSpecInfo(absFile) {
  if (/\.jsonl$/i.test(absFile)) {
    return { spec: require(path.join(RUNTIME_SRC_DIR, 'trace')).buildSpecFromFile(absFile), rrweb: false };
  }
  return readSpecOrRrwebInfo(absFile);
}

function response(status, body) {
  return { status, body };
}

function assetBaseFor(webview, vscode, absFile) {
  if (!webview || !vscode) return null;
  const uri = webview.asWebviewUri(vscode.Uri.file(path.dirname(absFile))).toString();
  return uri.endsWith('/') ? uri : `${uri}/`;
}

function handleApiRequest({ root, openFile, webview, vscode }, request) {
  const url = new URL(request.url, 'https://slidey.local');
  const pathname = decodeURIComponent(url.pathname);
  const workspaceRoot = path.resolve(root);

  if (pathname === '/api/config') {
    // `embedded` tells the web app it's the single-file VS Code preview: no
    // file-tree sidebar, auto-reload on disk changes (see App.vue).
    return response(200, { root: workspaceRoot, openFile, embedded: true, feedback: runtimeFeedbackConfig(workspaceRoot) });
  }

  if (pathname === '/api/feedback/local' && request.method === 'POST') {
    try {
      const bundle = JSON.parse(request.body || '{}');
      const file = appendLocalFeedback(workspaceRoot, bundle);
      return response(201, { ref: `${file}#${bundle.idempotencyKey}` });
    } catch (err) {
      return response(400, { error: String(err.message || err) });
    }
  }

  if (pathname === '/api/tree') {
    return response(200, {
      name: path.basename(workspaceRoot) || workspaceRoot,
      type: 'dir',
      path: '',
      children: buildTree(workspaceRoot, workspaceRoot),
    });
  }

  if (pathname === '/api/schema') {
    try {
      return response(200, require(path.join(RUNTIME_SRC_DIR, 'schema')).SCHEMA);
    } catch (err) {
      return response(500, { error: String(err.message || err) });
    }
  }

  if (pathname === '/api/spec' && request.method === 'GET') {
    const rel = url.searchParams.get('path') || '';
    const abs = safeResolve(workspaceRoot, rel);
    if (!abs || !fs.existsSync(abs)) return response(404, { error: `not found: ${rel}` });
    try {
      const stat = fs.statSync(abs);
      const { spec, rrweb } = readSpecInfo(abs);
      const dir = path.dirname(rel).replace(/\\/g, '/');
      return response(200, {
        spec,
        rrweb,
        dir: dir === '.' ? '' : dir,
        assetBase: assetBaseFor(webview, vscode, abs),
        mtimeMs: stat.mtimeMs,
        editable: !rrweb && isEditableSpec(abs) && !/\.jsonl$/i.test(abs),
      });
    } catch (err) {
      return response(400, { error: String(err.message || err) });
    }
  }

  // POST /api/spec is handled out-of-band in the webview message handler
  // (handleSpecWrite) because writing through the editor model is async; this
  // synchronous path only ever sees it if that interception is bypassed.
  if (pathname === '/api/spec' && request.method === 'POST') {
    return response(405, { error: 'spec writes are handled asynchronously' });
  }

  if (pathname === '/api/narration-audio' && request.method === 'POST') {
    return handleNarrationPreviewRequest(request);
  }

  if (pathname === '/api/clone-spec' && request.method === 'POST') {
    const rel = url.searchParams.get('path') || '';
    const source = safeResolve(workspaceRoot, rel);
    if (!source || !fs.existsSync(source)) return response(404, { error: `not found: ${rel}` });
    if (!/\.json$/i.test(source) && !/\.jsonl$/i.test(source)) {
      return response(400, { error: `only JSON specs can be cloned: ${rel}` });
    }
    let payload = {};
    try {
      payload = JSON.parse(request.body || '{}');
    } catch (err) {
      return response(400, { error: `invalid JSON body: ${err.message}` });
    }
    const requestedTarget = typeof payload.target === 'string' ? payload.target.trim() : '';
    const targetRel = requestedTarget ? requestedTarget : defaultCloneTarget(rel);
    const target = safeResolve(workspaceRoot, targetRel);
    if (!target) return response(400, { error: 'invalid clone target path' });
    if (target === source) return response(400, { error: 'clone target must differ from source' });
    const finalRel = uniqueRel(workspaceRoot, path.relative(workspaceRoot, target).replace(/\\/g, '/'));
    const finalAbs = safeResolve(workspaceRoot, finalRel);
    const body = isRrwebSourceFile(source)
      ? JSON.stringify(rrwebSpecForFile(source), null, 2) + '\n'
      : fs.readFileSync(source, 'utf8');
    fs.writeFileSync(finalAbs, body, 'utf8');
    return response(200, {
      source: rel,
      path: posixRel(workspaceRoot, finalAbs),
      mtimeMs: fs.statSync(finalAbs).mtimeMs,
      editable: isEditableSpec(finalAbs),
    });
  }

  if (pathname === '/api/stat') {
    const rel = url.searchParams.get('path') || '';
    const abs = safeResolve(workspaceRoot, rel);
    if (!abs || !fs.existsSync(abs)) return response(404, { error: `not found: ${rel}` });
    try {
      return response(200, { mtimeMs: fs.statSync(abs).mtimeMs });
    } catch (err) {
      return response(400, { error: String(err.message || err) });
    }
  }

  return response(404, { error: `unknown Slidey preview route: ${pathname}` });
}

// Validate + persist an edited spec posted from the webview. Async because we
// write through the editor's document model (so the change joins VS Code's undo
// history and dirty/save lifecycle) rather than mutating the file on disk
// behind the editor's back. Mirrors the CLI viewer's POST /api/spec contract.
async function handleSpecWrite({ root, vscode }, request) {
  const workspaceRoot = path.resolve(root);
  const url = new URL(request.url, 'https://slidey.local');
  const rel = url.searchParams.get('path') || '';
  const abs = safeResolve(workspaceRoot, rel);
  if (!abs || !fs.existsSync(abs)) return response(404, { error: `not found: ${rel}` });
  if (!isEditableSpec(abs)) return response(400, { error: 'only editable .json specs can be edited in the preview; clone .readonly.slidey.json first' });

  let payload;
  try {
    payload = JSON.parse(request.body || '{}');
  } catch (err) {
    return response(400, { error: `invalid JSON body: ${err.message}` });
  }
  if (!payload || typeof payload.spec !== 'object' || Array.isArray(payload.spec)) {
    return response(400, { error: 'expected { spec } JSON body' });
  }
  if (!Array.isArray(payload.spec.scenes) || !payload.spec.scenes.length) {
    return response(400, { error: 'spec must have a non-empty "scenes" array' });
  }

  try {
    const mtimeMs = await writeSpecDocument(vscode, abs, payload.spec);
    return response(200, { ok: true, mtimeMs });
  } catch (err) {
    return response(400, { error: String(err.message || err) });
  }
}

async function handleOpenReference({ root, vscode }, request) {
  const workspaceRoot = path.resolve(root);
  let payload;
  try {
    payload = JSON.parse(request.body || '{}');
  } catch (err) {
    return response(400, { error: `invalid JSON body: ${err.message}` });
  }
  const rel = typeof payload.src === 'string' ? payload.src : '';
  const abs = safeResolve(workspaceRoot, rel);
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return response(404, { error: `not found: ${rel}` });
  }

  const uri = vscode.Uri.file(abs);
  const lineStart = Number(payload.lineStart);
  const lineEnd = Number(payload.lineEnd || payload.lineStart);
  const kind = typeof payload.kind === 'string' ? payload.kind : '';
  const preferText = ['code', 'diff', 'markdown', 'json', 'text', 'file'].includes(kind) || Number.isFinite(lineStart);

  try {
    if (preferText) {
      const doc = await vscode.workspace.openTextDocument(uri);
      const opts = { preview: false, viewColumn: vscode.ViewColumn.Active };
      if (Number.isFinite(lineStart) && lineStart > 0) {
        const startLine = Math.max(0, Math.min(doc.lineCount - 1, Math.floor(lineStart) - 1));
        const endLine = Math.max(startLine, Math.min(doc.lineCount - 1, Math.floor(Number.isFinite(lineEnd) && lineEnd > 0 ? lineEnd : lineStart) - 1));
        opts.selection = new vscode.Range(
          new vscode.Position(startLine, 0),
          doc.lineAt(endLine).range.end,
        );
      }
      await vscode.window.showTextDocument(doc, opts);
    } else {
      await vscode.commands.executeCommand('vscode.open', uri);
    }
    return response(200, { ok: true });
  } catch (err) {
    try {
      await vscode.commands.executeCommand('vscode.open', uri);
      return response(200, { ok: true });
    } catch (_) {
      return response(400, { error: String(err.message || err) });
    }
  }
}

// Replace the file's contents with the pretty-printed spec. When the real
// `vscode` API is present we route through a WorkspaceEdit + document.save() so
// the write is a normal editor edit (undoable, integrated with the dirty flag).
// In tests / non-VS Code hosts (no WorkspaceEdit) we fall back to a plain disk
// write. Either way we return the resulting mtime for the viewer's reload watch.
async function writeSpecDocument(vscode, abs, spec) {
  const text = JSON.stringify(spec, null, 2) + '\n';
  if (vscode && vscode.workspace && typeof vscode.WorkspaceEdit === 'function') {
    const uri = vscode.Uri.file(abs);
    let doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === abs);
    if (!doc) doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    const lastLine = doc.lineCount > 0 ? doc.lineCount - 1 : 0;
    const fullRange = new vscode.Range(new vscode.Position(0, 0), doc.lineAt(lastLine).range.end);
    edit.replace(uri, fullRange, text);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) throw new Error('VS Code rejected the spec edit');
    await doc.save();
  } else {
    fs.writeFileSync(abs, text, 'utf8');
  }
  return fs.statSync(abs).mtimeMs;
}

function webviewBridgeScript() {
  return `
<script>
(() => {
  const vscode = acquireVsCodeApi();
  const pending = new Map();
  let nextId = 1;
  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type !== 'slidey.response') return;
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    const body = JSON.stringify(msg.body == null ? {} : msg.body);
    slot.resolve(new Response(body, {
      status: msg.status || 200,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }));
  });
  const nativeFetch = window.fetch.bind(window);
  window.slideyOpenReference = (payload) => {
    const id = nextId++;
    const promise = new Promise((resolve, reject) => {
      pending.set(id, {
        resolve: (response) => {
          if (response.ok) resolve(response);
          else reject(new Error('Slidey reference open failed'));
        },
        reject
      });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error('Timed out waiting for Slidey reference open'));
      }, 15000);
    });
    vscode.postMessage({
      type: 'slidey.openReference',
      id,
      body: JSON.stringify(payload || {})
    });
    return promise;
  };
  window.fetch = (input, init = {}) => {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    const url = new URL(raw, window.location.href);
    if (url.pathname.startsWith('/api/')) {
      const id = nextId++;
      const method = (init.method || (input && input.method) || 'GET').toUpperCase();
      const body = init.body == null ? null : String(init.body);
      const promise = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const timeoutMs = url.pathname === '/api/narration-audio' ? 60000 : 15000;
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error('Timed out waiting for Slidey preview API response'));
        }, timeoutMs);
      });
      vscode.postMessage({ type: 'slidey.fetch', id, url: url.pathname + url.search, method, body });
      return promise;
    }
    return nativeFetch(input, init);
  };
})();
</script>`;
}

function rewriteViewerHtml(indexHtml, webview, vscode) {
  let html = indexHtml;
  html = html.replace(/(src|href)="\.\/([^"]+)"/g, (_m, attr, rel) => {
    const uri = webview.asWebviewUri(vscode.Uri.file(path.join(DIST_DIR, rel))).toString();
    return `${attr}="${uri}"`;
  });
  return html.replace('</head>', `${webviewBridgeScript()}\n</head>`);
}

function previewTitle(file) {
  return `Slidey: ${path.basename(file)}`;
}

async function openPreview(vscode, context, uri) {
  const target = uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
  if (!target || target.scheme !== 'file') {
    vscode.window.showErrorMessage('Open a Slidey .json or .jsonl file to preview it.');
    return;
  }
  const file = target.fsPath;
  if (!SPEC_EXT.has(path.extname(file).toLowerCase())) {
    vscode.window.showErrorMessage('Slidey previews require a .json, .jsonl, or .rrweb.json file.');
    return;
  }
  const folder = vscode.workspace.getWorkspaceFolder(target);
  const root = folder ? folder.uri.fsPath : path.dirname(file);
  const openFile = posixRel(root, file);
  const panel = vscode.window.createWebviewPanel(
    'slideyPreview',
    previewTitle(file),
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(DIST_DIR),
        vscode.Uri.file(root),
      ],
      retainContextWhenHidden: true,
    },
  );

  const index = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(index)) {
    panel.webview.html = '<!doctype html><body>Slidey viewer bundle is missing. Run npm run build:web.</body>';
    return;
  }

  panel.webview.html = rewriteViewerHtml(fs.readFileSync(index, 'utf8'), panel.webview, vscode);
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!msg || (msg.type !== 'slidey.fetch' && msg.type !== 'slidey.openReference')) return;
    const request = msg.type === 'slidey.openReference'
      ? { url: '/api/open-reference', method: 'POST', body: msg.body }
      : { url: msg.url, method: msg.method || 'GET', body: msg.body };
    let result;
    const route = new URL(request.url, 'https://slidey.local').pathname;
    const isSpecWrite = request.method === 'POST' && route === '/api/spec';
    const isOpenReference = request.method === 'POST' && route === '/api/open-reference';
    if (isSpecWrite) {
      result = await handleSpecWrite({ root, vscode }, request);
    } else if (isOpenReference) {
      result = await handleOpenReference({ root, vscode }, request);
    } else {
      result = handleApiRequest({ root, openFile, webview: panel.webview, vscode }, request);
    }
    panel.webview.postMessage({ type: 'slidey.response', id: msg.id, status: result.status, body: result.body });
  }, null, context.subscriptions);
}

function activate(context) {
  const vscode = require('vscode');
  context.subscriptions.push(vscode.commands.registerCommand('slidey.preview', (uri) => openPreview(vscode, context, uri)));
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  buildTree,
  handleApiRequest,
  handleOpenReference,
  handleSpecWrite,
  writeSpecDocument,
  previewTitle,
  readSpec,
  rewriteViewerHtml,
  safeResolve,
  webviewBridgeScript,
};

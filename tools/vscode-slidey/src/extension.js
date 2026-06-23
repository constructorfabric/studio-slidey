'use strict';

const fs = require('fs');
const path = require('path');

const EXTENSION_ROOT = path.resolve(__dirname, '..');
const CHECKOUT_ROOT = path.resolve(__dirname, '..', '..', '..');
const PACKAGED_DIST_DIR = path.join(EXTENSION_ROOT, '.slidey-dist');
const PACKAGED_RUNTIME_DIR = path.join(EXTENSION_ROOT, '.slidey-runtime', 'src');
const DIST_DIR = fs.existsSync(path.join(PACKAGED_DIST_DIR, 'index.html'))
  ? PACKAGED_DIST_DIR
  : path.join(CHECKOUT_ROOT, 'dist');
const RUNTIME_SRC_DIR = fs.existsSync(path.join(PACKAGED_RUNTIME_DIR, 'schema.js'))
  ? PACKAGED_RUNTIME_DIR
  : path.join(CHECKOUT_ROOT, 'src');
const SPEC_EXT = new Set(['.json', '.jsonl']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-render', 'dist-web-single', '.slidey-dist', '.slidey-runtime', '.git']);

// The sidebar tree only auto-lists specs that follow the `.slidey.json`
// convention (plus generated `.jsonl` traces). Plain `.json` files still
// preview when opened explicitly, they just don't clutter the picker.
function isDiscoverableSpec(name) {
  return /\.slidey\.json$/i.test(name) || /\.jsonl$/i.test(name);
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
      files.push({ name: e.name, type: 'file', path: rel });
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
  return JSON.parse(fs.readFileSync(absFile, 'utf8'));
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
    return response(200, { root: workspaceRoot, openFile, embedded: true });
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
      const spec = readSpec(abs);
      const dir = path.dirname(rel).replace(/\\/g, '/');
      return response(200, {
        spec,
        dir: dir === '.' ? '' : dir,
        assetBase: assetBaseFor(webview, vscode, abs),
        mtimeMs: stat.mtimeMs,
      });
    } catch (err) {
      return response(400, { error: String(err.message || err) });
    }
  }

  if (pathname === '/api/spec' && request.method === 'POST') {
    return response(405, { error: 'Slidey VS Code previews are read-only' });
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
  window.fetch = (input, init = {}) => {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    const url = new URL(raw, window.location.href);
    if (url.pathname.startsWith('/api/')) {
      const id = nextId++;
      const method = (init.method || (input && input.method) || 'GET').toUpperCase();
      const body = init.body == null ? null : String(init.body);
      const promise = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error('Timed out waiting for Slidey preview API response'));
        }, 15000);
      });
      vscode.postMessage({ type: 'slidey.fetch', id, url: url.pathname + url.search, method, body });
      return promise;
    }
    return nativeFetch(input, init);
  };
  try { localStorage.setItem('slidey.editMode', '0'); } catch (_) {}
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
    vscode.window.showErrorMessage('Slidey previews require a .json or .jsonl spec.');
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
  panel.webview.onDidReceiveMessage((msg) => {
    if (!msg || msg.type !== 'slidey.fetch') return;
    const result = handleApiRequest({
      root,
      openFile,
      webview: panel.webview,
      vscode,
    }, {
      url: msg.url,
      method: msg.method || 'GET',
      body: msg.body,
    });
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
  previewTitle,
  readSpec,
  rewriteViewerHtml,
  safeResolve,
  webviewBridgeScript,
};

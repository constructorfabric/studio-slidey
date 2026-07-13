'use strict';

/**
 * SLIDEY — local viewer server.
 *
 * Serves the prebuilt interactive Vue viewer (web target → dist/) and exposes
 * the opened folder as a browsable workspace, so `slidey <dir>` / `slidey
 * <file.json>` open a deck (with a VS-Code-style file-tree sidebar) in the
 * browser instead of rendering a video.
 *
 * Dependency-free: Node built-ins only (the viewer bundle is prebuilt by Vite).
 *
 * Routes:
 *   GET /api/config            → { root, openFile }  (App.vue → workspace mode)
 *   GET /api/tree              → nested tree of *.slidey.json / *.readonly.slidey.json / *.jsonl under root
 *   GET /api/schema            → Slidey JSON Schema for editor metadata
 *   GET /api/spec?path=<rel>   → { spec, rrweb, dir, mtimeMs, editable }  (.jsonl built via src/trace.js)
 *   POST /api/spec?path=<rel>  → save a JSON spec back to disk
 *   POST /api/clone-spec?path=<rel> → copy a read-only report deck into editable form
 *   GET /api/stat?path=<rel>   → { mtimeMs }  (poll target for live on-disk reload)
 *   GET /workspace/<rel>       → raw workspace file (spec-relative assets/references)
 *   *                          → static from dist/ with index.html SPA fallback
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const {
  isRrwebFile,
  isRrwebSourceFile,
  readSpecOrRrwebInfo,
  rrwebSpecForFile,
  readSpecOrRrweb,
} = require('./rrweb-viewer');
const { normalizeDeckDefinitions, SOURCE_DECK_ID } = require('./collections');
const { handleNarrationPreviewRequest } = require('./narration-preview');
const { versionOf } = require('./spec-version');
const { attachRuntimeThemePacks, stripRuntimeThemePacks } = require('./theme-packs');
const { applyLocale } = require('./localization');
const { runtimeFeedbackConfig, appendLocalFeedback } = require('./feedback-config');

const ROOT_DIR = path.resolve(__dirname, '..');      // repo root (has dist/, package.json)
const DIST_DIR = path.join(ROOT_DIR, 'dist');         // `npm run build:web` output

// Directories never worth walking for specs.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-render', 'dist-web-single', '.git']);

const SPEC_EXT = new Set(['.json', '.jsonl']);
const READONLY_SUFFIX = '.readonly.slidey.json';

// Specs are auto-discovered in the sidebar tree when they are normal `.slidey.json`
// specs, read-only report `.readonly.slidey.json` specs, or generated `.jsonl`
// traces. Plain `.json` files are still readable when opened explicitly, just
// not listed.
function isDiscoverableSpec(name) {
  return /\.(?:readonly\.)?slidey\.json$/i.test(name) || /\.jsonl$/i.test(name) || isRrwebFile(name);
}

function isReadOnlySlideySpec(filePath) {
  return new RegExp(`${READONLY_SUFFIX.replace('.', '\\.')}$`, 'i').test(filePath);
}

function isEditableSpec(filePath) {
  if (!/\.json$/i.test(filePath) || isReadOnlySlideySpec(filePath) || isRrwebFile(filePath)) return false;
  if (/\.slidey\.json$/i.test(filePath)) return true;
  return !isRrwebSourceFile(filePath);
}

function displayNameForSpec(name) {
  return String(name || '')
    .replace(/\.readonly\.slidey\.json$/i, '')
    .replace(/\.slidey\.json$/i, '')
    .replace(/\.jsonl$/i, '')
    .replace(/\.rrweb\.json$/i, '');
}

function deckTreeForSpec(absFile, rel) {
  if (!/\.json$/i.test(absFile) || isRrwebFile(absFile)) return [];
  let spec;
  try {
    spec = readSpecOrRrweb(absFile);
  } catch (_) {
    return [];
  }
  const decks = normalizeDeckDefinitions(spec);
  if (!decks.length) return [];

  const source = decks.find(deck => deck.source);
  const childrenByParent = new Map();
  for (const deck of decks) {
    if (deck.source) continue;
    const parent = deck.parent || SOURCE_DECK_ID;
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(deck);
  }

  const deckTreeOrder = (a, b) => {
    const aSubset = a.deckType === 'subset' ? 0 : 1;
    const bSubset = b.deckType === 'subset' ? 0 : 1;
    return aSubset - bSubset;
  };
  const makeDeckNode = (deck) => ({
    name: deck.title || deck.id,
    type: 'deck',
    path: rel,
    deckId: deck.id,
    deckType: deck.deckType || (deck.source ? 'source' : 'hierarchy'),
    description: deck.description || '',
    children: [...(childrenByParent.get(deck.id) || [])].sort(deckTreeOrder).map(makeDeckNode),
  });

  return source ? [makeDeckNode(source)] : [];
}

function withTreeSort(node, sortPath, sortIndex) {
  Object.defineProperties(node, {
    sortPath: { value: sortPath, enumerable: false },
    sortIndex: { value: sortIndex, enumerable: false },
  });
  return node;
}

function treeNodesForSpec(absFile, rel, entryName) {
  const baseName = displayNameForSpec(entryName || path.basename(rel));
  if (/\.json$/i.test(absFile) && !isRrwebFile(absFile)) {
    let spec = null;
    try {
      spec = readSpecOrRrweb(absFile);
    } catch (_) {
      return [{
        name: baseName,
        type: 'file',
        path: rel,
        editable: isEditableSpec(entryName || absFile),
        children: [],
      }];
    }

    const collectionNodes = deckTreeForSpec(absFile, rel);
    if (collectionNodes.length) {
      return collectionNodes.map((node, index) => withTreeSort(node, rel, index));
    }

    return [withTreeSort({
      name: (spec.meta && spec.meta.title) || baseName,
      type: 'deck',
      path: rel,
      deckId: SOURCE_DECK_ID,
      deckType: 'deck',
      description: (spec.meta && spec.meta.description) || '',
      editable: isEditableSpec(entryName || absFile),
      children: [],
    }, rel, 0)];
  }

  return [{
    name: baseName,
    type: 'file',
    path: rel,
    editable: isEditableSpec(entryName || absFile),
    children: [],
  }];
}

function defaultCloneTarget(sourceRel) {
  const normalized = sourceRel.replace(/\\/g, '/');
  const dir = path.posix.dirname(normalized);
  const base = path.posix.basename(normalized);
  const editableBase = base
    .replace(/\.rrweb\.json$/i, '.slidey.json')
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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl':'application/jsonl; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.mmd':  'text/plain; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.log':  'text/plain; charset=utf-8',
  '.diff': 'text/x-diff; charset=utf-8',
  '.patch':'text/x-diff; charset=utf-8',
  '.py':   'text/x-python; charset=utf-8',
  '.go':   'text/x-go; charset=utf-8',
  '.ts':   'text/typescript; charset=utf-8',
  '.tsx':  'text/tsx; charset=utf-8',
  '.jsx':  'text/jsx; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.mp4':  'video/mp4',
  '.m4v':  'video/mp4',
  '.mov':  'video/quicktime',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.ico':  'image/x-icon',
  '.map':  'application/json; charset=utf-8',
};

// ── dist/ (prebuilt viewer) ─────────────────────────────────────────────────

/** Ensure dist/ exists; build it once if missing and Vite is available. */
function ensureDist() {
  if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) return true;
  // Try an on-demand build (vite is a devDependency present in a dev checkout).
  try {
    console.log('[slidey] viewer bundle not found — building it once (npm run build:web)…');
    execFileSync('npm', ['run', 'build:web'], { cwd: ROOT_DIR, stdio: 'inherit' });
  } catch (_) {
    // fall through to the existence re-check / error below
  }
  if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) return true;
  console.error(
    '[slidey] ERROR: the viewer bundle (dist/) is missing and could not be built.\n' +
    '         Run `npm run build:web` in the slidey checkout, then try again.',
  );
  return false;
}

// ── workspace file tree ─────────────────────────────────────────────────────

/**
 * Build a nested tree of spec files under `dir`. Returns a node:
 *   { name, type: 'dir', path, children: [...] }  |  { name, type: 'file', path }
 * `path` is POSIX-relative to the workspace root. Directories with no specs
 * (transitively) are pruned so the sidebar shows only useful folders.
 */
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
      const abs = path.join(absDir, e.name);
      files.push(...treeNodesForSpec(abs, rel, e.name));
    }
  }
  const byName = (a, b) => (
    (a.sortPath || a.path || a.name).localeCompare(b.sortPath || b.path || b.name)
    || (a.sortIndex || 0) - (b.sortIndex || 0)
    || a.name.localeCompare(b.name)
  );
  dirs.sort(byName);
  files.sort(byName);
  return [...dirs, ...files]; // folders first, then files (VS Code ordering)
}

// ── safe path resolution within root ────────────────────────────────────────

/** Resolve a workspace-relative path, or null if it escapes `root`. */
function safeResolve(root, rel) {
  const abs = path.resolve(root, '.' + path.sep + (rel || ''));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

/**
 * Resolve a workspace ASSET reference for `GET /workspace/<rel>` (scene
 * `rrweb`/image/etc. paths, resolved relative to the spec's folder — see
 * `--root` in index.js for widening that folder). Security posture:
 *
 *   1. Lexical containment (safeResolve above): the literal, un-dereferenced
 *      path must resolve inside `root` as a STRING. A reference whose own
 *      `../` segments walk past `root` (and past any wider `--root`) 404s
 *      here, before we ever touch the filesystem — e.g. a deck sitting in
 *      `.context/` referencing `../../etc/passwd` with no `--root` given.
 *   2. Realpath containment: once step 1 passes, the file may be reached
 *      through a symlink. Its REAL path (fs.realpathSync, every symlink
 *      dereferenced) is allowed to land outside `root` only because that
 *      symlink itself lives inside `root` — which is guaranteed by step 1
 *      already succeeding (every path component up to and including the
 *      symlink had to be lexically inside `root`). This is the deliberate
 *      "symlink convention" this repo uses today (e.g. a
 *      `.context/<name>-demo-clips -> ../.artifacts/<name>-demo` symlink):
 *      the spec author opted in by placing that symlink inside the served
 *      tree, so we follow it rather than 404ing on the realpath escape.
 *      A request that escapes `root` with NO symlink involved already 404s
 *      at step 1, so step 2 never further RESTRICTS anything step 1 let
 *      through — it exists to make the intended behavior explicit, tested,
 *      and resilient to a future safeResolve() change, rather than an
 *      accidental byproduct of Node's fs transparently following symlinks.
 *
 * Returns the absolute path to serve, or null if the request should 404.
 */
function safeResolveAsset(root, rel) {
  const abs = safeResolve(root, rel);
  if (!abs) return null;
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (_) {
    return null;
  }
  if (!stat.isFile()) return null;
  try {
    const realAbs = fs.realpathSync(abs);
    const realRoot = fs.realpathSync(root);
    const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
    // See the doc comment: a realpath escape here is, by construction, only
    // reachable via a symlink that itself lives inside `root` — allow it.
    if (realAbs !== realRoot && !realAbs.startsWith(realRootWithSep)) return abs;
    return abs;
  } catch (_) {
    return null;
  }
}

// ── request helpers ─────────────────────────────────────────────────────────

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendFile(res, absFile) {
  let data;
  try {
    data = fs.readFileSync(absFile);
  } catch (_) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(absFile).toLowerCase()] || 'application/octet-stream' });
  res.end(data);
}

function readBody(req, limit = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ── browser open (best-effort) ──────────────────────────────────────────────

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32'  ? 'cmd'
            : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch (_) { /* non-fatal: user can open the printed URL */ }
}

function openSystemPath(absFile) {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32'  ? 'cmd'
            : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', absFile] : [absFile];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

// ── server ──────────────────────────────────────────────────────────────────

/**
 * Start the viewer server.
 * @param {object} opts
 * @param {string} opts.root      absolute path of the workspace folder to serve
 * @param {string|null} opts.openFile  workspace-relative spec to auto-open (or null)
 * @param {string|null} opts.deckId    library deck id to open initially (or null)
 * @param {number} opts.port      preferred port (auto-increments if taken)
 * @param {boolean} opts.open     launch the browser when true
 */
function startViewer({ root, openFile = null, deckId = null, port = 4321, open = true, _tries = 0 }) {
  if (!ensureDist()) process.exit(1);
  const workspaceRoot = path.resolve(root);

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch (_) {
      res.writeHead(400).end('Bad request');
      return;
    }
    const pathname = decodeURIComponent(url.pathname);

    // ── API ──
    if (pathname === '/api/config') {
      return sendJSON(res, 200, { root: workspaceRoot, openFile, deckId, feedback: runtimeFeedbackConfig(workspaceRoot) });
    }

    if (pathname === '/api/feedback/local' && req.method === 'POST') {
      try {
        const bundle = JSON.parse(await readBody(req, 256 * 1024) || '{}');
        const file = appendLocalFeedback(workspaceRoot, bundle);
        return sendJSON(res, 201, { ref: `${file}#${bundle.idempotencyKey}` });
      } catch (err) {
        return sendJSON(res, 400, { error: String(err.message || err) });
      }
    }

    if (pathname === '/api/tree') {
      return sendJSON(res, 200, {
        name: path.basename(workspaceRoot) || workspaceRoot,
        type: 'dir',
        path: '',
        children: buildTree(workspaceRoot, workspaceRoot),
      });
    }

    if (pathname === '/api/schema') {
      try {
        return sendJSON(res, 200, require('./schema').SCHEMA);
      } catch (err) {
        return sendJSON(res, 500, { error: String(err.message || err) });
      }
    }

    if (pathname === '/api/spec' && req.method === 'GET') {
      const rel = url.searchParams.get('path') || '';
      const locale = url.searchParams.get('locale') || '';
      const abs = safeResolve(workspaceRoot, rel);
      if (!abs || !fs.existsSync(abs)) return sendJSON(res, 404, { error: `not found: ${rel}` });
      try {
        const bytes = fs.readFileSync(abs);
        const mtimeMs = fs.statSync(abs).mtimeMs;
        let { spec, rrweb, libraryFileErrors } = /\.jsonl$/i.test(abs)
          ? { spec: require('./trace').buildSpecFromFile(abs), rrweb: false }
          : readSpecOrRrwebInfo(abs);
        if (locale) spec = applyLocale(spec, locale, { specPath: abs });
        spec = attachRuntimeThemePacks(spec, abs, { workspaceRoot });
        const dir = path.dirname(rel).replace(/\\/g, '/');
        const editable = !rrweb && isEditableSpec(abs);
        return sendJSON(res, 200, {
          spec,
          rrweb,
          dir: dir === '.' ? '' : dir,
          mtimeMs,
          // Content version the editor hands back on save so a concurrent write
          // (e.g. the AI editing the same file) can't be silently clobbered.
          version: versionOf(bytes),
          editable,
          // Surface a broken/missing `library.decks[].src` child-deck file
          // reference instead of silently resolving that deck to zero scenes
          // (see inlineChildDeckFiles in src/collections.js).
          ...(libraryFileErrors && libraryFileErrors.length ? { libraryFileErrors } : {}),
        });
      } catch (err) {
        return sendJSON(res, 400, { error: String(err.message || err) });
      }
    }

    if (pathname === '/api/spec' && req.method === 'POST') {
      const rel = url.searchParams.get('path') || '';
      const abs = safeResolve(workspaceRoot, rel);
      if (!abs || !fs.existsSync(abs)) return sendJSON(res, 404, { error: `not found: ${rel}` });
      if (!isEditableSpec(abs)) {
        return sendJSON(res, 400, {
          error: 'only editable .json specs can be saved; .readonly.slidey.json is read-only',
        });
      }
      try {
        const raw = await readBody(req);
        const payload = JSON.parse(raw || '{}');
        if (!payload || typeof payload.spec !== 'object' || Array.isArray(payload.spec)) {
          return sendJSON(res, 400, { error: 'expected { spec } JSON body' });
        }
        if (!Array.isArray(payload.spec.scenes) || !payload.spec.scenes.length) {
          return sendJSON(res, 400, { error: 'spec must have a non-empty "scenes" array' });
        }
        const body = JSON.stringify(stripRuntimeThemePacks(payload.spec), null, 2) + '\n';
        const nextBytes = Buffer.from(body, 'utf8');
        // Optimistic concurrency: if the caller loaded version X but the file is
        // now version Y, someone else wrote in between. Refuse the blind
        // overwrite and return the on-disk version so the client can resolve it
        // as OURS (resend with force) or THEIRS (adopt `current.spec`). An
        // identical-content save is never a conflict; a save with no baseVersion
        // (older client) keeps the previous blind-write behaviour.
        const currentBytes = fs.readFileSync(abs);
        const currentVersion = versionOf(currentBytes);
        const baseVersion = typeof payload.baseVersion === 'string' ? payload.baseVersion : null;
        if (
          baseVersion &&
          baseVersion !== currentVersion &&
          payload.force !== true &&
          !currentBytes.equals(nextBytes)
        ) {
          let currentSpec = null;
          try { currentSpec = JSON.parse(currentBytes.toString('utf8')); } catch (_) { /* leave null */ }
          return sendJSON(res, 409, {
            error: 'conflict: this deck changed on disk since you loaded it',
            conflict: true,
            current: { spec: currentSpec, version: currentVersion, mtimeMs: fs.statSync(abs).mtimeMs },
          });
        }
        fs.writeFileSync(abs, nextBytes);
        return sendJSON(res, 200, { ok: true, mtimeMs: fs.statSync(abs).mtimeMs, version: versionOf(nextBytes) });
      } catch (err) {
        return sendJSON(res, 400, { error: String(err.message || err) });
      }
    }

    if (pathname === '/api/narration-audio' && req.method === 'POST') {
      try {
        const raw = await readBody(req, 512 * 1024);
        const result = handleNarrationPreviewRequest({ body: raw });
        return sendJSON(res, result.status, result.body);
      } catch (err) {
        return sendJSON(res, 400, { error: String(err.message || err) });
      }
    }

    if (pathname === '/api/clone-spec' && req.method === 'POST') {
      const rel = url.searchParams.get('path') || '';
      const source = safeResolve(workspaceRoot, rel);
      if (!source || !fs.existsSync(source)) return sendJSON(res, 404, { error: `not found: ${rel}` });
      if (!/\.json$/i.test(source) && !/\.jsonl$/i.test(source)) {
        return sendJSON(res, 400, { error: `only JSON specs can be cloned: ${rel}` });
      }
      let payload = {};
      try {
        payload = JSON.parse(await readBody(req) || '{}');
      } catch (err) {
        return sendJSON(res, 400, { error: `invalid JSON body: ${err.message}` });
      }
      const requestedTarget = typeof payload.target === 'string' ? payload.target.trim() : '';
      const targetRel = requestedTarget
        ? requestedTarget
        : defaultCloneTarget(rel);
      const target = safeResolve(workspaceRoot, targetRel);
      if (!target) return sendJSON(res, 400, { error: 'invalid clone target path' });
      if (target === source) return sendJSON(res, 400, { error: 'clone target must differ from source' });
      const finalRel = uniqueRel(workspaceRoot, path.relative(workspaceRoot, target).replace(/\\/g, '/'));
      const finalAbs = safeResolve(workspaceRoot, finalRel);
      const body = isRrwebSourceFile(source)
        ? JSON.stringify(rrwebSpecForFile(source), null, 2) + '\n'
        : fs.readFileSync(source, 'utf8');
      fs.writeFileSync(finalAbs, body, 'utf8');
      return sendJSON(res, 200, { source: rel, path: finalRel, mtimeMs: fs.statSync(finalAbs).mtimeMs, editable: isEditableSpec(finalAbs) });
    }

    if (pathname === '/api/open-reference' && req.method === 'POST') {
      try {
        const payload = JSON.parse(await readBody(req, 128 * 1024) || '{}');
        const rel = typeof payload.src === 'string' ? payload.src : '';
        const abs = safeResolve(workspaceRoot, rel);
        if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          return sendJSON(res, 404, { error: `not found: ${rel}` });
        }
        openSystemPath(abs);
        return sendJSON(res, 200, { ok: true });
      } catch (err) {
        return sendJSON(res, 400, { error: String(err.message || err) });
      }
    }

    // Lightweight mtime probe so the viewer can detect on-disk edits without
    // reparsing the spec every poll. Returns mtimeMs (or 404 if gone).
    if (pathname === '/api/stat') {
      const rel = url.searchParams.get('path') || '';
      const abs = safeResolve(workspaceRoot, rel);
      if (!abs || !fs.existsSync(abs)) return sendJSON(res, 404, { error: `not found: ${rel}` });
      try {
        const st = fs.statSync(abs);
        // Cheap mtime probe still gates the work, but we also return the content
        // version so the viewer only flags a real change (and not an identical
        // rewrite that merely bumped mtime).
        return sendJSON(res, 200, { mtimeMs: st.mtimeMs, version: versionOf(fs.readFileSync(abs)) });
      } catch (err) {
        return sendJSON(res, 400, { error: String(err.message || err) });
      }
    }

    // ── workspace assets (spec-relative gif/img/rrweb/etc.) ──
    // See safeResolveAsset()'s doc comment for the lexical + realpath posture.
    if (pathname.startsWith('/workspace/')) {
      const rel = pathname.slice('/workspace/'.length);
      const abs = safeResolveAsset(workspaceRoot, rel);
      if (!abs) {
        res.writeHead(404).end('Not found');
        return;
      }
      return sendFile(res, abs);
    }

    // ── static viewer bundle (dist/) with SPA fallback ──
    const distRel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const distAbs = safeResolve(DIST_DIR, distRel);
    if (distAbs && fs.existsSync(distAbs) && fs.statSync(distAbs).isFile()) {
      return sendFile(res, distAbs);
    }
    // Unknown non-asset route → serve the SPA shell.
    if (!path.extname(distRel)) {
      return sendFile(res, path.join(DIST_DIR, 'index.html'));
    }
    res.writeHead(404).end('Not found');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && _tries < 50) {
      startViewer({ root, openFile, deckId, port: port + 1, open, _tries: _tries + 1 });
    } else {
      console.error(`[slidey] ERROR: could not start viewer server: ${err.message}`);
      process.exit(1);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const suffix = deckId ? `?deck=${encodeURIComponent(deckId)}` : '';
    const url = `http://localhost:${port}/${suffix}`;
    console.log(`\n[slidey] Viewer  : ${url}`);
    console.log(`[slidey] Workspace: ${workspaceRoot}`);
    if (openFile) console.log(`[slidey] Opening : ${openFile}`);
    if (deckId) console.log(`[slidey] Deck    : ${deckId}`);
    console.log('[slidey] Press Ctrl-C to stop.\n');
    if (open) openBrowser(url);
  });

  return server;
}

module.exports = { startViewer };

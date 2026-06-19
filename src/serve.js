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
 *   GET /api/tree              → nested tree of *.json / *.jsonl under root
 *   GET /api/spec?path=<rel>   → { spec, dir, mtimeMs }  (.jsonl built via src/trace.js)
 *   GET /api/stat?path=<rel>   → { mtimeMs }  (poll target for live on-disk reload)
 *   GET /workspace/<rel>       → raw workspace file (spec-relative gif/img assets)
 *   *                          → static from dist/ with index.html SPA fallback
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');      // repo root (has dist/, package.json)
const DIST_DIR = path.join(ROOT_DIR, 'dist');         // `npm run build:web` output

// Directories never worth walking for specs.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-render', 'dist-web-single', '.git']);

const SPEC_EXT = new Set(['.json', '.jsonl']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
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
    } else if (e.isFile() && SPEC_EXT.has(path.extname(e.name).toLowerCase())) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      files.push({ name: e.name, type: 'file', path: rel });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
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

// ── server ──────────────────────────────────────────────────────────────────

/**
 * Start the viewer server.
 * @param {object} opts
 * @param {string} opts.root      absolute path of the workspace folder to serve
 * @param {string|null} opts.openFile  workspace-relative spec to auto-open (or null)
 * @param {number} opts.port      preferred port (auto-increments if taken)
 * @param {boolean} opts.open     launch the browser when true
 */
function startViewer({ root, openFile = null, port = 4321, open = true, _tries = 0 }) {
  if (!ensureDist()) process.exit(1);
  const workspaceRoot = path.resolve(root);

  const server = http.createServer((req, res) => {
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
      return sendJSON(res, 200, { root: workspaceRoot, openFile });
    }

    if (pathname === '/api/tree') {
      return sendJSON(res, 200, {
        name: path.basename(workspaceRoot) || workspaceRoot,
        type: 'dir',
        path: '',
        children: buildTree(workspaceRoot, workspaceRoot),
      });
    }

    if (pathname === '/api/spec') {
      const rel = url.searchParams.get('path') || '';
      const abs = safeResolve(workspaceRoot, rel);
      if (!abs || !fs.existsSync(abs)) return sendJSON(res, 404, { error: `not found: ${rel}` });
      try {
        const mtimeMs = fs.statSync(abs).mtimeMs;
        const spec = /\.jsonl$/i.test(abs)
          ? require('./trace').buildSpecFromFile(abs)
          : JSON.parse(fs.readFileSync(abs, 'utf8'));
        const dir = path.dirname(rel).replace(/\\/g, '/');
        return sendJSON(res, 200, { spec, dir: dir === '.' ? '' : dir, mtimeMs });
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
        return sendJSON(res, 200, { mtimeMs: fs.statSync(abs).mtimeMs });
      } catch (err) {
        return sendJSON(res, 400, { error: String(err.message || err) });
      }
    }

    // ── workspace assets (spec-relative gif/img) ──
    if (pathname.startsWith('/workspace/')) {
      const rel = pathname.slice('/workspace/'.length);
      const abs = safeResolve(workspaceRoot, rel);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
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
      startViewer({ root, openFile, port: port + 1, open, _tries: _tries + 1 });
    } else {
      console.error(`[slidey] ERROR: could not start viewer server: ${err.message}`);
      process.exit(1);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`\n[slidey] Viewer  : ${url}`);
    console.log(`[slidey] Workspace: ${workspaceRoot}`);
    if (openFile) console.log(`[slidey] Opening : ${openFile}`);
    console.log('[slidey] Press Ctrl-C to stop.\n');
    if (open) openBrowser(url);
  });

  return server;
}

module.exports = { startViewer };

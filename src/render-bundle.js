// SLIDEY — headless render-bundle guard
//
// There is ONE diagram/scene renderer: the Vue app in web/ (web/svg.js +
// components), driven from the store. The live viewer serves it from dist/; the
// headless paths (pdf.js, png.js, renderer.js, audit.js) drive the SAME app
// inlined into dist-render/render.html. They cannot diverge in logic — but the
// inlined bundle can go STALE relative to web/ sources, which makes a PDF/PNG/MP4
// silently render an older version than the viewer (e.g. arrows that work live
// but are missing in the export).
//
// ensureRenderBundle() closes that gap: it rebuilds dist-render whenever any
// renderer source is newer than the bundle, so every headless export always
// matches the current web/ renderer. One renderer, one source of truth, always
// fresh.
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT          = path.resolve(__dirname, '..');
const RENDER_BUNDLE = path.join(ROOT, 'dist-render', 'render.html');

// Anything whose change must invalidate the inlined bundle.
const SOURCE_DIRS  = ['web'];
const SOURCE_FILES = ['render.html', 'vite.config.js'];

function newestMtime(p) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = st.mtimeMs;
  for (const entry of fs.readdirSync(p)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    newest = Math.max(newest, newestMtime(path.join(p, entry)));
  }
  return newest;
}

function sourceMtime() {
  let newest = 0;
  for (const d of SOURCE_DIRS)  { const a = path.join(ROOT, d); if (fs.existsSync(a)) newest = Math.max(newest, newestMtime(a)); }
  for (const f of SOURCE_FILES) { const a = path.join(ROOT, f); if (fs.existsSync(a)) newest = Math.max(newest, fs.statSync(a).mtimeMs); }
  return newest;
}

// Return the bundle path, (re)building it first if missing or stale so the
// headless render always matches the current web/ renderer.
function ensureRenderBundle() {
  const exists = fs.existsSync(RENDER_BUNDLE);
  const stale  = exists && sourceMtime() > fs.statSync(RENDER_BUNDLE).mtimeMs;
  if (!exists || stale) {
    console.log(`[slidey] render bundle ${exists ? 'stale (web/ changed since last build)' : 'missing'} — rebuilding: npm run build:render`);
    execSync('npm run build:render', { cwd: ROOT, stdio: 'inherit' });
  }
  return RENDER_BUNDLE;
}

module.exports = { RENDER_BUNDLE, ensureRenderBundle };

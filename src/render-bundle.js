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
//
// The rebuild child must NEVER write to OUR stdout: when this fires inside the
// MCP server (any browser tool — render_png, render_html, contact_sheet,
// audit, review_deck, prepare_review_artifact — can trigger it mid-serve via
// loadRenderPage/auditSpec), stdout is the JSON-RPC stream, and raw npm/vite
// chatter corrupts it for line-oriented clients. So the child's stdout is
// captured and forwarded to OUR stderr (its own stderr streams through live),
// and a failed build surfaces the captured output in the thrown error instead
// of half-printing it.
function ensureRenderBundle() {
  const exists = fs.existsSync(RENDER_BUNDLE);
  const stale  = exists && sourceMtime() > fs.statSync(RENDER_BUNDLE).mtimeMs;
  if (!exists || stale) {
    console.error(`[slidey] render bundle ${exists ? 'stale (web/ changed since last build)' : 'missing'} — rebuilding: npm run build:render`);
    let out;
    try {
      out = execSync('npm run build:render', {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'inherit'],
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (err) {
      const detail = [err && err.stdout, err && err.stderr].filter(Boolean).map(String).join('\n').trim();
      const wrapped = new Error(`render bundle rebuild failed (npm run build:render)${detail ? `:\n${detail}` : `: ${err.message}`}`);
      wrapped.cause = err;
      throw wrapped;
    }
    if (out && out.trim()) process.stderr.write(out.endsWith('\n') ? out : out + '\n');
  }
  return RENDER_BUNDLE;
}

module.exports = { RENDER_BUNDLE, ensureRenderBundle };

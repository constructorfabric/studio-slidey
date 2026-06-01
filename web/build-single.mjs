// Single-file static build of the interactive web viewer.
//
// Produces ONE self-contained .html that opens straight off disk (file://) with
// no server and no external fetches: the Vue app's JS + CSS are folded inline
// (same trick as web/inline-render.mjs), and a spec is embedded as
// window.__SLIDEY_SPEC__ so App.vue loads it without a fetch. Any gif assets the
// spec references are read from disk and embedded as data URIs too, so even
// terminal-gif scenes survive the offline cut.
//
// Usage:
//   node web/build-single.mjs <spec.json> [out.html]
//   npm run build:single -- examples/kitsoki-pitch.json kitsoki.html
//
// Defaults the output to dist-web-single/<spec-basename>.html.
import { execFileSync } from 'node:child_process';
import {
  readFileSync, writeFileSync, readdirSync, existsSync, statSync,
} from 'node:fs';
import { join, dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const buildDir = join(root, 'dist-web-single');

const [, , specArg, outArg] = process.argv;
if (!specArg) {
  console.error('Usage: node web/build-single.mjs <spec.json> [out.html]');
  process.exit(1);
}

const specPath = resolve(specArg);
if (!existsSync(specPath)) {
  console.error(`[build-single] ERROR: spec not found: ${specPath}`);
  process.exit(1);
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
if (!spec || !Array.isArray(spec.scenes) || !spec.scenes.length) {
  console.error('[build-single] ERROR: spec must have a non-empty "scenes" array');
  process.exit(1);
}

// Embed gif assets the spec references (resolved relative to the spec file) as
// data URIs, so terminal-gif scenes render with no external file. Missing gifs
// are left as-is — the viewer skips an unresolvable gif gracefully.
const specDir = dirname(specPath);
const gifMime = { '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
let embeddedGifs = 0;
for (const sc of spec.scenes) {
  if (!sc.gif || /^data:/.test(sc.gif)) continue;
  const gifPath = resolve(specDir, sc.gif);
  if (!existsSync(gifPath)) {
    console.warn(`[build-single] WARNING: gif not found, leaving reference as-is: ${sc.gif}`);
    continue;
  }
  const mime = gifMime[extname(gifPath).toLowerCase()] || 'application/octet-stream';
  sc.gif = `data:${mime};base64,${readFileSync(gifPath).toString('base64')}`;
  embeddedGifs++;
}

// 1. Build the single-chunk web bundle (inlineDynamicImports → one JS + one CSS).
console.log('[build-single] building web bundle (SLIDEY_TARGET=webfile)…');
execFileSync('npx', ['vite', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SLIDEY_TARGET: 'webfile' },
});

// 2. Inline the emitted JS + CSS into the HTML.
let html = readFileSync(join(buildDir, 'index.html'), 'utf8');

html = html.replace(
  /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g,
  (m, src) => {
    const file = src.replace(/^\.?\//, '');
    const js = readFileSync(join(buildDir, file), 'utf8');
    return `<script type="module">\n${js}\n</script>`;
  },
);

html = html.replace(
  /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g,
  (m, href) => {
    const file = href.replace(/^\.?\//, '');
    const css = readFileSync(join(buildDir, file), 'utf8');
    return `<style>\n${css}\n</style>`;
  },
);

if (/\bsrc="|rel="stylesheet"/.test(html)) {
  console.warn('[build-single] WARNING: external refs may remain. dist-web-single contents:', readdirSync(buildDir));
}

// 3. Embed the spec ahead of the app script so App.vue loads it without a fetch.
//    JSON.stringify is HTML-safe except for a literal </script>; split the tag
//    so the embedded JSON can never close the surrounding <script> early.
const specJson = JSON.stringify(spec).replace(/<\/script>/gi, '<\\/script>');
const inject = `<script>window.__SLIDEY_SPEC__ = ${specJson};</script>\n`;
html = html.replace(/(<script type="module">)/, `${inject}$1`);

// 4. Write the self-contained file.
const outPath = outArg
  ? resolve(outArg)
  : join(buildDir, `${basename(specPath, extname(specPath))}.html`);
writeFileSync(outPath, html);

const sizeMB = (statSync(outPath).size / 1e6).toFixed(2);
console.log(
  `[build-single] wrote ${outPath} (${sizeMB} MB, self-contained — ` +
  `${spec.scenes.length} scenes, ${embeddedGifs} gif(s) embedded)`,
);
console.log('[build-single] open it directly in a browser; no server needed.');

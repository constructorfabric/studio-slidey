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
//   npm run build:single -- examples/kitsoki-pitch.slidey.json kitsoki.html
//
// Defaults the output to dist-web-single/<spec-basename>.html.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  readFileSync, writeFileSync, readdirSync, existsSync, statSync,
} from 'node:fs';
import { join, dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const buildDir = join(root, 'dist-web-single');
const require = createRequire(import.meta.url);
const { readSpecOrRrweb } = require('../src/rrweb-viewer.js');
const { resolveDeckSpec } = require('../src/collections.js');
const { buildNarrationAudioTable } = await import('./build-narration-audio.mjs');

const rawArgs = process.argv.slice(2);
const positionals = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--deck' || rawArgs[i] === '--asset-base') {
    i++;
    continue;
  }
  if (rawArgs[i].startsWith('-')) continue;
  positionals.push(rawArgs[i]);
}
const [specArg, outArg] = positionals;
const assetBaseIdx = rawArgs.indexOf('--asset-base');
const assetBaseArg = assetBaseIdx !== -1 ? rawArgs[assetBaseIdx + 1] : null;
if (!specArg) {
  console.error('Usage: node web/build-single.mjs <spec.json> [out.html] [--deck <id>]');
  process.exit(1);
}
const deckIdx = rawArgs.indexOf('--deck');
const deckOpt = deckIdx !== -1 ? rawArgs[deckIdx + 1] : null;

const specPath = resolve(specArg);
if (!existsSync(specPath)) {
  console.error(`[build-single] ERROR: spec not found: ${specPath}`);
  process.exit(1);
}

let spec = readSpecOrRrweb(specPath);
const resolvedDeck = resolveDeckSpec(spec, { deckId: deckOpt });
if (resolvedDeck.errors && resolvedDeck.errors.length) {
  console.error('[build-single] ERROR: collection deck could not be resolved:');
  for (const line of resolvedDeck.errors) console.error(`  ${line}`);
  process.exit(1);
}
if (resolvedDeck.isCollection && !resolvedDeck.isSource) {
  console.log(`[build-single] deck ${resolvedDeck.deckId}: ${resolvedDeck.spec.scenes.length}/${(spec.scenes || []).length} source scenes`);
}
if (!spec || !Array.isArray(spec.scenes) || !spec.scenes.length) {
  console.error('[build-single] ERROR: spec must have a non-empty "scenes" array');
  process.exit(1);
}
const themePacks = await import('../src/theme-packs.js');
const attachRuntimeThemePacks = themePacks.attachRuntimeThemePacks || themePacks.default.attachRuntimeThemePacks;
const bundledSpec = attachRuntimeThemePacks(spec, specPath);

// Embed local image/gif assets the spec references (resolved relative to the
// spec file) as data URIs, so portable single-file decks render with no
// external files. Missing assets are left as-is — the viewer degrades visibly.
const specDir = assetBaseArg ? resolve(assetBaseArg) : dirname(specPath);
const assetMime = {
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};
let embeddedAssets = 0;
function embedAsset(ref, label) {
  if (!ref || /^data:/.test(ref) || /^https?:\/\//i.test(ref)) return ref;
  const assetPath = resolve(specDir, ref);
  if (!existsSync(assetPath)) {
    console.warn(`[build-single] WARNING: asset not found, leaving reference as-is: ${label || ref}`);
    return ref;
  }
  const mime = assetMime[extname(assetPath).toLowerCase()] || 'application/octet-stream';
  embeddedAssets++;
  return `data:${mime};base64,${readFileSync(assetPath).toString('base64')}`;
}

for (const sc of bundledSpec.scenes) {
  for (const field of ['gif', 'src']) {
    if (!sc[field] || /^data:/.test(sc[field]) || /^https?:\/\//i.test(sc[field])) continue;
    if (field === 'src' && sc.type !== 'image') continue;
    sc[field] = embedAsset(sc[field]);
  }
  // Embed the rrweb DOM-session log of a live `video` scene as a data URI so the
  // single-file deck plays the tour natively offline (no fetch of a sibling
  // *.rrweb.json). The viewer's loader (useDeck ensureRrweb) fetches sc.rrweb as
  // a URL; a data: URL is absolute and fetch().json() parses it unchanged.
  if (sc.type === 'video' && sc.rrweb && !/^data:/.test(sc.rrweb) && !/^https?:\/\//i.test(sc.rrweb)) {
    const rrwebPath = resolve(specDir, sc.rrweb);
    if (existsSync(rrwebPath)) {
      sc.rrweb = `data:application/json;base64,${readFileSync(rrwebPath).toString('base64')}`;
      embeddedAssets++;
    } else {
      console.warn(`[build-single] WARNING: rrweb log not found, leaving reference as-is: ${sc.rrweb}`);
    }
  }
  if (sc.type === 'video' && sc.audio) {
    sc.audio = embedAsset(sc.audio, sc.audio);
  }
  if (sc.type === 'image-compare') {
    if (sc.left && sc.left.src) sc.left.src = embedAsset(sc.left.src, sc.left.src);
    if (sc.right && sc.right.src) sc.right.src = embedAsset(sc.right.src, sc.right.src);
  }
  if (sc.type === 'book' && Array.isArray(sc.books)) {
    for (const book of sc.books) {
      if (book && book.cover) book.cover = embedAsset(book.cover, book.cover);
    }
  }
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

if (/<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"/.test(html)) {
  throw new Error(
    '[build-single] unresolved external refs remain after inlining — the '
    + 'self-contained offline artifact would break. dist-web-single contents: '
    + readdirSync(buildDir).join(', '),
  );
}

// 2b. Pre-render narration audio for every deck/scene so the published build
//     has working narration + reveal timing offline (no edge-tts endpoint to
//     call at view time — see build-narration-audio.mjs and, if this ever
//     regresses again, docs/decks/README.md's "Publishing" section).
const narrationAudioTable = await buildNarrationAudioTable(bundledSpec, { log: console.log });

// 3. Embed the spec ahead of the app script so App.vue loads it without a fetch.
//    JSON.stringify is HTML-safe except for a literal </script>; split the tag
//    so the embedded JSON can never close the surrounding <script> early.
const specJson = JSON.stringify(bundledSpec).replace(/<\/script>/gi, '<\\/script>');
const narrationAudioJson = JSON.stringify(narrationAudioTable).replace(/<\/script>/gi, '<\\/script>');
const initialDeckJson = resolvedDeck.isCollection && !resolvedDeck.isSource
  ? JSON.stringify(resolvedDeck.deckId)
  : 'null';
// Viewer engine version (which slidey code rendered this bundle) — a separate
// axis from a published deck's content version, which publish-deck.sh stamps
// on top as window.__SLIDEY_DECK_VERSION__ post-build. See
// .context/feedback-e2e-plan.md, architecture decision 7.
const { version: viewerVersion } = require('../package.json');
const viewerVersionJson = JSON.stringify(viewerVersion || 'dev');
const inject = `<script>window.__SLIDEY_SPEC__ = ${specJson}; window.__SLIDEY_INITIAL_DECK__ = ${initialDeckJson}; window.__SLIDEY_VIEWER_VERSION__ = ${viewerVersionJson}; window.__SLIDEY_NARRATION_AUDIO__ = ${narrationAudioJson};</script>\n`;
html = html.replace(/(<script type="module">)/, `${inject}$1`);

// 4. Write the self-contained file.
const outPath = outArg
  ? resolve(outArg)
  : join(buildDir, `${basename(specPath, extname(specPath))}.html`);
writeFileSync(outPath, html);

const sizeMB = (statSync(outPath).size / 1e6).toFixed(2);
console.log(
  `[build-single] wrote ${outPath} (${sizeMB} MB, self-contained — ` +
  `${bundledSpec.scenes.length} source scene(s), ${embeddedAssets} asset(s), ` +
  `${Object.keys(narrationAudioTable).length} narration clip(s) embedded)`,
);
console.log('[build-single] open it directly in a browser; no server needed.');

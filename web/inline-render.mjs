// Post-build inliner for the render harness.
//
// Replaces vite-plugin-singlefile (absent from the corporate registry). Takes
// Vite's dist-render/ output (one entry chunk + one stylesheet, no code-split
// thanks to inlineDynamicImports) and folds the JS + CSS directly into the HTML,
// producing a single self-contained dist/render.html that headless Chrome loads
// via file:// with no external fetches (which file:// blocks for module chunks).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Inline in place: read Vite's dist-render/ output and overwrite render.html
// there with the self-contained version. Keeping the render harness in its own
// dist-render/ (separate from the web app's dist/) means `build:web`'s
// emptyOutDir can't clobber the bundle the video/PDF pipeline loads.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'dist-render');
const outDir = srcDir;
const outFile = join(outDir, 'render.html');

let html = readFileSync(join(srcDir, 'render.html'), 'utf8');

// Inline every emitted JS chunk referenced via <script type="module" src=...>.
html = html.replace(
  /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g,
  (m, src) => {
    const file = src.replace(/^\.?\//, '');
    const js = readFileSync(join(srcDir, file), 'utf8');
    return `<script type="module">\n${js}\n</script>`;
  },
);

// Inline every emitted stylesheet referenced via <link rel="stylesheet" href=...>.
html = html.replace(
  /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g,
  (m, href) => {
    const file = href.replace(/^\.?\//, '');
    const css = readFileSync(join(srcDir, file), 'utf8');
    return `<style>\n${css}\n</style>`;
  },
);

// Guard for residual EXTERNAL references — match the actual tag shapes the
// inliner replaces (a <script> with src=, or a <link rel="stylesheet">), not a
// blanket substring scan: bundled JS legitimately contains strings like
// `[rel="stylesheet"]` (Vite's dynamic-import preload helper) and `src="…"`,
// which a substring scan would false-flag once any chunk uses a dynamic import.
const residualScript = /<script\b[^>]*\bsrc=/i.test(html);
const residualLink = /<link\b[^>]*\brel=["']?stylesheet/i.test(html);
if (residualScript || residualLink) {
  throw new Error(
    '[inline-render] unresolved external refs remain after inlining — the '
    + 'self-contained offline artifact would break. dist-render contents: '
    + readdirSync(srcDir).join(', '),
  );
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html);
console.log(`[inline-render] wrote ${outFile} (${html.length} bytes, self-contained)`);

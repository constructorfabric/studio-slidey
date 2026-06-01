import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Three build targets share the same Vue scene components:
//   SLIDEY_TARGET=render → single-chunk bundle for render.html, inlined to a
//     self-contained dist-render/render.html (by web/inline-render.mjs) that
//     Puppeteer loads via file:// for video + PDF. No code-splitting / external
//     module fetches (both break under file://).
//   SLIDEY_TARGET=webfile → single-chunk bundle of the interactive web app
//     (index.html), inlined + spec-embedded by web/build-single.mjs into one
//     self-contained .html that opens straight off disk (file://) with no fetch.
//   SLIDEY_TARGET=web → normal multi-asset build of index.html (the interactive
//     web app), served over http or opened relative.
const target = process.env.SLIDEY_TARGET || 'web';
const isRender = target === 'render';
const isWebFile = target === 'webfile';

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: isRender
    ? {
        outDir: 'dist-render',
        emptyOutDir: true,
        target: 'chrome119',
        assetsInlineLimit: 100_000_000, // inline fonts/images as data URIs
        rollupOptions: {
          input: 'render.html',
          output: {
            inlineDynamicImports: true,
            entryFileNames: 'render.js',
            assetFileNames: 'render.[ext]',
          },
        },
      }
    : isWebFile
    ? {
        outDir: 'dist-web-single',
        emptyOutDir: true,
        target: 'chrome119',
        assetsInlineLimit: 100_000_000, // inline fonts/images as data URIs
        rollupOptions: {
          input: 'index.html',
          output: {
            inlineDynamicImports: true,
            entryFileNames: 'app.js',
            assetFileNames: 'app.[ext]',
          },
        },
      }
    : {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'chrome119',
        rollupOptions: { input: 'index.html' },
      },
});

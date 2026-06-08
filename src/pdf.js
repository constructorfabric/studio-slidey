/**
 * SLIDEY — PDF exporter
 *
 * Renders the same spec the video pipeline uses into a vector PDF, ONE PAGE PER
 * REVEAL STEP: a diagram that builds across N panels becomes N pages showing the
 * build-up. Drives the shared Vue render bundle (dist/render.html) with the same
 * window.slidey.* API as the renderer, but captures page.pdf() per reveal step
 * (holds collapse — no dwell pages) instead of per frame. Text and SVG stay
 * vector/selectable because Chrome prints, rather than rasterises, the page.
 *
 * The reveal-step model is shared with the web app via web/sceneSteps.mjs.
 *
 * Note: request scenes render from the response data already in the spec
 * (mock / playback / inline). Live HTTP execution stays a video-pipeline concern
 * (see src/runner.js); a live request scene with no captured response renders
 * with an empty response panel.
 */

'use strict';

const puppeteer = require('puppeteer');
const path      = require('path');
const fs        = require('fs');
const { PDFDocument } = require('pdf-lib');

const RENDER_BUNDLE = path.resolve(__dirname, '..', 'dist-render', 'render.html');

/**
 * @param {object} spec            Parsed scene spec
 * @param {string} outputPath      Destination .pdf path
 * @param {object} opts
 * @param {string} [opts.specPath] Absolute spec path (resolves relative assets)
 * @param {Set}    [opts.selectedScenes] Optional scene-index filter
 * @param {function} [opts.onProgress] callback(pageCount, sceneIndex, type)
 * @returns {Promise<{pageCount:number, scenePages:Array}>}
 */
async function generatePdf(spec, outputPath, opts = {}) {
  const { specPath = null, selectedScenes = null, onProgress = null } = opts;

  if (!fs.existsSync(RENDER_BUNDLE)) {
    throw new Error(
      `[slidey] render bundle missing: ${RENDER_BUNDLE}\nBuild it first:  npm run build:render`
    );
  }

  // Shared reveal-step model (ESM) — loaded via dynamic import from this CJS file.
  const { stepsForScene, applyShow } = await import('../web/sceneSteps.mjs');

  const { width = 1920, height = 1080 } = (spec.meta && spec.meta.resolution) || {};
  const mode = (spec.meta && spec.meta.mode) || 'api';

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      `--window-size=${width},${height}`],
  });

  const scenePages = [];
  let pageCount = 0;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`file://${RENDER_BUNDLE}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__slideyReady === true', { timeout: 15000 });
    // Force screen styles into the PDF (default print media would drop them).
    await page.emulateMediaType('screen');
    await page.evaluate((meta, m) => {
      window.slidey.setMeta(meta);
      window.slidey.setMode(m);
    }, spec.meta || {}, mode);
    // Snap reveal animations so each captured step is the fully-revealed frame a
    // viewer sees during the hold, not a mid-fade (the 320ms transition is not
    // complete at capture time otherwise). Same trick as renderer.js.
    await page.evaluate(() => document.body.classList.add('instant'));

    const merged = await PDFDocument.create();
    const pdfOpts = {
      printBackground: true,
      width: `${width}px`,
      height: `${height}px`,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      pageRanges: '1',
    };

    const scenes = spec.scenes || [];
    for (let i = 0; i < scenes.length; i++) {
      if (selectedScenes && !selectedScenes.has(i)) continue;
      const scene = scenes[i];

      // Inline a terminal-gif's first frame as a data URI (a static GIF in a PDF
      // shows its first frame; that's the right still for a slide).
      const showOpts = {};
      if (scene.type === 'terminal-gif' && scene.gif) {
        const gifPath = path.resolve(path.dirname(specPath || '.'), scene.gif);
        if (fs.existsSync(gifPath)) {
          showOpts.gifDataUri = `data:image/gif;base64,${fs.readFileSync(gifPath).toString('base64')}`;
        }
      }

      await page.evaluate(applyShow, scene, showOpts);

      const steps = stepsForScene(scene);
      const pageSteps = steps.length ? steps : [null]; // title → single shown page
      let scenePageCount = 0;
      for (const step of pageSteps) {
        if (step) await page.evaluate(s => window.slidey.setState(s), step);
        await page.evaluate('window.__slideySettle && window.__slideySettle()');
        const buf = await page.pdf(pdfOpts);
        const doc = await PDFDocument.load(buf);
        const [pg] = await merged.copyPages(doc, [0]);
        merged.addPage(pg);
        pageCount++;
        scenePageCount++;
      }
      scenePages.push({ sceneIndex: i, type: scene.type, pages: scenePageCount });
      if (onProgress) onProgress(pageCount, i, scene.type);

      // Reset between scenes so the next scene starts clean.
      await page.evaluate(() => { window.slidey.setState('blank'); window.slidey.hideTitleCard(); });
    }

    const bytes = await merged.save();
    fs.writeFileSync(outputPath, bytes);
    return { pageCount, scenePages };
  } finally {
    await browser.close();
  }
}

module.exports = { generatePdf };

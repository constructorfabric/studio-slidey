/**
 * SLIDEY — PNG exporter
 *
 * Renders one PNG per reveal step into an output directory, using the same
 * reveal-step model as the PDF exporter. Fast (~1-3s per scene) and produces
 * files a vision model can Read directly.
 *
 * Usage: output path must be a directory (created if absent). Files are named
 * <scene-index>-<step-index>.png, e.g. 04-01.png, 04-02.png, 04-03.png.
 * With --scenes filtering only the selected scenes are written.
 */

'use strict';

const puppeteer = require('puppeteer');
const path      = require('path');
const fs        = require('fs');

const RENDER_BUNDLE = path.resolve(__dirname, '..', 'dist-render', 'render.html');

/**
 * @param {object} spec
 * @param {string} outputDir        Destination directory (created if absent)
 * @param {object} opts
 * @param {string} [opts.specPath]
 * @param {Set}    [opts.selectedScenes]
 * @param {function} [opts.onProgress] callback(fileCount, sceneIndex, type)
 * @returns {Promise<{fileCount:number, files:string[]}>}
 */
async function generatePngs(spec, outputDir, opts = {}) {
  const { specPath = null, selectedScenes = null, onProgress = null } = opts;

  // Rebuilds dist-render if missing OR stale vs web/ — keeps PNG exports in
  // lockstep with the live viewer's renderer.
  require('./render-bundle').ensureRenderBundle();

  fs.mkdirSync(outputDir, { recursive: true });

  const { stepsForScene, applyShow } = await import('../web/sceneSteps.mjs');

  const { width = 1920, height = 1080 } = (spec.meta && spec.meta.resolution) || {};
  const mode = (spec.meta && spec.meta.mode) || 'api';

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      `--window-size=${width},${height}`],
  });

  const files = [];
  let fileCount = 0;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`file://${RENDER_BUNDLE}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__slideyReady === true', { timeout: 15000 });
    await page.emulateMediaType('screen');
    await page.evaluate((meta, m) => {
      window.slidey.setMeta(meta);
      window.slidey.setMode(m);
    }, spec.meta || {}, mode);
    // Snap reveal animations so each captured step is the fully-revealed frame a
    // viewer sees during the hold, not a mid-fade (the 320ms transition is not
    // complete at capture time otherwise). Same trick as renderer.js.
    await page.evaluate(() => document.body.classList.add('instant'));

    const scenes = spec.scenes || [];
    for (let i = 0; i < scenes.length; i++) {
      if (selectedScenes && !selectedScenes.has(i)) continue;
      const scene = scenes[i];

      // video scenes are not rendered through the Vue bundle — emit a poster
      // frame (a representative still) straight from the source instead.
      if (scene.type === 'video' && scene.src) {
        const v = require('./video');
        const src = path.resolve(path.dirname(specPath || '.'), scene.src);
        if (fs.existsSync(src)) {
          const dur = v.probeDuration(src);
          const at = Math.max(0, scene.start || 0) + Math.min(1, dur * 0.1);
          const sceneStr = String(i).padStart(2, '0');
          const filePath = path.join(outputDir, `${sceneStr}-01.png`);
          v.extractPoster({ src, outPng: filePath, width, height, fit: scene.fit || 'contain', atSec: at });
          files.push(filePath);
          fileCount++;
          if (onProgress) onProgress(fileCount, i, scene.type);
          continue;
        }
      }
      // rrweb-log video scenes: poster via a single Replayer seek + screenshot.
      if (scene.type === 'video' && scene.rrweb) {
        const rrwebPath = path.resolve(path.dirname(specPath || '.'), scene.rrweb);
        if (fs.existsSync(rrwebPath)) {
          const { extractRrwebPoster } = require('./rrweb-render');
          const sceneStr = String(i).padStart(2, '0');
          const filePath = path.join(outputDir, `${sceneStr}-01.png`);
          await extractRrwebPoster(rrwebPath, filePath, { width, height, fit: scene.fit || 'contain', atSec: scene.start || undefined });
          files.push(filePath);
          fileCount++;
          if (onProgress) onProgress(fileCount, i, scene.type);
          continue;
        }
      }

      const showOpts = {};
      if (scene.type === 'terminal-gif' && scene.gif) {
        const gifPath = path.resolve(path.dirname(specPath || '.'), scene.gif);
        if (fs.existsSync(gifPath)) {
          showOpts.gifDataUri = `data:image/gif;base64,${fs.readFileSync(gifPath).toString('base64')}`;
        }
      }

      await page.evaluate(applyShow, scene, showOpts);

      const steps = stepsForScene(scene);
      const pageSteps = steps.length ? steps : [null];
      let stepIdx = 0;
      for (const step of pageSteps) {
        if (step) await page.evaluate(s => window.slidey.setState(s), step);
        await page.evaluate('window.__slideySettle && window.__slideySettle()');
        const sceneStr  = String(i).padStart(2, '0');
        const stepStr   = String(stepIdx + 1).padStart(2, '0');
        const filePath  = path.join(outputDir, `${sceneStr}-${stepStr}.png`);
        await page.screenshot({ path: filePath, type: 'png' });
        files.push(filePath);
        fileCount++;
        stepIdx++;
      }
      if (onProgress) onProgress(fileCount, i, scene.type);

      await page.evaluate(() => { window.slidey.setState('blank'); window.slidey.hideTitleCard(); });
    }

    return { fileCount, files };
  } finally {
    await browser.close();
  }
}

module.exports = { generatePngs };

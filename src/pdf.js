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
const { execFileSync, spawnSync } = require('child_process');
const { PDFDocument } = require('pdf-lib');

const RENDER_BUNDLE = path.resolve(__dirname, '..', 'dist-render', 'render.html');

/**
 * Compress a finished PDF in place, LOSSLESSLY, with mutool + qpdf.
 *
 * Merging one single-page PDF per reveal step (pdf-lib copyPages) re-embeds the
 * page fonts on every page, so a long deck balloons to many MB and scrolls
 * sluggishly. The fix must be purely structural: `mutool clean -gggg -z`
 * garbage-collects and DEDUPLICATES the byte-identical per-page font streams and
 * deflates everything, then `qpdf --linearize` enables "fast web view"
 * (progressive open) — together a ~3× shrink that scrolls instantly.
 *
 * Deliberately NOT Ghostscript: `gs -sDEVICE=pdfwrite` re-renders content and
 * flattens the slides' radial-gradient backdrops into solid opaque shapes (a
 * giant blue disc on every page). mutool/qpdf never re-render, so vectors,
 * gradients and transparency are preserved byte-for-byte.
 *
 * Best-effort: with neither tool present (or on failure) the uncompressed PDF is
 * kept and a hint is logged. Returns { compressed, before, after }.
 *
 * @param {string} pdfPath  path to the PDF to compress in place
 * @param {object} [opts]
 * @param {function} [opts.log] message sink (defaults to console.error)
 * @returns {{compressed:boolean, before:number, after:number}}
 */
function compressPdf(pdfPath, opts = {}) {
  const { log = (m) => console.error(m) } = opts;
  const mutool = resolveBin('mutool', []);
  const qpdf = resolveBin('qpdf', ['--version']);
  const before = fs.statSync(pdfPath).size;

  if (!mutool && !qpdf) {
    log(
      '[slidey] mutool/qpdf not found — skipping PDF compression. Install for a ' +
        'smaller, linearized file:  brew install mupdf-tools qpdf  ·  apt install mupdf-tools qpdf'
    );
    return { compressed: false, before, after: before };
  }

  const tmpA = pdfPath + '.mu.tmp';
  const tmpB = pdfPath + '.qp.tmp';
  const rm = (p) => { if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (_) { /* ignore */ } } };
  const ok = (p) => fs.existsSync(p) && fs.statSync(p).size > 0;

  let current = pdfPath; // most-compressed valid file so far
  try {
    // 1. mutool clean: dedup the duplicated font objects + deflate streams.
    if (mutool) {
      execFileSync(mutool, ['clean', '-gggg', '-z', current, tmpA], { stdio: ['ignore', 'ignore', 'pipe'] });
      if (ok(tmpA)) current = tmpA;
    }
    // 2. qpdf --linearize: fast-web-view, plus object-stream/flate recompression.
    //    qpdf exits 0 (clean) or 3 (warnings, output still valid).
    if (qpdf) {
      const r = spawnSync(
        qpdf,
        ['--linearize', '--object-streams=generate', '--compress-streams=y', current, tmpB],
        { stdio: ['ignore', 'ignore', 'pipe'] }
      );
      if ((r.status === 0 || r.status === 3) && ok(tmpB)) current = tmpB;
    }

    const after = current === pdfPath ? before : fs.statSync(current).size;
    if (current !== pdfPath && after < before) {
      fs.renameSync(current, pdfPath);          // promote winner
      rm(current === tmpB ? tmpA : tmpB);        // drop the loser temp
      return { compressed: true, before, after };
    }
    rm(tmpA); rm(tmpB);
    return { compressed: false, before, after: before };
  } catch (err) {
    rm(tmpA); rm(tmpB);
    log(`[slidey] PDF compression skipped — ${err.message.split('\n')[0]}`);
    return { compressed: false, before, after: before };
  }
}

/**
 * Return `name` if the binary is runnable (no ENOENT), else null. Presence is
 * judged by whether the probe spawned at all — exit code is ignored, since
 * `mutool` with no command exits non-zero but is clearly installed.
 */
function resolveBin(name, probeArgs) {
  const r = spawnSync(name, probeArgs, { stdio: 'ignore' });
  return r.error ? null : name;
}

/**
 * @param {object} spec            Parsed scene spec
 * @param {string} outputPath      Destination .pdf path
 * @param {object} opts
 * @param {string} [opts.specPath] Absolute spec path (resolves relative assets)
 * @param {Set}    [opts.selectedScenes] Optional scene-index filter
 * @param {function} [opts.onProgress] callback(pageCount, sceneIndex, type)
 * @returns {Promise<{pageCount:number, scenePages:Array}>}
 */
/**
 * Render a video scene's poster still to a temp PNG (deck-sized), from an MP4
 * `src` or an rrweb log. Returns the path, or null if the source is missing.
 */
async function videoPosterPng(scene, specPath, width, height) {
  const os = require('os');
  const specDir = path.dirname(specPath || '.');
  const out = path.join(os.tmpdir(), `slidey-pdf-poster-${process.pid}-${Math.round(width)}x${Math.round(height)}-${scene.src ? 'src' : 'rrweb'}-${Date.now()}.png`);
  if (scene.src) {
    const src = path.resolve(specDir, scene.src);
    if (!fs.existsSync(src)) return null;
    const v = require('./video');
    const dur = v.probeDuration(src);
    const at = Math.max(0, scene.start || 0) + Math.min(1, dur * 0.1);
    v.extractPoster({ src, outPng: out, width, height, fit: scene.fit || 'contain', atSec: at });
    return out;
  }
  if (scene.rrweb) {
    const rrwebPath = path.resolve(specDir, scene.rrweb);
    if (!fs.existsSync(rrwebPath)) return null;
    const { extractRrwebPoster } = require('./rrweb-render');
    await extractRrwebPoster(rrwebPath, out, { width, height, fit: scene.fit || 'contain', atSec: scene.start || undefined });
    return out;
  }
  return null;
}

async function generatePdf(spec, outputPath, opts = {}) {
  const {
    specPath = null, selectedScenes = null, onProgress = null,
    // raster mode: capture each page as a flat JPEG (rendered by Chrome, so
    // gradients/SVG are faithful) instead of a vector page. Vector pages with
    // radial-gradient backdrops repaint slowly + progressively in some viewers
    // (macOS Preview shows white → partial → full); a flat image paints at once.
    raster = false, rasterScale = 2, rasterQuality = 82,
  } = opts;

  // Rebuilds dist-render if missing OR stale vs web/ — the export can never
  // silently render an older renderer than the live viewer.
  require('./render-bundle').ensureRenderBundle();

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
    // 2× device scale in raster mode keeps the flat JPEG crisp on retina.
    await page.setViewport({ width, height, deviceScaleFactor: raster ? rasterScale : 1 });
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

      // Video scenes aren't rendered through the Vue bundle — embed a poster
      // still (from the MP4 or the rrweb log) as a single full-page image.
      if (scene.type === 'video' && (scene.src || scene.rrweb)) {
        const poster = await videoPosterPng(scene, specPath, width, height);
        if (poster) {
          const img = await merged.embedPng(fs.readFileSync(poster));
          const pg = merged.addPage([width, height]);
          pg.drawImage(img, { x: 0, y: 0, width, height });
          fs.rmSync(poster, { force: true });
          pageCount++;
          scenePages.push({ sceneIndex: i, type: scene.type, pages: 1 });
          if (onProgress) onProgress(pageCount, i, scene.type);
          continue;
        }
      }

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
        if (raster) {
          // Flat image page — paints instantly, no progressive vector repaint.
          const shot = await page.screenshot({ type: 'jpeg', quality: rasterQuality });
          const img = await merged.embedJpg(shot);
          const pg = merged.addPage([width, height]);
          pg.drawImage(img, { x: 0, y: 0, width, height });
        } else {
          const buf = await page.pdf(pdfOpts);
          const doc = await PDFDocument.load(buf);
          const [pg] = await merged.copyPages(doc, [0]);
          merged.addPage(pg);
        }
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

    // Post-process: losslessly dedup fonts, deflate, linearize (best-effort).
    const { compress = true } = opts;
    let compression = { compressed: false, before: bytes.length, after: bytes.length };
    if (compress) {
      compression = compressPdf(outputPath);
      if (compression.compressed) {
        const pct = Math.round((1 - compression.after / compression.before) * 100);
        const mb = (n) => (n / 1e6).toFixed(2);
        console.error(
          `[slidey] PDF compressed ${mb(compression.before)}MB → ${mb(compression.after)}MB  (-${pct}%, fast-web-view)`
        );
      }
    }
    return { pageCount, scenePages, compression };
  } finally {
    await browser.close();
  }
}

module.exports = { generatePdf, compressPdf };

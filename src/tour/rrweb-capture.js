/**
 * SLIDEY — Tour capture driver (rrweb / real-time)
 *
 * The rrweb counterpart to capture.js's freeze-frame driver. Instead of
 * screenshotting each settled step, this injects rrweb into the live app and
 * records a real-time DOM event log while walking the same tour storyboard —
 * capturing true motion (scroll, transitions, typing) as compact JSON rather
 * than pixels. The single source serves two playback engines downstream: the
 * baked rasterizer (Replayer.goto → frames → MP4) and the live web-viewer
 * player (Replayer mounted in deck chrome).
 *
 * Key differences from freeze-frame capture:
 *   - Dwell is REAL-TIME (PACE-scaled) so motion is recorded, not frozen.
 *   - slidey's caption/spotlight chrome is NOT baked into the recording — the
 *     log stays a clean, reusable app capture (same shape as a kitsoki bug
 *     session). The deck's overlays (chapter captions, annotations) composite on
 *     top at render/replay time. We DO scrollIntoView the step target so the
 *     replay naturally focuses there.
 *   - Step boundaries are marked with `slidey.chapter` rrweb custom events, so
 *     the log is self-describing; chaptersFromEvents() derives the sidecar.
 *
 * Recording starts AFTER the app is staged (initial load + ready gate), so the
 * log opens clean on the first real step — no setup curtain needed.
 *
 * LIMITATION: a full-page navigation resets rrweb recording. SPA hash-route
 * navigation (kitsoki's `/#/s/…`) is fine. route-match steps that trigger a real
 * reload are unsupported in rrweb mode (use freeze-frame for those).
 */

'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const { resolveTarget } = require('./launch');
const { runAction, waitSel, clickSel, absUrl, ACTION_TIMEOUT } = require('./capture');
const { CHAPTER_TAG, chaptersFromEvents } = require('../rrweb-format');

/** Locate rrweb's self-contained record/replay UMD bundle for page injection. */
function rrwebBundlePath() {
  if (process.env.SLIDEY_RRWEB_BUNDLE) return process.env.SLIDEY_RRWEB_BUNDLE;
  // exports map blocks require.resolve of the dist subpath, so resolve the
  // package's main entry and find the UMD bundle alongside it.
  const main = require.resolve('rrweb'); // .../rrweb/dist/rrweb.cjs
  const candidate = path.join(path.dirname(main), 'rrweb.umd.min.cjs');
  if (fs.existsSync(candidate)) return candidate;
  throw new Error(
    'rrweb runtime not found. Run `npm install rrweb` or set SLIDEY_RRWEB_BUNDLE ' +
      'to a rrweb UMD bundle (dist/rrweb.umd.min.cjs).',
  );
}

/**
 * Capture a tour spec to an rrweb event log + chapters.
 *
 * @param {object} tour  Tour spec (same shape as capture.js).
 * @param {object} opts  { pace, onProgress, mask? }
 * @returns {Promise<{ events, chapters, viewport }>}
 */
async function captureTourRrweb(tour, opts = {}) {
  const pace = opts.pace != null ? opts.pace : (tour.pace != null ? tour.pace : 1);
  const viewport = Object.assign({ width: 1600, height: 900 }, tour.viewport || {});
  const dsf = tour.deviceScaleFactor || 1;
  const onProgress = opts.onProgress || null;
  const specPath = tour.specPath || '';
  // A product demo wants verbatim text; default masking OFF here (unlike the
  // bug-report buffer). Opt back in with tour.mask or opts.mask.
  const mask = opts.mask != null ? opts.mask : (tour.mask != null ? tour.mask : false);

  const bundle = fs.readFileSync(rrwebBundlePath(), 'utf8');
  const { base, stop, log } = await resolveTarget(tour.target);

  const dwell = (ms) => new Promise((r) => setTimeout(r, Math.max(0, Math.round(ms * pace))));

  let browser;
  let page;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', `--window-size=${viewport.width},${viewport.height}`],
    });
    page = await browser.newPage();
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: dsf });
    page.setDefaultTimeout(ACTION_TIMEOUT);

    // Stage the app (off-recording), then inject rrweb and start recording so
    // the log opens clean on the first real step.
    await page.goto(absUrl(base, tour.startPath || '/'), { waitUntil: 'load', timeout: ACTION_TIMEOUT });
    if (tour.readySelector) await waitSel(page, tour.readySelector);
    for (const act of tour.before || []) await runAction(page, base, act);

    await page.addScriptTag({ content: bundle });
    await page.evaluate((maskOn) => {
      window.__slideyEvents = [];
      const opts = {
        emit: (e) => window.__slideyEvents.push(e),
        recordCanvas: false,
        inlineStylesheet: true,
        maskAllInputs: !!maskOn,
      };
      if (maskOn) opts.maskTextSelector = '*';
      // rrweb UMD exposes `rrweb` (record + Replayer) on window.
      window.rrweb.record(opts);
    }, mask);

    const steps = tour.steps || [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      for (const act of step.before || []) await runAction(page, base, act);
      if (step.waitFor) await waitSel(page, step.waitFor);

      // Bring the target into view (recorded as a real scroll) and mark the
      // chapter boundary in the log.
      if (step.target) {
        await page.evaluate((sel, txt) => {
          const els = Array.from(document.querySelectorAll(sel));
          const el = txt ? els.find((e) => (e.textContent || '').includes(txt)) || els[0] : els[0];
          if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
        }, step.target, step.targetText || '');
      }
      await page.evaluate((tag, payload) => {
        window.rrweb.record.addCustomEvent(tag, payload);
      }, CHAPTER_TAG, {
        id: step.id || `step-${i}`,
        label: step.label || step.caption || step.id || `step-${i}`,
        specPath,
        line: step.line,
      });
      if (onProgress) onProgress(i, step.id || `step-${i}`);

      // Real-time dwell. For action / route-match steps, perform the click
      // partway through so the resulting motion is captured on-camera.
      const advance = step.advance || (step.kind === 'action' ? 'click-target' : 'next');
      const dwellMs = step.dwellMs || 3000;
      if ((advance === 'click-target' || advance === 'route-match') && step.target) {
        await dwell(dwellMs * 0.5);
        await clickSel(page, step.target, step.targetText);
        if (advance === 'route-match' && step.advanceUrl) {
          await page.waitForFunction(
            (u) => location.href.includes(u), { timeout: ACTION_TIMEOUT }, step.advanceUrl,
          ).catch(() => {});
        }
        await dwell(dwellMs * 0.5);
      } else {
        await dwell(dwellMs);
      }
    }

    // Stamp an end sentinel so the log spans the final step's dwell — otherwise
    // the last chapter window collapses to zero width (nothing is recorded after
    // the final chapter marker on an idle hold). `slidey.end` is ignored by the
    // chapter extractor (it only reads `slidey.chapter`).
    await page.evaluate((tag) => window.rrweb.record.addCustomEvent(tag, {}), 'slidey.end');
    const events = await page.evaluate(() => window.__slideyEvents || []);
    const chapters = chaptersFromEvents(events, { specPath });
    return { events, chapters, viewport: { ...viewport, deviceScaleFactor: dsf } };
  } catch (err) {
    const tail = (log() || '').slice(-800);
    throw new Error(`${err.message}${tail ? `\n--- target log (tail) ---\n${tail}` : ''}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    stop();
  }
}

module.exports = { captureTourRrweb, rrwebBundlePath };

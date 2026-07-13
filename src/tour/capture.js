/**
 * SLIDEY — Tour capture driver (freeze-frame)
 *
 * Drives a live web app through a tour storyboard with Puppeteer and captures a
 * deterministic PNG frame sequence — the same `frame-NNNNNN.png` substrate the
 * rest of slidey uses. This is the generalized, app-agnostic successor to
 * kitsoki's per-app Playwright recording specs.
 *
 * Capture model: FREEZE-FRAME. At each settled step the page is screenshotted
 * ONCE and that frame is held (copied) for the step's dwell, so reruns are
 * byte-identical. Transitions between steps (clicks, navigation) happen
 * off-camera — motion fidelity is traded for determinism.
 *   DEFERRED: a real-time CDP `Page.startScreencast` mode for smooth animation /
 *   streaming fidelity (what kitsoki records today) is a planned opt-in.
 *
 * Proven traps from kitsoki's harness are preserved: a setup curtain hides
 * off-camera staging, overlays are pointer-events:none, every action is
 * timeout-capped, and a chapter sidecar is emitted.
 *
 * Tour spec shape (JSON):
 *   {
 *     "target":  { "url": "..." } | { "launch": "...", "addr": "host:port" },
 *     "startPath": "/#/",                 // appended to base for the first goto
 *     "viewport": { "width": 1600, "height": 900 },
 *     "deviceScaleFactor": 1,
 *     "pace": 1,                          // dwell multiplier (0 = 1 frame/step)
 *     "curtain": "Loading…",              // setup title card
 *     "specPath": "features/tour.yaml",   // recorded into chapter source_ref
 *     "steps": [ {
 *        "id": "home-welcome", "label": "Welcome",
 *        "caption": "...", "sub": "...",  // banner text (caption ?? label)
 *        "target": "[data-testid=story-card]", "targetText": "Bug fix",
 *        "spotlight": true,
 *        "waitFor": "[data-testid=home-view]",
 *        "dwellMs": 4000,
 *        "kind": "explain" | "action",
 *        "advance": "next" | "click-target" | "route-match",
 *        "advanceUrl": "/#/s/",           // route-match: wait until URL contains
 *        "before": [ { "goto": "/#/" }, { "click": "sel" }, { "type": ["sel","txt"] },
 *                    { "waitFor": "sel" }, { "wait": 500 }, { "eval": "js…" } ]
 *     } ]
 *   }
 */

'use strict';

const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');

const { resolveTarget } = require('./launch');
const { ChapterRecorder } = require('./chapters');
const overlays = require('./overlays');
const { launchOptions } = require('../browser');
const { resolveAdapter } = require('./adapters');

const ACTION_TIMEOUT = 15000;   // never let a missing/covered element hang forever

/**
 * Run a single action step against the page.
 *
 * Dispatch order: the built-in single-key verbs first (byte-for-byte today's
 * behavior), then — for ANY unknown single-key action object — fall through to
 * the active adapter's `actions[verb]`. So `{ submitIntent: { … } }` resolves to
 * `ctx.adapter.actions.submitIntent(page, { … }, ctx)`. Built-in specs that use
 * only the closed verb set are unaffected.
 *
 * @param {object} page
 * @param {string} base  resolved target base URL (for goto).
 * @param {object} act   a single-key action object.
 * @param {object} [ctx] adapter ctx; carries ctx.adapter for the fall-through.
 */
async function runAction(page, base, act, ctx) {
  if (act.goto != null)      return page.goto(absUrl(base, act.goto), { waitUntil: 'load', timeout: ACTION_TIMEOUT });
  if (act.click != null)     return clickSel(page, act.click, act.text);
  if (act.type != null)      { const [sel, txt] = act.type; const el = await waitSel(page, sel); await el.type(String(txt), { delay: 0 }); return; }
  if (act.press != null)     return page.keyboard.press(act.press);
  if (act.waitFor != null)   { await waitSel(page, act.waitFor); return; }
  if (act.wait != null)      return new Promise((r) => setTimeout(r, act.wait));
  if (act.eval != null)      return page.evaluate(act.eval);
  // Built-in predicate wait: block until a page-context expression is truthy.
  if (act.waitForFn != null) {
    await page.waitForFunction(act.waitForFn, { timeout: (ctx && ctx.timeout) || ACTION_TIMEOUT });
    return;
  }

  // Fall through to the adapter: an unknown single-key object is an adapter verb.
  const adapter = ctx && ctx.adapter;
  if (adapter && adapter.actions) {
    const verb = Object.keys(act)[0];
    if (verb && typeof adapter.actions[verb] === 'function') {
      return adapter.actions[verb](page, act[verb], ctx);
    }
  }
  throw new Error(`unknown tour action: ${JSON.stringify(act)}`);
}

/**
 * Resolve a step's advance into a strategy and run it. Built-in strategies stay
 * inline at the call sites (click-target / route-match motion differs per driver);
 * this handles the NON-built-in cases shared by both drivers:
 *
 *   - `predicate`     — wait on a page expression in `step.advanceFn`.
 *   - <adapter name>  — resolved from `ctx.adapter.advancers[name](page, step, ctx)`.
 *
 * Returns true if it handled the advance, false if `advance` is a built-in the
 * caller must drive itself (next/click-target/route-match).
 *
 * @param {object} page
 * @param {object} step
 * @param {string} advance  the resolved advance name.
 * @param {object} ctx
 * @returns {Promise<boolean>}
 */
async function runAdvance(page, step, advance, ctx) {
  if (advance === 'predicate') {
    if (step.advanceFn) {
      await page.waitForFunction(step.advanceFn, { timeout: (ctx && ctx.timeout) || ACTION_TIMEOUT });
    }
    return true;
  }
  const advancers = (ctx && ctx.adapter && ctx.adapter.advancers) || {};
  if (typeof advancers[advance] === 'function') {
    await advancers[advance](page, step, ctx);
    return true;
  }
  return false;  // a built-in (next/click-target/route-match) — caller drives it.
}

/**
 * Run a step's on-camera `drive:[]` verbs in order. Generalizes the mid-dwell
 * click both drivers already do (so typed prose / intent submits are captured as
 * real motion): each entry is an action object run through `runAction`, so it can
 * be a built-in verb OR an adapter verb.
 *
 * @param {object} page
 * @param {string} base
 * @param {Array<object>} drive
 * @param {object} ctx
 */
async function runDrive(page, base, drive, ctx) {
  for (const act of drive || []) await runAction(page, base, act, ctx);
}

/**
 * Build the adapter ctx shared by both drivers. `resolve` resolves a path
 * RELATIVE TO THE TOUR SPEC FILE (`tour.specPath`, falling back to cwd) so an
 * adapter's `init` can `addScriptTag` a helper sitting beside the spec.
 *
 * @param {object} a  { tour, base, pace, mode: 'freeze'|'rrweb' }
 * @returns {{ base, pace, mode, timeout, resolve, adapter:null }}
 */
function makeCtx({ tour, base, pace, mode }) {
  const specDir = tour.specPath ? path.dirname(path.resolve(tour.specPath)) : process.cwd();
  return {
    base,
    pace,
    mode,
    timeout: ACTION_TIMEOUT,
    resolve: (p) => (path.isAbsolute(p) ? p : path.resolve(specDir, p)),
    adapter: null,
  };
}

function absUrl(base, p) {
  if (/^https?:\/\//.test(p)) return p;
  return base + (p.startsWith('/') || p.startsWith('#') ? p : '/' + p);
}

async function waitSel(page, sel) {
  return page.waitForSelector(sel, { visible: true, timeout: ACTION_TIMEOUT });
}

async function clickSel(page, sel, text) {
  if (text) {
    // Click the matching element whose text contains `text` (disambiguation).
    await page.waitForSelector(sel, { timeout: ACTION_TIMEOUT });
    const handle = await page.evaluateHandle((s, t) => {
      const els = Array.from(document.querySelectorAll(s));
      return els.find((e) => (e.textContent || '').includes(t)) || els[0] || null;
    }, sel, text);
    const el = handle.asElement();
    if (!el) throw new Error(`click target not found: ${sel} (text: ${text})`);
    await el.click();
    return;
  }
  const el = await waitSel(page, sel);
  await el.click();
}

/**
 * Capture a tour to a PNG frame sequence in `framesDir`.
 *
 * @param {object} tour
 * @param {string} framesDir
 * @param {object} opts  { fps=30, startFrame=0, pace, onProgress, onStepSettled?, headless=true, adapter? }
 *   `onStepSettled(page, step, index)` — optional; called right after a
 *   step's `before` evals + `waitFor` settle (pre-dwell, pre-spotlight), so a
 *   caller (e.g. the tour-set runner's poster capture) can screenshot the
 *   clean page without perturbing the freeze-frame hold that follows.
 * @returns {Promise<{ frameCount, chapters, viewport, startFrame }>}
 */
async function captureTour(tour, framesDir, opts = {}) {
  const fps        = opts.fps || 30;
  const startFrame = opts.startFrame || 0;
  const pace       = opts.pace != null ? opts.pace : (tour.pace != null ? tour.pace : 1);
  const viewport   = Object.assign({ width: 1600, height: 900 }, tour.viewport || {});
  const dsf        = tour.deviceScaleFactor || 1;
  const onProgress = opts.onProgress || null;
  const onStepSettled = opts.onStepSettled || null;
  const specPath   = tour.specPath || '';

  fs.mkdirSync(framesDir, { recursive: true });

  const { base, stop, log } = await resolveTarget(tour.target);
  // The adapter ctx threaded to every hook/verb/advancer. `resolve` is relative
  // to the spec dir so an adapter can addScriptTag a sibling helper.
  const ctx = makeCtx({ tour, base, pace, mode: 'freeze' });
  ctx.adapter = resolveAdapter(tour, opts.adapter, ctx.resolve);

  let frameIndex = startFrame;
  const chapters = new ChapterRecorder(fps);
  const framePath = (n) => path.join(framesDir, `frame-${String(n).padStart(6, '0')}.png`);

  // Freeze-frame hold: one screenshot, copied to fill `frames` slots. Identical
  // bytes → deterministic, and far faster than re-screenshotting a static page.
  const captureHold = async (frames, label) => {
    const n = Math.max(1, frames);
    const first = framePath(frameIndex);
    await page.screenshot({ path: first });
    if (onProgress) onProgress(frameIndex, label);
    frameIndex++;
    for (let i = 1; i < n; i++) {
      fs.copyFileSync(first, framePath(frameIndex));
      frameIndex++;
    }
  };

  // The browser launch lives INSIDE the try so a launch failure still runs the
  // finally below and tears down the spawned target server (no leaked port).
  let browser;
  let page;
  try {
    browser = await puppeteer.launch(launchOptions({
      width: viewport.width,
      height: viewport.height,
      args: ['--disable-gpu'],
    }));
    page = await browser.newPage();
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: dsf });
    page.setDefaultTimeout(ACTION_TIMEOUT);

    await overlays.installCurtain(page, tour.curtain || tour.title || 'Loading…');
    await page.goto(absUrl(base, tour.startPath || '/'), { waitUntil: 'load', timeout: ACTION_TIMEOUT });
    if (tour.readySelector) await waitSel(page, tour.readySelector);
    await overlays.installOverlays(page);

    // Adapter lifecycle: run once after the ready gate, before step 0.
    await ctx.adapter.init(page, tour, ctx);

    const steps = tour.steps || [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Off-camera setup for this step.
      for (const act of step.before || []) await runAction(page, base, act, ctx);
      if (step.waitFor) await waitSel(page, step.waitFor);

      // Settled hook (e.g. tour-set poster capture) — right after `before` +
      // `waitFor`, before spotlight/caption/dwell so the screenshot is clean.
      if (onStepSettled) await onStepSettled(page, step, i);

      // Frame the step: spotlight + caption.
      const wantSpot = step.spotlight !== false && !!step.target;
      if (wantSpot) await overlays.moveSpotlight(page, step.target, step.targetText);
      else await overlays.moveSpotlight(page, null);
      await overlays.setCaption(page, step.caption != null ? step.caption : step.label, step.sub);

      // Lift the curtain on the first step, once it's staged.
      if (i === 0) await overlays.liftCurtain(page);

      // Per-step adapter hook (e.g. drive the app's own overlay). No-op default.
      await ctx.adapter.decorate(page, step, ctx);

      // On-camera drive verbs run before the freeze, so their resulting DOM is
      // what the held frame captures (in freeze mode there is no mid-dwell).
      if (step.drive) await runDrive(page, base, step.drive, ctx);

      // Settle, then freeze-frame the dwell.
      await new Promise((r) => setTimeout(r, 350));
      const dwellFrames = Math.round(((step.dwellMs || 3000) / 1000) * fps * pace);
      chapters.open(step.id || `step-${i}`, step.label, specPath, frameIndex, step.line);
      await captureHold(dwellFrames, step.id || `step-${i}`);

      // Advance (off-camera; not captured).
      const advance = step.advance || (step.kind === 'action' ? 'click-target' : 'next');
      // Non-built-in advance (predicate / adapter advancer) is resolved first.
      const handled = await runAdvance(page, step, advance, ctx);
      if (!handled && (advance === 'click-target' || advance === 'route-match')) {
        if (step.target) await clickSel(page, step.target, step.targetText);
        if (advance === 'route-match' && step.advanceUrl) {
          await page.waitForFunction(
            (u) => location.href.includes(u), { timeout: ACTION_TIMEOUT }, step.advanceUrl,
          ).catch(() => {});
          await overlays.installOverlays(page);  // DOM was replaced by navigation
        }
      }
    }
  } catch (err) {
    // Surface the target's log — Puppeteer errors alone are often opaque.
    const tail = (log() || '').slice(-800);
    throw new Error(`${err.message}${tail ? `\n--- target log (tail) ---\n${tail}` : ''}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    stop();
  }

  const chapterList = chapters.list(frameIndex);
  return { frameCount: frameIndex - startFrame, chapters: chapterList, viewport, startFrame };
}

// Shared step-driver helpers, reused by the rrweb capture path (rrweb-capture.js)
// so both capture modes drive a tour with identical action/selector semantics.
module.exports = {
  captureTour, runAction, runAdvance, runDrive, makeCtx,
  waitSel, clickSel, absUrl, ACTION_TIMEOUT,
};

'use strict';

/**
 * SLIDEY — tour-set: many tours captured against ONE shared launched target
 *
 * `slidey capture --tours <tour-set.json>` (mockup-demo-tooling-contract.md
 * §2). A tour-set names a shared `target` / `viewport` / `deviceScaleFactor`,
 * launched ONCE, and a list of individual tours that run sequentially
 * against it — instead of one server spawn per tour (the existing single-
 * tour `slidey capture <tour.json> <out>` CLI, which this does not change).
 *
 * Per-tour `dwellOverrides` (step id → dwellMs) and `postersDir` are applied
 * IN MEMORY only — authored tour files on disk are never rewritten.
 *
 * Split into small, dependency-injectable pieces so the override/sequencing/
 * teardown contract is unit-testable without spinning up a real browser:
 *   - loadTourSet / applyDwellOverrides / resolveTourEntry: pure parsing and
 *     path/step resolution, no I/O beyond reading the tour-set + tour files.
 *   - runTourSet: the orchestration loop. The target launcher and the two
 *     capture functions are passed in via `opts` (defaulting to the real
 *     ./launch and ./index implementations) so tests can substitute fakes.
 */

const fs = require('fs');
const path = require('path');

/**
 * Load and parse a tour-set JSON file.
 *
 * @param {string} tourSetPath
 * @returns {{ tourSet: object, setDir: string }} setDir is the tour-set
 *   file's own directory — the base every relative path in it resolves against.
 */
function loadTourSet(tourSetPath) {
  const absSet = path.resolve(tourSetPath);
  if (!fs.existsSync(absSet)) throw new Error(`tour-set not found: ${absSet}`);
  let tourSet;
  try {
    tourSet = JSON.parse(fs.readFileSync(absSet, 'utf-8'));
  } catch (err) {
    throw new Error(`failed to parse tour-set JSON: ${err.message}`);
  }
  if (!tourSet || !Array.isArray(tourSet.tours) || !tourSet.tours.length) {
    throw new Error(`tour-set has no "tours": ${absSet}`);
  }
  return { tourSet, setDir: path.dirname(absSet) };
}

/**
 * Apply dwellOverrides (step id → dwellMs) to a tour's steps IN MEMORY.
 * A step with no explicit `id` falls back to the same `step-${index}`
 * convention the capture drivers (capture.js / rrweb-capture.js) use, so
 * overrides key consistently whether or not steps are named.
 *
 * Never mutates the input array or its step objects; returns a new array
 * (or the original reference when there is nothing to override, so callers
 * that skip this when `dwellOverrides` is absent pay no cost).
 *
 * @param {object[]} steps
 * @param {Object<string, number>} [dwellOverrides]
 * @returns {object[]}
 */
function applyDwellOverrides(steps, dwellOverrides) {
  if (!dwellOverrides || !steps || !steps.length) return steps;
  return steps.map((step, idx) => {
    const id = step.id || `step-${idx}`;
    return Object.prototype.hasOwnProperty.call(dwellOverrides, id)
      ? Object.assign({}, step, { dwellMs: dwellOverrides[id] })
      : step;
  });
}

/**
 * Resolve one tour-set entry into a ready-to-capture tour + output plan.
 * Relative paths (`entry.tour`, `entry.out`, `entry.postersDir`) resolve
 * against `setDir` (the tour-set file's own directory), per the contract.
 * The tour file itself is loaded, given a `specPath` (for chapter
 * source_refs) if it doesn't already carry one, and has the tour-set's
 * shared `viewport`/`deviceScaleFactor` and this entry's `dwellOverrides`
 * applied IN MEMORY — the tour file on disk is never rewritten.
 *
 * @param {object} tourSet        parsed tour-set document (for shared overrides)
 * @param {object} entry          one entry of tourSet.tours
 * @param {string} setDir         tour-set file's directory (relative-path base)
 * @param {object} [cliDefaults]  { format, pace } — CLI flag fallbacks for an
 *   entry that doesn't specify its own (mirrors the single-tour `capture` CLI).
 * @returns {{ tour: object, tourPath: string, outPath: string, isRrweb: boolean,
 *             pace: (number|undefined), postersDir: (string|null), tourBase: string }}
 */
function resolveTourEntry(tourSet, entry, setDir, cliDefaults = {}) {
  if (!entry || !entry.tour || !entry.out) {
    throw new Error(`tour-set entry missing "tour" or "out": ${JSON.stringify(entry)}`);
  }
  const resolve = (p) => (path.isAbsolute(p) ? p : path.resolve(setDir, p));

  const tourPath = resolve(entry.tour);
  if (!fs.existsSync(tourPath)) throw new Error(`tour not found: ${tourPath}`);
  let tour;
  try {
    tour = JSON.parse(fs.readFileSync(tourPath, 'utf-8'));
  } catch (err) {
    throw new Error(`failed to parse ${tourPath}: ${err.message}`);
  }
  if (!tour.specPath) tour.specPath = path.relative(process.cwd(), tourPath);

  // Shared overrides: top-level tour-set fields win over the tour file's own.
  if (tourSet.viewport) tour.viewport = tourSet.viewport;
  if (tourSet.deviceScaleFactor != null) tour.deviceScaleFactor = tourSet.deviceScaleFactor;

  tour.steps = applyDwellOverrides(tour.steps, entry.dwellOverrides);

  const outPath = resolve(entry.out);
  const isRrweb = entry.format === 'rrweb'
    || cliDefaults.format === 'rrweb'
    || /\.rrweb\.json$/i.test(outPath);
  const pace = entry.pace != null ? entry.pace : cliDefaults.pace;
  const postersDir = entry.postersDir ? resolve(entry.postersDir) : null;
  const tourBase = path.basename(entry.tour).replace(/\.[^.]+$/, '');

  return { tour, tourPath, outPath, isRrweb, pace, postersDir, tourBase };
}

/**
 * Run every tour in a tour-set sequentially against ONE shared launched
 * target, tearing the target down when finished OR on failure (finally).
 *
 * The target launcher and the two capture functions are dependency-injected
 * (default to the real resolveTarget/captureToRrweb/captureToVideo) so the
 * override/sequencing/teardown contract is unit-testable without Puppeteer.
 *
 * @param {object} tourSet
 * @param {string} setDir
 * @param {object} [opts]
 *   @param {object} [opts.cliDefaults]      { format, pace } CLI fallbacks
 *   @param {number} [opts.fps]              fps for mp4-format tours (default 30)
 *   @param {function} [opts.onEntryStart]   (index, total, entry) => void
 *   @param {function} [opts.onProgress]     forwarded to the capture call
 *   @param {function} [opts.resolveTarget]  default: require('./launch').resolveTarget
 *   @param {function} [opts.captureToRrweb] default: require('./index').captureToRrweb
 *   @param {function} [opts.captureToVideo] default: require('./index').captureToVideo
 * @returns {Promise<Array<{ entry: object, outPath: string, isRrweb: boolean, result: object }>>}
 */
async function runTourSet(tourSet, setDir, opts = {}) {
  const {
    cliDefaults = {},
    fps = 30,
    onEntryStart = null,
    onProgress = null,
  } = opts;
  const resolveTargetFn = opts.resolveTarget || require('./launch').resolveTarget;
  const captureToRrwebFn = opts.captureToRrweb || require('./index').captureToRrweb;
  const captureToVideoFn = opts.captureToVideo || require('./index').captureToVideo;

  const { base, stop } = await resolveTargetFn(tourSet.target);
  const results = [];
  try {
    const tours = tourSet.tours || [];
    for (let i = 0; i < tours.length; i++) {
      const entry = tours[i];
      const plan = resolveTourEntry(tourSet, entry, setDir, cliDefaults);
      // The shared target was already launched above; every tour is pointed
      // at it via the pre-served `{ url }` shape so captureToRrweb/Video's
      // own resolveTarget() call is a no-op pass-through (no re-launch).
      plan.tour.target = { url: base };

      if (plan.postersDir) fs.mkdirSync(plan.postersDir, { recursive: true });
      // Poster: one screenshot per step, right after that step's `before`
      // evals + waitFor settle (pre-dwell), so it doesn't perturb rrweb
      // timing. Named `<tour-basename>--<step-id>.png` per the contract.
      const onStepSettled = plan.postersDir
        ? async (page, step, idx) => {
            const stepId = step.id || `step-${idx}`;
            await page.screenshot({ path: path.join(plan.postersDir, `${plan.tourBase}--${stepId}.png`) });
          }
        : undefined;

      if (onEntryStart) onEntryStart(i, tours.length, entry);

      const result = plan.isRrweb
        ? await captureToRrwebFn(plan.tour, plan.outPath, {
            pace: plan.pace, mask: plan.tour.mask, onStepSettled, onProgress,
          })
        : await captureToVideoFn(plan.tour, plan.outPath, {
            fps, pace: plan.pace, onStepSettled, onProgress,
          });

      results.push({ entry, outPath: plan.outPath, isRrweb: plan.isRrweb, result });
    }
  } finally {
    stop();
  }
  return results;
}

module.exports = { loadTourSet, applyDwellOverrides, resolveTourEntry, runTourSet };

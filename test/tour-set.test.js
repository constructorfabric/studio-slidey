'use strict';

// Unit tests for src/tour/tour-set.js — the `slidey capture --tours
// <tour-set.json>` orchestration (mockup-demo-tooling-contract.md §2):
// parsing, path resolution relative to the tour-set file, in-memory
// dwellOverrides (never rewriting the tour file on disk), and the
// runTourSet() sequencing/teardown contract with fake (non-Puppeteer)
// capture functions injected — so this file needs no browser and no network.
//
//   node --test test/tour-set.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadTourSet, applyDwellOverrides, resolveTourEntry, runTourSet } = require('../src/tour/tour-set');

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-tour-set-'));
  try { return fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Async-safe sibling: AWAITS the callback's return value before cleanup. A
// plain try/finally around `fn(dir)` would run rmSync synchronously right
// after getting back the (still-pending) promise, deleting the directory
// before any of the callback's awaited work actually runs.
async function withTmpDirAsync(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-tour-set-'));
  try { return await fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function writeJson(dir, name, obj) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

// ── loadTourSet ──────────────────────────────────────────────────────────

test('loadTourSet parses a valid tour-set and returns its directory', () => {
  withTmpDir((dir) => {
    const setPath = writeJson(dir, 'set.json', {
      target: { url: 'http://example.invalid' },
      tours: [{ tour: 'a.json', out: 'a.rrweb.json' }],
    });
    const { tourSet, setDir } = loadTourSet(setPath);
    assert.equal(tourSet.tours.length, 1);
    assert.equal(setDir, dir);
  });
});

test('loadTourSet throws for a missing file', () => {
  assert.throws(() => loadTourSet('/nonexistent/set.json'), /tour-set not found/);
});

test('loadTourSet throws for invalid JSON', () => {
  withTmpDir((dir) => {
    const p = path.join(dir, 'set.json');
    fs.writeFileSync(p, '{ not json');
    assert.throws(() => loadTourSet(p), /failed to parse tour-set JSON/);
  });
});

test('loadTourSet throws when "tours" is missing or empty', () => {
  withTmpDir((dir) => {
    const p1 = writeJson(dir, 'set1.json', { target: {} });
    assert.throws(() => loadTourSet(p1), /tour-set has no "tours"/);
    const p2 = writeJson(dir, 'set2.json', { target: {}, tours: [] });
    assert.throws(() => loadTourSet(p2), /tour-set has no "tours"/);
  });
});

// ── applyDwellOverrides ──────────────────────────────────────────────────

test('applyDwellOverrides keys by explicit step id', () => {
  const steps = [{ id: 's0', dwellMs: 1000 }, { id: 's1', dwellMs: 2000 }];
  const out = applyDwellOverrides(steps, { s1: 500 });
  assert.equal(out[0].dwellMs, 1000);
  assert.equal(out[1].dwellMs, 500);
});

test('applyDwellOverrides falls back to step-<index> for unnamed steps', () => {
  const steps = [{ dwellMs: 1000 }, { dwellMs: 2000 }];
  const out = applyDwellOverrides(steps, { 'step-1': 250 });
  assert.equal(out[0].dwellMs, 1000);
  assert.equal(out[1].dwellMs, 250);
});

test('applyDwellOverrides never mutates the input steps/array', () => {
  const steps = [{ id: 's0', dwellMs: 1000 }];
  const frozenStep = Object.freeze(steps[0]);
  const out = applyDwellOverrides([frozenStep], { s0: 999 });
  assert.equal(frozenStep.dwellMs, 1000, 'original step object untouched');
  assert.equal(out[0].dwellMs, 999, 'returned a new overridden step');
  assert.notEqual(out, steps, 'returned a new array');
});

test('applyDwellOverrides is a no-op passthrough when there are no overrides', () => {
  const steps = [{ id: 's0', dwellMs: 1000 }];
  assert.equal(applyDwellOverrides(steps, null), steps);
  assert.equal(applyDwellOverrides(steps, undefined), steps);
  assert.equal(applyDwellOverrides(steps, {}).length, 1);
});

// ── resolveTourEntry ─────────────────────────────────────────────────────

test('resolveTourEntry resolves tour/out/postersDir relative to setDir', () => {
  withTmpDir((dir) => {
    fs.mkdirSync(path.join(dir, 'tours'));
    writeJson(dir, 'tours/orientation.json', { steps: [{ id: 's0', dwellMs: 1000 }] });
    const tourSet = { tours: [] };
    const entry = { tour: 'tours/orientation.json', out: 'out/orientation.rrweb.json', postersDir: 'out/posters' };
    const plan = resolveTourEntry(tourSet, entry, dir);
    assert.equal(plan.tourPath, path.join(dir, 'tours', 'orientation.json'));
    assert.equal(plan.outPath, path.join(dir, 'out', 'orientation.rrweb.json'));
    assert.equal(plan.postersDir, path.join(dir, 'out', 'posters'));
    assert.equal(plan.tourBase, 'orientation');
    assert.equal(plan.isRrweb, true, 'inferred rrweb from .rrweb.json extension');
  });
});

test('resolveTourEntry applies dwellOverrides in memory without touching the on-disk tour file', () => {
  withTmpDir((dir) => {
    const tourPath = writeJson(dir, 'tour.json', { steps: [{ id: 's0', dwellMs: 3000 }] });
    const rawBefore = fs.readFileSync(tourPath, 'utf8');
    const plan = resolveTourEntry({}, { tour: 'tour.json', out: 'out.rrweb.json', dwellOverrides: { s0: 1500 } }, dir);
    assert.equal(plan.tour.steps[0].dwellMs, 1500);
    const rawAfter = fs.readFileSync(tourPath, 'utf8');
    assert.equal(rawAfter, rawBefore, 'tour file on disk untouched');
  });
});

test('resolveTourEntry: shared tour-set viewport/deviceScaleFactor override the tour file\'s own', () => {
  withTmpDir((dir) => {
    writeJson(dir, 'tour.json', { viewport: { width: 800, height: 600 }, deviceScaleFactor: 2, steps: [] });
    const tourSet = { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 };
    const plan = resolveTourEntry(tourSet, { tour: 'tour.json', out: 'out.rrweb.json' }, dir);
    assert.deepEqual(plan.tour.viewport, { width: 1600, height: 900 });
    assert.equal(plan.tour.deviceScaleFactor, 1);
  });
});

test('resolveTourEntry: format resolution — entry.format wins, then cliDefaults.format, then out extension', () => {
  withTmpDir((dir) => {
    writeJson(dir, 'tour.json', { steps: [] });
    const explicit = resolveTourEntry({}, { tour: 'tour.json', out: 'out.mp4', format: 'rrweb' }, dir);
    assert.equal(explicit.isRrweb, true);

    const cliDefault = resolveTourEntry({}, { tour: 'tour.json', out: 'out.mp4' }, dir, { format: 'rrweb' });
    assert.equal(cliDefault.isRrweb, true);

    const byExt = resolveTourEntry({}, { tour: 'tour.json', out: 'out.rrweb.json' }, dir);
    assert.equal(byExt.isRrweb, true);

    const mp4Default = resolveTourEntry({}, { tour: 'tour.json', out: 'out.mp4' }, dir);
    assert.equal(mp4Default.isRrweb, false);
  });
});

test('resolveTourEntry: pace — entry.pace wins over cliDefaults.pace', () => {
  withTmpDir((dir) => {
    writeJson(dir, 'tour.json', { steps: [] });
    const withEntryPace = resolveTourEntry({}, { tour: 'tour.json', out: 'out.rrweb.json', pace: 2 }, dir, { pace: 0 });
    assert.equal(withEntryPace.pace, 2);
    const withCliPace = resolveTourEntry({}, { tour: 'tour.json', out: 'out.rrweb.json' }, dir, { pace: 0 });
    assert.equal(withCliPace.pace, 0);
  });
});

test('resolveTourEntry throws when the entry is missing "tour" or "out"', () => {
  withTmpDir((dir) => {
    assert.throws(() => resolveTourEntry({}, { out: 'x.json' }, dir), /missing "tour" or "out"/);
    assert.throws(() => resolveTourEntry({}, { tour: 'x.json' }, dir), /missing "tour" or "out"/);
  });
});

test('resolveTourEntry throws when the referenced tour file does not exist', () => {
  withTmpDir((dir) => {
    assert.throws(() => resolveTourEntry({}, { tour: 'nope.json', out: 'out.rrweb.json' }, dir), /tour not found/);
  });
});

// ── runTourSet: sequencing / target reuse / teardown, with fake captures ──

test('runTourSet launches the shared target ONCE and runs every tour against it, stopping once at the end', async () => {
  await withTmpDirAsync(async (dir) => {
    writeJson(dir, 'a.json', { steps: [{ id: 's0', dwellMs: 100 }] });
    writeJson(dir, 'b.json', { steps: [{ id: 's0', dwellMs: 100 }] });
    const tourSet = {
      target: { launch: 'irrelevant', addr: '127.0.0.1:9' },
      tours: [
        { tour: 'a.json', out: 'a.rrweb.json' },
        { tour: 'b.json', out: 'b.rrweb.json' },
      ],
    };
    let resolveCalls = 0;
    let stopCalls = 0;
    const seenTargets = [];
    const resolveTargetFake = async () => {
      resolveCalls++;
      return { base: 'http://127.0.0.1:9999', stop: () => { stopCalls++; }, log: () => '' };
    };
    const captureToRrwebFake = async (tour, outPath) => {
      seenTargets.push(tour.target);
      return { rrweb: outPath, sidecar: null, eventCount: 2, chapters: [], durationMs: 100 };
    };
    const results = await runTourSet(tourSet, dir, {
      resolveTarget: resolveTargetFake,
      captureToRrweb: captureToRrwebFake,
      captureToVideo: async () => { throw new Error('should not be called (both tours are rrweb by extension)'); },
    });
    assert.equal(resolveCalls, 1, 'target launched exactly once');
    assert.equal(stopCalls, 1, 'target torn down exactly once');
    assert.equal(results.length, 2);
    assert.deepEqual(seenTargets, [{ url: 'http://127.0.0.1:9999' }, { url: 'http://127.0.0.1:9999' }],
      'every tour points at the shared pre-served target');
  });
});

test('runTourSet tears the shared target down on failure too', async () => {
  await withTmpDirAsync(async (dir) => {
    writeJson(dir, 'a.json', { steps: [] });
    const tourSet = { target: { url: 'http://x' }, tours: [{ tour: 'a.json', out: 'a.rrweb.json' }] };
    let stopCalls = 0;
    await assert.rejects(
      runTourSet(tourSet, dir, {
        resolveTarget: async () => ({ base: 'http://x', stop: () => { stopCalls++; }, log: () => '' }),
        captureToRrweb: async () => { throw new Error('capture blew up'); },
      }),
      /capture blew up/,
    );
    assert.equal(stopCalls, 1, 'teardown still ran after a mid-loop failure');
  });
});

test('runTourSet wires a postersDir onStepSettled hook that screenshots each settled step', async () => {
  await withTmpDirAsync(async (dir) => {
    writeJson(dir, 'a.json', { steps: [{ id: 'welcome' }, { id: 'go' }] });
    const tourSet = {
      target: { url: 'http://x' },
      tours: [{ tour: 'a.json', out: 'a.rrweb.json', postersDir: 'posters' }],
    };
    const shots = [];
    await runTourSet(tourSet, dir, {
      resolveTarget: async () => ({ base: 'http://x', stop: () => {}, log: () => '' }),
      captureToRrweb: async (tour, outPath, opts) => {
        // Simulate the capture driver invoking onStepSettled per step.
        const fakePage = { screenshot: async ({ path: p }) => shots.push(p) };
        for (let i = 0; i < tour.steps.length; i++) {
          await opts.onStepSettled(fakePage, tour.steps[i], i);
        }
        return { rrweb: outPath, sidecar: null, eventCount: 2, chapters: [], durationMs: 100 };
      },
    });
    assert.equal(shots.length, 2);
    assert.equal(shots[0], path.join(dir, 'posters', 'a--welcome.png'));
    assert.equal(shots[1], path.join(dir, 'posters', 'a--go.png'));
    assert.ok(fs.existsSync(path.join(dir, 'posters')), 'postersDir was mkdir -p\'d');
  });
});

test('runTourSet dispatches mp4-format tours through captureToVideo', async () => {
  await withTmpDirAsync(async (dir) => {
    writeJson(dir, 'a.json', { steps: [] });
    const tourSet = { target: { url: 'http://x' }, tours: [{ tour: 'a.json', out: 'a.mp4' }] };
    let videoCalled = false;
    const results = await runTourSet(tourSet, dir, {
      resolveTarget: async () => ({ base: 'http://x', stop: () => {}, log: () => '' }),
      captureToVideo: async (tour, outPath) => { videoCalled = true; return { mp4: outPath, sidecar: null, frameCount: 1, chapters: [] }; },
      captureToRrweb: async () => { throw new Error('should not be called for an .mp4 out'); },
    });
    assert.equal(videoCalled, true);
    assert.equal(results[0].isRrweb, false);
  });
});

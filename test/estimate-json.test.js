'use strict';

// Tests for `slidey <spec> --estimate --json` (mockup-demo-tooling-contract.md
// §1) — a single JSON document on stdout, per-cue audio estimates, and
// scene/spec-level `flags`. Drives the real CLI as a subprocess (src/index.js
// is a script with top-level side effects, not a requireable module), so
// these assertions are on ACTUAL stdout byte-content, matching how a
// consuming tool (demo-doctor) would parse it.
//
//   node --test test/estimate-json.test.js

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'src', 'index.js');

function writeSpec(dir, name, spec) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(spec, null, 2));
  return p;
}

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-estimate-json-'));
  try { return fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function runEstimateJson(specPath) {
  const stdout = execFileSync(process.execPath, [CLI, specPath, '--estimate', '--json'], {
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

test('--estimate --json prints ONLY one JSON document on stdout, nothing else', () => {
  withTmpDir((dir) => {
    const specPath = writeSpec(dir, 'deck.slidey.json', {
      meta: { title: 'test deck' },
      scenes: [
        { type: 'title', title: 'Intro' },
        { type: 'narrative', narration: 'A short line.', hold: 999 },
      ],
    });
    const stdout = execFileSync(process.execPath, [CLI, specPath, '--estimate', '--json'], { encoding: 'utf8' });
    // The whole of stdout must parse as exactly one JSON document (a trailing
    // newline is fine; anything else on stdout would break JSON.parse here).
    const doc = JSON.parse(stdout);
    assert.equal(doc.spec, specPath);
    assert.ok(Array.isArray(doc.scenes));
    assert.ok(Array.isArray(doc.flags));
  });
});

test('exits 0 when estimation succeeds, regardless of flags found', () => {
  withTmpDir((dir) => {
    // A narration text long enough to overrun a tiny "hold" — should still
    // exit 0 (estimation itself succeeded) with the overrun reflected in flags.
    const specPath = writeSpec(dir, 'deck.slidey.json', {
      meta: { title: 'overrun deck' },
      scenes: [
        {
          type: 'narrative',
          narration: 'This narration has more than enough words to overrun a one frame hold by a wide margin for sure.',
          hold: 1,
        },
      ],
    });
    // execFileSync throws on non-zero exit — this call not throwing IS the assertion.
    const doc = runEstimateJson(specPath);
    assert.ok(doc.scenes[0].flags.length > 0, 'expected an overrun flag');
    assert.match(doc.scenes[0].flags[0], /overrun/);
  });
});

test('per-cue audioSec for a video scene with time-keyed narration cues', () => {
  withTmpDir((dir) => {
    const specPath = writeSpec(dir, 'deck.slidey.json', {
      meta: { title: 'video deck' },
      scenes: [
        {
          type: 'video',
          duration: 20, // explicit seconds — no ffprobe needed
          narration: [
            { chapter: 'first', text: 'One two three four five.' },
            { chapter: 'second', text: 'Six seven eight nine ten eleven twelve.' },
          ],
        },
      ],
    });
    const doc = runEstimateJson(specPath);
    const scene = doc.scenes[0];
    assert.equal(scene.narration.length, 2);
    assert.equal(scene.narration[0].chapter, 'first');
    assert.equal(scene.narration[0].words, 5);
    assert.ok(scene.narration[0].audioSec > 0);
    assert.equal(scene.narration[1].chapter, 'second');
    assert.equal(scene.narration[1].words, 7);
    assert.ok(scene.narration[1].audioSec > 0);
  });
});

test('a scene with no narration has an empty narration array and no flags', () => {
  withTmpDir((dir) => {
    const specPath = writeSpec(dir, 'deck.slidey.json', {
      meta: { title: 'silent deck' },
      scenes: [{ type: 'title', title: 'Just a title' }],
    });
    const doc = runEstimateJson(specPath);
    assert.deepEqual(doc.scenes[0].narration, []);
    assert.deepEqual(doc.scenes[0].flags, []);
  });
});

test('a comfortably-timed scene produces zero flags at scene and top level', () => {
  withTmpDir((dir) => {
    const specPath = writeSpec(dir, 'deck.slidey.json', {
      meta: { title: 'comfortable deck' },
      scenes: [{ type: 'narrative', narration: 'Hi.', hold: 100000 }],
    });
    const doc = runEstimateJson(specPath);
    assert.deepEqual(doc.scenes[0].flags, []);
    assert.deepEqual(doc.flags, []);
  });
});

test('human-readable --estimate output is unchanged (no --json)', () => {
  withTmpDir((dir) => {
    const specPath = writeSpec(dir, 'deck.slidey.json', {
      meta: { title: 'human deck' },
      scenes: [{ type: 'narrative', narration: 'Hello there.', hold: 200 }],
    });
    const stdout = execFileSync(process.execPath, [CLI, specPath, '--estimate'], { encoding: 'utf8' });
    assert.match(stdout, /scenes · est\./);
    assert.match(stdout, /comfortable/);
    // Never valid JSON — this is the human table.
    assert.throws(() => JSON.parse(stdout));
  });
});

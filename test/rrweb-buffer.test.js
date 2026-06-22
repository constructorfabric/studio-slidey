'use strict';

// Unit tests for web/rrweb/buffer.js — the app-agnostic rrweb rolling-buffer
// recorder (generalized from kitsoki's session-capture.ts). rrweb itself is
// injected as a stub `record`, so these run with no DOM and no real rrweb.
//
//   node --test test/rrweb-buffer.test.js

const test = require('node:test');
const assert = require('node:assert');

const META = 4;
const FULL = 2;
const INCR = 3;

// Wire a recorder to a captured emit fn so the test can feed synthetic events.
async function makeRecorder(opts = {}) {
  const { createSessionCapture } = await import('../web/rrweb/buffer.js');
  let emit = null;
  const cap = createSessionCapture({
    record: (o) => {
      emit = o.emit;
      return () => {};
    },
    ...opts,
  });
  cap.start();
  return { cap, emit: (e) => emit(e) };
}

test('snapshot re-prepends the original Meta after trimming drops it', async () => {
  const { cap, emit } = await makeRecorder({ retainCheckpoints: 2 });
  emit({ type: META, data: { href: 'x', width: 800, height: 600 }, timestamp: 0 });
  emit({ type: FULL, data: {}, timestamp: 0 }); // checkpoint 1
  emit({ type: INCR, data: {}, timestamp: 100 });
  emit({ type: FULL, data: {}, timestamp: 1000 }); // checkpoint 2
  emit({ type: INCR, data: {}, timestamp: 1100 });
  emit({ type: FULL, data: {}, timestamp: 2000 }); // checkpoint 3 -> drops Meta + cp1

  const snap = cap.snapshot();
  // Trimming retained only cp2, incr, cp3; snapshot must re-prepend the Meta so
  // the Replayer can size its iframe (the bug session-capture.ts guards against).
  assert.strictEqual(snap[0].type, META, 'first event must be the Meta');
  assert.strictEqual(snap.length, 4, 'Meta + cp2 + incr + cp3');
  const metas = snap.filter((e) => e.type === META).length;
  assert.strictEqual(metas, 1, 'Meta is not duplicated');
});

test('snapshot does not duplicate a Meta still present in the buffer', async () => {
  const { cap, emit } = await makeRecorder({ retainCheckpoints: 5 });
  emit({ type: META, data: { width: 800, height: 600 }, timestamp: 0 });
  emit({ type: FULL, data: {}, timestamp: 0 });
  emit({ type: INCR, data: {}, timestamp: 50 });

  const snap = cap.snapshot();
  assert.strictEqual(snap.filter((e) => e.type === META).length, 1);
  assert.strictEqual(snap[0].type, META);
  assert.strictEqual(snap.length, 3);
});

test('start is idempotent and reset clears state', async () => {
  const { createSessionCapture } = await import('../web/rrweb/buffer.js');
  let starts = 0;
  let emit = null;
  const cap = createSessionCapture({
    record: (o) => {
      starts++;
      emit = o.emit;
      return () => {};
    },
  });
  cap.start();
  cap.start(); // no-op while active
  assert.strictEqual(starts, 1, 'second start is a no-op');
  emit({ type: META, data: {}, timestamp: 0 });
  emit({ type: FULL, data: {}, timestamp: 0 });
  assert.strictEqual(cap.length, 2);
  cap.reset();
  assert.strictEqual(cap.length, 0);
  assert.strictEqual(cap.isRecording, false);
});

test('maskAllText maps to a maskTextSelector and inlineStylesheet defaults on', async () => {
  const { createSessionCapture } = await import('../web/rrweb/buffer.js');
  let seen = null;
  const cap = createSessionCapture({
    maskAllText: true,
    record: (o) => {
      seen = o;
      return () => {};
    },
  });
  cap.start();
  assert.strictEqual(seen.maskTextSelector, '*', 'maskAllText -> maskTextSelector "*"');
  assert.strictEqual(seen.maskAllInputs, true);
  assert.strictEqual(seen.inlineStylesheet, true);
  assert.strictEqual(seen.blockSelector, 'input[type="password"]');
});

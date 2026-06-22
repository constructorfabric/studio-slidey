'use strict';

// Unit tests for src/rrweb-format.js — the *.rrweb.json envelope + the
// converter that turns in-log `slidey.chapter` custom events into the
// producer-agnostic Chapter[] (source_ref.kind:"rrweb").
//
//   node --test test/rrweb-format.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  rrwebDuration,
  rrwebViewport,
  chaptersFromEvents,
  buildEnvelope,
  writeEnvelope,
  loadRrweb,
  CHAPTER_TAG,
} = require('../src/rrweb-format');

const t0 = 1000;
function sampleEvents() {
  return [
    { type: 4, data: { href: 'x', width: 1600, height: 900 }, timestamp: t0 },
    { type: 2, data: {}, timestamp: t0 },
    { type: 5, data: { tag: CHAPTER_TAG, payload: { id: 'a', label: 'A', specPath: 'f.yaml', line: 3 } }, timestamp: t0 },
    { type: 3, data: {}, timestamp: t0 + 500 },
    { type: 5, data: { tag: CHAPTER_TAG, payload: { id: 'b', label: 'B' } }, timestamp: t0 + 2000 },
    { type: 3, data: {}, timestamp: t0 + 5000 },
  ];
}

test('rrwebDuration is last-minus-first, 0 for short logs', () => {
  assert.strictEqual(rrwebDuration(sampleEvents()), 5000);
  assert.strictEqual(rrwebDuration([{ timestamp: 5 }]), 0);
  assert.strictEqual(rrwebDuration([]), 0);
});

test('rrwebViewport reads the Meta event', () => {
  assert.deepStrictEqual(rrwebViewport(sampleEvents()), { width: 1600, height: 900 });
  assert.deepStrictEqual(rrwebViewport([], { width: 100, height: 200 }), { width: 100, height: 200 });
});

test('chaptersFromEvents builds [start,end) windows relative to log start', () => {
  const ch = chaptersFromEvents(sampleEvents(), { specPath: 'default.yaml' });
  assert.strictEqual(ch.length, 2);
  assert.deepStrictEqual(
    ch[0],
    {
      index: 0,
      id: 'a',
      label: 'A',
      start_ms: 0,
      end_ms: 2000,
      source_ref: { kind: 'rrweb', spec_path: 'f.yaml', step_id: 'a', line: 3 },
    },
  );
  // Second marker: no specPath in payload -> falls back to opts.specPath; window
  // closes at the log end (5000).
  assert.deepStrictEqual(
    ch[1],
    {
      index: 1,
      id: 'b',
      label: 'B',
      start_ms: 2000,
      end_ms: 5000,
      source_ref: { kind: 'rrweb', spec_path: 'default.yaml', step_id: 'b' },
    },
  );
});

test('chaptersFromEvents returns [] when there are no markers', () => {
  const noMarks = sampleEvents().filter((e) => e.type !== 5);
  assert.deepStrictEqual(chaptersFromEvents(noMarks), []);
});

test('buildEnvelope + writeEnvelope + loadRrweb round-trips', () => {
  const env = buildEnvelope(sampleEvents(), { viewport: { deviceScaleFactor: 2 } });
  assert.strictEqual(env.schemaVersion, 1);
  assert.strictEqual(env.durationMs, 5000);
  assert.strictEqual(env.viewport.width, 1600);
  assert.strictEqual(env.viewport.deviceScaleFactor, 2);

  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-rrweb-')), 'x.rrweb.json');
  writeEnvelope(tmp, env);
  const loaded = loadRrweb(tmp);
  assert.strictEqual(loaded.events.length, 6);
  assert.strictEqual(loaded.durationMs, 5000);
  assert.deepStrictEqual(loaded.viewport, env.viewport);
});

test('browser chapter extractor (web/rrweb/chapters.js) matches the node fields', async () => {
  const { chaptersFromEvents: browserExtract } = await import('../web/rrweb/chapters.js');
  const node = chaptersFromEvents(sampleEvents());
  const web = browserExtract(sampleEvents());
  assert.strictEqual(web.length, node.length);
  // The player only needs id/label/start_ms/end_ms — assert those agree.
  web.forEach((w, i) => {
    assert.strictEqual(w.id, node[i].id);
    assert.strictEqual(w.label, node[i].label);
    assert.strictEqual(w.start_ms, node[i].start_ms);
    assert.strictEqual(w.end_ms, node[i].end_ms);
  });
});

test('loadRrweb accepts a bare event array (kitsoki bug-report logs)', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-rrweb-')), 'bare.json');
  fs.writeFileSync(tmp, JSON.stringify(sampleEvents()));
  const loaded = loadRrweb(tmp);
  assert.strictEqual(loaded.events.length, 6);
  assert.strictEqual(loaded.durationMs, 5000);
  assert.deepStrictEqual(loaded.viewport, { width: 1600, height: 900 });
});

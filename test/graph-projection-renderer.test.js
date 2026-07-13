'use strict';

const test = require('node:test');
const assert = require('node:assert');

const GP = require('../web/graph-projection/renderer.js');

const GRID = { laneWidth: 200, laneOffsetX: 100, rowHeight: 100, rowOffsetY: 50 };

test('nodePosition derives x/y from lane/row on the grid', () => {
  assert.deepEqual(GP.nodePosition({ lane: 0, row: 0 }, GRID), { x: 100, y: 50 });
  assert.deepEqual(GP.nodePosition({ lane: 2, row: 3 }, GRID), { x: 500, y: 350 });
});

test('nodePosition prefers an explicit x/y pin over lane/row', () => {
  assert.deepEqual(GP.nodePosition({ lane: 5, row: 5, x: 12, y: 34 }, GRID), { x: 12, y: 34 });
});

test('resolveGrid layers projection grid under an opts override', () => {
  const projection = { grid: { laneWidth: 234, laneOffsetX: 117, rowHeight: 136, rowOffsetY: 68 } };
  assert.deepEqual(GP.resolveGrid(projection, {}), projection.grid);
  assert.deepEqual(GP.resolveGrid(projection, { grid: { laneWidth: 300 } }), {
    laneWidth: 300, laneOffsetX: 117, rowHeight: 136, rowOffsetY: 68,
  });
  assert.deepEqual(GP.resolveGrid(null, {}), GP.DEFAULT_GRID);
});

test('statusOf resolves done/fail/plan/dim precedence, and the done:"all" sentinel', () => {
  assert.equal(GP.statusOf({ done: ['a'] }, 'a'), 'done');
  assert.equal(GP.statusOf({ fail: ['a'], done: ['b'] }, 'a'), 'fail');
  assert.equal(GP.statusOf({ plan: ['a'] }, 'a'), 'plan');
  assert.equal(GP.statusOf({ dim: ['a'] }, 'a'), 'dim');
  assert.equal(GP.statusOf({}, 'a'), '');
  assert.equal(GP.statusOf({ done: 'all' }, 'anything'), 'done');
  // precedence: done beats fail beats plan beats dim
  assert.equal(GP.statusOf({ done: ['a'], fail: ['a'], plan: ['a'], dim: ['a'] }, 'a'), 'done');
});

test('resolveNodeColors layers palette-by-type under a status override, node fields win outright', () => {
  const palette = { gate: { fill: '#111', stroke: '#222', txt: '#333' } };
  assert.deepEqual(
    GP.resolveNodeColors({ type: 'gate' }, '', palette, GP.DEFAULT_STATUS_OVERRIDES),
    { fill: '#111', stroke: '#222', txt: '#333', dashed: false },
  );
  const done = GP.resolveNodeColors({ type: 'gate' }, 'done', palette, GP.DEFAULT_STATUS_OVERRIDES);
  assert.equal(done.fill, GP.DEFAULT_STATUS_OVERRIDES.done.fill);
  assert.equal(done.stroke, GP.DEFAULT_STATUS_OVERRIDES.done.stroke);
  assert.equal(done.txt, '#333', 'txt is not overridden by status');
  const planned = GP.resolveNodeColors({ type: 'gate' }, 'plan', palette, GP.DEFAULT_STATUS_OVERRIDES);
  assert.equal(planned.dashed, true);
  const explicit = GP.resolveNodeColors({ type: 'gate', fill: '#fff' }, '', palette, GP.DEFAULT_STATUS_OVERRIDES);
  assert.equal(explicit.fill, '#fff', 'an explicit node.fill wins over the type palette');
});

test('edgePath picks the forward/vertical/backward branch the mockup used', () => {
  const a = { x: 0, y: 0, w: 100, h: 50 };
  const forward = { x: 200, y: 0, w: 100, h: 50 };
  const vertical = { x: 10, y: 200, w: 100, h: 50 };
  const backward = { x: -300, y: 0, w: 100, h: 50 };
  assert.match(GP.edgePath(a, forward), /^M50,0 C/, 'forward branch anchors at a\'s right edge');
  assert.match(GP.edgePath(a, vertical), /^M0,25 C/, 'near-vertical branch anchors at a\'s bottom edge');
  assert.match(GP.edgePath(a, backward), /^M-50,0 C/, 'backward branch anchors at a\'s left edge');
});

test('labelFontSize and subFontSize reproduce the mockup fit formula', () => {
  assert.equal(GP.labelFontSize(160, 10).toFixed(2), (Math.min(15, (160 - 14) / (10 * 0.56))).toFixed(2));
  assert.equal(GP.subFontSize(160, 20).toFixed(2), (Math.min(9.5, (160 - 10) / (20 * 0.5))).toFixed(2));
  // wide boxes clamp at the max, not scale unbounded
  assert.equal(GP.labelFontSize(2000, 4), 15);
  assert.equal(GP.subFontSize(2000, 4), 9.5);
});

test('resolveState prefers a declared state, falls back to a bare graph id, else throws', () => {
  const projection = {
    graphs: [{ id: 'g1' }],
    states: { s1: { graph: 'g1', status: { done: ['a'] } } },
  };
  assert.deepEqual(GP.resolveState(projection, 's1'), { graphId: 'g1', status: { done: ['a'] } });
  assert.deepEqual(GP.resolveState(projection, 'g1'), { graphId: 'g1', status: {} });
  assert.deepEqual(GP.resolveState(projection, 'g1', { status: { done: ['x'] } }), { graphId: 'g1', status: { done: ['x'] } });
  assert.throws(() => GP.resolveState(projection, 'nope'), /unknown state\/graph id/);
});

test('module exposes both CJS exports and a browser-global shape', () => {
  assert.equal(typeof GP.renderGraphProjection, 'function');
  assert.equal(typeof globalThis.renderGraphProjection, 'function', 'attaches to the global for classic-<script> consumers');
  assert.equal(globalThis.SlideyGraphProjection, GP, 'the global namespace is the same object as the CJS export');
});

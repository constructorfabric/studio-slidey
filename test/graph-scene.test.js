'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Ajv = require('ajv');

const { SCHEMA } = require('../src/schema');
const TIMING = require('../src/timing');

const graphScene = {
  type: 'graph',
  title: 'Dependency path',
  layout: 'preset',
  nodes: [
    { id: 'runtime', label: 'Runtime', x: 0, y: 0 },
    { id: 'proof', label: 'Proof', sub: 'validated', x: 240, y: 0 },
  ],
  edges: [
    { id: 'runtime-proof', from: 'runtime', to: 'proof', label: 'produces', labelMarginX: 12, labelMarginY: -24 },
  ],
  path: [
    'runtime',
    { node: 'proof', edge: 'runtime-proof', note: 'Follow the proof path' },
  ],
  caption: 'Every reveal centers the next node.',
};

test('schema accepts a graph scene with focus path entries', () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(SCHEMA);
  const ok = validate({
    scenes: [{
      ...graphScene,
      layoutTemplate: 'lane-grid',
      grid: { columns: 2, rows: 1, x: 0, y: 0, width: 240, height: 1 },
      nodes: [
        { id: 'runtime', label: 'Runtime', col: 1, row: 1 },
        { id: 'proof', label: 'Proof', sub: 'validated', col: 2, row: 1 },
      ],
      focusMode: 'neighborhood',
      focusPadding: 160,
      floatMotion: true,
      floatAmplitude: 8,
      gravity: 0.4,
      componentSpacing: 160,
      nestingFactor: 1.05,
      numIter: 1000,
    }],
  });
  assert.equal(ok, true, JSON.stringify(validate.errors, null, 2));
});

test('stepsForScene graph mirrors the renderer reveal order', async () => {
  const { stepsForScene } = await import('../web/sceneSteps.mjs');
  assert.deepEqual(stepsForScene(graphScene), [
    'graph_title',
    'graph_frame',
    'graph_focus_0',
    'graph_focus_1',
    'graph_caption',
  ]);

  assert.deepEqual(stepsForScene({ type: 'graph', nodes: [{ id: 'a' }], focus: ['a'] }), [
    'graph_frame',
    'graph_focus_0',
  ]);
});

test('store graph focus steps reveal the frame and reset between scenes', async () => {
  const { store } = await import('../web/store.js');
  store.showScene('graph', graphScene);
  assert.equal(store.graphFocus, -1);

  store.setState('graph_focus_1');
  assert.equal(store.graphFocus, 1);
  assert.equal(store.isRevealed('graph-frame'), true);

  store.setState('graph_caption');
  assert.equal(store.graphFocus, -1);
  assert.equal(store.isRevealed('graph-caption'), true);

  store.showScene('graph', { type: 'graph', nodes: [{ id: 'other' }] });
  assert.equal(store.graphFocus, -1);
});

test('graph timing estimate counts focus path, caption, hold, and gap', () => {
  assert.equal(
    TIMING.estimateScene(graphScene),
    TIMING.graph_title
      + TIMING.graph_frame
      + TIMING.graph_focus_0
      + TIMING.graph_focus_1
      + TIMING.graph_caption
      + TIMING.graph_hold
      + TIMING.inter_scene,
  );
});

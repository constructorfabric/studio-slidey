'use strict';

// Tests for src/timing.js — the frame-estimation table that must stay in
// lock-step with the per-scene render() logic. estimateScene/estimateBoundaries
// are pure (no I/O) for every non-`video` scene type, so they're exercised here
// directly. Each case mirrors the matching branch in estimateScene().
//
//   node --test test/timing.test.js

const test = require('node:test');
const assert = require('node:assert');

const TIMING = require('../src/timing');
const { estimateScene, estimateBoundaries } = TIMING;

test('exports the TIMING table plus the two estimators', () => {
  assert.equal(typeof TIMING.inter_scene, 'number');
  assert.equal(typeof estimateScene, 'function');
  assert.equal(typeof estimateBoundaries, 'function');
});

test('title scene is a flat title_card with no inter-scene gap', () => {
  assert.equal(estimateScene({ type: 'title' }), TIMING.title_card);
});

test('narrative sums eyebrow + body + hold + gap, and adds lede only when present', () => {
  const base = estimateScene({ type: 'narrative' });
  assert.equal(base, TIMING.narrative_eyebrow + TIMING.narrative_body
    + TIMING.narrative_hold + TIMING.inter_scene);

  const withLede = estimateScene({ type: 'narrative', lede: 'hi' });
  assert.equal(withLede, base + TIMING.narrative_lede);
});

test('custom scene.hold overrides the table hold', () => {
  const custom = estimateScene({ type: 'narrative', hold: 999 });
  assert.equal(custom, TIMING.narrative_eyebrow + TIMING.narrative_body
    + 999 + TIMING.inter_scene);
});

test('diagram counts one frame block per panel and adds caption when present', () => {
  const twoPanels = estimateScene({ type: 'diagram', panels: [{}, {}] });
  assert.equal(twoPanels, TIMING.diagram_title
    + TIMING.diagram_panel_0 + TIMING.diagram_panel_1
    + TIMING.diagram_hold + TIMING.inter_scene);

  const withCaption = estimateScene({ type: 'diagram', panels: [{}], caption: 'c' });
  assert.equal(withCaption, TIMING.diagram_title + TIMING.diagram_panel_0
    + TIMING.diagram_caption + TIMING.diagram_hold + TIMING.inter_scene);
});

test('mermaid title frame is only counted when a title is present', () => {
  const noTitle = estimateScene({ type: 'mermaid' });
  assert.equal(noTitle, TIMING.mermaid_frame + TIMING.mermaid_hold + TIMING.inter_scene);

  const withTitle = estimateScene({ type: 'mermaid', title: 'T' });
  assert.equal(withTitle, noTitle + TIMING.mermaid_title);
});

test('trace counts one block per turn', () => {
  const f = estimateScene({ type: 'trace', turns: [{}, {}, {}] });
  assert.equal(f, TIMING.trace_title
    + TIMING.trace_turn_0 + TIMING.trace_turn_1 + TIMING.trace_turn_2
    + TIMING.trace_hold + TIMING.inter_scene);
});

test('transcript dwells on every card but the last, which uses the scene hold', () => {
  const three = estimateScene({ type: 'transcript', cards: [{}, {}, {}] });
  assert.equal(three, 2 * TIMING.transcript_card + TIMING.transcript_hold + TIMING.inter_scene);

  // A single card has no per-card dwell — just the final hold.
  const one = estimateScene({ type: 'transcript', cards: [{}] });
  assert.equal(one, TIMING.transcript_hold + TIMING.inter_scene);

  // cardHold overrides the per-card dwell.
  const custom = estimateScene({ type: 'transcript', cards: [{}, {}], cardHold: 50 });
  assert.equal(custom, 50 + TIMING.transcript_hold + TIMING.inter_scene);
});

test('cards two-column variants reveal exactly two items regardless of card count', () => {
  for (const variant of ['before-after', 'versus', 'point-counterpoint', 'pros-cons', 'qa']) {
    const f = estimateScene({ type: 'cards', variant, cards: [{}, {}, {}, {}] });
    assert.equal(f, TIMING.cards_item_0 + TIMING.cards_item_1
      + TIMING.cards_hold + TIMING.inter_scene, `variant ${variant}`);
  }
});

test('cards grid variant reveals one item per card', () => {
  const f = estimateScene({ type: 'cards', cards: [{}, {}, {}] });
  assert.equal(f, TIMING.cards_item_0 + TIMING.cards_item_1 + TIMING.cards_item_2
    + TIMING.cards_hold + TIMING.inter_scene);
});

// Regression: the estimator's per-item reveal cost MUST match what the renderer
// actually holds (renderer.js setState: `TIMING[stepName] ?? 20`). A grid cards
// scene with more items than the table has `cards_item_N` keys (0..5) used to
// drift — the renderer held the generic fallback (20 frames) for cards_item_6+,
// while the estimator counted 30. estimateScene must stay in lock-step with the
// real reveal sequence, so narration timing for >6-item grids stays exact.
test('cards grid item reveals match the renderer per-item hold beyond the table', () => {
  const eight = [{}, {}, {}, {}, {}, {}, {}, {}];
  const f = estimateScene({ type: 'cards', cards: eight });
  // Mirror the renderer: one cards_item_<i> setState per card, each holding
  // TIMING['cards_item_'+i] ?? 20 frames (the renderer's generic fallback).
  let reveal = 0;
  for (let i = 0; i < eight.length; i++) reveal += TIMING[`cards_item_${i}`] ?? 20;
  assert.equal(f, reveal + TIMING.cards_hold + TIMING.inter_scene);
});

test('personas estimates title, item, caption, hold, and gap like the renderer', () => {
  const scene = {
    type: 'personas',
    variant: 'use-cases',
    title: 'Who does what',
    cases: [{}, {}, {}],
    caption: 'one workflow',
    hold: 555,
  };
  assert.equal(estimateScene(scene), 20 + 3 * 20 + 20 + 555 + TIMING.inter_scene);
  assert.equal(estimateScene(scene, { noGaps: true }), 555);
});

test('table clamps revealed rows to MAX_ROWS (8)', () => {
  const rows = Array.from({ length: 20 }, (_, i) => i);
  const f = estimateScene({ type: 'table', rows });
  let expected = TIMING.table_title + TIMING.table_header;
  for (let i = 0; i < 8; i++) expected += TIMING[`table_row_${i}`];
  expected += TIMING.table_hold + TIMING.inter_scene;
  assert.equal(f, expected);
});

test('chart pie/quadrant variants reveal a single series; bar reveals one per series', () => {
  const pie = estimateScene({ type: 'chart', variant: 'pie', series: [{}, {}, {}] });
  assert.equal(pie, TIMING.chart_title + TIMING.chart_frame + TIMING.chart_series_0
    + TIMING.chart_hold + TIMING.inter_scene);

  const bar = estimateScene({ type: 'chart', variant: 'bar', series: [{}, {}] });
  assert.equal(bar, TIMING.chart_title + TIMING.chart_frame
    + TIMING.chart_series_0 + TIMING.chart_series_1
    + TIMING.chart_hold + TIMING.inter_scene);
});

test('book reveals at most three items', () => {
  const f = estimateScene({ type: 'book', books: [{}, {}, {}, {}, {}] });
  assert.equal(f, TIMING.book_item_0 + TIMING.book_item_1 + TIMING.book_item_2
    + TIMING.book_hold + TIMING.inter_scene);
});

test('cta has no inter-scene gap (it is the closer)', () => {
  const f = estimateScene({ type: 'cta' });
  assert.equal(f, TIMING.cta_wordmark + TIMING.cta_tagline + TIMING.cta_url + TIMING.cta_hold);
});

test('unknown scene types fall back to 100 frames', () => {
  assert.equal(estimateScene({ type: 'does-not-exist' }), 100);
});

test('noGaps mode drops reveal frames, keeping only the hold', () => {
  const full = estimateScene({ type: 'narrative' });
  const noGaps = estimateScene({ type: 'narrative' }, { noGaps: true });
  assert.equal(noGaps, TIMING.narrative_hold);
  assert.ok(noGaps < full, 'no-gaps estimate must be shorter than the full estimate');
});

test('estimateBoundaries lays scenes end-to-end with cumulative start frames', () => {
  const spec = { scenes: [
    { type: 'title' },
    { type: 'narrative', narration: 'hello' },
    { type: 'cta' },
  ] };
  const b = estimateBoundaries(spec);

  assert.equal(b.length, 3);
  assert.equal(b[0].startFrame, 0);
  assert.equal(b[0].durationFrames, estimateScene(spec.scenes[0]));
  // Each scene starts where the previous one ended.
  assert.equal(b[1].startFrame, b[0].durationFrames);
  assert.equal(b[2].startFrame, b[0].durationFrames + b[1].durationFrames);
  assert.equal(b[1].narration, 'hello');
  assert.equal(b[0].narration, null);
  assert.equal(b[2].type, 'cta');
});

test('estimateBoundaries honours a selected-scene filter', () => {
  const spec = { scenes: [
    { type: 'title' },
    { type: 'narrative' },
    { type: 'cta' },
  ] };
  const b = estimateBoundaries(spec, new Set([0, 2]));

  assert.equal(b.length, 2);
  assert.deepEqual(b.map(s => s.sceneIndex), [0, 2]);
  // Filtered scenes pack together — scene 2 starts right after scene 0.
  assert.equal(b[0].startFrame, 0);
  assert.equal(b[1].startFrame, b[0].durationFrames);
});

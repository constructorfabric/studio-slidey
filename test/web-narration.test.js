'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('viewer narration extracts whole-slide and timed video cue text', async () => {
  const { speechTextForScene, timedNarrationCues } = await import('../web/narration.mjs');
  assert.equal(speechTextForScene({ narration: 'Hello world' }), 'Hello world');
  const cues = timedNarrationCues({
    narration: [
      { chapter: 'intro', text: 'Start here' },
      { at: 4.5, text: 'Then this' },
    ],
  }, [{ id: 'intro', start_ms: 1250 }]);
  assert.deepEqual(cues.map(c => [c.at, c.text]), [
    [1.25, 'Start here'],
    [4.5, 'Then this'],
  ]);
});

test('viewer narration aligns step cues to the reveal they describe (qa without an intro sentence)', async () => {
  const { stepNarrationCues } = await import('../web/narration.mjs');
  // No sentence "for the title": the old proportional spread put the question
  // text on the title step and the answer on the question step — every cue
  // read the NEXT reveal's content. Content alignment must keep them together.
  const cues = stepNarrationCues({
    type: 'cards',
    variant: 'qa',
    title: 'Second question',
    question: 'What software makes money?',
    answer: ['Software that meets a real market need.'],
    narration: 'And what software makes money? Software that meets a real market need. Great software nobody needs stays a hobby.',
  }, ['cards_title', 'cards_item_0', 'cards_item_1']);

  assert.equal(cues[0], '');
  assert.equal(cues[1], 'And what software makes money?');
  assert.match(cues[2], /^Software that meets a real market need\./);
});

test('viewer narration keeps one-sentence-per-card decks aligned one-to-one', async () => {
  const { stepNarrationCues } = await import('../web/narration.mjs');
  const cues = stepNarrationCues({
    type: 'cards',
    variant: 'grid',
    title: 'Components',
    cards: [
      { label: 'Gears', sub: 'application platform' },
      { label: 'Frontx', sub: 'plugin extensibility framework' },
    ],
    narration: 'Two components under the hood. Gears is the application platform. Frontx is the plugin extensibility framework.',
  }, ['cards_title', 'cards_item_0', 'cards_item_1']);

  assert.deepEqual(cues, [
    'Two components under the hood.',
    'Gears is the application platform.',
    'Frontx is the plugin extensibility framework.',
  ]);
});

test('viewer narration falls back to proportional spread when steps expose no content', async () => {
  const { stepNarrationCues } = await import('../web/narration.mjs');
  const cues = stepNarrationCues({
    type: 'chart',
    variant: 'quadrant',
    narration: 'First point. Second point.',
  }, ['chart_title', 'chart_frame', 'chart_series_0', 'chart_caption']);

  assert.deepEqual(cues.filter(Boolean), ['First point.', 'Second point.']);
  assert.equal(cues[0], 'First point.');
});

test('viewer narration maps graph focus steps to graph path notes', async () => {
  const { stepNarrationCues } = await import('../web/narration.mjs');
  const cues = stepNarrationCues({
    type: 'graph',
    title: 'Value graph',
    caption: 'Inspect the proof.',
    narration: 'The graph is the network. Hard gates come first.',
    nodes: [{ id: 'req', label: 'FIPS compliance', sub: 'hard gate' }],
    path: [{ node: 'req', note: 'FIPS is a hard gate.' }],
  }, ['graph_title', 'graph_frame', 'graph_focus_0', 'graph_caption']);

  assert.deepEqual(cues, [
    'The graph is the network.',
    'Hard gates come first.',
    'FIPS is a hard gate.',
    'Inspect the proof.',
  ]);
});

test('viewer narration can merge skipped graph title cue into first visible graph frame cue', async () => {
  const { stepNarrationCues } = await import('../web/narration.mjs');
  const cues = stepNarrationCues({
    type: 'graph',
    title: 'Value graph',
    narration: 'The title sets context. The graph is visible now.',
    nodes: [{ id: 'proof', label: 'Proof' }],
    path: [{ node: 'proof', note: 'Proof gets inspected.' }],
  }, ['graph_title', 'graph_frame', 'graph_focus_0']);

  const firstVisibleCue = cues.slice(0, 1).concat(cues[1]).filter(Boolean).join('\n');
  assert.equal(firstVisibleCue, 'The title sets context.\nThe graph is visible now.');
});

test('viewer narration can leave graph captions visual-only', async () => {
  const { stepNarrationCues } = await import('../web/narration.mjs');
  const cues = stepNarrationCues({
    type: 'graph',
    title: 'Value graph',
    caption: 'Visible footer only.',
    narrateCaption: false,
    nodes: [{ id: 'proof', label: 'Proof' }],
    path: [{ node: 'proof', note: 'Proof gets inspected.' }],
  }, ['graph_title', 'graph_frame', 'graph_focus_0', 'graph_caption']);

  assert.deepEqual(cues, [
    'Value graph',
    '',
    'Proof gets inspected.',
    '',
  ]);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  alignCuesToScenes,
  applyNarrationOperations,
  buildTimelineMapping,
  cleanCueText,
  makeNarrationOperations,
  parseTimestamp,
  parseVtt,
} = require('../src/teams-vtt');

test('parseTimestamp accepts WebVTT and plain-second values', () => {
  assert.equal(parseTimestamp('00:01.500'), 1.5);
  assert.equal(parseTimestamp('01:02:03.250'), 3723.25);
  assert.equal(parseTimestamp('12.75'), 12.75);
});

test('parseVtt extracts timing, speaker, and cleaned text from Teams-style cues', () => {
  const cues = parseVtt(`
WEBVTT

1
00:00:01.000 --> 00:00:03.500
<v Brad Smith>Hello &amp; welcome.</v>

2
00:00:04.000 --> 00:00:05.000
Teammate: Great.
`);

  assert.deepEqual(cues, [
    { start: 1, end: 3.5, speaker: 'Brad Smith', text: 'Hello & welcome.' },
    { start: 4, end: 5, speaker: 'Teammate', text: 'Great.' },
  ]);
});

test('cleanCueText strips WebVTT markup and preserves a voice label', () => {
  assert.deepEqual(
    cleanCueText('<v Brad Smith><c.highlight>This is synced.</c></v>'),
    { speaker: 'Brad Smith', text: 'This is synced.' },
  );
});

test('buildTimelineMapping uses anchors to correct linear drift', () => {
  const mapping = buildTimelineMapping([
    { deck: 0, transcript: 10 },
    { deck: 100, transcript: 115 },
  ]);
  assert.equal(mapping.intercept, 10);
  assert.equal(mapping.slope, 1.05);
});

test('alignCuesToScenes maps cues to estimated scene windows and filters speakers', () => {
  const spec = {
    scenes: [
      { type: 'title' },
      { type: 'narrative', title: 'A', narration: 'old' },
      { type: 'cta' },
    ],
  };
  const cues = parseVtt(`
WEBVTT

00:00:00.000 --> 00:00:01.000
<v Other>Before.</v>

00:00:03.200 --> 00:00:04.000
<v Brad Smith>Natural narration one.</v>

00:00:04.000 --> 00:00:05.000
<v Brad Smith>Natural narration two.</v>
`);

  const result = alignCuesToScenes(spec, cues, { speaker: 'Brad' });
  const scene = result.scenes.find((candidate) => candidate.sceneIndex === 1);
  assert.equal(scene.text, 'Natural narration one. Natural narration two.');

  const operations = makeNarrationOperations(spec, result.scenes);
  assert.deepEqual(operations, [{
    op: 'replace',
    path: '/scenes/1/narration',
    value: 'Natural narration one. Natural narration two.',
  }]);

  const updated = applyNarrationOperations(spec, operations);
  assert.equal(updated.scenes[1].narration, 'Natural narration one. Natural narration two.');
  assert.equal(spec.scenes[1].narration, 'old');
});

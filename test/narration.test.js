'use strict';

// Tests for applyPronunciations in src/narration.js — the phonetic-respelling
// pass that fixes Edge TTS mispronunciations from the meta.narration
// { term: respelling } dictionary. Pure string transform, no I/O.
//
//   node --test

const test = require('node:test');
const assert = require('node:assert');
const {
  applyPronunciations,
  edgeTtsAvailable,
  generateOne,
  getAudioDuration,
  hasNarrationText,
} = require('../src/narration');

const DICT = {
  'Anthropic': 'an throp ik',
  'SDLC': 'S D L C',
  'kitsoki': 'kit so key',
  'API key': 'A P I key',
  'API': 'A P I',
  '.NET': 'dot net',
  'C++': 'C plus plus',
};

test('replaces a whole-word term', () => {
  assert.equal(applyPronunciations('Anthropic builds it.', DICT), 'an throp ik builds it.');
});

test('matching is case-insensitive', () => {
  assert.equal(applyPronunciations('anthropic and ANTHROPIC', DICT), 'an throp ik and an throp ik');
});

test('does not match inside a larger word', () => {
  // "anthropics" has a trailing word char, so the term must not fire.
  assert.equal(applyPronunciations('Therapeutic anthropics aside.', DICT), 'Therapeutic anthropics aside.');
});

test('longer terms win over their sub-words', () => {
  assert.equal(applyPronunciations('the API key and any API', DICT), 'the A P I key and any A P I');
});

test('terms with non-word edge chars still match', () => {
  assert.equal(applyPronunciations('ship .NET and C++ today', DICT), 'ship dot net and C plus plus today');
});

test('inserted respellings are not re-scanned', () => {
  // "A P I" contains standalone letters; none should be further rewritten.
  const dict = { 'API': 'A P I', 'A': 'AY' };
  assert.equal(applyPronunciations('the API', dict), 'the A P I');
});

test('replacement values are inserted verbatim (no $ interpretation)', () => {
  // String.replace treats $& / $1 specially in a replacement string; the
  // function form sidesteps that, so a literal "$" survives unchanged.
  assert.equal(applyPronunciations('cost', { cost: '$5 each' }), '$5 each');
});

test('passthrough when no dictionary or empty text', () => {
  assert.equal(applyPronunciations('plain text', null), 'plain text');
  assert.equal(applyPronunciations('plain text', {}), 'plain text');
  assert.equal(applyPronunciations('', DICT), '');
});

test('edgeTtsAvailable returns a boolean and never throws on a missing binary', () => {
  // The preflight must be total: whether or not edge-tts is installed, it
  // resolves to a plain boolean so the caller can report a clean error instead
  // of crashing. We can't assert the value (host-dependent), only the contract:
  // no throw, boolean result.
  const orig = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-path-for-slidey-test';
    assert.strictEqual(edgeTtsAvailable(), false);
  } finally {
    process.env.PATH = orig;
  }
  assert.strictEqual(typeof edgeTtsAvailable(), 'boolean');
});

test('generateOne explains how to fix a missing edge-tts binary', () => {
  const orig = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-path-for-slidey-test';
    assert.throws(
      () => generateOne('hello', '/tmp/slidey-missing-edge.mp3', 'en-AU-NatashaNeural'),
      /edge-tts failed.*edge-tts not found on PATH[\s\S]*pipx install edge-tts[\s\S]*slidey doctor --voice en-AU-NatashaNeural/
    );
  } finally {
    process.env.PATH = orig;
  }
});

test('getAudioDuration explains how to fix a missing ffprobe binary', () => {
  const orig = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-path-for-slidey-test';
    assert.throws(
      () => getAudioDuration('/tmp/slidey-missing-audio.mp3'),
      /ffprobe failed[\s\S]*ffprobe not found on PATH[\s\S]*brew install ffmpeg[\s\S]*slidey doctor/
    );
  } finally {
    process.env.PATH = orig;
  }
});

test('hasNarrationText detects scene narration and timed cues', () => {
  assert.strictEqual(hasNarrationText([{ narration: 'hello' }]), true);
  assert.strictEqual(hasNarrationText([{ narrationCues: [{ text: 'hello' }] }]), true);
  assert.strictEqual(hasNarrationText([{ narration: '' }, { narrationCues: [{ text: '' }] }]), false);
  assert.strictEqual(hasNarrationText([{ title: 'silent' }]), false);
});

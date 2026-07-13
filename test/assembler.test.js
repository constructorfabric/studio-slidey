'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const { buildNarrationFilter, framesToVideo } = require('../src/assembler');

test('framesToVideo explains how to fix a missing ffmpeg binary', () => {
  const orig = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-path-for-slidey-test';
    assert.throws(
      () => framesToVideo(os.tmpdir(), path.join(os.tmpdir(), 'slidey-missing-ffmpeg.mp4')),
      /ffmpeg not found on PATH[\s\S]*brew install ffmpeg[\s\S]*slidey doctor/
    );
  } finally {
    process.env.PATH = orig;
  }
});

test('narration mix does not attenuate large decks before loudness normalization', () => {
  const filter = buildNarrationFilter([
    { startSeconds: 0 },
    { startSeconds: 1.25 },
    { startSeconds: 10 },
  ]);

  assert.match(filter, /amix=inputs=3:duration=longest:dropout_transition=0:normalize=0/);
  assert.match(filter, /loudnorm=I=-16:TP=-1\.5:LRA=11/);
  assert.match(filter, /aresample=48000\[aout\]/);
});

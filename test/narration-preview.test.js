'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { mkdtemp } = require('../src/temp-path');
const {
  handleNarrationPreviewRequest,
  synthesizeNarrationPreview,
} = require('../src/narration-preview');

test('narration preview uses Edge TTS settings, pronunciations, and cache', () => {
  const dir = mkdtemp('slidey-narration-preview-');
  try {
    const calls = [];
    const synthesize = (text, audioPath, voice, rate) => {
      calls.push({ text, voice, rate });
      fs.writeFileSync(audioPath, Buffer.from(`mp3:${text}:${voice}:${rate}`));
    };
    const payload = {
      text: 'Slidey ships an API key.',
      meta: {
        voice: 'en-US-JennyNeural',
        rate: '-5%',
        pronunciations: {
          Slidey: 'slide ee',
          'API key': 'A P I key',
        },
      },
    };

    const first = synthesizeNarrationPreview(payload, { cacheDir: dir, checkAvailable: false, synthesize });
    const second = synthesizeNarrationPreview(payload, { cacheDir: dir, checkAvailable: false, synthesize });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body.mime, 'audio/mpeg');
    assert.equal(Buffer.from(first.body.audioBase64, 'base64').toString(), 'mp3:slide ee ships an A P I key.:en-US-JennyNeural:-5%');
    assert.deepEqual(calls, [{
      text: 'slide ee ships an A P I key.',
      voice: 'en-US-JennyNeural',
      rate: '-5%',
    }]);
    assert.equal(first.body.cacheKey, second.body.cacheKey);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('narration preview rejects invalid and empty requests', () => {
  assert.equal(handleNarrationPreviewRequest({ body: '{nope' }).status, 400);
  assert.equal(handleNarrationPreviewRequest({ body: JSON.stringify({ text: '' }) }).status, 400);
});

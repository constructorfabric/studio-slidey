'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_VOICE,
  applyPronunciations,
  edgeTtsAvailable,
  synthesizeOne,
} = require('./narration');

const MAX_TEXT_CHARS = 12000;
const MIME_MP3 = 'audio/mpeg';

function safeRate(value) {
  const raw = String(value || '').trim();
  return raw || '+0%';
}

function normalizeMeta(meta) {
  const src = meta && typeof meta === 'object' ? meta : {};
  return {
    voice: String(src.voice || DEFAULT_VOICE).trim() || DEFAULT_VOICE,
    rate: safeRate(src.rate),
    pronunciations: src.pronunciations && typeof src.pronunciations === 'object'
      ? src.pronunciations
      : null,
  };
}

function cacheKeyFor({ spokenText, voice, rate }) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ spokenText, voice, rate }))
    .digest('hex')
    .slice(0, 32);
}

function synthesizeNarrationPreview(payload, opts = {}) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const text = String(body.text || '').trim();
  if (!text) return { status: 400, body: { error: 'narration text is empty' } };
  if (text.length > MAX_TEXT_CHARS) {
    return { status: 413, body: { error: `narration text is too long (${text.length}/${MAX_TEXT_CHARS} characters)` } };
  }

  const meta = normalizeMeta(body.meta);
  const spokenText = applyPronunciations(text, meta.pronunciations).trim();
  if (!spokenText) return { status: 400, body: { error: 'narration text is empty after pronunciation replacements' } };

  if (opts.checkAvailable !== false && !edgeTtsAvailable()) {
    return {
      status: 503,
      body: {
        error: 'edge-tts is not available on PATH. Install it with: pipx install edge-tts',
        voice: meta.voice,
        rate: meta.rate,
      },
    };
  }

  const cacheDir = opts.cacheDir || path.join(os.tmpdir(), 'slidey-narration-preview');
  fs.mkdirSync(cacheDir, { recursive: true });
  const key = cacheKeyFor({ spokenText, voice: meta.voice, rate: meta.rate });
  const audioPath = path.join(cacheDir, `${key}.mp3`);

  if (!fs.existsSync(audioPath)) {
    const tmpPath = path.join(cacheDir, `${key}.${process.pid}.${Date.now()}.tmp`);
    try {
      const synthesize = opts.synthesize || synthesizeOne;
      synthesize(spokenText, tmpPath, meta.voice, meta.rate);
      fs.renameSync(tmpPath, audioPath);
    } catch (err) {
      try { fs.rmSync(tmpPath, { force: true }); } catch (_) {}
      return {
        status: 500,
        body: {
          error: String(err && err.message ? err.message : err),
          voice: meta.voice,
          rate: meta.rate,
        },
      };
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      mime: MIME_MP3,
      audioBase64: fs.readFileSync(audioPath).toString('base64'),
      voice: meta.voice,
      rate: meta.rate,
      cacheKey: key,
    },
  };
}

function handleNarrationPreviewRequest(request, opts = {}) {
  let payload;
  try {
    payload = JSON.parse(request && request.body ? request.body : '{}');
  } catch (err) {
    return { status: 400, body: { error: `invalid JSON body: ${err.message}` } };
  }
  return synthesizeNarrationPreview(payload, opts);
}

module.exports = {
  MAX_TEXT_CHARS,
  MIME_MP3,
  handleNarrationPreviewRequest,
  normalizeMeta,
  synthesizeNarrationPreview,
};

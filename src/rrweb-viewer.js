'use strict';

const fs = require('fs');
const path = require('path');
const { inlineChildDeckFiles } = require('./collections');

const RRWEB_NAME = /(?:^rrweb|\.rrweb)\.json$/i;

function isRrwebFile(filePath) {
  return RRWEB_NAME.test(path.basename(String(filePath || '')));
}

function rrwebEventsFromPayload(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.events)) return raw.events;
  return null;
}

function hasReplayableEvents(raw) {
  const events = rrwebEventsFromPayload(raw);
  return !!(events && events.length >= 2);
}

function looksLikeRrwebPayload(raw) {
  const events = rrwebEventsFromPayload(raw);
  if (!events || events.length < 2) return false;
  return events.some((event) => event && event.type === 2 && event.data)
    && events.some((event) => event && Number.isFinite(event.timestamp));
}

function shouldTreatAsRrweb(filePath, raw) {
  return isRrwebFile(filePath) ? hasReplayableEvents(raw) : looksLikeRrwebPayload(raw);
}

function titleFromPath(filePath) {
  return path.basename(filePath)
    .replace(RRWEB_NAME, '')
    .replace(/\.json$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim() || 'rrweb replay';
}

function stemFromPath(filePath) {
  const base = path.basename(filePath)
    .replace(/\.rrweb\.json$/i, '')
    .replace(/\.json$/i, '');
  return path.join(path.dirname(filePath), base || 'rrweb');
}

function siblingAudio(filePath) {
  const stem = stemFromPath(filePath);
  for (const ext of ['.mp3', '.m4a', '.wav', '.ogg']) {
    const candidate = `${stem}${ext}`;
    if (fs.existsSync(candidate)) return path.basename(candidate);
  }
  return null;
}

function assertRrwebSource(filePath, raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))) {
  if (!shouldTreatAsRrweb(filePath, raw)) throw new Error(`not an rrweb event log: ${filePath}`);
  return raw;
}

function rrwebSpecForFile(filePath, raw) {
  assertRrwebSource(filePath, raw);
  const title = titleFromPath(filePath);
  const scene = {
    type: 'video',
    mode: 'fullscreen',
    rrweb: path.basename(filePath),
    chapters: 'auto',
    cinematic: false,
    eyebrow: 'rrweb',
    title,
    caption: 'DOM session replay',
  };
  const audio = siblingAudio(filePath);
  if (audio) scene.audio = audio;
  return {
    meta: {
      title,
      mode: 'pitch',
      generatedFrom: path.basename(filePath),
    },
    scenes: [scene],
  };
}

function readSpecOrRrwebInfo(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (isRrwebFile(filePath)) {
    return { spec: rrwebSpecForFile(filePath, raw), rrweb: true };
  }
  if (!looksLikeRrwebPayload(raw)) {
    // Inline any `library.decks[].src`/`file`/`path` child-deck FILE references
    // (a master deck composing sibling `.slidey.json` files) before anything
    // downstream (validate/resolveDeckSpec/the viewer tree) ever sees the spec.
    const { spec, errors } = inlineChildDeckFiles(raw, { specPath: filePath });
    return { spec, rrweb: false, libraryFileErrors: errors };
  }
  return { spec: rrwebSpecForFile(filePath, raw), rrweb: true };
}

function readSpecOrRrweb(filePath) {
  return readSpecOrRrwebInfo(filePath).spec;
}

function isRrwebSourceFile(filePath) {
  try {
    return readSpecOrRrwebInfo(filePath).rrweb;
  } catch (_) {
    return false;
  }
}

module.exports = {
  isRrwebFile,
  isRrwebSourceFile,
  readSpecOrRrwebInfo,
  rrwebSpecForFile,
  readSpecOrRrweb,
};

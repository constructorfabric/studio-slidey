'use strict';

const { estimateBoundaries } = require('./timing');

function parseTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value || '').trim();
  if (!raw) throw new Error('empty timestamp');

  if (/^[+-]?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);

  const normalized = raw.replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`invalid timestamp: ${value}`);
  }

  const secondsPart = parts.pop();
  const secMatch = secondsPart.match(/^(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!secMatch) throw new Error(`invalid timestamp: ${value}`);

  const seconds = Number(secMatch[1]) + Number(`0.${(secMatch[2] || '').padEnd(3, '0')}`);
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) {
    throw new Error(`invalid timestamp: ${value}`);
  }

  return hours * 3600 + minutes * 60 + seconds;
}

function formatSeconds(seconds) {
  const sign = seconds < 0 ? '-' : '';
  let remaining = Math.abs(seconds);
  const hours = Math.floor(remaining / 3600);
  remaining -= hours * 3600;
  const minutes = Math.floor(remaining / 60);
  remaining -= minutes * 60;
  const secs = Math.floor(remaining);
  const millis = Math.round((remaining - secs) * 1000);
  const h = hours ? `${hours}:` : '';
  return `${sign}${h}${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanCueText(raw) {
  let text = decodeEntities(raw).replace(/\r/g, '').trim();
  let speaker = null;

  text = text.replace(/<v\s+([^>]+)>/gi, (_, name) => {
    if (!speaker) speaker = name.trim();
    return '';
  });
  text = text.replace(/<\/v>/gi, '');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/\s+/g, ' ').trim();

  const label = text.match(/^([^:]{2,80}):\s+(.+)$/);
  if (!speaker && label && /[A-Za-z]/.test(label[1])) {
    speaker = label[1].trim();
    text = label[2].trim();
  }

  return { speaker, text };
}

function parseVtt(content) {
  const source = String(content || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = source.split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (/^WEBVTT(?:\s|$)/i.test(lines[0])) continue;
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/i.test(lines[0])) continue;

    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;

    const [startRaw, endAndSettings] = lines[timingIndex].split('-->');
    const endRaw = String(endAndSettings || '').trim().split(/\s+/)[0];
    const textLines = lines.slice(timingIndex + 1);
    const cleaned = cleanCueText(textLines.join(' '));
    if (!cleaned.text) continue;

    cues.push({
      start: parseTimestamp(startRaw),
      end: parseTimestamp(endRaw),
      speaker: cleaned.speaker,
      text: cleaned.text,
    });
  }

  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

function normalizeSpeaker(value) {
  return String(value || '').trim().toLowerCase();
}

function speakerMatches(actual, expected) {
  if (!expected) return true;
  const a = normalizeSpeaker(actual);
  const e = normalizeSpeaker(expected);
  return a === e || a.includes(e);
}

function buildTimelineMapping(anchors = [], opts = {}) {
  const scale = opts.scale == null ? 1 : Number(opts.scale);
  const offset = opts.offset == null ? 0 : Number(opts.offset);
  if (!anchors.length) return { intercept: offset, slope: scale };

  if (anchors.length === 1) {
    return {
      intercept: anchors[0].transcript - scale * anchors[0].deck,
      slope: scale,
    };
  }

  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const anchor of anchors) {
    sumX += anchor.deck;
    sumY += anchor.transcript;
    sumXX += anchor.deck * anchor.deck;
    sumXY += anchor.deck * anchor.transcript;
  }

  const n = anchors.length;
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-9) throw new Error('timeline anchors must use distinct deck times');

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  if (!Number.isFinite(slope) || slope <= 0) throw new Error('timeline anchors produced a non-positive scale');
  return { intercept, slope };
}

function sceneWindows(spec, fps = 30) {
  return estimateBoundaries(spec, null, {}).map((boundary) => ({
    sceneIndex: boundary.sceneIndex,
    type: boundary.type,
    title: spec.scenes[boundary.sceneIndex] && spec.scenes[boundary.sceneIndex].title || null,
    start: boundary.startFrame / fps,
    end: (boundary.startFrame + boundary.durationFrames) / fps,
    duration: boundary.durationFrames / fps,
  }));
}

function findSceneForDeckTime(windows, deckTime) {
  if (!Number.isFinite(deckTime)) return null;
  return windows.find((scene) => deckTime >= scene.start && deckTime < scene.end) || null;
}

function joinNarration(parts) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function alignCuesToScenes(spec, cues, opts = {}) {
  const fps = opts.fps || 30;
  const windows = sceneWindows(spec, fps);
  const mapping = buildTimelineMapping(opts.anchors || [], opts);
  const byScene = new Map(windows.map((scene) => [scene.sceneIndex, {
    ...scene,
    cues: [],
    text: '',
    words: 0,
  }]));
  const unmatched = [];

  for (const cue of cues) {
    if (!speakerMatches(cue.speaker, opts.speaker)) continue;
    const midpoint = (cue.start + cue.end) / 2;
    const deckTime = (midpoint - mapping.intercept) / mapping.slope;
    const scene = findSceneForDeckTime(windows, deckTime);
    if (!scene) {
      unmatched.push({ ...cue, deckTime });
      continue;
    }
    byScene.get(scene.sceneIndex).cues.push({ ...cue, deckTime });
  }

  const scenes = Array.from(byScene.values()).map((scene) => {
    const text = joinNarration(scene.cues.map((cue) => cue.text));
    return {
      ...scene,
      text,
      words: text ? text.split(/\s+/).length : 0,
    };
  });

  return { mapping, scenes, unmatched };
}

function makeNarrationOperations(spec, alignedScenes, opts = {}) {
  const minWords = opts.minWords == null ? 1 : Number(opts.minWords);
  const operations = [];

  alignedScenes.forEach((scene) => {
    if (!scene.text || scene.words < minWords) return;
    const current = spec.scenes[scene.sceneIndex] && spec.scenes[scene.sceneIndex].narration;
    operations.push({
      op: current === undefined ? 'add' : 'replace',
      path: `/scenes/${scene.sceneIndex}/narration`,
      value: scene.text,
    });
  });

  return operations;
}

function applyNarrationOperations(spec, operations) {
  const next = JSON.parse(JSON.stringify(spec));
  for (const op of operations) {
    const match = op.path.match(/^\/scenes\/(\d+)\/narration$/);
    if (!match) throw new Error(`unsupported operation path: ${op.path}`);
    next.scenes[Number(match[1])].narration = op.value;
  }
  return next;
}

module.exports = {
  alignCuesToScenes,
  applyNarrationOperations,
  buildTimelineMapping,
  cleanCueText,
  formatSeconds,
  makeNarrationOperations,
  parseTimestamp,
  parseVtt,
  sceneWindows,
};

/**
 * SLIDEY — Video helpers (ffmpeg)
 *
 * Turns an embedded demo MP4 into PNG frames that drop straight into slidey's
 * global frame sequence. A single ffmpeg pass trims / retimes / scales the
 * source and (optionally) composites timed deck-styled overlay PNGs, writing
 * `frame-NNNNNN.png` at the scene's starting frame number — so no second copy
 * pass and the global frame counter stays exact.
 *
 * Used by src/scenes/video.js.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

// Deck background (web/styles/template.css #0d1117) — fills letterbox bars so an
// embedded demo sits on the same backdrop as every other scene.
const DECK_BG = '0x0D1117';

/** Probe a media file's duration in seconds (0 on failure). */
function probeDuration(file) {
  const r = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ], { encoding: 'utf8' });
  if (r.status !== 0) return 0;
  return parseFloat((r.stdout || '').trim()) || 0;
}

/**
 * The trimmed, sped-up on-screen duration (seconds) of a video scene — what the
 * frame count and narration budget are derived from.
 */
function effectiveDuration(srcDuration, scene) {
  const start = Math.max(0, scene.start || 0);
  const end   = scene.end != null ? scene.end : srcDuration;
  const span  = Math.max(0, (end || srcDuration) - start);
  const speed = scene.speed && scene.speed > 0 ? scene.speed : 1;
  return span / speed;
}

/** Frame count a video scene contributes at `fps` (deterministic estimate). */
function videoFrameCount(srcDuration, scene, fps) {
  return Math.max(1, Math.round(effectiveDuration(srcDuration, scene) * fps));
}

/** Build the scale/pad (or crop) filter that fits the source into W×H. */
function fitFilter(width, height, fit) {
  if (fit === 'cover') {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  }
  // contain (default): letterbox onto the deck background.
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${DECK_BG}`;
}

/** Count frame-*.png in `dir` whose number is >= startNumber. */
function countFramesFrom(dir, startNumber) {
  let max = startNumber - 1;
  for (const f of fs.readdirSync(dir)) {
    const m = /^frame-(\d+)\.png$/.exec(f);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n >= startNumber && n > max) max = n;
  }
  return max - startNumber + 1;
}

/**
 * Extract an MP4 into `framesDir` as frame-NNNNNN.png starting at `startNumber`,
 * fitted to width×height, with optional timed overlays composited on top.
 *
 * @param {object} o
 *   src, framesDir, startNumber, fps, width, height
 *   fit          'contain' | 'cover'
 *   start, end   trim window (seconds); speed playback multiplier
 *   inset        optional { x, y, w, h } — place the (fitted) video in a sub-rect
 *                of a width×height deck-bg canvas (embedded mode)
 *   overlays     [{ png, startSec, endSec, x=0, y=0 }] composited with enable=between(t,…)
 * @returns {{ frameCount: number }}
 */
function extractFrames(o) {
  const { src, framesDir, startNumber, fps, width, height } = o;
  const fit   = o.fit || 'contain';
  const start = Math.max(0, o.start || 0);
  const speed = o.speed && o.speed > 0 ? o.speed : 1;
  const overlays = o.overlays || [];

  const inputs = ['-y', '-loglevel', 'error'];
  if (start > 0) inputs.push('-ss', String(start));
  if (o.end != null) inputs.push('-to', String(o.end));
  inputs.push('-i', src);
  for (const ov of overlays) inputs.push('-loop', '1', '-i', ov.png);

  // Base chain: retime → fps → fit. In embedded mode the video is scaled to the
  // inset rect and padded onto the full deck-bg canvas at (x,y) — a single pad,
  // no separate (infinite) color source, which the image2 muxer + looped overlay
  // inputs choke on.
  const retime = speed !== 1 ? `setpts=(1/${speed})*PTS,` : '';
  let graph;
  let lastLabel = 'base';
  if (o.inset) {
    const { x, y, w, h } = o.inset;
    graph =
      `[0:v]${retime}fps=${fps},scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:${x}:${y}:color=${DECK_BG}[base]`;
  } else {
    graph = `[0:v]${retime}fps=${fps},${fitFilter(width, height, fit)}[base]`;
  }

  // Chain timed overlays. Each overlay input is 1-indexed after the video (0).
  overlays.forEach((ov, i) => {
    const inLabel = `${i + 1}:v`;
    const outLabel = i === overlays.length - 1 ? 'out' : `ov${i}`;
    const enable = (ov.startSec != null || ov.endSec != null)
      ? `:enable='between(t,${ov.startSec || 0},${ov.endSec != null ? ov.endSec : 1e9})'`
      : '';
    graph += `;[${lastLabel}][${inLabel}]overlay=${ov.x || 0}:${ov.y || 0}${enable}[${outLabel}]`;
    lastLabel = outLabel;
  });

  const map = overlays.length ? lastLabel : 'base';
  const args = [
    ...inputs,
    '-filter_complex', graph,
    '-map', `[${map}]`,
    '-start_number', String(startNumber),
    '-frames:v', String(o.frameCount || ''),  // bound output if known
    path.join(framesDir, 'frame-%06d.png'),
  ].filter(Boolean);

  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`ffmpeg video extract failed (status ${r.status}):\n${(r.stderr || '').slice(0, 600)}`);
  }
  return { frameCount: countFramesFrom(framesDir, startNumber) };
}

/**
 * Extract a single poster frame from `src` at `atSec`, fitted to width×height on
 * the deck background, written to `outPng`. Used by the PNG/PDF exporters so a
 * video scene reviews as a representative still rather than a blank page.
 */
function extractPoster(o) {
  const { src, outPng, width, height } = o;
  const atSec = o.atSec || 0;
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  const args = [
    '-y', '-loglevel', 'error',
    '-ss', String(atSec), '-i', src,
    '-frames:v', '1',
    '-vf', fitFilter(width, height, o.fit || 'contain'),
    outPng,
  ];
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`ffmpeg poster extract failed (status ${r.status}):\n${(r.stderr || '').slice(0, 400)}`);
  }
  return outPng;
}

/** Load a chapter sidecar (`<mp4>.chapters.json`); [] if absent/unreadable. */
function loadSidecar(mp4Path) {
  const p = `${mp4Path}.chapters.json`;
  if (!fs.existsSync(p)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

module.exports = {
  DECK_BG,
  loadSidecar,
  probeDuration,
  effectiveDuration,
  videoFrameCount,
  fitFilter,
  extractFrames,
  extractPoster,
};

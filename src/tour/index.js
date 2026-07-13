/**
 * SLIDEY — Tour capture, end to end
 *
 * Ties the freeze-frame capture driver to slidey's existing ffmpeg assembler and
 * the chapter sidecar writer. Produces the same two artifacts kitsoki's harness
 * does today — `<name>.mp4` + `<name>.mp4.chapters.json` — but from an
 * app-agnostic tour spec.
 *
 * Used by:
 *   - the `slidey capture <tour.json> <out.mp4>` CLI (standalone demo), and
 *   - the `video` deck scene's `capture:` field (capture-then-embed).
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { captureTour } = require('./capture');
const { captureTourRrweb } = require('./rrweb-capture');
const { writeChapters } = require('./chapters');
const { buildEnvelope, writeEnvelope } = require('../rrweb-format');
const { framesToVideo } = require('../assembler');
const { registerAdapter, resolveAdapter } = require('./adapters');
const { mkdtemp } = require('../temp-path');

/**
 * Capture a tour spec to an MP4 + chapter sidecar.
 *
 * @param {object} tour       Parsed tour spec (see capture.js).
 * @param {string} outMp4     Destination .mp4 path.
 * @param {object} opts       { fps=30, pace, framesDir?, keepFrames?, onProgress?, onStepSettled?, adapter? }
 *                            `adapter` is an adapter OBJECT (or registered name);
 *                            absent → the tour's `adapter` field → `dom` default.
 *                            `onStepSettled` — see capture.js; used by the
 *                            tour-set runner's poster capture.
 * @returns {Promise<{ mp4, sidecar, frameCount, chapters }>}
 */
async function captureToVideo(tour, outMp4, opts = {}) {
  const fps = opts.fps || 30;
  const ownFrames = !opts.framesDir;
  const framesDir = opts.framesDir
    ? path.resolve(opts.framesDir)
    : mkdtemp('slidey-tour-');

  try {
    const { frameCount, chapters } = await captureTour(tour, framesDir, {
      fps, pace: opts.pace, onProgress: opts.onProgress, onStepSettled: opts.onStepSettled, adapter: opts.adapter,
    });
    if (frameCount === 0) throw new Error('tour produced no frames (no steps?)');

    fs.mkdirSync(path.dirname(path.resolve(outMp4)), { recursive: true });
    framesToVideo(framesDir, path.resolve(outMp4), fps, null);
    const sidecar = writeChapters(path.resolve(outMp4), chapters);
    return { mp4: path.resolve(outMp4), sidecar, frameCount, chapters };
  } finally {
    if (ownFrames && !opts.keepFrames) fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

/**
 * Capture a tour spec to an rrweb event log (`<base>.rrweb.json`) + chapter
 * sidecar (`<base>.rrweb.json.chapters.json`). The log is the single source for
 * both the live viewer player and the opt-in baked rasterizer.
 *
 * @param {object} tour    Parsed tour spec (see capture.js).
 * @param {string} outPath Destination `.rrweb.json` path.
 * @param {object} opts    { pace, mask?, onProgress?, onStepSettled?, adapter? }
 *                         `adapter` is an adapter OBJECT (or registered name).
 *                         `onStepSettled` — see rrweb-capture.js; used by the
 *                         tour-set runner's poster capture.
 * @returns {Promise<{ rrweb, sidecar, eventCount, chapters, durationMs }>}
 */
async function captureToRrweb(tour, outPath, opts = {}) {
  const { events, chapters, viewport } = await captureTourRrweb(tour, {
    pace: opts.pace, mask: opts.mask, onProgress: opts.onProgress, onStepSettled: opts.onStepSettled, adapter: opts.adapter,
  });
  if (!events || events.length < 2) throw new Error('tour produced no rrweb events (no steps?)');

  const out = path.resolve(outPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const envelope = buildEnvelope(events, { viewport, source: 'slidey-capture' });
  writeEnvelope(out, envelope);
  // Sidecar mirrors the in-log chapters for the byte-compatible contract
  // (`<source>.chapters.json`, same as the MP4 path).
  const sidecar = writeChapters(out, chapters);
  return { rrweb: out, sidecar, eventCount: events.length, chapters, durationMs: envelope.durationMs };
}

module.exports = {
  captureToVideo, captureToRrweb, captureTour, captureTourRrweb,
  registerAdapter, resolveAdapter,
};

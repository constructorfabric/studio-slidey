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
const { writeChapters } = require('./chapters');
const { framesToVideo } = require('../assembler');

/**
 * Capture a tour spec to an MP4 + chapter sidecar.
 *
 * @param {object} tour       Parsed tour spec (see capture.js).
 * @param {string} outMp4     Destination .mp4 path.
 * @param {object} opts       { fps=30, pace, framesDir?, keepFrames?, onProgress? }
 * @returns {Promise<{ mp4, sidecar, frameCount, chapters }>}
 */
async function captureToVideo(tour, outMp4, opts = {}) {
  const fps = opts.fps || 30;
  const ownFrames = !opts.framesDir;
  const framesDir = opts.framesDir
    ? path.resolve(opts.framesDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-tour-'));

  try {
    const { frameCount, chapters } = await captureTour(tour, framesDir, {
      fps, pace: opts.pace, onProgress: opts.onProgress,
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

module.exports = { captureToVideo, captureTour };

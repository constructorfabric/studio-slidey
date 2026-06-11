/**
 * SLIDEY — Video Assembler
 *
 * Calls the system `ffmpeg` binary to stitch PNG frames into an MP4.
 * Optionally mixes per-scene narration audio at correct timestamps.
 * Requires ffmpeg ≥ 4.x on PATH.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

/**
 * Assemble a directory of frame-NNNNNN.png files into an MP4.
 *
 * @param {string}   framesDir       - Directory containing frame-*.png files
 * @param {string}   outputPath      - Destination .mp4 path
 * @param {number}   fps             - Frames per second
 * @param {object[]} audioSegments   - Optional: [{ startSeconds, audioPath }] to mix
 */
function framesToVideo(framesDir, outputPath, fps = 30, audioSegments = null) {
  // Verify ffmpeg is available
  const which = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' });
  if (which.status !== 0) {
    throw new Error('ffmpeg not found on PATH — please install ffmpeg first');
  }

  // Ensure output directory exists
  const outDir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const framePattern = path.join(framesDir, 'frame-%06d.png');

  // ── No-audio path: the original simple invocation ────────────────────────
  if (!audioSegments || audioSegments.length === 0) {
    const args = [
      '-y',
      '-framerate', String(fps),
      '-i', framePattern,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '18',
      '-preset', 'slow',
      outputPath,
    ];
    const result = spawnSync('ffmpeg', args, { stdio: 'pipe' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`ffmpeg exited with status ${result.status}`);
    }
    return;
  }

  // ── With audio: build a filter_complex that delays each segment, then
  // mixes them into a single track ────────────────────────────────────────
  const inputArgs = [
    '-framerate', String(fps),
    '-i', framePattern,
  ];
  audioSegments.forEach(s => {
    inputArgs.push('-i', s.audioPath);
  });

  // Each input audio (1-indexed; 0 is the video) gets adelay'd, then we amix.
  const delayLabels = audioSegments.map((s, i) => {
    const ms = Math.round(s.startSeconds * 1000);
    // adelay needs per-channel delays; "ms|ms" handles stereo regardless of input layout
    return `[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`;
  });
  const mixInputs = audioSegments.map((_, i) => `[a${i}]`).join('');
  const filterComplex =
    delayLabels.join(';') +
    `;${mixInputs}amix=inputs=${audioSegments.length}:duration=longest:dropout_transition=0,volume=2.0[aout]`;

  const args = [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    '-preset', 'slow',
    '-c:a', 'aac',
    '-b:a', '192k',
    outputPath,
  ];
  const result = spawnSync('ffmpeg', args, { stdio: 'pipe' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited with status ${result.status}`);
  }
}

module.exports = { framesToVideo };

/**
 * SLIDEY — Narration generator
 *
 * Generates per-scene narration audio via the Microsoft Edge TTS CLI
 * (`edge-tts` Python package, installed system-wide). Each scene that has
 * a `narration` field gets its own MP3, positioned at the scene's start
 * frame when muxed into the final video.
 *
 * Each generated audio is checked against the scene's available duration
 * (from the scene's start frame to the next scene's start frame). If audio
 * is longer than the scene allows, it's flagged with a warning so the
 * narration script can be tightened — but the audio is still mixed (it
 * will spill into the next scene; consider that a soft overrun, not fatal).
 *
 * Edge TTS voice IDs (defaults to en-AU-NatashaNeural):
 *   en-AU-NatashaNeural   (Australian female, warm)
 *   en-AU-WilliamNeural   (Australian male)
 *   en-US-AriaNeural      (US female, neutral)
 *   en-US-JennyNeural     (US female, warm)
 *   en-GB-SoniaNeural     (UK female)
 *   ...
 */

'use strict';

const { execFileSync, execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const DEFAULT_VOICE = 'en-AU-NatashaNeural';

/**
 * Generate one narration audio file via edge-tts CLI.
 * @returns {number} duration of generated audio in seconds
 */
function generateOne(text, audioPath, voice = DEFAULT_VOICE, rate = '+0%') {
  // edge-tts handles quoting safely via argv (we use execFileSync).
  execFileSync('edge-tts', [
    '--text',         text,
    '--voice',        voice,
    '--rate',         rate,
    '--write-media',  audioPath,
  ], { stdio: 'pipe' });
  return getAudioDuration(audioPath);
}

function getAudioDuration(audioPath) {
  const out = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 "${audioPath}"`
  ).toString();
  return parseFloat(out.split('=')[1] || '0');
}

/**
 * Generate audio for every scene that has a `narration` field.
 *
 * @param {object[]} sceneBoundaries  - From renderer.js: { sceneIndex, startFrame, narration }
 * @param {number}   fps              - Target frames per second (for timestamp calc)
 * @param {number}   totalFrames      - Total frame count (to bound the last scene)
 * @param {object}   narrationMeta    - { voice, rate } from spec.meta.narration
 * @param {string}   audioDir         - Directory to write MP3s into
 * @returns {object[]} segments: [{ sceneIndex, startSeconds, sceneDuration, audioPath, audioDuration }]
 */
function generateAll(sceneBoundaries, fps, totalFrames, narrationMeta, audioDir) {
  const voice = (narrationMeta && narrationMeta.voice) || DEFAULT_VOICE;
  const rate  = (narrationMeta && narrationMeta.rate)  || '+0%';

  fs.mkdirSync(audioDir, { recursive: true });

  const segments = [];
  for (let i = 0; i < sceneBoundaries.length; i++) {
    const sb = sceneBoundaries[i];
    if (!sb.narration) continue;

    const next = sceneBoundaries[i + 1];
    const endFrame = next ? next.startFrame : totalFrames;
    const sceneDuration = (endFrame - sb.startFrame) / fps;
    const startSeconds  = sb.startFrame / fps;

    const audioPath = path.join(
      audioDir,
      `scene-${String(sb.sceneIndex).padStart(2, '0')}.mp3`
    );

    process.stdout.write(`[slidey] TTS scene ${sb.sceneIndex} (${sceneDuration.toFixed(1)}s) `);
    const audioDuration = generateOne(sb.narration, audioPath, voice, rate);

    if (audioDuration > sceneDuration - 0.3) {
      const overrun = (audioDuration - sceneDuration + 0.3).toFixed(2);
      console.warn(
        `\n  ⚠ narration may overrun by ${overrun}s — ` +
        `audio ${audioDuration.toFixed(2)}s vs scene ${sceneDuration.toFixed(2)}s.`
      );
    } else {
      process.stdout.write(`→ ${audioDuration.toFixed(1)}s ✓\n`);
    }

    segments.push({
      sceneIndex: sb.sceneIndex,
      startSeconds,
      sceneDuration,
      audioPath,
      audioDuration,
    });
  }
  return segments;
}

module.exports = { generateAll, generateOne, getAudioDuration, DEFAULT_VOICE };

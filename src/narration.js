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

const { execFileSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const DEFAULT_VOICE = 'en-AU-NatashaNeural';

/**
 * Apply phonetic respellings to spoken narration text.
 *
 * The Edge read-aloud endpoint that edge-tts uses ignores custom SSML (so
 * <phoneme> tags don't work); the reliable way to fix a mispronunciation is to
 * respell the word. `pronunciations` is a { term: respelling } map from
 * meta.narration: each term is matched whole-word and case-insensitively and
 * replaced with its respelling, so fixes live in one place and the narration
 * text shown in specs / `--list` stays clean.
 *
 * Matching uses lookarounds rather than \b so terms with leading/trailing
 * non-word chars (acronyms with dots, "C++", ".NET") still match. A single
 * combined pass is used so longer terms win over their sub-words and inserted
 * respellings are never re-scanned.
 *
 * @param {string} text
 * @param {Object<string,string>} pronunciations
 * @returns {string}
 */
function applyPronunciations(text, pronunciations) {
  if (!text || !pronunciations) return text;
  const terms = Object.keys(pronunciations)
    .filter(t => t && pronunciations[t])
    .sort((a, b) => b.length - a.length); // longest first → wins in alternation
  if (!terms.length) return text;

  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?<!\\w)(?:${escaped.join('|')})(?!\\w)`, 'gi');
  const lookup = new Map(terms.map(t => [t.toLowerCase(), pronunciations[t]]));
  return text.replace(re, m => lookup.get(m.toLowerCase()) ?? m);
}

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
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1',
    audioPath,
  ]).toString();
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
  const pronunciations = (narrationMeta && narrationMeta.pronunciations) || null;

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
    const spokenText = applyPronunciations(sb.narration, pronunciations);
    const audioDuration = generateOne(spokenText, audioPath, voice, rate);

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

module.exports = { generateAll, generateOne, getAudioDuration, applyPronunciations, DEFAULT_VOICE };

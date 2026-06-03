#!/usr/bin/env node
/**
 * SLIDEY — Deterministic, spec-driven declarative video generator
 *
 * Usage:
 *   node index.js <input.json> <output.mp4> [options]
 *
 * Options:
 *   --fps <n>              Frames per second (default: 30)
 *   --context key=val      Set/override a template variable (repeatable)
 *                          e.g. --context host=stand.example.com --context token=abc123
 *   --keep-frames          Keep the temporary frames directory (useful for debugging)
 *   --frames-dir <p>       Write frames to <p> instead of a temp dir
 *   --capture-log <file>   Write live HTTP responses to a JSON capture log (for playback freeze)
 *
 * Input format: a JSON scene spec  (see examples/ and README.md for the schema)
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const { generateFrames }    = require('./renderer');
const { framesToVideo }     = require('./assembler');
const { generateAll: generateNarration } = require('./narration');
const { estimateBoundaries } = require('./timing');

// Calibrated speech rate for default Edge TTS voice (en-AU-NatashaNeural at
// rate +0%). Measured across real narration: 1.7-2.3 wps depending on
// sentence breaks and word length. 1.85 catches real overruns without crying
// wolf on every tight scene.
const ESTIMATED_WPS = 1.85;

// ── CLI ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

// --list and --estimate only need the input spec (not an output path).
const wantsList     = args.includes('--list') || args.includes('--estimate');
const wantsCheck    = args.includes('--check');
const skipRender    = args.includes('--skip-render');
const noGaps        = args.includes('--no-gaps');

if (((args.length < 2 && !wantsList && !wantsCheck) || args.length < 1) || args.includes('--help') || args.includes('-h')) {
  console.log([
    '',
    '  SLIDEY — Deterministic, spec-driven declarative video generator',
    '',
    '  Usage:',
    '    node index.js <input.json> <output.mp4> [options]',
    '',
    '  Options:',
    '    --fps <n>                  Frames per second (default: 30)',
    '    --context key=value        Override a template variable (repeatable)',
    '    --keep-frames              Keep temp frame directory after render',
    '    --frames-dir <path>        Use this directory for frames instead of a temp dir',
    '    --capture-log <file>       Write live HTTP responses to JSON (for playback freeze)',
    '    --scenes <spec>            Render only the listed scenes (zero-indexed).',
    '                               Spec: comma-separated indices and/or ranges,',
    '                               e.g.  --scenes 4     --scenes 0,3-5,7',
    '                               Selected scenes are still combined into one MP4.',
    '    --list                     Print the scene index + duration table; no render.',
    '    --estimate                 Like --list, plus narration audio-length estimates',
    '                               and overrun warnings. Catches budget issues',
    '                               BEFORE a full ~7-12min render.',
    '    --skip-render              Skip the PNG-rendering step (reuse cached frames in',
    '                               --frames-dir) and regenerate narration + mux only.',
    '                               Iteration loop for narration text edits.',
    '    --no-gaps                  Suppress the 0.8s blank inter-scene gap. Use with',
    '                               --scenes N-M to review a multi-scene sequence as a',
    '                               seamless clip (e.g. a progressive graph build-up).',
    '    --check                    Validate diagram-svg scenes without rendering.',
    '                               Checks node width/height and overlap. Exits 1 if',
    '                               any violations found (usable in CI).',
    '',
    '  Examples:',
    '    node index.js examples/hello.json out.mp4',
    '    node index.js examples/hello.json out.mp4 --estimate',
    '    node index.js examples/hello.json out.mp4 --scenes 0,2-3 --no-gaps',
    '    node index.js spec.json out.mp4 --context host=stand.example.com',
    '',
    '  request-scene modes:',
    '  Live mode     (mock/playback omitted): real HTTP request made, response rendered.',
    '  Mock mode     (mock: true):     synthetic response in JSON, MOCK badge shown.',
    '  Playback mode (playback: true): real captured response in JSON, PLAYBACK badge shown.',
    '',
  ].join('\n'));
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const [inputPath, outputPath] = args;

const fpsIdx        = args.indexOf('--fps');
const fps           = fpsIdx !== -1 ? parseInt(args[fpsIdx + 1], 10) : 30;
const keepFrames    = args.includes('--keep-frames');
const framesDirIdx  = args.indexOf('--frames-dir');
const framesDirOpt  = framesDirIdx !== -1 ? args[framesDirIdx + 1] : null;
const captureLogIdx = args.indexOf('--capture-log');
const captureLogOpt = captureLogIdx !== -1 ? args[captureLogIdx + 1] : null;
const scenesIdx     = args.indexOf('--scenes');
const scenesOpt     = scenesIdx !== -1 ? args[scenesIdx + 1] : null;

// Parse --scenes "0,3-5,7" into a Set of scene indices. null = all scenes.
function parseScenes(spec) {
  if (!spec) return null;
  const set = new Set();
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const dash = trimmed.indexOf('-');
    if (dash === -1) {
      const n = parseInt(trimmed, 10);
      if (!Number.isNaN(n)) set.add(n);
    } else {
      const from = parseInt(trimmed.slice(0, dash), 10);
      const to   = parseInt(trimmed.slice(dash + 1), 10);
      if (!Number.isNaN(from) && !Number.isNaN(to)) {
        for (let i = from; i <= to; i++) set.add(i);
      }
    }
  }
  return set;
}
const selectedScenes = parseScenes(scenesOpt);

// Parse --context key=value overrides (repeatable)
const cliContext = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--context' && args[i + 1]) {
    const eq = args[i + 1].indexOf('=');
    if (eq !== -1) {
      cliContext[args[i + 1].slice(0, eq)] = args[i + 1].slice(eq + 1);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Estimate audio duration from word count, using the calibrated WPS for the
 * default Edge TTS voice at default rate. Conservative (slightly slower than
 * reality) so "fits" verdicts hold.
 */
function estimateAudioSeconds(text) {
  if (!text) return 0;
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  return words / ESTIMATED_WPS;
}

/**
 * Print a scene-by-scene table from the spec, no render.
 * If withAudio, include narration audio estimates and overrun warnings.
 */
function printSceneList(spec, fps, withAudio, opts = {}) {
  const boundaries = estimateBoundaries(spec, null, opts);
  const total = boundaries.reduce((s, b) => s + b.durationFrames, 0);

  console.log(`\n[slidey] ${spec.scenes.length} scenes · est. ${(total / fps).toFixed(1)}s @ ${fps}fps · ${total} frames\n`);

  const hdr = withAudio
    ? '  #  type           start     dur    | narration                          audio    fit'
    : '  #  type           start     dur    | narration';
  console.log(hdr);
  console.log('  ' + '─'.repeat(hdr.length - 2));

  let warnings = 0;
  boundaries.forEach(b => {
    const idx   = String(b.sceneIndex).padStart(2);
    const type  = b.type.padEnd(13);
    const start = (b.startFrame / fps).toFixed(1).padStart(5) + 's';
    const dur   = (b.durationFrames / fps).toFixed(1).padStart(5) + 's';

    if (!withAudio) {
      const narr = b.narration ? `"${b.narration.slice(0, 60)}${b.narration.length > 60 ? '…' : ''}"` : '—';
      console.log(`  ${idx}  ${type}  ${start}  ${dur}  | ${narr}`);
      return;
    }

    const sceneSec = b.durationFrames / fps;
    if (!b.narration) {
      console.log(`  ${idx}  ${type}  ${start}  ${dur}  | (none)`);
      return;
    }
    const audioSec = estimateAudioSeconds(b.narration);
    const margin = sceneSec - audioSec;
    const fit = margin < 0
      ? `✗ +${(-margin).toFixed(1)}s`
      : margin < 0.6 ? `△ ${margin.toFixed(1)}s` : `✓ ${margin.toFixed(1)}s`;
    if (margin < 0.6) warnings++;
    const narr = `"${b.narration.slice(0, 36)}${b.narration.length > 36 ? '…' : ''}"`;
    console.log(`  ${idx}  ${type}  ${start}  ${dur}  | ${narr.padEnd(38)}  ${audioSec.toFixed(1).padStart(4)}s   ${fit}`);
  });

  console.log('');
  if (withAudio) {
    console.log(`  ✓ comfortable (>0.6s margin)   △ tight (0-0.6s margin)   ✗ overrun (audio > scene)`);
    if (warnings) {
      console.log(`  ${warnings} scene(s) flagged — trim narration text or extend scene "hold" frames before rendering.`);
    }
  }
  console.log('');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Read and validate spec
  const absInput = path.resolve(inputPath);
  if (!fs.existsSync(absInput)) {
    console.error(`[slidey] ERROR: input file not found: ${absInput}`);
    process.exit(1);
  }

  // A .jsonl input is a kitsoki session trace: generate the scene spec from it
  // (see src/trace.js) instead of parsing it as a slidey spec. Everything
  // downstream (--list/--estimate, pdf, frames, assembly) runs unchanged.
  const fromTrace = /\.jsonl$/i.test(absInput);

  let spec;
  if (fromTrace) {
    try {
      spec = require('./trace').buildSpecFromFile(absInput);
      console.log(`[slidey] Trace  : ${spec.scenes.length} scenes generated from ${path.basename(absInput)}`);
    } catch (err) {
      console.error(`[slidey] ERROR: failed to build spec from trace: ${err.message}`);
      process.exit(1);
    }
  } else {
    try {
      spec = JSON.parse(fs.readFileSync(absInput, 'utf-8'));
    } catch (err) {
      console.error(`[slidey] ERROR: failed to parse JSON: ${err.message}`);
      process.exit(1);
    }
  }

  if (!spec.scenes || !Array.isArray(spec.scenes) || spec.scenes.length === 0) {
    console.error('[slidey] ERROR: spec must have a non-empty "scenes" array');
    process.exit(1);
  }

  // CLI context overrides take precedence over meta.context in the spec
  if (Object.keys(cliContext).length > 0) {
    spec.meta = spec.meta || {};
    spec.meta.context = Object.assign({}, spec.meta.context || {}, cliContext);
    console.log(`[slidey] Context overrides: ${JSON.stringify(cliContext)}`);
  }

  // Trace → .json output: dump the generated spec for inspection / hand-tweaking,
  // then exit. Re-run the .json the normal way to render it. (No-op for non-trace
  // input — a .json output there would be the input itself.)
  if (fromTrace && !wantsList && outputPath && /\.json$/i.test(outputPath)) {
    const absOut = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, JSON.stringify(spec, null, 2) + '\n', 'utf-8');
    console.log(`[slidey] Spec written → ${absOut}  (${spec.scenes.length} scenes)`);
    process.exit(0);
  }

  // ── --list / --estimate: print scene table and exit, no rendering ──
  if (wantsList) {
    const wantsAudioEstimate = args.includes('--estimate');
    printSceneList(spec, fps, wantsAudioEstimate, { noGaps });
    process.exit(0);
  }

  // ── --check: validate diagram-svg specs, exit 1 if violations found ──
  if (wantsCheck) {
    const { runCheck } = require('./check');
    const violations = runCheck(spec);
    process.exit(violations > 0 ? 1 : 0);
  }

  // ── PDF output: a .pdf extension exports slides (one page per reveal step)
  //    via the shared Vue render bundle. No frames, narration, or ffmpeg. ──
  if (/\.pdf$/i.test(outputPath)) {
    const { generatePdf } = require('./pdf');
    const absOut = path.resolve(outputPath);
    console.log(`[slidey] Input  : ${absInput}`);
    console.log(`[slidey] Output : ${absOut}  (PDF — one page per reveal step)`);
    if (selectedScenes) {
      const picked = [...selectedScenes].sort((a, b) => a - b).join(',');
      console.log(`[slidey] Scenes : ${spec.scenes.length} total, exporting [${picked}]`);
    } else {
      console.log(`[slidey] Scenes : ${spec.scenes.length}`);
    }
    console.log('');
    try {
      const { pageCount } = await generatePdf(spec, absOut, {
        specPath: absInput,
        selectedScenes,
        onProgress: (pages, i, type) => {
          process.stdout.write(`\r[slidey] PDF: scene ${i} (${type})`.padEnd(40) + `${pages} pages`);
        },
      });
      process.stdout.write('\n');
      const sizeMB = (fs.statSync(absOut).size / 1024 / 1024).toFixed(2);
      console.log(`[slidey] Done → ${absOut}  (${pageCount} pages, ${sizeMB} MB)`);
    } catch (err) {
      console.error(`\n[slidey] ERROR during PDF export: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Set up frames directory
  let framesDir;
  let ownFramesDir = false;
  if (framesDirOpt) {
    framesDir = path.resolve(framesDirOpt);
    fs.mkdirSync(framesDir, { recursive: true });
  } else {
    framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-'));
    ownFramesDir = true;
  }

  const captureLogPath = captureLogOpt ? path.resolve(captureLogOpt) : null;

  console.log(`[slidey] Input  : ${absInput}`);
  console.log(`[slidey] Output : ${path.resolve(outputPath)}`);
  console.log(`[slidey] FPS    : ${fps}`);
  console.log(`[slidey] Frames : ${framesDir}`);
  if (selectedScenes) {
    const picked = [...selectedScenes].sort((a, b) => a - b).join(',');
    console.log(`[slidey] Scenes : ${spec.scenes.length} total, rendering [${picked}]`);
  } else {
    console.log(`[slidey] Scenes : ${spec.scenes.length}`);
  }
  if (captureLogPath) console.log(`[slidey] CaptureLog: ${captureLogPath}`);
  console.log('');

  let frameCount, sceneBoundaries;
  if (skipRender) {
    // Use spec-derived timings; assume frames are already on disk in framesDir.
    if (!fs.existsSync(framesDir) || fs.readdirSync(framesDir).filter(f => /^frame-\d+\.png$/.test(f)).length === 0) {
      console.error(`[slidey] ERROR: --skip-render needs cached frames in ${framesDir}. Re-run without --skip-render first (with --keep-frames + --frames-dir).`);
      process.exit(1);
    }
    sceneBoundaries = require('./timing').estimateBoundaries(spec, selectedScenes, { noGaps });
    frameCount = sceneBoundaries.reduce((s, b) => s + b.durationFrames, 0);
    console.log(`[slidey] --skip-render: reusing ${frameCount} cached frames (${(frameCount / fps).toFixed(1)}s) from ${framesDir}`);
  } else {
    try {
      let lastLabel = '';
      const result = await generateFrames(spec, framesDir, fps, (idx, _total, label) => {
        if (label !== lastLabel) {
          process.stdout.write(`\r[slidey] Rendering: ${label.padEnd(24)}  frame ${idx}`);
          lastLabel = label;
        }
      }, captureLogPath, absInput, selectedScenes, noGaps);
      frameCount      = result.frameCount;
      sceneBoundaries = result.sceneBoundaries;
      process.stdout.write('\n');
    } catch (err) {
      console.error(`\n[slidey] ERROR during rendering: ${err.message}`);
      if (!keepFrames && ownFramesDir) fs.rmSync(framesDir, { recursive: true, force: true });
      process.exit(1);
    }

    console.log(`[slidey] ${frameCount} frames rendered (${(frameCount / fps).toFixed(1)}s)`);
  }

  // ── Narration (optional, only if any scene has a `narration` field) ────
  let audioSegments = null;
  const hasNarration = sceneBoundaries.some(sb => sb.narration);
  const audioDir = path.join(framesDir, 'audio');
  if (hasNarration) {
    console.log('[slidey] Generating narration audio…');
    try {
      audioSegments = generateNarration(
        sceneBoundaries, fps, frameCount,
        (spec.meta && spec.meta.narration) || {},
        audioDir,
      );
    } catch (err) {
      console.error(`[slidey] ERROR during narration: ${err.message}`);
      if (!keepFrames && ownFramesDir) fs.rmSync(framesDir, { recursive: true, force: true });
      process.exit(1);
    }
  }

  // Assemble video (with audio if generated)
  console.log('[slidey] Assembling video with ffmpeg…');
  try {
    framesToVideo(framesDir, path.resolve(outputPath), fps, audioSegments);
  } catch (err) {
    console.error(`[slidey] ERROR during assembly: ${err.message}`);
    if (!keepFrames && ownFramesDir) fs.rmSync(framesDir, { recursive: true, force: true });
    process.exit(1);
  }

  // Cleanup
  if (!keepFrames && ownFramesDir) {
    fs.rmSync(framesDir, { recursive: true, force: true });
  } else if (keepFrames) {
    console.log(`[slidey] Frames kept at: ${framesDir}`);
  }

  const outStat = fs.statSync(path.resolve(outputPath));
  const sizeMB  = (outStat.size / 1024 / 1024).toFixed(1);
  console.log(`[slidey] Done → ${path.resolve(outputPath)}  (${sizeMB} MB)`);
}

main().catch(err => {
  console.error('[slidey] FATAL:', err);
  process.exit(1);
});

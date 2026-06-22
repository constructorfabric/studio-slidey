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
const { generateAll: generateNarration, applyPronunciations } = require('./narration');
const { estimateBoundaries } = require('./timing');
const { validateSpec }       = require('./validate');

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
const wantsSchema   = args.includes('--schema');
const wantsValidate = args.includes('--validate');
const auditIdx      = args.indexOf('--audit');
const auditOpt      = auditIdx !== -1 ? args[auditIdx + 1] : null;
const wantsAudit    = auditIdx !== -1;
const skipRender    = args.includes('--skip-render');
const noGaps        = args.includes('--no-gaps');

// --schema: print the JSON Schema and exit (no input file required)
if (wantsSchema) {
  const { SCHEMA } = require('./schema');
  process.stdout.write(JSON.stringify(SCHEMA, null, 2) + '\n');
  process.exit(0);
}

// The authoring skill is the single source of truth for both `slidey docs`
// (printed to stdout for an LLM/agent) and `slidey skill install` (copied into
// a .claude/skills/ dir). Keeping one file behind both means they never drift.
const SKILL_DIR = path.join(__dirname, '..', '.claude', 'skills', 'slidey-authoring');

// ── `slidey docs` — print the LLM-facing authoring guide to stdout ──────────
// Everything an agent needs to author a deck (iteration loop, scene-type
// vocabulary, narration budgeting, gotchas). Self-serve with one command:
//   slidey docs            # the full guide
//   slidey docs | head     # or pipe it anywhere
if (args[0] === 'docs') {
  try {
    let body = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf-8');
    // Strip the YAML frontmatter — that's skill-loader metadata, not content.
    body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');
    process.stdout.write(body.endsWith('\n') ? body : body + '\n');
    process.exit(0);
  } catch (err) {
    console.error(`[slidey] ERROR: could not read authoring guide: ${err.message}`);
    process.exit(1);
  }
}

// ── `slidey skill install [--user|--project]` — install the authoring skill ──
// Copies the bundled slidey-authoring skill into a .claude/skills/ directory so
// Claude Code (or any agent that reads that convention) loads it automatically.
//   slidey skill install              # into ./.claude/skills (this project)
//   slidey skill install --user       # into ~/.claude/skills (all projects)
if (args[0] === 'skill') {
  if (args[1] !== 'install') {
    console.error('[slidey] usage: slidey skill install [--user|--project]');
    process.exit(1);
  }
  const toUser  = args.includes('--user');
  const baseDir = toUser ? path.join(os.homedir(), '.claude') : path.join(process.cwd(), '.claude');
  const destDir = path.join(baseDir, 'skills', 'slidey-authoring');
  try {
    if (!fs.existsSync(path.join(SKILL_DIR, 'SKILL.md'))) {
      throw new Error(`bundled skill not found at ${SKILL_DIR}`);
    }
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    fs.cpSync(SKILL_DIR, destDir, { recursive: true });
    console.log(`[slidey] Installed slidey-authoring skill → ${destDir}`);
    console.log(`[slidey] ${toUser ? 'Available in every project' : 'Available in this project'}. Restart your agent / Claude Code to load it.`);
    process.exit(0);
  } catch (err) {
    console.error(`[slidey] ERROR installing skill: ${err.message}`);
    process.exit(1);
  }
}

// ── Viewer mode ──────────────────────────────────────────────────────────
// `slidey <dir>` or `slidey <file.json>` (no output path) opens the interactive
// viewer in the browser instead of rendering — a file-tree sidebar (folder) +
// click-through deck. Only entered when no action flag is set and the single
// positional resolves to a directory, or a spec file with no second positional.
const VALUE_FLAGS = new Set([
  '--fps', '--frames-dir', '--capture-log', '--scenes', '--context',
  '--pdf-raster-quality', '--pdf-raster-scale', '--port', '--pace', '--format',
]);
function positionalArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('-')) { if (VALUE_FLAGS.has(a)) i++; continue; }
    out.push(a);
  }
  return out;
}
const wantsHelp = args.includes('--help') || args.includes('-h');
const anyAction = wantsList || wantsCheck || wantsValidate || wantsAudit;
const noOpen    = args.includes('--no-open');
const portIdx   = args.indexOf('--port');
const portOpt   = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 4321;
if (!wantsHelp && !anyAction && args[0] !== 'capture') {
  const pos = positionalArgs(args);
  let viewerRoot = null, openFile = null;
  if (pos.length === 0) {
    // Bare `slidey` (or just flags like --port) → open the current directory.
    viewerRoot = process.cwd();
  } else {
    const firstAbs = path.resolve(pos[0]);
    if (fs.existsSync(firstAbs)) {
      const st = fs.statSync(firstAbs);
      if (st.isDirectory()) {
        viewerRoot = firstAbs;
      } else if (st.isFile() && /\.(json|jsonl)$/i.test(firstAbs) && pos.length < 2) {
        viewerRoot = path.dirname(firstAbs);
        openFile = path.basename(firstAbs);
      }
    }
  }
  if (viewerRoot) {
    require('./serve').startViewer({
      root: viewerRoot,
      openFile,
      port: Number.isInteger(portOpt) ? portOpt : 4321,
      open: !noOpen,
    });
    return; // Node wraps modules in a function — top-level return is valid.
  }
}

if (((args.length < 2 && !wantsList && !wantsCheck && !wantsValidate) || args.length < 1) || args.includes('--help') || args.includes('-h')) {
  console.log([
    '',
    '  SLIDEY — Deterministic, spec-driven declarative video generator',
    '',
    '  Usage:',
    '    node index.js <input.json> <output.mp4> [options]   render a video/PDF/PNG',
    '    node index.js                                       open the viewer on the current folder',
    '    node index.js <folder>                              open the viewer (file-tree sidebar)',
    '    node index.js <input.json>                          open the viewer on one deck',
    '    node index.js capture <tour.json> <out.mp4>         record a demo MP4 + chapter sidecar from a tour',
    '    slidey docs                                          print the authoring guide (for LLMs/agents)',
    '    slidey skill install [--user|--project]             install the slidey-authoring agent skill',
    '',
    '  Viewer options:',
    '    --port <n>                 Viewer port (default: 4321; auto-increments if taken)',
    '    --no-open                  Do not launch the browser; just print the URL',
    '',
    '  Render options:',
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
    '    --validate                 Validate the spec against the JSON Schema and exit.',
    '                               Prints a human-readable error report on failure.',
    '                               Exits 0 if valid, 1 if invalid (usable in CI).',
    '    --schema                   Print the JSON Schema for a slidey spec to stdout',
    '                               and exit. Pipe to a file or pass to an LLM.',
    '    --no-compress              Skip the PDF post-process (PDF output only). By',
    '                               default a finished PDF is losslessly dedup-compressed',
    '                               (mutool) and linearized (qpdf) when those are on PATH.',
    '    --pdf-raster               PDF output only: render each page as a flat JPEG',
    '                               (faithful, paints instantly) instead of vector. Use',
    '                               when vector pages repaint slowly in a viewer.',
    '    --pdf-raster-quality <n>   JPEG quality for --pdf-raster (default 92). Raise',
    '                               toward 95 to remove banding on dark gradients (e.g.',
    '                               on iPhone/OLED); lowers below ~88 get blocky.',
    '    --pdf-raster-scale <n>     Device-scale for --pdf-raster (default 2). 1.5 ≈',
    '                               2880px wide — smaller file, still crisp on phones.',
    '    --check                    Validate diagram-svg scenes without rendering.',
    '                               Checks node width/height, node overlap, slanted',
    '                               connectors (misaligned box centres) and gate/label',
    '                               clearance. Exits 1 if any violations (usable in CI).',
    '    --audit [<file>]           Render every reveal step in headless Chrome and',
    '                               measure the REAL laid-out geometry: off-page,',
    '                               box/SVG-node overflow, rendered node overlap,',
    '                               unsubstituted template vars, tiny text. Writes a',
    '                               findings JSON to <file> (or stdout). Exits 1 if',
    '                               any error-severity finding is found. The',
    '                               deterministic half of the slidey-visual-qa skill.',
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
const paceIdx       = args.indexOf('--pace');
const paceOpt       = paceIdx !== -1 ? parseFloat(args[paceIdx + 1]) : null;
const formatIdx     = args.indexOf('--format');
const formatOpt     = formatIdx !== -1 ? args[formatIdx + 1] : null;
const scenesIdx     = args.indexOf('--scenes');
const scenesOpt     = scenesIdx !== -1 ? args[scenesIdx + 1] : null;
const noCompress    = args.includes('--no-compress');
const pdfRaster     = args.includes('--pdf-raster');
const rasterQIdx    = args.indexOf('--pdf-raster-quality');
const rasterQuality = rasterQIdx !== -1 ? parseInt(args[rasterQIdx + 1], 10) : 92;
const rasterSIdx    = args.indexOf('--pdf-raster-scale');
const rasterScale   = rasterSIdx !== -1 ? parseFloat(args[rasterSIdx + 1]) : 2;

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
  const pronunciations = (spec.meta && spec.meta.narration && spec.meta.narration.pronunciations) || null;
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

    // narration may be a plain string or, for video scenes, an array of
    // time-keyed cues. Flatten to one string for the budget estimate.
    const cueCount = Array.isArray(b.narration) ? b.narration.length : 0;
    const narrStr = cueCount
      ? b.narration.map(c => c && c.text).filter(Boolean).join(' ')
      : (typeof b.narration === 'string' ? b.narration : '');
    const cuePrefix = cueCount ? `(${cueCount} cues) ` : '';

    if (!withAudio) {
      const narr = narrStr ? `${cuePrefix}"${narrStr.slice(0, 60)}${narrStr.length > 60 ? '…' : ''}"` : '—';
      console.log(`  ${idx}  ${type}  ${start}  ${dur}  | ${narr}`);
      return;
    }

    const sceneSec = b.durationFrames / fps;
    if (!narrStr) {
      console.log(`  ${idx}  ${type}  ${start}  ${dur}  | (none)`);
      return;
    }
    const audioSec = estimateAudioSeconds(applyPronunciations(narrStr, pronunciations));
    const margin = sceneSec - audioSec;
    const fit = margin < 0
      ? `✗ +${(-margin).toFixed(1)}s`
      : margin < 0.6 ? `△ ${margin.toFixed(1)}s` : `✓ ${margin.toFixed(1)}s`;
    if (margin < 0.6) warnings++;
    const narr = `${cuePrefix}"${narrStr.slice(0, 36)}${narrStr.length > 36 ? '…' : ''}"`;
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

// ── `slidey capture <tour.json> <out.mp4>` ──────────────────────────────────
//
// Drive a live web app through a tour storyboard and record a deterministic
// demo MP4 + chapter sidecar (the generalized successor to kitsoki's per-app
// Playwright recording specs). The same engine backs the `video` deck scene's
// `capture:` field. See src/tour/.
async function runCapture() {
  const tourPath = args[1];
  const outPath  = args[2];
  if (!tourPath || !outPath) {
    console.error('[slidey] usage: slidey capture <tour.json> <out.mp4|out.rrweb.json> [--format rrweb] [--fps n] [--pace n] [--keep-frames]');
    process.exit(1);
  }
  const absTour = path.resolve(tourPath);
  if (!fs.existsSync(absTour)) {
    console.error(`[slidey] ERROR: tour spec not found: ${absTour}`);
    process.exit(1);
  }
  let tour;
  try {
    tour = JSON.parse(fs.readFileSync(absTour, 'utf-8'));
  } catch (err) {
    console.error(`[slidey] ERROR: failed to parse tour JSON: ${err.message}`);
    process.exit(1);
  }
  // Record the spec path into chapter source_refs (relative to cwd if possible).
  if (!tour.specPath) tour.specPath = path.relative(process.cwd(), absTour);

  // Format: explicit --format wins, else inferred from the output extension.
  const isRrweb = formatOpt === 'rrweb' || /\.rrweb\.json$/i.test(outPath);
  const pace = paceOpt != null ? paceOpt : undefined;
  console.log(`[slidey] Capture: ${absTour}`);
  console.log(`[slidey] Output : ${path.resolve(outPath)}  (${isRrweb ? 'rrweb' : 'mp4'})`);
  console.log(`[slidey] Steps  : ${(tour.steps || []).length}  pace ${paceOpt != null ? paceOpt : (tour.pace != null ? tour.pace : 1)}\n`);

  try {
    if (isRrweb) {
      const { captureToRrweb } = require('./tour');
      const { rrweb, sidecar, eventCount, chapters, durationMs } = await captureToRrweb(tour, outPath, {
        pace, mask: tour.mask,
        onProgress: (idx, label) => {
          process.stdout.write(`\r[slidey] capture: ${String(label).padEnd(28)} step ${idx}`);
        },
      });
      process.stdout.write('\n');
      const sizeKB = (fs.statSync(rrweb).size / 1024).toFixed(0);
      console.log(`[slidey] Done → ${rrweb}  (${(durationMs / 1000).toFixed(1)}s, ${eventCount} events, ${sizeKB} KB)`);
      if (sidecar) console.log(`[slidey] Chapters → ${sidecar}  (${chapters.length})`);
    } else {
      const { captureToVideo } = require('./tour');
      const { mp4, sidecar, frameCount, chapters } = await captureToVideo(tour, outPath, {
        fps, pace, framesDir: framesDirOpt, keepFrames,
        onProgress: (idx, label) => {
          process.stdout.write(`\r[slidey] capture: ${String(label).padEnd(28)} frame ${idx}`);
        },
      });
      process.stdout.write('\n');
      const sizeMB = (fs.statSync(mp4).size / 1024 / 1024).toFixed(1);
      console.log(`[slidey] Done → ${mp4}  (${(frameCount / fps).toFixed(1)}s, ${sizeMB} MB)`);
      if (sidecar) console.log(`[slidey] Chapters → ${sidecar}  (${chapters.length})`);
    }
  } catch (err) {
    console.error(`\n[slidey] ERROR during capture: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (args[0] === 'capture') { await runCapture(); return; }

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

  // ── JSON Schema validation (always; exits on failure) ─────────────────────
  {
    const { valid, errors, count } = validateSpec(spec);
    if (!valid) {
      console.error(`[slidey] VALIDATION ERROR: ${count} problem(s) found in ${path.basename(absInput)}\n`);
      for (const line of errors) console.error(line);
      console.error('\n  Tip: run with --schema to get the full JSON Schema, or --validate for a standalone check.');
      if (wantsValidate) process.exit(1);
      // In non-validate modes, treat schema errors as fatal so bad specs fail
      // fast rather than crashing mid-render with a confusing message.
      process.exit(1);
    } else if (wantsValidate) {
      console.log(`[slidey] ✓ valid — ${spec.scenes.length} scene(s)  ${path.basename(absInput)}`);
      process.exit(0);
    }
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
    printSceneList(spec, fps, wantsAudioEstimate, { noGaps, specPath: absInput });
    process.exit(0);
  }

  // ── --check: validate diagram-svg specs, exit 1 if violations found ──
  if (wantsCheck) {
    const { runCheck } = require('./check');
    const violations = runCheck(spec);
    process.exit(violations > 0 ? 1 : 0);
  }

  // ── --audit: drive the render bundle and measure real laid-out geometry per
  //    reveal step. Emits a findings JSON (to <file> or stdout). Exits 1 if any
  //    error-severity finding is present (CI/QA gate). See src/audit.js. ──
  if (wantsAudit) {
    const { auditSpec } = require('./audit');
    try {
      const { frames, summary } = await auditSpec(spec, {
        specPath: absInput,
        selectedScenes,
        onProgress: (n, i, type) => {
          process.stderr.write(`\r[slidey] audit: scene ${i} (${type})`.padEnd(40) + `${n} frames`);
        },
      });
      process.stderr.write('\n');
      const report = { spec: absInput, resolution: (spec.meta && spec.meta.resolution) || { width: 1920, height: 1080 }, summary, frames };
      const json = JSON.stringify(report, null, 2);
      if (auditOpt && !auditOpt.startsWith('-')) {
        const absOut = path.resolve(auditOpt);
        fs.mkdirSync(path.dirname(absOut), { recursive: true });
        fs.writeFileSync(absOut, json + '\n', 'utf-8');
        console.error(`[slidey] audit → ${absOut}  (${summary.frames} frames, ${summary.errors} errors, ${summary.warnings} warnings)`);
      } else {
        process.stdout.write(json + '\n');
      }
      process.exit(summary.errors > 0 ? 1 : 0);
    } catch (err) {
      console.error(`\n[slidey] ERROR during audit: ${err.message}`);
      process.exit(2);
    }
  }

  // ── PNG output: a directory path (or path with no recognised extension) exports
  //    one PNG per reveal step into that directory. Same reveal-step model as PDF,
  //    but produces files a vision model can Read directly. Fast (~1-3s per scene).
  //    Output files: <dir>/<scene-idx>-<step-idx>.png  e.g. 04-01.png, 04-02.png
  if (!path.extname(outputPath) || outputPath.endsWith('/')) {
    const { generatePngs } = require('./png');
    const absOut = path.resolve(outputPath);
    console.log(`[slidey] Input  : ${absInput}`);
    console.log(`[slidey] Output : ${absOut}/  (PNG — one file per reveal step)`);
    if (selectedScenes) {
      const picked = [...selectedScenes].sort((a, b) => a - b).join(',');
      console.log(`[slidey] Scenes : ${spec.scenes.length} total, exporting [${picked}]`);
    } else {
      console.log(`[slidey] Scenes : ${spec.scenes.length}`);
    }
    console.log('');
    try {
      const { fileCount, files } = await generatePngs(spec, absOut, {
        specPath: absInput,
        selectedScenes,
        onProgress: (n, i, type) => {
          process.stdout.write(`\r[slidey] PNG: scene ${i} (${type})`.padEnd(40) + `${n} files`);
        },
      });
      process.stdout.write('\n');
      console.log(`[slidey] Done → ${absOut}/  (${fileCount} files)`);
      files.forEach(f => console.log(`         ${f}`));
    } catch (err) {
      console.error(`\n[slidey] ERROR during PNG export: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
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
        compress: !noCompress,
        raster: pdfRaster,
        rasterQuality,
        rasterScale,
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
    sceneBoundaries = require('./timing').estimateBoundaries(spec, selectedScenes, { noGaps, specPath: absInput });
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
  // Exit explicitly: a render that launches more than one Puppeteer browser in
  // the process (e.g. the main render loop + a `video` scene's rrweb rasterizer)
  // can leave a lingering CDP transport socket that otherwise keeps the event
  // loop alive after all work + output is flushed (everything above is sync).
  process.exit(0);
}

main().catch(err => {
  console.error('[slidey] FATAL:', err);
  process.exit(1);
});

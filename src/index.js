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
const { mkdtemp } = require('./temp-path');

const { framesToVideo }     = require('./assembler');
const { generateAll: generateNarration, applyPronunciations, edgeTtsAvailable, hasNarrationText, DEFAULT_VOICE } = require('./narration');
const { estimateBoundaries } = require('./timing');
const { validateSpec }       = require('./validate');
const { resolveDeckSpec, inlineChildDeckFiles } = require('./collections');
const { attachRuntimeThemePacks, stripRuntimeThemePacks } = require('./theme-packs');
const { applyLocale, attachLocaleRef, extractLocale, readDeck } = require('./localization');

function generateFrames(...args) {
  return require('./renderer').generateFrames(...args);
}

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
const localeIdx     = args.indexOf('--locale');
const localeOpt     = localeIdx !== -1 ? args[localeIdx + 1] : null;
// `--estimate --json`: a single JSON doc on stdout (§1 of the mockup-demo-
// tooling contract). Computed up top so every console.log between here and
// the --list/--estimate branch can be redirected to stderr in this mode —
// stdout must carry NOTHING but the one JSON document.
const wantsJsonOutput  = args.includes('--json');
const wantsJsonEstimate = wantsList && args.includes('--estimate') && wantsJsonOutput;

// --schema: print the JSON Schema and exit (no input file required)
if (wantsSchema) {
  const { SCHEMA } = require('./schema');
  process.stdout.write(JSON.stringify(SCHEMA, null, 2) + '\n');
  process.exit(0);
}

// Bundled skills are copied by `slidey skill install`. The authoring skill is
// also the single source of truth for `slidey docs` so docs and skill guidance
// do not drift.
const SKILLS_ROOT = path.join(__dirname, '..', '.claude', 'skills');
const AUTHORING_SKILL_DIR = path.join(SKILLS_ROOT, 'slidey-authoring');
function bundledSkillDir(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`invalid skill name: ${name}`);
  return path.join(SKILLS_ROOT, name);
}
function bundledSkillNames() {
  return fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(SKILLS_ROOT, name, 'SKILL.md')))
    .sort();
}

// ── `slidey docs` — print the LLM-facing authoring guide to stdout ──────────
// Everything an agent needs to author a deck (iteration loop, scene-type
// vocabulary, narration budgeting, gotchas). Self-serve with one command:
//   slidey docs            # the full guide
//   slidey docs | head     # or pipe it anywhere
if (args[0] === 'docs') {
  try {
    let body = fs.readFileSync(path.join(AUTHORING_SKILL_DIR, 'SKILL.md'), 'utf-8');
    // Strip the YAML frontmatter — that's skill-loader metadata, not content.
    body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');
    process.stdout.write(body.endsWith('\n') ? body : body + '\n');
    process.exit(0);
  } catch (err) {
    console.error(`[slidey] ERROR: could not read authoring guide: ${err.message}`);
    process.exit(1);
  }
}

// ── `slidey doctor` — verify the local export toolchain is ready ───────────
if (args[0] === 'doctor') {
  (async () => {
    const { formatDoctorReport, runSetupDoctor } = require('./setup-doctor');
    const voiceIdx = args.indexOf('--voice');
    const result = await runSetupDoctor({
      browser: !args.includes('--no-browser'),
      narration: !args.includes('--no-narration'),
      ttsSample: !args.includes('--no-tts-sample') && !args.includes('--no-narration'),
      voice: voiceIdx !== -1 ? args[voiceIdx + 1] : undefined,
    });
    if (args.includes('--json')) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      console.log(formatDoctorReport(result));
    }
    process.exit(result.ok ? 0 : 1);
  })();
  return;
}

// ── `slidey skill install [skill-name|all] [--user|--project]` ─────────────
// Copies bundled Slidey skills into a .claude/skills/ directory so Claude Code
// (or any agent that reads that convention) loads them automatically.
//   slidey skill install                  # install slidey-authoring here
//   slidey skill install slidey-debug     # install a specific bundled skill
//   slidey skill install all --user       # install every bundled skill globally
if (args[0] === 'skill') {
  if (args[1] !== 'install') {
    console.error('[slidey] usage: slidey skill install [skill-name|all] [--user|--project]');
    process.exit(1);
  }
  const toUser  = args.includes('--user');
  const flags = new Set(['--user', '--project']);
  const requested = args.slice(2).filter((arg) => !flags.has(arg));
  const skillNames = requested.length === 0
    ? ['slidey-authoring']
    : requested.flatMap((name) => name === 'all' ? bundledSkillNames() : [name]);
  const baseDir = toUser ? path.join(os.homedir(), '.claude') : path.join(process.cwd(), '.claude');
  const destRoot = path.join(baseDir, 'skills');
  try {
    fs.mkdirSync(destRoot, { recursive: true });
    for (const name of [...new Set(skillNames)]) {
      const srcDir = bundledSkillDir(name);
      if (!fs.existsSync(path.join(srcDir, 'SKILL.md'))) {
        throw new Error(`bundled skill not found: ${name}`);
      }
      const destDir = path.join(destRoot, name);
      fs.cpSync(srcDir, destDir, { recursive: true, force: true });
      console.log(`[slidey] Installed ${name} skill → ${destDir}`);
    }
    console.log(`[slidey] ${toUser ? 'Available in every project' : 'Available in this project'}. Restart your agent / Claude Code to load it.`);
    process.exit(0);
  } catch (err) {
    console.error(`[slidey] ERROR installing skill: ${err.message}`);
    process.exit(1);
  }
}

// ── `slidey convert <in.md> <out.json>` — Markdown/Marp to Slidey spec ─────
// Conservative importer for slide decks that already use Markdown slide
// separators. It preserves headings, bullets, tables, code fences, blockquotes,
// and image slides as native Slidey scenes.
if (args[0] === 'convert') {
  const inPath = args[1];
  if (!inPath) {
    console.error('[slidey] usage: slidey convert <input.md> [output.slidey.json]');
    process.exit(1);
  }
  // Default the output alongside the input as a `.slidey.json` spec — the
  // standard Slidey extension that the viewers and MCP tools auto-discover.
  const outPath = args[2] || path.join(
    path.dirname(inPath),
    path.basename(inPath, path.extname(inPath)) + '.slidey.json',
  );
  if (args[2] && !/\.slidey\.json$/i.test(outPath)) {
    console.warn(`[slidey] note: Slidey specs conventionally use the .slidey.json extension (got ${path.basename(outPath)}).`);
  }
  const absIn = path.resolve(inPath);
  const absOut = path.resolve(outPath);
  if (!fs.existsSync(absIn)) {
    console.error(`[slidey] ERROR: input file not found: ${absIn}`);
    process.exit(1);
  }
  try {
    const { convertMarkdownFile } = require('./markdown');
    const spec = convertMarkdownFile(absIn, absOut);
    const { valid, errors, count } = validateSpec(spec);
    if (!valid) {
      console.error(`[slidey] ERROR: generated invalid spec: ${count} problem(s)`);
      for (const line of errors) console.error(line);
      process.exit(1);
    }
    const types = spec.scenes.reduce((m, s) => {
      m[s.type] = (m[s.type] || 0) + 1;
      return m;
    }, {});
    console.log(`[slidey] Converted ${absIn} → ${absOut}`);
    console.log(`[slidey] Scenes: ${spec.scenes.length}  ${Object.entries(types).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    process.exit(0);
  } catch (err) {
    console.error(`[slidey] ERROR converting Markdown: ${err.message}`);
    process.exit(1);
  }
}

// ── `slidey localize ...` — deterministic locale overlays ─────────────────
if (args[0] === 'localize') {
  const sub = args[1];
  const opt = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : null;
  };
  try {
    if (sub === 'extract') {
      const basePath = args[2];
      const translatedPath = args[3];
      const locale = opt('--locale');
      const outPath = opt('--out');
      if (!basePath || !translatedPath || !locale || !outPath) {
        console.error('[slidey] usage: slidey localize extract <base.slidey.json> <translated.slidey.json> --locale <tag> --out <locale.slidey.locale.json>');
        process.exit(1);
      }
      const baseAbs = path.resolve(basePath);
      const translatedAbs = path.resolve(translatedPath);
      const outAbs = path.resolve(outPath);
      const overlay = extractLocale(readDeck(baseAbs), readDeck(translatedAbs), {
        locale,
        sourceLocale: opt('--source-locale') || 'en',
      });
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      fs.writeFileSync(outAbs, JSON.stringify(overlay, null, 2) + '\n', 'utf8');
      console.log(`[slidey] Locale overlay: ${outAbs}`);
      console.log(`[slidey] Entries: ${Object.keys(overlay.entries).length}  missing:${overlay.generatedFrom.missing.length} extra:${overlay.generatedFrom.extra.length}`);
      if (overlay.generatedFrom.missing.length || overlay.generatedFrom.extra.length) process.exit(2);
      process.exit(0);
    }

    if (sub === 'attach') {
      const basePath = args[2];
      const locale = opt('--locale');
      const overlayPath = opt('--overlay');
      const outPath = opt('--out') || basePath;
      if (!basePath || !locale || !overlayPath) {
        console.error('[slidey] usage: slidey localize attach <base.slidey.json> --locale <tag> --overlay <locale.slidey.locale.json> [--out <base.slidey.json>]');
        process.exit(1);
      }
      const baseAbs = path.resolve(basePath);
      const outAbs = path.resolve(outPath);
      const overlayRel = path.relative(path.dirname(outAbs), path.resolve(overlayPath));
      const spec = attachLocaleRef(readDeck(baseAbs), locale, overlayRel, {
        label: opt('--label') || locale,
        sourceLocale: opt('--source-locale') || undefined,
      });
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      fs.writeFileSync(outAbs, JSON.stringify(spec, null, 2) + '\n', 'utf8');
      console.log(`[slidey] Locale reference attached: ${outAbs} -> ${locale} (${overlayRel.replace(/\\/g, '/')})`);
      process.exit(0);
    }

    if (sub === 'build') {
      const basePath = args[2];
      const locale = opt('--locale');
      const outPath = opt('--out');
      if (!basePath || !locale || !outPath) {
        console.error('[slidey] usage: slidey localize build <base.slidey.json> --locale <tag> --out <localized.slidey.json>');
        process.exit(1);
      }
      const baseAbs = path.resolve(basePath);
      const localized = applyLocale(readDeck(baseAbs), locale, { specPath: baseAbs });
      const outAbs = path.resolve(outPath);
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      fs.writeFileSync(outAbs, JSON.stringify(stripRuntimeThemePacks(localized), null, 2) + '\n', 'utf8');
      console.log(`[slidey] Localized deck: ${outAbs}`);
      process.exit(0);
    }
  } catch (err) {
    console.error(`[slidey] ERROR localizing deck: ${err.message}`);
    process.exit(1);
  }
  console.error('[slidey] usage: slidey localize <extract|attach|build> ...');
  process.exit(1);
}

// ── `slidey validate <spec.json>` — schema + semantic check, no render ────
// Exits non-zero on any problem so it can gate CI / pre-bundle. Catches specs
// that PARSE as JSON but won't RENDER (e.g. a table scene with raw-array rows
// instead of {cells:[...]} objects, or a missing `variant`).
if (args[0] === 'validate') {
  const inPath = args[1];
  if (!inPath) {
    console.error('[slidey] usage: slidey validate <spec.json> [--deck <id>]');
    process.exit(1);
  }
  const deckIdxLocal = args.indexOf('--deck');
  const deckLocal = deckIdxLocal !== -1 ? args[deckIdxLocal + 1] : null;
  const absIn = path.resolve(inPath);
  if (!fs.existsSync(absIn)) {
    console.error(`[slidey] ERROR: input file not found: ${absIn}`);
    process.exit(1);
  }
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(absIn, 'utf8'));
  } catch (err) {
    console.error(`[slidey] ERROR: ${absIn} is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  {
    const inlined = inlineChildDeckFiles(spec, { specPath: absIn });
    spec = inlined.spec;
    if (inlined.errors.length) {
      console.error(`[slidey] INVALID: ${inlined.errors.length} child-deck file problem(s) in ${absIn}`);
      for (const line of inlined.errors) console.error(`  ${line}`);
      process.exit(1);
    }
  }
  if (localeOpt) {
    try {
      spec = applyLocale(spec, localeOpt, { specPath: absIn });
    } catch (err) {
      console.error(`[slidey] ERROR applying locale "${localeOpt}": ${err.message}`);
      process.exit(1);
    }
  }
  spec = attachRuntimeThemePacks(spec, absIn);
  const resolvedDeck = resolveDeckSpec(spec, { deckId: deckLocal || 'source' });
  for (const line of resolvedDeck.warnings || []) console.warn(`[slidey] warning:${line}`);
  if (resolvedDeck.errors && resolvedDeck.errors.length) {
    console.error(`[slidey] INVALID: ${resolvedDeck.errors.length} collection problem(s) in ${absIn}`);
    for (const line of resolvedDeck.errors) console.error(`  ${line}`);
    process.exit(1);
  }
  spec = resolvedDeck.spec;
  const { valid, errors, warnings, count } = validateSpec(spec, {
    specPath: absIn,
    skipLibrary: resolvedDeck.isCollection && !resolvedDeck.isSource,
  });
  for (const line of warnings || []) console.warn(`[slidey] warning:${line}`);
  if (!valid) {
    console.error(`[slidey] INVALID: ${count} problem(s) in ${absIn}`);
    for (const line of errors) console.error(line);
    process.exit(1);
  }
  const countLabel = resolvedDeck.isCollection && !resolvedDeck.isSource
    ? `deck ${resolvedDeck.deckId}, ${(spec.scenes || []).length} scene(s)`
    : `${(spec.scenes || []).length} scene(s)`;
  console.log(`[slidey] OK: ${absIn} (${countLabel})`);
  process.exit(0);
}

// ── `slidey bundle <in.json> <out.html>` — single-file interactive deck ────
if (args[0] === 'bundle') {
  const inPath = args[1];
  const outPath = args[2];
  if (!inPath || !outPath) {
    console.error('[slidey] usage: slidey bundle <input.json> <output.html>');
    process.exit(1);
  }
  const absIn = path.resolve(inPath);
  if (!fs.existsSync(absIn)) {
    console.error(`[slidey] ERROR: input file not found: ${absIn}`);
    process.exit(1);
  }
  let bundleInput = inPath;
  let localizedBundleDir = null;
  let localizedBundleSpec = null;
  if (localeOpt) {
    try {
      // Inline `library.decks[].src` child-deck files BEFORE writing the
      // localized copy to a temp dir: once inlined, the copy is fully
      // self-contained and needs no relative-path resolution of its own.
      const inlined = inlineChildDeckFiles(JSON.parse(fs.readFileSync(absIn, 'utf8')), { specPath: absIn });
      if (inlined.errors.length) {
        console.error(`[slidey] ERROR: ${absIn} has child-deck file problems:`);
        for (const line of inlined.errors) console.error(`  ${line}`);
        process.exit(1);
      }
      localizedBundleSpec = applyLocale(inlined.spec, localeOpt, { specPath: absIn });
      localizedBundleDir = mkdtemp('slidey-locale-');
      bundleInput = path.join(localizedBundleDir, path.basename(absIn));
      fs.writeFileSync(bundleInput, JSON.stringify(stripRuntimeThemePacks(localizedBundleSpec), null, 2) + '\n', 'utf8');
    } catch (err) {
      console.error(`[slidey] ERROR applying locale "${localeOpt}": ${err.message}`);
      process.exit(1);
    }
  }
  // Validate BEFORE bundling: a spec can parse as JSON yet contain scenes that
  // silently fail to render (the classic case: a table with raw-array rows and
  // no `variant`, which the viewer skips). Catch it here instead of shipping an
  // HTML deck with blank slides. Pass --skip-validate to bypass intentionally.
  if (!args.includes('--skip-validate')) {
    let spec;
    if (localizedBundleSpec) {
      spec = localizedBundleSpec;
    } else {
      try {
        spec = require('./rrweb-viewer').readSpecOrRrweb(absIn);
      } catch (err) {
        console.error(`[slidey] ERROR: ${absIn} is not valid JSON: ${err.message}`);
        process.exit(1);
      }
    }
    spec = attachRuntimeThemePacks(spec, absIn);
    const deckIdxLocal = args.indexOf('--deck');
    const deckLocal = deckIdxLocal !== -1 ? args[deckIdxLocal + 1] : null;
    const resolvedDeck = resolveDeckSpec(spec, { deckId: deckLocal });
    if (resolvedDeck.errors && resolvedDeck.errors.length) {
      console.error(`[slidey] ERROR: ${absIn} has collection errors:`);
      for (const line of resolvedDeck.errors) console.error(`  ${line}`);
      process.exit(1);
    }
    spec = resolvedDeck.spec;
    const { valid, errors, warnings, count } = validateSpec(spec, {
      specPath: absIn,
      skipLibrary: resolvedDeck.isCollection && !resolvedDeck.isSource,
    });
    for (const line of warnings || []) console.warn(`[slidey] warning:${line}`);
    if (!valid) {
      console.error(`[slidey] ERROR: ${absIn} is invalid (${count} problem(s)) — refusing to bundle a deck that won't render correctly. Fix these or pass --skip-validate:`);
      for (const line of errors) console.error(line);
      process.exit(1);
    }
  }
  const script = path.join(__dirname, '..', 'web', 'build-single.mjs');
  try {
    const buildArgs = [script, bundleInput, outPath];
    const deckIdxLocal = args.indexOf('--deck');
    if (deckIdxLocal !== -1 && args[deckIdxLocal + 1]) buildArgs.push('--deck', args[deckIdxLocal + 1]);
    if (localizedBundleSpec) buildArgs.push('--asset-base', path.dirname(absIn));
    require('child_process').execFileSync(process.execPath, buildArgs, { stdio: 'inherit' });
    if (localizedBundleDir) fs.rmSync(localizedBundleDir, { recursive: true, force: true });
    process.exit(0);
  } catch (err) {
    if (localizedBundleDir) fs.rmSync(localizedBundleDir, { recursive: true, force: true });
    process.exit(err.status || 1);
  }
}

// ── `slidey rrweb-repace <in.rrweb.json> <out.rrweb.json>` — readable pacing ──
// Stretch a captured rrweb tour so each distinct content reveal gets a minimum
// readable dwell (fixes the "last messages flash by" defect). Only adds time.
if (args[0] === 'rrweb-repace') {
  const inPath = args[1];
  const outPath = args[2];
  if (!inPath || !outPath) {
    console.error('[slidey] usage: slidey rrweb-repace <in.rrweb.json> <out.rrweb.json> [--min-dwell ms] [--max-dwell ms] [--per-char ms] [--coalesce ms] [--hold ms]');
    process.exit(1);
  }
  const numOpt = (flag) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : undefined; };
  const { repace } = require('./rrweb-repace');
  const fs = require('fs');
  const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const events = Array.isArray(raw) ? raw : (raw.events || []);
  const out = repace(events, {
    minDwellMs: numOpt('--min-dwell'),
    maxDwellMs: numOpt('--max-dwell'),
    msPerChar: numOpt('--per-char'),
    coalesceMs: numOpt('--coalesce'),
    holdMs: numOpt('--hold'),
  });
  const result = Array.isArray(raw) ? out : { ...raw, events: out };
  fs.writeFileSync(outPath, JSON.stringify(result));
  const t0 = events[0].timestamp, before = (events[events.length - 1].timestamp - t0) / 1000;
  const after = (out[out.length - 1].timestamp - t0) / 1000;
  console.error(`[slidey] re-paced ${inPath}: ${before.toFixed(1)}s -> ${after.toFixed(1)}s (${out.length} events) -> ${outPath}`);
  process.exit(0);
}

// ── `slidey rrweb-reveal <in.rrweb.json> <out.rrweb.json>` — followable scroll ─
// Replace a conversation clip's snap-to-bottom auto-scroll with an eased reveal
// track (hold + ease through each message), so the viewer can follow it. Fixes
// the "jumpy / can't see the user inputs" defect that a time-only re-pace can't.
if (args[0] === 'rrweb-reveal') {
  const inPath = args[1];
  const outPath = args[2];
  if (!inPath || !outPath) {
    console.error('[slidey] usage: slidey rrweb-reveal <in.rrweb.json> <out.rrweb.json> [--scroll-id N] [--hold ms] [--ease-min ms] [--ease-max ms] [--per-px ms] [--steps N] [--tail-hold ms]');
    process.exit(1);
  }
  const numOpt = (flag) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : undefined; };
  const { reveal } = require('./rrweb-reveal');
  const fs = require('fs');
  const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const events = Array.isArray(raw) ? raw : (raw.events || []);
  const out = reveal(events, {
    scrollId: numOpt('--scroll-id'),
    holdMs: numOpt('--hold'),
    easeMinMs: numOpt('--ease-min'),
    easeMaxMs: numOpt('--ease-max'),
    msPerPx: numOpt('--per-px'),
    steps: numOpt('--steps'),
    tailHoldMs: numOpt('--tail-hold'),
  });
  const result = Array.isArray(raw) ? out : { ...raw, events: out };
  fs.writeFileSync(outPath, JSON.stringify(result));
  const t0 = events[0].timestamp, before = (events[events.length - 1].timestamp - t0) / 1000;
  const after = (out[out.length - 1].timestamp - t0) / 1000;
  console.error(`[slidey] reveal-track ${inPath}: ${before.toFixed(1)}s -> ${after.toFixed(1)}s (${events.length} -> ${out.length} events) -> ${outPath}`);
  process.exit(0);
}

// ── `slidey drawio <input...> --out-dir <dir>` — Draw.io PNG/XML to SVG ───
// Converts Draw.io XML, or PNGs exported with an embedded `mxfile` chunk, into
// themed SVG diagrams suitable for image scenes and self-contained bundles.
if (args[0] === 'drawio') {
  const outIdx = args.indexOf('--out-dir');
  const extractIdx = args.indexOf('--extract-dir');
  const themeIdx = args.indexOf('--theme');
  const labelIdx = args.indexOf('--label');
  const outDir = outIdx !== -1 ? args[outIdx + 1] : null;
  const extractDir = extractIdx !== -1 ? args[extractIdx + 1] : null;
  const theme = themeIdx !== -1 ? args[themeIdx + 1] : 'rose-pine-moon';
  const label = labelIdx !== -1 ? args[labelIdx + 1] : null;
  const inputs = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (['--out-dir', '--extract-dir', '--theme', '--label'].includes(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    inputs.push(a);
  }
  if (!inputs.length || !outDir) {
    console.error('[slidey] usage: slidey drawio <input.png|input.drawio.xml...> --out-dir <dir> [--extract-dir <dir>] [--theme rose-pine-moon]');
    process.exit(1);
  }
  if (label && inputs.length !== 1) {
    console.error('[slidey] ERROR: --label can only be used with one Draw.io input');
    process.exit(1);
  }
  try {
    const { convertDrawioFile } = require('./drawio');
    for (const input of inputs) {
      const abs = path.resolve(input);
      if (!fs.existsSync(abs)) throw new Error(`input file not found: ${abs}`);
      const result = convertDrawioFile(abs, { outDir, extractDir, theme, label });
      console.log(`[slidey] drawio ${abs} → ${result.svgPath}  (${result.stats.vertices} vertices, ${result.stats.edges} edges, viewBox ${result.stats.viewBox.join(' ')})`);
      if (result.xmlPath) console.log(`[slidey] extracted XML → ${result.xmlPath}`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`[slidey] ERROR converting Draw.io: ${err.message}`);
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
  '--out-dir', '--extract-dir', '--theme', '--label', '--adapter', '--deck',
  '--locale', '--root',
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
const deckIdx   = args.indexOf('--deck');
const deckOpt   = deckIdx !== -1 ? args[deckIdx + 1] : null;
const rootIdx   = args.indexOf('--root');
const rootOpt   = rootIdx !== -1 ? args[rootIdx + 1] : null;
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
    // --root <dir>: widen the served workspace root past the spec's own
    // folder (default). Needed when a spec references assets via a literal
    // "../" path instead of a symlink placed inside the spec's folder — see
    // safeResolveAsset() in serve.js for the full asset-serving posture.
    let servedRoot = viewerRoot;
    let servedOpenFile = openFile;
    if (rootOpt) {
      const widerRoot = path.resolve(rootOpt);
      if (!fs.existsSync(widerRoot) || !fs.statSync(widerRoot).isDirectory()) {
        console.error(`[slidey] ERROR: --root is not a directory: ${widerRoot}`);
        process.exit(1);
      }
      // openFile/viewerRoot were computed relative to the spec's own folder;
      // re-anchor both to the wider root so /api/spec + asset lookups resolve.
      if (openFile) {
        servedOpenFile = path.relative(widerRoot, path.join(viewerRoot, openFile)).split(path.sep).join('/');
      }
      servedRoot = widerRoot;
    }
    require('./serve').startViewer({
      root: servedRoot,
      openFile: servedOpenFile,
      deckId: deckOpt,
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
    '    node index.js <input.json|input.rrweb.json>          open the viewer on one deck or rrweb log',
    '    node index.js convert <input.md> [output.slidey.json]  convert Markdown/Marp slides to Slidey JSON',
    '    node index.js bundle <input.json|input.rrweb.json> <output.html>',
    '                                                          build a self-contained interactive HTML deck/viewer',
    '    node index.js localize extract <base> <translated> --locale <tag> --out <overlay>',
    '    node index.js localize build <base> --locale <tag> --out <localized>',
    '    node index.js drawio <input...> --out-dir <dir>       convert Draw.io PNG/XML to themed SVG',
    '    node index.js capture <tour.json> <out.mp4>         record a demo MP4 + chapter sidecar from a tour',
    '    node index.js capture --tours <tour-set.json>       record MANY tours off ONE shared launched target',
    '    node index.js doctor                                verify export dependencies',
    '    slidey docs                                          print the authoring guide (for LLMs/agents)',
    '    slidey skill install [skill-name|all] [--user|--project]  install bundled Slidey agent skills',
    '',
    '  Viewer options:',
    '    --port <n>                 Viewer port (default: 4321; auto-increments if taken)',
    '    --no-open                  Do not launch the browser; just print the URL',
    '    --deck <id>                Open a named library deck when the spec is a collection',
    '    --root <dir>               Serve assets from <dir> instead of just the spec\'s',
    '                               own folder (widens literal "../" asset references).',
    '',
    '  Draw.io options:',
    '    --out-dir <dir>            Directory for generated SVG files',
    '    --extract-dir <dir>        Also write embedded Draw.io XML from PNG inputs',
    '    --theme <name>             SVG theme (default: rose-pine-moon)',
    '    --label <text>             Accessible SVG label for a single input',
    '',
    '  Doctor options:',
    '    --no-narration             Check silent video/PDF/PNG setup only',
    '    --no-tts-sample            Check edge-tts is installed without making a network TTS call',
    '    --no-browser               Skip the headless browser launch check',
    '    --voice <id>               Voice to test for the TTS sample (default en-AU-NatashaNeural)',
    '    --json                     Print machine-readable doctor output',
    '',
    '  Render options:',
    '    --fps <n>                  Frames per second (default: 30)',
    '    --context key=value        Override a template variable (repeatable)',
    '    --locale <tag>             Apply a deterministic locale overlay before validate/list/render/bundle',
    '    --keep-frames              Keep temp frame directory after render',
    '    --frames-dir <path>        Use this directory for frames instead of a temp dir',
    '    --capture-log <file>       Write live HTTP responses to JSON (for playback freeze)',
    '    --scenes <spec>            Render only the listed scenes (zero-indexed).',
    '                               Spec: comma-separated indices and/or ranges,',
    '                               e.g.  --scenes 4     --scenes 0,3-5,7',
    '                               Selected scenes are still combined into one MP4.',
    '    --deck <id>                For a collection spec, render a named library deck',
    '                               instead of the source deck. Subset decks are resolved',
    '                               from the same source scenes at render time.',
    '    --list                     Print the scene index + duration table; no render.',
    '    --estimate                 Like --list, plus narration audio-length estimates',
    '                               and overrun warnings. Catches budget issues',
    '                               BEFORE a full ~7-12min render.',
    '    --estimate --json          With --estimate: print ONE JSON document (per-cue',
    '                               audioSec + scene/spec-level flags) to stdout instead',
    '                               of the human table; nothing else touches stdout.',
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
    '    node index.js examples/hello.slidey.json out.mp4',
    '    node index.js examples/hello.slidey.json out.mp4 --estimate',
    '    node index.js examples/hello.slidey.json out.mp4 --scenes 0,2-3 --no-gaps',
    '    node index.js spec.slidey.json out.mp4 --context host=stand.example.com',
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
const adapterIdx    = args.indexOf('--adapter');
const adapterOpt    = adapterIdx !== -1 ? args[adapterIdx + 1] : null;
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

/**
 * Build the `--estimate --json` document: per-cue audio estimates plus the
 * same class of overrun/tight-margin warnings printSceneList prints today,
 * structured as scene-level and top-level `flags` arrays (mockup-demo-
 * tooling-contract.md §1). `scene.flags` covers that scene's narration
 * margin; the top-level `flags` carries spec/collection/validation-level
 * warnings (already surfaced on stderr by the caller) — NOT a duplicate of
 * every scene flag. "Zero flags (both arrays, all scenes)" is exactly the
 * condition under which printSceneList would show no "scene(s) flagged"
 * line and no COLLECTION/VALIDATION WARNING lines today.
 *
 * Per-cue audioSec is computed the same way printSceneList's single
 * flattened-text estimate is (estimateAudioSeconds after applyPronunciations)
 * — just per cue instead of on the joined string. A scene's margin uses the
 * SUM of its cues' audioSec, which is numerically identical to estimating
 * the flattened joined text: word-count is invariant to concatenation as
 * long as cues stay separated by whitespace (printSceneList joins with a
 * single space), so `sum(words_i)/WPS === words(joined)/WPS`.
 *
 * @param {object} spec
 * @param {number} fps
 * @param {object} opts          passed straight through to estimateBoundaries
 * @param {string} absSpecPath   absolute path of the input spec (for `spec`)
 * @param {string[]} [specWarnings]  spec-level warning strings already printed
 * @returns {{ spec: string, scenes: object[], flags: string[] }}
 */
function buildEstimateJson(spec, fps, opts, absSpecPath, specWarnings = []) {
  const boundaries = estimateBoundaries(spec, null, opts);
  const pronunciations = (spec.meta && spec.meta.narration && spec.meta.narration.pronunciations) || null;
  const round1 = (n) => Math.round(n * 10) / 10;

  const scenes = boundaries.map((b) => {
    const sceneSec = b.durationFrames / fps;
    const sourceScene = spec.scenes[b.sceneIndex] || {};
    const cueCount = Array.isArray(b.narration) ? b.narration.length : 0;

    let narration;
    if (cueCount) {
      narration = b.narration.map((c) => {
        const text = (c && c.text) || '';
        const words = text ? String(text).trim().split(/\s+/).filter(Boolean).length : 0;
        const audioSec = text ? estimateAudioSeconds(applyPronunciations(text, pronunciations)) : 0;
        return { chapter: (c && c.chapter) || null, text, words, audioSec: round1(audioSec) };
      });
    } else if (typeof b.narration === 'string' && b.narration) {
      const text = b.narration;
      const words = String(text).trim().split(/\s+/).filter(Boolean).length;
      const audioSec = estimateAudioSeconds(applyPronunciations(text, pronunciations));
      narration = [{ chapter: null, text, words, audioSec: round1(audioSec) }];
    } else {
      narration = [];
    }

    const flags = [];
    const hasNarration = narration.some((c) => c.text);
    if (hasNarration) {
      const totalAudioSec = narration.reduce((s, c) => s + c.audioSec, 0);
      const margin = sceneSec - totalAudioSec;
      if (margin < 0) {
        flags.push(`narration overruns scene by ${(-margin).toFixed(1)}s`);
      } else if (margin < 0.6) {
        flags.push(`narration margin tight: ${margin.toFixed(1)}s (audio ${totalAudioSec.toFixed(1)}s of ${sceneSec.toFixed(1)}s scene)`);
      }
    }

    return {
      index: b.sceneIndex,
      type: b.type,
      title: sourceScene.title || null,
      durationSec: round1(sceneSec),
      narration,
      flags,
    };
  });

  return { spec: absSpecPath, scenes, flags: specWarnings.slice() };
}

// ── `slidey capture <tour.json> <out.mp4>` ──────────────────────────────────
//
// Drive a live web app through a tour storyboard and record a deterministic
// demo MP4 + chapter sidecar (the generalized successor to kitsoki's per-app
// Playwright recording specs). The same engine backs the `video` deck scene's
// `capture:` field. See src/tour/.
//
// `slidey capture --tours <tour-set.json>` is the multi-tour sibling: many
// tours captured off ONE shared launched target instead of one server spawn
// per tour. See src/tour/tour-set.js for the orchestration (loadTourSet /
// resolveTourEntry / runTourSet) — this is a thin CLI wrapper around it.
async function runCaptureTourSet(tourSetPath) {
  if (!tourSetPath) {
    console.error('[slidey] usage: slidey capture --tours <tour-set.json> [--format rrweb] [--pace n]');
    process.exit(1);
  }
  const { loadTourSet, runTourSet } = require('./tour/tour-set');
  let tourSet, setDir;
  try {
    ({ tourSet, setDir } = loadTourSet(tourSetPath));
  } catch (err) {
    console.error(`[slidey] ERROR: ${err.message}`);
    process.exit(1);
  }
  console.log(`[slidey] Tour-set: ${path.resolve(tourSetPath)}`);
  console.log(`[slidey] Tours   : ${tourSet.tours.length}\n`);

  try {
    const results = await runTourSet(tourSet, setDir, {
      cliDefaults: { format: formatOpt, pace: paceOpt != null ? paceOpt : undefined },
      fps,
      onEntryStart: (i, total, entry) => {
        console.log(`[slidey] [${i + 1}/${total}] ${entry.tour} → ${entry.out}`);
      },
      onProgress: (idx, label) => {
        process.stdout.write(`\r[slidey] capture: ${String(label).padEnd(28)} step ${idx}`);
      },
    });
    process.stdout.write('\n');
    for (const r of results) {
      const outFile = r.isRrweb ? r.result.rrweb : r.result.mp4;
      console.log(`[slidey] Done → ${outFile}`);
      if (r.result.sidecar) console.log(`[slidey] Chapters → ${r.result.sidecar}  (${r.result.chapters.length})`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`\n[slidey] ERROR during tour-set capture: ${err.message}`);
    process.exit(1);
  }
}

async function runCapture() {
  const toursIdx = args.indexOf('--tours');
  if (toursIdx !== -1) { await runCaptureTourSet(args[toursIdx + 1]); return; }

  const tourPath = args[1];
  const outPath  = args[2];
  if (!tourPath || !outPath) {
    console.error('[slidey] usage: slidey capture <tour.json> <out.mp4|out.rrweb.json> [--format rrweb] [--fps n] [--pace n] [--keep-frames] [--adapter <name|module.cjs>]');
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

  // --adapter overrides tour.adapter. A registered name passes through; a path is
  // resolved against CWD here (CLI ergonomics) so the spec-relative resolver in
  // resolveAdapter receives an absolute, already-correct path.
  if (adapterOpt) {
    const pathish = adapterOpt.includes('/') || adapterOpt.endsWith('.js') || adapterOpt.endsWith('.cjs');
    tour.adapter = pathish ? path.resolve(adapterOpt) : adapterOpt;
  }

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

  // `--estimate --json` prints ONE JSON document to stdout — every other
  // progress/status line below that would normally go to stdout is routed to
  // stderr instead in that mode (see wantsJsonEstimate, computed up top).
  const out = (msg) => { if (!wantsJsonEstimate) console.log(msg); else console.error(msg); };
  const specWarnings = [];

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
      out(`[slidey] Trace  : ${spec.scenes.length} scenes generated from ${path.basename(absInput)}`);
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
    const inlined = inlineChildDeckFiles(spec, { specPath: absInput });
    spec = inlined.spec;
    if (inlined.errors.length) {
      console.error(`[slidey] ERROR: ${absInput} has child-deck file problems:`);
      for (const line of inlined.errors) console.error(`  ${line}`);
      process.exit(1);
    }
  }

  if (localeOpt && !fromTrace) {
    try {
      spec = applyLocale(spec, localeOpt, { specPath: absInput });
      out(`[slidey] Locale: ${localeOpt}`);
    } catch (err) {
      console.error(`[slidey] ERROR applying locale "${localeOpt}": ${err.message}`);
      process.exit(1);
    }
  } else if (localeOpt && fromTrace) {
    console.error('[slidey] ERROR: --locale is only supported for JSON deck specs, not generated trace decks');
    process.exit(1);
  }

  if (!spec.scenes || !Array.isArray(spec.scenes) || spec.scenes.length === 0) {
    console.error('[slidey] ERROR: spec must have a non-empty "scenes" array');
    process.exit(1);
  }
  spec = attachRuntimeThemePacks(spec, absInput);

  const resolvedDeck = resolveDeckSpec(spec, { deckId: deckOpt });
  for (const line of resolvedDeck.warnings || []) {
    console.error(`[slidey] COLLECTION WARNING: ${line}`);
    specWarnings.push(line);
  }
  if (resolvedDeck.errors && resolvedDeck.errors.length) {
    console.error(`[slidey] COLLECTION ERROR: ${resolvedDeck.errors.length} problem(s) found in ${path.basename(absInput)}\n`);
    for (const line of resolvedDeck.errors) console.error(`  ${line}`);
    process.exit(1);
  }
  if (resolvedDeck.isCollection && !resolvedDeck.isSource) {
    out(`[slidey] Deck   : ${resolvedDeck.deckId} (${resolvedDeck.spec.scenes.length}/${(spec.scenes || []).length} source scenes)`);
  }
  spec = resolvedDeck.spec;

  // ── JSON Schema validation (always; exits on failure) ─────────────────────
  {
    const { valid, errors, warnings, count } = validateSpec(spec, {
      specPath: absInput,
      skipLibrary: resolvedDeck.isCollection && !resolvedDeck.isSource,
    });
    if (warnings && warnings.length) {
      for (const line of warnings) {
        console.error(`[slidey] VALIDATION WARNING: ${line.trim()}`);
        specWarnings.push(line.trim());
      }
    }
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
    out(`[slidey] Context overrides: ${JSON.stringify(cliContext)}`);
  }

  // Trace → .json output: dump the generated spec for inspection / hand-tweaking,
  // then exit. Re-run the .json the normal way to render it. (No-op for non-trace
  // input — a .json output there would be the input itself.)
  if (fromTrace && !wantsList && outputPath && /\.json$/i.test(outputPath)) {
    const absOut = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, JSON.stringify(stripRuntimeThemePacks(spec), null, 2) + '\n', 'utf-8');
    console.log(`[slidey] Spec written → ${absOut}  (${spec.scenes.length} scenes)`);
    process.exit(0);
  }

  // ── --list / --estimate: print scene table and exit, no rendering ──
  if (wantsList) {
    const wantsAudioEstimate = args.includes('--estimate');
    if (wantsJsonEstimate) {
      const doc = buildEstimateJson(spec, fps, { noGaps, specPath: absInput }, absInput, specWarnings);
      process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
      process.exit(0);
    }
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
    framesDir = mkdtemp('slidey-');
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
  //
  // A deck with narration should not silently produce a no-audio MP4. If TTS is
  // unavailable or fails, stop after rendering frames with a clear error so the
  // operator can fix the voice/network/tooling issue and rerun.
  let audioSegments = null;
  const hasNarration = hasNarrationText(sceneBoundaries);
  const audioDir = path.join(framesDir, 'audio');
  const narrationMeta = (spec.meta && spec.meta.narration) || {};
  const narrationVoice = narrationMeta.voice || DEFAULT_VOICE;
  if (hasNarration && !edgeTtsAvailable()) {
    console.error(
      '[slidey] ERROR: narration requested, but `edge-tts` was not found on PATH.\n' +
      '[slidey]        This deck has narration, so refusing to assemble a silent MP4.\n' +
      '[slidey]        Install: pipx install edge-tts  # or: python3 -m pip install --user edge-tts\n' +
      `[slidey]        Check:   slidey doctor --voice ${narrationVoice}`
    );
    if (!keepFrames && ownFramesDir) fs.rmSync(framesDir, { recursive: true, force: true });
    process.exit(1);
  } else if (hasNarration) {
    console.log('[slidey] Generating narration audio…');
    try {
      audioSegments = generateNarration(
        sceneBoundaries, fps, frameCount,
        narrationMeta,
        audioDir,
      );
    } catch (err) {
      console.error(
        `[slidey] ERROR: narration failed. Refusing to assemble a silent video for a narrated deck.\n${err.message}\n` +
        `[slidey] Check: slidey doctor --voice ${narrationVoice}`
      );
      if (!keepFrames && ownFramesDir) fs.rmSync(framesDir, { recursive: true, force: true });
      process.exit(1);
    }
    if (!audioSegments || audioSegments.length === 0) {
      console.error('[slidey] ERROR: narration requested, but no audio segments were generated.');
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

#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  alignCuesToScenes,
  applyNarrationOperations,
  formatSeconds,
  makeNarrationOperations,
  parseTimestamp,
  parseVtt,
  sceneWindows,
} = require('../src/teams-vtt');

function usage() {
  console.log([
    'Usage:',
    '  node tools/teams-vtt-to-narration.js --deck deck.slidey.json --vtt transcript.vtt [options]',
    '',
    'Options:',
    '  --speaker NAME          Only use cues from a speaker. Matching is case-insensitive and allows substrings.',
    '  --offset TIME           Transcript timestamp for deck time zero. Default: 0.',
    '  --scale NUMBER          Transcript seconds per deck second. Default: 1.',
    '  --anchor A=B            Timeline anchor. A is deck seconds or scene index; B is transcript time.',
    '                          Repeat for two or more anchors to correct live-presentation drift.',
    '                          Example: --anchor 0=00:02:13.500 --anchor 88=00:18:20.000',
    '  --fps NUMBER            Deck frame rate. Default: 30.',
    '  --min-words NUMBER      Minimum words before writing narration for a scene. Default: 1.',
    '  --patch-out FILE        Write JSON Patch operations.',
    '  --out FILE              Write an updated deck JSON to a new file.',
    '  --apply                 Rewrite the deck in place.',
    '  --list-speakers         Print speakers found in the VTT and exit.',
    '  --help                  Show this help.',
  ].join('\n'));
}

function parseArgs(argv) {
  const opts = { anchors: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const readValue = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[++i];
    };

    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--deck') opts.deck = readValue();
    else if (arg === '--vtt') opts.vtt = readValue();
    else if (arg === '--speaker') opts.speaker = readValue();
    else if (arg === '--offset') opts.offset = parseTimestamp(readValue());
    else if (arg === '--scale') opts.scale = Number(readValue());
    else if (arg === '--anchor') opts.anchors.push(readValue());
    else if (arg === '--fps') opts.fps = Number(readValue());
    else if (arg === '--min-words') opts.minWords = Number(readValue());
    else if (arg === '--patch-out') opts.patchOut = readValue();
    else if (arg === '--out') opts.out = readValue();
    else if (arg === '--apply') opts.apply = true;
    else if (arg === '--list-speakers') opts.listSpeakers = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return opts;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolvePath(file) {
  return path.resolve(process.cwd(), file);
}

function parseAnchor(raw, windows) {
  const [left, right] = String(raw).split('=');
  if (!left || !right) throw new Error(`invalid anchor ${raw}; expected A=B`);

  let deck;
  if (/^\d+$/.test(left.trim())) {
    const sceneIndex = Number(left.trim());
    const scene = windows.find((candidate) => candidate.sceneIndex === sceneIndex);
    if (!scene) throw new Error(`anchor references missing scene ${sceneIndex}`);
    deck = scene.start;
  } else {
    deck = parseTimestamp(left);
  }

  return { deck, transcript: parseTimestamp(right) };
}

function uniqueSpeakers(cues) {
  return Array.from(new Set(cues.map((cue) => cue.speaker).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function printSummary(result, operations, opts) {
  const { mapping, scenes, unmatched } = result;
  console.log(`[teams-vtt] ${operations.length} scene narration update(s) proposed`);
  console.log(`[teams-vtt] timeline: transcript = ${mapping.intercept.toFixed(3)} + ${mapping.slope.toFixed(6)} * deck`);
  if (opts.speaker) console.log(`[teams-vtt] speaker filter: ${opts.speaker}`);
  if (unmatched.length) console.log(`[teams-vtt] unmatched cue(s): ${unmatched.length}`);
  console.log('');
  console.log('  #  type           deck range          words  narration');
  console.log('  ' + '-'.repeat(78));
  for (const scene of scenes) {
    if (!scene.text) continue;
    const title = scene.title || scene.type;
    const sample = scene.text.length > 78 ? `${scene.text.slice(0, 77)}...` : scene.text;
    const range = `${formatSeconds(scene.start)}-${formatSeconds(scene.end)}`.padEnd(19);
    console.log(`  ${String(scene.sceneIndex).padStart(2)} ${scene.type.padEnd(13)} ${range} ${String(scene.words).padStart(5)}  ${title}: ${sample}`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  if (!opts.deck || !opts.vtt) {
    usage();
    process.exitCode = 2;
    return;
  }

  const deckPath = resolvePath(opts.deck);
  const vttPath = resolvePath(opts.vtt);
  const spec = readJson(deckPath);
  const cues = parseVtt(fs.readFileSync(vttPath, 'utf8'));

  if (opts.listSpeakers) {
    const speakers = uniqueSpeakers(cues);
    if (!speakers.length) console.log('[teams-vtt] no speaker labels found');
    else speakers.forEach((speaker) => console.log(speaker));
    return;
  }

  const fps = opts.fps || 30;
  const windows = sceneWindows(spec, fps);
  const anchors = opts.anchors.map((anchor) => parseAnchor(anchor, windows));
  const result = alignCuesToScenes(spec, cues, {
    anchors,
    fps,
    minWords: opts.minWords,
    offset: opts.offset,
    scale: opts.scale,
    speaker: opts.speaker,
  });
  const operations = makeNarrationOperations(spec, result.scenes, {
    minWords: opts.minWords,
  });

  printSummary(result, operations, opts);

  if (opts.patchOut) {
    fs.writeFileSync(resolvePath(opts.patchOut), `${JSON.stringify(operations, null, 2)}\n`);
  }

  if (opts.out || opts.apply) {
    const updated = applyNarrationOperations(spec, operations);
    const outPath = opts.apply ? deckPath : resolvePath(opts.out);
    fs.writeFileSync(outPath, `${JSON.stringify(updated, null, 2)}\n`);
    console.log(`\n[teams-vtt] wrote ${outPath}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`[teams-vtt] ERROR: ${err.message}`);
    process.exitCode = 1;
  }
}

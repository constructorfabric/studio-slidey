// Pre-renders narration audio for a single-file build (see build-single.mjs)
// so a published deck has working narration + reveal timing offline, with no
// edge-tts endpoint to call at view time.
//
// Enumerates every deck in the spec (the root/source deck plus every entry
// under library.decks[], recursively), computes the exact cue text each deck
// would request at narration-preview time (narrationItemsForScene /
// speechTextForScene from narration.mjs — the SAME functions App.vue uses, so
// a pre-rendered clip always lines up with what the live preview would ask
// for), synthesizes each unique (text, voice, rate) via the edge-tts CLI, and
// returns a lookup table embeddable as window.__SLIDEY_NARRATION_AUDIO__.
//
// If edge-tts isn't installed, this degrades to returning an empty table —
// the published build then falls back to the old silent/fixed-delay reveal
// pacing (see App.vue's playRevealStepsWithoutNarration) rather than failing
// the publish. Narration is additive, same philosophy as src/narration.js's
// MP4 pipeline.
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { narrationItemsForScene, speechTextForScene } from './narration.mjs';

const require = createRequire(import.meta.url);
const { resolveDeckSpec, normalizeDeckDefinitions, SOURCE_DECK_ID } = require('../src/collections.js');
const { synthesizeOne, edgeTtsAvailable, applyPronunciations } = require('../src/narration.js');
const { normalizeMeta } = require('../src/narration-preview.js');

// Every scene a deck's narration could actually be requested for, regardless
// of scene type — mirrors the branching in App.vue's runLiveNarrationForCurrent
// (video scenes speak scene.narration directly; everything else goes through
// narrationItemsForScene, whose wholeSceneText branch already covers scenes
// with no reveal steps, title included).
function narrationTextsForScene(scene) {
  const { items, wholeSceneText } = narrationItemsForScene(scene);
  const texts = items.map(item => item.cue).filter(Boolean);
  if (wholeSceneText) texts.push(wholeSceneText);
  return texts;
}

// { id, spec } for the root/source deck plus every real (non-source) deck
// defined under library.decks[], each with its own resolved scenes + merged
// meta (mirrors what the viewer's deck picker can switch to at runtime).
function allDeckSpecs(spec) {
  const decks = [{ id: SOURCE_DECK_ID, spec }];
  for (const d of normalizeDeckDefinitions(spec)) {
    if (d.source) continue;
    const resolved = resolveDeckSpec(spec, { deckId: d.id });
    if (resolved.isSource) continue; // deckId didn't resolve to a real deck
    decks.push({ id: d.id, spec: resolved.spec });
  }
  return decks;
}

export async function buildNarrationAudioTable(spec, { log = () => {} } = {}) {
  if (!edgeTtsAvailable()) {
    log('[build-single] edge-tts not found on PATH — publishing without narration audio (see docs/decks/README.md / slidey README "Publishing" section).');
    return {};
  }

  // key -> spokenText, so identical narration reused across decks/scenes only
  // gets synthesized once.
  const requests = new Map();
  for (const { spec: deckSpec } of allDeckSpecs(spec)) {
    const meta = normalizeMeta((deckSpec.meta && deckSpec.meta.narration) || {});
    for (const scene of deckSpec.scenes || []) {
      for (const text of narrationTextsForScene(scene)) {
        const key = JSON.stringify({ text, voice: meta.voice, rate: meta.rate });
        if (!requests.has(key)) {
          requests.set(key, { text: applyPronunciations(text, meta.pronunciations), voice: meta.voice, rate: meta.rate });
        }
      }
    }
  }
  if (!requests.size) return {};

  log(`[build-single] synthesizing narration audio for ${requests.size} unique cue(s) via edge-tts…`);
  const tmpDir = mkdtempSync(join(tmpdir(), 'slidey-narration-'));
  const table = {};
  let i = 0;
  try {
    for (const [key, { text, voice, rate }] of requests) {
      i += 1;
      const audioPath = join(tmpDir, `cue-${i}.mp3`);
      try {
        synthesizeOne(text, audioPath, voice, rate);
        table[key] = { audioBase64: readFileSync(audioPath).toString('base64'), mime: 'audio/mpeg' };
      } catch (err) {
        log(`[build-single] WARNING: narration synthesis failed for one cue (voice ${voice}), leaving it un-narrated: ${err.message}`);
      }
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  log(`[build-single] embedded ${Object.keys(table).length}/${requests.size} narration clip(s).`);
  return table;
}

'use strict';

/**
 * SLIDEY — scene/deck addressing
 *
 * A spec's addressable scenes live in two places: the top-level `scenes[]`
 * array, and every `library.decks[]` entry whose `deckType` is `"hierarchy"`
 * (a hierarchy deck owns its own inline scene objects — a "subset"/"view"
 * deck only references scenes that already live in one of those two places,
 * so it is never a distinct source of scenes and is intentionally NOT walked
 * here).
 *
 * Tools that used to only understand a bare numeric `sceneIndex` into the
 * top-level array (render_png, render_html, contact_sheet, check, ...) go
 * through `resolveSceneAddress` so they can ALSO accept:
 *   - a scene id string (searched across every addressable scene; unambiguous
 *     bare ids resolve without a deck, ambiguous ones throw listing the
 *     candidates)
 *   - an optional `deck` (a library deck id) that scopes the lookup to that
 *     deck's own scenes, by index or id
 *
 * This module is the single place that walks `library.decks[]` for scene
 * addressing so every MCP tool (and the CLI, if it grows the same need) shares
 * one definition of "every scene this spec has."
 */

const { normalizeDeckDefinitions, resolveDeckSpec, cloneJson } = require('./collections');

function localSceneItems(raw) {
  return raw && Array.isArray(raw.scenes) ? raw.scenes : [];
}

function sceneIdOf(scene, index) {
  if (scene && scene.id != null) return String(scene.id);
  if (scene && scene.key != null) return String(scene.key);
  return String(index);
}

/**
 * Every scene this spec can address, flattened: top-level scenes (deckId:
 * null) plus every hierarchy library deck's own inline scenes (deckId: that
 * deck's id). Each entry also carries `index` — its position within its own
 * scope (top-level array, or that deck's local `scenes[]`) — which is what
 * `resolveDeckSpec({deckId}).spec.scenes` will also index by, so a resolved
 * entry's `index` is directly usable as a sceneIndex once scoped to its deck.
 */
function addressableScenes(spec) {
  const sourceScenes = Array.isArray(spec && spec.scenes) ? spec.scenes : [];
  const decks = normalizeDeckDefinitions(spec);
  const entries = [];

  sourceScenes.forEach((scene, index) => {
    if (!scene || typeof scene !== 'object') return;
    entries.push({ scene, deckId: null, deckTitle: null, deckType: 'source', index, id: sceneIdOf(scene, index) });
  });

  for (const deck of decks) {
    if (deck.source || deck.deckType !== 'hierarchy') continue;
    localSceneItems(deck.raw).forEach((item, index) => {
      if (!item || typeof item !== 'object' || !item.type) return;
      entries.push({ scene: item, deckId: deck.id, deckTitle: deck.title || deck.id, deckType: deck.deckType, index, id: sceneIdOf(item, index) });
    });
  }

  return { entries, decks };
}

function knownDeckIds(decks) {
  return decks.filter((d) => !d.source).map((d) => d.id);
}

/**
 * Resolve a {sceneIndex|scene, deck} addressing request against a spec into
 * `{ spec, sceneIndex, deckId, deckTitle }`:
 *   - `spec.scenes[sceneIndex]` is always the addressed scene — callers that
 *     already index into `spec.scenes` (loadRenderPage, contact sheets, ...)
 *     need no other change.
 *   - `deckId`/`deckTitle` are null when the address resolved to a top-level
 *     scene, otherwise the library deck it came from.
 *
 * Back-compat: an integer `sceneIndex` with no `deck` is honored exactly as
 * before — an index into the top-level `scenes[]` array, unchecked here (the
 * caller still range-checks it, same as pre-existing behavior).
 */
function resolveSceneAddress(spec, { sceneIndex, scene: sceneRefRaw, deck: deckIdRaw } = {}) {
  const sceneRef = sceneRefRaw != null ? sceneRefRaw : sceneIndex;
  const deckId = deckIdRaw != null ? String(deckIdRaw) : null;

  if (deckId) {
    const resolved = resolveDeckSpec(spec, { deckId });
    if (!resolved.deck || resolved.deck.id !== deckId) {
      const known = knownDeckIds(resolved.decks || []);
      throw new Error(`unknown library deck "${deckId}"${known.length ? ` — known decks: ${known.join(', ')}` : ''}`);
    }
    const scenes = resolved.spec.scenes || [];
    let index;
    if (sceneRef == null) {
      throw new Error('scene or sceneIndex is required');
    } else if (Number.isInteger(sceneRef)) {
      index = sceneRef;
    } else {
      const ref = String(sceneRef);
      index = scenes.findIndex((s, i) => sceneIdOf(s, i) === ref);
      if (index === -1) {
        const ids = scenes.map((s, i) => sceneIdOf(s, i));
        throw new Error(`scene "${ref}" not found in deck "${deckId}" (${scenes.length} scene(s): ${ids.join(', ')})`);
      }
    }
    if (!Number.isInteger(index) || index < 0 || index >= scenes.length) {
      throw new Error(`sceneIndex must be between 0 and ${Math.max(0, scenes.length - 1)} for deck "${deckId}"`);
    }
    return { spec: resolved.spec, sceneIndex: index, deckId, deckTitle: resolved.deck.title || deckId };
  }

  if (sceneRef == null) {
    throw new Error('scene or sceneIndex is required');
  }

  if (Number.isInteger(sceneRef)) {
    // Legacy behavior: a bare integer with no deck indexes the top-level
    // scenes[] array, exactly as every MCP tool did before deck addressing.
    return { spec, sceneIndex: sceneRef, deckId: null, deckTitle: null };
  }

  const ref = String(sceneRef);
  const { entries } = addressableScenes(spec);
  const matches = entries.filter((e) => e.id === ref);
  if (!matches.length) {
    throw new Error(`scene "${ref}" not found in top-level scenes or any library deck`);
  }
  if (matches.length > 1) {
    const candidates = matches
      .map((m) => (m.deckId ? `deck:${m.deckId}#${m.id}` : `(top-level)#${m.id}`))
      .join(', ');
    throw new Error(`scene id "${ref}" is ambiguous across decks — pass "deck" to disambiguate: ${candidates}`);
  }

  const match = matches[0];
  if (!match.deckId) {
    return { spec, sceneIndex: match.index, deckId: null, deckTitle: null };
  }
  return resolveSceneAddress(spec, { scene: ref, deck: match.deckId });
}

module.exports = { addressableScenes, resolveSceneAddress, sceneIdOf, cloneJson };

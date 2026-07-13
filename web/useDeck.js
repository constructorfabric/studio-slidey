// SLIDEY — interactive deck navigation
//
// Flattens a spec into a linear list of reveal positions (one per reveal step,
// using the shared web/sceneSteps.mjs model) and drives the window.slidey
// adapter as the user steps forward/back. Re-applies a scene from its start on
// every position so backward navigation is exact (cumulative reveals replay).

import { reactive } from 'vue';
import { stepsForScene, applyShow } from './sceneSteps.mjs';

export function resolveAssetHref(src, specBaseUrl = '', fallbackUrl = '') {
  if (!src) return '';
  try {
    return new URL(src, specBaseUrl || fallbackUrl || window.location.href).href;
  } catch (_) {
    return src;
  }
}

export function createDeck(spec, specBaseUrl = '') {
  let scenes = Array.isArray(spec.scenes) ? spec.scenes : [];
  const buildFlat = (nextScenes) => {
    const nextFlat = [];
    nextScenes.forEach((sc, si) => {
      const steps = stepsForScene(sc);
      const list = steps.length ? steps : [null];
      list.forEach((stepName, sti) => {
        nextFlat.push({ sceneIndex: si, stepIndex: sti, stepName, stepsInScene: list.length });
      });
    });
    return nextFlat;
  };

  let flat = buildFlat(scenes);
  let flatSignature = '';

  function flatSignatureFor(nextScenes) {
    return nextScenes.map((scene, i) => {
      const steps = stepsForScene(scene);
      const list = steps.length ? steps : [null];
      const names = list.map(step => String(step || '')).join(',');
      return `${i}:${list.length}:${names}`;
    }).join('|');
  }

  // Keep derived navigation state in sync if a caller mutates `spec.scenes` in place
  // (for example, via MCP patch flow). Without this, scene count/length can stay stale
  // and navigation appears to get stuck after slide edits.
  function refreshDeckState() {
    const nextScenes = Array.isArray(spec.scenes) ? spec.scenes : [];
    const nextSignature = flatSignatureFor(nextScenes);
    const nextFlat = buildFlat(nextScenes);
    if (!flat.length && !nextFlat.length) {
      if (flatSignature !== nextSignature) renderedSceneIndex = -1;
    } else if (nextFlat.length !== flat.length || flatSignature !== nextSignature || scenes !== nextScenes) {
      renderedSceneIndex = -1;
    }
    scenes = nextScenes;
    flat = nextFlat;
    flatSignature = nextSignature;
    state.total = flat.length;
    state.sceneCount = scenes.length;
    state.pos = Math.max(0, Math.min(state.total - 1, state.pos));
    if (!state.total) {
      state.sceneIndex = 0;
      state.stepIndex = 0;
      state.stepsInScene = 0;
      return;
    }
    const cur = flat[state.pos];
    state.sceneIndex = cur.sceneIndex;
    state.stepIndex = cur.stepIndex;
    state.stepsInScene = cur.stepsInScene;
  }

  const state = reactive({
    pos: 0,
    total: flat.length,
    sceneIndex: 0,
    stepIndex: 0,
    stepsInScene: flat.length ? flat[0].stepsInScene : 0,
    sceneCount: scenes.length,
  });
  let renderedSceneIndex = -1;

  // Embed anchors deliberately carry producer-owned semantic identity in
  // addition to the legacy numeric scope. Array position is useful for the
  // live viewer, but is not durable evidence identity: inserting a scene must
  // never make an old annotation silently point at a new scene.
  function artifactIdentity() {
    const raw = spec && spec.meta && spec.meta.artifact;
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const key of ['id', 'revision', 'contentDigest', 'sourceDigest', 'attemptDigest']) {
      if (raw[key] != null && String(raw[key])) out[key] = String(raw[key]);
    }
    return Object.keys(out).length ? out : null;
  }

  function sceneIdentity(sc, sceneIndex, stepIndex = state.stepIndex) {
    const library = sc && sc._library ? sc._library : {};
    const sourceScene = library.sourceId != null ? library.sourceId : (sc && (sc.id != null ? sc.id : sc.key));
    // A source deck is represented as null rather than the viewer's transient
    // "__source" id. A subset therefore reports the origin deck, never the
    // subset currently being viewed.
    const sourceDeck = library.sourceDeckId && library.sourceDeckId !== '__source'
      ? String(library.sourceDeckId)
      : null;
    return {
      artifact: artifactIdentity(),
      deck: sourceDeck,
      scene: sourceScene == null ? null : String(sourceScene),
      sceneIndex,
      step: Number.isInteger(stepIndex) ? stepIndex : 0,
    };
  }

  function anchorForScene(sceneIndex = state.sceneIndex, stepIndex = state.stepIndex) {
    return sceneIdentity(scenes[sceneIndex] || {}, sceneIndex, stepIndex);
  }

  function sameArtifact(requested, current) {
    if (!requested || typeof requested !== 'object') return true;
    if (!current || typeof current !== 'object') return !Object.keys(requested).length;
    return ['id', 'revision', 'contentDigest', 'sourceDigest', 'attemptDigest']
      .every((key) => requested[key] == null || String(requested[key]) === String(current[key] || ''));
  }

  // Resolve only a complete semantic anchor. In particular, do not fall back
  // to sceneIndex when a requested stable scene id is absent: that would be a
  // silent rebind after a revision/reorder.
  async function gotoAnchor(anchor) {
    if (!anchor || typeof anchor !== 'object') throw new Error('embed anchor is required');
    if (!sameArtifact(anchor.artifact, artifactIdentity())) throw new Error('stale artifact identity');
    if (anchor.scene == null || anchor.scene === '') throw new Error('embed anchor requires a stable scene id');
    const wantScene = String(anchor.scene);
    const wantDeck = anchor.deck == null || anchor.deck === '' ? null : String(anchor.deck);
    const sceneIndex = scenes.findIndex((scene, index) => {
      const candidate = sceneIdentity(scene, index, 0);
      return candidate.scene === wantScene && candidate.deck === wantDeck;
    });
    if (sceneIndex < 0) throw new Error('stale scene anchor');
    const stepIndex = Number.isInteger(Number(anchor.step)) && Number(anchor.step) >= 0
      ? Number(anchor.step)
      : 0;
    return go(posForScene(sceneIndex, stepIndex));
  }

  const assetCache = {};
  async function ensureAsset(src) {
    if (!src) return '';
    if (/^data:/i.test(src)) return src;
    if (assetCache[src]) return assetCache[src];
    try {
      const url = new URL(src, specBaseUrl || window.location.href).href;
      const blob = await (await fetch(url)).blob();
      const dataUri = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
      assetCache[src] = dataUri;
      return dataUri;
    } catch (_) {
      return ''; // unresolvable (e.g. spec loaded via file picker) — skip
    }
  }
  const ensureGif = sc => ensureAsset(sc.gif);
  async function ensureBookCovers(sc) {
    const books = Array.isArray(sc.books) ? sc.books.slice(0, 3) : [];
    return Promise.all(books.map(book => ensureAsset(book && book.cover)));
  }

  function imageHref(src) {
    return resolveAssetHref(src, specBaseUrl, window.location.href);
  }

  function applyPitchSteps(appliedSteps) {
    if (typeof window.slidey.setPitchSteps === 'function') {
      window.slidey.setPitchSteps(appliedSteps);
      return;
    }
    for (const step of appliedSteps) window.slidey.setState(step);
  }

  const bookCoverCache = {};
  async function ensureBookCover(src) {
    if (!src) return '';
    if (/^data:/i.test(src)) return src;
    if (bookCoverCache[src]) return bookCoverCache[src];
    try {
      const blob = await (await fetch(imageHref(src))).blob();
      const dataUri = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
      bookCoverCache[src] = dataUri;
      return dataUri;
    } catch (_) {
      return '';
    }
  }

  async function ensureBookCovers(sc) {
    const books = Array.isArray(sc.books) ? sc.books.slice(0, 3) : [];
    return Promise.all(books.map(book => ensureBookCover(book && book.cover)));
  }

  // graph-projection loader for `graph` scenes with a `projection` path (mirrors
  // ensureRrweb): fetch the projection JSON relative to the spec, once per src.
  const graphProjectionCache = {};
  async function ensureGraphProjection(sc) {
    if (!sc.projection) return null;
    if (graphProjectionCache[sc.projection]) return graphProjectionCache[sc.projection];
    try {
      const url = new URL(sc.projection, specBaseUrl || window.location.href).href;
      const data = await (await fetch(url)).json();
      graphProjectionCache[sc.projection] = data;
      return data;
    } catch (_) {
      return null; // unresolvable (e.g. spec loaded via file picker) — scene shows a fallback
    }
  }

  // rrweb log loader for live `video` scenes (mirrors ensureGif): fetch the log
  // relative to the spec, parse to { events, chapters } for the RrwebPlayer.
  const rrwebCache = {};
  async function ensureRrweb(sc) {
    if (!sc.rrweb) return null;
    if (rrwebCache[sc.rrweb]) return rrwebCache[sc.rrweb];
    try {
      const { chaptersFromEvents } = await import('./rrweb/chapters.js');
      const url = new URL(sc.rrweb, specBaseUrl || window.location.href).href;
      const raw = await (await fetch(url)).json();
      const events = Array.isArray(raw) ? raw : (raw.events || []);
      const data = { events, chapters: chaptersFromEvents(events) };
      rrwebCache[sc.rrweb] = data;
      return data;
    } catch (_) {
      return null; // log unresolvable (e.g. spec via file picker) — player shows empty state
    }
  }

  async function render() {
    refreshDeckState();
    const cur = flat[state.pos];
    if (!cur) return;
    const sc = scenes[cur.sceneIndex];
    const steps = stepsForScene(sc);
    const appliedSteps = steps.slice(0, Math.min(cur.stepIndex + 1, steps.length));

    if (renderedSceneIndex === cur.sceneIndex && sc.type !== 'request') {
      applyPitchSteps(appliedSteps);
      state.sceneIndex = cur.sceneIndex;
      state.stepIndex = cur.stepIndex;
      state.stepsInScene = cur.stepsInScene;
      emitSceneToParent();
      return;
    }

    const opts = {};
    if (sc.type === 'terminal-gif') opts.gifDataUri = await ensureGif(sc);
    if (sc.type === 'image') opts.imageDataUri = imageHref(sc.src);
    if (sc.type === 'image-compare') {
      opts.leftImageDataUri = imageHref(sc.left && sc.left.src);
      opts.rightImageDataUri = imageHref(sc.right && sc.right.src);
    }
    if (sc.type === 'book') opts.bookCoverDataUris = await ensureBookCovers(sc);
    if (sc.type === 'video' && sc.rrweb) opts.rrweb = await ensureRrweb(sc);
    if (sc.type === 'graph' && sc.projection) opts.projectionData = await ensureGraphProjection(sc);

    applyShow(sc, opts); // resets reveal state + injects scene content
    if (sc.type === 'request') {
      for (const step of appliedSteps) window.slidey.setState(step);
    } else {
      applyPitchSteps(appliedSteps);
    }
    renderedSceneIndex = cur.sceneIndex;

    state.sceneIndex = cur.sceneIndex;
    state.stepIndex = cur.stepIndex;
    state.stepsInScene = cur.stepsInScene;
    emitSceneToParent();
  }

  // Tell an embedding parent (e.g. a kitsoki annotation host) WHICH place in the
  // artifact is on screen, so a feedback/refine pass can target what the operator
  // is actually looking at instead of guessing. We speak a GENERIC, host-neutral
  // embed protocol — `{type:'embed:view', producer, scope, label, count}` — so
  // the host needs no slidey-specific knowledge: `scope` is the opaque token the
  // host round-trips back (here the scene index as a string). `type:'slidey:scene'
  // is also posted for any slidey-aware consumer. No-op when not embedded
  // (parent === self) or outside a browser; cross-origin-safe.
  function emitSceneToParent() {
    try {
      if (typeof window === 'undefined') return;
      const sc = scenes[state.sceneIndex] || {};
      const label = sc.title || sc.eyebrow || sc.lede || sc.type || ('Scene ' + state.sceneIndex);
      const scope = String(state.sceneIndex);
      const anchor = anchorForScene(state.sceneIndex, state.stepIndex);
      // Same-window notification so an in-page controller (the annotation pick
      // overlay) can rebuild for the new slide as the operator advances — it
      // can't see the parent-targeted postMessages below.
      if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('slidey:scene-changed', { detail: { sceneIndex: state.sceneIndex } }));
      }
      // Cross-frame notification to an embedding host (kitsoki). No-op when the
      // deck is the top window (not embedded).
      if (window.parent === window) return;
      window.parent.postMessage(
        { type: 'embed:view', producer: 'slidey', scope, step: String(state.stepIndex), label, count: scenes.length, anchor },
        '*',
      );
      window.parent.postMessage(
        { type: 'slidey:scene', sceneIndex: state.sceneIndex, label, sceneCount: scenes.length },
        '*',
      );
    } catch (_) { /* cross-origin / no parent — ignore */ }
  }

  function go(pos) {
    refreshDeckState();
    state.pos = Math.max(0, Math.min(state.total - 1, pos));
    return render(); // render() notifies the embedding parent of the scene
  }
  const next = () => go(state.pos + 1);
  const prev = () => go(state.pos - 1);
  const first = () => go(0);
  const last = () => go(state.total - 1);
  // Jump to the first position of a given scene.
  const gotoScene = si => {
    refreshDeckState();
    const idx = flat.findIndex(f => f.sceneIndex === si);
    if (idx >= 0) return go(idx);
  };

  // Map a (sceneIndex, stepIndex) onto the closest flat position in THIS deck.
  // Used to preserve the viewer's place across a live reload when the spec —
  // and thus the flat step list — may have shifted underneath us. Falls back to
  // the nearest scene (then position 0) when the original scene no longer exists.
  function posForScene(sceneIndex, stepIndex) {
    refreshDeckState();
    const inScene = flat.filter(f => f.sceneIndex === sceneIndex);
    if (inScene.length) {
      const want = Math.max(0, Math.min(inScene.length - 1, stepIndex || 0));
      return flat.indexOf(inScene[want]);
    }
    const clamped = Math.max(0, Math.min(scenes.length - 1, sceneIndex || 0));
    const idx = flat.findIndex(f => f.sceneIndex === clamped);
    return idx >= 0 ? idx : 0;
  }

  return { state, render, go, next, prev, first, last, gotoScene, posForScene, anchorForScene, gotoAnchor };
}

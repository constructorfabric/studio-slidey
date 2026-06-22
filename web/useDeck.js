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
  const scenes = spec.scenes || [];
  let renderedSceneIndex = -1;

  // Flat positions: one entry per reveal step (title scenes get a single entry).
  const flat = [];
  scenes.forEach((sc, si) => {
    const steps = stepsForScene(sc);
    const list = steps.length ? steps : [null];
    list.forEach((stepName, sti) => {
      flat.push({ sceneIndex: si, stepIndex: sti, stepName, stepsInScene: list.length });
    });
  });

  const state = reactive({
    pos: 0,
    total: flat.length,
    sceneIndex: 0,
    stepIndex: 0,
    stepsInScene: flat.length ? flat[0].stepsInScene : 0,
    sceneCount: scenes.length,
  });

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
    const cur = flat[state.pos];
    if (!cur) return;
    const sc = scenes[cur.sceneIndex];
    const steps = stepsForScene(sc);
    const appliedSteps = steps.slice(0, Math.min(cur.stepIndex + 1, steps.length));

    if (renderedSceneIndex === cur.sceneIndex && sc.type !== 'request') {
      window.slidey.setPitchSteps(appliedSteps);
      state.sceneIndex = cur.sceneIndex;
      state.stepIndex = cur.stepIndex;
      state.stepsInScene = cur.stepsInScene;
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

    applyShow(sc, opts); // resets reveal state + injects scene content
    if (sc.type === 'request') {
      for (const step of appliedSteps) window.slidey.setState(step);
    } else {
      window.slidey.setPitchSteps(appliedSteps);
    }
    renderedSceneIndex = cur.sceneIndex;

    state.sceneIndex = cur.sceneIndex;
    state.stepIndex = cur.stepIndex;
    state.stepsInScene = cur.stepsInScene;
  }

  function go(pos) {
    state.pos = Math.max(0, Math.min(state.total - 1, pos));
    return render();
  }
  const next = () => go(state.pos + 1);
  const prev = () => go(state.pos - 1);
  const first = () => go(0);
  const last = () => go(state.total - 1);
  // Jump to the first position of a given scene.
  const gotoScene = si => {
    const idx = flat.findIndex(f => f.sceneIndex === si);
    if (idx >= 0) return go(idx);
  };

  // Map a (sceneIndex, stepIndex) onto the closest flat position in THIS deck.
  // Used to preserve the viewer's place across a live reload when the spec —
  // and thus the flat step list — may have shifted underneath us. Falls back to
  // the nearest scene (then position 0) when the original scene no longer exists.
  function posForScene(sceneIndex, stepIndex) {
    const inScene = flat.filter(f => f.sceneIndex === sceneIndex);
    if (inScene.length) {
      const want = Math.max(0, Math.min(inScene.length - 1, stepIndex || 0));
      return flat.indexOf(inScene[want]);
    }
    const clamped = Math.max(0, Math.min(scenes.length - 1, sceneIndex || 0));
    const idx = flat.findIndex(f => f.sceneIndex === clamped);
    return idx >= 0 ? idx : 0;
  }

  return { state, render, go, next, prev, first, last, gotoScene, posForScene };
}

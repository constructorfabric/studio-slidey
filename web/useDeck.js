// SLIDEY — interactive deck navigation
//
// Flattens a spec into a linear list of reveal positions (one per reveal step,
// using the shared web/sceneSteps.mjs model) and drives the window.slidey
// adapter as the user steps forward/back. Re-applies a scene from its start on
// every position so backward navigation is exact (cumulative reveals replay).

import { reactive } from 'vue';
import { stepsForScene, applyShow } from './sceneSteps.mjs';

export function createDeck(spec, specBaseUrl = '') {
  const scenes = spec.scenes || [];

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

  const gifCache = {};
  async function ensureGif(sc) {
    if (!sc.gif) return '';
    if (gifCache[sc.gif]) return gifCache[sc.gif];
    try {
      const url = new URL(sc.gif, specBaseUrl || window.location.href).href;
      const blob = await (await fetch(url)).blob();
      const dataUri = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
      gifCache[sc.gif] = dataUri;
      return dataUri;
    } catch (_) {
      return ''; // gif unresolvable (e.g. spec loaded via file picker) — skip
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
    const cur = flat[state.pos];
    if (!cur) return;
    const sc = scenes[cur.sceneIndex];
    const opts = {};
    if (sc.type === 'terminal-gif') opts.gifDataUri = await ensureGif(sc);
    if (sc.type === 'video' && sc.rrweb) opts.rrweb = await ensureRrweb(sc);

    applyShow(sc, opts); // resets reveal state + injects scene content
    const steps = stepsForScene(sc);
    for (let i = 0; i <= cur.stepIndex && i < steps.length; i++) {
      window.slidey.setState(steps[i]);
    }

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

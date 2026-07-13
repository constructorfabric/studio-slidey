// SLIDEY — window.slidey adapter
//
// Re-creates the exact `window.slidey.*` surface that src/renderer.js and
// src/scenes/*.js drive, but backed by the Vue reactive store instead of direct
// DOM mutation. Installing this lets the existing render pipeline run unchanged
// against the Vue bundle.
//
// Also installs the determinism primitives the renderer waits on:
//   window.__slideyReady  — set true once Vue has mounted + first paint settled
//   window.__slideySettle — resolves after Vue flushes the DOM (nextTick),
//                           fonts are ready, and any pending <img> has decoded.
// renderer.js awaits __slideySettle() before every frame/page capture so a
// screenshot never races an un-flushed reactive update.

import { nextTick } from 'vue';
import { store } from './store.js';
import { getMemeTemplate } from './memeGeometry.mjs';

export function installAdapter() {
  window.__slideyPendingRenders = new Set();

  window.slidey = {
    setMeta(meta) { store.setMeta(meta); },
    setMode(mode) { store.setMode(mode); },

    showTitleCard(scene) { store.showTitleCard(scene); },
    hideTitleCard() { store.hideTitleCard(); },

    loadScene(scene, opts) { store.loadScene(scene, opts); },
    setState(step) { store.setState(step); },
    setPitchSteps(steps) { store.setPitchSteps(steps); },
    setProgress(pct) { store.setProgress(pct); },
    setSendingText(text) { store.setSendingText(text); },

    showNarrative(scene) { store.showScene('narrative', scene); },
    hideNarrative() { store.hidePitch(); },

    showDiagram(scene) { store.showScene('diagram', scene); },
    hideDiagram() { store.hidePitch(); },

    showDiagramSvg(scene) { store.showScene('diagram-svg', scene); },
    hideDiagramSvg() { store.hidePitch(); },

    showGraph(scene, projectionData) { store.showGraph(scene, projectionData); },
    hideGraph() { store.hidePitch(); },

    showMermaid(scene) { store.showScene('mermaid', scene); },
    hideMermaid() { store.hidePitch(); },

    showTerminalGif(scene, dataUri) {
      store.showScene('terminal-gif', scene);
      store.gifDataUri = dataUri || '';
    },
    hideTerminalGif() { store.hidePitch(); store.gifDataUri = ''; },

    showKitsokiTui(scene) { store.showScene('kitsoki-tui', scene); },
    hideKitsokiTui() { store.hidePitch(); },

    showStat(scene) { store.showScene('stat', scene); },
    hideStat() { store.hidePitch(); },

    showCta(scene) { store.showScene('cta', scene); },
    hideCta() { store.hidePitch(); },

    showTrace(scene) { store.showScene('trace', scene); },
    hideTrace() { store.hidePitch(); },

    showTranscript(scene) { store.showScene('transcript', scene); },
    hideTranscript() { store.hidePitch(); },

    showThread(scene) { store.showScene('thread', scene); },
    hideThread() { store.hidePitch(); },

    showCards(scene) { store.showScene('cards', scene); },
    hideCards() { store.hidePitch(); },

    showObjectives(scene) { store.showScene('objectives', scene); },
    hideObjectives() { store.hidePitch(); },

    showEvidence(scene) { store.showScene('evidence', scene); },
    hideEvidence() { store.hidePitch(); },

    showPersonas(scene) { store.showScene('personas', scene); },
    hidePersonas() { store.hidePitch(); },

    showCode(scene) { store.showScene('code', scene); },
    hideCode() { store.hidePitch(); },

    showMcpDrive(scene) { store.showScene('mcp-drive', scene); },
    hideMcpDrive() { store.hidePitch(); },

    showTable(scene) { store.showScene('table', scene); },
    hideTable() { store.hidePitch(); },

    showChart(scene) { store.showScene('chart', scene); },
    hideChart() { store.hidePitch(); },

    showImage(scene, dataUri) {
      store.showScene('image', scene);
      store.imageDataUri = dataUri || '';
    },
    hideImage() { store.hidePitch(); store.imageDataUri = ''; },

    showImageCompare(scene, leftDataUri, rightDataUri) {
      store.showScene('image-compare', scene);
      store.leftImageDataUri = leftDataUri || '';
      store.rightImageDataUri = rightDataUri || '';
    },
    hideImageCompare() {
      store.hidePitch();
      store.leftImageDataUri = '';
      store.rightImageDataUri = '';
    },

    showMeme(scene, dataUri) {
      store.showScene('meme', scene);
      store.memeTemplate = getMemeTemplate(scene && scene.template);
      store.memeDataUri = dataUri || '';
    },
    hideMeme() { store.hidePitch(); store.memeTemplate = null; store.memeDataUri = ''; },

    showBook(scene, coverDataUris) {
      store.showScene('book', scene);
      store.bookCoverDataUris = Array.isArray(coverDataUris) ? coverDataUris : [];
    },
    hideBook() { store.hidePitch(); store.bookCoverDataUris = []; },

    // video (interactive viewer only): mount the live rrweb player from the
    // loaded log. Headless render + PDF/PNG export handle video scenes natively.
    showVideo(scene, data) { store.showVideo(scene, data); },
    hideVideo() { store.hidePitch(); store.rrwebEvents = []; store.rrwebChapters = []; },

    showReference(scene) { store.showScene('reference', scene); },
    hideReference() { store.hidePitch(); },
  };

  // Settle barrier: flush Vue's async DOM patch before the renderer captures, so
  // a screenshot never races an un-applied reveal. Kept minimal and free of
  // variable-latency awaits (the deck uses only system monospace fonts, so no
  // document.fonts wait is needed) — extra awaits between the reveal mutation
  // and capture jitter the in-flight 320ms CSS transition and cost run-to-run
  // determinism. Only awaits image decode when a scene actually has a pending
  // image (terminal-gif), so its first frame isn't blank.
  window.__slideySettle = async () => {
    // Six ticks: the diagram-svg two-pass auto-size loop (getBBox → dagre
    // re-layout) needs ~4 ticks per pass. All ticks are microtasks so this
    // doesn't jitter the 320ms CSS reveal transitions in any observable way.
    for (let i = 0; i < 6; i++) await nextTick();
    const pendingRenders = Array.from(window.__slideyPendingRenders || []);
    if (pendingRenders.length) {
      const withTimeout = (p, ms = 3000) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
      await Promise.all(pendingRenders.map(p => withTimeout(p.catch(() => {}))));
      for (let i = 0; i < 2; i++) await nextTick();
    }
    const pending = Array.from(document.images || []).filter(img => img.src && !img.complete);
    if (pending.length) {
      // A never-resolving decode() must not hang the capture barrier, so race
      // each wait against a fixed timeout — the barrier always resolves.
      const withTimeout = (p, ms = 1500) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
      await Promise.all(pending.map(img => withTimeout((img.decode ? img.decode() : Promise.resolve()).catch(() => {}))));
    }
  };
}

export function markReady() {
  window.__slideyReady = true;
}

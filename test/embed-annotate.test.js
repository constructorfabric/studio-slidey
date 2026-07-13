'use strict';

// embed-annotate — slidey's producer side of the embed annotation protocol.
// Pins (1) generic pick-target discovery off the rendered layout (every revealed
// `.reveal` block under the active scene — no per-scene-type map), and (2) the
// host→deck enable message producing a deck→host embed:pick on element click,
// including the rebuild when the deck advances to a different slide.

const assert = require('node:assert/strict');
const test = require('node:test');

// A tiny fake DOM: querySelectorAll(PICK_SELECTOR) returns the revealed blocks of
// the active scene. Each node carries an id, an optional attr bag, text, and a
// fixed bounding rect — exactly what buildPickTargets reads.
function node({ id, rect, attrs = {}, text = '' }) {
  return {
    id,
    textContent: text,
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    getBoundingClientRect: () => ({ x: rect[0], y: rect[1], width: rect[2], height: rect[3] }),
  };
}
function fakeRoot(nodes) {
  return { querySelectorAll: () => nodes };
}

test('buildPickTargets emits <scene>/<field> refs from id, dropping the type prefix', async () => {
  const { buildPickTargets } = await import('../web/embed-annotate.js');
  const root = fakeRoot([
    node({ id: 'image-title', rect: [10, 20, 300, 40], text: 'Cat Wrangling' }),
    // template override: the frame block edits the `src` spec field, not `frame`.
    node({ id: 'image-frame', rect: [10, 70, 600, 400], attrs: { 'data-embed-field': 'src', 'data-embed-label': 'image' } }),
  ]);
  const targets = buildPickTargets(root, 9);
  assert.deepEqual(targets.map((t) => t.ref), ['9/title', '9/src']);
  assert.equal(targets[0].label, 'Cat Wrangling', 'label is the block text the operator sees');
  assert.equal(targets[1].label, 'image', 'data-embed-label overrides');
  assert.deepEqual(targets[1].bbox, [10, 70, 600, 400]);
});

test('buildPickTargets covers the title card (data-embed-field, no scene region)', async () => {
  const { buildPickTargets } = await import('../web/embed-annotate.js');
  // The title slide renders as a #title-card overlay (no .reveal, no scene
  // region); its fields are addressable via data-embed-field. idToField would
  // wrongly yield `card-eyebrow` from the id, so the explicit field is essential
  // for the edit to land on the right spec field.
  const root = fakeRoot([
    node({ id: 'title-card-eyebrow', rect: [40, 200, 400, 30], text: 'A PITCH', attrs: { 'data-embed-field': 'eyebrow', 'data-embed-label': 'eyebrow' } }),
    node({ id: 'title-card-title', rect: [40, 240, 800, 90], text: 'Kitsoki', attrs: { 'data-embed-field': 'title', 'data-embed-label': 'title' } }),
    node({ id: 'title-card-subtitle', rect: [40, 340, 600, 40], text: 'Control inversion', attrs: { 'data-embed-field': 'subtitle', 'data-embed-label': 'subtitle' } }),
  ]);
  const targets = buildPickTargets(root, 0);
  assert.deepEqual(targets.map((t) => t.ref), ['0/eyebrow', '0/title', '0/subtitle']);
  assert.deepEqual(targets.map((t) => t.label), ['eyebrow', 'title', 'subtitle']);
});

test('buildPickTargets skips zero-area (not-laid-out) blocks', async () => {
  const { buildPickTargets } = await import('../web/embed-annotate.js');
  const root = fakeRoot([
    node({ id: 'cards-title', rect: [0, 0, 100, 30], text: 'Agenda' }),
    node({ id: 'cards-item-0', rect: [0, 0, 0, 0], text: 'collapsed' }),
    node({ id: 'cards-item-1', rect: [0, 40, 200, 100], text: 'Second card' }),
  ]);
  assert.deepEqual(buildPickTargets(root, 1).map((t) => t.ref), ['1/title', '1/item-1']);
});

test('enabling annotation mode posts embed:pick on element click', async (t) => {
  const { installEmbedAnnotate } = await import('../web/embed-annotate.js');

  const posted = [];
  const listeners = {};
  const win = {
    parent: { postMessage: (m) => posted.push(m) },
    requestAnimationFrame: (fn) => fn(), // run rebuilds synchronously in the test
    addEventListener: (type, h) => { listeners[type] = h; },
    removeEventListener: (type) => { delete listeners[type]; },
  };
  // Minimal fake document: createElement nodes that record click handlers; body
  // collects appended overlays; querySelectorAll resolves the revealed blocks.
  const clickHandlers = [];
  const body = { children: [], appendChild(n) { this.children.push(n); }, removeChild(n) { this.children = this.children.filter((c) => c !== n); } };
  function makeEl() {
    return {
      style: {}, children: [],
      setAttribute() {}, appendChild(n) { this.children.push(n); }, set title(_) {},
      addEventListener(type, h) { if (type === 'click') clickHandlers.push(h); },
      parentNode: null,
    };
  }
  // Mutable scene state: the operator advances slides while annotation mode is on.
  let sceneIndex = 9;
  let blocks = [
    node({ id: 'image-title', rect: [10, 20, 300, 40], text: 'Cat Wrangling' }),
    node({ id: 'image-frame', rect: [10, 70, 600, 400], attrs: { 'data-embed-field': 'src' } }),
  ];
  const doc = {
    body,
    createElement() { return makeEl(); },
    querySelectorAll() { return blocks; },
  };

  const teardown = installEmbedAnnotate(
    { getRoot: () => doc, getSceneIndex: () => sceneIndex },
    win, doc,
  );
  t.after(teardown);

  // Host turns annotation mode on → overlay built with one marker per block.
  listeners.message({ data: { type: 'embed:annotate', enabled: true } });
  await Promise.resolve();
  assert.equal(clickHandlers.length, 2, 'a marker per pickable block');

  // Operator clicks the image block (2nd marker) → embed:pick posted.
  clickHandlers[1]({ preventDefault() {}, stopPropagation() {} });
  const pick = posted.find((m) => m.type === 'embed:pick');
  assert.ok(pick, 'embed:pick posted to parent');
  assert.equal(pick.producer, 'slidey');
  assert.equal(pick.scope, '9');
  assert.equal(pick.ref, '9/src', 'the picked element ref rides back');

  // Advance to a DIFFERENT slide (a narrative scene) — the markers must REBUILD
  // for the new slide, not stay pinned to scene 9 (the reported bug).
  sceneIndex = 12;
  blocks = [
    node({ id: 'narrative-lede', rect: [0, 0, 400, 60], text: 'The thesis' }),
    node({ id: 'narrative-body', rect: [0, 80, 800, 300], text: 'Body copy' }),
  ];
  posted.length = 0;
  const before = clickHandlers.length;
  listeners['slidey:scene-changed']({ detail: { sceneIndex: 12 } });
  await Promise.resolve();
  const fresh = clickHandlers.slice(before);
  assert.equal(fresh.length, 2, 'overlay rebuilt for the new slide (lede + body)');

  fresh[0]({ preventDefault() {}, stopPropagation() {} });
  const pick2 = posted.find((m) => m.type === 'embed:pick');
  assert.equal(pick2.ref, '12/lede', 'clickable areas now target the slide on screen');
});

test('enabling annotation mode restores the requested scene and transition before drawing markers', async (t) => {
  const { installEmbedAnnotate } = await import('../web/embed-annotate.js');

  const listeners = {};
  const win = {
    parent: { postMessage() {} },
    requestAnimationFrame: (fn) => fn(),
    addEventListener: (type, h) => { listeners[type] = h; },
    removeEventListener: (type) => { delete listeners[type]; },
  };
  const body = { children: [], appendChild(n) { this.children.push(n); }, removeChild(n) { this.children = this.children.filter((c) => c !== n); } };
  function makeEl() {
    return {
      style: {}, children: [],
      setAttribute() {}, appendChild(n) { this.children.push(n); }, set title(_) {},
      addEventListener() {},
      parentNode: null,
    };
  }
  const doc = {
    body,
    createElement() { return makeEl(); },
    querySelectorAll() {
      return [
        node({ id: 'narrative-body', rect: [0, 80, 800, 300], text: 'Revealed body' }),
      ];
    },
  };

  const calls = [];
  const teardown = installEmbedAnnotate(
    {
      getRoot: () => doc,
      getSceneIndex: () => 9,
      gotoView: async (sceneIndex, stepIndex) => { calls.push({ sceneIndex, stepIndex }); },
    },
    win, doc,
  );
  t.after(teardown);

  listeners.message({ data: { type: 'embed:annotate', enabled: true, scope: '9', step: '2' } });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, [{ sceneIndex: 9, stepIndex: 2 }]);
  assert.equal(body.children.length, 1, 'markers are drawn after the requested view is restored');
});

test('a stale semantic annotation anchor is surfaced and never falls back to a numeric scope', async (t) => {
  const { installEmbedAnnotate } = await import('../web/embed-annotate.js');
  const posted = [];
  const listeners = {};
  const win = {
    parent: { postMessage: (m) => posted.push(m) },
    requestAnimationFrame: (fn) => fn(),
    addEventListener: (type, h) => { listeners[type] = h; },
    removeEventListener: (type) => { delete listeners[type]; },
  };
  const body = { children: [], appendChild(n) { this.children.push(n); }, removeChild(n) { this.children = this.children.filter((c) => c !== n); } };
  const doc = { body, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }), querySelectorAll: () => [] };
  const teardown = installEmbedAnnotate({
    getRoot: () => doc,
    getSceneIndex: () => 4,
    getAnchor: () => ({ artifact: { id: 'deck', revision: 'r2' }, scene: 'now' }),
    gotoAnchor: async () => { throw new Error('stale artifact identity'); },
    gotoView: async () => { throw new Error('numeric fallback must not run'); },
  }, win, doc);
  t.after(teardown);

  listeners.message({ data: { type: 'embed:annotate', enabled: true, scope: '4', anchor: { artifact: { id: 'deck', revision: 'r1' }, scene: 'then' } } });
  await Promise.resolve();
  await Promise.resolve();
  const stale = posted.find((m) => m.type === 'embed:stale');
  assert.ok(stale, 'producer reports a visible stale identity failure');
  assert.match(stale.reason, /stale artifact identity/);
  assert.equal(body.children.length, 0, 'no annotation overlay is attached to a different revision');
});

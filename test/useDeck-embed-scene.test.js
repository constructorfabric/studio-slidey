'use strict';

// Regression: when a deck is embedded in an iframe (e.g. a kitsoki annotation
// host), navigating to a scene/reveal step must postMessage that exact view to
// the parent so feedback/refine/annotation targets the visual state the operator
// is looking at — and must stay a no-op when the deck is the top window.

const assert = require('node:assert/strict');
const test = require('node:test');

function makeWindow({ embedded }) {
  const posted = [];
  const parent = { postMessage: (msg) => posted.push(msg) };
  // window.slidey exposes a per-scene-type method surface; the test only cares
  // about the scene postMessage, so back every method with a no-op.
  const slidey = new Proxy({}, { get: () => () => {} });
  const win = {
    location: { href: 'http://localhost:4321/' },
    slidey,
    posted,
  };
  // Embedded → parent !== self; top window → parent === self (no-op).
  win.parent = embedded ? parent : win;
  if (!embedded) parent.postMessage = () => { throw new Error('top window must not post'); };
  return win;
}

const DECK = {
  meta: { mode: 'pitch', artifact: { id: 'gx10-proof-deck', revision: 'r7', contentDigest: 'sha256:deck-r7' } },
  scenes: [
    { id: 'intro', type: 'title', title: 'Intro' },
    { id: 'one-anchor', type: 'cards', title: 'One anchor', cards: [{ label: 'a' }] },
    { id: 'cat-wrangling', type: 'image', title: 'Cat Wrangling', src: 'cats.png' },
  ],
};

test('embedded deck posts the current scene to the parent on navigation', async (t) => {
  const { createDeck } = await import('../web/useDeck.js');
  global.window = makeWindow({ embedded: true });
  t.after(() => { delete global.window; });

  const deck = createDeck(DECK, 'http://localhost:4321/');
  await deck.render();            // initial scene 0
  await deck.gotoScene(2);        // navigate to the Cat Wrangling slide

  // The generic, host-neutral embed protocol kitsoki listens for.
  const posted = global.window.posted.filter((m) => m && m.type === 'embed:view');
  assert.ok(posted.length >= 2, 'expected embed:view posts for initial + navigation');

  const first = posted[0];
  assert.equal(first.producer, 'slidey');
  assert.equal(first.scope, '0', 'scope is the opaque scene token the host round-trips');
  assert.equal(first.step, '0', 'step is the reveal transition within that scene');
  assert.equal(first.label, 'Intro');
  assert.equal(first.count, 3);
  assert.deepEqual(first.anchor, {
    artifact: { id: 'gx10-proof-deck', revision: 'r7', contentDigest: 'sha256:deck-r7' },
    deck: null, scene: 'intro', sceneIndex: 0, step: 0,
  });

  const last = posted[posted.length - 1];
  assert.equal(last.scope, '2', 'navigation landed on scene 2');
  assert.equal(last.step, '0', 'navigation reports the exact reveal transition too');
  assert.equal(last.label, 'Cat Wrangling', 'parent learns WHICH slide is on screen');
  assert.equal(last.anchor.scene, 'cat-wrangling', 'canonical anchor is a stable scene id, not the mutable scope');

  // A slidey-aware consumer can still use the namespaced event.
  assert.ok(global.window.posted.some((m) => m && m.type === 'slidey:scene'));
});

test('semantic anchors survive a reorder and reject stale artifact revisions', async (t) => {
  const { createDeck } = await import('../web/useDeck.js');
  global.window = makeWindow({ embedded: true });
  t.after(() => { delete global.window; });

  const first = createDeck(DECK, 'http://localhost:4321/');
  await first.gotoScene(2);
  const anchor = first.anchorForScene();

  const reordered = {
    ...DECK,
    scenes: [DECK.scenes[2], DECK.scenes[0], DECK.scenes[1]],
  };
  const second = createDeck(reordered, 'http://localhost:4321/');
  await second.gotoAnchor(anchor);
  assert.equal(second.state.sceneIndex, 0, 'stable scene id resolves after its numeric index changes');

  const stale = {
    ...anchor,
    artifact: { ...anchor.artifact, revision: 'r8', contentDigest: 'sha256:deck-r8' },
  };
  await assert.rejects(second.gotoAnchor(stale), /stale artifact identity/);
});

test('top-window (non-embedded) deck does not post to a parent', async (t) => {
  const { createDeck } = await import('../web/useDeck.js');
  global.window = makeWindow({ embedded: false });
  t.after(() => { delete global.window; });

  const deck = createDeck(DECK, 'http://localhost:4321/');
  // Would throw via the guarded postMessage if it tried to post to itself.
  await deck.render();
  await deck.gotoScene(1);
  assert.equal(global.window.posted.length, 0);
});

test('initial view query preserves scene and reveal step on boot', async () => {
  const { initialViewFromSearch } = await import('../web/initial-view.js');

  assert.deepEqual(initialViewFromSearch('?scene=9&step=2'), { sceneIndex: 9, stepIndex: 2 });
  assert.deepEqual(initialViewFromSearch('?scene=9'), { sceneIndex: 9, stepIndex: 0 });
  assert.equal(initialViewFromSearch('?scene=-1&step=2'), null);
  assert.equal(initialViewFromSearch('?scene=cat&step=2'), null);
  assert.equal(initialViewFromSearch('?step=2'), null);
});

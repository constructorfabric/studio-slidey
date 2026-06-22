'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('resolveAssetHref resolves scene assets relative to the loaded spec base', async () => {
  const { resolveAssetHref } = await import('../web/useDeck.js');

  assert.equal(
    resolveAssetHref('compare/old/slide.001.png', 'http://localhost:4321/workspace/docs/slides/'),
    'http://localhost:4321/workspace/docs/slides/compare/old/slide.001.png',
  );
  assert.equal(
    resolveAssetHref('data:image/png;base64,abc', 'http://localhost:4321/workspace/docs/slides/'),
    'data:image/png;base64,abc',
  );
  assert.equal(
    resolveAssetHref('https://example.test/slide.png', 'http://localhost:4321/workspace/docs/slides/'),
    'https://example.test/slide.png',
  );
});

test('deck navigation does not remount pitch scenes for same-scene reveal steps', async (t) => {
  const { createDeck } = await import('../web/useDeck.js');
  const calls = [];
  t.after(() => { delete global.window; });
  global.window = {
    location: { href: 'http://localhost:4321/' },
    slidey: {
      showDiagram(scene) { calls.push(['showDiagram', scene.title]); },
      setPitchSteps(steps) { calls.push(['setPitchSteps', steps.slice()]); },
    },
  };

  const deck = createDeck({
    meta: { mode: 'pitch' },
    scenes: [{
      type: 'diagram',
      title: 'Flow',
      panels: [{ ascii: 'A' }, { ascii: 'B' }],
    }],
  }, 'http://localhost:4321/');

  await deck.render();
  await deck.next();

  assert.deepEqual(calls, [
    ['showDiagram', 'Flow'],
    ['setPitchSteps', ['diagram_title']],
    ['setPitchSteps', ['diagram_title', 'diagram_panel_0']],
  ]);
});

test('QA image comparisons advance one full comparison per right arrow', async (t) => {
  const { createDeck } = await import('../web/useDeck.js');
  const calls = [];
  t.after(() => { delete global.window; });
  global.window = {
    location: { href: 'http://localhost:4321/' },
    slidey: {
      showImageCompare(scene, left, right) {
        calls.push(['showImageCompare', scene.title, left, right]);
      },
      setPitchSteps(steps) { calls.push(['setPitchSteps', steps.slice()]); },
    },
  };

  const deck = createDeck({
    meta: { mode: 'pitch' },
    scenes: [
      {
        type: 'image-compare',
        variant: 'qa',
        title: 'Slide 01',
        left: { src: 'compare/old/slide.001.png' },
        right: { src: 'compare/new/00-01.png' },
        caption: 'Old vs new',
      },
      {
        type: 'image-compare',
        variant: 'qa',
        title: 'Slide 02',
        left: { src: 'compare/old/slide.002.png' },
        right: { src: 'compare/new/01-09.png' },
        caption: 'Old vs new',
      },
    ],
  }, 'http://localhost:4321/docs/slides/');

  assert.equal(deck.state.total, 2);
  await deck.render();
  await deck.next();

  assert.deepEqual(calls, [
    [
      'showImageCompare',
      'Slide 01',
      'http://localhost:4321/docs/slides/compare/old/slide.001.png',
      'http://localhost:4321/docs/slides/compare/new/00-01.png',
    ],
    ['setPitchSteps', ['reveal_all']],
    [
      'showImageCompare',
      'Slide 02',
      'http://localhost:4321/docs/slides/compare/old/slide.002.png',
      'http://localhost:4321/docs/slides/compare/new/01-09.png',
    ],
    ['setPitchSteps', ['reveal_all']],
  ]);
});

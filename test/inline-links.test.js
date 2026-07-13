'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('classifyInlineRefTarget routes deck: targets to a deck/scene link', async () => {
  const { classifyInlineRefTarget } = await import('../web/inline-links.js');

  assert.deepEqual(classifyInlineRefTarget('deck:kitsoki'), { kind: 'deck', deck: 'kitsoki', scene: '' });
  assert.deepEqual(
    classifyInlineRefTarget('deck:kitsoki#intro'),
    { kind: 'deck', deck: 'kitsoki', scene: 'intro' },
  );
  assert.deepEqual(
    classifyInlineRefTarget('deck:kitsoki:intro'),
    { kind: 'deck', deck: 'kitsoki', scene: 'intro' },
  );
});

test('classifyInlineRefTarget routes .rrweb.json targets to the replay modal', async () => {
  const { classifyInlineRefTarget } = await import('../web/inline-links.js');

  assert.deepEqual(
    classifyInlineRefTarget('demos/sample-tour.rrweb.json'),
    { kind: 'rrweb', ref: 'demos/sample-tour.rrweb.json' },
  );
  assert.deepEqual(
    classifyInlineRefTarget('demos/sample-tour.rrweb.json?x=1'),
    { kind: 'rrweb', ref: 'demos/sample-tour.rrweb.json?x=1' },
  );
});

test('classifyInlineRefTarget treats everything else as a reference-viewer target', async () => {
  const { classifyInlineRefTarget } = await import('../web/inline-links.js');

  assert.deepEqual(classifyInlineRefTarget('docs/design.md'), { kind: 'reference', src: 'docs/design.md' });
  assert.deepEqual(classifyInlineRefTarget('demo/mockup.html'), { kind: 'reference', src: 'demo/mockup.html' });
  assert.deepEqual(classifyInlineRefTarget('qa-assets/architecture.svg'), { kind: 'reference', src: 'qa-assets/architecture.svg' });
});

test('classifyInlineRefTarget returns null for empty/blank targets', async () => {
  const { classifyInlineRefTarget } = await import('../web/inline-links.js');

  assert.equal(classifyInlineRefTarget(''), null);
  assert.equal(classifyInlineRefTarget('   '), null);
  assert.equal(classifyInlineRefTarget(null), null);
  assert.equal(classifyInlineRefTarget(undefined), null);
});

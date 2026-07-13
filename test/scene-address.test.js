'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { addressableScenes, resolveSceneAddress } = require('../src/scene-address');

// A library spec shaped like the real-world case that exposed the gap: a
// top-level "root" deck plus several hierarchy library decks, each owning
// its own inline scenes (some ids reused ACROSS decks to exercise ambiguity).
function librarySpec() {
  return {
    meta: { title: 'Pillar deck' },
    library: {
      title: 'Pillar library',
      decks: [
        {
          id: 'pillar-a',
          title: 'Pillar A',
          deckType: 'hierarchy',
          scenes: [
            { id: 'a-title', type: 'title', title: 'Pillar A' },
            { id: 'a-diagram', type: 'diagram-svg', title: 'A diagram', panels: [{ nodes: [] }] },
            { id: 'shared-id', type: 'narrative', body: 'from pillar A' },
          ],
        },
        {
          id: 'pillar-b',
          title: 'Pillar B',
          deckType: 'hierarchy',
          scenes: [
            { id: 'b-title', type: 'title', title: 'Pillar B' },
            { id: 'b-diagram', type: 'diagram-svg', title: 'B diagram', panels: [{ nodes: [] }] },
            { id: 'shared-id', type: 'narrative', body: 'from pillar B' },
          ],
        },
        {
          id: 'pitch',
          title: 'Pitch subset',
          deckType: 'subset',
          scenes: ['root-title', { fromDeck: 'pillar-a', ref: 'a-title' }],
        },
      ],
    },
    scenes: [
      { id: 'root-title', type: 'title', title: 'Root deck' },
      { id: 'root-diagram', type: 'diagram-svg', title: 'Root diagram', panels: [{ nodes: [] }] },
    ],
  };
}

test('addressableScenes flattens top-level scenes plus every hierarchy deck\'s local scenes', () => {
  const { entries } = addressableScenes(librarySpec());
  const ids = entries.map((e) => `${e.deckId || '(top)'}#${e.id}`);
  assert.deepEqual(ids, [
    '(top)#root-title',
    '(top)#root-diagram',
    'pillar-a#a-title',
    'pillar-a#a-diagram',
    'pillar-a#shared-id',
    'pillar-b#b-title',
    'pillar-b#b-diagram',
    'pillar-b#shared-id',
  ]);
  // The subset deck ("pitch") only references scenes already listed above —
  // it must not appear as its own source of entries.
  assert.ok(!entries.some((e) => e.deckId === 'pitch'));
});

test('resolveSceneAddress: legacy numeric sceneIndex with no deck indexes the top-level scenes', () => {
  const spec = librarySpec();
  const resolved = resolveSceneAddress(spec, { sceneIndex: 1 });
  assert.equal(resolved.deckId, null);
  assert.equal(resolved.sceneIndex, 1);
  assert.equal(resolved.spec, spec);
  assert.equal(resolved.spec.scenes[resolved.sceneIndex].id, 'root-diagram');
});

test('resolveSceneAddress: unambiguous bare scene id resolves across top-level and library decks', () => {
  const spec = librarySpec();
  const top = resolveSceneAddress(spec, { scene: 'root-diagram' });
  assert.equal(top.deckId, null);
  assert.equal(top.spec.scenes[top.sceneIndex].id, 'root-diagram');

  const nested = resolveSceneAddress(spec, { scene: 'b-diagram' });
  assert.equal(nested.deckId, 'pillar-b');
  assert.equal(nested.spec.scenes[nested.sceneIndex].id, 'b-diagram');
});

test('resolveSceneAddress: ambiguous bare scene id throws listing candidates', () => {
  const spec = librarySpec();
  assert.throws(
    () => resolveSceneAddress(spec, { scene: 'shared-id' }),
    /ambiguous.*deck:pillar-a#shared-id.*deck:pillar-b#shared-id/s,
  );
});

test('resolveSceneAddress: deck param disambiguates and scopes lookup', () => {
  const spec = librarySpec();
  const resolved = resolveSceneAddress(spec, { scene: 'shared-id', deck: 'pillar-b' });
  assert.equal(resolved.deckId, 'pillar-b');
  assert.equal(resolved.spec.scenes[resolved.sceneIndex].body, 'from pillar B');
});

test('resolveSceneAddress: numeric sceneIndex with deck indexes that deck\'s local scenes', () => {
  const spec = librarySpec();
  const resolved = resolveSceneAddress(spec, { sceneIndex: 1, deck: 'pillar-a' });
  assert.equal(resolved.deckId, 'pillar-a');
  assert.equal(resolved.spec.scenes[resolved.sceneIndex].id, 'a-diagram');
});

test('resolveSceneAddress: unknown deck errors with the known deck list', () => {
  const spec = librarySpec();
  assert.throws(
    () => resolveSceneAddress(spec, { scene: 'a-title', deck: 'nope' }),
    /unknown library deck "nope".*pillar-a.*pillar-b.*pitch/s,
  );
});

test('resolveSceneAddress: unknown scene id errors', () => {
  const spec = librarySpec();
  assert.throws(() => resolveSceneAddress(spec, { scene: 'does-not-exist' }), /not found/);
});

test('resolveSceneAddress: plain spec with no library still resolves bare scene ids', () => {
  const spec = { scenes: [{ id: 'only', type: 'title', title: 'Only' }] };
  const resolved = resolveSceneAddress(spec, { scene: 'only' });
  assert.equal(resolved.deckId, null);
  assert.equal(resolved.sceneIndex, 0);
});

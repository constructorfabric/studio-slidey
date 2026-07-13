'use strict';

// Deep validation of library-deck scenes: the root JSON-Schema pass only
// shallow-checks library.decks[].scenes[] (the deck schema must admit both
// subset REFS and inline scenes), so an invalid inline scene inside a
// hierarchy deck used to sail through slidey_validate. validateSpec now runs
// each hierarchy deck's local scenes through the same scene schema and
// reports errors under a deck-qualified path. See validateLibraryDeckScenes
// in src/validate.js.

const assert = require('node:assert/strict');
const test = require('node:test');

const { validateSpec } = require('../src/validate');

function specWithDecks(pillarScenes) {
  return {
    meta: { title: 'Deep validation', mode: 'pitch' },
    scenes: [{ id: 'root-title', type: 'title', title: 'Root' }],
    library: {
      title: 'Library',
      decks: [
        { id: 'pillar', title: 'Pillar', deckType: 'hierarchy', scenes: pillarScenes },
        // A subset deck referencing existing scene ids — these are refs, not
        // scenes, and must never be schema-validated as scene objects.
        { id: 'cut', title: 'Cut', deckType: 'subset', scenes: ['root-title', { fromDeck: 'pillar', ref: 'p-title' }] },
      ],
    },
  };
}

test('an invalid scene inside a hierarchy library deck is flagged with a deck-qualified path', () => {
  const result = validateSpec(specWithDecks([
    { id: 'p-title', type: 'title', title: 'Pillar' },
    // malformed diagram-svg: node id/label must be strings
    { id: 'p-diag', type: 'diagram-svg', title: 'Broken', panels: [{ nodes: [{ id: 42, label: { nope: true } }] }] },
  ]));

  assert.equal(result.valid, false);
  assert.ok(result.count >= 1);
  const text = result.errors.join('\n');
  assert.match(text, /library\.decks\["pillar"\]\.scenes\[1\]/);
  assert.match(text, /diagram-svg/);
  // The valid sibling scene and the subset deck's refs must not be flagged.
  assert.doesNotMatch(text, /scenes\[0\]/);
  assert.doesNotMatch(text, /library\.decks\["cut"\]/);
});

test('an unknown scene type inside a hierarchy library deck is flagged', () => {
  const result = validateSpec(specWithDecks([
    { id: 'p-bogus', type: 'not-a-scene-type', title: 'Bogus' },
  ]));

  assert.equal(result.valid, false);
  const text = result.errors.join('\n');
  assert.match(text, /library\.decks\["pillar"\]\.scenes\[0\]/);
  assert.match(text, /unknown type "not-a-scene-type"/);
});

test('a valid hierarchy library deck (and subset refs) stays clean', () => {
  const result = validateSpec(specWithDecks([
    { id: 'p-title', type: 'title', title: 'Pillar' },
    { id: 'p-diag', type: 'diagram-svg', title: 'Fine', panels: [{ nodes: [{ id: 'a', label: 'A' }] }] },
  ]));

  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.deepEqual(result.errors, []);
  assert.equal(result.count, 0);
});

test('nested hierarchy child decks are deep-validated too', () => {
  const spec = {
    scenes: [{ id: 'root-title', type: 'title', title: 'Root' }],
    library: {
      decks: [
        {
          id: 'parent',
          title: 'Parent',
          deckType: 'hierarchy',
          scenes: [{ id: 'parent-title', type: 'title', title: 'Parent' }],
          children: [
            {
              id: 'child',
              title: 'Child',
              deckType: 'hierarchy',
              scenes: [{ id: 'c-bad', type: 'diagram-svg', title: 'Broken', panels: [{ nodes: [{ id: 7 }] }] }],
            },
          ],
        },
      ],
    },
  };
  const result = validateSpec(spec);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /library\.decks\["child"\]\.scenes\[0\]/);
});

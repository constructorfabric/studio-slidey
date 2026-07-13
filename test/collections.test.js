'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveDeckSpec, linksForScene } = require('../src/collections');
const { validateSpec } = require('../src/validate');

function collectionSpec() {
  return {
    meta: { title: 'Platform brief', mode: 'pitch' },
    library: {
      title: 'Platform library',
      decks: [
        {
          id: 'exec',
          title: 'Executive summary',
          deckType: 'hierarchy',
          scenes: [
            { id: 'exec-intro', type: 'title', title: 'Executive summary', subtitle: 'Separate deck' },
            {
              id: 'exec-architecture',
              type: 'cards',
              variant: 'grid',
              title: 'Architecture summary',
              section: 'architecture',
              cards: [{ label: 'Open architecture', deck: 'architecture', section: 'architecture' }],
            },
          ],
          children: [
            {
              id: 'architecture',
              title: 'Architecture deep dive',
              deckType: 'hierarchy',
              scenes: [
                { id: 'arch-title', type: 'title', title: 'Architecture', subtitle: 'Separate child deck' },
                { id: 'arch-flow', type: 'cards', variant: 'grid', title: 'Flow', cards: [{ label: 'Two' }] },
              ],
            },
          ],
        },
        {
          id: 'brief',
          title: 'Brief subset',
          deckType: 'subset',
          purpose: 'executive',
          theme: 'outcomes',
          scenes: ['intro', 'risk'],
        },
        {
          id: 'workshop',
          title: 'Workshop subset',
          deckType: 'subset',
          select: { tags: ['workshop'] },
        },
      ],
      sections: [
        { id: 'architecture', title: 'Architecture', deck: 'architecture' },
      ],
    },
    scenes: [
      { id: 'intro', type: 'title', title: 'Platform', subtitle: 'Source deck' },
      { id: 'risk', type: 'cards', variant: 'grid', title: 'Risk', tags: ['exec', 'workshop'], section: 'architecture', cards: [{ label: 'One' }] },
      { id: 'flow', type: 'cards', variant: 'grid', title: 'Flow', tags: ['workshop'], section: 'architecture', cards: [{ label: 'Two' }] },
      { id: 'appendix', type: 'cards', variant: 'grid', title: 'Appendix', tags: ['detail'], cards: [{ label: 'Three' }] },
    ],
  };
}

test('collection deck resolves explicit scene refs from the source deck', () => {
  const spec = collectionSpec();
  const resolved = resolveDeckSpec(spec, { deckId: 'brief' });

  assert.equal(resolved.isCollection, true);
  assert.equal(resolved.isSource, false);
  assert.deepEqual(resolved.spec.scenes.map(scene => scene.id), ['intro', 'risk']);
  assert.equal(resolved.spec.meta.title, 'Brief subset');
  assert.equal(resolved.spec.scenes[1]._library.sourceId, 'risk');

  spec.scenes[1].title = 'Updated risk';
  const next = resolveDeckSpec(spec, { deckId: 'brief' });
  assert.equal(next.spec.scenes[1].title, 'Updated risk');
});

test('collection deck selector builds a synced tag subset', () => {
  const resolved = resolveDeckSpec(collectionSpec(), { deckId: 'workshop' });

  assert.deepEqual(resolved.spec.scenes.map(scene => scene.id), ['risk', 'flow']);
  assert.equal(resolved.deck.deckType, 'subset');
});

test('hierarchy deck resolves local scenes instead of source scenes', () => {
  const resolved = resolveDeckSpec(collectionSpec(), { deckId: 'architecture' });

  assert.deepEqual(resolved.spec.scenes.map(scene => scene.id), ['arch-title', 'arch-flow']);
  assert.equal(resolved.deck.parent, 'exec');
  assert.equal(resolved.deck.deckType, 'hierarchy');
  assert.equal(resolved.spec.scenes[0]._library.deckLocal, true);
  assert.equal(resolved.spec.scenes[0]._library.sourceId, undefined);
});

test('browser hierarchy path orders full stack playback depth-first from the root', async () => {
  const { hierarchyPathForDeck, normalizeDeckDefinitions } = await import('../web/collections.mjs');
  const spec = collectionSpec();
  spec.library.decks[0].children[0].children = [{
    id: 'architecture-api',
    title: 'Architecture API',
    deckType: 'hierarchy',
    scenes: [{ id: 'api-title', type: 'title', title: 'API' }],
  }];
  spec.library.decks.push({
    id: 'vision',
    title: 'Vision',
    deckType: 'hierarchy',
    scenes: [{ id: 'vision-title', type: 'title', title: 'Vision' }],
  });
  assert.deepEqual(
    hierarchyPathForDeck(normalizeDeckDefinitions(spec), 'architecture-api'),
    ['__source', 'exec', 'architecture', 'architecture-api', 'vision'],
  );
  assert.deepEqual(
    hierarchyPathForDeck(normalizeDeckDefinitions(spec), 'brief'),
    ['__source', 'exec', 'architecture', 'architecture-api', 'vision'],
  );
});

test('subset decks can sync scenes from their parent hierarchy and descendants', () => {
  const spec = collectionSpec();
  spec.library.decks[0].children.push({
    id: 'architecture-workshop',
    title: 'Architecture workshop subset',
    deckType: 'subset',
    scenes: [
      { fromDeck: 'exec', ref: 'exec-intro' },
      { fromDeck: 'architecture', ref: 'arch-flow' },
    ],
  });

  const resolved = resolveDeckSpec(spec, { deckId: 'architecture-workshop' });

  assert.deepEqual(resolved.spec.scenes.map(scene => scene.id), ['exec-intro', 'arch-flow']);
  assert.equal(resolved.deck.parent, 'exec');
  assert.equal(resolved.spec.scenes[0]._library.sourceDeckId, 'exec');
  assert.equal(resolved.spec.scenes[1]._library.sourceDeckId, 'architecture');
});

test('subset decks reject upward scene inclusions', () => {
  const spec = collectionSpec();
  spec.library.decks[0].children[0].children = [{
    id: 'invalid-upward-subset',
    title: 'Invalid upward subset',
    deckType: 'subset',
    scenes: [{ fromDeck: 'exec', ref: 'exec-intro' }],
  }];

  const resolved = resolveDeckSpec(spec, { deckId: 'invalid-upward-subset' });

  assert.match(resolved.errors.join('\n'), /outside this subset's parent scope/);
  assert.equal(resolved.spec.scenes.length, 0);
});

test('section metadata creates hierarchical navigation links', () => {
  const resolved = resolveDeckSpec(collectionSpec(), { deckId: 'exec' });
  const summary = resolved.spec.scenes.find(scene => scene.id === 'exec-architecture');
  const links = linksForScene(summary, resolved);
  const deepDive = links.find(link => link.deck === 'architecture');

  assert.ok(deepDive);
  assert.equal(deepDive.section, 'architecture');
});

test('card links are collection navigation links', () => {
  const resolved = resolveDeckSpec(collectionSpec(), { deckId: 'exec' });
  const summary = resolved.spec.scenes.find(scene => scene.id === 'exec-architecture');
  const links = linksForScene(summary, resolved);

  assert.equal(links.filter(link => link.deck === 'architecture').length, 1);
  assert.equal(links[0].label, 'Open architecture');
  assert.equal(links[0].section, 'architecture');
});

test('child decks link back to the associated parent slide section', () => {
  const resolved = resolveDeckSpec(collectionSpec(), { deckId: 'architecture' });
  const childScene = resolved.spec.scenes[0];
  const links = linksForScene(childScene, resolved);
  const parent = links.find(link => link.deck === 'exec');

  assert.ok(parent);
  assert.equal(parent.section, 'architecture');
});

test('validation catches stale child scene refs and missing navigation targets', () => {
  const spec = collectionSpec();
  spec.library.decks[1].scenes.push('missing');
  spec.scenes[0].links = [{ label: 'Broken', deck: 'nope' }];

  const result = validateSpec(spec);

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /missing scene "missing"/);
  assert.match(result.errors.join('\n'), /unknown deck "nope"/);
});

test('browser collection module matches node resolver for subset ids', async () => {
  const web = await import('../web/collections.mjs');
  const resolved = web.resolveDeckSpec(collectionSpec(), { deckId: 'brief' });

  assert.deepEqual(resolved.spec.scenes.map(scene => scene.id), ['intro', 'risk']);
});

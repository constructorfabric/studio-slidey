'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { runCheck } = require('../src/check');

function loopSpec(edge) {
  return {
    scenes: [{
      type: 'diagram-svg',
      title: 'Feedback',
      panels: [{
        nodes: [
          { id: 'a', label: 'A', x: 100, y: 40, w: 300, h: 110 },
          { id: 'b', label: 'B', x: 100, y: 220, w: 300, h: 110 },
          { id: 'c', label: 'C', x: 100, y: 400, w: 300, h: 110 },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
          edge,
        ],
      }],
    }],
  };
}

test('hand-placed upward feedback edges require a return bus', () => {
  const violations = runCheck(loopSpec({ from: 'c', to: 'a', side: 'right' }));
  assert.equal(violations, 1);
});

test('return bus feedback edge passes the static diagram check', () => {
  const violations = runCheck(loopSpec({ from: 'c', to: 'a', style: 'back', bus: 500 }));
  assert.equal(violations, 0);
});

// Regression: --check / slidey_check used to only walk spec.scenes[], so a
// diagram-svg scene that lives inside a library.decks[] hierarchy deck (a
// common pattern for per-pillar sub-decks) was silently skipped — "0
// violation(s)" even when a library-only diagram had real problems.
test('runCheck walks diagram-svg scenes inside library.decks[] hierarchy decks too', () => {
  const narrowNode = { id: 'a', label: 'A very long label that will not fit', x: 0, y: 0, w: 40, h: 20 };
  const spec = {
    scenes: [{ type: 'title', title: 'Root' }],
    library: {
      decks: [
        {
          id: 'pillar',
          title: 'Pillar',
          deckType: 'hierarchy',
          scenes: [{ type: 'diagram-svg', title: 'Pillar diagram', panels: [{ nodes: [narrowNode] }] }],
        },
      ],
    },
  };
  const violations = runCheck(spec);
  assert.ok(violations > 0, 'expected the library-deck diagram-svg scene to be checked and flagged');
});

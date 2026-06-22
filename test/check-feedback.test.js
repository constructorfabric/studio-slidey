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

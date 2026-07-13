'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Fan-in / fan-out elbow bus routing: converging or diverging elbow edges must
// share one trunk line instead of elbowing at per-edge midpoints (which stagger
// with each node's width).

function trunkX(d) {
  // Path shape: M x1 y1 H trunk V y2 H end
  const m = d.match(/ H (-?[\d.]+) V /);
  assert.ok(m, `no H..V trunk in path: ${d}`);
  return Number(m[1]);
}

test('fan-in elbow edges share a trunk just before the target', async () => {
  const { buildPanel } = await import('../web/svg.js');
  const panel = buildPanel({
    nodes: [
      // Sources of different widths — the old midpoint routing staggered these.
      { id: 'a', label: 'A', x: 100, y: 40,  w: 220, h: 110 },
      { id: 'b', label: 'B', x: 100, y: 240, w: 340, h: 110 },
      { id: 'c', label: 'C', x: 100, y: 440, w: 280, h: 110 },
      { id: 'hub', label: 'Hub', x: 700, y: 240, w: 300, h: 110 },
    ],
    edges: [
      { from: 'a', to: 'hub', elbow: true },
      { from: 'b', to: 'hub', elbow: true },
      { from: 'c', to: 'hub', elbow: true },
    ],
  }, 0);

  const trunks = panel.edges.map(e => trunkX(e.d));
  assert.deepEqual(trunks, [650, 650, 650], 'all fan-in trunks align at target.x - 50');
});

test('fan-out elbow edges share a trunk just past the source, direction-aware', async () => {
  const { buildPanel } = await import('../web/svg.js');
  const nodes = [
    { id: 'hub', label: 'Hub', x: 700, y: 240, w: 300, h: 110 },
    { id: 'a', label: 'A', x: 1300, y: 40,  w: 220, h: 110 },
    { id: 'b', label: 'B', x: 1300, y: 440, w: 340, h: 110 },
    { id: 'l', label: 'L', x: 100,  y: 40,  w: 220, h: 110 },
    { id: 'm', label: 'M', x: 100,  y: 440, w: 220, h: 110 },
  ];

  // Rightward fan-out: trunk at source right edge + 50.
  const right = buildPanel({ nodes, edges: [
    { from: 'hub', to: 'a', elbow: true },
    { from: 'hub', to: 'b', elbow: true },
  ] }, 0);
  assert.deepEqual(right.edges.map(e => trunkX(e.d)), [1050, 1050]);

  // Leftward fan-out (RL): trunk at source LEFT edge - 50, not +50.
  const left = buildPanel({ nodes, edges: [
    { from: 'hub', to: 'l', elbow: true },
    { from: 'hub', to: 'm', elbow: true },
  ] }, 0);
  assert.deepEqual(left.edges.map(e => trunkX(e.d)), [650, 650]);
});

test('vertical fan-in elbow edges share a trunk just before the target', async () => {
  const { buildPanel } = await import('../web/svg.js');
  const panel = buildPanel({
    nodes: [
      { id: 'a', label: 'A', x: 100, y: 40, w: 220, h: 90 },
      { id: 'b', label: 'B', x: 500, y: 40, w: 220, h: 150 },
      { id: 'hub', label: 'Hub', x: 300, y: 500, w: 300, h: 110 },
    ],
    edges: [
      { from: 'a', to: 'hub', elbow: 'V' },
      { from: 'b', to: 'hub', elbow: 'V' },
    ],
  }, 0);

  const trunks = panel.edges.map(e => {
    const m = e.d.match(/ V (-?[\d.]+) H /);
    assert.ok(m, `no V..H trunk in path: ${e.d}`);
    return Number(m[1]);
  });
  assert.deepEqual(trunks, [450, 450], 'all vertical fan-in trunks align at target.y - 50');
});

test('single elbow edges keep midpoint routing', async () => {
  const { buildPanel } = await import('../web/svg.js');
  const panel = buildPanel({
    nodes: [
      { id: 'a', label: 'A', x: 100, y: 40, w: 200, h: 110 },
      { id: 'b', label: 'B', x: 700, y: 240, w: 200, h: 110 },
    ],
    edges: [{ from: 'a', to: 'b', elbow: true }],
  }, 0);
  assert.equal(trunkX(panel.edges[0].d), (300 + 700) / 2);
});

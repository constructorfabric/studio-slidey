'use strict';

// Real-browser regression coverage for the graph-scene/graph-projection bugs
// found in the pitch-deck graph audit (BUGs G-1, G-2, G-5). Unlike
// graph-scene.test.js (schema/store/timing, no DOM) and
// graph-projection-renderer.test.js (pure SVG-string math, no layout), these
// assert on real computed layout/geometry from the actual render bundle —
// the class of bug that only shows up once CSS/Cytoscape/the browser box
// model are involved.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { launchOptions, closeBrowser, doctor } = require('../src/browser');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'dist-render', 'render.html');
const haveBundle = fs.existsSync(BUNDLE);

let browserReady;
async function requireBrowser(t) {
  if (!browserReady) browserReady = doctor({ width: 320, height: 180 });
  const ready = await browserReady;
  if (!ready.ok) {
    t.skip(`browser unavailable: ${ready.error}`);
    return false;
  }
  return true;
}

async function openBundle(t) {
  const browser = await puppeteer.launch(launchOptions({ width: 1920, height: 1080 }));
  t.after(() => closeBrowser(browser));
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(`file://${BUNDLE}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__slideyReady === true', { timeout: 15000 });
  await page.evaluate(() => {
    window.slidey.setMeta({ title: 'Graph scene render test' });
    window.slidey.setMode('pitch');
    document.body.classList.add('instant');
  });
  return page;
}

async function showScene(page, scene, opts = {}) {
  const { stepsForScene, applyShow } = await import(path.join(ROOT, 'web', 'sceneSteps.mjs'));
  await page.evaluate(applyShow, scene, opts);
  for (const step of stepsForScene(scene)) {
    await page.evaluate(s => window.slidey.setState(s), step);
  }
  await page.evaluate('window.__slideySettle && window.__slideySettle()');
  await new Promise(resolve => setTimeout(resolve, 300));
}

const baseGraphScene = (caption) => ({
  type: 'graph',
  title: 'Repro',
  layout: 'preset',
  nodes: [
    { id: 'a', label: 'A', x: 0, y: 0 },
    { id: 'b', label: 'B', x: 240, y: 0 },
  ],
  edges: [{ id: 'a-b', from: 'a', to: 'b', label: 'rel' }],
  ...(caption ? { caption } : {}),
});

test(
  'BUG G-1: graph-frame width does not depend on caption length',
  { skip: !haveBundle && 'run npm run build:render first' },
  async (t) => {
    if (!await requireBrowser(t)) return;
    const page = await openBundle(t);

    const frameWidth = () => page.evaluate(() => {
      const r = document.getElementById('graph-frame').getBoundingClientRect();
      return r.width;
    });

    await showScene(page, baseGraphScene('c'));
    const shortWidth = await frameWidth();

    await showScene(page, baseGraphScene('x'.repeat(140)));
    const longWidth = await frameWidth();

    await showScene(page, baseGraphScene(null));
    const noCaptionWidth = await frameWidth();

    // Before the fix these varied by ~10x (a short/absent caption collapsed
    // the frame to the width of the caption/title text). Now the frame fills
    // the slide regardless of caption length.
    assert.ok(shortWidth > 1200, `short-caption frame should be wide, got ${shortWidth}`);
    assert.equal(Math.round(shortWidth), Math.round(longWidth));
    assert.equal(Math.round(shortWidth), Math.round(noCaptionWidth));
  },
);

test(
  'BUG G-2: projection <svg> is sized to the graph\'s true aspect ratio with no dead space',
  { skip: !haveBundle && 'run npm run build:render first' },
  async (t) => {
    if (!await requireBrowser(t)) return;
    const page = await openBundle(t);

    const projectionData = {
      version: 1,
      graphs: [{
        id: 'g1',
        w: 1000,
        h: 500, // 2:1 aspect, deliberately unlike the 16:9-ish slide frame
        nodes: [
          { id: 'a', lane: 0, row: 0 },
          { id: 'b', lane: 2, row: 0 },
        ],
        edges: [{ from: 'a', to: 'b' }],
      }],
      states: { s1: { graph: 'g1', status: {} } },
    };
    const scene = { type: 'graph', title: 'Projection repro', projection: 'proj.json', state: 's1', caption: 'c' };
    await showScene(page, scene, { projectionData });

    const rects = await page.evaluate(() => {
      const frame = document.getElementById('graph-frame');
      const svg = frame.querySelector('svg');
      const f = frame.getBoundingClientRect();
      const s = svg.getBoundingClientRect();
      return { frame: { width: f.width, height: f.height }, svg: { width: s.width, height: s.height } };
    });

    const graphAspect = 1000 / 500;
    const svgAspect = rects.svg.width / rects.svg.height;
    assert.ok(Math.abs(graphAspect - svgAspect) < 0.02, `rendered svg aspect (${svgAspect}) should match the graph's (${graphAspect})`);
    // The svg should fill the frame on at least one axis (the constraining
    // one) — i.e. no more dead space than the aspect mismatch strictly forces.
    const fillsWidth = Math.abs(rects.svg.width - rects.frame.width) < 1;
    const fillsHeight = Math.abs(rects.svg.height - rects.frame.height) < 1;
    assert.ok(fillsWidth || fillsHeight, 'svg should fill the frame on at least one axis');
  },
);

test(
  'BUG G-5: crossing edge labels in a dense grid do not overlap',
  { skip: !haveBundle && 'run npm run build:render first' },
  async (t) => {
    if (!await requireBrowser(t)) return;
    const page = await openBundle(t);

    // Classic X-crossing: two diagonals of a 2x2 grid block share the exact
    // same straight-line midpoint, so without de-collision both labels land
    // on top of each other.
    const scene = {
      type: 'graph',
      title: 'Crossing labels',
      layout: 'preset',
      layoutTemplate: 'lane-grid',
      grid: { columns: 3, rows: 3, x: 100, y: 100, width: 1200, height: 800 },
      nodeFontSize: 24,
      edgeFontSize: 20,
      nodes: [
        { id: 'tl', label: 'Top left', col: 1, row: 1 },
        { id: 'tr', label: 'Top right', col: 2, row: 1 },
        { id: 'bl', label: 'Bottom left', col: 1, row: 2 },
        { id: 'br', label: 'Bottom right', col: 2, row: 2 },
      ],
      edges: [
        { id: 'diag-1', from: 'tl', to: 'br', label: 'role evidence' },
        { id: 'diag-2', from: 'bl', to: 'tr', label: 'requires events' },
      ],
    };
    await showScene(page, scene);

    // Cytoscape draws edge labels to <canvas>, not DOM text nodes, so recover
    // the resolved label anchor via the elements snapshot GraphScene.vue
    // exposes for exactly this (window.__slideyLastGraphElements — see the
    // comment at its assignment site). Each anchor = the node-position
    // midpoint plus the resolved labelMarginX/Y, i.e. the same point the
    // component's own de-collision math (and Cytoscape's text-margin-x/y)
    // place the label at.
    const anchors = await page.evaluate(() => {
      const built = window.__slideyLastGraphElements || [];
      const nodesById = new Map(built.filter(el => el.group === 'nodes').map(el => [el.data.id, el.position]));
      return built
        .filter(el => el.group === 'edges')
        .map(el => {
          const source = nodesById.get(el.data.source);
          const target = nodesById.get(el.data.target);
          const midX = (source.x + target.x) / 2;
          const midY = (source.y + target.y) / 2;
          return {
            id: el.data.id,
            label: el.data.label,
            x: midX + Number(el.data.labelMarginX || 0),
            y: midY + Number(el.data.labelMarginY || 0),
          };
        });
    });

    assert.equal(anchors.length, 2);
    const [a, b] = anchors;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    // Before the fix both edges resolved to the exact same offset (identical
    // lane bucket + identical geometric midpoint for a symmetric X-crossing),
    // so dist was 0. The de-collision pass must separate them by at least a
    // label's height so neither box fully occludes the other.
    assert.ok(dist > 20, `crossing edge labels should be separated (got ${dist}px apart): ${JSON.stringify(anchors)}`);
  },
);

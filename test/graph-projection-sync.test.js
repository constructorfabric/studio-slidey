'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { syncMockup } = require('../tools/graph-projection-sync.js');

function tmpFile(name, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-gp-sync-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}

const PROJECTION = {
  version: 1,
  graphs: [{ id: 'g1', nodes: [{ id: 'a' }, { id: 'b' }] }],
};

test('syncMockup inserts both blocks before the first <script> tag on a fresh mockup', () => {
  const mockup = tmpFile('mockup.html', '<html><head></head><body>\n  <script>console.log("app");</script>\n</body></html>');
  const projection = tmpFile('projection.json', JSON.stringify(PROJECTION));

  const result = syncMockup(mockup, projection);
  assert.equal(result.rendererInserted, true);
  assert.equal(result.dataInserted, true);
  assert.equal(result.graphCount, 1);
  assert.equal(result.nodeCount, 2);

  const html = fs.readFileSync(mockup, 'utf8');
  assert.match(html, /<!-- graph-projection:renderer:begin -->/);
  assert.match(html, /<!-- graph-projection:renderer:end -->/);
  assert.match(html, /<!-- graph-projection:data:begin -->/);
  assert.match(html, /window\.__GRAPH_PROJECTION__ = /);
  assert.match(html, /function renderGraphProjection\(/, 'the inlined renderer source is present');

  // renderer block precedes the data block, and both precede the app script
  const rendererIdx = html.indexOf('graph-projection:renderer:begin');
  const dataIdx = html.indexOf('graph-projection:data:begin');
  const appIdx = html.indexOf('console.log("app")');
  assert.ok(rendererIdx < dataIdx, 'renderer block comes first');
  assert.ok(dataIdx < appIdx, 'both generated blocks precede the app script');
});

test('syncMockup is idempotent: a second run replaces in place without duplicating markers', () => {
  const mockup = tmpFile('mockup.html', '<html><head></head><body>\n  <script>console.log("app");</script>\n</body></html>');
  const projection = tmpFile('projection.json', JSON.stringify(PROJECTION));

  syncMockup(mockup, projection);
  const firstPass = fs.readFileSync(mockup, 'utf8');

  const second = syncMockup(mockup, projection);
  assert.equal(second.rendererInserted, false);
  assert.equal(second.dataInserted, false);

  const secondPass = fs.readFileSync(mockup, 'utf8');
  assert.equal(secondPass, firstPass, 're-syncing identical inputs is a byte-for-byte no-op');
  assert.equal((secondPass.match(/graph-projection:renderer:begin/g) || []).length, 1);
  assert.equal((secondPass.match(/graph-projection:data:begin/g) || []).length, 1);
});

test('syncMockup picks up a changed projection JSON on the next run', () => {
  const mockup = tmpFile('mockup.html', '<html><head></head><body>\n  <script>console.log("app");</script>\n</body></html>');
  const projection = tmpFile('projection.json', JSON.stringify(PROJECTION));

  syncMockup(mockup, projection);
  fs.writeFileSync(projection, JSON.stringify({ version: 1, graphs: [{ id: 'g1', nodes: [{ id: 'a' }] }, { id: 'g2', nodes: [] }] }));
  const result = syncMockup(mockup, projection);

  assert.equal(result.graphCount, 2);
  assert.equal(result.nodeCount, 1);
  const html = fs.readFileSync(mockup, 'utf8');
  assert.match(html, /"g2"/);
});

test('syncMockup falls back to inserting before </body> when there is no <script> tag', () => {
  const mockup = tmpFile('mockup.html', '<html><head></head><body>\n  <p>no scripts here</p>\n</body></html>');
  const projection = tmpFile('projection.json', JSON.stringify(PROJECTION));

  syncMockup(mockup, projection);
  const html = fs.readFileSync(mockup, 'utf8');
  const dataEndIdx = html.indexOf('graph-projection:data:end');
  const bodyCloseIdx = html.indexOf('</body>');
  assert.ok(dataEndIdx < bodyCloseIdx, 'generated blocks land before </body>');
});

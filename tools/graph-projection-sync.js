#!/usr/bin/env node
/**
 * SLIDEY — graph-projection mockup sync
 *
 * Refreshes a self-contained mockup HTML's inlined graph-projection renderer
 * + data blocks from the canonical projection JSON. Keeps the projection JSON
 * as the single source of truth (see graph_scenario.project /
 * ~/code/POG/.context/mockup-demo-tooling-contract.md #7) while letting the
 * mockup stay a fully self-contained file (no runtime fetch of the
 * projection — the data is inlined, same as the renderer).
 *
 * Usage:
 *   node tools/graph-projection-sync.js <mockup.html> <projection.json>
 *
 * Idempotent: writes/updates two clearly delimited generated blocks in the
 * mockup —
 *
 *   <!-- graph-projection:renderer:begin --> ... <!-- graph-projection:renderer:end -->
 *   <!-- graph-projection:data:begin -->     ... <!-- graph-projection:data:end -->
 *
 * — leaving everything else in the file untouched. If a block doesn't exist
 * yet, both are inserted together right before the mockup's first <script>
 * tag (so renderGraphProjection/window.__GRAPH_PROJECTION__ are defined
 * before any app script that uses them), or before </body> if there is no
 * <script> tag at all. Re-running after any edit to the projection JSON, or
 * after web/graph-projection/renderer.js changes, brings the mockup back in
 * sync — this is the ONLY intended way to edit those two blocks by hand.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RENDERER_PATH = path.resolve(__dirname, '..', 'web', 'graph-projection', 'renderer.js');

const RENDERER_BEGIN = '<!-- graph-projection:renderer:begin -->';
const RENDERER_END = '<!-- graph-projection:renderer:end -->';
const DATA_BEGIN = '<!-- graph-projection:data:begin -->';
const DATA_END = '<!-- graph-projection:data:end -->';

function block(beginMarker, endMarker, innerHtml) {
  return `${beginMarker}\n${innerHtml}\n${endMarker}`;
}

function replaceOrInsertBlock(html, beginMarker, endMarker, innerHtml, insertBeforeIndex) {
  const beginIdx = html.indexOf(beginMarker);
  const endIdx = html.indexOf(endMarker);
  const newBlock = block(beginMarker, endMarker, innerHtml);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = html.slice(0, beginIdx);
    const after = html.slice(endIdx + endMarker.length);
    return { html: before + newBlock + after, inserted: false };
  }
  const before = html.slice(0, insertBeforeIndex);
  const after = html.slice(insertBeforeIndex);
  const indent = before.match(/[ \t]*$/)[0];
  return { html: before + newBlock + '\n' + indent + after, inserted: true };
}

function firstScriptIndex(html) {
  const m = /<script[\s>]/i.exec(html);
  if (m) return m.index;
  const bodyClose = html.indexOf('</body>');
  if (bodyClose !== -1) return bodyClose;
  return html.length;
}

function syncMockup(mockupPath, projectionPath) {
  const mockupAbs = path.resolve(mockupPath);
  const projectionAbs = path.resolve(projectionPath);
  const html = fs.readFileSync(mockupAbs, 'utf8');
  const rendererSrc = fs.readFileSync(RENDERER_PATH, 'utf8');
  const projectionJson = JSON.parse(fs.readFileSync(projectionAbs, 'utf8'));

  const rendererInner = `<script>\n${rendererSrc.trimEnd()}\n</script>`;
  const dataInner = `<script>\n  window.__GRAPH_PROJECTION__ = ${JSON.stringify(projectionJson, null, 2)};\n</script>`;

  const insertAt = firstScriptIndex(html);
  const step1 = replaceOrInsertBlock(html, RENDERER_BEGIN, RENDERER_END, rendererInner, insertAt);
  // Recompute insertion point in case the renderer block itself was freshly
  // inserted (shifts offsets); the data block always goes right after it.
  const rendererEndIdx = step1.html.indexOf(RENDERER_END) + RENDERER_END.length;
  const step2 = replaceOrInsertBlock(step1.html, DATA_BEGIN, DATA_END, dataInner, rendererEndIdx);

  fs.writeFileSync(mockupAbs, step2.html);
  return {
    mockupPath: mockupAbs,
    projectionPath: projectionAbs,
    rendererInserted: step1.inserted,
    dataInserted: step2.inserted,
    rendererBytes: rendererSrc.length,
    graphCount: Array.isArray(projectionJson.graphs) ? projectionJson.graphs.length : 0,
    nodeCount: Array.isArray(projectionJson.graphs)
      ? projectionJson.graphs.reduce((n, g) => n + (g.nodes ? g.nodes.length : 0), 0)
      : 0,
  };
}

function main(argv) {
  const [mockupPath, projectionPath] = argv;
  if (!mockupPath || !projectionPath) {
    process.stderr.write('usage: node tools/graph-projection-sync.js <mockup.html> <projection.json>\n');
    process.exitCode = 1;
    return;
  }
  const result = syncMockup(mockupPath, projectionPath);
  process.stdout.write(
    `[graph-projection-sync] ${result.mockupPath}\n` +
    `  renderer: ${result.rendererInserted ? 'inserted' : 'updated'} (${result.rendererBytes} bytes)\n` +
    `  data:     ${result.dataInserted ? 'inserted' : 'updated'} (${result.graphCount} graphs, ${result.nodeCount} nodes) from ${result.projectionPath}\n`
  );
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { syncMockup };

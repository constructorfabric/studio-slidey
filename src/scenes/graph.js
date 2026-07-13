/**
 * SLIDEY - graph scene (Cytoscape, or a graph-projection input mode)
 *
 * Declarative graph viewer. Two input modes:
 *   - nodes/edges (default): Cytoscape.js viewer. The first reveal shows the
 *     graph, then each graph_focus_<n> reveal moves the camera to the next
 *     focus node.
 *   - projection/state: renders a graph-projection v1 JSON (see
 *     ~/code/POG/.context/mockup-demo-tooling-contract.md #7) through the
 *     shared, dependency-free web/graph-projection/renderer.js instead —
 *     rounded-rect nodes on a lane/row grid with per-state status overlays.
 *     No focus path / camera in this mode (path/focus are Cytoscape-only).
 */

'use strict';

const TIMING = require('../timing');
const { sceneShowOpts } = require('../assets');

function focusPath(scene) {
  const path = Array.isArray(scene.path) && scene.path.length
    ? scene.path
    : (Array.isArray(scene.focus) ? scene.focus : []);
  return path.map(entry => typeof entry === 'string' ? { node: entry } : entry).filter(entry => entry && entry.node);
}

async function render(page, scene, ctx) {
  const opts = sceneShowOpts(scene, ctx.specPath);
  await page.evaluate((s, o) => window.slidey.showGraph(s, o.projectionData || null), scene, opts);
  if (scene.title) await ctx.setState('graph_title');
  await ctx.setState('graph_frame');
  const path = focusPath(scene);
  for (let i = 0; i < path.length; i++) {
    await ctx.setState(`graph_focus_${i}`);
  }
  if (scene.caption) await ctx.setState('graph_caption');
  await ctx.hold(scene.hold ?? TIMING.graph_hold, 'graph_hold');
  await page.evaluate(() => window.slidey.hideGraph());
  await ctx.hold(TIMING.inter_scene, 'inter_scene');
}

module.exports = { render };

/**
 * SLIDEY — Diagram scene
 *
 * Displays one or two ASCII/text diagrams side-by-side (or in sequence)
 * with a caption underneath. Useful for before/after comparisons.
 *
 * Spec:
 *   {
 *     "type": "diagram",
 *     "title":   "Before vs after",     // optional eyebrow
 *     "panels": [
 *       { "label": "Before",  "ascii": "..." },
 *       { "label": "After",   "ascii": "..." }
 *     ],
 *     "caption": "Two panels, side by side.",
 *     "hold":    180
 *   }
 *
 * Single-panel diagrams use a one-element panels array.
 */

'use strict';

const TIMING = require('../timing');

async function render(page, scene, ctx) {
  await page.evaluate(s => window.slidey.showDiagram(s), scene);
  await ctx.setState('diagram_title');
  for (let i = 0; i < (scene.panels || []).length; i++) {
    await ctx.setState(`diagram_panel_${i}`);
  }
  if (scene.caption) await ctx.setState('diagram_caption');
  await ctx.hold(scene.hold ?? TIMING.diagram_hold, 'diagram_hold');
  await page.evaluate(() => window.slidey.hideDiagram());
  await ctx.hold(TIMING.inter_scene, 'inter_scene');
}

module.exports = { render };

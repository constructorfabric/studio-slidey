/**
 * SLIDEY — Chart scene
 *
 * Deterministic data charts rendered as hand-built inline SVG (no Chart.js /
 * D3 / dagre). Mirrors the diagram-svg discipline: a single fixed viewBox with
 * preserveAspectRatio="xMidYMid meet", simple nice-number scales computed in
 * the component, and reveal-driven visibility.
 *
 * Variants: "bar" | "line" | "area" | "pie" | "scatter" | "quadrant".
 *
 * Spec:
 *   {
 *     "type": "chart",
 *     "variant": "bar",
 *     "title":  "Routing cost",            // optional eyebrow
 *     "unit":   "%",                        // optional, appended to y values
 *     "axes":   { "x": "phase", "y": "tokens" },   // optional axis titles
 *     "series": [
 *       { "name": "before", "color": "primary",
 *         "points": [ { "x": "plan", "y": 120 }, { "x": "run", "y": 90 } ] },
 *       { "name": "after",  "color": "green",
 *         "points": [ { "x": "plan", "y": 40 },  { "x": "run", "y": 30 } ] }
 *     ],
 *     "caption": "Deterministic routing cuts plan-phase tokens 3x.",
 *     "hold":    210
 *   }
 *
 * Series colour names map to design tokens:
 *   primary #58a6ff · secondary #bc8cff · green #3fb950 · orange #f0883e ·
 *   red #f85149 · teal #39c5cf   (unknown/omitted → accent palette by index)
 *
 * Reveal order: title → frame (axes/gridlines) → one step per series → caption.
 * For pie/quadrant there is a single logical "series" so exactly one
 * chart_series_0 step reveals all slices/points.
 */

'use strict';

const TIMING = require('../timing');

// pie/quadrant have one visual series even if authored with one entry; every
// other variant gets one reveal step per series.
function seriesCount(scene) {
  const v = scene.variant || 'bar';
  if (v === 'pie' || v === 'quadrant') return 1;
  return Math.max(1, (scene.series || []).length);
}

async function render(page, scene, ctx) {
  await page.evaluate(s => window.slidey.showChart(s), scene);
  await ctx.setState('chart_title');
  await ctx.setState('chart_frame');
  const n = seriesCount(scene);
  for (let i = 0; i < n; i++) {
    await ctx.setState(`chart_series_${i}`);
  }
  if (scene.caption) await ctx.setState('chart_caption');
  await ctx.hold(scene.hold ?? (TIMING.chart_hold ?? TIMING.diagramsvg_hold), 'chart_hold');
  await page.evaluate(() => window.slidey.hideChart());
  await ctx.hold(TIMING.inter_scene, 'inter_scene');
}

module.exports = { render };

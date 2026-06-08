/**
 * SLIDEY — Table scene
 *
 * A bordered grid for tabular beats. Switches on `variant`:
 *
 *   - data       — plain values; numeric cells right-aligned; zebra rows
 *                  (alternating panel bg #161b22). Use for metrics / numbers.
 *   - comparison — first column is the criterion; body cells may be ✓ / ✗
 *                  (rendered green / red) or short text. Optionally highlight a
 *                  favoured column with `winner` (column index).
 *   - scorecard  — like comparison, but `winner` (column index) is "crowned":
 *                  its header gets the accent colour + a ▸ marker and the whole
 *                  column gets a highlighted background.
 *
 * Spec:
 *   {
 *     "type": "table",
 *     "variant": "data" | "comparison" | "scorecard",
 *     "title":   "Routing latency by layer",   // optional eyebrow
 *     "columns": ["Layer", "p50", "p99"],       // header cells (≤ 6)
 *     "rows": [
 *       { "cells": ["synonym", "2 ms", "5 ms"], "highlight": 1 }
 *       // highlight (optional) = column index to accent in this row
 *     ],
 *     "winner":  2,                              // comparison/scorecard column index
 *     "caption": "Deterministic layers dominate.", // optional
 *     "hold":    200
 *   }
 *
 * Caps (kept inside the 1920x1080 stage): up to 6 columns and 8 rows. Extra
 * columns/rows are clipped by the component, and this module only emits reveal
 * steps for the first 8 rows — so the rendered row count always equals the
 * revealed-step count (a --check-friendly invariant; see sceneSteps.mjs, which
 * must apply the same MAX_ROWS = 8 cap when building table_row_* steps).
 *
 * Reveal order: title → header row → one step per body row → caption.
 */

'use strict';

const TIMING = require('../timing');

const MAX_ROWS = 8;

async function render(page, scene, ctx) {
  await page.evaluate(s => window.slidey.showTable(s), scene);
  await ctx.setState('table_title');
  await ctx.setState('table_header');
  const rows = (scene.rows || []).slice(0, MAX_ROWS);
  for (let i = 0; i < rows.length; i++) {
    await ctx.setState(`table_row_${i}`);
  }
  if (scene.caption) await ctx.setState('table_caption');
  await ctx.hold(scene.hold ?? TIMING.table_hold ?? TIMING.trace_hold, 'table_hold');
  await page.evaluate(() => window.slidey.hideTable());
  await ctx.hold(TIMING.inter_scene, 'inter_scene');
}

module.exports = { render };

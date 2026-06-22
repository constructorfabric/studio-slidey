/**
 * SLIDEY — Mermaid scene
 *
 * Renders Mermaid source directly in the browser bundle so diagrams remain
 * themeable and vector in PDF output instead of pre-exported PNG screenshots.
 */

'use strict';

const TIMING = require('../timing');

async function render(page, scene, ctx) {
  await page.evaluate(s => window.slidey.showMermaid(s), scene);
  if (scene.title) await ctx.setState('mermaid_title');
  await ctx.setState('mermaid_frame');
  if (scene.caption) await ctx.setState('mermaid_caption');
  await ctx.hold(scene.hold ?? TIMING.mermaid_hold ?? TIMING.diagramsvg_hold, 'mermaid_hold');
  await page.evaluate(() => window.slidey.hideMermaid());
  await ctx.hold(TIMING.inter_scene, 'inter_scene');
}

module.exports = { render };

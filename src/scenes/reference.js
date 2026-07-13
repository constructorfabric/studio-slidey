'use strict';

const TIMING = require('../timing');

async function render(page, scene, ctx) {
  await page.evaluate(s => window.slidey.showReference(s), scene);
  if (scene.title) await ctx.setState('reference_title');
  await ctx.setState('reference_frame');
  if (scene.caption) await ctx.setState('reference_caption');
  await ctx.hold(scene.hold ?? TIMING.code_hold ?? TIMING.narrative_hold, 'reference_hold');
  await page.evaluate(() => window.slidey.hideReference());
  await ctx.hold(TIMING.inter_scene, 'inter_scene');
}

module.exports = { render };

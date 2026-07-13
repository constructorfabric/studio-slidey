/**
 * SLIDEY -- Kitsoki TUI scene
 *
 * Static Kitsoki terminal welcome/onboarding screen. This is intentionally not
 * a generic terminal dump: it mirrors the Kitsoki startup banner with the Mesa
 * mark, command hints, session status, and a selectable action menu.
 */

'use strict';

const TIMING = require('../timing');

async function render(page, scene, ctx) {
  await page.evaluate(s => window.slidey.showKitsokiTui(s), scene);
  await ctx.setState('kitsokitui_frame');
  await ctx.setState('kitsokitui_welcome');
  await ctx.setState('kitsokitui_menu');
  if (scene.caption) await ctx.setState('kitsokitui_caption');
  await ctx.hold(scene.hold ?? TIMING.kitsokitui_hold ?? TIMING.code_hold, 'kitsokitui_hold');
  await page.evaluate(() => window.slidey.hideKitsokiTui());
  await ctx.hold(TIMING.inter_scene, 'inter_scene');
}

module.exports = { render };

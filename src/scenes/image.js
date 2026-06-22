/**
 * SLIDEY — Image scene
 *
 * Static image slide for migrated Markdown/Marp decks and product screenshots.
 * The renderer inlines local files as data URIs so MP4/PDF/PNG output does not
 * depend on the render bundle's file location.
 */

'use strict';

const TIMING = require('../timing');
const { sceneShowOpts } = require('../assets');

async function render(page, scene, ctx) {
  const opts = sceneShowOpts(scene, ctx.specPath);
  await page.evaluate((s, o) => window.slidey.showImage(s, o.imageDataUri || ''), scene, opts);
  if (scene.title) await ctx.setState('image_title');
  await ctx.setState('image_frame');
  if (scene.caption) await ctx.setState('image_caption');
  await ctx.hold(scene.hold ?? TIMING.image_hold ?? TIMING.diagramsvg_hold, 'image_hold');
  await page.evaluate(() => window.slidey.hideImage());
  await ctx.hold(TIMING.inter_scene, 'inter_scene');
}

module.exports = { render };

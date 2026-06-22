/**
 * SLIDEY — Image comparison scene
 *
 * Side-by-side screenshot review layout for comparing old and new deck renders.
 */

'use strict';

const TIMING = require('../timing');
const { sceneShowOpts } = require('../assets');

async function render(page, scene, ctx) {
  const opts = sceneShowOpts(scene, ctx.specPath);
  await page.evaluate(
    (s, o) => window.slidey.showImageCompare(s, o.leftImageDataUri || '', o.rightImageDataUri || ''),
    scene,
    opts,
  );
  if (scene.title) await ctx.setState('imagecompare_title');
  await ctx.setState('imagecompare_frame');
  if (scene.caption) await ctx.setState('imagecompare_caption');
  await ctx.hold(scene.hold ?? TIMING.imagecompare_hold ?? TIMING.image_hold ?? TIMING.diagramsvg_hold, 'imagecompare_hold');
  await page.evaluate(() => window.slidey.hideImageCompare());
  await ctx.hold(TIMING.inter_scene, 'inter_scene');
}

module.exports = { render };

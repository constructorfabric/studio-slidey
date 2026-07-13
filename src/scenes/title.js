/**
 * SLIDEY — Title scene
 *
 * Full-screen title card. Holds for `hold` frames (default
 * `TIMING.title_card`) then hides.
 *
 * Spec:
 *   { "type": "title", "title": "...", "subtitle": "...", "hold": 300 }
 */

'use strict';

const TIMING = require('../timing');

async function render(page, scene, ctx) {
  await page.evaluate(s => window.slidey.showTitleCard(s), scene);
  await ctx.hold(scene.hold != null ? scene.hold : TIMING.title_card, 'title_card');
  await page.evaluate(() => window.slidey.hideTitleCard());
}

module.exports = { render };

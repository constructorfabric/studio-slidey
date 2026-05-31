/**
 * SLIDEY — CTA (Call To Action) scene
 *
 * End card. Tagline + URL (or any reference text). Visually a relative of
 * the title card but with the brand mark and a tagline below.
 *
 * Spec:
 *   {
 *     "type": "cta",
 *     "wordmark":  "Slidey",
 *     "tagline":   "Declarative videos from a JSON spec",
 *     "url":       "github.com/you/slidey",
 *     "hold":      180
 *   }
 */

'use strict';

const TIMING = require('../timing');

async function render(page, scene, ctx) {
  await page.evaluate(s => window.slidey.showCta(s), scene);
  await ctx.setState('cta_wordmark');
  await ctx.setState('cta_tagline');
  await ctx.setState('cta_url');
  await ctx.hold(scene.hold ?? TIMING.cta_hold, 'cta_hold');
  await page.evaluate(() => window.slidey.hideCta());
}

module.exports = { render };

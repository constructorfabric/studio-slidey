/**
 * SLIDEY — Cards scene
 *
 * A flexible peer-set / contrast / Q&A primitive. One component (CardsScene.vue)
 * switches on `variant` to render either a set of peer items, a side-by-side
 * contrast with a centre divider, or a question/answer pair. This SUPERSEDES the
 * legacy ASCII two-panel 'diagram' comparison — the before-after variant is the
 * intended replacement.
 *
 * Variants (scene.variant):
 *   grid | list | numbered | agenda | icon-row   — peer items (scene.cards[])
 *   before-after | versus | point-counterpoint | pros-cons — two columns
 *   qa                                           — question + answer
 *
 * Spec:
 *   Peer variants:
 *   {
 *     "type": "cards",
 *     "variant": "grid",                 // grid|list|numbered|agenda|icon-row
 *     "title":   "What ships in v1",     // optional eyebrow header
 *     "columns": 3,                      // optional; sensible default from count
 *     "cards": [
 *       { "label": "Routing",            // card heading
 *         "sub":   "deterministic",      // optional sub-line under the label
 *         "lines": ["intent table", "no LLM on the hot path"],  // optional bullets
 *         "icon":  "▸",                  // icon-row only
 *         "style": "primary" },          // primary|secondary|default — accent tint
 *       ...
 *     ],
 *     "caption": "optional footer line",
 *     "hold": 220
 *   }
 *
 *   Two-column contrast variants (before-after|versus|point-counterpoint|pros-cons):
 *   {
 *     "type": "cards",
 *     "variant": "before-after",
 *     "title":  "The shift",
 *     "left":   { "label": "Before", "lines": ["...","..."] },   // item 0
 *     "right":  { "label": "After",  "lines": ["...","..."] },   // item 1
 *     "caption": "...", "hold": 220
 *   }
 *   (A side may use `cards: [{label}]` instead of `lines`. pros-cons prefixes
 *    each line with ✓ on the left/pro side and ✗ on the right/con side.)
 *
 *   QA variant:
 *   {
 *     "type": "cards",
 *     "variant": "qa",
 *     "title":    "FAQ",
 *     "question": "Does it call an LLM on every turn?",   // item 0
 *     "answer":   ["No — routing is a deterministic table.", "The LLM is a fallback."],
 *     "caption": "...", "hold": 220                       // answer may be a string
 *   }
 *
 * Reveal order: title, then one step per item (cards / sides / qa parts), then
 * caption. The item count is len(cards) for peer variants, 2 for the contrast
 * and qa variants. Step base-names match stepsForScene() in web/sceneSteps.mjs.
 */

'use strict';

const TIMING = require('../timing');

// How many revealable "items" this scene has, by variant family.
function itemCount(scene) {
  const v = scene.variant || 'grid';
  if (v === 'qa') return 2;
  if (['before-after', 'versus', 'point-counterpoint', 'pros-cons'].includes(v)) return 2;
  return (scene.cards || []).length;
}

async function render(page, scene, ctx) {
  await page.evaluate(s => window.slidey.showCards(s), scene);
  if (scene.title) await ctx.setState('cards_title');
  const n = itemCount(scene);
  for (let i = 0; i < n; i++) {
    await ctx.setState(`cards_item_${i}`);
  }
  if (scene.caption) await ctx.setState('cards_caption');
  await ctx.hold(scene.hold ?? TIMING.cards_hold ?? TIMING.thread_hold, 'cards_hold');
  await page.evaluate(() => window.slidey.hideCards());
  await ctx.hold(TIMING.inter_scene, 'inter_scene');
}

module.exports = { render, itemCount };

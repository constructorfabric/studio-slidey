/**
 * SLIDEY — Thread scene
 *
 * Renders mocked comment-thread panels (Jira, Bitbucket, GitHub) showing a
 * scripted conversation inside a familiar issue-tracker / review chrome.
 * Multiple panels stack vertically; each panel is one ticket/PR thread with
 * N messages alternating between authors.
 *
 * Spec:
 *   {
 *     "type": "thread",
 *     "title":   "Driven from where work lives",
 *     "panels": [
 *       {
 *         "system":   "jira",            // jira | bitbucket | github
 *         "ref":      "PLTFRM-89507",    // ticket / PR id
 *         "stage":    "refine",          // optional small badge (state name)
 *         "messages": [
 *           { "author": "alice", "role": "dev", "body": "Tighten the auth check." },
 *           { "author": "bot",   "role": "bot", "body": "Plan updated:\n• ..." }
 *         ]
 *       },
 *       { ... }
 *     ],
 *     "caption": "No local checkout. The state machine runs in CI.",
 *     "hold":    270
 *   }
 *
 * Up to 3 panels supported by the timing/reveal table.
 */

'use strict';

const TIMING = require('../timing');

async function render(page, scene, ctx) {
  await page.evaluate(s => window.slidey.showThread(s), scene);
  await ctx.setState('thread_title');
  const panels = scene.panels || [];
  for (let i = 0; i < panels.length; i++) {
    await ctx.setState(`thread_panel_${i}`);
  }
  if (scene.caption) await ctx.setState('thread_caption');
  await ctx.hold(scene.hold ?? TIMING.thread_hold, 'thread_hold');
  await page.evaluate(() => window.slidey.hideThread());
  await ctx.hold(TIMING.inter_scene, 'inter_scene');
}

module.exports = { render };

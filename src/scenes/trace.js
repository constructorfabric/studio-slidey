/**
 * SLIDEY — Trace scene
 *
 * Visualises a multi-layer lookup cascade per turn. Each turn shows the
 * input, the layers it tried, and the resolved result. HIT layers stop the
 * chain; MISS layers cascade to the next.
 *
 * Spec:
 *   {
 *     "type": "trace",
 *     "title":  "Per-turn routing",
 *     "turns": [
 *       {
 *         "user":   "scale frontend to three",
 *         "layers": [
 *           { "name":"synonym",  "result":"MISS" },
 *           { "name":"slot",     "result":"MISS" },
 *           { "name":"LLM",      "result":"HIT", "ms":45 }
 *         ],
 *         "intent": "scale {service:frontend, replicas:3}"
 *       },
 *       {
 *         "user":   "status",
 *         "layers": [
 *           { "name":"synonym", "result":"HIT" }
 *         ],
 *         "intent": "status",
 *         "no_llm": true
 *       }
 *     ],
 *     "caption": "78% of turns route deterministically.",
 *     "hold":    200
 *   }
 *
 * Up to 3 turns supported by the timing/reveal table.
 */

'use strict';

const TIMING = require('../timing');

async function render(page, scene, ctx) {
  await page.evaluate(s => window.slidey.showTrace(s), scene);
  await ctx.setState('trace_title');
  const turns = scene.turns || [];
  for (let i = 0; i < turns.length; i++) {
    await ctx.setState(`trace_turn_${i}`);
  }
  if (scene.caption) await ctx.setState('trace_caption');
  await ctx.hold(scene.hold ?? TIMING.trace_hold, 'trace_hold');
  await page.evaluate(() => window.slidey.hideTrace());
  await ctx.hold(TIMING.inter_scene, 'inter_scene');
}

module.exports = { render };

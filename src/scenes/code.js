/**
 * SLIDEY — Code scene
 *
 * Shows a real text artifact: a source snippet, a diff, a function call ▸ return,
 * a file tree, a config file, or a log/stack-trace. One CodeScene.vue component
 * switches on `scene.variant`. Reveal is coarse: the header/chrome bar, then the
 * whole body in one step, then annotations (if present) — never line-by-line.
 *
 * Spec:
 *   {
 *     "type": "code",
 *     "variant": "source" | "diff" | "function-io" | "tree" | "config" | "log",
 *     "title":   "router.js",                 // filename shown in the chrome bar
 *     "lang":    "javascript",                 // shown at the right of the bar
 *
 *     // source / diff / config / log: the artifact body (string, \n-separated)
 *     "code":    "export function route(turn) {\n  ...\n}",
 *     // source only:
 *     "highlight":   [3],                      // 1-based line numbers to emphasise
 *     "annotations": [{ "line": 3, "text": "deterministic layers run first" }],
 *
 *     // function-io:
 *     "call":    "route('kick off the next bug')",  // the invocation (header bar)
 *     "code":    "// matches slot template",        // optional body
 *     "returns": "{ intent: 'pickup_bug' }",        // the return value
 *
 *     // tree:
 *     "tree":    "src/\n  scenes/\n    code.js",     // indented file tree
 *
 *     "caption": "...",                        // optional line below the body
 *     "hold":    180
 *   }
 *
 * diff line markers: a leading '+' / '-' / ' ' colours the line green / red /
 * neutral (reusing #3fb950 / #f85149).
 */

'use strict';

const TIMING = require('../timing');

async function render(page, scene, ctx) {
  await page.evaluate(s => window.slidey.showCode(s), scene);
  await ctx.setState('code_header');
  await ctx.setState('code_body');
  if (Array.isArray(scene.annotations) && scene.annotations.length) {
    await ctx.setState('code_notes');
  }
  await ctx.hold(scene.hold ?? TIMING.code_hold ?? TIMING.narrative_hold, 'code_hold');
  await page.evaluate(() => window.slidey.hideCode());
  await ctx.hold(TIMING.inter_scene, 'inter_scene');
}

module.exports = { render };

'use strict';

/**
 * SLIDEY — authoring-time validation pass (--check)
 *
 * For each diagram-svg scene, checks that every node's declared w/h is wide
 * and tall enough to fit its rendered text stack without clipping, and that no
 * two nodes overlap.
 *
 * The renderer (web/svg.js buildPanel) is the source of truth. It draws each
 * node as a vertical STACK of single-line text elements, in order:
 *   label (one line) → sub (one line, NOT split on " · ") → each lines[] entry.
 * The stack line-heights are label 50, sub 34, line 32 (px in SVG user units).
 *
 * Font sizes are panel-count dependent, from web/styles/template.css:
 *   SINGLE-panel scene (panels.length === 1):  label 44px, sub 28px, line 26px
 *     (the `#diagramsvg-panels.diagramsvg-panels-single .dsvg-*` overrides)
 *   TWO+-panel scene:                          label 30px, sub 19px, line 18px
 *     (the base `.dsvg-label / .dsvg-sub / .dsvg-line` rules)
 * The text is JetBrains Mono (monospace); per-char advance ≈ 0.6 × font-size.
 *
 * Width check — a box must fit the WIDEST rendered line, each measured at its
 * own font scale (the bold label is wider per char than the smaller sub/line):
 *   label: width    >= label.length * 0.6 * labelFont + PAD_X
 *   FULL sub string: width >= sub.length   * 0.6 * subFont   + PAD_X
 *   each lines[]:    width >= line.length  * 0.6 * lineFont  + PAD_X
 * (The full sub is measured as one line — the renderer never splits it.)
 *
 * Height check — must fit the actual stack:
 *   rows = (label?1:0) + (sub?1:0) + lines.length
 *   h >= (label?50:0) + (sub?34:0) + lines.length*32 + PAD_Y
 *
 * Nodes without an explicit numeric w/h are auto-laid-out by dagre, which sizes
 * boxes to their text — those are skipped here.
 *
 * Overlap: simple AABB between every pair of nodes in the same panel.
 */

/**
 * Run the check pass over a parsed spec.
 * Prints violations per scene.
 * Returns total violation count.
 *
 * @param {object} spec  — parsed slidey JSON spec
 * @returns {number}     — number of violations found
 */
function runCheck(spec) {
  let totalViolations = 0;
  let totalScenesChecked = 0;

  for (let si = 0; si < spec.scenes.length; si++) {
    const scene = spec.scenes[si];
    if (scene.type !== 'diagram-svg') continue;

    totalScenesChecked++;
    const panels = scene.panels || [];
    // The Vue component (DiagramSvgScene.vue) applies the .diagramsvg-panels-single
    // CSS overrides only when there is EXACTLY one panel. Two-or-more panels use
    // the base font sizes.
    const single = panels.length === 1;

    // Font sizes (px) straight from template.css — see the doc comment above.
    const labelFont = single ? 44 : 30;
    const subFont   = single ? 28 : 19;
    const lineFont  = single ? 26 : 18;

    // Stack line-heights from buildPanel (web/svg.js): label 50 / sub 34 / line 32.
    const LH_LABEL = 50;
    const LH_SUB   = 34;
    const LH_LINE  = 32;

    // Monospace advance: JetBrains Mono runs ≈ 0.6em per glyph. A touch of
    // headroom (0.62) absorbs the odd wide glyph without flagging boxes that
    // render fine. PAD_X / PAD_Y are realistic interior insets — kept modest so
    // the check flags real clipping rather than every snug box. Calibrated
    // against hand-corrected demo boxes (e.g. a 300-wide box holding a 14-char
    // sub at 28px must still pass).
    const CHAR = 0.62;
    const PAD_X = 48;
    const PAD_Y = 28;

    const charW = (str, font) => str.length * CHAR * font;

    const sceneViolations = [];

    for (let pi = 0; pi < panels.length; pi++) {
      const panel = panels[pi];
      const nodes = panel.nodes || [];

      for (const node of nodes) {
        const { id, label = '', sub = '', w, h } = node;
        const lines = Array.isArray(node.lines) ? node.lines : [];

        const hasW = Number.isFinite(w);
        const hasH = Number.isFinite(h);

        // ── width: widest rendered line, each at its own font scale ────────
        if (hasW) {
          const widthViolations = [];
          if (label) {
            const need = Math.ceil(charW(label, labelFont) + PAD_X);
            if (w < need) {
              widthViolations.push(`label "${label}" (${label.length} chars) needs ≥${need}`);
            }
          }
          if (sub) {
            const need = Math.ceil(charW(sub, subFont) + PAD_X);
            if (w < need) {
              widthViolations.push(`sub "${sub}" (${sub.length} chars) needs ≥${need}`);
            }
          }
          for (const line of lines) {
            const need = Math.ceil(charW(line, lineFont) + PAD_X);
            if (w < need) {
              widthViolations.push(`line "${line}" (${line.length} chars) needs ≥${need}`);
            }
          }
          if (widthViolations.length > 0) {
            sceneViolations.push(
              `  panel ${pi}, node "${id}": w=${w} too narrow — ${widthViolations.join(', and ')}`
            );
          }
        }

        // ── height: the actual rendered stack ──────────────────────────────
        if (hasH) {
          const rows = (label ? 1 : 0) + (sub ? 1 : 0) + lines.length;
          const heightNeeds = Math.ceil(
            (label ? LH_LABEL : 0) + (sub ? LH_SUB : 0) + lines.length * LH_LINE + PAD_Y
          );
          if (h < heightNeeds) {
            sceneViolations.push(
              `  panel ${pi}, node "${id}": h=${h} too short — ${rows} stacked line(s) need ≥${heightNeeds}`
            );
          }
        }
      }

      // ── overlap check ─────────────────────────────────────────────────
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const na = nodes[a];
          const nb = nodes[b];
          // AABB overlap: two rects overlap if neither is fully to the left/right/above/below
          const overlapX = Math.min(na.x + na.w, nb.x + nb.w) - Math.max(na.x, nb.x);
          const overlapY = Math.min(na.y + na.h, nb.y + nb.h) - Math.max(na.y, nb.y);
          if (overlapX > 0 && overlapY > 0) {
            const gap = -Math.min(overlapX, overlapY);
            sceneViolations.push(
              `  panel ${pi}, node "${na.id}" overlaps node "${nb.id}" (gap: ${gap}px)`
            );
          }
        }
      }

      // ── edge geometry ─────────────────────────────────────────────────
      // Mirrors the renderer's edge solver (web/svg.js buildPanel): a plain
      // connector runs centre-to-centre, so two stacked boxes whose centres are
      // not aligned get a SLANTED line, and a gate/label drawn at the mid-gap
      // OVERLAPS the boxes when the gap is too small. Both render fine
      // geometrically (no node overlap) so the node checks above miss them —
      // both were shipped bugs. Only hand-placed nodes are checked; dagre
      // auto-layout (no explicit x/y) routes its own edges.
      const SLANT_TOL = 4;   // px of perpendicular drift tolerated on a connector
      const placed = (id) => {
        const n = nodes.find((x) => x.id === id);
        return n && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(n[k])) ? n : null;
      };
      for (const e of panel.edges || []) {
        if (e.elbow || e.arch !== undefined) continue; // intentionally bent routes
        const from = placed(e.from);
        const to = placed(e.to);
        if (!from || !to) continue;

        const fcx = from.x + from.w / 2, fcy = from.y + from.h / 2;
        const tcx = to.x + to.w / 2, tcy = to.y + to.h / 2;
        const dx = tcx - fcx, dy = tcy - fcy;
        const horizontal = Math.abs(dx) >= Math.abs(dy);

        // 1) slanted connector — the perpendicular centres must coincide, else
        //    the straight line tilts. Skip true diagonals (perp ≈ along) so only
        //    "meant-to-be-straight but misaligned" edges are flagged.
        const perp = horizontal ? Math.abs(fcy - tcy) : Math.abs(fcx - tcx);
        const along = horizontal ? Math.abs(dx) : Math.abs(dy);
        if (perp > SLANT_TOL && perp < along * 0.5) {
          const axis = horizontal ? 'y' : 'x';
          const a = horizontal ? `${Math.round(fcy)} vs ${Math.round(tcy)}` : `${Math.round(fcx)} vs ${Math.round(tcx)}`;
          sceneViolations.push(
            `  panel ${pi}, edge "${e.from}"→"${e.to}": ${horizontal ? 'horizontal' : 'vertical'} connector slants ${Math.round(perp)}px — node centres misaligned on ${axis} (${a}); equalise the box ${horizontal ? 'heights/y' : 'widths/x'} so it renders straight`
          );
        }

        // 2) gate/label clearance — a gate bar / edge label sits at the mid-gap;
        //    the inter-node gap must clear its text height or it overlaps a box.
        const labelText = e.gate || e.label;
        if (labelText) {
          const gap = horizontal
            ? (dx > 0 ? to.x - (from.x + from.w) : from.x - (to.x + to.w))
            : (dy > 0 ? to.y - (from.y + from.h) : from.y - (to.y + to.h));
          // font px from template.css (single-panel overrides vs base)
          const font = e.gate
            ? (single ? (e.highlighted ? 32 : 26) : (e.highlighted ? 22 : 18))
            : (single ? 26 : 20);
          // text half-height (~0.7·font) + stroke halo/leading each side.
          const needGap = Math.ceil(font * 1.4 + 24);
          if (gap < needGap) {
            sceneViolations.push(
              `  panel ${pi}, edge "${e.from}"→"${e.to}": ${e.gate ? 'gate' : 'label'} "${labelText}" has only ${Math.round(gap)}px between the nodes — needs ≥${needGap} or it overlaps the boxes`
            );
          }
        }
      }
    }

    if (sceneViolations.length > 0) {
      const title = scene.title ? `"${scene.title}"` : '(no title)';
      console.log(`[check] scene ${si} (diagram-svg) ${title}`);
      for (const v of sceneViolations) {
        console.log(v);
      }
      totalViolations += sceneViolations.length;
    }
  }

  console.log('');
  console.log(`[check] ${totalViolations} violation(s) in ${totalScenesChecked} diagram-svg scene(s) checked.`);

  return totalViolations;
}

module.exports = { runCheck };

// SLIDEY — diagram-svg geometry solver
//
// Returns structured render data (nodes/edges as plain objects) that
// DiagramSvgScene.vue renders with v-for.
//
// Feature B — Auto-layout via dagre:
//   If ALL nodes in a panel lack both x and y (or panel.auto_layout === true),
//   dagre computes positions automatically (TB direction). Terminal nodes
//   (no outgoing edges) are ranked as sinks so they land at the bottom rather
//   than colliding with the main pipeline.
//
// Feature A integration — two-pass sizing:
//   buildPanel/buildPanels accept an optional sizeOverrides map
//   (nodeId → {w, h}) containing actual post-render measurements from
//   DiagramSvgScene.vue's getBBox pass. When provided, dagre re-runs with
//   the corrected sizes so layout reflects real text dimensions.

import dagre from 'dagre';
import { linkTargetForItem } from './collections.mjs';

// ---------------------------------------------------------------------------
const LAYOUT_DIRECTIONS = new Set(['TB', 'BT', 'LR', 'RL']);

function clampPositiveNumber(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

function clampIterations(value, fallback, maxIterations = 24) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(0, Math.round(value)), maxIterations);
}

function normalizeRankDir(value) {
  return LAYOUT_DIRECTIONS.has(value) ? value : 'TB';
}

// Size estimation — used for dagre when no override is available.
// Per-char width of 16px is deliberately generous so the first pass never
// under-estimates; Feature A corrects the actual DOM rects post-render and
// feeds the measurements back for pass 2.
// ---------------------------------------------------------------------------
function estimateNodeSize(n, override) {
  if (override) return override;
  const label = n.label || '';
  const sub   = n.sub   || '';
  const lines = n.lines || [];
  const charW  = 16;
  const longestLen = Math.max(label.length, sub.length, ...lines.map(l => l.length), 0);
  const w = Math.max(n.w || 0, longestLen * charW + 90);
  const lineCount = (label ? 1 : 0) + (sub ? 1 : 0) + lines.length;
  const h = Math.max(n.h || 0, lineCount * 44 + 44);
  return { w, h };
}

// ---------------------------------------------------------------------------
// Post-layout overlap resolution.
// Simple iterative AABB push-apart — runs until stable or 12 iterations.
// Only shifts on the smaller overlap axis to minimise graph distortion.
// ---------------------------------------------------------------------------
function resolveOverlaps(positions, gap = 24, maxIterations = 12) {
  const GAP = gap;
  const nodes  = Object.values(positions);
  let changed = true;

  for (let iter = 0; changed && iter < maxIterations; iter++) {
    changed = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 0 && oy > 0) {
          changed = true;
          if (ox <= oy) {
            const d = (ox + GAP) / 2;
            if (a.x <= b.x) { a.x -= d; b.x += d; }
            else             { a.x += d; b.x -= d; }
          } else {
            const d = (oy + GAP) / 2;
            if (a.y <= b.y) { a.y -= d; b.y += d; }
            else             { a.y += d; b.y -= d; }
          }
        }
      }
    }
  }
}

function applyCycleLayout(panel, nodeMap) {
  const cycle = panel.cycle || {};
  const center = cycle.center || { x: 660, y: 380 };
  const rx = cycle.rx || 360;
  const ry = cycle.ry || 230;
  const arrowRx = cycle.arrowRx || rx + 80;
  const arrowRy = cycle.arrowRy || ry + 60;
  const slots = {
    top: -90,
    right: 0,
    bottom: 90,
    left: 180,
    'top-right': -45,
    'bottom-right': 45,
    'bottom-left': 135,
    'top-left': -135,
  };
  const cycleNodes = (panel.nodes || []).filter(n => n.cycle !== false);
  cycleNodes.forEach((n, i) => {
    if (n.x != null && n.y != null) return;
    const angleDeg = n.slot && slots[n.slot] != null
      ? slots[n.slot]
      : -90 + (360 / Math.max(cycleNodes.length, 1)) * i;
    const angle = angleDeg * Math.PI / 180;
    const w = n.w || 320;
    const h = n.h || 170;
    nodeMap[n.id] = {
      ...n,
      x: Math.round(center.x + Math.cos(angle) * rx - w / 2),
      y: Math.round(center.y + Math.sin(angle) * ry - h / 2),
      w,
      h,
    };
  });

  if (cycle.arrow === false) return [];
  if (cycle.variant === 'recycle-logo') {
    return [{
      glyph: cycle.glyph || '♻',
      glyphX: cycle.glyphX ?? center.x,
      glyphY: cycle.glyphY ?? center.y + 95,
      glyphSize: cycle.glyphSize || 420,
    }];
  }

  if (cycle.variant === 'recycle') {
    const markerId = cycle.markerId;
    const topLeft = {
      x: Math.round(center.x - arrowRx * 0.66),
      y: Math.round(center.y - arrowRy * 0.42),
    };
    const topRight = {
      x: Math.round(center.x + arrowRx * 0.58),
      y: Math.round(center.y - arrowRy * 0.54),
    };
    const right = {
      x: Math.round(center.x + arrowRx * 0.72),
      y: Math.round(center.y - arrowRy * 0.20),
    };
    const bottom = {
      x: Math.round(center.x + arrowRx * 0.06),
      y: Math.round(center.y + arrowRy * 0.82),
    };
    const bottomLeft = {
      x: Math.round(center.x - arrowRx * 0.14),
      y: Math.round(center.y + arrowRy * 0.80),
    };
    const left = {
      x: Math.round(center.x - arrowRx * 0.74),
      y: Math.round(center.y - arrowRy * 0.08),
    };

    return [
      {
        d: `M ${topLeft.x} ${topLeft.y} C ${Math.round(center.x - arrowRx * 0.44)} ${Math.round(center.y - arrowRy * 1.05)} ${Math.round(center.x + arrowRx * 0.32)} ${Math.round(center.y - arrowRy * 1.02)} ${topRight.x} ${topRight.y}`,
        markerId,
      },
      {
        d: `M ${right.x} ${right.y} C ${Math.round(center.x + arrowRx * 1.0)} ${Math.round(center.y + arrowRy * 0.16)} ${Math.round(center.x + arrowRx * 0.58)} ${Math.round(center.y + arrowRy * 0.76)} ${bottom.x} ${bottom.y}`,
        markerId,
      },
      {
        d: `M ${bottomLeft.x} ${bottomLeft.y} C ${Math.round(center.x - arrowRx * 0.66)} ${Math.round(center.y + arrowRy * 0.74)} ${Math.round(center.x - arrowRx * 0.98)} ${Math.round(center.y + arrowRy * 0.24)} ${left.x} ${left.y}`,
        markerId,
      },
    ];
  }

  const startAngle = (cycle.startAngle ?? -130) * Math.PI / 180;
  const endAngle = (cycle.endAngle ?? -45) * Math.PI / 180;
  const startX = Math.round(center.x + Math.cos(startAngle) * arrowRx);
  const startY = Math.round(center.y + Math.sin(startAngle) * arrowRy);
  const endX = Math.round(center.x + Math.cos(endAngle) * arrowRx);
  const endY = Math.round(center.y + Math.sin(endAngle) * arrowRy);
  return [{
    ellipse: { cx: center.x, cy: center.y, rx: arrowRx, ry: arrowRy },
    d: `M ${startX} ${startY} A ${arrowRx} ${arrowRy} 0 1 1 ${endX} ${endY}`,
    markerId: cycle.markerId,
    label: cycle.label || null,
    labelX: cycle.labelX ?? center.x,
    labelY: cycle.labelY ?? center.y,
  }];
}

// ---------------------------------------------------------------------------
// Dagre auto-layout
// ---------------------------------------------------------------------------
function applyAutoLayout(panel, sizeOverrides) {
  const nodes = panel.nodes || [];
  const edges = panel.edges || [];
  const rankdir = normalizeRankDir(panel.rankdir);
  const ranksep = clampPositiveNumber(panel.ranksep, 100);
  const nodesep = clampPositiveNumber(panel.nodesep, 80);
  const marginx = clampPositiveNumber(panel.marginx, 50);
  const marginy = clampPositiveNumber(panel.marginy, 50);
  const overlapGap = clampPositiveNumber(panel.overlap_gap, 24);
  const overlapIterations = clampIterations(panel.overlap_iterations, 12);
  const resolveOverlapsWithSettings = panel.resolve_overlaps !== false;

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir,
    ranksep,
    nodesep,
    marginx,
    marginy,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Nodes with no outgoing edges AND more than one incoming edge are true sinks
  // (e.g. a shared "exit: done" reached from multiple phases). Single-predecessor
  // exits are placed naturally so they stay near their source node.
  const hasOutEdge  = new Set(edges.map(e => e.from));
  const inDegree    = {};
  for (const e of edges) inDegree[e.to] = (inDegree[e.to] || 0) + 1;

  const sizeMap = {};
  for (const n of nodes) {
    const sz = estimateNodeSize(n, sizeOverrides[n.id]);
    sizeMap[n.id] = sz;
    const props = { width: sz.w, height: sz.h, label: n.id };
    const isSink = !hasOutEdge.has(n.id);
    const isSharedSink = isSink && (inDegree[n.id] || 0) > 1;
    if (isSharedSink) props.rank = 'sink';
    g.setNode(n.id, props);
  }
  for (const e of edges) {
    if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to);
  }

  dagre.layout(g);

  // Convert dagre center-coords to top-left.
  const result = {};
  for (const id of g.nodes()) {
    const nd = g.node(id);
    const sz = sizeMap[id];
    result[id] = {
      x: Math.round(nd.x - sz.w / 2),
      y: Math.round(nd.y - sz.h / 2),
      w: sz.w,
      h: sz.h,
    };
  }

  if (resolveOverlapsWithSettings) {
    resolveOverlaps(result, overlapGap, overlapIterations);
  }

  // Auto viewBox — tight fit around all nodes plus padding.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y, w, h } of Object.values(result)) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  const pad = 50;
  result.__viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function buildPanel(panel, idx, sizeOverrides = {}) {
  const nodes   = panel.nodes || [];
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const markerId = `arrow-${idx}`;
  const cycleMarkerId = `cycle-arrow-${idx}`;
  const OUTSIDE_BUS_GUTTER = 70;

  const needsAutoLayout =
    panel.auto_layout === true ||
    (nodes.length > 0 && nodes.every(n => n.x == null && n.y == null));

  let layoutMap = null;
  let viewBox   = panel.viewBox || '0 0 400 360';

  if (needsAutoLayout) {
    layoutMap = applyAutoLayout(panel, sizeOverrides);
    if (layoutMap.__viewBox) {
      viewBox = layoutMap.__viewBox;
      delete layoutMap.__viewBox;
    }
    for (const n of nodes) {
      if (layoutMap[n.id]) nodeMap[n.id] = { ...n, ...layoutMap[n.id] };
    }
  }

  const cycleArrows = panel.layout === 'cycle'
    ? applyCycleLayout(panel, nodeMap).map(a => ({ ...a, markerId: a.markerId || cycleMarkerId }))
    : [];

  const renderNodes = nodes.map((n, nodeIdx) => {
    const nd = nodeMap[n.id] || (needsAutoLayout && layoutMap?.[n.id]
      ? { ...n, ...layoutMap[n.id] }
      : n);

    const cx = nd.x + nd.w / 2;
    const cy = nd.y + nd.h / 2;

    // editPath: scene-relative JSON path to the spec field each text renders, so
    // the in-place editor (inline-edit.js) can write the edit back.
    const base = ['panels', idx, 'nodes', nodeIdx];
    const stack = [];
    if (nd.label) stack.push({ text: nd.label, cls: 'dsvg-label', lh: 50, editPath: [...base, 'label'] });
    if (nd.sub)   stack.push({ text: nd.sub,   cls: 'dsvg-sub',   lh: 34, editPath: [...base, 'sub'] });
    (nd.lines || []).forEach((t, li) => stack.push({ text: t, cls: 'dsvg-line', lh: 32, editPath: [...base, 'lines', li] }));

    const totalH = stack.reduce((s, l) => s + l.lh, 0);
    let y = cy - totalH / 2 + (stack[0] ? stack[0].lh / 2 : 0);
    const texts = stack.map(l => {
      const el = { cls: l.cls, x: cx, y, text: l.text, editPath: l.editPath };
      y += l.lh;
      return el;
    });

    return {
      id: nd.id,
      groupClass: `dsvg-node dsvg-style-${nd.style || 'default'}`,
      link: linkTargetForItem(nd),
      rect: { x: nd.x, y: nd.y, w: nd.w, h: nd.h },
      texts,
    };
  });

  // Pre-compute fan-out (multiple elbow edges leaving one source) and fan-in
  // (multiple elbow edges arriving at one target) so bus routing applies
  // automatically — no "bus: true" needed in the spec. Fan-out edges share a
  // trunk just past the source; fan-in edges share a trunk just before the
  // target, so converging edges merge into one clean comb instead of a stagger
  // of near-parallel lines (each source box's width would otherwise shift the
  // midpoint elbow).
  const elbowEdges = (panel.edges || []).filter(e => e.elbow);
  const elbowOutCount = {};
  const elbowInCount  = {};
  for (const e of elbowEdges) {
    elbowOutCount[e.from] = (elbowOutCount[e.from] || 0) + 1;
    elbowInCount[e.to]    = (elbowInCount[e.to]    || 0) + 1;
  }
  const nodeBounds = nodes.reduce((bounds, n) => {
    const nd = nodeMap[n.id] || (needsAutoLayout && layoutMap?.[n.id]
      ? { ...n, ...layoutMap[n.id] }
      : n);
    return {
      minX: Math.min(bounds.minX, nd.x),
      maxX: Math.max(bounds.maxX, nd.x + nd.w),
    };
  }, { minX: Infinity, maxX: -Infinity });
  const normalizeOutsideBus = busX => {
    if (!Number.isFinite(nodeBounds.minX) || !Number.isFinite(nodeBounds.maxX)) return busX;
    if (busX < nodeBounds.minX) return Math.min(busX, nodeBounds.minX - OUTSIDE_BUS_GUTTER);
    if (busX > nodeBounds.maxX) return Math.max(busX, nodeBounds.maxX + OUTSIDE_BUS_GUTTER);
    return busX;
  };

  const renderEdges = (panel.edges || []).map((e, edgeIdx) => {
    const from = nodeMap[e.from], to = nodeMap[e.to];
    if (!from || !to) return null;
    // Scene-relative JSON path to this edge's label field, for in-place editing.
    const labelPath = ['panels', idx, 'edges', edgeIdx, 'label'];

    const fromCx = from.x + from.w / 2, fromCy = from.y + from.h / 2;
    const toCx   = to.x   + to.w   / 2, toCy   = to.y   + to.h   / 2;
    const dx = toCx - fromCx, dy = toCy - fromCy;
    const offset = e.side === 'left' ? -32 : (e.side === 'right' ? 32 : 0);

    let x1, y1, x2, y2;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    if (horizontal) {
      if (dx > 0) { x1 = from.x + from.w; x2 = to.x; }
      else        { x1 = from.x;          x2 = to.x + to.w; }
      y1 = fromCy + offset;
      y2 = toCy   + offset;
    } else {
      if (dy > 0) { y1 = from.y + from.h; y2 = to.y; }
      else        { y1 = from.y;          y2 = to.y + to.h; }
      x1 = fromCx + offset;
      x2 = toCx   + offset;
    }

    const labelX = (x1 + x2) / 2 + (horizontal ? 0 : (e.side === 'left' ? -10 : (e.side === 'right' ? 10 : 0)));
    const labelY = (y1 + y2) / 2 + (horizontal ? -10 : 0);
    const anchor = (!horizontal && e.side === 'left')  ? 'end'
                 : (!horizontal && e.side === 'right') ? 'start'
                 : 'middle';
    const edgeLabelX = fallback => Number.isFinite(e.labelX) ? e.labelX : fallback;
    const edgeLabelY = fallback => Number.isFinite(e.labelY) ? e.labelY : fallback;
    // Pull heads back from target boxes; nodes render above edges, so markers
    // placed exactly on the box edge can be hidden by the node fill.
    const END_GAP = 10;
    // Distance from a node edge to its shared bus trunk (fan-in / fan-out).
    const TRUNK = 50;

    if (e.gate) {
      const gateText = e.gate;
      const gateBarReach = e.highlighted ? 75 : 90;
      const gateGap = e.highlighted
        ? gateText.length * 11 + 27
        : gateText.length * 9  + 22;
      const hl = e.highlighted ? ' dsvg-highlighted' : '';
      // `oracle: true` marks an adversarial LLM-judged gate (solid violet) as
      // opposed to the default deterministic script/test gate (dashed orange).
      const oc = e.oracle ? ' dsvg-gate-oracle' : '';
      return {
        type: 'gate',
        barClass: `dsvg-gate-bar${hl}${oc}`,
        textClass: `dsvg-edge-gate${hl}${oc}`,
        bar1: { x1: labelX - gateBarReach - gateGap, y1: labelY, x2: labelX - gateGap, y2: labelY },
        bar2: { x1: labelX + gateGap, y1: labelY, x2: labelX + gateBarReach + gateGap, y2: labelY },
        text: gateText, labelX, labelY,
        editPath: ['panels', idx, 'edges', edgeIdx, 'gate'],
        dim: !!e.dim,
      };
    }

    // Return bus — a loop-back / recycle arrow that must NOT overlap the
    // forward column. It exits the source's RIGHT edge, runs out to a
    // dedicated vertical lane (`e.bus` = lane x), travels along it, then
    // re-enters the TARGET edge nearest that lane — two right-angle elbows. Several
    // buses fan off the same source: give each a distinct `e.bus` lane and an
    // `e.lift` (vertical offset on the source exit) so their exit runs don't
    // stack. `style:"back"` gives it the cross-phase rework styling (violet) +
    // its own arrowhead; `style:"recycle"` is an in-place self-loop (orange,
    // deterministic) — `e.land` offsets the TARGET re-entry so a from==to loop
    // exits and re-enters at different heights.
    if (e.bus !== undefined) {
      const busX = normalizeOutsideBus(e.bus);
      const sx = from.x + from.w, sy = fromCy + (e.lift || 0);
      const tx = busX < to.x ? to.x : to.x + to.w;
      const ty = toCy + (e.land || 0);
      const isBack = e.style === 'back';
      const isRecycle = e.style === 'recycle';
      const groupClass = 'dsvg-edge' +
        (isBack ? ' dsvg-edge-back' : '') +
        (isRecycle ? ' dsvg-edge-recycle' : '') +
        (e.highlighted ? ' dsvg-highlighted' : '');
      return {
        type: 'elbow',
        d: `M ${sx} ${sy} H ${busX} V ${ty} H ${tx}`,
        markerId: isBack ? `arrow-back-${idx}` : isRecycle ? `arrow-recycle-${idx}` : markerId,
        groupClass,
        label: e.label || null,
        editPath: labelPath,
        labelX: edgeLabelX(busX + 14),
        labelY: edgeLabelY((sy + ty) / 2),
        labelAnchor: e.labelAnchor || 'start',
        dim: !!e.dim,
      };
    }

    if (e.arch !== undefined || e.elbow) {
      let d, lx, ly;
      if (e.arch !== undefined) {
        const archY = e.arch;
        const sx = fromCx, sy = from.y;
        const tx = toCx,   ty = to.y;
        d = `M ${sx} ${sy} V ${archY} H ${tx} V ${ty}`;
        lx = (sx + tx) / 2;
        ly = archY - 14;
      } else {
        const useH = e.elbow === 'H' ? true : e.elbow === 'V' ? false : horizontal;
        let ex1, ey1, ex2, ey2;
        if (useH) {
          if (dx > 0) { ex1 = from.x + from.w; ex2 = to.x; }
          else        { ex1 = from.x;           ex2 = to.x + to.w; }
          ey1 = fromCy + offset;
          ey2 = toCy   + offset;
          // Bus routing (automatic; no spec flag needed): fan-out edges share a
          // trunk x just beyond the source; fan-in edges share a trunk x just
          // before the target. Direction-aware so RL diagrams route correctly.
          const dir = dx > 0 ? 1 : -1;
          const midx = (elbowOutCount[e.from] || 0) > 1 ? ex1 + dir * TRUNK
                     : (elbowInCount[e.to]    || 0) > 1 ? ex2 - dir * TRUNK
                     : (ex1 + ex2) / 2;
          const endX = dx > 0 ? ex2 - END_GAP : ex2 + END_GAP;
          d = `M ${ex1} ${ey1} H ${midx} V ${ey2} H ${endX}`;
          lx = midx;
          ly = (ey1 + ey2) / 2 - 14;
        } else {
          if (dy > 0) { ey1 = from.y + from.h; ey2 = to.y; }
          else        { ey1 = from.y;           ey2 = to.y + to.h; }
          ex1 = fromCx + offset;
          ex2 = toCx   + offset;
          const dirY = dy > 0 ? 1 : -1;
          const midy = (elbowOutCount[e.from] || 0) > 1 ? ey1 + dirY * TRUNK
                     : (elbowInCount[e.to]    || 0) > 1 ? ey2 - dirY * TRUNK
                     : (ey1 + ey2) / 2;
          const endY = dy > 0 ? ey2 - END_GAP : ey2 + END_GAP;
          d = `M ${ex1} ${ey1} V ${midy} H ${ex2} V ${endY}`;
          lx = (ex1 + ex2) / 2;
          ly = midy - 14;
        }
      }
      return {
        type: 'elbow',
        d,
        markerId,
        groupClass: 'dsvg-edge' + (e.highlighted ? ' dsvg-highlighted' : ''),
        label: e.label || null,
        editPath: labelPath,
        labelX: edgeLabelX(lx), labelY: edgeLabelY(ly),
        labelAnchor: e.labelAnchor || 'middle',
        dim: !!e.dim,
      };
    }

    let ax2 = x2, ay2 = y2;
    if (horizontal) ax2 = dx > 0 ? x2 - END_GAP : x2 + END_GAP;
    else            ay2 = dy > 0 ? y2 - END_GAP : y2 + END_GAP;
    return {
      type: 'arrow',
      line: { x1, y1, x2: ax2, y2: ay2 },
      markerId,
      groupClass: 'dsvg-edge' + (e.highlighted ? ' dsvg-highlighted' : ''),
      label: e.label || null,
      editPath: labelPath,
      labelX: edgeLabelX(labelX), labelY: edgeLabelY(labelY), anchor: e.labelAnchor || anchor,
      dim: !!e.dim,
    };
  }).filter(Boolean);

  return {
    viewBox,
    markerId,
    cycleMarkerId,
    label: panel.label || null,
    caption: panel.caption || null,
    cycleArrows,
    nodes: renderNodes,
    edges: renderEdges,
  };
}

export function buildPanels(scene, sizeOverrides = {}) {
  return (scene.panels || []).map((p, i) => buildPanel(p, i, sizeOverrides));
}

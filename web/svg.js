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

// ---------------------------------------------------------------------------
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
function resolveOverlaps(positions) {
  const GAP   = 24;
  const nodes  = Object.values(positions);
  let changed = true;

  for (let iter = 0; changed && iter < 12; iter++) {
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

// ---------------------------------------------------------------------------
// Dagre auto-layout
// ---------------------------------------------------------------------------
function applyAutoLayout(panel, sizeOverrides) {
  const nodes = panel.nodes || [];
  const edges = panel.edges || [];

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: panel.rankdir || 'TB',
    ranksep: panel.ranksep || 100,
    nodesep: panel.nodesep || 80,
    marginx: 50,
    marginy: 50,
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

  resolveOverlaps(result);

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

  const renderNodes = nodes.map(n => {
    const nd = needsAutoLayout && layoutMap?.[n.id]
      ? { ...n, ...layoutMap[n.id] }
      : n;

    const cx = nd.x + nd.w / 2;
    const cy = nd.y + nd.h / 2;

    const stack = [];
    if (nd.label) stack.push({ text: nd.label, cls: 'dsvg-label', lh: 50 });
    if (nd.sub)   stack.push({ text: nd.sub,   cls: 'dsvg-sub',   lh: 34 });
    (nd.lines || []).forEach(t => stack.push({ text: t, cls: 'dsvg-line', lh: 32 }));

    const totalH = stack.reduce((s, l) => s + l.lh, 0);
    let y = cy - totalH / 2 + (stack[0] ? stack[0].lh / 2 : 0);
    const texts = stack.map(l => {
      const el = { cls: l.cls, x: cx, y, text: l.text };
      y += l.lh;
      return el;
    });

    return {
      id: nd.id,
      groupClass: `dsvg-node dsvg-style-${nd.style || 'default'}`,
      rect: { x: nd.x, y: nd.y, w: nd.w, h: nd.h },
      texts,
    };
  });

  // Pre-compute which source nodes have multiple outgoing elbow edges so we
  // can apply bus routing automatically — no "bus: true" needed in the spec.
  const elbowEdges = (panel.edges || []).filter(e => e.elbow);
  const elbowOutCount = {};
  for (const e of elbowEdges) elbowOutCount[e.from] = (elbowOutCount[e.from] || 0) + 1;

  const renderEdges = (panel.edges || []).map(e => {
    const from = nodeMap[e.from], to = nodeMap[e.to];
    if (!from || !to) return null;

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

    if (e.gate) {
      const gateText = e.gate;
      const gateBarReach = e.highlighted ? 75 : 90;
      const gateGap = e.highlighted
        ? gateText.length * 11 + 27
        : gateText.length * 9  + 22;
      const hl = e.highlighted ? ' dsvg-highlighted' : '';
      return {
        type: 'gate',
        barClass: `dsvg-gate-bar${hl}`,
        textClass: `dsvg-edge-gate${hl}`,
        bar1: { x1: labelX - gateBarReach - gateGap, y1: labelY, x2: labelX - gateGap, y2: labelY },
        bar2: { x1: labelX + gateGap, y1: labelY, x2: labelX + gateBarReach + gateGap, y2: labelY },
        text: gateText, labelX, labelY,
        dim: !!e.dim,
      };
    }

    // Return bus — a loop-back / recycle arrow that must NOT overlap the
    // forward column. It exits the source's RIGHT edge, runs out to a
    // dedicated vertical lane (`e.bus` = lane x), travels along it, then
    // re-enters the TARGET's right edge — two right-angle elbows. Several
    // buses fan off the same source: give each a distinct `e.bus` lane and an
    // `e.lift` (vertical offset on the source exit) so their exit runs don't
    // stack. `style:"back"` gives it the recycle styling + its own arrowhead.
    if (e.bus !== undefined) {
      const busX = e.bus;
      const sx = from.x + from.w, sy = fromCy + (e.lift || 0);
      const tx = to.x + to.w,     ty = toCy;
      const isBack = e.style === 'back';
      const groupClass = 'dsvg-edge' +
        (isBack ? ' dsvg-edge-back' : '') +
        (e.highlighted ? ' dsvg-highlighted' : '');
      return {
        type: 'elbow',
        d: `M ${sx} ${sy} H ${busX} V ${ty} H ${tx}`,
        markerId: isBack ? `arrow-back-${idx}` : markerId,
        groupClass,
        label: e.label || null,
        labelX: busX + 14,
        labelY: (sy + ty) / 2,
        labelAnchor: 'start',
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
          // Bus routing: when multiple elbow edges leave the same source, use a
          // common trunk x just beyond the source node so all branches align on
          // a shared vertical line. Activated automatically; no spec flag needed.
          const isBus = e.bus || (elbowOutCount[e.from] || 0) > 1;
          const midx = isBus ? ex1 + 50 : (ex1 + ex2) / 2;
          d = `M ${ex1} ${ey1} H ${midx} V ${ey2} H ${ex2}`;
          lx = midx;
          ly = (ey1 + ey2) / 2 - 14;
        } else {
          if (dy > 0) { ey1 = from.y + from.h; ey2 = to.y; }
          else        { ey1 = from.y;           ey2 = to.y + to.h; }
          ex1 = fromCx + offset;
          ex2 = toCx   + offset;
          const midy = (ey1 + ey2) / 2;
          d = `M ${ex1} ${ey1} V ${midy} H ${ex2} V ${ey2}`;
          lx = (ex1 + ex2) / 2;
          ly = midy - 14;
        }
      }
      return {
        type: 'elbow',
        d,
        markerId,
        label: e.label || null,
        labelX: lx, labelY: ly,
        dim: !!e.dim,
      };
    }

    // Pull the head back from the target box: nodes are drawn over edges, and
    // the arrowhead marker tip lands on the box edge, so without a gap the box
    // fill clips the arrowhead (it reads as "not connected / cut off").
    const END_GAP = 10;
    let ax2 = x2, ay2 = y2;
    if (horizontal) ax2 = dx > 0 ? x2 - END_GAP : x2 + END_GAP;
    else            ay2 = dy > 0 ? y2 - END_GAP : y2 + END_GAP;
    return {
      type: 'arrow',
      line: { x1, y1, x2: ax2, y2: ay2 },
      markerId,
      label: e.label || null,
      labelX, labelY, anchor,
      dim: !!e.dim,
    };
  }).filter(Boolean);

  return {
    viewBox,
    markerId,
    label: panel.label || null,
    caption: panel.caption || null,
    nodes: renderNodes,
    edges: renderEdges,
  };
}

export function buildPanels(scene, sizeOverrides = {}) {
  return (scene.panels || []).map((p, i) => buildPanel(p, i, sizeOverrides));
}

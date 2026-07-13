<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import cytoscape from 'cytoscape';
import { store } from '../store.js';
// Dependency-free shared renderer (also inlined verbatim into self-contained
// mockup HTML, and require()-able from Node) — a side-effect import: it has no
// top-level import/export syntax of its own, so this just runs it and picks up
// the window.renderGraphProjection global it attaches. See the file header in
// ~/code/slidey/web/graph-projection/renderer.js.
import '../graph-projection/renderer.js';

const scene = computed(() => store.scene || {});
const isProjection = computed(() => !!scene.value.projection);
const projectionSvg = ref(null);
const frameRoot = ref(null);
const cyRoot = ref(null);
let cy = null;
let lastNonce = 0;
let resizeObserver = null;
let refreshFrame = 0;
let motionFrame = 0;
let motionStartedAt = 0;
const motionBasePositions = new Map();

function pinnedPosition(node) {
  if (!node) return null;
  if (node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)) return node.position;
  if (Number.isFinite(node.x) && Number.isFinite(node.y)) return { x: node.x, y: node.y };
  return null;
}

function graphGrid() {
  const template = scene.value.layoutTemplate || scene.value.template || '';
  const raw = scene.value.grid && typeof scene.value.grid === 'object' ? scene.value.grid : {};
  if (!template && !Object.keys(raw).length) return null;
  const preset = template === 'lane-grid-3x5' || template === 'grid-3x5'
    ? { columns: 5, rows: 3, x: 105, y: 95, width: 2715, height: 810 }
    : {};
  const columns = Number(raw.columns || raw.cols || preset.columns || 5);
  const rows = Number(raw.rows || raw.lanes || preset.rows || 3);
  if (!Number.isFinite(columns) || columns < 1 || !Number.isFinite(rows) || rows < 1) return null;
  const x = Number(raw.x ?? raw.left ?? preset.x ?? 0);
  const y = Number(raw.y ?? raw.top ?? preset.y ?? 0);
  const width = Number(raw.width ?? raw.w ?? preset.width ?? scene.value.layoutWidth ?? 1400);
  const height = Number(raw.height ?? raw.h ?? preset.height ?? scene.value.layoutHeight ?? 720);
  return { columns, rows, x, y, width, height };
}

function gridPosition(node) {
  const grid = graphGrid();
  if (!grid || !node) return null;
  const rawCol = node.col ?? node.column ?? node.gridColumn ?? node.grid?.col ?? node.grid?.column;
  const rawRow = node.row ?? node.lane ?? node.gridRow ?? node.grid?.row ?? node.grid?.lane;
  if (rawCol == null || rawRow == null) return null;
  const col = Number(rawCol);
  const row = Number(rawRow);
  if (!Number.isFinite(col) || !Number.isFinite(row)) return null;
  const colGap = grid.columns > 1 ? grid.width / (grid.columns - 1) : 0;
  const rowGap = grid.rows > 1 ? grid.height / (grid.rows - 1) : 0;
  const xNudge = Number(node.xOffset ?? node.dx ?? node.grid?.xOffset ?? node.grid?.dx ?? 0);
  const yNudge = Number(node.yOffset ?? node.dy ?? node.grid?.yOffset ?? node.grid?.dy ?? 0);
  return {
    x: grid.x + (col - 1) * colGap + (Number.isFinite(xNudge) ? xNudge : 0),
    y: grid.y + (row - 1) * rowGap + (Number.isFinite(yNudge) ? yNudge : 0),
  };
}

function nodePosition(node) {
  return gridPosition(node) || pinnedPosition(node);
}

function pathEntries() {
  const raw = Array.isArray(scene.value.path) && scene.value.path.length
    ? scene.value.path
    : (Array.isArray(scene.value.focus) ? scene.value.focus : []);
  return raw.map(entry => typeof entry === 'string' ? { node: entry } : entry).filter(entry => entry && entry.node);
}

const activeEntry = computed(() => {
  const path = pathEntries();
  return store.graphFocus >= 0 ? path[store.graphFocus] || null : null;
});

const activeNode = computed(() => {
  const id = activeEntry.value && activeEntry.value.node;
  return (scene.value.nodes || []).find(n => n.id === id) || null;
});

function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function nodeKindColor(kind) {
  const colors = {
    requirement: cssVar('--slidey-love', '#eb6f92'),
    substrate: cssVar('--slidey-foam', '#9ccfd8'),
    proof: cssVar('--slidey-gold', '#f6c177'),
    application: cssVar('--slidey-pine', '#31748f'),
    dependency: cssVar('--slidey-foam', '#9ccfd8'),
    environment: cssVar('--slidey-iris', '#c4a7e7'),
  };
  return colors[kind] || cssVar('--slidey-surface', '#2a273f');
}

function elements() {
  const nodeById = new Map((scene.value.nodes || []).map(n => [String(n.id), n]));
  const nodes = (scene.value.nodes || []).map(n => ({
    group: 'nodes',
    data: {
      id: String(n.id),
      label: String(n.label || n.id),
      sub: String(n.sub || ''),
      kind: String(n.kind || ''),
      weight: Number(n.weight || 1),
      width: Number(n.w || n.width || 210),
      height: Number(n.h || n.height || 100),
      color: n.color || nodeKindColor(n.kind),
      borderColor: n.borderColor || n.stroke || nodeKindColor(n.kind),
      textColor: n.textColor || cssVar('--slidey-text', '#e0def4'),
      glowColor: n.glowColor || n.color || nodeKindColor(n.kind),
    },
    position: nodePosition(n) || undefined,
    classes: [n.kind, n.className, n.classes].flat().filter(Boolean).join(' '),
  }));
  // BUG G-5 fix: shared across the whole map() pass so edges whose labels
  // would land on top of one another (classic in a dense grid — e.g. the two
  // diagonals of a 2x2 node block cross, and share the same edge midpoint)
  // get nudged apart instead of silently overlapping. See deconflictOffset().
  const labelAnchors = [];
  const edges = (scene.value.edges || []).map((e, idx) => {
    const source = nodeById.get(String(e.from));
    const target = nodeById.get(String(e.to));
    const labelOffset = edgeLabelOffset(e, source, target, labelAnchors);
    return {
      group: 'edges',
      data: {
        id: String(e.id || `${e.from}-${e.to}-${idx}`),
        source: String(e.from),
        target: String(e.to),
        label: String(e.label || ''),
        weight: Number(e.weight || e.influence || 2),
        color: e.color || cssVar('--slidey-iris', '#c4a7e7'),
        curve: e.curve || 'bezier',
        controlPointDistances: e.controlPointDistances || e.controlDistances || e.distance || undefined,
        controlPointWeights: e.controlPointWeights || e.controlWeights || e.controlWeight || undefined,
        labelMarginX: labelOffset.x,
        labelMarginY: labelOffset.y,
      },
      classes: [e.kind, e.className, e.classes].flat().filter(Boolean).join(' '),
    };
  });
  return [...nodes, ...edges];
}

function explicitNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

// Rough label box half-extents (px, pre-zoom) from its text length, at the
// default ~20px edge font — used for a size-aware overlap test rather than a
// fixed-radius one, since "of" and "answers auditability" need very
// different clearances (BUG G-5).
function labelHalfExtents(label, fontSize) {
  const size = Number(fontSize) || 20;
  const halfW = Math.max(24, String(label || '').length * size * 0.3) + 6;
  const halfH = size * 0.5 + 6;
  return { halfW, halfH };
}

function rectsOverlap(a, b) {
  return Math.abs(a.x - b.x) < (a.halfW + b.halfW) && Math.abs(a.y - b.y) < (a.halfH + b.halfH);
}

// BUG G-5 fix: nudge a heuristic label offset away from any already-placed
// label box it would overlap. Walks outward from the original offset
// (alternating above/below, growing each attempt) until clear, or gives up
// after a few tries rather than looping forever on a truly crowded spot.
// Explicit author offsets (labelMarginX/Y) are never moved — only
// registered as an obstacle for later heuristic labels to avoid.
function deconflictOffset(labelAnchors, midX, midY, offset, halfW, halfH) {
  if (!Array.isArray(labelAnchors) || !labelAnchors.length) return offset;
  const step = Math.max(halfH * 2 + 4, 34);
  let candidate = offset;
  for (let attempt = 0; attempt < 8; attempt++) {
    const box = { x: midX + candidate.x, y: midY + candidate.y, halfW, halfH };
    const collides = labelAnchors.some(a => rectsOverlap(a, box));
    if (!collides) return candidate;
    const nudge = step * (Math.floor(attempt / 2) + 1) * (attempt % 2 === 0 ? 1 : -1);
    candidate = { x: offset.x, y: offset.y + nudge };
  }
  return candidate;
}

// The straight-line source/target midpoint is a poor stand-in for the actual
// rendered label anchor once an edge has a real `unbundled-bezier` bend
// (`controlPointDistances`/`controlPointWeights`) — a handful of gravytanker
// edges use large, asymmetric bends specifically to route around other
// elements, and without this the de-collision math below "sees" two edges as
// co-located when their curves have in fact already separated them (or vice
// versa). Approximates cytoscape's own curve point: interpolate along the
// source→target line by the control-point weight, then offset perpendicular
// by the control-point distance.
function edgeCurveMidpoint(source, target, edge) {
  const s = nodePosition(source);
  const t = nodePosition(target);
  if (!s || !t) return null;
  const weight = explicitNumber(edge.controlPointWeights, edge.controlWeights, edge.controlWeight);
  const w = weight != null ? weight : 0.5;
  const baseX = s.x + (t.x - s.x) * w;
  const baseY = s.y + (t.y - s.y) * w;
  const distance = explicitNumber(edge.controlPointDistances, edge.controlDistances, edge.distance);
  if (!distance) return { x: baseX, y: baseY };
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular unit vector (rotate the source→target direction 90°) —
  // matches the sign convention cytoscape uses for control-point-distances.
  const px = -dy / len;
  const py = dx / len;
  return { x: baseX + px * distance, y: baseY + py * distance };
}

function edgeLabelOffset(edge, source, target, labelAnchors) {
  const targetPos = nodePosition(target);
  const resolvedSourcePos = nodePosition(source);
  const curveMid = resolvedSourcePos && targetPos ? edgeCurveMidpoint(source, target, edge) : null;
  const midX = curveMid ? curveMid.x : (resolvedSourcePos && targetPos ? (resolvedSourcePos.x + targetPos.x) / 2 : 0);
  const midY = curveMid ? curveMid.y : (resolvedSourcePos && targetPos ? (resolvedSourcePos.y + targetPos.y) / 2 : 0);
  const fontSize = scene.value.edgeFontSize || 20;
  const { halfW, halfH } = labelHalfExtents(edge.label, fontSize);

  const explicitX = explicitNumber(edge.labelMarginX, edge.labelX);
  const explicitY = explicitNumber(edge.labelMarginY, edge.labelY);
  if (explicitX != null || explicitY != null) {
    const offset = { x: explicitX || 0, y: explicitY != null ? explicitY : -14 };
    if (labelAnchors) labelAnchors.push({ x: midX + offset.x, y: midY + offset.y, halfW, halfH });
    return offset;
  }
  if (!resolvedSourcePos || !targetPos || !edge.label) return { x: 0, y: -14 };
  const dx = targetPos.x - resolvedSourcePos.x;
  const dy = targetPos.y - resolvedSourcePos.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const grid = graphGrid();
  const layoutHeight = Number(scene.value.layoutHeight || scene.value.layoutH || (grid ? grid.y + grid.height : 720));
  let offset;
  if (absDx > absDy * 1.7) {
    const lane = midY < layoutHeight * 0.38 ? -1 : midY > layoutHeight * 0.62 ? 1 : -1;
    offset = { x: 0, y: lane * 42 };
  } else if (absDy > absDx * 1.2) {
    offset = { x: dx >= 0 ? 58 : -58, y: dy >= 0 ? 12 : -12 };
  } else {
    offset = { x: 0, y: dy >= 0 ? 44 : -44 };
  }
  offset = deconflictOffset(labelAnchors, midX, midY, offset, halfW, halfH);
  if (labelAnchors) labelAnchors.push({ x: midX + offset.x, y: midY + offset.y, halfW, halfH });
  return offset;
}

function layoutConfig({ animate = false } = {}) {
  const name = scene.value.layout || (hasPinnedPositions() ? 'preset' : 'cose');
  const common = {
    name,
    animate: animate && !document.body.classList.contains('instant'),
    animationDuration: Number(scene.value.animationMs || 700),
    fit: true,
    padding: Number(scene.value.padding || 55),
  };
  if (name === 'breadthfirst') {
    return {
      ...common,
      directed: scene.value.directed !== false,
      spacingFactor: Number(scene.value.spacingFactor || 1.15),
      roots: Array.isArray(scene.value.roots) ? scene.value.roots.map(id => `#${CSS.escape(String(id))}`).join(', ') : undefined,
    };
  }
  if (name === 'concentric') {
    const center = activeEntry.value && activeEntry.value.node;
    return {
      ...common,
      minNodeSpacing: Number(scene.value.minNodeSpacing || 90),
      concentric: node => node.id() === center ? 10 : Number(node.data('weight') || 1),
      levelWidth: () => 2,
    };
  }
  if (name === 'cose') {
    const layoutWidth = Number(scene.value.layoutWidth || scene.value.layoutW || 1350);
    const layoutHeight = Number(scene.value.layoutHeight || scene.value.layoutH || 610);
    return {
      ...common,
      nodeDimensionsIncludeLabels: true,
      idealEdgeLength: Number(scene.value.idealEdgeLength || 210),
      nodeOverlap: Number(scene.value.nodeOverlap || 26),
      nestingFactor: Number(scene.value.nestingFactor || 1.2),
      gravity: Number(scene.value.gravity || 0.7),
      componentSpacing: Number(scene.value.componentSpacing || 120),
      numIter: Number(scene.value.numIter || 1200),
      randomize: scene.value.randomize === true,
      boundingBox: { x1: 0, y1: 0, x2: layoutWidth, y2: layoutHeight },
    };
  }
  return common;
}

function hasPinnedPositions() {
  return (scene.value.nodes || []).some(n => nodePosition(n));
}

function applyPinnedPositions() {
  if (!cy) return;
  for (const node of scene.value.nodes || []) {
    const pos = nodePosition(node);
    if (!pos) continue;
    const ele = cy.getElementById(String(node.id));
    if (ele && ele.length) ele.position(pos);
  }
}

function rebuild() {
  if (!cyRoot.value) return;
  stopIdleMotion();
  const pending = new Promise(resolve => {
    if (cy) cy.destroy();
    const built = elements();
    // Test-only introspection hook (mirrors the existing __slideyPendingRenders
    // pattern): the resolved label offsets aren't otherwise observable, since
    // Cytoscape draws labels to <canvas>, not DOM text nodes. Regression tests
    // for the label de-collision heuristic (BUG G-5) read this rather than
    // trying to OCR a screenshot. No effect on rendered output.
    if (typeof window !== 'undefined') window.__slideyLastGraphElements = built;
    cy = cytoscape({
      container: cyRoot.value,
      elements: built,
      wheelSensitivity: 0.25,
      userZoomingEnabled: scene.value.interactive === true,
      userPanningEnabled: scene.value.interactive === true,
      boxSelectionEnabled: false,
      autoungrabify: true,
      style: [
        {
          selector: 'node',
          style: {
            shape: 'ellipse',
            width: ele => ele.data('width'),
            height: ele => ele.data('height'),
            'background-color': ele => ele.data('color'),
            'z-index': 10,
            'border-color': ele => ele.data('borderColor'),
            'border-width': 4,
            'shadow-blur': 26,
            'shadow-color': ele => ele.data('glowColor'),
            'shadow-opacity': 0.34,
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
            label: ele => ele.data('sub') ? `${ele.data('label')}\n${ele.data('sub')}` : ele.data('label'),
            color: ele => ele.data('textColor'),
            'font-family': cssVar('--slidey-font-family', 'ui-sans-serif, system-ui, sans-serif'),
            'font-size': Number(scene.value.nodeFontSize || 24),
            'font-weight': 760,
            'text-wrap': 'wrap',
            'text-max-width': ele => Math.max(120, ele.data('width') - 26),
            'text-valign': 'center',
            'text-halign': 'center',
            'line-height': 1.12,
            'text-outline-color': 'rgba(6,10,20,0.88)',
            'text-outline-width': 4,
            'overlay-opacity': 0,
            'transition-property': 'border-width, opacity, background-color, line-color, target-arrow-color, width, shadow-opacity, shadow-blur',
            'transition-duration': document.body.classList.contains('instant') ? 0 : 320,
          },
        },
        {
          selector: 'edge',
          style: {
            width: ele => Math.max(2, Math.min(12, Number(ele.data('weight') || 2))),
            'line-color': ele => ele.data('color'),
            'target-arrow-color': ele => ele.data('color'),
            'target-arrow-shape': 'triangle',
            'curve-style': ele => ele.data('curve') || 'bezier',
            'control-point-distances': ele => ele.data('controlPointDistances'),
            'control-point-weights': ele => ele.data('controlPointWeights'),
            'line-style': ele => ele.hasClass('soft') ? 'dashed' : 'solid',
            'line-cap': 'round',
            opacity: 0.86,
            label: ele => ele.data('label'),
            color: cssVar('--slidey-text', '#e0def4'),
            'font-family': cssVar('--slidey-font-family', 'ui-sans-serif, system-ui, sans-serif'),
            'font-size': Number(scene.value.edgeFontSize || 20),
            'font-weight': 760,
            'text-background-color': 'rgba(9,14,26,0.88)',
            'text-background-opacity': 1,
            'text-background-padding': 6,
            'text-background-shape': 'roundrectangle',
            'text-border-color': 'rgba(255,255,255,0.12)',
            'text-border-width': 1,
            'text-border-opacity': 1,
            'text-rotation': 'none',
            'text-margin-x': ele => Number(ele.data('labelMarginX') || 0),
            'text-margin-y': ele => Number(ele.data('labelMarginY') || -14),
            'z-index': 30,
            'z-index-compare': 'manual',
          },
        },
        {
          selector: '.requirement',
          style: {
            'border-width': 5,
            'shadow-blur': 34,
            'shadow-opacity': 0.42,
          },
        },
        {
          selector: '.proof',
          style: {
            'border-width': 5,
            'shadow-blur': 32,
            'shadow-opacity': 0.38,
          },
        },
        { selector: '.seen', style: { opacity: 0.96 } },
        { selector: 'edge.seen', style: { opacity: 0.9 } },
        {
          selector: '.related',
          style: {
            opacity: 0.96,
            'line-color': ele => ele.data('color'),
            'target-arrow-color': ele => ele.data('color'),
          },
        },
        {
          selector: '.active',
          style: {
            opacity: 1,
            'border-width': 8,
            'border-color': cssVar('--slidey-gold', '#f6c177'),
            'shadow-blur': 48,
            'shadow-color': cssVar('--slidey-gold', '#f6c177'),
            'shadow-opacity': 0.62,
          },
        },
        {
          selector: 'edge.active',
          style: {
            opacity: 1,
            width: ele => Math.max(6, Math.min(14, Number(ele.data('weight') || 2) + 2)),
            'line-color': cssVar('--slidey-gold', '#f6c177'),
            'target-arrow-color': cssVar('--slidey-gold', '#f6c177'),
          },
        },
        { selector: '.dim', style: { opacity: 0.42, 'shadow-opacity': 0.12 } },
        { selector: 'edge.dim', style: { opacity: 0.34 } },
      ],
    });

    applyPinnedPositions();
    const layout = cy.layout(layoutConfig({ animate: false }));
    layout.one('layoutstop', () => {
      cy.fit(undefined, Number(scene.value.padding || 55));
      startIdleMotion();
      resolve();
    });
    layout.run();
    setTimeout(resolve, 1200);
  });
  if (window.__slideyPendingRenders) window.__slideyPendingRenders.add(pending);
  pending.finally(() => {
    if (window.__slideyPendingRenders) window.__slideyPendingRenders.delete(pending);
    applyFocus();
  });
}

function shouldUseIdleMotion() {
  if (!scene.value.floatMotion && !scene.value.idleMotion) return false;
  if (document.body.classList.contains('instant')) return false;
  return cy && cy.nodes().length > 1;
}

function stopIdleMotion() {
  if (motionFrame) cancelAnimationFrame(motionFrame);
  motionFrame = 0;
  motionStartedAt = 0;
  motionBasePositions.clear();
}

function startIdleMotion() {
  stopIdleMotion();
  if (!shouldUseIdleMotion()) return;
  cy.nodes().forEach((node, index) => {
    const pos = node.position();
    motionBasePositions.set(node.id(), {
      x: pos.x,
      y: pos.y,
      phase: index * 1.73,
    });
  });
  motionStartedAt = performance.now();
  tickIdleMotion(motionStartedAt);
}

function tickIdleMotion(now) {
  if (!shouldUseIdleMotion()) {
    stopIdleMotion();
    return;
  }
  const amplitude = Number(scene.value.floatAmplitude || 10);
  const speed = Number(scene.value.floatSpeed || 0.00075);
  const elapsed = now - motionStartedAt;
  cy.nodes().forEach(node => {
    const base = motionBasePositions.get(node.id());
    if (!base) return;
    node.position({
      x: base.x + Math.sin(elapsed * speed + base.phase) * amplitude,
      y: base.y + Math.cos(elapsed * speed * 0.82 + base.phase * 1.31) * amplitude * 0.72,
    });
  });
  motionFrame = requestAnimationFrame(tickIdleMotion);
}

function applyFocus() {
  if (!cy) return;
  const path = pathEntries();
  const idx = store.graphFocus;
  cy.elements().removeClass('active seen related dim');
  if (idx < 0 || !path[idx]) {
    cy.fit(undefined, Number(scene.value.padding || 55));
    return;
  }

  const entry = path[idx];
  const current = cy.getElementById(String(entry.node));
  const seenIds = new Set(path.slice(0, idx + 1).map(entry => String(entry.node)));
  cy.nodes().forEach(node => {
    if (seenIds.has(node.id())) node.addClass('seen');
    else node.addClass('dim');
  });
  current.removeClass('dim').addClass('active seen');

  const explicitEdges = new Set([entry.edge, ...(entry.edges || [])].filter(Boolean).map(String));
  cy.edges().forEach(edge => {
    const srcSeen = seenIds.has(edge.source().id());
    const tgtSeen = seenIds.has(edge.target().id());
    const touchesCurrent = edge.source().id() === current.id() || edge.target().id() === current.id();
    if (explicitEdges.has(edge.id()) || (srcSeen && tgtSeen)) edge.addClass('active');
    else if (touchesCurrent) edge.addClass('related');
    else edge.addClass('dim');
  });

  const animate = !document.body.classList.contains('instant');
  const zoom = Number(entry.zoom || scene.value.focusZoom || 1.08);
  const duration = Number(entry.durationMs || scene.value.animationMs || 700);
  cy.stop();
  if (scene.value.focusLayout) {
    cy.layout({ ...layoutConfig({ animate }), name: scene.value.focusLayout }).run();
  }
  if (entry.overview || entry.fit || entry.view === 'overview') {
    const padding = Number(entry.padding || scene.value.padding || 55);
    if (animate) cy.animate({ fit: { eles: cy.elements(), padding } }, { duration, easing: 'ease-in-out-cubic' });
    else cy.fit(undefined, padding);
    return;
  }
  if (scene.value.focusMode === 'neighborhood') {
    const eles = current.closedNeighborhood();
    const padding = Number(entry.padding || scene.value.focusPadding || 300);
    if (animate) cy.animate({ fit: { eles, padding } }, { duration, easing: 'ease-in-out-cubic' });
    else cy.fit(eles, padding);
    return;
  }
  if (animate) {
    cy.animate({ center: { eles: current }, zoom }, { duration, easing: 'ease-in-out-cubic' });
  } else {
    cy.center(current);
    cy.zoom({ level: zoom, position: current.position() });
  }
}

function refreshViewport() {
  if (refreshFrame) cancelAnimationFrame(refreshFrame);
  refreshFrame = requestAnimationFrame(() => {
    refreshFrame = 0;
    if (isProjection.value) {
      fitProjectionFrame();
      return;
    }
    if (!cy || !cyRoot.value) return;
    cy.resize();
    applyFocus();
  });
}

// ── Projection input mode ────────────────────────────────────────────────
// scene.projection set: render a graph-projection v1 JSON through the shared,
// dependency-free renderer instead of building a Cytoscape graph. No camera /
// focus-path in this mode (path/focus are Cytoscape-only concepts).
const projectionError = ref('');

// BUG G-2 fix: the projection <svg> has a real, fixed aspect ratio (its
// viewBox), but the frame it sits in is sized by the slide grid (any aspect).
// Letting the browser's default `xMidYMid meet` scaling reconcile the two
// wastes space on whichever axis doesn't match. Instead we measure the frame's
// actual content box and set the <svg>'s CSS width/height in pixels to the
// largest box that (a) preserves the graph's true aspect ratio and (b) fits
// entirely inside the frame — then center it with `margin:auto` (see the
// `.graph-canvas--projection` rule). This makes sizing deterministic and
// pixel-exact in both the interactive viewer and the headless PNG/MP4 path.
function currentProjectionGraph() {
  const data = store.graphProjectionData;
  const win = typeof window !== 'undefined' ? window : null;
  if (!data || !win || !win.SlideyGraphProjection) return null;
  try {
    const resolved = win.SlideyGraphProjection.resolveState(data, scene.value.state, scene.value.projectionOpts || {});
    return (data.graphs || []).find(g => g.id === resolved.graphId) || null;
  } catch (_) {
    return null;
  }
}

function fitProjectionFrame() {
  if (!isProjection.value || !frameRoot.value || !projectionSvg.value) return;
  const graph = currentProjectionGraph();
  if (!graph || !(graph.w > 0) || !(graph.h > 0)) return;
  const availW = frameRoot.value.clientWidth;
  const availH = frameRoot.value.clientHeight;
  if (!(availW > 0) || !(availH > 0)) return;
  const aspect = graph.w / graph.h;
  let width = availW;
  let height = width / aspect;
  if (height > availH) {
    height = availH;
    width = height * aspect;
  }
  projectionSvg.value.style.width = `${width}px`;
  projectionSvg.value.style.height = `${height}px`;
}

function renderProjection() {
  projectionError.value = '';
  if (!projectionSvg.value) return;
  const data = store.graphProjectionData;
  if (!data) {
    projectionError.value = 'No projection data loaded for this scene (check scene.projection resolves).';
    return;
  }
  if (typeof window.renderGraphProjection !== 'function') {
    projectionError.value = 'graph-projection renderer not loaded.';
    return;
  }
  try {
    window.renderGraphProjection(projectionSvg.value, data, scene.value.state, scene.value.projectionOpts || {});
    fitProjectionFrame();
  } catch (err) {
    projectionError.value = String((err && err.message) || err);
  }
}

watch(() => store.sceneNonce, async nonce => {
  if (nonce === lastNonce) return;
  lastNonce = nonce;
  await nextTick();
  if (isProjection.value) renderProjection();
  else rebuild();
}, { immediate: true });

watch(() => store.graphFocus, applyFocus);

watch(() => store.isRevealed('graph-frame'), async shown => {
  if (!shown) return;
  await nextTick();
  if (isProjection.value) {
    renderProjection();
  } else {
    refreshViewport();
  }
});

onMounted(() => {
  if (typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver(refreshViewport);
  if (frameRoot.value) resizeObserver.observe(frameRoot.value);
});

onBeforeUnmount(() => {
  stopIdleMotion();
  if (refreshFrame) cancelAnimationFrame(refreshFrame);
  refreshFrame = 0;
  if (resizeObserver) resizeObserver.disconnect();
  resizeObserver = null;
  if (cy) cy.destroy();
  cy = null;
});
</script>

<template>
  <div id="graph-region" class="scene-region active graph-scene">
    <div
      v-if="scene.title"
      id="graph-title"
      class="graph-title reveal"
      :class="{ shown: store.isRevealed('graph-title') }"
      data-edit-path='["title"]'
    >{{ scene.title }}</div>
    <div
      id="graph-frame"
      ref="frameRoot"
      class="graph-frame reveal"
      :class="{ shown: store.isRevealed('graph-frame') }"
    >
      <div v-if="!isProjection" ref="cyRoot" class="graph-canvas"></div>
      <svg
        v-else
        ref="projectionSvg"
        class="graph-canvas graph-canvas--projection"
        role="img"
        preserveAspectRatio="xMidYMid meet"
      ></svg>
      <div v-if="isProjection && projectionError" class="graph-projection-error">{{ projectionError }}</div>
      <div v-if="!isProjection && activeNode" class="graph-focus-card">
        <div class="graph-focus-label">{{ activeNode.label || activeNode.id }}</div>
        <div v-if="activeEntry?.note || activeNode.sub" class="graph-focus-note">{{ activeEntry?.note || activeNode.sub }}</div>
      </div>
    </div>
    <div
      v-if="scene.caption"
      id="graph-caption"
      class="graph-caption reveal"
      :class="{ shown: store.isRevealed('graph-caption') }"
      data-edit-path='["caption"]'
      data-edit-multiline
    >{{ scene.caption }}</div>
  </div>
</template>

<style scoped>
.graph-scene.active {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 18px;
  align-items: stretch;
}

.graph-title {
  color: var(--slidey-rose, #eb6f92);
  font-size: 46px;
  font-weight: 820;
  letter-spacing: 0;
}

.graph-frame {
  position: relative;
  min-height: 0;
  width: min(1720px, 100%);
  justify-self: center;
  overflow: hidden;
}

.graph-canvas {
  position: absolute;
  inset: 0;
}

.graph-canvas--projection {
  /* Sized in pixels by fitProjectionFrame() to the graph's true aspect ratio;
     margin:auto (with the inherited inset:0) centers the resulting box inside
     the frame on whichever axis has slack, so there is no wasted dead space. */
  width: 100%;
  height: 100%;
  margin: auto;
}

.graph-projection-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--slidey-subtle, rgba(255,255,255,0.74));
  font-size: 22px;
  text-align: center;
  padding: 24px;
}

.graph-focus-card {
  position: absolute;
  right: 18px;
  bottom: 18px;
  width: min(560px, calc(100% - 36px));
  padding: 20px 24px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.18);
  background: linear-gradient(140deg, rgba(13,20,36,0.92), rgba(22,31,48,0.86));
  box-shadow: 0 18px 48px rgba(0,0,0,0.34);
  pointer-events: none;
}

.graph-focus-label {
  color: var(--slidey-text, #e0def4);
  font-size: 32px;
  line-height: 1.08;
  font-weight: 820;
  letter-spacing: 0;
}

.graph-focus-note {
  margin-top: 8px;
  color: var(--slidey-subtle, rgba(255,255,255,0.74));
  font-size: 22px;
  line-height: 1.25;
  letter-spacing: 0;
}

.graph-caption {
  justify-self: center;
  max-width: 1500px;
  color: var(--slidey-subtle, rgba(255,255,255,0.76));
  font-size: 28px;
  line-height: 1.28;
  text-align: center;
  letter-spacing: 0;
}
</style>

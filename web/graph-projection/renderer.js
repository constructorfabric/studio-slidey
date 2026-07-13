/**
 * SLIDEY — graph projection renderer (dependency-free, browser-global)
 *
 * Renders a "graph projection" JSON (v1 schema: see
 * ~/code/POG/.context/mockup-demo-tooling-contract.md #7) onto an inline SVG
 * element: rounded-rect nodes on a lane/row grid, weight-scaled bezier edges,
 * and per-state status overlays (done/plan/fail/dim/pulse).
 *
 * Ported faithfully from the gravytanker portal mockup's hand-written
 * `drawGraph()` (the reference renderer for this shape — an inline SVG, not
 * literal HTML5 canvas; "canvas" in the calling convention below means "the
 * render target", not the <canvas> element). Kept dependency-free (no
 * import/export, no external libs) on purpose so this ONE file can be:
 *
 *   1. Inlined verbatim into a self-contained mockup HTML's plain
 *      (non-module) <script> tag — it attaches `renderGraphProjection` and
 *      `SlideyGraphProjection` directly onto `window`.
 *   2. `require()`d from a Node CJS test (`module.exports` is set too).
 *   3. Side-effect-imported from a Vite/Vue browser bundle
 *      (`import '.../graph-projection/renderer.js'`) — it has no top-level
 *      `import`/`export` syntax, so Vite serves it as-is and the explicit
 *      `window.*` assignment at the bottom still runs.
 *
 * Pure layout/status math is factored into small standalone functions
 * (resolveGrid, nodePosition, statusOf, resolveNodeColors, edgePath,
 * labelFontSize, subFontSize, resolveState) so it is unit-testable without a
 * DOM; only `renderGraphProjection` itself touches `document`.
 */

(function (global) {
  'use strict';

  var DEFAULT_GRID = { laneWidth: 234, laneOffsetX: 117, rowHeight: 136, rowOffsetY: 68 };

  var DEFAULT_STATUS_OVERRIDES = {
    done: { fill: '#0f3f36', stroke: '#34d399' },
    fail: { fill: '#4a1724', stroke: '#fb7185' },
    plan: { stroke: '#f59e0b', dashed: true },
    dim: { opacity: 0.22 },
  };

  var STYLE_MARKER_ATTR = 'data-slidey-graph-projection-style';
  var SVG_MARKER_ATTR = 'data-slidey-graph-projection';
  var CSS_TEXT = [
    '.slidey-gp-edge { fill: none; stroke-linecap: round; stroke-linejoin: round; }',
    '.slidey-gp-gnode text { text-anchor: middle; dominant-baseline: middle; }',
    '.slidey-gp-gnode rect { filter: drop-shadow(0 12px 20px rgba(0,0,0,0.38)); }',
    '.slidey-gp-gnode.pulse rect { animation: slidey-gp-pulse 1.5s ease-in-out infinite; }',
    '.slidey-gp-gnode.fail rect { animation: slidey-gp-failpulse 1.4s ease-in-out infinite; }',
    '@keyframes slidey-gp-pulse { 0%, 100% { filter: drop-shadow(0 0 8px rgba(56,189,248,0.25)); } 50% { filter: drop-shadow(0 0 28px rgba(56,189,248,0.68)); } }',
    '@keyframes slidey-gp-failpulse { 0%, 100% { filter: drop-shadow(0 0 6px rgba(251,113,133,0.3)); } 50% { filter: drop-shadow(0 0 24px rgba(251,113,133,0.8)); } }',
  ].join('\n');

  /** Merge a grid override onto the projection's own grid (or the module default). */
  function resolveGrid(projection, opts) {
    var base = (projection && projection.grid) || DEFAULT_GRID;
    var override = (opts && opts.grid) || {};
    return {
      laneWidth: numOr(override.laneWidth, base.laneWidth, DEFAULT_GRID.laneWidth),
      laneOffsetX: numOr(override.laneOffsetX, base.laneOffsetX, DEFAULT_GRID.laneOffsetX),
      rowHeight: numOr(override.rowHeight, base.rowHeight, DEFAULT_GRID.rowHeight),
      rowOffsetY: numOr(override.rowOffsetY, base.rowOffsetY, DEFAULT_GRID.rowOffsetY),
    };
  }

  function numOr() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v === 'number' && isFinite(v)) return v;
    }
    return 0;
  }

  /** A node's pixel center, from its lane/row on the grid (x/y pins override lane/row if present). */
  function nodePosition(node, grid) {
    if (typeof node.x === 'number' && typeof node.y === 'number') return { x: node.x, y: node.y };
    var g = grid || DEFAULT_GRID;
    return {
      x: g.laneOffsetX + (node.lane || 0) * g.laneWidth,
      y: g.rowOffsetY + (node.row || 0) * g.rowHeight,
    };
  }

  function has(list, id) {
    return Array.isArray(list) && list.indexOf(id) !== -1;
  }

  /** 'done' | 'fail' | 'plan' | 'dim' | '' for a node id under a state's status lists. */
  function statusOf(status, nodeId) {
    var st = status || {};
    if (st.done === 'all' || has(st.done, nodeId)) return 'done';
    if (has(st.fail, nodeId)) return 'fail';
    if (has(st.plan, nodeId)) return 'plan';
    if (has(st.dim, nodeId)) return 'dim';
    return '';
  }

  /** Resolve a node's rendered fill/stroke/txt/dashed, layering: type palette < status override. */
  function resolveNodeColors(node, statusValue, palette, statusOverrides) {
    var base = (palette && palette[node.type]) || {};
    var fill = node.fill || base.fill || '#0f3f36';
    var stroke = node.stroke || base.stroke || '#5eead4';
    var txt = node.txt || base.txt || '#ecfff7';
    var dashed = false;
    var overrides = statusOverrides || DEFAULT_STATUS_OVERRIDES;
    if (statusValue && overrides[statusValue]) {
      var ov = overrides[statusValue];
      if (ov.fill) fill = ov.fill;
      if (ov.stroke) stroke = ov.stroke;
      if (ov.dashed) dashed = true;
    }
    return { fill: fill, stroke: stroke, txt: txt, dashed: dashed };
  }

  /**
   * The bezier path 'd' string between two node boxes {x,y,w,h}, ported
   * verbatim from the mockup's three-branch layout (forward / vertical /
   * backward-with-lift).
   */
  function edgePath(a, b) {
    if (b.x - a.x > 40) {
      var x1 = a.x + a.w / 2, x2 = b.x - b.w / 2 - 6, cx = (x1 + x2) / 2;
      return 'M' + x1 + ',' + a.y + ' C' + cx + ',' + a.y + ' ' + cx + ',' + b.y + ' ' + x2 + ',' + b.y;
    }
    if (Math.abs(b.x - a.x) <= 40) {
      var down = b.y > a.y;
      var y1 = down ? a.y + a.h / 2 : a.y - a.h / 2;
      var y2 = down ? b.y - b.h / 2 - 6 : b.y + b.h / 2 + 6;
      var cy = (y1 + y2) / 2;
      return 'M' + a.x + ',' + y1 + ' C' + a.x + ',' + cy + ' ' + b.x + ',' + cy + ' ' + b.x + ',' + y2;
    }
    var bx1 = a.x - a.w / 2, bx2 = b.x + b.w / 2 + 6, bcx = (bx1 + bx2) / 2;
    var lift = a.y === b.y ? 90 : 40;
    return 'M' + bx1 + ',' + a.y + ' C' + bcx + ',' + (a.y + lift) + ' ' + bcx + ',' + (b.y + lift) + ' ' + bx2 + ',' + b.y;
  }

  /** Node label font-size (px), ported verbatim from the mockup's fit formula. */
  function labelFontSize(w, textLen) {
    return Math.min(15, (w - 14) / (textLen * 0.56));
  }

  /** Node sub-label font-size (px), ported verbatim from the mockup's fit formula. */
  function subFontSize(w, subLen) {
    return Math.min(9.5, (w - 10) / (subLen * 0.5));
  }

  /**
   * Resolve {graph, status} for a stateId: prefer `projection.states[stateId]`
   * (graph + status overlay); fall back to treating stateId as a bare graph id
   * with `opts.status` (or no overlay) when it isn't a declared state — lets a
   * scene render a raw graph with no per-state coloring.
   */
  function resolveState(projection, stateId, opts) {
    var states = (projection && projection.states) || {};
    if (states[stateId]) {
      return { graphId: states[stateId].graph, status: states[stateId].status || {} };
    }
    var graphs = (projection && projection.graphs) || [];
    var direct = graphs.filter(function (g) { return g.id === stateId; })[0];
    if (direct) {
      return { graphId: direct.id, status: (opts && opts.status) || {} };
    }
    throw new Error('slidey graph-projection: unknown state/graph id "' + stateId + '"');
  }

  function findGraph(projection, graphId) {
    var graphs = (projection && projection.graphs) || [];
    var found = graphs.filter(function (g) { return g.id === graphId; })[0];
    if (!found) throw new Error('slidey graph-projection: unknown graph id "' + graphId + '"');
    return found;
  }

  var uidCounter = 0;
  function nextUid() {
    uidCounter += 1;
    return 'slidey-gp-' + uidCounter;
  }

  function ensureStyle(doc) {
    if (!doc || !doc.head) return;
    if (doc.head.querySelector('[' + STYLE_MARKER_ATTR + ']')) return;
    var style = doc.createElement('style');
    style.setAttribute(STYLE_MARKER_ATTR, '1');
    style.textContent = CSS_TEXT;
    doc.head.appendChild(style);
  }

  function svgEl(doc, tag, attrs) {
    var node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
    }
    return node;
  }

  /** Resolve (or lazily create) the target <svg> inside an arbitrary container element. */
  function resolveSvg(container, doc) {
    if (!container) throw new Error('slidey graph-projection: no container/canvas element given');
    if (container.tagName && container.tagName.toLowerCase() === 'svg') return container;
    var existing = container.querySelector && container.querySelector('svg[' + SVG_MARKER_ATTR + ']');
    if (existing) return existing;
    var svg = svgEl(doc, 'svg', {});
    svg.setAttribute(SVG_MARKER_ATTR, '1');
    svg.setAttribute('role', 'img');
    container.appendChild(svg);
    return svg;
  }

  /**
   * renderGraphProjection(canvas, projection, stateId, opts)
   *
   * `canvas` — an <svg> element to render directly into, OR any container
   * element (a child <svg> is created/reused).
   * `projection` — the parsed graph-projection JSON (v1).
   * `stateId` — a key of `projection.states`, or (fallback) a bare graph id.
   * `opts` — { grid, palette, statusOverrides, status, arrowColor }.
   *
   * Returns { graphId, nodeCount, edgeCount } for callers that want a quick
   * render summary (tests, QA hooks).
   */
  function renderGraphProjection(canvas, projection, stateId, opts) {
    opts = opts || {};
    var doc = canvas && canvas.ownerDocument ? canvas.ownerDocument : (typeof document !== 'undefined' ? document : null);
    if (!doc) throw new Error('slidey graph-projection: no document available to render into');
    ensureStyle(doc);

    var resolved = resolveState(projection, stateId, opts);
    var graph = findGraph(projection, resolved.graphId);
    var status = resolved.status;
    var grid = resolveGrid(projection, opts);
    var palette = (opts && opts.palette) || (projection && projection.palette) || {};
    var statusOverrides = (opts && opts.statusOverrides) || (projection && projection.statusOverrides) || DEFAULT_STATUS_OVERRIDES;

    var svg = resolveSvg(canvas, doc);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', '0 0 ' + graph.w + ' ' + graph.h);

    var arrowId = nextUid();
    var defs = svgEl(doc, 'defs', {});
    var marker = svgEl(doc, 'marker', {
      id: arrowId, markerWidth: '10', markerHeight: '10', refX: '8', refY: '3', orient: 'auto',
    });
    var arrowPath = svgEl(doc, 'path', { d: 'M0,0 L0,6 L9,3 z', fill: opts.arrowColor || '#dbeafe' });
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    svg.appendChild(defs);

    var boxById = {};
    for (var i = 0; i < graph.nodes.length; i++) {
      var gn = graph.nodes[i];
      var pos = nodePosition(gn, grid);
      boxById[gn.id] = { x: pos.x, y: pos.y, w: gn.w || 160, h: gn.h || 54 };
    }

    for (var e = 0; e < graph.edges.length; e++) {
      var edge = graph.edges[e];
      var a = boxById[edge.from], b = boxById[edge.to];
      if (!a || !b) continue;
      var sa = statusOf(status, edge.from), sb = statusOf(status, edge.to);
      var dim = sa === 'dim' || sb === 'dim';
      var done = sa === 'done' && (sb === 'done' || sb === '');
      var d = edgePath(a, b);
      var p = svgEl(doc, 'path', { class: 'slidey-gp-edge edge', d: d, 'marker-end': 'url(#' + arrowId + ')' });
      p.setAttribute(
        'style',
        'stroke:' + (done ? '#34d399' : (edge.color || '#dbeafe')) +
        ';stroke-width:' + Math.max(1.6, (edge.weight || 2) * 0.5) +
        ';opacity:' + (dim ? 0.12 : 0.72)
      );
      svg.appendChild(p);
    }

    for (var n = 0; n < graph.nodes.length; n++) {
      var node = graph.nodes[n];
      var s = statusOf(status, node.id);
      var pulse = has(status.pulse, node.id);
      var classes = 'slidey-gp-gnode gnode' + (s ? ' ' + s : '') + (pulse ? ' pulse' : '');
      var g = svgEl(doc, 'g', { class: classes, transform: 'translate(' + boxById[node.id].x + ',' + boxById[node.id].y + ')' });
      if (s === 'dim') g.setAttribute('style', 'opacity:' + (statusOverrides.dim && statusOverrides.dim.opacity != null ? statusOverrides.dim.opacity : 0.22));

      var colors = resolveNodeColors(node, s, palette, statusOverrides);
      var w = node.w || 160, h = node.h || 54;
      var rect = svgEl(doc, 'rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 12 });
      rect.setAttribute(
        'style',
        'fill:' + colors.fill + ';stroke:' + colors.stroke + ';stroke-width:2.6' + (colors.dashed ? ';stroke-dasharray:7 5' : '')
      );
      g.appendChild(rect);

      var badge = s === 'done' ? '✓ ' : s === 'fail' ? '✕ ' : '';
      var label = svgEl(doc, 'text', { y: node.sub ? -5 : 4 });
      label.textContent = badge + node.label;
      label.setAttribute(
        'style',
        'font-size:' + labelFontSize(w, (badge.length + node.label.length)).toFixed(1) + 'px;font-weight:800;fill:' + colors.txt
      );
      g.appendChild(label);

      if (node.sub) {
        var sub = svgEl(doc, 'text', { class: 'sub', y: 13 });
        sub.textContent = node.sub;
        sub.setAttribute(
          'style',
          'font-size:' + subFontSize(w, node.sub.length).toFixed(1) + 'px;font-weight:600;fill:#dbeafe'
        );
        g.appendChild(sub);
      }

      svg.appendChild(g);
    }

    return { graphId: graph.id, nodeCount: graph.nodes.length, edgeCount: graph.edges.length };
  }

  var api = {
    renderGraphProjection: renderGraphProjection,
    resolveGrid: resolveGrid,
    nodePosition: nodePosition,
    statusOf: statusOf,
    resolveNodeColors: resolveNodeColors,
    edgePath: edgePath,
    labelFontSize: labelFontSize,
    subFontSize: subFontSize,
    resolveState: resolveState,
    DEFAULT_GRID: DEFAULT_GRID,
    DEFAULT_STATUS_OVERRIDES: DEFAULT_STATUS_OVERRIDES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.SlideyGraphProjection = api;
    global.renderGraphProjection = renderGraphProjection;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

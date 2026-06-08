<script setup>
// SLIDEY — chart scene (hand-built SVG, no chart lib)
//
// Deterministic data charts rendered as inline SVG, mirroring the
// diagram-svg discipline (single viewBox, preserveAspectRatio="meet",
// reveal-driven visibility). All scales are computed here with simple
// nice-number ticks — no Chart.js / D3 / dagre.
//
// Reveal contract (mirrors NarrativeScene / StatScene / DiagramSvgScene):
//   store.scene     — the chart scene object
//   store.isRevealed — Set membership drives the '.reveal' / 'shown' fade
//   Steps: chart-title, chart-frame, chart-series-0 .. chart-series-N,
//          chart-caption  (the matching base-names without the 'chart-'→'chart_'
//          dash live in src/scenes/chart.js / sceneSteps.mjs).

import { computed } from 'vue';
import { store } from '../store.js';

// ── Design tokens (verbatim from web/styles/template.css) ───────────────────
const PALETTE = {
  primary:   '#58a6ff',
  secondary: '#bc8cff',
  green:     '#3fb950',
  orange:    '#f0883e',
  red:       '#f85149',
  teal:      '#39c5cf',
};
// Accent order for pie slices / auto series colours.
const ACCENT_ORDER = ['primary', 'secondary', 'green', 'orange', 'teal', 'red'];

const AXIS   = '#484f58';   // dim — axis lines
const GRID   = '#21262d';   // border (faint) — gridlines
const TEXT   = '#e6edf3';   // text
const MUTED  = '#8b949e';   // muted text

// Canvas geometry. One fixed viewBox; CSS letterboxes via preserveAspectRatio.
const VB_W = 1000;
const VB_H = 620;
const M = { top: 40, right: 48, bottom: 92, left: 96 };
const PLOT = {
  x: M.left,
  y: M.top,
  w: VB_W - M.left - M.right,
  h: VB_H - M.top - M.bottom,
};

function colorFor(name, i) {
  if (name && PALETTE[name]) return PALETTE[name];
  return PALETTE[ACCENT_ORDER[i % ACCENT_ORDER.length]];
}

// ── Nice-number tick algorithm (Heckbert) ───────────────────────────────────
function niceNum(range, round) {
  const exp = Math.floor(Math.log10(range || 1));
  const frac = (range || 1) / Math.pow(10, exp);
  let nf;
  if (round) {
    if (frac < 1.5) nf = 1;
    else if (frac < 3) nf = 2;
    else if (frac < 7) nf = 5;
    else nf = 10;
  } else {
    if (frac <= 1) nf = 1;
    else if (frac <= 2) nf = 2;
    else if (frac <= 5) nf = 5;
    else nf = 10;
  }
  return nf * Math.pow(10, exp);
}

// Produce ~ticks round values spanning [lo,hi] (padded). Returns {min,max,step,ticks[]}.
function niceScale(lo, hi, ticks = 5) {
  if (lo === hi) { hi = lo + 1; lo = lo - 1; }
  // Always include zero as a baseline when data is non-negative.
  if (lo > 0) lo = 0;
  if (hi < 0) hi = 0;
  const range = niceNum(hi - lo, false);
  const step  = niceNum(range / (ticks - 1), true);
  const min   = Math.floor(lo / step) * step;
  const max   = Math.ceil(hi / step) * step;
  const out = [];
  // Guard against float drift producing an extra tick.
  for (let v = min; v <= max + step * 0.5; v += step) out.push(+v.toFixed(6));
  return { min, max, step, ticks: out };
}

function fmt(n, unit) {
  let s;
  if (Math.abs(n) >= 1000 && Number.isInteger(n)) s = n.toLocaleString('en-US');
  else if (Number.isInteger(n)) s = String(n);
  else s = (+n.toFixed(2)).toString();
  return unit ? `${s}${unit}` : s;
}

// ── The render model (one computed; pure geometry, deterministic) ───────────
const model = computed(() => {
  const s = store.scene || {};
  const variant = s.variant || 'bar';
  const series = (s.series || []).map((ser, i) => ({
    name: ser.name || '',
    color: colorFor(ser.color, i),
    points: ser.points || [],
    raw: ser,
  }));
  const unit = s.unit || '';
  switch (variant) {
    case 'pie':      return { variant, ...buildPie(s, series) };
    case 'scatter':  return { variant, ...buildScatter(s, series, unit) };
    case 'quadrant': return { variant, ...buildQuadrant(s, series) };
    case 'line':
    case 'area':     return { variant, ...buildLineArea(s, series, unit, variant === 'area') };
    case 'bar':
    default:         return { variant: 'bar', ...buildBar(s, series, unit) };
  }
});

// X categories from union of point.x (preserving first-seen order) for
// ordinal charts (bar / ordinal line).
function categories(series) {
  const seen = [];
  for (const ser of series) {
    for (const p of ser.points) {
      const k = String(p.x);
      if (!seen.includes(k)) seen.push(k);
    }
  }
  return seen;
}

function yExtent(series) {
  let lo = Infinity, hi = -Infinity;
  for (const ser of series) {
    for (const p of ser.points) {
      const v = +p.y;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  return [lo, hi];
}

function gridlines(scale, unit) {
  return scale.ticks.map(v => {
    const t = (v - scale.min) / (scale.max - scale.min || 1);
    const y = PLOT.y + PLOT.h - t * PLOT.h;
    return { y, label: fmt(v, unit) };
  });
}

// ── BAR (grouped / clustered) ───────────────────────────────────────────────
function buildBar(s, series, unit) {
  const cats = categories(series);
  const [, hi] = yExtent(series);
  const scale = niceScale(0, hi, 5);
  const grid = gridlines(scale, unit);

  const bandW = PLOT.w / (cats.length || 1);
  const groupPad = bandW * 0.18;
  const innerW = bandW - groupPad * 2;
  const n = series.length || 1;
  const barGap = n > 1 ? innerW * 0.08 : 0;
  const barW = (innerW - barGap * (n - 1)) / n;

  const groups = cats.map((cat, ci) => {
    const gx = PLOT.x + ci * bandW;
    const bars = series.map((ser, si) => {
      const pt = ser.points.find(p => String(p.x) === cat);
      const v = pt ? +pt.y : 0;
      const t = (v - scale.min) / (scale.max - scale.min || 1);
      const h = Math.max(0, t * PLOT.h);
      const x = gx + groupPad + si * (barW + barGap);
      return {
        x, y: PLOT.y + PLOT.h - h, w: barW, h,
        color: ser.color, value: v, label: fmt(v, unit),
        labelX: x + barW / 2, labelY: PLOT.y + PLOT.h - h - 12,
      };
    });
    return { bars, labelX: gx + bandW / 2, label: cat };
  });

  return {
    scale, grid, groups,
    legend: series.length > 1 ? series.map(s2 => ({ name: s2.name, color: s2.color })) : [],
    axes: s.axes || {}, hasYAxis: true,
  };
}

// ── LINE / AREA ──────────────────────────────────────────────────────────────
function buildLineArea(s, series, unit, fill) {
  // Determine x mode: numeric if every point.x is a finite number, else ordinal.
  const allNumeric = series.every(ser => ser.points.every(p => typeof p.x === 'number' || !isNaN(+p.x)))
    && series.some(ser => ser.points.length > 0);
  let xMode = allNumeric ? 'numeric' : 'ordinal';

  let cats = [];
  let xScale = null;
  if (xMode === 'ordinal') cats = categories(series);
  else {
    let lo = Infinity, hi = -Infinity;
    for (const ser of series) for (const p of ser.points) { const v = +p.x; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    xScale = { min: lo, max: hi };
  }

  const [ylo, yhi] = yExtent(series);
  const yscale = niceScale(ylo, yhi, 5);
  const grid = gridlines(yscale, unit);

  const xpos = (xv) => {
    if (xMode === 'ordinal') {
      const idx = cats.indexOf(String(xv));
      const step = PLOT.w / Math.max(1, cats.length - 1 || 1);
      return cats.length === 1 ? PLOT.x + PLOT.w / 2 : PLOT.x + idx * step;
    }
    const t = (+xv - xScale.min) / (xScale.max - xScale.min || 1);
    return PLOT.x + t * PLOT.w;
  };
  const ypos = (yv) => {
    const t = (+yv - yscale.min) / (yscale.max - yscale.min || 1);
    return PLOT.y + PLOT.h - t * PLOT.h;
  };

  const lines = series.map(ser => {
    const pts = ser.points.map(p => ({ x: xpos(p.x), y: ypos(p.y), value: +p.y }));
    const poly = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    let area = '';
    if (fill && pts.length) {
      const base = PLOT.y + PLOT.h;
      area = `M ${pts[0].x.toFixed(1)} ${base} `
        + pts.map(p => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
        + ` L ${pts[pts.length - 1].x.toFixed(1)} ${base} Z`;
    }
    return { name: ser.name, color: ser.color, poly, area, dots: pts };
  });

  // X tick labels.
  let xticks;
  if (xMode === 'ordinal') {
    const step = PLOT.w / Math.max(1, cats.length - 1 || 1);
    xticks = cats.map((c, i) => ({
      x: cats.length === 1 ? PLOT.x + PLOT.w / 2 : PLOT.x + i * step,
      label: c,
    }));
  } else {
    const xs = niceScale(xScale.min, xScale.max, 5);
    xticks = xs.ticks
      .filter(v => v >= xScale.min - 1e-9 && v <= xScale.max + 1e-9)
      .map(v => ({ x: xpos(v), label: fmt(v, '') }));
  }

  return {
    scale: yscale, grid, lines, xticks, fill,
    legend: series.length > 1 ? series.map(s2 => ({ name: s2.name, color: s2.color })) : [],
    axes: s.axes || {}, hasYAxis: true,
  };
}

// ── PIE ───────────────────────────────────────────────────────────────────────
function buildPie(s, series) {
  const ser = series[0] || { points: [] };
  const pts = ser.points.slice(0, 6);
  const total = pts.reduce((a, p) => a + (+p.y || 0), 0) || 1;
  const cx = PLOT.x + PLOT.w / 2;
  const cy = PLOT.y + PLOT.h / 2 + 6;
  const r = Math.min(PLOT.w, PLOT.h) / 2 - 30;

  let angle = -Math.PI / 2; // start at top
  const slices = pts.map((p, i) => {
    const frac = (+p.y || 0) / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const mid = (a0 + a1) / 2;
    const lr = r * 0.62;
    return {
      d: `M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`,
      color: colorFor(null, i),
      pct: Math.round(frac * 100),
      labelX: cx + lr * Math.cos(mid),
      labelY: cy + lr * Math.sin(mid),
      name: String(p.x),
    };
  });
  return {
    slices,
    legend: slices.map(sl => ({ name: sl.name, color: sl.color })),
    hasYAxis: false, axes: {},
  };
}

// ── SCATTER ─────────────────────────────────────────────────────────────────
function buildScatter(s, series, unit) {
  let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
  for (const ser of series) for (const p of ser.points) {
    const x = +p.x, y = +p.y;
    if (x < xlo) xlo = x; if (x > xhi) xhi = x;
    if (y < ylo) ylo = y; if (y > yhi) yhi = y;
  }
  if (!isFinite(xlo)) { xlo = 0; xhi = 1; ylo = 0; yhi = 1; }
  const xs = niceScale(xlo, xhi, 5);
  const ys = niceScale(ylo, yhi, 5);
  const grid = gridlines(ys, unit);

  const xpos = (v) => PLOT.x + ((v - xs.min) / (xs.max - xs.min || 1)) * PLOT.w;
  const ypos = (v) => PLOT.y + PLOT.h - ((v - ys.min) / (ys.max - ys.min || 1)) * PLOT.h;

  const groups = series.map(ser => ({
    color: ser.color, name: ser.name,
    dots: ser.points.map(p => ({ x: xpos(+p.x), y: ypos(+p.y) })),
  }));
  const xticks = xs.ticks
    .filter(v => v >= xs.min - 1e-9 && v <= xs.max + 1e-9)
    .map(v => ({ x: xpos(v), label: fmt(v, '') }));

  return {
    scale: ys, grid, groups, xticks,
    legend: series.length > 1 ? series.map(s2 => ({ name: s2.name, color: s2.color })) : [],
    axes: s.axes || {}, hasYAxis: true,
  };
}

// ── QUADRANT (2x2) ────────────────────────────────────────────────────────────
function buildQuadrant(s, series) {
  // Collect all points; auto-scale to [0,1] if any value falls outside it.
  const all = [];
  for (const ser of series) for (const p of ser.points) all.push({ ...p, color: ser.color });
  let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
  for (const p of all) {
    const x = +p.x, y = +p.y;
    if (x < xlo) xlo = x; if (x > xhi) xhi = x;
    if (y < ylo) ylo = y; if (y > yhi) yhi = y;
  }
  const inUnit = all.length && xlo >= 0 && xhi <= 1 && ylo >= 0 && yhi <= 1;
  const sx = inUnit ? { min: 0, max: 1 } : { min: xlo, max: xhi || 1 };
  const sy = inUnit ? { min: 0, max: 1 } : { min: ylo, max: yhi || 1 };

  const xpos = (v) => PLOT.x + ((v - sx.min) / (sx.max - sx.min || 1)) * PLOT.w;
  const ypos = (v) => PLOT.y + PLOT.h - ((v - sy.min) / (sy.max - sy.min || 1)) * PLOT.h;

  const midX = PLOT.x + PLOT.w / 2;
  const midY = PLOT.y + PLOT.h / 2;

  const dots = all.map(p => {
    const x = xpos(+p.x), y = ypos(+p.y);
    // Keep labels inside the plot: anchor toward the centre.
    const anchor = x > midX ? 'end' : 'start';
    const lx = x + (x > midX ? -14 : 14);
    return { x, y, color: p.color, label: String(p.label || p.name || ''), anchor, lx, ly: y + 6 };
  });

  return {
    quadrant: { midX, midY },
    dots,
    axes: s.axes || {},
    hasYAxis: false,
  };
}

const title   = computed(() => (store.scene && store.scene.title) || '');
const caption = computed(() => (store.scene && store.scene.caption) || '');

// Per-series reveal helper: a series is shown only once its step has fired.
function seriesShown(i) { return store.isRevealed(`chart-series-${i}`); }
const frameShown = computed(() => store.isRevealed('chart-frame'));

// Legend anchored at the top-right of the plot, on a backing panel so a data
// point that lands in the corner can never blur into a swatch (the prior
// crowding the geometry/vision audit flagged on the line + scatter charts).
const PLOT_RIGHT = PLOT.x + PLOT.w;
const LEGEND = computed(() => {
  const items = (model.value && model.value.legend) || [];
  if (!items.length) return null;
  const maxChars = Math.max(...items.map(l => String(l.name || '').length));
  const rowH = 32, padX = 16, padY = 12, swatch = 16, gap = 12;
  const textW = Math.ceil(maxChars * 13.5);      // ~0.56em per char at 24px
  const w = padX * 2 + swatch + gap + textW;
  const h = padY * 2 + items.length * rowH - (rowH - 18);
  return { x: PLOT_RIGHT - w, y: PLOT.y, w, h, rowH, padX, padY, swatch, gap, items };
});
</script>

<template>
  <div id="chart-region" class="scene-region active">
    <div
      id="chart-title"
      class="reveal"
      :class="{ shown: store.isRevealed('chart-title') }"
    >{{ title }}</div>

    <div id="chart-frame" class="reveal" :class="{ shown: frameShown }">
      <svg
        :viewBox="`0 0 ${1000} ${620}`"
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        class="chart-svg"
      >
        <!-- ── Axes + gridlines (all non-pie/quadrant variants) ── -->
        <template v-if="model.hasYAxis">
          <g class="chart-grid">
            <line
              v-for="(g, i) in model.grid"
              :key="`g${i}`"
              :x1="96" :x2="96 + (1000 - 96 - 48)"
              :y1="g.y" :y2="g.y"
            />
          </g>
          <g class="chart-axis-labels">
            <text
              v-for="(g, i) in model.grid"
              :key="`gl${i}`"
              :x="88" :y="g.y" text-anchor="end" dominant-baseline="middle"
            >{{ g.label }}</text>
          </g>
          <!-- axis lines -->
          <line class="chart-axis" :x1="96" :y1="40" :x2="96" :y2="40 + (620 - 40 - 92)" />
          <line class="chart-axis" :x1="96" :y1="40 + (620 - 40 - 92)" :x2="96 + (1000 - 96 - 48)" :y2="40 + (620 - 40 - 92)" />
          <!-- axis titles -->
          <text
            v-if="model.axes && model.axes.y"
            class="chart-axis-title"
            :x="28" :y="40 + (620 - 40 - 92) / 2"
            text-anchor="middle"
            :transform="`rotate(-90 28 ${40 + (620 - 40 - 92) / 2})`"
          >{{ model.axes.y }}</text>
          <text
            v-if="model.axes && model.axes.x"
            class="chart-axis-title"
            :x="96 + (1000 - 96 - 48) / 2" :y="600"
            text-anchor="middle"
          >{{ model.axes.x }}</text>
        </template>

        <!-- ── BAR ── -->
        <template v-if="model.variant === 'bar'">
          <g
            v-for="(grp, gi) in model.groups"
            :key="`grp${gi}`"
            class="chart-group"
          >
            <g v-for="(b, bi) in grp.bars" :key="`b${bi}`" :class="{ 'g-shown': seriesShown(bi) }" class="reveal-g">
              <rect
                :x="b.x" :y="b.y" :width="b.w" :height="b.h"
                :fill="b.color" rx="3" ry="3"
              />
              <text class="chart-bar-value" :x="b.labelX" :y="b.labelY" text-anchor="middle">{{ b.label }}</text>
            </g>
            <text class="chart-cat" :x="grp.labelX" :y="40 + (620 - 40 - 92) + 34" text-anchor="middle">{{ grp.label }}</text>
          </g>
        </template>

        <!-- ── LINE / AREA ── -->
        <template v-if="model.variant === 'line' || model.variant === 'area'">
          <text
            v-for="(t, ti) in model.xticks"
            :key="`xt${ti}`"
            class="chart-cat" :x="t.x" :y="40 + (620 - 40 - 92) + 34" text-anchor="middle"
          >{{ t.label }}</text>
          <g
            v-for="(ln, li) in model.lines"
            :key="`ln${li}`"
            class="reveal-g"
            :class="{ 'g-shown': seriesShown(li) }"
          >
            <path v-if="model.fill && ln.area" :d="ln.area" :fill="ln.color" class="chart-area" />
            <polyline :points="ln.poly" :stroke="ln.color" fill="none" class="chart-line" />
            <circle
              v-for="(d, di) in ln.dots" :key="`d${di}`"
              :cx="d.x" :cy="d.y" r="5" :fill="ln.color" class="chart-dot"
            />
          </g>
        </template>

        <!-- ── SCATTER ── -->
        <template v-if="model.variant === 'scatter'">
          <text
            v-for="(t, ti) in model.xticks"
            :key="`sxt${ti}`"
            class="chart-cat" :x="t.x" :y="40 + (620 - 40 - 92) + 34" text-anchor="middle"
          >{{ t.label }}</text>
          <g
            v-for="(grp, gi) in model.groups"
            :key="`sg${gi}`"
            class="reveal-g"
            :class="{ 'g-shown': seriesShown(gi) }"
          >
            <circle
              v-for="(d, di) in grp.dots" :key="`sd${di}`"
              :cx="d.x" :cy="d.y" r="9" :fill="grp.color" class="chart-scatter-dot"
            />
          </g>
        </template>

        <!-- ── PIE ── -->
        <template v-if="model.variant === 'pie'">
          <g
            v-for="(sl, si) in model.slices"
            :key="`pie${si}`"
            class="reveal-g"
            :class="{ 'g-shown': seriesShown(0) }"
          >
            <path :d="sl.d" :fill="sl.color" class="chart-slice" />
            <text class="chart-slice-pct" :x="sl.labelX" :y="sl.labelY" text-anchor="middle" dominant-baseline="middle">{{ sl.pct }}%</text>
          </g>
        </template>

        <!-- ── QUADRANT ── -->
        <template v-if="model.variant === 'quadrant'">
          <g class="reveal-g g-shown">
            <!-- frame -->
            <rect
              class="chart-quad-frame"
              :x="96" :y="40"
              :width="1000 - 96 - 48" :height="620 - 40 - 92"
              fill="none"
            />
            <!-- divider lines -->
            <line class="chart-quad-div" :x1="model.quadrant.midX" :y1="40" :x2="model.quadrant.midX" :y2="40 + (620 - 40 - 92)" />
            <line class="chart-quad-div" :x1="96" :y1="model.quadrant.midY" :x2="96 + (1000 - 96 - 48)" :y2="model.quadrant.midY" />
            <!-- axis titles: x along bottom, y up the left -->
            <text v-if="model.axes && model.axes.x" class="chart-axis-title" :x="96 + (1000 - 96 - 48) / 2" :y="600" text-anchor="middle">{{ model.axes.x }}</text>
            <text
              v-if="model.axes && model.axes.y"
              class="chart-axis-title"
              :x="40" :y="40 + (620 - 40 - 92) / 2" text-anchor="middle"
              :transform="`rotate(-90 40 ${40 + (620 - 40 - 92) / 2})`"
            >{{ model.axes.y }}</text>
          </g>
          <g
            v-for="(d, di) in model.dots"
            :key="`qd${di}`"
            class="reveal-g"
            :class="{ 'g-shown': seriesShown(0) }"
          >
            <circle :cx="d.x" :cy="d.y" r="11" :fill="d.color" class="chart-scatter-dot" />
            <text class="chart-quad-label" :x="d.lx" :y="d.ly" :text-anchor="d.anchor">{{ d.label }}</text>
          </g>
        </template>

        <!-- ── Legend (top-right, on a backing panel so data never blurs into it) ── -->
        <g v-if="LEGEND" class="chart-legend">
          <rect
            class="chart-legend-bg"
            :x="LEGEND.x" :y="LEGEND.y" :width="LEGEND.w" :height="LEGEND.h"
            rx="8" ry="8"
          />
          <g
            v-for="(lg, i) in LEGEND.items"
            :key="`lg${i}`"
            :transform="`translate(${LEGEND.x + LEGEND.padX}, ${LEGEND.y + LEGEND.padY + 14 + i * LEGEND.rowH})`"
          >
            <rect x="0" y="-13" :width="LEGEND.swatch" height="16" :fill="lg.color" rx="2" />
            <text :x="LEGEND.swatch + LEGEND.gap" y="0" text-anchor="start" class="chart-legend-text">{{ lg.name }}</text>
          </g>
        </g>
      </svg>
    </div>

    <div
      id="chart-caption"
      class="reveal"
      :class="{ shown: store.isRevealed('chart-caption') }"
    >{{ caption }}</div>
  </div>
</template>

<style scoped>
#chart-region {
  gap: 28px;
  max-width: 1500px;
  width: 100%;
  margin: 0 auto;
  text-align: center;
}
#chart-title {
  font-size: 36px;
  font-weight: bold;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: #58a6ff;
  text-align: center;
}
#chart-frame {
  width: 100%;
  display: flex;
  justify-content: center;
}
.chart-svg {
  width: 100%;
  max-width: 1300px;
  height: auto;
  aspect-ratio: 1000 / 620;
  display: block;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}
#chart-caption {
  font-size: 34px;
  color: #cdd9e5;
  text-align: center;
  max-width: 1400px;
  line-height: 1.4;
  margin: 0 auto;
  min-height: 96px;
}

/* SVG content */
.chart-grid line { stroke: #21262d; stroke-width: 1.5; }
.chart-axis { stroke: #484f58; stroke-width: 2; }
.chart-axis-labels text { fill: #8b949e; font-size: 22px; }
.chart-axis-title { fill: #8b949e; font-size: 24px; letter-spacing: 0.05em; }
.chart-cat { fill: #e6edf3; font-size: 24px; }
.chart-bar-value { fill: #8b949e; font-size: 20px; }
.chart-line { stroke-width: 4; stroke-linejoin: round; stroke-linecap: round; }
.chart-area { opacity: 0.18; }
.chart-dot { stroke: #0d1117; stroke-width: 2; }
.chart-scatter-dot { stroke: #0d1117; stroke-width: 2; }
.chart-slice { stroke: #0d1117; stroke-width: 3; }
.chart-slice-pct { fill: #0d1117; font-size: 26px; font-weight: bold; }
.chart-quad-frame { stroke: #30363d; stroke-width: 2; }
.chart-quad-div { stroke: #484f58; stroke-width: 1.5; stroke-dasharray: 6 6; }
.chart-quad-label { fill: #e6edf3; font-size: 24px; }
.chart-legend-bg { fill: #161b22; fill-opacity: 0.95; stroke: #30363d; stroke-width: 1.5; }
.chart-legend-text { fill: #e6edf3; font-size: 24px; }

/* Per-series reveal — groups fade/grow in once their step fires. */
.reveal-g {
  opacity: 0;
  transition: opacity 320ms ease-out;
}
.reveal-g.g-shown { opacity: 1; }
body.instant .reveal-g { transition: none !important; }
</style>

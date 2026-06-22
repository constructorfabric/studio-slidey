/**
 * SLIDEY — deterministic geometry auditor
 *
 * The rendered-DOM counterpart to src/check.js. Where --check validates a
 * diagram-svg spec's DECLARED node geometry statically (font metrics, declared
 * w/h, declared overlap), --audit drives the real render bundle in headless
 * Chrome and measures the ACTUAL laid-out pixels per reveal step. It catches
 * the things only the real browser knows:
 *
 *   - off-page          : a visible element/box clipped by the 1920x1080 frame edge
 *   - page-overflow     : document content larger than the frame (aggregate)
 *   - box-overflow      : content spilling past a clipping ancestor OR its own box
 *   - node-overflow     : SVG node text wider/taller than its (post-expansion) rect
 *   - node-overlap      : two rendered diagram nodes whose boxes intersect
 *   - content-overlap   : two sibling HTML content cards whose boxes intersect
 *   - off-viewbox       : a diagram node pushed outside its panel's viewBox
 *   - template-leak     : an unsubstituted {{var}} / ${var} / undefined / null
 *   - tiny-text         : visible text below a legibility floor
 *   - low-contrast      : text vs its composited background below a WCAG ratio
 *                         (error = invisible; warn = small + dim)
 *   - truncated-ellipsis: text actually clipped by ellipsis / -webkit-line-clamp
 *   - missing-or-broken : an <img> that failed to load (naturalWidth 0)
 *
 * Output is one finding list per frame (scene-step), emitted as JSON. It is
 * deterministic ground truth — the slidey-visual-qa vision pass anchors its
 * subjective judgements (legibility, balance, cramped diagrams) to it instead
 * of guessing geometry from pixels.
 *
 * Usage (from src/index.js):  --audit <out.json> [--scenes ...]
 */

'use strict';

const puppeteer = require('puppeteer');
const path      = require('path');
const { launchOptions } = require('./browser');
const { sceneShowOpts } = require('./assets');

const RENDER_BUNDLE = path.resolve(__dirname, '..', 'dist-render', 'render.html');

// Legibility floor (CSS px at 1920x1080). Real slide text is ≥18px; anything
// under this on visible copy is almost certainly a layout accident.
const TINY_TEXT_PX = 13;

// Contrast thresholds (WCAG relative-luminance ratio of text vs its effective
// background). Calibrated against the shipped decks, which deliberately use
// low-contrast text for de-emphasis — separators (·, ▸, ···) and dim metadata
// run as low as ~1.4 by design, and the smallest dim *word* text bottoms out at
// ~2.1. So we flag only what the design never does:
//   error : ratio < 1.3 — text essentially the same colour as its background
//           (invisible — e.g. a colour var resolved wrong, dark-on-dark).
//   warn  : ratio < 2.0 AND font < 20px — small AND dim, the combination that
//           actually hurts readability (large dim text is fine on a slide).
// Both require ≥2 alphanumeric chars so decorative glyphs never trip them.
const CONTRAST_INVISIBLE = 1.3;
const CONTRAST_SMALL_MIN = 2.0;
const CONTRAST_SMALL_FONT_PX = 20;

/**
 * The in-page audit. Serialized and run via page.evaluate in the render bundle's
 * browser context, so it can only use browser globals. Returns a plain array of
 * findings for the CURRENTLY rendered reveal state.
 *
 * @param {number} W frame width   @param {number} H frame height
 * @param {object} cfg thresholds: {tinyPx, contrastInvisible, contrastSmallMin, contrastSmallFontPx}
 * @returns {Array<{check:string,severity:string,node:string,detail:string,text:string}>}
 */
/* istanbul ignore next — runs in the browser, not under node coverage */
function auditDom(W, H, cfg) {
  const { tinyPx, contrastInvisible, contrastSmallMin, contrastSmallFontPx } = cfg;
  const TOL = 2;                       // px slack — sub-pixel layout is not a defect
  const findings = [];
  const add = (check, severity, detail, text, node) =>
    findings.push({ check, severity, detail, text: (text || '').slice(0, 120), node: node || '' });

  const css = el => window.getComputedStyle(el);

  // ---- colour / contrast helpers (WCAG relative luminance) ----
  const parseRgb = s => {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const a = m[1].split(',').map(x => parseFloat(x));
    return { r: a[0], g: a[1], b: a[2], a: a[3] === undefined ? 1 : a[3] };
  };
  const over = (t, b) => {                       // alpha-composite t over b
    const a = t.a + b.a * (1 - t.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (t.r * t.a + b.r * b.a * (1 - t.a)) / a,
      g: (t.g * t.a + b.g * b.a * (1 - t.a)) / a,
      b: (t.b * t.a + b.b * b.a * (1 - t.a)) / a, a,
    };
  };
  const lum = c => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const L1 = lum(a), L2 = lum(b);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  };
  // slidey's base canvas colour (#0d1117) — the floor of the bg compositing walk
  const BASE_BG = { r: 13, g: 17, b: 23, a: 1 };
  const htmlBg = el => {                          // effective bg behind an element's text
    const stack = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parseRgb(css(n).backgroundColor);
      if (c && c.a > 0) stack.push(c);
      n = n.parentElement;
    }
    let base = BASE_BG;
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const alnum = s => (s.match(/[a-z0-9]/gi) || []).length;
  // text painted by a gradient (background-clip:text) — computed `color` lies, skip
  const isClipText = s => /text/.test(s.webkitBackgroundClip || s.backgroundClip || '');
  // Apply the calibrated contrast rules to one text element/fill.
  const contrastCheck = (fg, bg, text, fontPx, node) => {
    const c = ratio(fg, bg);
    if (alnum(text) < 2) return;                  // ignore decorative glyphs
    if (c < contrastInvisible) {
      add('low-contrast', 'error',
        `text/background contrast ${c.toFixed(2)}:1 — effectively invisible (below ${contrastInvisible}:1)`,
        text, node);
    } else if (c < contrastSmallMin && fontPx && fontPx < contrastSmallFontPx) {
      add('low-contrast', 'warn',
        `small text (${fontPx.toFixed(0)}px) at low contrast ${c.toFixed(2)}:1 (below ${contrastSmallMin}:1)`,
        text, node);
    }
  };
  const isHtmlVisible = el => {
    const s = css(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    if (parseFloat(s.opacity || '1') < 0.05) return false;   // unrevealed .reveal steps
    if (el.offsetParent === null && s.position !== 'fixed') return false; // ancestor display:none
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };
  // direct (non-descendant) text of an element, trimmed
  const ownText = el => {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.trim();
  };
  const label = el => {
    const id = el.id ? `#${el.id}` : '';
    const cls = (el.getAttribute && el.getAttribute('class')) ? '.' + el.getAttribute('class').trim().split(/\s+/)[0] : '';
    return (el.tagName ? el.tagName.toLowerCase() : '') + id + cls;
  };

  const root = document.getElementById('root') || document.body;

  // ---- HTML-space checks: walk every text-bearing visible element ----------
  for (const el of root.querySelectorAll('*')) {
    if (el.namespaceURI === 'http://www.w3.org/2000/svg') continue;  // SVG handled below
    if (!isHtmlVisible(el)) continue;
    const text = ownText(el);
    const r = el.getBoundingClientRect();

    const s = css(el);

    // template-leak — applies to any visible own-text, regardless of layout
    if (text) {
      if (/\{\{.*?\}\}|\$\{.*?\}/.test(text)) {
        add('template-leak', 'error', 'unsubstituted template variable in rendered text', text, label(el));
      } else if (/^(undefined|null|NaN)$/.test(text)) {
        add('template-leak', 'error', `rendered literal "${text}" — a missing value leaked through`, text, label(el));
      }
      const fontPx = parseFloat(s.fontSize);
      if (fontPx && fontPx < tinyPx && text.length > 1) {
        add('tiny-text', 'warn', `font-size ${fontPx.toFixed(1)}px is below the ${tinyPx}px legibility floor`, text, label(el));
      }
      // low-contrast — text vs its effective (composited) background. Skip gradient
      // (background-clip:text) elements whose computed `color` doesn't paint them.
      if (!isClipText(s)) {
        const fgRaw = parseRgb(s.color);
        if (fgRaw) {
          const bg = htmlBg(el);
          const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;
          contrastCheck(fg, bg, text, fontPx, label(el));
        }
      }
      // truncated-ellipsis — text actually clipped by ellipsis/line-clamp
      const clamped = parseInt(s.webkitLineClamp, 10) > 0;
      if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + TOL) {
        add('truncated-ellipsis', 'warn', `text truncated horizontally with an ellipsis (content ${el.scrollWidth}px > box ${el.clientWidth}px)`, text, label(el));
      } else if (clamped && el.scrollHeight > el.clientHeight + TOL) {
        add('truncated-ellipsis', 'warn', `text clamped to ${s.webkitLineClamp} line(s); ${el.scrollHeight - el.clientHeight}px of content is hidden`, text, label(el));
      }
    }

    // broken-image — a rendered <img> whose source failed to decode
    if (el.tagName === 'IMG' && (el.getAttribute('src') || el.currentSrc) && el.complete && el.naturalWidth === 0) {
      add('missing-or-broken', 'error', 'image failed to load (naturalWidth 0)', el.getAttribute('src') || el.currentSrc || '', label(el));
    }

    // off-page — only meaningful for leaf-ish content (has own text, or is an img)
    const isLeafContent = !!text || el.tagName === 'IMG';
    if (isLeafContent) {
      const edges = [];
      if (r.left   < -TOL)      edges.push(`left ${Math.round(r.left)}`);
      if (r.top    < -TOL)      edges.push(`top ${Math.round(r.top)}`);
      if (r.right  > W + TOL)   edges.push(`right ${Math.round(r.right)} > ${W}`);
      if (r.bottom > H + TOL)   edges.push(`bottom ${Math.round(r.bottom)} > ${H}`);
      if (edges.length) add('off-page', 'error', `clipped by frame edge (${edges.join(', ')})`, text, label(el));

      // box-overflow — spills past the nearest clipping ancestor
      let p = el.parentElement;
      while (p && p !== document.body) {
        const ps = css(p);
        if (/(hidden|clip|auto|scroll)/.test(ps.overflowX + ' ' + ps.overflowY)) {
          const pr = p.getBoundingClientRect();
          const out = [];
          if (r.right  > pr.right  + TOL) out.push(`${Math.round(r.right - pr.right)}px right`);
          if (r.bottom > pr.bottom + TOL) out.push(`${Math.round(r.bottom - pr.bottom)}px below`);
          if (r.left   < pr.left   - TOL) out.push(`${Math.round(pr.left - r.left)}px left`);
          if (r.top    < pr.top    - TOL) out.push(`${Math.round(pr.top - r.top)}px above`);
          if (out.length) add('box-overflow', 'error', `overflows ${label(p)} by ${out.join(', ')}`, text, label(el));
          break;   // nearest clipping ancestor only
        }
        p = p.parentElement;
      }
    }

    // box self-overflow — a clipping element whose OWN content is larger than its
    // box (catches a fixed-height box clipping wrapped text, which the child-vs-
    // ancestor pass above misses). The overflow must be both absolute (>4px) and
    // proportional (>2% of the box): a few px clipped from a full-height layout
    // container is structural slack, not a clipped label.
    if (/(hidden|clip)/.test(s.overflowX + ' ' + s.overflowY)) {
      const ov = [];
      const wOver = el.scrollWidth - el.clientWidth, hOver = el.scrollHeight - el.clientHeight;
      if (wOver > 4 && wOver > el.clientWidth  * 0.02) ov.push(`${wOver}px wide`);
      if (hOver > 4 && hOver > el.clientHeight * 0.02) ov.push(`${hOver}px tall`);
      if (ov.length) add('box-overflow', 'error', `content clipped by its own box (overflows ${ov.join(', ')})`, text, label(el));
    }

    // off-frame box — a bordered/filled card (not a full-bleed background layer)
    // clipped by the frame edge, even when its own text sits clear of the edge.
    const borderPx = parseFloat(s.borderTopWidth) || 0;
    const ownBg = parseRgb(s.backgroundColor);
    const isBox = (borderPx > 0 && parseRgb(s.borderTopColor)?.a > 0) || (ownBg && ownBg.a > 0.05);
    const fullBleed = r.left <= TOL && r.top <= TOL && r.right >= W - TOL && r.bottom >= H - TOL;
    if (isBox && !fullBleed && el.id !== 'root') {
      const edges = [];
      if (r.left   < -TOL)    edges.push('left');
      if (r.top    < -TOL)    edges.push('top');
      if (r.right  > W + TOL) edges.push('right');
      if (r.bottom > H + TOL) edges.push('bottom');
      if (edges.length) add('off-page', 'error', `box ${label(el)} clipped by frame edge (${edges.join(', ')})`, '', label(el));
    }
  }

  // ---- SVG-space checks: per diagram panel, in the panel's own units --------
  for (const svg of root.querySelectorAll('svg.diagramsvg-svg')) {
    // is this panel revealed? walk up to the .diagramsvg-panel and check opacity
    let panel = svg.closest('.diagramsvg-panel');
    if (panel && parseFloat(css(panel).opacity || '1') < 0.05) continue;

    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    const haveVb = vb.length === 4 && vb.every(n => !Number.isNaN(n));
    const nodes = [];
    for (const g of svg.querySelectorAll('g.dsvg-node')) {
      const rect = g.querySelector('rect');
      if (!rect) continue;
      const id = g.getAttribute('data-node-id') || '';
      const rx = rect.x.baseVal.value, ry = rect.y.baseVal.value;
      const rw = rect.width.baseVal.value, rh = rect.height.baseVal.value;
      nodes.push({ id, rx, ry, rw, rh });

      // rect fill is the background behind this node's labels (fall back to canvas)
      const rectBg = parseRgb(css(rect).fill) || BASE_BG;
      for (const t of g.querySelectorAll('text')) {
        // node text wider/taller than its (already auto-expanded) rect
        let bb; try { bb = t.getBBox(); } catch (_) { bb = null; }
        if (bb && bb.width > rw - 6) {
          add('node-overflow', 'error',
            `text wider than node "${id}" (text ${Math.round(bb.width)}u > box ${Math.round(rw)}u)`,
            t.textContent || '', `node#${id}`);
        }
        if (bb && (bb.y < ry - TOL || bb.y + bb.height > ry + rh + TOL)) {
          add('node-overflow', 'error',
            `text taller than node "${id}" (text spans ${Math.round(bb.y)}–${Math.round(bb.y + bb.height)}u, box ${Math.round(ry)}–${Math.round(ry + rh)}u)`,
            t.textContent || '', `node#${id}`);
        }
        // node label contrast vs its rect fill
        const ts = css(t);
        if (!isClipText(ts)) {
          const tf = parseRgb(ts.fill);
          if (tf) contrastCheck(tf.a < 1 ? over(tf, rectBg) : tf, rectBg, t.textContent || '', parseFloat(ts.fontSize), `node#${id}`);
        }
      }

      // node pushed outside its panel's viewBox (panel clips it)
      if (haveVb) {
        const [vx, vy, vw, vh] = vb;
        const out = [];
        if (rx < vx - TOL)            out.push('left');
        if (ry < vy - TOL)            out.push('top');
        if (rx + rw > vx + vw + TOL)  out.push('right');
        if (ry + rh > vy + vh + TOL)  out.push('bottom');
        if (out.length) add('off-viewbox', 'error', `node "${id}" outside panel viewBox (${out.join(', ')})`, '', `node#${id}`);
      }
    }

    // rendered node-node overlap within this panel (post-expansion truth)
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const A = nodes[a], B = nodes[b];
        const ox = Math.min(A.rx + A.rw, B.rx + B.rw) - Math.max(A.rx, B.rx);
        const oy = Math.min(A.ry + A.rh, B.ry + B.rh) - Math.max(A.ry, B.ry);
        if (ox > TOL && oy > TOL) {
          add('node-overlap', 'error',
            `nodes "${A.id}" and "${B.id}" overlap (${Math.round(ox)}u × ${Math.round(oy)}u)`,
            '', `node#${A.id}`);
        }
      }
    }
  }

  // ---- page-overflow: anything pushing the document past the frame ----------
  // The viewport is exactly W×H, so a larger scroll size means content overflows
  // the slide (and would be clipped or cause a scrollbar in the web view).
  const de = document.documentElement;
  if (de.scrollWidth  > W + TOL) add('page-overflow', 'error', `page content ${de.scrollWidth}px wide exceeds the ${W}px frame`, '', 'document');
  if (de.scrollHeight > H + TOL) add('page-overflow', 'error', `page content ${de.scrollHeight}px tall exceeds the ${H}px frame`, '', 'document');

  // ---- content-overlap: two sibling content cards whose boxes intersect ------
  // The HTML analogue of node-overlap. Scoped to bordered/filled boxes that are
  // siblings (same parent) so we never compare a child with its container, and
  // requires a meaningful overlap area to ignore 1px touch/shared borders.
  const boxSel = '.card, .transcript-card, .thread-comment, .trace-turn, [class*="-card"], [class*="-panel"]';
  for (const parent of root.querySelectorAll('*')) {
    const kids = [...parent.children].filter(k =>
      k.namespaceURI !== 'http://www.w3.org/2000/svg' && k.matches(boxSel) && isHtmlVisible(k));
    for (let a = 0; a < kids.length; a++) {
      for (let b = a + 1; b < kids.length; b++) {
        const ra = kids[a].getBoundingClientRect(), rb = kids[b].getBoundingClientRect();
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > 4 && oy > 4) {                       // real area overlap, not a shared edge
          add('content-overlap', 'error',
            `${label(kids[a])} and ${label(kids[b])} overlap by ${Math.round(ox)}×${Math.round(oy)}px`,
            '', label(kids[a]));
        }
      }
    }
  }

  return findings;
}

/**
 * Drive the render bundle and audit every reveal step.
 *
 * @param {object} spec
 * @param {object} opts
 * @param {string} [opts.specPath]
 * @param {Set}    [opts.selectedScenes]
 * @param {function} [opts.onProgress] callback(frameCount, sceneIndex, type)
 * @returns {Promise<{frames:Array, summary:object}>}
 */
async function auditSpec(spec, opts = {}) {
  const { specPath = null, selectedScenes = null, onProgress = null } = opts;

  // Rebuilds dist-render if missing OR stale vs web/ — audit always reflects
  // the current viewer renderer.
  require('./render-bundle').ensureRenderBundle();

  const { stepsForScene, applyShow } = await import('../web/sceneSteps.mjs');
  const { width = 1920, height = 1080 } = (spec.meta && spec.meta.resolution) || {};
  const mode = (spec.meta && spec.meta.mode) || 'api';

  const browser = await puppeteer.launch(launchOptions({ width, height }));

  const frames = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`file://${RENDER_BUNDLE}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__slideyReady === true', { timeout: 15000 });
    await page.emulateMediaType('screen');
    await page.evaluate((meta, m) => { window.slidey.setMeta(meta); window.slidey.setMode(m); }, spec.meta || {}, mode);
    // Snap reveal animations so per-step geometry is stable and opacity is a
    // reliable revealed/hidden signal — the 320ms fade is not yet complete at
    // capture time otherwise (same trick renderer.js uses; see body.instant).
    await page.evaluate(() => document.body.classList.add('instant'));

    const scenes = spec.scenes || [];
    for (let i = 0; i < scenes.length; i++) {
      if (selectedScenes && !selectedScenes.has(i)) continue;
      const scene = scenes[i];

      const showOpts = sceneShowOpts(scene, specPath);
      await page.evaluate(applyShow, scene, showOpts);

      const steps = stepsForScene(scene);
      const pageSteps = steps.length ? steps : [null];
      let stepIdx = 0;
      for (const step of pageSteps) {
        if (step) await page.evaluate(s => window.slidey.setState(s), step);
        await page.evaluate('window.__slideySettle && window.__slideySettle()');
        const findings = await page.evaluate(auditDom, width, height, {
          tinyPx: TINY_TEXT_PX,
          contrastInvisible: CONTRAST_INVISIBLE,
          contrastSmallMin: CONTRAST_SMALL_MIN,
          contrastSmallFontPx: CONTRAST_SMALL_FONT_PX,
        });
        const sceneStr = String(i).padStart(2, '0');
        const stepStr  = String(stepIdx + 1).padStart(2, '0');
        frames.push({
          frame: `${sceneStr}-${stepStr}.png`,
          scene: i,
          step: stepIdx + 1,
          type: scene.type,
          title: scene.title || scene.eyebrow || scene.label || scene.value || '',
          state: step || null,
          findings,
        });
        stepIdx++;
      }
      if (onProgress) onProgress(frames.length, i, scene.type);

      await page.evaluate(() => { window.slidey.setState('blank'); window.slidey.hideTitleCard(); });
    }
  } finally {
    await browser.close();
  }

  // summary
  const all = frames.flatMap(f => f.findings);
  const by = sev => all.filter(f => f.severity === sev).length;
  const summary = {
    frames: frames.length,
    frames_with_findings: frames.filter(f => f.findings.length).length,
    findings: all.length,
    errors: by('error'),
    warnings: by('warn'),
    info: by('info'),
  };
  return { frames, summary };
}

// auditDom is exported for focused browser tests (it is serialized into the page
// via page.evaluate; it only runs in the browser context, never in node).
module.exports = { auditSpec, auditDom, TINY_TEXT_PX, CONTRAST_INVISIBLE, CONTRAST_SMALL_MIN, CONTRAST_SMALL_FONT_PX };

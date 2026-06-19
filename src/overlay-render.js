/**
 * SLIDEY — Deck-styled overlay renderer
 *
 * Renders transparent PNG overlays (caption banners, embedded-mode window chrome)
 * with the deck palette via Puppeteer (omitBackground), so ffmpeg can composite
 * them over an embedded demo. This is what keeps a video scene's captions and
 * frame consistent with the rest of the deck — same colours, fonts, and accent.
 *
 * Used by src/scenes/video.js. Reuses the THEME from src/tour/overlays so the
 * embed-side overlays match the capture-side (baked-in) ones exactly.
 */

'use strict';

const { THEME } = require('./tour/overlays');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A lower-third / positioned caption banner, matching the capture overlay. */
function captionHtml(o, width, height) {
  const sub = o.sub ? `<span class="sub">${esc(o.sub)}</span>` : '';
  // Default: lower-third, horizontally centered. x/y (px) override the anchor.
  const left = o.x != null ? `${o.x}px` : '50%';
  const top  = o.y != null ? `${o.y}px` : 'auto';
  const bottom = o.y != null ? 'auto' : `${Math.round(height * 0.07)}px`;
  const tx = o.x != null ? '0' : '-50%';
  return `<div class="cap" style="left:${left};top:${top};bottom:${bottom};transform:translateX(${tx})">` +
    `${esc(o.text)}${sub}</div>`;
}

/** Embedded-mode window chrome: eyebrow + title above the inset, caption below,
 *  and a rounded accent border framing the video inset rect. */
function chromeHtml(o, width, height) {
  const { x, y, w, h } = o.inset;
  const eyebrow = o.eyebrow ? `<div class="eyebrow" style="top:${y - 96}px">${esc(o.eyebrow)}</div>` : '';
  const title   = o.title   ? `<div class="title" style="top:${y - 64}px">${esc(o.title)}</div>` : '';
  const caption = o.caption ? `<div class="cap2" style="top:${y + h + 28}px">${esc(o.caption)}</div>` : '';
  // A titlebar strip + frame border around the inset (the video sits inside).
  const frame =
    `<div class="frame" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`;
  return `${eyebrow}${title}${frame}${caption}`;
}

function pageHtml(bodyInner, width, height) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;box-sizing:border-box}
    html,body{width:${width}px;height:${height}px;background:transparent;overflow:hidden}
    .cap{position:absolute;z-index:5;background:${THEME.bg};color:${THEME.text};
      border:1px solid ${THEME.border};border-left:4px solid ${THEME.accent};border-radius:10px;
      padding:14px 22px;max-width:70%;font:600 28px/1.35 ${THEME.font};
      box-shadow:0 12px 38px rgba(0,0,0,.6)}
    .cap .sub{display:block;margin-top:6px;font-weight:400;font-size:19px;color:${THEME.sub}}
    .eyebrow{position:absolute;left:0;width:100%;text-align:center;color:${THEME.accent};
      font:700 22px ${THEME.font};letter-spacing:.12em;text-transform:uppercase}
    .title{position:absolute;left:0;width:100%;text-align:center;color:${THEME.text};
      font:700 40px ${THEME.font}}
    .cap2{position:absolute;left:0;width:100%;text-align:center;color:${THEME.sub};
      font:400 24px/1.4 ${THEME.font}}
    .frame{position:absolute;border:2px solid ${THEME.border};border-radius:12px;
      box-shadow:0 0 0 1px rgba(88,166,255,.25),0 24px 60px rgba(0,0,0,.5)}
  </style></head><body>${bodyInner}</body></html>`;
}

/**
 * Render a set of overlay PNGs. Each item is rendered onto its OWN transparent
 * width×height canvas so ffmpeg can enable it for its own time window.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {Array<{id,kind,...}>} items   kind 'caption' | 'chrome'
 * @param {object} o  { width, height, outDir }
 * @returns {Promise<Array<{id, png}>>}
 */
async function renderOverlays(browser, items, o) {
  const fs = require('fs');
  const path = require('path');
  const { width, height, outDir } = o;
  fs.mkdirSync(outDir, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const out = [];
  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const inner = item.kind === 'chrome' ? chromeHtml(item, width, height) : captionHtml(item, width, height);
      await page.setContent(pageHtml(inner, width, height), { waitUntil: 'load' });
      const png = path.join(outDir, `ov-${String(i).padStart(3, '0')}.png`);
      await page.screenshot({ path: png, omitBackground: true });
      out.push({ id: item.id, png });
    }
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}

module.exports = { renderOverlays };

/**
 * SLIDEY — Portable tour overlays (deck-themed)
 *
 * App-agnostic DOM overlays injected into a TARGET web app's page during a tour
 * capture: a setup curtain, a caption banner, and a spotlight + dimming
 * backdrop. Ported from kitsoki's `_helpers/demo.ts` (installCurtain /
 * makeCaption / makeSpotlight) and generalized — they inject plain DOM and work
 * on ANY page, not just an app that ships its own tour overlay.
 *
 * Two things changed in the port:
 *   1. Styling uses the slidey DECK palette (GitHub-dark: bg #0d1117, text
 *      #e6edf3, the #58a6ff→#bc8cff accent gradient, borders #30363d) instead of
 *      kitsoki's amber/slate, so a captured demo's captions/spotlight match the
 *      surrounding deck — the "consistent formatting" requirement.
 *   2. Puppeteer primitives (evaluateOnNewDocument / addStyleTag / evaluate)
 *      replace Playwright's (addInitScript / addStyleTag / evaluate).
 *
 * Every overlay is `pointer-events:none` so it never intercepts a click on the
 * UI beneath it (an opaque banner over a button = every click times out — the
 * trap kitsoki documents).
 */

'use strict';

// Deck palette (mirrors web/styles/template.css). Keep in sync if the theme moves.
const THEME = {
  bg:      'rgba(13,17,23,.94)',   // #0d1117 @ 94%
  border:  '#30363d',
  accent:  '#58a6ff',              // primary blue (gradient start)
  accent2: '#bc8cff',              // purple (gradient end)
  text:    '#e6edf3',
  sub:     '#8b949e',
  font:    "'JetBrains Mono','Courier New',ui-monospace,monospace",
};

const CURTAIN_ID = 'slidey-curtain';
const CAPTION_ID = 'slidey-caption';
const SPOT_BACK_ID = 'slidey-spot-back';
const SPOT_ID = 'slidey-spot';

/**
 * Install the setup curtain on EVERY document load (survives reload via
 * sessionStorage). Hides off-camera setup — the target app loading, off-camera
 * clicks/navigation — behind a full-screen title card until the first content
 * step lifts it. Call BEFORE the first navigation. pointer-events:none so
 * driver clicks during setup still reach the elements beneath.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} title
 */
async function installCurtain(page, title) {
  await page.evaluateOnNewDocument((t, id, theme) => {
    if (sessionStorage.getItem('slidey-curtain-lifted')) return;
    const add = () => {
      if (document.getElementById(id)) return;
      const c = document.createElement('div');
      c.id = id;
      c.style.cssText =
        `position:fixed;inset:0;z-index:2147483647;background:${theme.bg.replace('.94','1')};` +
        `display:flex;align-items:center;justify-content:center;pointer-events:none;` +
        `color:${theme.text};font:700 38px ${theme.font};letter-spacing:.01em;` +
        `text-align:center;padding:0 8%;transition:opacity .6s`;
      c.textContent = t;
      (document.body || document.documentElement).appendChild(c);
    };
    if (document.body) add();
    else document.addEventListener('DOMContentLoaded', add);
  }, title, CURTAIN_ID, THEME);
}

/** Fade the curtain out (the fade is the on-camera reveal moment). */
async function liftCurtain(page) {
  await page.evaluate((id) => {
    sessionStorage.setItem('slidey-curtain-lifted', '1');
    const c = document.getElementById(id);
    if (c) { c.style.opacity = '0'; setTimeout(() => c.remove(), 600); }
  }, CURTAIN_ID).catch(() => {});
}

/**
 * Inject the caption + spotlight DOM and styles into the current page. Must be
 * re-run after any full navigation/reload (injected DOM does not survive it).
 */
async function installOverlays(page) {
  await page.addStyleTag({
    content:
      `#${CAPTION_ID}{position:fixed;top:22px;left:50%;transform:translateX(-50%);` +
        `z-index:2147483646;background:${THEME.bg};color:${THEME.text};` +
        `border:1px solid ${THEME.border};border-left:4px solid ${THEME.accent};` +
        `border-radius:10px;padding:14px 22px;max-width:70%;` +
        `font:600 22px/1.35 ${THEME.font};box-shadow:0 12px 38px rgba(0,0,0,.6);` +
        `opacity:0;transition:opacity .4s;pointer-events:none}` +
      `#${CAPTION_ID}.show{opacity:1}` +
      `#${CAPTION_ID} .sub{display:block;margin-top:6px;font-weight:400;font-size:15px;color:${THEME.sub}}` +
      `#${SPOT_BACK_ID}{position:fixed;inset:0;z-index:2147483644;pointer-events:none;` +
        `box-shadow:inset 0 0 0 4000px rgba(2,6,23,.6);opacity:0;transition:opacity .35s}` +
      `#${SPOT_BACK_ID}.show{opacity:1}` +
      `#${SPOT_ID}{position:fixed;z-index:2147483645;pointer-events:none;border-radius:10px;` +
        `border:3px solid ${THEME.accent};` +
        `box-shadow:0 0 0 4000px rgba(2,6,23,.6),0 0 22px 4px rgba(88,166,255,.55);` +
        `opacity:0;transition:opacity .3s}` +
      `#${SPOT_ID}.show{opacity:1}`,
  });
  await page.evaluate((capId, backId, spotId) => {
    for (const id of [capId, backId, spotId]) {
      if (document.getElementById(id)) continue;
      const el = document.createElement('div');
      el.id = id;
      document.body.appendChild(el);
    }
  }, CAPTION_ID, SPOT_BACK_ID, SPOT_ID);
}

/** Set (or clear, with empty title) the caption banner text. */
async function setCaption(page, title, sub = '') {
  await page.evaluate((id, t, s) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!t) { el.classList.remove('show'); return; }
    el.classList.remove('show');
    el.innerHTML = `${t}${s ? `<span class="sub">${s}</span>` : ''}`;
    requestAnimationFrame(() => el.classList.add('show'));
  }, CAPTION_ID, title || '', sub || '');
}

/**
 * Move the spotlight box over `selector` (and dim the rest), or pass null to
 * lift the dim. Scroll + measure + place happen in ONE evaluate so the rect is
 * always read post-scroll. Position is set instantly (only opacity fades) so a
 * freeze-frame screenshot can never catch the box mid-move.
 *
 * @returns {Promise<boolean>} true if the target was found and framed
 */
async function moveSpotlight(page, selector, targetText = null) {
  return await page.evaluate((sel, text, backId, spotId) => {
    const back = document.getElementById(backId);
    const box = document.getElementById(spotId);
    if (!back || !box) return false;
    if (!sel) { back.classList.remove('show'); box.classList.remove('show'); return false; }
    let target = null;
    const matches = Array.from(document.querySelectorAll(sel));
    if (text) {
      target = matches.find((el) => (el.textContent || '').includes(text)) || matches[0];
    } else {
      target = matches[0];
    }
    if (!target) { back.classList.remove('show'); box.classList.remove('show'); return false; }
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = target.getBoundingClientRect();
    const pad = 8;
    box.style.top = `${r.top - pad}px`;
    box.style.left = `${r.left - pad}px`;
    box.style.width = `${r.width + pad * 2}px`;
    box.style.height = `${r.height + pad * 2}px`;
    back.classList.add('show');
    box.classList.add('show');
    return true;
  }, selector, targetText, SPOT_BACK_ID, SPOT_ID);
}

module.exports = {
  THEME,
  installCurtain,
  liftCurtain,
  installOverlays,
  setCaption,
  moveSpotlight,
};

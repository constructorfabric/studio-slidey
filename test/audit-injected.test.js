'use strict';

// End-to-end test for the legibility/layout checks in src/audit.js's in-page
// auditDom() that can't be provoked from a spec (slidey's own styles are
// well-behaved by design). We load the render bundle, inject elements with each
// exact defect, run the REAL auditDom, and assert each check fires — plus
// controls that must stay clean (guarding against false positives).
//
// Checks covered: low-contrast, truncated-ellipsis, missing-or-broken (img),
// box-overflow (self), content-overlap, page-overflow, node-overflow (height).
//
// Requires dist-render/render.html (npm run build:render).
//
//   node --test test/audit-injected.test.js

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const audit = require('../src/audit');
const { launchOptions } = require('../src/browser');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'dist-render', 'render.html');
const haveBundle = fs.existsSync(BUNDLE);

const CFG = {
  tinyPx: audit.TINY_TEXT_PX,
  contrastInvisible: audit.CONTRAST_INVISIBLE,
  contrastSmallMin: audit.CONTRAST_SMALL_MIN,
  contrastSmallFontPx: audit.CONTRAST_SMALL_FONT_PX,
};

test('every injected defect is caught, and controls stay clean', { skip: !haveBundle && 'run npm run build:render first' }, async () => {
  const browser = await puppeteer.launch(launchOptions({ width: 1920, height: 1080 }));
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(`file://${BUNDLE}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__slideyReady === true', { timeout: 15000 });

    await page.evaluate(() => {
      const root = document.getElementById('root');
      // text defects + a high-contrast control
      root.insertAdjacentHTML('beforeend', `
        <div id="qa-text" style="position:absolute;left:80px;top:80px;background:#0d1117;font-size:40px">
          <div style="color:#1e2228">DarkOnDarkInvisible</div>
          <div style="color:#e6edf3">ReadableControlText</div>
          <div style="width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:28px">TruncatedToEllipsisForSure</div>
          <img id="qa-img" src="data:image/png;base64,bm90LWFuLWltYWdl" width="64" height="64" />
        </div>`);
      // box self-overflow: a fixed 40px box clipping multi-line text
      root.insertAdjacentHTML('beforeend',
        `<div id="qa-clip" style="position:absolute;left:80px;top:700px;width:200px;height:40px;overflow:hidden;background:#161b22;color:#fff;font-size:28px;line-height:1.4">Several lines of text that clearly exceed forty pixels of box height here</div>`);
      // content-overlap: two overlapping sibling .card boxes
      root.insertAdjacentHTML('beforeend',
        `<div id="qa-overlap">
           <div class="card" style="position:absolute;left:900px;top:600px;width:300px;height:120px;background:#161b22;border:1px solid #30363d"></div>
           <div class="card" style="position:absolute;left:1050px;top:660px;width:300px;height:120px;background:#161b22;border:1px solid #30363d"></div>
         </div>`);
      // node-overflow (height): a dsvg node whose text is taller than its rect
      root.insertAdjacentHTML('beforeend',
        `<svg class="diagramsvg-svg" viewBox="0 0 400 200" style="position:absolute;left:1400px;top:80px;width:400px;height:200px">
           <g class="dsvg-node" data-node-id="tall"><rect x="20" y="20" width="220" height="30" fill="#0d1117"/><text class="dsvg-label" x="130" y="35" text-anchor="middle" style="font-size:44px;fill:#e6edf3">Tall</text></g>
         </svg>`);
      // page-overflow: an element far past the right edge, OUTSIDE #root so the
      // per-element off-page pass (which scans #root) doesn't claim it instead.
      document.body.insertAdjacentHTML('beforeend',
        `<div style="position:absolute;left:3000px;top:10px;width:50px;height:50px;background:#333"></div>`);
      return new Promise(res => {
        const img = document.getElementById('qa-img');
        if (img.complete) return res();
        img.onload = img.onerror = () => res();
      });
    });

    const findings = await page.evaluate(audit.auditDom, 1920, 1080, CFG);
    const has = (check, sev, textIncludes, detailIncludes) =>
      findings.some(f => f.check === check && f.severity === sev &&
        (!textIncludes || (f.text || '').includes(textIncludes)) &&
        (!detailIncludes || (f.detail || '').includes(detailIncludes)));

    assert.ok(has('low-contrast', 'error', 'DarkOnDark'), 'dark-on-dark text → invisible');
    assert.ok(has('truncated-ellipsis', 'warn'), 'ellipsis truncation');
    assert.ok(has('missing-or-broken', 'error'), 'broken <img>');
    assert.ok(has('box-overflow', 'error', null, 'its own box'), 'box self-overflow (clipped multi-line text)');
    assert.ok(has('content-overlap', 'error'), 'overlapping sibling cards');
    assert.ok(has('page-overflow', 'error'), 'content past the frame edge');
    assert.ok(has('node-overflow', 'error', null, 'taller'), 'SVG node text taller than its rect');

    // controls: the readable line must NOT be flagged low-contrast
    assert.ok(!findings.some(f => f.check === 'low-contrast' && (f.text || '').includes('ReadableControl')),
      'high-contrast control must not be flagged');
  } finally {
    await browser.close();
  }
});

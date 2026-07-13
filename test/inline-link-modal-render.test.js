'use strict';

// Real-browser regression coverage for the markdown-links-open-in-modal
// feature: an inline `<a data-slidey-ref="target">` produced by bodyHtml
// opens the right modal surface on click (reference viewer for a file/media
// target, a deck switch for a "deck:<id>" target), dismisses via Escape, and
// is exempt from the click-to-advance / click-to-navigate deck controller.
//
// Unlike graph-scene-render.test.js (dist-render/render.html → DeckHost only,
// no click routing), this drives the full interactive viewer (dist/index.html
// served by src/serve.js's workspace mode → App.vue), since the click router
// and modal live there.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { launchOptions, closeBrowser, doctor } = require('../src/browser');
const { startViewer } = require('../src/serve');

const ROOT = path.join(__dirname, '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const haveDist = fs.existsSync(DIST_INDEX);

let browserReady;
async function requireBrowser(t) {
  if (!browserReady) browserReady = doctor({ width: 320, height: 180 });
  const ready = await browserReady;
  if (!ready.ok) {
    t.skip(`browser unavailable: ${ready.error}`);
    return false;
  }
  return true;
}

function writeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-inline-ref-'));
  fs.writeFileSync(
    path.join(root, 'mockup.html'),
    '<!doctype html><html><body><h1 id="marker">MOCKUP OK</h1></body></html>\n',
  );
  const spec = {
    meta: { title: 'Inline link modal test', mode: 'pitch' },
    library: {
      title: 'Inline link modal test',
      decks: [
        {
          id: 'child',
          deckType: 'hierarchy',
          title: 'Child deck',
          scenes: [
            { id: 'child-title', type: 'title', title: 'CHILD DECK LANDED', tags: ['pitch'] },
            { id: 'child-middle', type: 'title', title: 'CHILD DECK MIDDLE', tags: ['pitch'] },
            { id: 'child-close', type: 'title', title: 'CHILD DECK CLOSE', tags: ['pitch'] },
          ],
        },
      ],
    },
    scenes: [
      {
        id: 'main',
        type: 'narrative',
        eyebrow: 'Inline links',
        body: 'See the mockup and the child deck.',
        bodyHtml: 'See the <a data-slidey-ref="mockup.html">mockup</a> and the '
          + '<a data-slidey-ref="deck:child">child deck</a>.',
      },
      { id: 'main-middle', type: 'title', title: 'SOURCE DECK MIDDLE', tags: ['pitch'] },
      { id: 'main-close', type: 'title', title: 'SOURCE DECK CLOSE', tags: ['pitch'] },
    ],
  };
  fs.writeFileSync(path.join(root, 'deck.slidey.json'), JSON.stringify(spec, null, 2));
  return root;
}

async function withViewerPage(t, fn) {
  const root = writeWorkspace();
  const port = 5700 + Math.floor(Math.random() * 400);
  const server = startViewer({ root, openFile: 'deck.slidey.json', port, open: false });
  await new Promise((r) => server.on('listening', r));
  const actualPort = server.address().port;
  const browser = await puppeteer.launch(launchOptions({ width: 1920, height: 1080 }));
  t.after(async () => {
    await closeBrowser(browser);
    await new Promise((r) => server.close(r));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${actualPort}/`, { waitUntil: 'load' });
  await page.waitForSelector('#narrative-body a[data-slidey-ref]', { timeout: 15000 });
  return fn(page);
}

test(
  'clicking a data-slidey-ref link to a local .html file opens it in the sandboxed html reference modal',
  { skip: !haveDist && 'run npm run build:web first' },
  async (t) => {
    if (!await requireBrowser(t)) return;
    await withViewerPage(t, async (page) => {
      await page.click('#narrative-body a[data-slidey-ref="mockup.html"]');
      await page.waitForSelector('.slidey-ref-viewer.slidey-ref-kind-html iframe.slidey-ref-html', { timeout: 5000 });

      const iframeSrc = await page.$eval('.slidey-ref-html', (el) => el.getAttribute('src'));
      assert.match(iframeSrc, /mockup\.html$/);

      // The click must NOT also have advanced/rewound the deck (the anchor is
      // exempt from NavController's click-to-navigate handler).
      const eyebrow = await page.$eval('#narrative-eyebrow', (el) => el.textContent);
      assert.equal(eyebrow, 'Inline links');

      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () => !document.querySelector('.slidey-ref-viewer'),
        { timeout: 5000 },
      );
    });
  },
);

test(
  'clicking a data-slidey-ref "deck:" link switches to that library deck',
  { skip: !haveDist && 'run npm run build:web first' },
  async (t) => {
    if (!await requireBrowser(t)) return;
    await withViewerPage(t, async (page) => {
      await page.click('#narrative-body a[data-slidey-ref="deck:child"]');
      await page.waitForFunction(
        () => (document.getElementById('title-card-title') || {}).textContent === 'CHILD DECK LANDED',
        { timeout: 5000 },
      );
      // The scene surface has already switched, and its HUD must switch with it
      // instead of retaining the source deck's captured state (1/1).
      assert.match(
        await page.$eval('.slidey-progress', (el) => el.textContent.replace(/\s+/g, ' ').trim()),
        /scene 1\/3/,
      );
      // No reference modal should have opened for a deck target.
      assert.equal(await page.$('.slidey-ref-viewer'), null);
    });
  },
);

test(
  'hierarchy menu keeps each deck at its own last slide',
  { skip: !haveDist && 'run npm run build:web first' },
  async (t) => {
    if (!await requireBrowser(t)) return;
    await withViewerPage(t, async (page) => {
      // The source deck starts at slide one. Opening another deck must not
      // carry that index forward, and returning must restore this deck's own
      // position after the child advances independently.
      await page.click('[aria-label="Browse hierarchy"]');
      await page.evaluate(() => {
        [...document.querySelectorAll('.slidey-hierarchy-map-row')]
          .find((el) => el.textContent.includes('Child deck')).click();
      });
      await page.waitForFunction(
        () => (document.getElementById('title-card-title') || {}).textContent === 'CHILD DECK LANDED',
        { timeout: 5000 },
      );
      // Selecting the hierarchy row leaves that button focused; blur it so the
      // viewer's keyboard controller receives ArrowRight.
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(
        () => (document.getElementById('title-card-title') || {}).textContent === 'CHILD DECK MIDDLE',
        { timeout: 5000 },
      );

      await page.click('[aria-label="Browse hierarchy"]');
      await page.evaluate(() => {
        [...document.querySelectorAll('.slidey-hierarchy-map-row')]
          .find((el) => el.textContent.includes('Inline link modal test')).click();
      });
      await page.waitForSelector('#narrative-body a[data-slidey-ref]', { timeout: 5000 });
      assert.match(
        await page.$eval('.slidey-progress', (el) => el.textContent.replace(/\s+/g, ' ').trim()),
        /scene 1\/3/,
      );
    });
  },
);

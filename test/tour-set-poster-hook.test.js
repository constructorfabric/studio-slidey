'use strict';

// End-to-end proof that captureTour (freeze-frame) and captureTourRrweb
// invoke opts.onStepSettled right after a step's `before`/`waitFor` settle —
// the hook the tour-set poster feature (§2) is built on. Uses the same
// static-fixture-page + throwaway loopback server pattern as
// test/tour-adapter.test.js; skipped (not failed) when no Chrome is
// resolvable, so the rest of the suite always runs. No network, no LLM.
//
//   node --test test/tour-set-poster-hook.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { captureTour } = require('../src/tour/capture');
const { captureTourRrweb } = require('../src/tour/rrweb-capture');
const { defaultChromePath, browserExecutableError } = require('../src/browser');

const FIXTURE = path.join(__dirname, 'fixtures', 'tour-adapter-page.html');

const chromeReady = (() => {
  try {
    const p = defaultChromePath();
    return !!p && !browserExecutableError(p);
  } catch { return false; }
})();
const browserTest = chromeReady ? test : test.skip;

function serveFixture() {
  const html = fs.readFileSync(FIXTURE, 'utf8');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => server.close() });
    });
  });
}

async function withFramesDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-poster-hook-'));
  try { return await fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

browserTest('captureTour (freeze-frame) calls onStepSettled once per step, before the dwell', async () => {
  const srv = await serveFixture();
  try {
    await withFramesDir(async (framesDir) => {
      const seen = [];
      const tour = {
        target: { url: srv.url },
        startPath: '/',
        pace: 0,
        readySelector: '[data-testid=home-view]',
        steps: [
          { id: 'welcome', label: 'Welcome', dwellMs: 100 },
          { id: 'go', label: 'Go', target: '[data-testid=go-btn]', dwellMs: 100, kind: 'action', advance: 'click-target' },
        ],
      };
      const res = await captureTour(tour, framesDir, {
        pace: 0,
        onStepSettled: async (page, step, idx) => {
          seen.push({ id: step.id, idx, hasPage: typeof page.screenshot === 'function' });
        },
      });
      assert.equal(res.frameCount, 2);
      assert.deepEqual(seen.map((s) => s.id), ['welcome', 'go']);
      assert.deepEqual(seen.map((s) => s.idx), [0, 1]);
      assert.ok(seen.every((s) => s.hasPage), 'a real Puppeteer page was passed');
    });
  } finally { srv.close(); }
});

browserTest('captureTour: onStepSettled can screenshot the settled page (poster capture)', async () => {
  const srv = await serveFixture();
  try {
    await withFramesDir(async (framesDir) => {
      const postersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-posters-'));
      try {
        const tour = {
          target: { url: srv.url },
          startPath: '/',
          pace: 0,
          readySelector: '[data-testid=home-view]',
          steps: [{ id: 'welcome', label: 'Welcome', dwellMs: 100 }],
        };
        await captureTour(tour, framesDir, {
          pace: 0,
          onStepSettled: async (page, step) => {
            await page.screenshot({ path: path.join(postersDir, `demo--${step.id}.png`) });
          },
        });
        const posterPath = path.join(postersDir, 'demo--welcome.png');
        assert.ok(fs.existsSync(posterPath), 'poster PNG written');
        assert.ok(fs.statSync(posterPath).size > 0, 'poster PNG is non-empty');
      } finally {
        fs.rmSync(postersDir, { recursive: true, force: true });
      }
    });
  } finally { srv.close(); }
});

browserTest('captureTourRrweb calls onStepSettled once per step, before the chapter marker/dwell', async () => {
  const srv = await serveFixture();
  try {
    const seen = [];
    const tour = {
      target: { url: srv.url },
      startPath: '/',
      pace: 0,
      readySelector: '[data-testid=home-view]',
      steps: [
        { id: 'welcome', label: 'Welcome', dwellMs: 50 },
        { id: 'go', label: 'Go', target: '[data-testid=go-btn]', dwellMs: 50, kind: 'action', advance: 'click-target' },
      ],
    };
    const { events, chapters } = await captureTourRrweb(tour, {
      pace: 0,
      onStepSettled: async (page, step, idx) => {
        seen.push({ id: step.id, idx, hasPage: typeof page.screenshot === 'function' });
      },
    });
    assert.ok(events.length > 2, 'events recorded');
    assert.equal(chapters.length, 2);
    assert.deepEqual(seen.map((s) => s.id), ['welcome', 'go']);
    assert.ok(seen.every((s) => s.hasPage), 'a real Puppeteer page was passed');
  } finally { srv.close(); }
});

browserTest('single-tour capture behavior is unchanged when onStepSettled is absent', async () => {
  const srv = await serveFixture();
  try {
    await withFramesDir(async (framesDir) => {
      const tour = {
        target: { url: srv.url },
        startPath: '/',
        pace: 0,
        readySelector: '[data-testid=home-view]',
        steps: [{ id: 'welcome', label: 'Welcome', dwellMs: 100 }],
      };
      // No onStepSettled at all — must not throw, same shape as before.
      const res = await captureTour(tour, framesDir, { pace: 0 });
      assert.equal(res.frameCount, 1);
      assert.equal(res.chapters.length, 1);
    });
  } finally { srv.close(); }
});

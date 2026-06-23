'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer');

const { launchOptions } = require('../../../src/browser');
const {
  handleApiRequest,
  rewriteViewerHtml,
} = require('../src/extension');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST = path.join(ROOT, 'dist');
const EXAMPLE = path.join(ROOT, 'examples', 'hello.json');
const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function fakeVscodeFor(origin) {
  return {
    Uri: {
      file(file) {
        return { fsPath: file };
      },
    },
  };
}

function fakeWebviewFor(origin) {
  return {
    asWebviewUri(uri) {
      const rel = path.relative(ROOT, uri.fsPath).split(path.sep).map(encodeURIComponent).join('/');
      return `${origin}/${rel}`;
    },
  };
}

function servePreview() {
  let origin = '';
  const vscode = fakeVscodeFor();
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      const webview = fakeWebviewFor(origin);
      let html = rewriteViewerHtml(fs.readFileSync(path.join(DIST, 'index.html'), 'utf8'), webview, vscode)
        .replace('acquireVsCodeApi()', 'window.__slideyAcquireVsCodeApi()');
      html = html.replace('<script>\n(() => {', `<script>
window.__slideyAcquireVsCodeApi = () => ({
  postMessage(message) {
    fetch('/__slidey_api__', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message)
    })
      .then((res) => res.json())
      .then((reply) => window.postMessage(reply, '*'));
  }
});
</script>
<script>
(() => {`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.url === '/__slidey_api__' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const result = handleApiRequest({
          root: ROOT,
          openFile: path.relative(ROOT, EXAMPLE).split(path.sep).join('/'),
          webview: fakeWebviewFor(origin),
          vscode,
        }, msg);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ type: 'slidey.response', id: msg.id, status: result.status, body: result.body }));
      });
      return;
    }
    const abs = path.resolve(ROOT, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (abs.startsWith(ROOT + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
      res.end(fs.readFileSync(abs));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      origin = `http://127.0.0.1:${port}`;
      resolve({ server, url: origin });
    });
  });
}

test('VS Code preview webview opens the real Slidey viewer and selected deck', async (t) => {
  assert.ok(fs.existsSync(path.join(DIST, 'index.html')), 'dist/index.html must exist; run npm run build:web first');

  const { server, url } = await servePreview();
  t.after(() => server.close());

  const browser = await puppeteer.launch(launchOptions({ width: 1440, height: 900 }));
  t.after(() => browser.close());

  const page = await browser.newPage();
  const events = [];
  page.on('console', (msg) => events.push(`console:${msg.type()}:${msg.text()}`));
  page.on('pageerror', (err) => events.push(`pageerror:${err.message}`));
  page.on('requestfailed', (req) => events.push(`requestfailed:${req.url()}:${req.failure() && req.failure().errorText}`));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  try {
    await page.waitForSelector('.slidey-sidebar', { timeout: 15000 });
    await page.waitForSelector('.slidey-hud', { timeout: 15000 });
  } catch (err) {
    const html = await page.evaluate(() => document.body.innerText);
    throw new Error(`${err.message}\n${events.join('\n')}\nbody:${html}`);
  }

  const state = await page.evaluate(() => ({
    hasAdapter: !!window.slidey,
    title: document.body.innerText,
    deckVisible: !!document.querySelector('.slidey-hud'),
  }));

  assert.equal(state.hasAdapter, true);
  assert.equal(state.deckVisible, true);
  assert.match(state.title, /Hello, Slidey|Slidey/);
  assert.match(state.title, /Declarative videos from a JSON spec/);
});

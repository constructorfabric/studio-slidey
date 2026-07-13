'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const { launchOptions } = require('../../../src/browser');
const { mkdtemp } = require('../../../src/temp-path');
const {
  handleApiRequest,
  handleOpenReference,
  handleSpecWrite,
  readSpec,
  writeSpecDocument,
  rewriteViewerHtml,
} = require('../src/extension');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST = path.join(ROOT, 'dist');
const EXAMPLE = path.join(ROOT, 'examples', 'hello.slidey.json');
const RRWEB_EXAMPLE = path.join(ROOT, 'examples', 'demos', 'sample-tour.rrweb.json');
const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

let puppeteer = null;

function loadPuppeteer(t) {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= 23) {
    t.skip('browser-backed VS Code preview e2e requires the package-supported Node range (<23)');
    return null;
  }
  if (!puppeteer) puppeteer = require('puppeteer');
  return puppeteer;
}

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

function relToRoot(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function writeRrweb(file) {
  const events = [
    { type: 4, data: { href: 'about:blank', width: 1280, height: 720 }, timestamp: 1 },
    { type: 2, data: { node: { type: 0, childNodes: [] }, initialOffset: { left: 0, top: 0 } }, timestamp: 2 },
  ];
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, events }), 'utf8');
}

function servePreview(openFile = relToRoot(EXAMPLE)) {
  let origin = '';
  const vscode = fakeVscodeFor();
  const openRequests = [];
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
        let result;
        if (msg.type === 'slidey.openReference') {
          openRequests.push(JSON.parse(msg.body || '{}'));
          result = { status: 200, body: { ok: true } };
        } else {
          result = handleApiRequest({
            root: ROOT,
            openFile,
            webview: fakeWebviewFor(origin),
            vscode,
          }, msg);
        }
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
      resolve({ server, url: origin, openRequests });
    });
  });
}

test('handleSpecWrite persists edited specs and rejects invalid payloads', async (t) => {
  const dir = mkdtemp('slidey-vscode-write-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const rel = 'deck.slidey.json';
  const abs = path.join(dir, rel);
  fs.writeFileSync(abs, JSON.stringify({ scenes: [{ type: 'narrative', body: 'old' }] }, null, 2) + '\n');

  // No real `vscode` API here → writeSpecDocument falls back to a plain disk write.
  const writeReq = (body) => ({ url: `/api/spec?path=${encodeURIComponent(rel)}`, method: 'POST', body });

  // Happy path: a valid spec is written back, pretty-printed, with a fresh mtime.
  const newSpec = { meta: { title: 'edited' }, scenes: [{ type: 'narrative', body: 'new' }] };
  const ok = await handleSpecWrite({ root: dir }, writeReq(JSON.stringify({ spec: newSpec })));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.ok(ok.body.mtimeMs > 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(abs, 'utf8')), newSpec);
  assert.ok(fs.readFileSync(abs, 'utf8').endsWith('\n'), 'spec file is newline-terminated');

  // Validation: missing scenes, bad shape, malformed JSON, unknown path all 4xx.
  assert.equal((await handleSpecWrite({ root: dir }, writeReq(JSON.stringify({ spec: { scenes: [] } })))).status, 400);
  assert.equal((await handleSpecWrite({ root: dir }, writeReq(JSON.stringify({ spec: [] })))).status, 400);
  assert.equal((await handleSpecWrite({ root: dir }, writeReq('{not json'))).status, 400);
  const missing = await handleSpecWrite({ root: dir }, { url: '/api/spec?path=nope.json', method: 'POST', body: '{}' });
  assert.equal(missing.status, 404);
});

test('writeSpecDocument routes through the VS Code editor model when available', async (t) => {
  const dir = mkdtemp('slidey-vscode-doc-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const abs = path.join(dir, 'deck.slidey.json');
  fs.writeFileSync(abs, 'STALE');

  // Minimal fake of the VS Code API surface writeSpecDocument relies on. It must
  // apply a WorkspaceEdit (full-range replace) and save() through to disk.
  const calls = { applied: false, saved: false };
  const fakeDoc = {
    uri: { fsPath: abs },
    lineCount: 1,
    getText: () => 'STALE',
    lineAt: () => ({ range: { end: { line: 0, character: 5 } } }),
    save: async () => { calls.saved = true; },
  };
  const vscode = {
    Uri: { file: (f) => ({ fsPath: f }) },
    Position: function (line, character) { this.line = line; this.character = character; },
    Range: function (start, end) { this.start = start; this.end = end; },
    WorkspaceEdit: function () { this.replace = (_uri, _range, text) => { this._text = text; }; },
    workspace: {
      textDocuments: [fakeDoc],
      openTextDocument: async () => fakeDoc,
      applyEdit: async (edit) => { calls.applied = true; fs.writeFileSync(abs, edit._text, 'utf8'); return true; },
    },
  };

  const spec = { scenes: [{ type: 'narrative', body: 'hi' }] };
  const mtimeMs = await writeSpecDocument(vscode, abs, spec);
  assert.ok(calls.applied, 'applied a WorkspaceEdit');
  assert.ok(calls.saved, 'saved the document');
  assert.ok(mtimeMs > 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(abs, 'utf8')), spec);
});

test('VS Code preview API treats raw rrweb logs as read-only replay decks', () => {
  const dir = mkdtemp('slidey-vscode-rrweb-');
  try {
    const rel = 'rrweb.json';
    const abs = path.join(dir, rel);
    writeRrweb(abs);

    const spec = readSpec(abs);
    assert.equal(spec.scenes[0].rrweb, rel);

    const got = handleApiRequest({ root: dir, openFile: rel }, { url: `/api/spec?path=${encodeURIComponent(rel)}`, method: 'GET' });
    assert.equal(got.status, 200);
    assert.equal(got.body.rrweb, true);
    assert.equal(got.body.editable, false);
    assert.equal(got.body.spec.scenes[0].type, 'video');
    assert.equal(got.body.spec.scenes[0].rrweb, rel);

    const clone = handleApiRequest({ root: dir, openFile: rel }, { url: `/api/clone-spec?path=${encodeURIComponent(rel)}`, method: 'POST', body: '{}' });
    assert.equal(clone.status, 200);
    assert.match(clone.body.path, /\.slidey\.json$/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, clone.body.path), 'utf8')).scenes[0].rrweb, rel);

    const plainRel = 'session.json';
    writeRrweb(path.join(dir, plainRel));
    const plain = handleApiRequest({ root: dir, openFile: plainRel }, { url: `/api/spec?path=${encodeURIComponent(plainRel)}`, method: 'GET' });
    assert.equal(plain.status, 200);
    assert.equal(plain.body.rrweb, true);
    assert.equal(plain.body.editable, false);
    assert.equal(plain.body.spec.scenes[0].rrweb, plainRel);
    const plainClone = handleApiRequest({ root: dir, openFile: plainRel }, { url: `/api/clone-spec?path=${encodeURIComponent(plainRel)}`, method: 'POST', body: '{}' });
    assert.equal(plainClone.status, 200);
    assert.equal(plainClone.body.path, 'session.slidey.json');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, plainClone.body.path), 'utf8')).scenes[0].rrweb, plainRel);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('VS Code preview API exposes the Edge TTS narration route', () => {
  const got = handleApiRequest({
    root: ROOT,
    openFile: path.relative(ROOT, EXAMPLE).split(path.sep).join('/'),
  }, {
    url: '/api/narration-audio',
    method: 'POST',
    body: JSON.stringify({ text: '' }),
  });
  assert.equal(got.status, 400);
  assert.match(got.body.error, /narration text is empty/);
});

test('handleOpenReference opens workspace files in VS Code and rejects escapes', async (t) => {
  const dir = mkdtemp('slidey-vscode-open-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const abs = path.join(dir, 'sample.js');
  const patchAbs = path.join(dir, 'change.patch');
  fs.writeFileSync(abs, 'one\ntwo\nthree\n', 'utf8');
  fs.writeFileSync(patchAbs, 'diff --git a/a b/a\n-old\n+new\n', 'utf8');

  const calls = { shown: null, opened: null };
  const fakeDoc = {
    uri: { fsPath: abs },
    lineCount: 3,
    lineAt: (line) => ({ range: { end: { line, character: ['one', 'two', 'three'][line].length } } }),
  };
  const vscode = {
    Uri: { file: (f) => ({ fsPath: f }) },
    ViewColumn: { Active: -1 },
    Position: function (line, character) { this.line = line; this.character = character; },
    Range: function (start, end) { this.start = start; this.end = end; },
    workspace: {
      openTextDocument: async (uri) => {
        if (uri.fsPath === abs) return fakeDoc;
        if (uri.fsPath === patchAbs) return { ...fakeDoc, uri, lineCount: 3 };
        throw new Error(`unexpected openTextDocument path: ${uri.fsPath}`);
      },
    },
    window: {
      showTextDocument: async (_doc, opts) => { calls.shown = opts; },
    },
    commands: {
      executeCommand: async (_cmd, uri) => { calls.opened = uri.fsPath; },
    },
  };

  const ok = await handleOpenReference({ root: dir, vscode }, {
    method: 'POST',
    url: '/api/open-reference',
    body: JSON.stringify({ src: 'sample.js', kind: 'code', lineStart: 2, lineEnd: 3 }),
  });
  assert.equal(ok.status, 200);
  assert.equal(calls.shown.selection.start.line, 1);
  assert.equal(calls.shown.selection.end.line, 2);
  assert.equal(calls.opened, null);

  calls.shown = null;
  const diff = await handleOpenReference({ root: dir, vscode }, {
    method: 'POST',
    url: '/api/open-reference',
    body: JSON.stringify({ src: 'change.patch', kind: 'diff' }),
  });
  assert.equal(diff.status, 200);
  assert.equal(calls.shown.preview, false);
  assert.equal(calls.opened, null);

  const outside = await handleOpenReference({ root: dir, vscode }, {
    method: 'POST',
    url: '/api/open-reference',
    body: JSON.stringify({ src: '../outside.js', kind: 'code' }),
  });
  assert.equal(outside.status, 404);
});

test('VS Code preview webview opens the real Slidey viewer and selected deck', async (t) => {
  assert.ok(fs.existsSync(path.join(DIST, 'index.html')), 'dist/index.html must exist; run npm run build:web first');

  const { server, url, openRequests } = await servePreview();
  t.after(() => server.close());

  const browserDriver = loadPuppeteer(t);
  if (!browserDriver) return;
  const browser = await browserDriver.launch(launchOptions({ width: 1440, height: 900 }));
  t.after(() => browser.close());

  const page = await browser.newPage();
  const events = [];
  page.on('console', (msg) => events.push(`console:${msg.type()}:${msg.text()}`));
  page.on('pageerror', (err) => events.push(`pageerror:${err.message}`));
  page.on('requestfailed', (req) => events.push(`requestfailed:${req.url()}:${req.failure() && req.failure().errorText}`));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  try {
    // The embedded preview renders the deck plus the floating reload button…
    await page.waitForSelector('.slidey-embedded-reload', { timeout: 15000 });
    await page.waitForSelector('.slidey-hud', { timeout: 15000 });
  } catch (err) {
    const html = await page.evaluate(() => document.body.innerText);
    throw new Error(`${err.message}\n${events.join('\n')}\nbody:${html}`);
  }

  const state = await page.evaluate(() => ({
    hasAdapter: !!window.slidey,
    title: document.body.innerText,
    deckVisible: !!document.querySelector('.slidey-hud'),
    // …and never the file-tree sidebar (it's a single-file preview).
    hasSidebar: !!document.querySelector('.slidey-sidebar'),
    hasReload: !!document.querySelector('.slidey-embedded-reload'),
  }));

  assert.equal(state.hasAdapter, true);
  assert.equal(state.deckVisible, true);
  assert.equal(state.hasSidebar, false, 'embedded preview must not show the file-tree sidebar');
  assert.equal(state.hasReload, true, 'embedded preview must show the reload button');
  assert.match(state.title, /Hello, Slidey|Slidey/);
  assert.match(state.title, /Declarative videos from a JSON spec/);

  const opened = await page.evaluate(() => {
    if (typeof window.slideyOpenReference !== 'function') return false;
    return window.slideyOpenReference({ src: 'examples/hello.slidey.json', kind: 'json', lineStart: 2 })
      .then(() => true);
  });
  assert.equal(opened, true, 'embedded preview exposes direct open-reference bridge');
  assert.deepEqual(openRequests, [{ src: 'examples/hello.slidey.json', kind: 'json', lineStart: 2 }]);
});

test('VS Code preview webview renders a raw rrweb replay without Slidey deck chrome', async (t) => {
  assert.ok(fs.existsSync(path.join(DIST, 'index.html')), 'dist/index.html must exist; run npm run build:web first');
  assert.ok(fs.existsSync(RRWEB_EXAMPLE), 'sample rrweb fixture must exist');

  const { server, url } = await servePreview(relToRoot(RRWEB_EXAMPLE));
  t.after(() => server.close());

  const browserDriver = loadPuppeteer(t);
  if (!browserDriver) return;
  const browser = await browserDriver.launch(launchOptions({ width: 1440, height: 900 }));
  t.after(() => browser.close());

  const page = await browser.newPage();
  const events = [];
  page.on('console', (msg) => events.push(`console:${msg.type()}:${msg.text()}`));
  page.on('pageerror', (err) => events.push(`pageerror:${err.message}`));
  page.on('requestfailed', (req) => events.push(`requestfailed:${req.url()}:${req.failure() && req.failure().errorText}`));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  try {
    await page.waitForSelector('.slidey-replay-viewer .rrp-host iframe', { timeout: 20000 });
  } catch (err) {
    const html = await page.evaluate(() => document.body.innerText);
    throw new Error(`${err.message}\n${events.join('\n')}\nbody:${html}`);
  }

  const state = await page.evaluate(() => ({
    hasReplay: !!document.querySelector('.rrp'),
    hasIframe: !!document.querySelector('.rrp-host iframe'),
    hasFallback: document.body.innerText.includes('No session replay captured.'),
    hasSidebar: !!document.querySelector('.slidey-sidebar'),
    hasHud: !!document.querySelector('.slidey-hud'),
    hasModeToggle: !!document.querySelector('.slidey-embedded-edit'),
    hasReload: !!document.querySelector('.slidey-embedded-reload'),
    directBox: (() => {
      const r = document.querySelector('.slidey-replay-viewer')?.getBoundingClientRect();
      return r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
    })(),
  }));

  assert.equal(state.hasReplay, true);
  assert.equal(state.hasIframe, true);
  assert.equal(state.hasFallback, false);
  assert.equal(state.hasSidebar, false);
  assert.equal(state.hasHud, false, 'raw replay preview must not show the Slidey scene HUD');
  assert.equal(state.hasModeToggle, false, 'raw replay preview must not show Edit/Present controls');
  assert.equal(state.hasReload, false, 'raw replay preview should leave only rrweb playback controls visible');
  assert.deepEqual(state.directBox, { top: 0, left: 0, width: 1440, height: 900 });
});

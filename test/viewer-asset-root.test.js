'use strict';

// Tests for the viewer's asset-root posture (mockup-demo-tooling-contract.md
// §3): safeResolveAsset()'s lexical + realpath containment in src/serve.js,
// and the `--root <dir>` CLI flag in src/index.js that widens the served
// workspace root past the spec's own folder. No network, no LLM.
//
//   node --test test/viewer-asset-root.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const { startViewer } = require('../src/serve');

const CLI = path.join(__dirname, '..', 'src', 'index.js');

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    }).on('error', reject);
  });
}

async function withViewer(opts, fn) {
  const port = 4900 + Math.floor(Math.random() * 400);
  const server = startViewer({ port, open: false, ...opts });
  await new Promise((r) => server.on('listening', r));
  const actualPort = server.address().port;
  try {
    await fn(actualPort);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// ── serve.js: safeResolveAsset via GET /workspace/<rel> ─────────────────

test('a symlink placed inside root, pointing outside root, still serves 200 (the gravytanker convention)', async () => {
  const outerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-root-outer-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-root-inner-'));
  try {
    fs.mkdirSync(path.join(outerDir, 'clips'));
    fs.writeFileSync(path.join(outerDir, 'clips', 'demo.rrweb.json'), '{"events":[]}');
    // The convention: a symlink INSIDE root pointing at a dir OUTSIDE root.
    fs.symlinkSync(path.join(outerDir, 'clips'), path.join(root, 'demo-clips'));

    await withViewer({ root }, async (port) => {
      const res = await request(port, '/workspace/demo-clips/demo.rrweb.json');
      assert.equal(res.status, 200);
      assert.match(res.body, /events/);
    });
  } finally {
    fs.rmSync(outerDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a literal "../" reference that escapes root (no symlink involved) 404s', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-root-parent-'));
  const root = path.join(parent, 'inner');
  fs.mkdirSync(root);
  try {
    fs.writeFileSync(path.join(parent, 'secret.txt'), 'nope');
    await withViewer({ root }, async (port) => {
      const res = await request(port, '/workspace/../secret.txt');
      assert.equal(res.status, 404);
    });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('widening root makes the same literal "../"-reachable file serve 200', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-root-widen-'));
  const inner = path.join(parent, 'inner');
  fs.mkdirSync(inner);
  try {
    fs.writeFileSync(path.join(parent, 'clip.rrweb.json'), '{"events":[1]}');
    // root = the WIDER parent this time — a request for "clip.rrweb.json" at
    // the parent level now resolves, whereas rooted at `inner` it 404s (case above).
    await withViewer({ root: parent }, async (port) => {
      const res = await request(port, '/workspace/clip.rrweb.json');
      assert.equal(res.status, 200);
      assert.match(res.body, /events/);
    });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('a request escaping even the widened root still 404s', async () => {
  const grandparent = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-root-escape-'));
  const root = path.join(grandparent, 'root');
  fs.mkdirSync(root);
  try {
    fs.writeFileSync(path.join(grandparent, 'outside.txt'), 'nope');
    await withViewer({ root }, async (port) => {
      const res = await request(port, '/workspace/../outside.txt');
      assert.equal(res.status, 404);
    });
  } finally {
    fs.rmSync(grandparent, { recursive: true, force: true });
  }
});

test('a directory (not a file) at the resolved path 404s rather than serving a directory listing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-root-dir-'));
  try {
    fs.mkdirSync(path.join(root, 'adir'));
    await withViewer({ root }, async (port) => {
      const res = await request(port, '/workspace/adir');
      assert.equal(res.status, 404);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── index.js CLI: `--root <dir>` widens the served workspace ────────────

function waitForViewerReady(child) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/\[slidey\] Viewer {2}: http:\/\/localhost:(\d+)\//);
      if (m) { child.stdout.off('data', onData); resolve(parseInt(m[1], 10)); }
    };
    child.stdout.on('data', onData);
    child.on('exit', (code) => reject(new Error(`viewer exited early (code ${code}): ${buf}`)));
    setTimeout(() => reject(new Error(`viewer did not start in time: ${buf}`)), 15000).unref();
  });
}

test('CLI --root widens the served root and re-anchors openFile under it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-cli-root-'));
  try {
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'deck.slidey.json'), JSON.stringify({
      scenes: [{ type: 'title', title: 'Hi' }],
    }));
    fs.writeFileSync(path.join(root, 'outer-asset.txt'), 'OUTER-ASSET');

    const port = 4900 + Math.floor(Math.random() * 400);
    const specPath = path.join(root, 'sub', 'deck.slidey.json');
    const child = spawn(process.execPath, [
      CLI, specPath, '--no-open', '--root', root, '--port', String(port),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    try {
      const actualPort = await waitForViewerReady(child);

      const cfg = await request(actualPort, '/api/config');
      const cfgJson = JSON.parse(cfg.body);
      assert.equal(path.resolve(cfgJson.root), path.resolve(root), 'served root widened to --root');
      assert.equal(cfgJson.openFile, 'sub/deck.slidey.json', 'openFile re-anchored under the wider root');

      // The spec loads under its root-relative path.
      const specRes = await request(actualPort, '/api/spec?path=sub%2Fdeck.slidey.json');
      assert.equal(specRes.status, 200);

      // An asset that lives at the ROOT level (a sibling of `sub/`, i.e. only
      // reachable because --root widened past the spec's own folder) serves.
      const assetRes = await request(actualPort, '/workspace/outer-asset.txt');
      assert.equal(assetRes.status, 200);
      assert.equal(assetRes.body, 'OUTER-ASSET');
    } finally {
      child.kill('SIGKILL');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

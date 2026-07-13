'use strict';

// Concurrent-edit safety: a save whose base version no longer matches disk must
// be reported as a conflict (resolvable OURS/THEIRS) instead of silently
// clobbering the other writer. Covers the shared version token, the MCP
// writeSpecFile precondition, and the /api/spec HTTP precondition.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { spawn } = require('child_process');

const { versionOf, versionOfFile } = require('../src/spec-version');
const { startViewer } = require('../src/serve');

const REPO_ROOT = path.join(__dirname, '..');

// Minimal stdio JSON-RPC client for the MCP server (mirrors test/mcp.test.js).
function startMcp(root) {
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'src', 'mcp.js'), '--root', root], {
    cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    out = Buffer.concat([out, chunk]);
    let lineEnd;
    while ((lineEnd = out.indexOf('\n')) !== -1) {
      const raw = out.slice(0, lineEnd).toString('utf8');
      out = out.slice(lineEnd + 1);
      if (!raw.trim()) continue;
      const msg = JSON.parse(raw);
      const entry = pending.get(msg.id);
      if (entry) { pending.delete(msg.id); entry.resolve(msg); }
    }
  });
  child.stderr.on('data', () => {});
  function send(method, params = {}) {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => { if (pending.delete(id)) reject(new Error(`timed out: ${method}`)); }, 5000).unref();
    });
  }
  return { child, send };
}

function tmpDeck(scenes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-concurrent-'));
  const abs = path.join(root, 'deck.slidey.json');
  fs.writeFileSync(abs, JSON.stringify({ scenes }, null, 2) + '\n');
  return { root, abs };
}

test('versionOf is content-addressed and stable', () => {
  assert.equal(versionOf('hello'), versionOf('hello'));
  assert.notEqual(versionOf('hello'), versionOf('hello!'));
  assert.equal(versionOf(Buffer.from('x')), versionOf('x'));
});

test('MCP slidey_write_spec rejects a stale baseVersion and force overwrites (OURS)', async (t) => {
  const { root } = tmpDeck([{ type: 'title', title: 'Orig' }]);
  const abs = path.join(root, 'deck.slidey.json');
  const mcp = startMcp(root);
  t.after(() => mcp.child.kill());

  await mcp.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });

  // Read → the AI now holds a base version.
  const read = await mcp.send('tools/call', { name: 'slidey_read_spec', arguments: { path: 'deck.slidey.json' } });
  const baseVersion = JSON.parse(read.result.content[0].text).version;
  assert.ok(baseVersion);

  // The human saves an edit out-of-band, moving the file ahead.
  fs.writeFileSync(abs, JSON.stringify({ scenes: [{ type: 'title', title: 'Human edit' }] }, null, 2) + '\n');

  // Writing the AI's spec against the stale base must be rejected as a conflict.
  const conflict = await mcp.send('tools/call', {
    name: 'slidey_write_spec',
    arguments: { path: 'deck.slidey.json', spec: { scenes: [{ type: 'title', title: 'AI edit' }] }, baseVersion },
  });
  assert.equal(conflict.result.isError, true);
  assert.match(conflict.result.content[0].text, /conflict/i);
  // The human's edit survives — nothing was clobbered.
  assert.equal(JSON.parse(fs.readFileSync(abs, 'utf8')).scenes[0].title, 'Human edit');

  // OURS: force:true overwrites.
  const forced = await mcp.send('tools/call', {
    name: 'slidey_write_spec',
    arguments: { path: 'deck.slidey.json', spec: { scenes: [{ type: 'title', title: 'AI edit' }] }, baseVersion, force: true },
  });
  assert.notEqual(forced.result.isError, true);
  assert.equal(JSON.parse(fs.readFileSync(abs, 'utf8')).scenes[0].title, 'AI edit');
});

function request(port, method, urlPath, body) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      { host: '127.0.0.1', port, method, path: urlPath, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : null }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function withViewer(root, fn) {
  // Pick a high port; startViewer auto-increments on EADDRINUSE.
  const port = 4500 + Math.floor(Math.random() * 400);
  const server = startViewer({ root, port, open: false });
  await new Promise((r) => server.on('listening', r));
  const actualPort = server.address().port;
  try {
    await fn(actualPort);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('POST /api/spec refuses a stale save and offers OURS/THEIRS resolution', async () => {
  const { root } = tmpDeck([{ type: 'title', title: 'Orig' }]);

  await withViewer(root, async (port) => {
    // Load: get the base version the editor would hold.
    const loaded = await request(port, 'GET', '/api/spec?path=deck.slidey.json');
    assert.equal(loaded.status, 200);
    const baseVersion = loaded.json.version;
    assert.ok(baseVersion, 'GET returns a content version');

    // A concurrent writer (the AI) changes the file out-of-band.
    fs.writeFileSync(
      path.join(root, 'deck.slidey.json'),
      JSON.stringify({ scenes: [{ type: 'title', title: 'AI edit' }] }, null, 2) + '\n',
    );

    // The editor saves against its now-stale base → 409 conflict carrying theirs.
    const conflict = await request(port, 'POST', '/api/spec?path=deck.slidey.json', {
      spec: { scenes: [{ type: 'title', title: 'Human edit' }] },
      baseVersion,
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.json.conflict, true);
    assert.equal(conflict.json.current.spec.scenes[0].title, 'AI edit');

    // THEIRS: the version the client would adopt matches the on-disk file.
    assert.equal(conflict.json.current.version, versionOfFile(path.join(root, 'deck.slidey.json')));

    // OURS: re-save with force overwrites and succeeds.
    const ours = await request(port, 'POST', '/api/spec?path=deck.slidey.json', {
      spec: { scenes: [{ type: 'title', title: 'Human edit' }] },
      baseVersion,
      force: true,
    });
    assert.equal(ours.status, 200);
    assert.equal(ours.json.ok, true);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, 'deck.slidey.json'), 'utf8')).scenes[0].title,
      'Human edit',
    );
    // The fresh version is returned so the editor can keep saving cleanly.
    assert.equal(ours.json.version, versionOfFile(path.join(root, 'deck.slidey.json')));
  });
});

test('POST /api/spec allows a matching-base save and an identical-content rewrite', async () => {
  const { root } = tmpDeck([{ type: 'title', title: 'Orig' }]);

  await withViewer(root, async (port) => {
    const loaded = await request(port, 'GET', '/api/spec?path=deck.slidey.json');
    const baseVersion = loaded.json.version;

    // Clean save against the matching base.
    const ok = await request(port, 'POST', '/api/spec?path=deck.slidey.json', {
      spec: { scenes: [{ type: 'title', title: 'Edited' }] },
      baseVersion,
    });
    assert.equal(ok.status, 200);

    // An identical-content save with a stale base is a no-op, not a conflict.
    const again = await request(port, 'POST', '/api/spec?path=deck.slidey.json', {
      spec: { scenes: [{ type: 'title', title: 'Edited' }] },
      baseVersion, // deliberately stale
    });
    assert.equal(again.status, 200, 'identical content must not conflict');
  });
});

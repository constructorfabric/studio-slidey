'use strict';

// MCP-level coverage for library-deck scene addressing: slidey_render_png /
// slidey_render_html accepting `scene` (id) + `deck`, slidey_check walking
// library.decks[] scenes, and slidey_contact_sheet accepting `deck`. See
// src/scene-address.js for the shared resolver these all go through.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');

function startServer(root, opts = {}) {
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'src', 'mcp.js'), '--root', root], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...(opts.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    out = Buffer.concat([out, chunk]);
    while (true) {
      const lineEnd = out.indexOf('\n');
      if (lineEnd === -1) return;
      const raw = out.slice(0, lineEnd).toString('utf8');
      out = out.slice(lineEnd + 1);
      if (!raw.trim()) continue;
      const message = JSON.parse(raw);
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        entry.resolve(message);
      }
    }
  });
  child.stderr.on('data', () => {});
  child.on('exit', (code, signal) => {
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.reject(new Error(`server exited while waiting for response ${id}: code=${code} signal=${signal}`));
    }
  });
  function send(method, params = {}, timeoutMs = 20000) {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`timed out waiting for ${method}`));
      }, timeoutMs).unref();
    });
  }
  return { child, send };
}

function librarySpec() {
  const narrowNode = { id: 'n', label: 'A rather long label that overflows', x: 0, y: 0, w: 40, h: 20 };
  return {
    meta: { title: 'Pillar deck', mode: 'pitch' },
    scenes: [
      { id: 'root-title', type: 'title', title: 'Root deck', subtitle: 'top level' },
    ],
    library: {
      title: 'Pillars',
      decks: [
        {
          id: 'pillar-a',
          title: 'Pillar A',
          deckType: 'hierarchy',
          scenes: [
            { id: 'a-title', type: 'title', title: 'Pillar A', subtitle: 'library deck' },
            { id: 'a-diagram', type: 'diagram-svg', title: 'A diagram', panels: [{ nodes: [narrowNode] }] },
          ],
        },
      ],
    },
  };
}

async function initServer(root) {
  const server = startServer(root);
  const init = await server.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  assert.ifError(init.error);
  return server;
}

test('slidey_render_png resolves a library-deck scene by id (with and without deck)', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-libscene-'));
  fs.writeFileSync(path.join(root, 'deck.slidey.json'), JSON.stringify(librarySpec(), null, 2) + '\n');
  const server = await initServer(root);
  t.after(() => server.child.kill());

  // Bare scene id, no deck — unambiguous, must resolve into the library deck.
  const byId = await server.send('tools/call', {
    name: 'slidey_render_png',
    arguments: { path: 'deck.slidey.json', scene: 'a-title' },
  }, 30000);
  assert.ifError(byId.error);
  assert.notEqual(byId.result.isError, true, byId.result.content[0] && byId.result.content[0].text);
  const byIdPayload = JSON.parse(byId.result.content[0].text);
  assert.equal(byIdPayload.deck, 'pillar-a');
  assert.ok(byId.result.content.some((c) => c.type === 'image'), 'expected a rendered image');

  // Same scene id, explicit deck — must resolve identically.
  const withDeck = await server.send('tools/call', {
    name: 'slidey_render_png',
    arguments: { path: 'deck.slidey.json', scene: 'a-title', deck: 'pillar-a' },
  }, 30000);
  assert.ifError(withDeck.error);
  assert.notEqual(withDeck.result.isError, true);

  // Legacy numeric sceneIndex with no deck still addresses the top-level scenes.
  const legacy = await server.send('tools/call', {
    name: 'slidey_render_png',
    arguments: { path: 'deck.slidey.json', sceneIndex: 0 },
  }, 30000);
  assert.ifError(legacy.error);
  const legacyPayload = JSON.parse(legacy.result.content[0].text);
  assert.equal(legacyPayload.deck, null);

  // Unknown scene id -> a real MCP tool error, not a crash.
  const missing = await server.send('tools/call', {
    name: 'slidey_render_png',
    arguments: { path: 'deck.slidey.json', scene: 'does-not-exist' },
  }, 30000);
  assert.ok(missing.error || missing.result.isError, 'unknown scene id should error');
});

test('compact read tools outline, retrieve, and search library-deck slides', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-compact-read-'));
  fs.writeFileSync(path.join(root, 'deck.slidey.json'), JSON.stringify(librarySpec(), null, 2) + '\n');
  const server = await initServer(root);
  t.after(() => server.child.kill());

  const overview = await server.send('tools/call', {
    name: 'slidey_deck_overview', arguments: { path: 'deck.slidey.json' },
  });
  assert.ifError(overview.error);
  const overviewPayload = JSON.parse(overview.result.content[0].text);
  assert.equal(overviewPayload.sceneCount, 1);
  assert.deepEqual(overviewPayload.scenes[0], {
    sceneIndex: 0, sceneId: 'root-title', deck: null, deckTitle: null,
    type: 'title', title: 'Root deck', subtitle: 'top level',
  });
  assert.deepEqual(overviewPayload.library.decks.map((deck) => deck.id), ['pillar-a']);

  const slide = await server.send('tools/call', {
    name: 'slidey_read_slide', arguments: { path: 'deck.slidey.json', scene: 'a-title' },
  });
  assert.ifError(slide.error);
  const slidePayload = JSON.parse(slide.result.content[0].text);
  assert.equal(slidePayload.deck, 'pillar-a');
  assert.deepEqual(slidePayload.slide, librarySpec().library.decks[0].scenes[0]);
  assert.equal(Object.hasOwn(slidePayload, 'spec'), false, 'single-slide read must not include the full spec');

  const search = await server.send('tools/call', {
    name: 'slidey_search_slides', arguments: { path: 'deck.slidey.json', query: 'library deck' },
  });
  assert.ifError(search.error);
  const searchPayload = JSON.parse(search.result.content[0].text);
  assert.equal(searchPayload.count, 1);
  assert.equal(searchPayload.matches[0].sceneId, 'a-title');
  assert.equal(searchPayload.matches[0].deck, 'pillar-a');
  assert.deepEqual(searchPayload.matches[0].matches, [{ field: 'subtitle', excerpt: 'library deck' }]);
});

test('slidey_check walks diagram-svg scenes inside library decks and labels the deck', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-libcheck-'));
  fs.writeFileSync(path.join(root, 'deck.slidey.json'), JSON.stringify(librarySpec(), null, 2) + '\n');
  const server = await initServer(root);
  t.after(() => server.child.kill());

  const res = await server.send('tools/call', {
    name: 'slidey_check',
    arguments: { path: 'deck.slidey.json' },
  });
  assert.ifError(res.error);
  const payload = JSON.parse(res.result.content[0].text);
  assert.ok(payload.violations > 0, 'the library-deck diagram should be flagged, not silently skipped');
  assert.match(payload.output, /library\.decks\["pillar-a"\]/);
});

test('slidey_contact_sheet accepts a deck param to capture a library deck\'s own scenes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-libsheet-'));
  fs.writeFileSync(path.join(root, 'deck.slidey.json'), JSON.stringify(librarySpec(), null, 2) + '\n');
  const server = await initServer(root);
  t.after(() => server.child.kill());

  const res = await server.send('tools/call', {
    name: 'slidey_contact_sheet',
    arguments: { path: 'deck.slidey.json', deck: 'pillar-a' },
  }, 30000);
  assert.ifError(res.error);
  assert.notEqual(res.result.isError, true, res.result.content[0] && res.result.content[0].text);
  const payload = JSON.parse(res.result.content[0].text);
  assert.equal(payload.deck, 'pillar-a');
  assert.equal(payload.captures.length, 2, 'pillar-a has 2 local scenes');
  assert.ok(payload.captures.every((c) => c.deck === 'pillar-a'));
});

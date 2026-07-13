'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');

function startMcpProcess(command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: opts.cwd || REPO_ROOT,
    env: { ...process.env, ...(opts.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return wrapMcpProcess(child, opts);
}

function startServer(root, opts = {}) {
  return startMcpProcess(process.execPath, [path.join(__dirname, '..', 'src', 'mcp.js'), '--root', root], {
    cwd: REPO_ROOT,
    env: opts.env,
    requestTransport: opts.requestTransport,
  });
}

function wrapMcpProcess(child, opts = {}) {
  let out = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  const requestTransport = opts.requestTransport || 'jsonl';
  const responseTransports = [];
  function resolveMessage(message, transport) {
    responseTransports.push(transport);
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      entry.resolve(message);
    }
  }
  child.stdout.on('data', (chunk) => {
    out = Buffer.concat([out, chunk]);
    while (true) {
      if (/^content-length:/i.test(out.slice(0, Math.min(out.length, 32)).toString('utf8'))) {
        const headerEnd = out.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = out.slice(0, headerEnd).toString('utf8');
        const match = header.match(/content-length:\s*(\d+)/i);
        if (!match) throw new Error(`malformed Content-Length header: ${header}`);
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (out.length < bodyStart + length) return;
        const raw = out.slice(bodyStart, bodyStart + length).toString('utf8');
        out = out.slice(bodyStart + length);
        if (!raw.trim()) continue;
        resolveMessage(JSON.parse(raw), 'framed');
        continue;
      }
      const lineEnd = out.indexOf('\n');
      if (lineEnd === -1) return;
      const raw = out.slice(0, lineEnd).toString('utf8');
      out = out.slice(lineEnd + 1);
      if (!raw.trim()) continue;
      resolveMessage(JSON.parse(raw), 'jsonl');
    }
  });
  child.stderr.on('data', () => {});
  child.on('exit', (code, signal) => {
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.reject(new Error(`server exited while waiting for response ${id}: code=${code} signal=${signal}`));
    }
  });

  function send(method, params = {}, timeoutMs = 5000) {
    const id = nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    if (requestTransport === 'framed') {
      child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
    } else {
      child.stdin.write(body + '\n');
    }
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`timed out waiting for ${method}`));
      }, timeoutMs).unref();
    });
  }

  return { child, send, responseTransports };
}

function readCodexSlideyConfig() {
  const configPath = path.join(REPO_ROOT, '.codex', 'config.toml');
  if (!fs.existsSync(configPath)) return null;
  const body = fs.readFileSync(configPath, 'utf8');
  const section = body.match(/\[mcp_servers\.slidey\]([\s\S]*?)(?:\n\[|$)/);
  assert.ok(section, 'missing [mcp_servers.slidey] in .codex/config.toml');
  const text = section[1];
  const command = (text.match(/^\s*command\s*=\s*"([^"]+)"/m) || [])[1];
  const cwd = (text.match(/^\s*cwd\s*=\s*"([^"]+)"/m) || [])[1];
  const argsBody = (text.match(/^\s*args\s*=\s*\[([^\]]*)\]/m) || [])[1];
  assert.ok(command, 'missing slidey MCP command');
  assert.ok(cwd, 'missing slidey MCP cwd');
  assert.ok(argsBody, 'missing slidey MCP args');
  const args = Array.from(argsBody.matchAll(/"([^"]*)"/g), (match) => match[1]);
  return { command, args, cwd };
}

function readProjectMcpConfig() {
  const configPath = path.join(REPO_ROOT, '.mcp.json');
  const doc = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const server = doc.mcpServers && doc.mcpServers.slidey;
  assert.ok(server, 'missing mcpServers.slidey in .mcp.json');
  assert.equal(typeof server.command, 'string', 'slidey MCP command must be a string');
  assert.ok(Array.isArray(server.args), 'slidey MCP args must be an array');
  assert.ok(!JSON.stringify(server).includes('/Users/brad/code/slidey'), 'slidey MCP config must not reference the old checkout path');
  return server;
}

test('MCP server exposes spec editing and validation over stdio', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-test-'));
  const specPath = path.join(root, 'deck.json');
  fs.writeFileSync(specPath, JSON.stringify({
    scenes: [
      { type: 'title', title: 'Before', subtitle: 'MCP' },
    ],
  }, null, 2) + '\n');

  const server = startServer(root);
  t.after(() => server.child.kill());

  const init = await server.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  assert.ifError(init.error);
  assert.equal(init.result.serverInfo.name, 'slidey-mcp');

  const tools = await server.send('tools/list');
  assert.ifError(tools.error);
  const names = tools.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('slidey_patch_spec'));
  assert.ok(names.includes('slidey_deck_overview'));
  assert.ok(names.includes('slidey_read_slide'));
  assert.ok(names.includes('slidey_search_slides'));
  assert.ok(names.includes('slidey_render_png'));
  assert.ok(names.includes('slidey_layout_gallery'));
  assert.ok(names.includes('slidey_add_slide'));
  assert.ok(names.includes('slidey_duplicate_slide'));
  assert.ok(names.includes('slidey_remove_slide'));
  assert.ok(names.includes('slidey_reorder_slide'));

  const patch = await server.send('tools/call', {
    name: 'slidey_patch_spec',
    arguments: {
      path: 'deck.json',
      operations: [
        { op: 'replace', path: '/scenes/0/title', value: 'After' },
      ],
    },
  });
  assert.ifError(patch.error);
  const patchPayload = JSON.parse(patch.result.content[0].text);
  assert.equal(patchPayload.ok, true);
  assert.equal(patchPayload.sceneCount, 1);

  const reread = await server.send('tools/call', {
    name: 'slidey_read_spec',
    arguments: { path: 'deck.json' },
  });
  assert.ifError(reread.error);
  const rereadPayload = JSON.parse(reread.result.content[0].text);
  assert.equal(rereadPayload.spec.scenes[0].title, 'After');

  const validate = await server.send('tools/call', {
    name: 'slidey_validate',
    arguments: { path: 'deck.json' },
  });
  assert.ifError(validate.error);
  const validation = JSON.parse(validate.result.content[0].text);
  assert.equal(validation.valid, true);

  const gallery = await server.send('tools/call', {
    name: 'slidey_layout_gallery',
    arguments: {},
  });
  assert.ifError(gallery.error);
  const galleryPayload = JSON.parse(gallery.result.content[0].text);
  assert.ok(Array.isArray(galleryPayload.layouts));
  assert.ok(galleryPayload.layouts.some((entry) => entry.id === 'title'));

  const escape = await server.send('tools/call', {
    name: 'slidey_read_spec',
    arguments: { path: '../deck.json' },
  });
  assert.ifError(escape.error);
  assert.equal(escape.result.isError, true);
  assert.match(escape.result.content[0].text, /escapes workspace root/);
});

test('MCP responds with JSON lines for JSON-line clients', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-jsonl-'));
  const server = startServer(root);
  t.after(() => server.child.kill());

  const init = await server.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  assert.ifError(init.error);
  assert.equal(init.result.serverInfo.name, 'slidey-mcp');
  assert.equal(server.responseTransports[0], 'jsonl');
});

test('MCP responds with Content-Length frames for framed clients', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-framed-'));
  const server = startServer(root, { requestTransport: 'framed' });
  t.after(() => server.child.kill());

  const init = await server.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  assert.ifError(init.error);
  assert.equal(init.result.serverInfo.name, 'slidey-mcp');
  assert.equal(server.responseTransports[0], 'framed');
});

test('MCP slide-management tools add, duplicate, reorder, and remove', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-slide-tools-'));
  const specPath = path.join(root, 'deck.json');
  fs.writeFileSync(specPath, JSON.stringify({
    scenes: [
      { type: 'title', title: 'A', subtitle: 'first' },
      { type: 'narrative', body: 'second' },
    ],
  }, null, 2) + '\n');

  const server = startServer(root);
  t.after(() => server.child.kill());

  const init = await server.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  assert.ifError(init.error);

  const add = await server.send('tools/call', {
    name: 'slidey_add_slide',
    arguments: {
      path: 'deck.json',
      layout: 'code-source',
      insertIndex: 1,
    },
  });
  assert.ifError(add.error);
  const addPayload = JSON.parse(add.result.content[0].text);
  assert.equal(addPayload.sceneIndex, 1);
  assert.equal(addPayload.sceneCount, 3);

  const duplicate = await server.send('tools/call', {
    name: 'slidey_duplicate_slide',
    arguments: {
      path: 'deck.json',
      sourceIndex: 0,
    },
  });
  assert.ifError(duplicate.error);
  const duplicatePayload = JSON.parse(duplicate.result.content[0].text);
  assert.equal(duplicatePayload.sceneIndex, 1);
  assert.equal(duplicatePayload.sceneCount, 4);

  const reorder = await server.send('tools/call', {
    name: 'slidey_reorder_slide',
    arguments: {
      path: 'deck.json',
      fromIndex: 2,
      toIndex: 0,
    },
  });
  assert.ifError(reorder.error);
  const reorderPayload = JSON.parse(reorder.result.content[0].text);
  assert.equal(reorderPayload.targetIndex, 0);
  assert.equal(reorderPayload.sceneCount, 4);

  const rereadAfterReorder = await server.send('tools/call', {
    name: 'slidey_read_spec',
    arguments: { path: 'deck.json' },
  });
  assert.ifError(rereadAfterReorder.error);
  const rereadAfterReorderPayload = JSON.parse(rereadAfterReorder.result.content[0].text);
  assert.equal(rereadAfterReorderPayload.spec.scenes[0].type, 'code');
  assert.equal(rereadAfterReorderPayload.spec.scenes.length, 4);

  const remove = await server.send('tools/call', {
    name: 'slidey_remove_slide',
    arguments: {
      path: 'deck.json',
      sceneIndex: 1,
    },
  });
  assert.ifError(remove.error);
  const removePayload = JSON.parse(remove.result.content[0].text);
  assert.equal(removePayload.sceneCount, 3);
});

test('MCP layout gallery includes project-local pack layouts', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-pack-'));
  fs.mkdirSync(path.join(root, '.slidey', 'packs'), { recursive: true });
  fs.writeFileSync(path.join(root, '.slidey', 'packs', 'local.json'), JSON.stringify({
    id: 'local-pack',
    layouts: [
      {
        id: 'local-proof',
        label: 'Local Proof',
        scene: { type: 'title', title: 'Local proof' },
      },
    ],
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'deck.slidey.json'), JSON.stringify({
    meta: { mode: 'pitch' },
    scenes: [{ type: 'title', title: 'Before' }],
  }, null, 2) + '\n');

  const server = startServer(root);
  t.after(() => server.child.kill());
  await server.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });

  const gallery = await server.send('tools/call', {
    name: 'slidey_layout_gallery',
    arguments: { path: 'deck.slidey.json' },
  });
  assert.ifError(gallery.error);
  const payload = JSON.parse(gallery.result.content[0].text);
  assert.ok(payload.layouts.some((entry) => entry.id === 'local-proof'));

  const add = await server.send('tools/call', {
    name: 'slidey_add_slide',
    arguments: { path: 'deck.slidey.json', layout: 'local-proof' },
  });
  assert.ifError(add.error);
  const addPayload = JSON.parse(add.result.content[0].text);
  assert.equal(addPayload.scene.title, 'Local proof');
});

test('MCP review workbench tools report graph and narration issues', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-review-'));
  fs.writeFileSync(path.join(root, 'deck.slidey.json'), JSON.stringify({
    meta: {
      title: 'Review workbench',
      mode: 'pitch',
      narration: { pronunciations: { Slidey: 'slide ee' } },
    },
    scenes: [
      {
        type: 'graph',
        title: 'Buyer diligence graph',
        nodes: [
          { id: 'buyer', label: 'Buyer', w: 180 },
          { id: 'security', label: 'Security questionnaire response', w: 180 },
          { id: 'roi', label: 'ROI' },
          { id: 'orphan', label: 'Unused branch' },
        ],
        edges: [
          { id: 'buyer-security', from: 'buyer', to: 'security', label: 'asks for' },
          { id: 'security-roi', from: 'security', to: 'roi', label: 'supports' },
          { id: 'missing-target', from: 'security', to: 'missing', label: 'broken' },
        ],
        path: [
          'buyer',
          { node: 'missing', edge: 'missing-target' },
        ],
        caption: 'Focus explains dense branches.',
      },
      { type: 'narrative', title: 'Close', body: 'Done', narration: 'Done' },
    ],
    library: {
      decks: [{
        id: 'detail',
        deckType: 'hierarchy',
        meta: { narration: { pronunciations: { Acme: 'ack mee' } } },
        scenes: [{ type: 'narrative', title: 'Detail', body: 'Acme', narration: 'Acme ships Slidey.' }],
        children: [{
          id: 'deep-detail',
          deckType: 'hierarchy',
          meta: { narration: { pronunciations: { rrweb: 'R R web' } } },
          scenes: [{ type: 'narrative', title: 'Deep detail', body: 'rrweb', narration: 'rrweb is replayed.' }],
        }],
      }],
    },
  }, null, 2) + '\n');

  const server = startServer(root);
  t.after(() => server.child.kill());
  await server.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });

  const tools = await server.send('tools/list');
  const names = tools.result.tools.map((tool) => tool.name);
  for (const name of ['slidey_review_deck', 'slidey_graph_audit', 'slidey_narration_plan', 'slidey_diff_deck', 'slidey_prepare_review_artifact']) {
    assert.ok(names.includes(name), `${name} should be listed`);
  }

  const graph = await server.send('tools/call', {
    name: 'slidey_graph_audit',
    arguments: { path: 'deck.slidey.json' },
  });
  assert.ifError(graph.error);
  const graphPayload = JSON.parse(graph.result.content[0].text);
  assert.equal(graphPayload.status, 'failed');
  assert.ok(graphPayload.scenes[0].issues.some((issue) => issue.kind === 'missing-edge-node'));
  assert.ok(graphPayload.scenes[0].issues.some((issue) => issue.kind === 'missing-focus-note'));
  assert.ok(graphPayload.scenes[0].issues.some((issue) => issue.suggestedPatch));

  const narration = await server.send('tools/call', {
    name: 'slidey_narration_plan',
    arguments: { path: 'deck.slidey.json' },
  });
  assert.ifError(narration.error);
  const narrationPayload = JSON.parse(narration.result.content[0].text);
  assert.equal(narrationPayload.status, 'needs_work');
  assert.ok(narrationPayload.issues.some((issue) => issue.kind === 'missing-graph-focus-note'));
  assert.deepEqual(narrationPayload.pronunciationMap, { Slidey: 'slide ee' });
  assert.equal(narrationPayload.summary.decks, 3);
  const detail = narrationPayload.decks.find((deck) => deck.id === 'detail');
  assert.deepEqual(detail.pronunciationMap, { Acme: 'ack mee' });
  assert.equal(detail.scenes[0].steps[0].spokenText, 'ack mee ships Slidey.');
  assert.deepEqual(detail.scenes[0].steps[0].appliedTerms, [{ term: 'Acme', spokenAs: 'ack mee' }]);
  const nested = narrationPayload.decks.find((deck) => deck.id === 'deep-detail');
  assert.deepEqual(nested.pronunciationMap, { rrweb: 'R R web' });
  assert.equal(nested.scenes[0].steps[0].spokenText, 'R R web is replayed.');

  const review = await server.send('tools/call', {
    name: 'slidey_review_deck',
    arguments: { path: 'deck.slidey.json', browserAudit: false },
  });
  assert.ifError(review.error);
  const reviewPayload = JSON.parse(review.result.content[0].text);
  assert.equal(reviewPayload.status, 'failed');
  assert.equal(reviewPayload.browserAudit, null);
  assert.ok(reviewPayload.summary.graphWarnings > 0);
});

// BUG G-3 regression: GraphScene.vue's edgeLabelOffset() computes a real,
// position-aware label offset whenever both of an edge's endpoints have a
// deterministic position (a grid col/row slot, or a pinned x/y) — the static
// audit used to warn "unanchored-edge-label" on every such edge anyway
// (36/36/38 pure-noise warnings on the real gravytanker fragment scenes).
// It should now warn only when at least one endpoint is left to a force
// layout, where the renderer really does have nothing to anchor to.
test('MCP graph audit only warns unanchored-edge-label when the renderer truly cannot anchor it', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-graph-audit-anchor-'));
  fs.writeFileSync(path.join(root, 'deck.slidey.json'), JSON.stringify({
    scenes: [
      {
        type: 'graph',
        title: 'Grid-positioned (heuristic can anchor)',
        layoutTemplate: 'lane-grid',
        grid: { columns: 2, rows: 2, x: 0, y: 0, width: 200, height: 200 },
        nodes: [
          { id: 'a', label: 'A', col: 1, row: 1 },
          { id: 'b', label: 'B', col: 2, row: 2 },
        ],
        edges: [{ id: 'a-b', from: 'a', to: 'b', label: 'no explicit offset' }],
      },
      {
        type: 'graph',
        title: 'Force layout (heuristic cannot anchor)',
        nodes: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
        edges: [{ id: 'x-y', from: 'x', to: 'y', label: 'no position at all' }],
      },
    ],
  }, null, 2) + '\n');

  const server = startServer(root);
  t.after(() => server.child.kill());
  await server.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });

  const res = await server.send('tools/call', {
    name: 'slidey_graph_audit',
    arguments: { path: 'deck.slidey.json' },
  });
  assert.ifError(res.error);
  const payload = JSON.parse(res.result.content[0].text);
  assert.ok(
    !payload.scenes[0].issues.some((issue) => issue.kind === 'unanchored-edge-label'),
    'grid-positioned edge should not be flagged: ' + JSON.stringify(payload.scenes[0].issues),
  );
  assert.ok(
    payload.scenes[1].issues.some((issue) => issue.kind === 'unanchored-edge-label'),
    'force-layout edge with no position info should still be flagged',
  );
});

// BUG G-4 regression: projection-mode graph scenes (scene.projection +
// scene.state) used to pass the static audit trivially even when the
// projection file was missing/unparsable or `state` wasn't a real key —
// the only guard was a runtime throw inside the browser renderer.
test('MCP graph audit statically validates projection-mode scenes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-graph-audit-projection-'));
  fs.writeFileSync(path.join(root, 'proj.json'), JSON.stringify({
    graphs: [{ id: 'g1', w: 100, h: 100, nodes: [{ id: 'a' }], edges: [] }],
    states: { good: { graph: 'g1', status: {} } },
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'deck.slidey.json'), JSON.stringify({
    scenes: [
      { type: 'graph', title: 'Good', projection: 'proj.json', state: 'good' },
      { type: 'graph', title: 'Bad state', projection: 'proj.json', state: 'nope' },
      { type: 'graph', title: 'Missing file', projection: 'missing.json', state: 'x' },
      { type: 'graph', title: 'No state', projection: 'proj.json' },
    ],
  }, null, 2) + '\n');

  const server = startServer(root);
  t.after(() => server.child.kill());
  await server.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });

  const res = await server.send('tools/call', {
    name: 'slidey_graph_audit',
    arguments: { path: 'deck.slidey.json' },
  });
  assert.ifError(res.error);
  const payload = JSON.parse(res.result.content[0].text);
  assert.equal(payload.status, 'failed');
  assert.deepEqual(payload.scenes[0].issues, []);
  assert.ok(payload.scenes[1].issues.some((issue) => issue.severity === 'error' && issue.kind === 'missing-projection-state'));
  assert.ok(payload.scenes[2].issues.some((issue) => issue.severity === 'error' && issue.kind === 'missing-projection-file'));
  assert.ok(payload.scenes[3].issues.some((issue) => issue.severity === 'warning' && issue.kind === 'missing-projection-state'));
});

test('MCP diff deck summarizes text and graph semantic changes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-diff-'));
  fs.writeFileSync(path.join(root, 'before.slidey.json'), JSON.stringify({
    scenes: [
      {
        type: 'graph',
        title: 'Before',
        nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        edges: [{ id: 'a-b', from: 'a', to: 'b' }],
        path: ['a'],
      },
    ],
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'after.slidey.json'), JSON.stringify({
    scenes: [
      {
        type: 'graph',
        title: 'After',
        nodes: [{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }],
        edges: [{ id: 'a-c', from: 'a', to: 'c' }],
        path: ['a', 'c'],
      },
      { type: 'title', title: 'New scene' },
    ],
  }, null, 2) + '\n');

  const server = startServer(root);
  t.after(() => server.child.kill());
  await server.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });

  const diff = await server.send('tools/call', {
    name: 'slidey_diff_deck',
    arguments: { beforePath: 'before.slidey.json', afterPath: 'after.slidey.json' },
  });
  assert.ifError(diff.error);
  const payload = JSON.parse(diff.result.content[0].text);
  assert.equal(payload.summary.changedScenes, 2);
  assert.ok(payload.scenes[0].changes.some((change) => change.field === 'title'));
  assert.ok(payload.scenes[0].changes.some((change) => change.field === 'graph.nodes'));
  assert.equal(payload.scenes[1].change, 'added');
});

test('MCP validates an ABSOLUTE spec path outside the workspace root', async (t) => {
  // Regression: safeResolve() previously did path.resolve(root, './' + input),
  // which mangled an absolute path into `<root>/abs/...` → "spec not found".
  // An explicit absolute path (e.g. a deck in another repo) must validate.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-root-'));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-elsewhere-'));
  const absSpec = path.join(elsewhere, 'outside.slidey.json');
  fs.writeFileSync(absSpec, JSON.stringify({
    scenes: [{ type: 'title', title: 'Outside', subtitle: 'absolute path' }],
  }, null, 2) + '\n');

  const server = startServer(root);
  t.after(() => server.child.kill());

  const init = await server.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  assert.ifError(init.error);

  const validate = await server.send('tools/call', {
    name: 'slidey_validate',
    arguments: { path: absSpec },
  });
  assert.ifError(validate.error);
  assert.notEqual(validate.result.isError, true, validate.result.content && validate.result.content[0] && validate.result.content[0].text);
  const validation = JSON.parse(validate.result.content[0].text);
  assert.equal(validation.valid, true);
});

test('MCP browser diagnostics return instead of hanging when Chrome cannot launch', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-browser-test-'));
  const server = startServer(root, {
    env: {
      SLIDEY_CHROME_PATH: path.join(root, 'missing-chrome'),
      SLIDEY_MCP_BROWSER_TIMEOUT_MS: '1000',
    },
  });
  t.after(() => server.child.kill());

  const init = await server.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  assert.ifError(init.error);

  const doctor = await server.send('tools/call', {
    name: 'slidey_doctor',
    arguments: { narration: false, ttsSample: false },
  });
  assert.ifError(doctor.error);
  const payload = JSON.parse(doctor.result.content[0].text);
  assert.equal(payload.ok, false);
  const browser = payload.checks.find((check) => check.id === 'browser');
  assert.ok(browser);
  assert.equal(browser.ok, false);
  assert.match(browser.detail, /missing-chrome|ENOENT|not found|executable/i);
});

test('Codex MCP config starts Slidey and lists tools', async (t) => {
  const config = readCodexSlideyConfig();
  if (!config) {
    t.skip('no local .codex/config.toml');
    return;
  }
  const server = startMcpProcess(config.command, config.args, { cwd: config.cwd });
  t.after(() => server.child.kill());

  const init = await server.send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'slidey-mcp-test', version: '0' },
  });
  assert.ifError(init.error);
  assert.equal(init.result.serverInfo.name, 'slidey-mcp');

  const tools = await server.send('tools/list');
  assert.ifError(tools.error);
  const names = tools.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('slidey_workspace_tree'));
  assert.ok(names.includes('slidey_doctor'));
});

test('project MCP config starts Slidey from the repo root', async (t) => {
  const config = readProjectMcpConfig();
  const server = startMcpProcess(config.command, config.args, { cwd: REPO_ROOT });
  t.after(() => server.child.kill());

  const init = await server.send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'slidey-project-mcp-test', version: '0' },
  });
  assert.ifError(init.error);
  assert.equal(init.result.serverInfo.name, 'slidey-mcp');

  const tools = await server.send('tools/list');
  assert.ifError(tools.error);
  const names = tools.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('slidey_workspace_tree'));
  assert.ok(names.includes('slidey_doctor'));
});

test('slidey_bundle produces a self-contained interactive deck over MCP', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-bundle-'));
  fs.writeFileSync(path.join(root, 'deck.slidey.json'), JSON.stringify({
    meta: { title: 'Bundle test', mode: 'pitch' },
    scenes: [
      { type: 'title', title: 'Hello', subtitle: 'self-contained' },
      { type: 'cta', wordmark: 'slidey', tagline: 'no CLI needed' },
    ],
  }, null, 2) + '\n');

  const server = startServer(root);
  t.after(() => server.child.kill());
  await server.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });

  // The render_png schema advertises the atSecond scrub control.
  const tools = await server.send('tools/list');
  const png = tools.result.tools.find((tl) => tl.name === 'slidey_render_png');
  assert.ok(png && png.inputSchema.properties.atSecond, 'render_png should expose atSecond');
  assert.ok(tools.result.tools.some((tl) => tl.name === 'slidey_bundle'), 'slidey_bundle should be listed');

  // Bundling a vite deck takes a few seconds; allow generous headroom.
  const res = await server.send('tools/call', {
    name: 'slidey_bundle',
    arguments: { path: 'deck.slidey.json', out: 'deck.html' },
  }, 120000);
  assert.ifError(res.error);
  const payload = JSON.parse(res.result.content[0].text);
  assert.equal(payload.selfContained, true);
  assert.equal(payload.bundled, 'deck.html');

  const html = fs.readFileSync(path.join(root, 'deck.html'), 'utf8');
  assert.ok(html.length > 100000, `bundle should inline assets (got ${html.length} bytes)`);
  assert.ok(html.includes('__SLIDEY_SPEC__'), 'bundle should embed the spec');
});

test('slidey_bundle refuses an invalid spec unless skipValidate', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-mcp-bundle-bad-'));
  // A table scene with raw-array rows + no variant is the classic won't-render case.
  fs.writeFileSync(path.join(root, 'bad.slidey.json'), JSON.stringify({
    meta: { title: 'Bad', mode: 'pitch' },
    scenes: [{ type: 'table', rows: [['a', 'b']] }],
  }, null, 2) + '\n');

  const server = startServer(root);
  t.after(() => server.child.kill());
  await server.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });

  const res = await server.send('tools/call', {
    name: 'slidey_bundle',
    arguments: { path: 'bad.slidey.json', out: 'bad.html' },
  }, 30000);
  // Invalid spec → tool error, no html written.
  assert.ok(res.error || (res.result && res.result.isError), 'invalid spec should not bundle');
  assert.ok(!fs.existsSync(path.join(root, 'bad.html')), 'no deck should be written for an invalid spec');
});

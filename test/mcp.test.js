'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function startServer(root) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'mcp.js'), '--root', root], {
    cwd: path.join(__dirname, '..'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    out = Buffer.concat([out, chunk]);
    while (true) {
      const headerEnd = out.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = out.slice(0, headerEnd).toString('utf8');
      const match = header.match(/content-length:\s*(\d+)/i);
      assert.ok(match, `missing Content-Length in ${header}`);
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (out.length < bodyStart + length) return;
      const message = JSON.parse(out.slice(bodyStart, bodyStart + length).toString('utf8'));
      out = out.slice(bodyStart + length);
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        entry.resolve(message);
      }
    }
  });
  child.stderr.on('data', () => {});

  function send(method, params = {}) {
    const id = nextId++;
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }), 'utf8');
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    child.stdin.write(body);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`timed out waiting for ${method}`));
      }, 5000).unref();
    });
  }

  return { child, send };
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
  assert.ok(names.includes('slidey_render_png'));

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
  assert.equal(patchPayload.spec.scenes[0].title, 'After');

  const validate = await server.send('tools/call', {
    name: 'slidey_validate',
    arguments: { path: 'deck.json' },
  });
  assert.ifError(validate.error);
  const validation = JSON.parse(validate.result.content[0].text);
  assert.equal(validation.valid, true);

  const escape = await server.send('tools/call', {
    name: 'slidey_read_spec',
    arguments: { path: '../deck.json' },
  });
  assert.ifError(escape.error);
  assert.equal(escape.result.isError, true);
  assert.match(escape.result.content[0].text, /escapes workspace root/);
});


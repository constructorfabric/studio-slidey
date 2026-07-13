'use strict';

// ensureRenderBundle() rebuilds dist-render via `npm run build:render` when
// web/ is newer than the bundle. Inside the MCP server, stdout is the
// JSON-RPC stream — the rebuild used stdio:'inherit', so npm/vite chatter
// landed on stdout and corrupted the protocol for line-oriented clients
// whenever a rebuild fired mid-serve (render_png, contact_sheet, audit, ...).
// These tests force a rebuild in a child process with a FAKE `npm` on PATH
// that spews stdout noise, and assert the parent-visible stdout stays clean
// (and that a failed build surfaces the captured output in the error).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(REPO_ROOT, 'dist-render', 'render.html');

// Child body: trigger ensureRenderBundle, then report over stdout as JSON —
// the ONLY stdout bytes an MCP-clean implementation may produce.
const CHILD_SCRIPT = `
  const rb = require(${JSON.stringify(path.join(REPO_ROOT, 'src', 'render-bundle.js'))});
  try {
    rb.ensureRenderBundle();
    process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, message: String(err.message) }) + '\\n');
  }
`;

function writeFakeNpm(dir, body) {
  const bin = path.join(dir, 'npm');
  fs.writeFileSync(bin, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return dir;
}

// Backdate the bundle so ensureRenderBundle sees it as stale, restoring the
// original timestamps afterwards. Skips when there is no built bundle to
// protect (the fake npm must never create a bogus empty one).
function withStaleBundle(t) {
  if (!fs.existsSync(BUNDLE)) {
    t.skip('dist-render/render.html not built; nothing to backdate safely');
    return false;
  }
  const st = fs.statSync(BUNDLE);
  t.after(() => { try { fs.utimesSync(BUNDLE, st.atime, st.mtime); } catch (_) { /* bundle replaced by a real rebuild */ } });
  fs.utimesSync(BUNDLE, st.atime, new Date('2000-01-01T00:00:00Z'));
  return true;
}

function runChild(fakeBinDir) {
  return spawnSync(process.execPath, ['-e', CHILD_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}` },
  });
}

test('a forced rebuild keeps stdout JSON-clean (build noise goes to stderr)', (t) => {
  if (!withStaleBundle(t)) return;
  const fakeBin = writeFakeNpm(fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-fake-npm-')), [
    'echo "npm noise that must not reach parent stdout"',
    'echo "vite v0.0.0 building for production..."',
    // "rebuild": freshen the existing bundle without changing its content.
    `touch ${JSON.stringify(BUNDLE)}`,
  ].join('\n'));

  const res = runChild(fakeBin);
  assert.equal(res.status, 0, res.stderr);
  const lines = res.stdout.split('\n').filter((line) => line.trim());
  assert.equal(lines.length, 1, `stdout must carry only the JSON sentinel, got:\n${res.stdout}`);
  const payload = JSON.parse(lines[0]);
  assert.equal(payload.ok, true);
  assert.match(res.stderr, /npm noise that must not reach parent stdout/, 'build stdout should be forwarded to stderr');
  assert.match(res.stderr, /rebuilding: npm run build:render/, 'the rebuild banner should go to stderr');
});

test('a failed rebuild surfaces the captured build output in the error, stdout still clean', (t) => {
  if (!withStaleBundle(t)) return;
  const fakeBin = writeFakeNpm(fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-fake-npm-fail-')), [
    'echo "the build exploded: fake diagnostic"',
    'exit 1',
  ].join('\n'));

  const res = runChild(fakeBin);
  assert.equal(res.status, 0, res.stderr);
  const lines = res.stdout.split('\n').filter((line) => line.trim());
  assert.equal(lines.length, 1, `stdout must carry only the JSON sentinel, got:\n${res.stdout}`);
  const payload = JSON.parse(lines[0]);
  assert.equal(payload.ok, false);
  assert.match(payload.message, /render bundle rebuild failed/);
  assert.match(payload.message, /the build exploded: fake diagnostic/, 'captured build output should ride on the error');
});

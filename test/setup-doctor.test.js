'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  checkCommand,
  checkNode,
  formatDoctorReport,
} = require('../src/setup-doctor');

test('checkNode reports the current Node runtime', () => {
  const check = checkNode();
  assert.equal(check.id, 'node');
  assert.equal(check.required, true);
  assert.equal(typeof check.ok, 'boolean');
  assert.match(check.detail, /^v\d+\./);
});

test('checkCommand reports a missing binary with install guidance', () => {
  const check = checkCommand({
    id: 'missing',
    label: 'missing command',
    command: 'definitely-not-a-slidey-command',
    args: ['--version'],
    install: 'install the missing command',
    requiredFor: 'the test',
  });

  assert.equal(check.ok, false);
  assert.equal(check.required, true);
  assert.match(check.detail, /not found on PATH|ENOENT/);
  assert.equal(check.install, 'install the missing command');
  assert.equal(check.requiredFor, 'the test');
});

test('formatDoctorReport distinguishes warnings from required failures', () => {
  const report = formatDoctorReport({
    ok: false,
    profile: 'narrated MP4 export',
    checks: [
      { label: 'node', ok: true, required: true, detail: 'v22.0.0' },
      {
        label: 'edge-tts CLI',
        ok: false,
        required: true,
        detail: 'edge-tts not found on PATH',
        install: 'pipx install edge-tts',
        requiredFor: 'narrated MP4 exports',
      },
      {
        label: 'headless render bundle',
        ok: false,
        required: false,
        detail: 'dist-render/render.html is missing',
        install: 'npm run build:render',
      },
    ],
  });

  assert.match(report, /\[ok\] node: v22\.0\.0/);
  assert.match(report, /\[fail\] edge-tts CLI: edge-tts not found on PATH/);
  assert.match(report, /fix: pipx install edge-tts/);
  assert.match(report, /\[warn\] headless render bundle: dist-render\/render\.html is missing/);
  assert.match(report, /setup is incomplete for narrated MP4 export/);
});

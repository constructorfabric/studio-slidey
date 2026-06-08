'use strict';

// Regression test for tools/visual-qa/scripts/extract-json.mjs — the balanced-
// brace JSON extractor that lets a chatty vision-QA reply still yield a verdict.
// The motivating bug: a reply whose prose preamble quotes a "{{host}}" template
// string used to make the extractor lock onto that brace, fail to parse, and
// give up — sinking the adversarial pass. It must skip past such braces and
// return the first span that actually JSON.parses.
//
//   node --test test/extract-json.test.js

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'tools', 'visual-qa', 'scripts', 'extract-json.mjs');
const run = input => spawnSync('node', [SCRIPT], { input, encoding: 'utf-8' });

test('skips a {{template}} brace in a prose preamble and returns the real JSON', () => {
  const input =
    'All findings confirmed.\n' +
    '- 00-01.png shows "Deploying to {{host}} with ${token}".\n\n' +
    '{"overall":"fail","findings":[{"check":"template-leak"}]}';
  const r = run(input);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { overall: 'fail', findings: [{ check: 'template-leak' }] });
});

test('strips ``` fences and surrounding prose', () => {
  const r = run('Here:\n```json\n{"a":1,"b":{"c":2}}\n```\ndone');
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { a: 1, b: { c: 2 } });
});

test('handles braces inside string values', () => {
  const r = run('{"x":"} not a close","y":[1,2]}');
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { x: '} not a close', y: [1, 2] });
});

test('exits non-zero when there is no JSON object', () => {
  assert.equal(run('no json here at all').status, 1);
});

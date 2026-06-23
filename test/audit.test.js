'use strict';

// Geometry-auditor test for src/audit.js — the deterministic half of the
// slidey-visual-qa skill. Drives the real render bundle in headless Chrome
// against two committed specs:
//   - examples/fixtures/broken-deck.json  (must FLAG known defects)
//   - examples/hello.slidey.json          (must stay CLEAN — no false positives)
//
// Browser-driven, so slower than the pure-data tests; still no LLM and fully
// deterministic. Requires dist-render/render.html (npm run build:render).
//
//   node --test test/audit.test.js

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { auditSpec } = require('../src/audit');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'dist-render', 'render.html');
const haveBundle = fs.existsSync(BUNDLE);

const load = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf-8'));
const checksIn = frames => new Set(frames.flatMap(f => f.findings.map(x => x.check)));

test('audit flags the known defects in the broken fixture', { skip: !haveBundle && 'run npm run build:render first' }, async () => {
  const spec = load('examples/fixtures/broken-deck.json');
  const { frames, summary } = await auditSpec(spec, {
    specPath: path.join(ROOT, 'examples/fixtures/broken-deck.json'),
  });

  assert.ok(summary.errors > 0, 'broken deck must produce error-severity findings');
  const checks = checksIn(frames);
  // The fixture is built to trip each of these deterministically.
  assert.ok(checks.has('template-leak'), 'should catch the unsubstituted {{host}}/${token}');
  assert.ok(checks.has('node-overlap'), 'should catch the overlapping diagram nodes');
  assert.ok(checks.has('off-viewbox'), 'should catch the node pushed outside the panel viewBox');

  // every finding cites a real frame in this run
  const frameNames = new Set(frames.map(f => f.frame));
  for (const f of frames) {
    for (const _ of f.findings) assert.ok(frameNames.has(f.frame));
  }
});

test('audit stays clean on a polished deck (no false positives)', { skip: !haveBundle && 'run npm run build:render first' }, async () => {
  const spec = load('examples/hello.slidey.json');
  const { summary } = await auditSpec(spec, { specPath: path.join(ROOT, 'examples/hello.slidey.json') });
  assert.equal(summary.errors, 0, 'hello.slidey.json must not trip any error-severity finding');
  assert.equal(summary.warnings, 0, 'hello.slidey.json must not trip any warning either');
});

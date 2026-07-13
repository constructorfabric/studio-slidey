'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { validateSpec } = require('../src/validate');
const { readSpecOrRrweb } = require('../src/rrweb-viewer');
const { resolveDeckSpec } = require('../src/collections');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'gx10-autonomy');
const DECK_PATH = path.join(FIXTURE_DIR, 'conformance.slidey.json');
const RRWEB_PATH = path.join(FIXTURE_DIR, 'gx10-autonomy.rrweb.json');

test('GX10 conformance fixture freezes opaque report data and direct rrweb evidence offline', () => {
  const spec = JSON.parse(fs.readFileSync(DECK_PATH, 'utf8'));
  assert.equal(validateSpec(spec, { specPath: DECK_PATH }).valid, true);
  assert.deepEqual(spec.meta.artifact, {
    id: 'gx10-autonomy-phase1-evidence',
    revision: '2026-07-13.r1',
    contentDigest: 'sha256:gx10-conformance-deck-r1',
    sourceDigest: 'sha256:gx10-source-r1',
    attemptDigest: 'sha256:gx10-attempt-r1',
  });
  assert.equal(spec.meta.report.costBasisUsd, '0.034225', 'decimal report data remains opaque text');
  assert.equal(readSpecOrRrweb(RRWEB_PATH).scenes[0].rrweb, 'gx10-autonomy.rrweb.json');
});

test('GX10 subset views retain their canonical source scene identity', () => {
  const spec = JSON.parse(fs.readFileSync(DECK_PATH, 'utf8'));
  const subset = resolveDeckSpec(spec, { deckId: 'review-subset' });
  assert.equal(subset.errors.length, 0);
  assert.deepEqual(subset.spec.scenes.map((scene) => scene._library && scene._library.sourceId), ['evidence-contract', 'rrweb-proof']);
  assert.deepEqual(subset.spec.scenes.map((scene) => scene._library && scene._library.sourceDeckId), ['__source', '__source']);
});

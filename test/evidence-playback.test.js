'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('evidence playback helper detects rrweb artifact refs', async () => {
  const {
    evidencePlaybackKind,
    evidencePlaybackRef,
    evidencePlaybackTitle,
    isEvidencePlayback,
    resolveEvidencePlaybackHref,
  } = await import('../web/evidencePlayback.mjs');

  const item = {
    label: 'web user session',
    refType: 'artifact',
    ref: 'clips/web-required-input.rrweb.json',
  };

  assert.equal(evidencePlaybackKind(item), 'rrweb');
  assert.equal(isEvidencePlayback(item), true);
  assert.equal(evidencePlaybackRef(item), 'clips/web-required-input.rrweb.json');
  assert.equal(evidencePlaybackTitle(item), 'web user session');
  assert.equal(
    resolveEvidencePlaybackHref(item.ref, 'http://localhost:4321/reports/deck.slidey.json'),
    'http://localhost:4321/reports/clips/web-required-input.rrweb.json',
  );
});

test('evidence playback helper leaves ordinary artifacts alone', async () => {
  const { evidencePlaybackKind, isEvidencePlayback } = await import('../web/evidencePlayback.mjs');

  assert.equal(evidencePlaybackKind({ refType: 'artifact', ref: 'report.md' }), '');
  assert.equal(isEvidencePlayback({ refType: 'log', ref: 'leg-1' }), false);
});

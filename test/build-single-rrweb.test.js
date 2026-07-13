// Guards that `slidey bundle` (build-single.mjs) inlines a video scene's rrweb
// DOM-session log as a data: URI, so a single-file deck plays the tour natively
// offline with no sibling *.rrweb.json fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('build-single inlines a video scene rrweb log as a data URI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slidey-rrweb-'));
  // A minimal but valid rrweb stream (Meta + FullSnapshot) keyed for the loader.
  const events = [
    { type: 4, data: { href: 'about:blank', width: 1280, height: 800 }, timestamp: 1 },
    { type: 2, data: { node: { type: 0, childNodes: [] }, initialOffset: { left: 0, top: 0 } }, timestamp: 2 },
  ];
  writeFileSync(join(dir, 'tour.rrweb.json'), JSON.stringify(events));
  const spec = {
    meta: { title: 't' },
    scenes: [
      { type: 'title', title: 'hi' },
      { type: 'video', rrweb: 'tour.rrweb.json', chapters: 'auto' },
    ],
  };
  writeFileSync(join(dir, 'deck.json'), JSON.stringify(spec));
  const out = join(dir, 'deck.html');
  const script = resolve(import.meta.dirname, '..', 'web', 'build-single.mjs');
  execFileSync(process.execPath, [script, join(dir, 'deck.json'), out], { stdio: 'pipe' });

  assert.ok(existsSync(out), 'bundle written');
  const html = readFileSync(out, 'utf8');
  assert.match(html, /data:application\/json;base64,/, 'rrweb embedded as data URI');
  assert.doesNotMatch(html, /tour\.rrweb\.json/, 'no leftover external rrweb reference');
});

test('build-single accepts a raw rrweb log as the input artifact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slidey-rrweb-raw-'));
  // A minimal but valid rrweb stream (Meta + FullSnapshot) keyed for the loader.
  const events = [
    { type: 4, data: { href: 'about:blank', width: 1280, height: 800 }, timestamp: 1 },
    { type: 2, data: { node: { type: 0, childNodes: [] }, initialOffset: { left: 0, top: 0 } }, timestamp: 2 },
  ];
  const rrweb = join(dir, 'tour.rrweb.json');
  writeFileSync(rrweb, JSON.stringify({ schemaVersion: 1, events }));
  writeFileSync(join(dir, 'tour.mp3'), 'fake mp3 bytes');
  const out = join(dir, 'tour.html');
  const script = resolve(import.meta.dirname, '..', 'web', 'build-single.mjs');
  execFileSync(process.execPath, [script, rrweb, out], { stdio: 'pipe' });

  assert.ok(existsSync(out), 'bundle written');
  const html = readFileSync(out, 'utf8');
  assert.match(html, /window\.__SLIDEY_SPEC__/, 'wrapper deck embedded');
  assert.match(html, /data:application\/json;base64,/, 'raw rrweb embedded as data URI');
  assert.match(html, /data:audio\/mpeg;base64,/, 'sibling audio embedded as data URI');
});

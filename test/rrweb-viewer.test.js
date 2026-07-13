'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { mkdtemp } = require('../src/temp-path');
const {
  isRrwebFile,
  isRrwebSourceFile,
  rrwebSpecForFile,
  readSpecOrRrweb,
} = require('../src/rrweb-viewer');

function writeRrweb(dir, name = 'tour.rrweb.json') {
  const file = path.join(dir, name);
  const events = [
    { type: 4, data: { href: 'about:blank', width: 1280, height: 720 }, timestamp: 1 },
    { type: 2, data: { node: { type: 0, childNodes: [] }, initialOffset: { left: 0, top: 0 } }, timestamp: 2 },
  ];
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, events }), 'utf8');
  return file;
}

test('raw rrweb log is exposed as a read-only one-scene deck', () => {
  const dir = mkdtemp('slidey-rrweb-viewer-');
  try {
    const file = writeRrweb(dir, 'agent-actions.rrweb.json');
    const spec = rrwebSpecForFile(file);
    assert.equal(spec.meta.title, 'agent actions');
    assert.equal(spec.scenes.length, 1);
    assert.equal(spec.scenes[0].type, 'video');
    assert.equal(spec.scenes[0].mode, 'fullscreen');
    assert.equal(spec.scenes[0].cinematic, false);
    assert.equal(spec.scenes[0].rrweb, 'agent-actions.rrweb.json');
    assert.equal(spec.scenes[0].chapters, 'auto');
    assert.equal(readSpecOrRrweb(file).scenes[0].rrweb, 'agent-actions.rrweb.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('exact rrweb.json names are treated as raw replay logs', () => {
  const dir = mkdtemp('slidey-rrweb-viewer-name-');
  try {
    const file = writeRrweb(dir, 'rrweb.json');
    fs.writeFileSync(path.join(dir, 'rrweb.mp3'), 'fake mp3 bytes', 'utf8');
    const spec = rrwebSpecForFile(file);
    assert.equal(isRrwebFile(file), true);
    assert.equal(isRrwebSourceFile(file), true);
    assert.equal(spec.meta.title, 'rrweb replay');
    assert.equal(spec.scenes[0].rrweb, 'rrweb.json');
    assert.equal(spec.scenes[0].audio, 'rrweb.mp3');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('replay-shaped plain json can be opened explicitly as rrweb', () => {
  const dir = mkdtemp('slidey-rrweb-viewer-plain-');
  try {
    const file = writeRrweb(dir, 'session.json');
    const spec = readSpecOrRrweb(file);
    assert.equal(isRrwebFile(file), false);
    assert.equal(isRrwebSourceFile(file), true);
    assert.equal(spec.meta.title, 'session');
    assert.equal(spec.scenes[0].rrweb, 'session.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('raw rrweb wrapper picks up a sibling audio file', () => {
  const dir = mkdtemp('slidey-rrweb-viewer-audio-');
  try {
    const file = writeRrweb(dir, 'tour.rrweb.json');
    fs.writeFileSync(path.join(dir, 'tour.mp3'), 'fake mp3 bytes', 'utf8');
    const spec = rrwebSpecForFile(file);
    assert.equal(spec.scenes[0].audio, 'tour.mp3');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rrweb wrapper rejects json without replay events', () => {
  const dir = mkdtemp('slidey-rrweb-viewer-bad-');
  try {
    const file = path.join(dir, 'bad.rrweb.json');
    fs.writeFileSync(file, JSON.stringify({ events: [] }), 'utf8');
    assert.throws(() => rrwebSpecForFile(file), /not an rrweb event log/);
    assert.throws(() => readSpecOrRrweb(file), /not an rrweb event log/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

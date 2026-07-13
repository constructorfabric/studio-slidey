'use strict';

// Hardens collections/hierarchy/subsets for the "deck-stack" use case: ONE
// master `.slidey.json` composing several CHILD decks stored as SIBLING
// files (relative paths), plus a named subset that selects specific slides
// ACROSS those children in a custom order, with its own narration/title
// overrides. Fixture: test/fixtures/deck-stack/{master,pog-deck,kitsoki-deck}
// .slidey.json — a permanent, realistic 3-file fixture (not synthesized
// inline) so both the resolver AND the real CLI/server are exercised
// against actual files on disk.
//
//   node --test test/collections-file-refs.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const { inlineChildDeckFiles, resolveDeckSpec, linksForScene } = require('../src/collections');
const { validateSpec } = require('../src/validate');
const { startViewer } = require('../src/serve');

const CLI = path.join(__dirname, '..', 'src', 'index.js');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'deck-stack');
const MASTER = path.join(FIXTURE_DIR, 'master.slidey.json');

function readMaster() {
  return JSON.parse(fs.readFileSync(MASTER, 'utf8'));
}

function inlinedMaster() {
  const { spec, errors } = inlineChildDeckFiles(readMaster(), { specPath: MASTER });
  assert.deepEqual(errors, [], 'fixture master should inline its child-deck files with no errors');
  return spec;
}

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    }).on('error', reject);
  });
}

async function withViewer(opts, fn) {
  const server = startViewer({ port: 0, open: false, ...opts });
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  try {
    await fn(port);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// ── inlineChildDeckFiles: the resolver, direct ──────────────────────────────

test('inlineChildDeckFiles pulls each child deck\'s scenes in from its own sibling file', () => {
  const spec = inlinedMaster();
  const decks = spec.library.decks;
  const pog = decks.find(d => d.id === 'pog');
  const kitsoki = decks.find(d => d.id === 'kitsoki');

  assert.equal(pog.deckType, 'hierarchy');
  assert.deepEqual(pog.scenes.map(s => s.id), ['pog-title', 'pog-detail', 'pog-arch']);
  assert.deepEqual(kitsoki.scenes.map(s => s.id), ['kit-title', 'kit-detail', 'kit-arch']);
});

test('a child deck file is a completely ordinary, independently-valid slidey spec', () => {
  for (const name of ['pog-deck.slidey.json', 'kitsoki-deck.slidey.json']) {
    const abs = path.join(FIXTURE_DIR, name);
    const spec = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const { valid, errors } = validateSpec(spec, { specPath: abs });
    assert.equal(valid, true, `${name} should validate standalone: ${(errors || []).join('; ')}`);
  }
});

test('resolveDeckSpec resolves a file-referenced hierarchy child exactly like an inline one', () => {
  const spec = inlinedMaster();
  const pog = resolveDeckSpec(spec, { deckId: 'pog' });
  assert.equal(pog.isCollection, true);
  assert.equal(pog.deck.deckType, 'hierarchy');
  assert.deepEqual(pog.spec.scenes.map(s => s.id), ['pog-title', 'pog-detail', 'pog-arch']);
  assert.equal(pog.spec.scenes[0]._library.deckLocal, true);
});

// ── the pitch cut: custom cross-deck order + per-scene overrides ───────────

test('the pitch-15min subset selects scenes across BOTH children in a bespoke order, not source order', () => {
  const resolved = resolveDeckSpec(inlinedMaster(), { deckId: 'pitch-15min' });
  assert.equal(resolved.errors.length, 0);
  assert.deepEqual(resolved.spec.scenes.map(s => s.id), [
    'root-intro', 'pog-title', 'pog-detail', 'kit-title', 'kit-detail', 'root-close',
  ]);
  // Provenance survives the cross-file pull.
  const pogDetail = resolved.spec.scenes.find(s => s.id === 'pog-detail');
  assert.equal(pogDetail._library.sourceDeckId, 'pog');
});

test('per-scene narration/title overrides on an explicit cross-deck ref apply on top of the file-loaded scene', () => {
  const resolved = resolveDeckSpec(inlinedMaster(), { deckId: 'pitch-15min' });
  const pogDetail = resolved.spec.scenes.find(s => s.id === 'pog-detail');
  const kitDetail = resolved.spec.scenes.find(s => s.id === 'kit-detail');

  assert.equal(pogDetail.eyebrow, 'POG, in one slide'); // overridden
  assert.match(pogDetail.narration, /Constructor Studio starts with POG/); // overridden
  assert.match(pogDetail.body, /Personas, capabilities/); // untouched, still from pog-deck.slidey.json

  assert.equal(kitDetail.eyebrow, 'Kitsoki, in one slide');
  assert.match(kitDetail.narration, /Kitsoki turns that roadmap/);
});

// ── validation over the whole stack ─────────────────────────────────────────

test('validateSpec accepts the fully-inlined master (source view and every named deck)', () => {
  const spec = inlinedMaster();
  for (const deckId of [undefined, 'pog', 'kitsoki', 'pitch-15min']) {
    const resolvedDeck = resolveDeckSpec(spec, { deckId });
    const result = validateSpec(resolvedDeck.spec, {
      specPath: MASTER,
      skipLibrary: resolvedDeck.isCollection && !resolvedDeck.isSource,
    });
    assert.equal(result.valid, true, `deck ${deckId || 'source'}: ${(result.errors || []).join('; ')}`);
  }
});

// ── viewer navigation: drill-down + return, across a file-loaded child ─────

test('drill-down and return links work across a file-loaded child deck (cards + parent back-link)', () => {
  const spec = inlinedMaster();
  const pog = resolveDeckSpec(spec, { deckId: 'pog' });
  const pogArch = pog.spec.scenes.find(s => s.id === 'pog-arch');
  const links = linksForScene(pogArch, pog);

  const toKitsoki = links.find(l => l.deck === 'kitsoki');
  assert.ok(toKitsoki, 'a card in the pog child deck should link forward into the kitsoki child deck');
  assert.equal(toKitsoki.section, 'kitsoki-architecture');

  const back = links.find(l => l.deck === '__source');
  assert.ok(back, 'the pog child deck should carry a back-link to the master/source deck');
});

// ── browser/node parity: the browser twin never touches the filesystem, so
//    parity only holds once the master is ALREADY flattened (as the server
//    always serves it) ──
test('the browser collections twin matches the node resolver once child files are inlined', async () => {
  const web = await import('../web/collections.mjs');
  const spec = inlinedMaster();
  for (const deckId of ['pog', 'kitsoki', 'pitch-15min']) {
    const nodeIds = resolveDeckSpec(spec, { deckId }).spec.scenes.map(s => s.id);
    const webIds = web.resolveDeckSpec(spec, { deckId }).spec.scenes.map(s => s.id);
    assert.deepEqual(webIds, nodeIds, `deck ${deckId}`);
  }
});

// ── negative cases: missing file, circular reference ────────────────────────

test('a missing child-deck file surfaces a specific error instead of resolving to zero scenes silently', () => {
  const spec = { library: { decks: [{ id: 'ghost', deckType: 'hierarchy', src: 'does-not-exist.slidey.json' }] } };
  const { errors } = inlineChildDeckFiles(spec, { specPath: MASTER });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /child deck file not found/);
});

test('a circular child-deck file reference is caught, not infinitely recursed', () => {
  const files = {
    '/a.slidey.json': JSON.stringify({ library: { decks: [{ id: 'b', src: 'b.slidey.json' }] } }),
    '/b.slidey.json': JSON.stringify({ library: { decks: [{ id: 'a', src: 'a.slidey.json' }] } }),
  };
  const { errors } = inlineChildDeckFiles(JSON.parse(files['/a.slidey.json']), {
    specPath: '/a.slidey.json',
    readFile: (p) => files[p],
    exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /circular child-deck reference/);
});

test('two sibling decks referencing the SAME child file is not mistaken for a cycle', () => {
  const files = {
    '/root.slidey.json': JSON.stringify({ library: { decks: [
      { id: 'leaf1', src: 'shared.slidey.json' },
      { id: 'leaf2', src: 'shared.slidey.json' },
    ] } }),
    '/shared.slidey.json': JSON.stringify({ scenes: [{ id: 's1', type: 'title', title: 'Shared' }] }),
  };
  const { spec, errors } = inlineChildDeckFiles(JSON.parse(files['/root.slidey.json']), {
    specPath: '/root.slidey.json',
    readFile: (p) => files[p],
    exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(spec.library.decks[0].scenes.map(s => s.id), ['s1']);
  assert.deepEqual(spec.library.decks[1].scenes.map(s => s.id), ['s1']);
});

// ── CLI end-to-end: validate, --list, --estimate --json, PNG render ────────

test('CLI validate succeeds for the master AND every named deck (source, both children, the pitch cut)', () => {
  for (const deckArgs of [[], ['--deck', 'pog'], ['--deck', 'kitsoki'], ['--deck', 'pitch-15min']]) {
    const stdout = execFileSync(process.execPath, [CLI, 'validate', MASTER, ...deckArgs], { encoding: 'utf8' });
    assert.match(stdout, /OK:/);
  }
});

test('CLI --list on the pitch-15min deck prints the bespoke cross-deck order', () => {
  const stdout = execFileSync(process.execPath, [CLI, MASTER, '--deck', 'pitch-15min', '--list'], { encoding: 'utf8' });
  const lines = stdout.split('\n').filter(l => /^\s*\d+\s/.test(l));
  assert.equal(lines.length, 6);
  assert.match(lines[0], /title/);
  assert.match(lines[2], /narrative/);
});

test('CLI --estimate --json produces a narration estimate over the subset with the overridden VO text', () => {
  const stdout = execFileSync(process.execPath, [CLI, MASTER, '--deck', 'pitch-15min', '--estimate', '--json'], { encoding: 'utf8' });
  const doc = JSON.parse(stdout);
  assert.equal(doc.scenes.length, 6);
  const narrationTexts = doc.scenes.flatMap(s => s.narration.map(n => n.text));
  assert.ok(narrationTexts.some(t => /Constructor Studio starts with POG/.test(t)));
  assert.ok(narrationTexts.some(t => /Kitsoki turns that roadmap/.test(t)));
});

test('CLI PNG render of the pitch-15min subset renders every scene, pulling frames from both child files', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-deck-stack-png-'));
  try {
    execFileSync(process.execPath, [CLI, MASTER, outDir, '--deck', 'pitch-15min'], { encoding: 'utf8' });
    const files = fs.readdirSync(outDir).filter(f => f.endsWith('.png'));
    // 6 scenes; narrative scenes with narration get >1 reveal step, so expect
    // at least one frame per scene index 00..05.
    for (const idx of ['00', '01', '02', '03', '04', '05']) {
      assert.ok(files.some(f => f.startsWith(idx)), `expected a frame for scene ${idx}, got: ${files.join(', ')}`);
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

// ── viewer server end-to-end: /api/tree + /api/spec across the hierarchy ──

test('viewer server: /api/tree nests the file-loaded children and the pitch subset under the master', async () => {
  await withViewer({ root: FIXTURE_DIR }, async (port) => {
    const { status, body } = await request(port, '/api/tree');
    assert.equal(status, 200);
    const tree = JSON.parse(body);
    const master = tree.children.find(n => n.path === 'master.slidey.json' && n.deckType === 'source');
    assert.ok(master, 'master.slidey.json should appear as a source deck node');
    const childIds = master.children.map(n => n.deckId).sort();
    assert.deepEqual(childIds, ['kitsoki', 'pitch-15min', 'pog']);
  });
});

test('viewer server: /api/spec serves the master with child-deck files ALREADY inlined (no client-side file fetch needed)', async () => {
  await withViewer({ root: FIXTURE_DIR }, async (port) => {
    const { status, body } = await request(port, '/api/spec?path=master.slidey.json');
    assert.equal(status, 200);
    const payload = JSON.parse(body);
    assert.equal(payload.libraryFileErrors, undefined);
    const pog = payload.spec.library.decks.find(d => d.id === 'pog');
    assert.deepEqual(pog.scenes.map(s => s.id), ['pog-title', 'pog-detail', 'pog-arch']);
  });
});

test('viewer server: a broken child-deck src surfaces libraryFileErrors instead of silently resolving to zero scenes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-broken-child-'));
  try {
    fs.writeFileSync(path.join(dir, 'broken.slidey.json'), JSON.stringify({
      meta: { title: 'Broken' },
      library: { decks: [{ id: 'ghost', deckType: 'hierarchy', src: 'missing.slidey.json' }] },
      scenes: [{ id: 'root', type: 'title', title: 'Root' }],
    }));
    await withViewer({ root: dir }, async (port) => {
      const { status, body } = await request(port, '/api/spec?path=broken.slidey.json');
      assert.equal(status, 200);
      const payload = JSON.parse(body);
      assert.ok(Array.isArray(payload.libraryFileErrors) && payload.libraryFileErrors.length === 1);
      assert.match(payload.libraryFileErrors[0], /child deck file not found/);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

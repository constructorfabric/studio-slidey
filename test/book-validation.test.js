'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateSpec } = require('../src/validate');

function spec(book) {
  return {
    meta: { mode: 'pitch' },
    scenes: [{ type: 'book', books: [book] }],
  };
}

test('book scenes require existing local covers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-book-validation-'));
  const specPath = path.join(dir, 'deck.json');
  const result = validateSpec(spec({
    title: 'Missing',
    authors: 'A. Author',
    cover: 'missing.jpg',
    takeaway: 'A useful point.',
  }), { specPath });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /cover not found: missing\.jpg/);
});

test('low-resolution book covers warn without failing the spec', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-book-validation-'));
  const cover = path.join(dir, 'tiny.png');
  const specPath = path.join(dir, 'deck.json');

  const png = Buffer.alloc(24);
  png[0] = 0x89;
  png.write('PNG', 1, 'ascii');
  png.writeUInt32BE(128, 16);
  png.writeUInt32BE(192, 20);
  fs.writeFileSync(cover, png);

  const result = validateSpec(spec({
    title: 'Tiny',
    authors: 'A. Author',
    cover: 'tiny.png',
    takeaway: 'A useful point.',
  }), { specPath });

  assert.equal(result.valid, true);
  assert.match(result.warnings.join('\n'), /low resolution \(128x192\)/);
});

test('meta.required_scenes catches missing promised scene counts', () => {
  const result = validateSpec({
    meta: { mode: 'pitch', required_scenes: [{ type: 'book', min: 3 }] },
    scenes: [
      {
        type: 'book',
        books: [{
          title: 'One',
          authors: 'A. Author',
          cover: 'data:image/png;base64,AAAA',
          takeaway: 'A useful point.',
        }],
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /requires at least 3 scene\(s\) of type "book"/);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { convertMarkdownFile, splitSlides, stripFrontMatter } = require('../src/markdown');
const { validateSpec } = require('../src/validate');

test('stripFrontMatter reads Marp metadata and removes it from body', () => {
  const input = [
    '---',
    'marp: true',
    'title: "Deck title"',
    '---',
    '',
    '# First',
  ].join('\n');
  const { meta, body } = stripFrontMatter(input);
  assert.equal(meta.marp, 'true');
  assert.equal(meta.title, 'Deck title');
  assert.match(body, /^# First/);
});

test('splitSlides uses Marp slide separators', () => {
  assert.deepEqual(splitSlides('# One\n\n---\n\n# Two'), ['# One', '# Two']);
});

test('convertMarkdownFile maps Marp slides to native Slidey scenes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-md-'));
  const input = path.join(dir, 'slides', 'deck.md');
  const output = path.join(dir, 'out', 'deck.json');
  fs.mkdirSync(path.dirname(input), { recursive: true });
  fs.writeFileSync(input, [
    '---',
    'marp: true',
    'title: "Demo"',
    '---',
    '<!-- _class: lead -->',
    '# Demo',
    '',
    'Subtitle',
    '---',
    '## Agenda',
    '- One',
    '- Two',
    '---',
    '## Diagram',
    '![w:800 h:550](../img/diagram.png)',
    '> caption',
    '---',
    '## Matrix',
    '| A | B |',
    '|---|---|',
    '| yes | no |',
    '---',
    '## Code',
    '```rust',
    'fn main() {}',
    '```',
  ].join('\n'), 'utf-8');

  const spec = convertMarkdownFile(input, output);
  assert.equal(spec.meta.source.kind, 'marp');
  assert.equal(spec.meta.source.path, undefined);
  assert.deepEqual(spec.scenes.map(s => s.type), ['title', 'cards', 'image', 'table', 'code']);
  assert.equal(spec.scenes[2].src, '../img/diagram.png');
  assert.equal(spec.scenes[4].lang, 'rust');

  const result = validateSpec(spec);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

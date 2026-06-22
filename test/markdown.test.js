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
  assert.equal(spec.meta.theme, undefined);
  assert.equal(spec.meta.source.path, undefined);
  assert.deepEqual(spec.scenes.map(s => s.type), ['title', 'cards', 'image', 'table', 'code']);
  assert.equal(spec.scenes[0].subtitle, 'Subtitle');
  assert.equal(spec.scenes[2].src, '../img/diagram.png');
  assert.equal(spec.scenes[4].lang, 'rust');

  const result = validateSpec(spec);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('convertMarkdownFile preserves wrapped bullets, placeholders, and captions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-md-'));
  const input = path.join(dir, 'deck.md');
  const output = path.join(dir, 'deck.json');
  fs.writeFileSync(input, [
    '---',
    'marp: true',
    '---',
    '## Details',
    '',
    'Intro paragraph.',
    '',
    '- Toolkit libraries for reusable platform building blocks — OData, canonical',
    '  errors, secure DB ORM, API middleware, security, and more',
    '- Versioned REST paths — endpoints must be `/<gear>/v1/...`',
    '',
    '> Quote text.',
    '---',
    '## Non-goals',
    '',
    '1. **Optimize for minimalism**',
    '   - Prioritizes explicit structure.',
    '2. **Replace cloud infrastructure**',
    '   - Not a ready PaaS.',
    '---',
    '## Documentation map',
    '',
    '- **Architecture Manifest** — `docs/ARCHITECTURE_MANIFEST.md`defining characteristics',
  ].join('\n'), 'utf-8');

  const spec = convertMarkdownFile(input, output);

  assert.equal(spec.scenes[0].cards[0].label, 'Toolkit libraries for reusable platform building blocks — OData, canonical errors, secure DB ORM, API middleware, security, and more');
  assert.equal(spec.scenes[0].variant, 'markdown');
  assert.equal(spec.scenes[0].cards[1].label, 'Versioned REST paths — endpoints must be /<gear>/v1/...');
  assert.equal(spec.scenes[0].cards[1].labelHtml, 'Versioned REST paths — endpoints must be <code>/&lt;gear&gt;/v1/...</code>');
  assert.equal(spec.scenes[0].intro, 'Intro paragraph.');
  assert.equal(spec.scenes[0].outro, 'Quote text.');
  assert.deepEqual(spec.scenes[1].cards[0], {
    label: 'Optimize for minimalism',
    labelHtml: '<strong>Optimize for minimalism</strong>',
    lines: ['Prioritizes explicit structure.'],
  });
  assert.equal(spec.scenes[2].cards[0].label, 'Architecture Manifest — docs/ARCHITECTURE_MANIFEST.md defining characteristics');
  assert.equal(spec.scenes[2].cards[0].labelHtml, '<strong>Architecture Manifest</strong> — <code>docs/ARCHITECTURE_MANIFEST.md</code> defining characteristics');
});

test('convertMarkdownFile keeps adjacent inline code spans separate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-md-'));
  const input = path.join(dir, 'deck.md');
  const output = path.join(dir, 'deck.json');
  fs.writeFileSync(input, [
    '---',
    'marp: true',
    '---',
    '## Errors',
    '',
    '- `NotFound`, `AlreadyExists`, `PermissionDenied`, `InvalidArgument`, `Unauthenticated`, ... (16 total)',
  ].join('\n'), 'utf-8');

  const spec = convertMarkdownFile(input, output);

  assert.equal(spec.scenes[0].cards[0].label, 'NotFound, AlreadyExists, PermissionDenied, InvalidArgument, Unauthenticated, ... (16 total)');
  assert.equal(spec.scenes[0].cards[0].labelHtml, '<code>NotFound</code>, <code>AlreadyExists</code>, <code>PermissionDenied</code>, <code>InvalidArgument</code>, <code>Unauthenticated</code>, ... (16 total)');
});

test('convertMarkdownFile preserves prose around code, tables, and overflow cards', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-md-'));
  const input = path.join(dir, 'deck.md');
  const output = path.join(dir, 'deck.json');
  fs.writeFileSync(input, [
    '---',
    'marp: true',
    '---',
    '## Lifecycle',
    '',
    'HostRuntime runs a shared, ordered phase sequence:',
    '',
    '```rust',
    'host.run().await?',
    '```',
    '',
    '- System gears run first where required',
    '- Shutdown runs in reverse dependency order',
    '',
    '> Cancellation tokens propagate so background work cooperates with shutdown',
    '---',
    '## FIPS',
    '',
    '| Area | Rule |',
    '|---|---|',
    '| TLS | rustls |',
    '',
    '- One rustls 0.23 state machine, pluggable CryptoProvider per OS',
    '- Offers only FIPS-approved suites',
    '',
    '> Fails closed on Windows when OS FIPS mode is off',
    '---',
    '## Capabilities',
    '',
    '- One',
    '- Two',
    '- Three',
    '- Four',
    '- Five',
    '- Six',
    '- Seven',
    '- Eight',
    '- Observability (tracing, OTel, request IDs, health)',
  ].join('\n'), 'utf-8');

  const spec = convertMarkdownFile(input, output);

  assert.equal(spec.scenes[0].type, 'code');
  assert.match(spec.scenes[0].caption, /HostRuntime runs a shared, ordered phase sequence/);
  assert.match(spec.scenes[0].caption, /System gears run first where required/);
  assert.match(spec.scenes[0].caption, /Cancellation tokens propagate/);

  assert.equal(spec.scenes[1].type, 'table');
  assert.match(spec.scenes[1].caption, /One rustls 0\.23 state machine/);
  assert.match(spec.scenes[1].caption, /Fails closed on Windows/);

  assert.equal(spec.scenes[2].cards.length, 8);
  assert.match(spec.scenes[2].outro, /Additional: Observability/);
});

test('convertMarkdownFile maps Mermaid fences to native diagram scenes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-md-'));
  const input = path.join(dir, 'deck.md');
  const output = path.join(dir, 'deck.json');
  fs.writeFileSync(input, [
    '---',
    'marp: true',
    '---',
    '## Request lifecycle',
    '',
    '```mermaid',
    'sequenceDiagram',
    '  participant Client',
    '  participant Gateway',
    '  Client->>Gateway: GET /health',
    '  Gateway-->>Client: 200 OK',
    '```',
    '',
    '> Rendered directly, not exported as a PNG.',
  ].join('\n'), 'utf-8');

  const spec = convertMarkdownFile(input, output);

  assert.equal(spec.scenes[0].type, 'mermaid');
  assert.equal(spec.scenes[0].title, 'Request lifecycle');
  assert.match(spec.scenes[0].source, /^sequenceDiagram/);
  assert.equal(spec.scenes[0].caption, 'Rendered directly, not exported as a PNG.');

  const result = validateSpec(spec);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('convertMarkdownFile preserves lead title support text as separate lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-md-'));
  const input = path.join(dir, 'deck.md');
  const output = path.join(dir, 'deck.json');
  fs.writeFileSync(input, [
    '---',
    'marp: true',
    '---',
    '<!-- _class: lead -->',
    '# Constructor Fabric Gears (Rust)',
    '',
    '### A secure, modular XaaS development framework & middleware',
    '',
    'By the **Cyber Fabric Foundation** · Apache-2.0',
    '',
    '*Composable building blocks · Defense-in-depth · Multi-tenancy · GenAI-ready*',
  ].join('\n'), 'utf-8');

  const spec = convertMarkdownFile(input, output);

  assert.equal(spec.scenes[0].type, 'title');
  assert.equal(spec.scenes[0].subtitle, [
    'A secure, modular XaaS development framework & middleware',
    'By the Cyber Fabric Foundation · Apache-2.0',
    'Composable building blocks · Defense-in-depth · Multi-tenancy · GenAI-ready',
  ].join('\n'));
  assert.equal(spec.scenes[0].subtitleHtml, [
    'A secure, modular XaaS development framework &amp; middleware',
    'By the <strong>Cyber Fabric Foundation</strong> · Apache-2.0',
    '<em>Composable building blocks · Defense-in-depth · Multi-tenancy · GenAI-ready</em>',
  ].join('<br>'));
});

test('convertMarkdownFile preserves Marp theme metadata for Slidey theming', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-md-'));
  const input = path.join(dir, 'deck.md');
  const output = path.join(dir, 'deck.json');
  fs.writeFileSync(input, [
    '---',
    'marp: true',
    'theme: rose-pine-moon',
    '---',
    '# Themed',
  ].join('\n'), 'utf-8');

  const spec = convertMarkdownFile(input, output);

  assert.equal(spec.meta.theme, 'rose-pine-moon');
  const result = validateSpec(spec);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

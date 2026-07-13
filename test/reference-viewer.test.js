'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('normalizeReferences accepts explicit scene references and infers viewers', async () => {
  const { normalizeReferences } = await import('../web/reference-viewer.js');

  const refs = normalizeReferences({
    type: 'cards',
    references: [
      'docs/notes.md',
      { path: 'src/index.js', label: 'CLI entry' },
      { href: 'demo.mp4', label: 'Demo' },
      { src: 'change.patch', label: 'Patch' },
    ],
  });

  assert.deepEqual(refs.map(ref => [ref.src, ref.label, ref.kind, ref.lang]), [
    ['docs/notes.md', 'notes.md', 'markdown', ''],
    ['src/index.js', 'CLI entry', 'code', 'javascript'],
    ['demo.mp4', 'Demo', 'video', ''],
    ['change.patch', 'Patch', 'diff', 'diff'],
  ]);
});

test('normalizeReferences adds scene media as automatic inspectable references', async () => {
  const { normalizeReferences } = await import('../web/reference-viewer.js');

  assert.deepEqual(
    normalizeReferences({
      type: 'image-compare',
      left: { label: 'Before', src: 'before.png' },
      right: { label: 'After', src: 'after.webp' },
    }).map(ref => ({ label: ref.label, kind: ref.kind, auto: ref.auto })),
    [
      { label: 'Before', kind: 'image', auto: true },
      { label: 'After', kind: 'image', auto: true },
    ],
  );
});

test('renderMarkdownHTML escapes raw HTML while keeping light markdown structure', async () => {
  const { renderMarkdownHTML } = await import('../web/reference-viewer.js');

  const html = renderMarkdownHTML('# Title\n\n- `safe`\n<script>alert(1)</script>');

  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<li><code>safe<\/code><\/li>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('renderTextHTML highlights code without allowing raw HTML through', async () => {
  const { renderTextHTML } = await import('../web/reference-viewer.js');

  const html = renderTextHTML('const x = "<tag>" // ok', 'code', 'javascript');

  assert.match(html, /<span class="slidey-ref-keyword">const<\/span>/);
  assert.match(html, /&lt;tag&gt;/);
  assert.match(html, /<span class="slidey-ref-comment">\/\/ ok<\/span>/);
});

test('renderTextHTML renders unified diffs with escaped line classes', async () => {
  const { renderTextHTML } = await import('../web/reference-viewer.js');

  const html = renderTextHTML('diff --git a/a b/a\n@@ -1 +1 @@\n-old <x>\n+new <y>', 'diff', 'diff');

  assert.match(html, /slidey-ref-diff-meta/);
  assert.match(html, /slidey-ref-diff-hunk/);
  assert.match(html, /slidey-ref-diff-del/);
  assert.match(html, /slidey-ref-diff-add/);
  assert.match(html, /&lt;x&gt;/);
  assert.match(html, /&lt;y&gt;/);
});

test('extractReferenceSnippet selects markdown sections and line ranges', async () => {
  const { extractReferenceSnippet } = await import('../web/reference-viewer.js');
  const text = '# Top\n\nintro\n\n## Target\n\n- keep\n- this\n\n## Next\n\nskip';

  assert.deepEqual(
    extractReferenceSnippet(text, { section: 'Target' }),
    { text: '## Target\n\n- keep\n- this\n', startLine: 5, endLine: 9 },
  );
  assert.deepEqual(
    extractReferenceSnippet('one\ntwo\nthree\nfour', { lines: [2, 3] }),
    { text: 'two\nthree', startLine: 2, endLine: 3 },
  );
});

test('renderNumberedTextHTML highlights linked line ranges', async () => {
  const { renderNumberedTextHTML } = await import('../web/reference-viewer.js');

  const html = renderNumberedTextHTML('const x = 1;\nreturn x;', 'code', 'javascript', { lineStart: 2, lineEnd: 2 });

  assert.match(html, /data-line="1"/);
  assert.match(html, /data-line="2"/);
  assert.match(html, /data-line="2"><span class="slidey-ref-lineno">2<\/span>/);
  assert.match(html, /slidey-ref-line is-highlighted/);
});

test('inferReferenceKind maps .html/.htm to the html (iframe) kind, distinct from code', async () => {
  const { inferReferenceKind } = await import('../web/reference-viewer.js');

  assert.equal(inferReferenceKind({ src: 'demo/mockup.html' }), 'html');
  assert.equal(inferReferenceKind({ src: 'demo/index.htm' }), 'html');
  assert.equal(inferReferenceKind({ src: 'src/App.js' }), 'code');
});

test('normalizeReference infers html kind for a plain .html path', async () => {
  const { normalizeReference } = await import('../web/reference-viewer.js');

  const ref = normalizeReference('demo/mockup.html');
  assert.equal(ref.kind, 'html');
  assert.equal(ref.src, 'demo/mockup.html');
});

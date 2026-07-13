'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  applyLocale,
  attachLocaleRef,
  extractLocale,
} = require('../src/localization');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

test('extractLocale captures only text replacements and preserves structure checks', () => {
  const base = {
    meta: { title: 'Demo', locale: 'en' },
    scenes: [
      { type: 'title', title: 'Hello', subtitle: 'Base deck' },
      { type: 'cards', title: 'Cards', cards: [{ label: 'One', lines: ['First'] }] },
    ],
  };
  const translated = {
    meta: { title: 'เดโม', locale: 'th' },
    scenes: [
      { type: 'title', title: 'สวัสดี', subtitle: 'เด็คฐาน' },
      { type: 'cards', title: 'การ์ด', cards: [{ label: 'หนึ่ง', lines: ['ข้อแรก'] }] },
    ],
  };

  const overlay = extractLocale(base, translated, { locale: 'th', sourceLocale: 'en' });

  assert.equal(overlay.locale, 'th');
  assert.deepEqual(overlay.generatedFrom.missing, []);
  assert.deepEqual(overlay.generatedFrom.extra, []);
  assert.equal(overlay.entries['/scenes/0/title'], 'สวัสดี');
  assert.equal(overlay.entries['/scenes/1/cards/0/lines/0'], 'ข้อแรก');
  assert.equal(overlay.entries['/scenes/0/type'], undefined);
});

test('applyLocale resolves an attached overlay and rejects stale source text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-locale-test-'));
  const basePath = path.join(dir, 'demo.slidey.json');
  const overlayPath = path.join(dir, '.slidey-locales', 'demo.th.slidey.locale.json');
  const base = {
    meta: { title: 'Demo', locale: 'en' },
    scenes: [{ type: 'title', title: 'Hello', narration: 'Hello narration' }],
  };
  const translated = {
    meta: { title: 'เดโม', locale: 'th' },
    scenes: [{ type: 'title', title: 'สวัสดี', narration: 'เสียงบรรยาย' }],
  };
  const overlay = extractLocale(base, translated, { locale: 'th', sourceLocale: 'en' });
  const attached = attachLocaleRef(base, 'th', '.slidey-locales/demo.th.slidey.locale.json');
  writeJson(basePath, attached);
  writeJson(overlayPath, overlay);

  const localized = applyLocale(attached, 'th', { specPath: basePath });
  assert.equal(localized.meta.locale, 'th');
  assert.equal(localized.meta.title, 'เดโม');
  assert.equal(localized.scenes[0].title, 'สวัสดี');

  const changed = JSON.parse(JSON.stringify(attached));
  changed.scenes[0].title = 'Hello again';
  assert.throws(
    () => applyLocale(changed, 'th', { specPath: basePath }),
    /stale/,
  );
});

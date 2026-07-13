'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('viewer accessibility helpers expose the deck language, title, and reveal position', async () => {
  const { documentLanguageForSpec, documentTitleForSpec, sceneAnnouncement } = await import('../web/accessibility.mjs');
  const spec = {
    meta: { locale: 'th-TH', title: 'แผนงาน' },
    scenes: [{ title: 'เริ่มต้น' }, { eyebrow: 'หลักฐาน' }],
  };

  assert.equal(documentLanguageForSpec(spec), 'th-TH');
  assert.equal(documentTitleForSpec(spec), 'แผนงาน — Slidey');
  assert.equal(sceneAnnouncement(spec, { sceneIndex: 1, stepIndex: 2, stepsInScene: 4 }),
    'Slide 2 of 2: หลักฐาน. Reveal 3 of 4.');
  assert.equal(documentLanguageForSpec({ meta: { locale: 'not a locale' } }), 'en');
});

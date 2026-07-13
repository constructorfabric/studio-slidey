'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  attachRuntimeThemePacks,
  loadThemePacks,
  stripRuntimeThemePacks,
} = require('../src/theme-packs');

test('loads built-in and project-local Slidey packs beside a spec', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-pack-'));
  fs.mkdirSync(path.join(root, '.slidey', 'packs'), { recursive: true });
  fs.writeFileSync(path.join(root, '.slidey', 'packs', 'project.json'), JSON.stringify({
    id: 'project-pack',
    themes: {
      project: {
        background: '#010203',
        colors: { base: '#010203', text: '#fefefe', accent: '#55ccaa' },
      },
    },
    layouts: [
      {
        id: 'project-title',
        label: 'Project Title',
        scene: { type: 'title', title: 'Project' },
      },
    ],
  }, null, 2));
  const specPath = path.join(root, 'deck.slidey.json');
  const spec = { meta: { title: 'Deck', theme: 'project' }, scenes: [{ type: 'title', title: 'A' }] };

  const packs = loadThemePacks(specPath, spec, { workspaceRoot: root });
  assert.ok(packs.some((pack) => pack.id === 'builtin-vscode'));
  assert.ok(packs.some((pack) => pack.id === 'project-pack'));

  const runtime = attachRuntimeThemePacks(spec, specPath, { workspaceRoot: root });
  assert.ok(Array.isArray(runtime.meta._themePacks));
  assert.ok(runtime.meta._themePacks.some((pack) => pack.layouts.some((layout) => layout.id === 'project-title')));

  const stripped = stripRuntimeThemePacks(runtime);
  assert.equal(stripped.meta._themePacks, undefined);
  assert.deepEqual(stripped.scenes, spec.scenes);
});

test('loads explicit inline and file pack references from meta.themePacks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-inline-pack-'));
  fs.writeFileSync(path.join(root, 'extra-pack.json'), JSON.stringify({
    id: 'extra-pack',
    themes: { extra: { colors: { base: '#111111', text: '#eeeeee' } } },
  }));
  const specPath = path.join(root, 'deck.slidey.json');
  const spec = {
    meta: {
      themePacks: [
        './extra-pack.json',
        {
          id: 'inline-pack',
          layouts: [{ id: 'inline-layout', scene: { type: 'narrative', body: 'Inline' } }],
        },
      ],
    },
    scenes: [{ type: 'title', title: 'A' }],
  };

  const packs = loadThemePacks(specPath, spec, { workspaceRoot: root });
  assert.ok(packs.some((pack) => pack.id === 'extra-pack'));
  assert.ok(packs.some((pack) => pack.id === 'inline-pack'));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { validateSpec } = require('../src/validate');
const TIMING = require('../src/timing');

function deck(scene) {
  return { meta: { mode: 'pitch' }, scenes: [scene] };
}

test('schema accepts a kitsoki-tui onboarding scene', () => {
  const r = validateSpec(deck({
    type: 'kitsoki-tui',
    title: 'kitsoki run',
    appTitle: 'kitsoki · project onboarding',
    subtitle: 'v1.2.0 · local setup story',
    hints: ['/help        list commands', '/world       inspect current state'],
    status: 'session sess_42... · story onboarding · state intro',
    choicePrompt: 'Start Kitsoki onboarding?',
    menuItems: [
      { label: 'Start onboarding', hint: 'discover project, then ask before writes' },
      { label: 'Review setup plan', hint: 'read-only preview' },
    ],
    selectedIndex: 0,
    footer: '[↑/↓ move • Enter pick • Tab chat • Esc cancel]',
    caption: 'A simplified first-run Kitsoki onboarding screen.',
  }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.valid, true);
});

test('schema rejects too many kitsoki-tui hint lines', () => {
  const r = validateSpec(deck({
    type: 'kitsoki-tui',
    hints: ['one', 'two', 'three', 'four', 'five', 'six'],
  }));
  assert.equal(r.valid, false);
});

test('schema rejects too many kitsoki-tui menu rows', () => {
  const r = validateSpec(deck({
    type: 'kitsoki-tui',
    menuItems: [
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
    ],
  }));
  assert.equal(r.valid, false);
});

test('kitsoki-tui reveal-step sequence matches the scene module', async () => {
  const { stepsForScene } = await import('../web/sceneSteps.mjs');
  assert.deepEqual(
    stepsForScene({ type: 'kitsoki-tui', caption: 'caption' }),
    ['kitsokitui_frame', 'kitsokitui_welcome', 'kitsokitui_menu', 'kitsokitui_caption'],
  );
  assert.deepEqual(
    stepsForScene({ type: 'kitsoki-tui' }),
    ['kitsokitui_frame', 'kitsokitui_welcome', 'kitsokitui_menu'],
  );
});

test('kitsoki-tui timing estimate stays in lock-step with reveal frames', () => {
  const scene = { type: 'kitsoki-tui', caption: 'caption' };
  assert.equal(
    TIMING.estimateScene(scene),
    TIMING.kitsokitui_frame +
      TIMING.kitsokitui_welcome +
      TIMING.kitsokitui_menu +
      TIMING.kitsokitui_caption +
      TIMING.kitsokitui_hold +
      TIMING.inter_scene,
  );

  assert.equal(TIMING.estimateScene({ type: 'kitsoki-tui' }, { noGaps: true }), TIMING.kitsokitui_hold);
});

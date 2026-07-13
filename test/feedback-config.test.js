'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { runtimeFeedbackConfig, appendLocalFeedback } = require('../src/feedback-config');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-feedback-'));
  fs.mkdirSync(path.join(root, '.slidey'));
  fs.writeFileSync(path.join(root, '.slidey', 'feedback.json'), JSON.stringify({
    publishing: { environments: { local: { sinks: ['upstream'] }, public: { sinks: ['upstream'] } } },
    sinks: { upstream: { label: 'Upstream GitHub', type: 'http', endpoint: 'https://feedback.example/upstream' } },
    local: { path: '.slidey/reports/feedback.jsonl' },
  }));
  return root;
}

test('local feedback config offers repo save plus configured sinks, and a local overlay can add an origin sink', () => {
  const root = workspace();
  try {
    fs.writeFileSync(path.join(root, '.slidey', 'feedback.local.json'), JSON.stringify({
      publishing: { environments: { local: { sinks: ['origin', 'upstream'] } } },
      sinks: { origin: { label: 'My fork', type: 'http', endpoint: 'https://feedback.example/origin' } },
    }));
    const local = runtimeFeedbackConfig(root);
    assert.deepEqual(local.sinks.map((sink) => sink.id), ['local', 'origin', 'upstream']);
    assert.equal(runtimeFeedbackConfig(root, { environment: 'public' }).sinks[0].id, 'upstream');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('appendLocalFeedback persists only reviewed bundles below the workspace', () => {
  const root = workspace();
  try {
    const file = appendLocalFeedback(root, { reviewed: true, idempotencyKey: 'fb-test', kind: 'bug' });
    assert.equal(file, '.slidey/reports/feedback.jsonl');
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /"idempotencyKey":"fb-test"/);
    assert.throws(() => appendLocalFeedback(root, { idempotencyKey: 'no-review' }), /reviewed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

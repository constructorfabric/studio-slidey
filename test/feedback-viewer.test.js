'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function stubWindow(overrides = {}) {
  global.window = {
    location: { origin: 'https://kitsoki-test.slothattax.me', pathname: '/constructor-studio/decks/kitsoki-pitch/', search: '' },
    innerWidth: 1512,
    innerHeight: 982,
    ...overrides,
  };
}

test('anchorFor strips the anchor url to origin+pathname (no query string) and labels/scopes from the current scene', async () => {
  stubWindow({ location: { origin: 'https://kitsoki-test.slothattax.me', pathname: '/constructor-studio/decks/kitsoki-pitch/', search: '?u=abc123' } });
  const { anchorFor } = await import('../web/feedback/slideyFeedback.js');
  const spec = { meta: { id: 'kitsoki-pitch' }, scenes: [{ title: 'Intro' }, { title: 'Why deterministic rendering', id: 'why-deterministic', type: 'narrative' }] };
  const deck = { state: { sceneIndex: 1, stepIndex: 2 } };
  const anchor = anchorFor(deck, spec, 'content_comment');
  assert.equal(anchor.producer, 'slidey');
  assert.equal(anchor.artifactId, 'kitsoki-pitch');
  assert.equal(anchor.scope, '1');
  assert.equal(anchor.step, '2');
  assert.equal(anchor.label, 'Why deterministic rendering');
  assert.equal(anchor.url, 'https://kitsoki-test.slothattax.me/constructor-studio/decks/kitsoki-pitch/');
  assert.deepEqual(anchor.extra, { sceneType: 'narrative', sceneId: 'why-deterministic' });
});

test('buildContext parses ?u= into context.viewerHash and omits it when absent (anonymous)', async () => {
  stubWindow();
  const { buildContext } = await import('../web/feedback/slideyFeedback.js');
  const withHash = buildContext({ search: '?u=9f2c41ab' });
  assert.equal(withHash.viewerHash, 'u_9f2c41ab');
  const anonymous = buildContext({ search: '' });
  assert.equal('viewerHash' in anonymous, false);
});

test('buildContext reads deck.version from window.__SLIDEY_DECK_VERSION__, null when unpublished (local dev)', async () => {
  stubWindow({ __SLIDEY_DECK_VERSION__: 'deck/kitsoki-pitch/v3' });
  const { buildContext } = await import('../web/feedback/slideyFeedback.js');
  assert.equal(buildContext({ search: '' }).deck.version, 'deck/kitsoki-pitch/v3');

  stubWindow();
  assert.equal(buildContext({ search: '' }).deck.version, null);
});

test('manifest/payload lockstep: a real anchorFor()+buildContext() draft passes privacy review, and an unclassified extra field blocks it', async () => {
  stubWindow({ __SLIDEY_DECK_VERSION__: 'deck/kitsoki-pitch/v3' });
  const { anchorFor, slideyPrivacyManifest, buildContext } = await import('../web/feedback/slideyFeedback.js');
  const { createDraft, setUserText, beginReview } = await import('../web/feedback/vendor/feedback-core/src/machine.mjs');

  const spec = { meta: { id: 'kitsoki-pitch' }, scenes: [{ title: 'Why deterministic rendering', id: 'why-deterministic', type: 'narrative' }] };
  const deck = { state: { sceneIndex: 0, stepIndex: 0 } };
  const manifest = slideyPrivacyManifest();
  const context = buildContext({ search: '?u=9f2c41ab' });

  const draft = createDraft('content_comment', anchorFor(deck, spec, 'content_comment'), { context });
  setUserText(draft, 'This slide undersells the PDF path.');
  const { verdict } = beginReview(draft, manifest);
  assert.equal(verdict.ok, true, `expected a passing verdict, got violations: ${JSON.stringify(verdict.violations)}`);

  // Regression guard: any field the manifest hasn't classified fails closed —
  // this is the "no PII creep" guarantee (no HAR, no rrweb, no screenshots).
  const leakyContext = { ...context, sessionReplayUrl: 'https://example.com/replay/abc' };
  const leakyDraft = createDraft('content_comment', anchorFor(deck, spec, 'content_comment'), { context: leakyContext });
  setUserText(leakyDraft, 'same text');
  const { verdict: blockedVerdict } = beginReview(leakyDraft, manifest);
  assert.equal(blockedVerdict.ok, false);
  assert.ok(blockedVerdict.violations.some((v) => v.path === 'context.sessionReplayUrl'));
});

test('feedbackKindGroups groups kinds by "the content" vs "the slidey app", presentation only', async () => {
  const { feedbackKindGroups } = await import('../web/feedback/slideyFeedback.js');
  const groups = feedbackKindGroups();
  const ids = groups.flatMap((g) => g.kinds.map((k) => k.id));
  assert.deepEqual(ids, ['content_comment', 'copy_feedback', 'question', 'bug', 'issue_request']);
});

test('feedbackRouter exposes named configured sinks and routes to the selected one', async () => {
  stubWindow({ __SLIDEY_FEEDBACK__: {
    sinks: [
      { id: 'local', label: 'Save in this repo', endpoint: '/api/feedback/local' },
      { id: 'origin', label: 'My fork', endpoint: 'https://example.test/origin' },
    ],
    selectedSink: 'origin',
  } });
  const { feedbackRouter, feedbackSinks } = await import('../web/feedback/slideyFeedback.js');
  const requests = [];
  const router = feedbackRouter({ fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return { ok: true, json: async () => ({ ref: 'origin-17' }) };
  } });
  const receipt = await router.submit({ reviewed: true, idempotencyKey: 'route-test' });
  assert.equal(receipt.sink, 'origin');
  assert.equal(requests[0].url, 'https://example.test/origin');
  assert.deepEqual(feedbackSinks().map((sink) => sink.id), ['local', 'origin']);
});

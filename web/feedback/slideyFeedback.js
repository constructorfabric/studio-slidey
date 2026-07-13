// slidey's producer adapter over the vendored feedback-core/feedback-vue
// (web/feedback/vendor/, refreshed by scripts/sync-feedback-core.sh). Owns
// exactly the slidey-specific shapes: what an anchor/context look like for a
// deck viewer, and which fields the privacy manifest classifies. Diagnostics
// are app-state only (deck/scene/step/viewer) — no HAR, no rrweb, no
// screenshots, no PII. See .context/feedback-e2e-plan.md.
import {
  createAnchor, createPrivacyManifest, createRouter, httpSink,
} from './vendor/feedback-core/src/index.mjs';

function currentScene(spec, state) {
  return spec && Array.isArray(spec.scenes) && state ? spec.scenes[state.sceneIndex] || null : null;
}

function sceneLabel(spec, scene) {
  return (scene && (scene.title || scene.heading || scene.label || scene.eyebrow))
    || (spec && spec.meta && (spec.meta.title || spec.meta.name))
    || '';
}

function originAndPath() {
  try {
    return `${window.location.origin}${window.location.pathname}`;
  } catch (_) {
    return '';
  }
}

/** Anchor for the deck's current scene/step. `deck` is the useDeck() instance. */
export function anchorFor(deck, spec, kind) {
  const state = deck && deck.state;
  const scene = currentScene(spec, state);
  return createAnchor({
    producer: 'slidey',
    artifactId: (spec && spec.meta && (spec.meta.id || spec.meta.slug)) || 'deck',
    scope: state ? String(state.sceneIndex) : '0',
    step: state ? String(state.stepIndex) : '0',
    label: sceneLabel(spec, scene),
    url: originAndPath(),
    extra: {
      sceneType: (scene && scene.type) || null,
      sceneId: (scene && (scene.id || scene.key)) || null,
    },
  });
}

/**
 * Classifies exactly the field paths slidey's anchor/context contract can
 * produce. Any field NOT listed here fails the fail-closed privacy review —
 * that's the "no PII creep" guarantee; see test/feedback-viewer.test.js for
 * the regression that keeps it honest.
 */
export function slideyPrivacyManifest() {
  return createPrivacyManifest({
    fields: {
      kind: 'public',
      'anchor.producer': 'public',
      'anchor.artifactId': 'public',
      'anchor.scope': 'public',
      'anchor.step': 'public',
      'anchor.label': 'public',
      'anchor.url': 'public',
      'anchor.extra.sceneType': 'public',
      'anchor.extra.sceneId': 'public',
      userText: 'user_provided',
      'context.viewerHash': 'high',
      'context.deck.version': 'low',
      'context.viewer.version': 'low',
      'context.viewer.mode': 'low',
      'context.viewer.viewport': 'low',
    },
    hostPolicies: {
      'context.viewerHash': 'allow',
    },
  });
}

/** Reads the personalization hash from a `?u=` query string, same parsing shape as initial-view.js. */
export function viewerHashFromSearch(search) {
  try {
    const qs = new URLSearchParams(search || '');
    const u = qs.get('u');
    return u ? String(u) : null;
  } catch (_) {
    return null;
  }
}

function viewerMode() {
  if (typeof window === 'undefined') return 'unknown';
  return window.__SLIDEY_SPEC__ ? 'single-file' : 'workspace';
}

function viewerVersion() {
  return (typeof window !== 'undefined' && window.__SLIDEY_VIEWER_VERSION__) || 'dev';
}

function deckVersion() {
  return (typeof window !== 'undefined' && window.__SLIDEY_DECK_VERSION__) || null;
}

function viewport() {
  if (typeof window === 'undefined') return '';
  return `${window.innerWidth}x${window.innerHeight}`;
}

/**
 * Builds the `context` field of the wire contract. `search` defaults to
 * window.location.search; pass it explicitly in tests.
 */
export function buildContext({ search } = {}) {
  const hash = viewerHashFromSearch(search !== undefined ? search : (typeof window !== 'undefined' ? window.location.search : ''));
  const context = {
    deck: { version: deckVersion() },
    viewer: {
      version: viewerVersion(),
      mode: viewerMode(),
      viewport: viewport(),
    },
  };
  if (hash) context.viewerHash = `u_${hash}`;
  return context;
}

/** Router posting reviewed bundles to the intake endpoint, overridable for dev/other hosts. */
export function feedbackRouter({ fetchImpl } = {}) {
  const configured = typeof window !== 'undefined' ? window.__SLIDEY_FEEDBACK__ : null;
  const configuredSinks = configured && Array.isArray(configured.sinks) ? configured.sinks : null;
  const sinks = configuredSinks && configuredSinks.length
    ? configuredSinks
    : [{ id: 'default', label: 'Send feedback', endpoint: (configured && configured.endpoint) || '/api/feedback' }];
  return createRouter({
    sinks: sinks.map((sink) => ({ ...httpSink({ url: sink.endpoint, fetch: fetchImpl || (typeof fetch !== 'undefined' ? fetch : undefined) }), id: sink.id })),
    route: () => (configured && configured.selectedSink) || sinks[0].id,
  });
}

export function feedbackSinks() {
  const configured = typeof window !== 'undefined' ? window.__SLIDEY_FEEDBACK__ : null;
  if (configured && Array.isArray(configured.sinks) && configured.sinks.length) return configured.sinks;
  return [{ id: 'default', label: 'Send feedback', endpoint: (configured && configured.endpoint) || '/api/feedback' }];
}

/** Kinds grouped by "what's this about?" — presentation only, same machine underneath. */
export function feedbackKindGroups() {
  return [
    {
      label: "The content",
      kinds: [
        { id: 'content_comment', label: 'Comment on this slide' },
        { id: 'copy_feedback', label: 'Suggest copy' },
        { id: 'question', label: 'Ask a question' },
      ],
    },
    {
      label: 'The slidey app',
      kinds: [
        { id: 'bug', label: 'Report a bug' },
        { id: 'issue_request', label: 'Suggest an improvement' },
      ],
    },
  ];
}

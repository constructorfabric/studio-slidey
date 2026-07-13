// Small, browser-independent helpers for the interactive viewer's accessibility
// contract. Keeping them here makes the deck metadata usable by both the Vue
// runtime and focused unit tests.

const LOCALE_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function documentLanguageForSpec(spec) {
  const locale = String(spec?.meta?.locale || '').trim();
  return LOCALE_TAG.test(locale) ? locale : 'en';
}

export function documentTitleForSpec(spec) {
  const title = String(spec?.meta?.title || '').trim();
  return title ? `${title} — Slidey` : 'Slidey';
}

export function sceneAnnouncement(spec, state) {
  const scenes = Array.isArray(spec?.scenes) ? spec.scenes : [];
  const sceneIndex = Math.max(0, Number(state?.sceneIndex) || 0);
  const scene = scenes[sceneIndex] || {};
  const title = String(scene.title || scene.eyebrow || '').trim();
  const total = Math.max(scenes.length, 1);
  const step = Math.max(0, Number(state?.stepIndex) || 0) + 1;
  const steps = Math.max(1, Number(state?.stepsInScene) || 1);
  return `Slide ${Math.min(sceneIndex + 1, total)} of ${total}${title ? `: ${title}` : ''}. Reveal ${step} of ${steps}.`;
}

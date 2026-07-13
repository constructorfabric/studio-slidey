export function evidencePlaybackKind(item) {
  const candidate = item || {};
  const kind = String(candidate.mediaKind || candidate.media_kind || candidate.playbackKind || '').toLowerCase();
  const refType = String(candidate.refType || candidate.ref_type || '').toLowerCase();
  const ref = String(candidate.ref || candidate.href || candidate.path || '').trim();
  if (kind === 'rrweb' || refType === 'rrweb') return 'rrweb';
  if (/\.rrweb\.json(?:[?#].*)?$/i.test(ref)) return 'rrweb';
  return '';
}

export function isEvidencePlayback(item) {
  return evidencePlaybackKind(item) === 'rrweb';
}

export function evidencePlaybackRef(item) {
  const candidate = item || {};
  return String(candidate.ref || candidate.href || candidate.path || '').trim();
}

export function evidencePlaybackTitle(item) {
  const candidate = item || {};
  return String(candidate.playbackTitle || candidate.title || candidate.label || 'Session replay');
}

export function resolveEvidencePlaybackHref(ref, baseUrl = '', fallbackUrl = '') {
  if (!ref) return '';
  if (/^data:/i.test(ref) || /^https?:\/\//i.test(ref)) return ref;
  try {
    return new URL(ref, baseUrl || fallbackUrl || (typeof window !== 'undefined' ? window.location.href : '')).href;
  } catch (_) {
    return ref;
  }
}

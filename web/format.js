// SLIDEY — shared formatting helpers
// Ported verbatim from src/template.html (escapeHTML / highlightJSON /
// renderBody / renderHeaders / statusClass) so the Vue render core produces
// byte-equivalent request/response markup. Returned HTML strings are injected
// via v-html in RequestScene.vue.

export function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function highlightJSON(text) {
  const escaped = escapeHTML(text);
  return escaped.replace(
    /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(true|false|null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match, key, str, kw, num) => {
      if (key !== undefined) return `<span class="json-key">${key}</span>:`;
      if (str !== undefined) return `<span class="json-string">${str}</span>`;
      if (kw  !== undefined) return `<span class="json-boolean">${kw}</span>`;
      if (num !== undefined) return `<span class="json-number">${num}</span>`;
      return match;
    }
  );
}

export function renderBody(text, contentType) {
  if (!text || text.trim() === '') {
    return '<span style="color:#484f58"><em>empty body</em></span>';
  }
  const ct = (contentType || '').toLowerCase();
  const looksLikeJSON = ct.includes('json') ||
    text.trim().startsWith('{') || text.trim().startsWith('[');
  if (looksLikeJSON) {
    try {
      return highlightJSON(JSON.stringify(JSON.parse(text), null, 2));
    } catch (_) { /* fall through */ }
  }
  const truncated = text.length > 1500 ? text.slice(0, 1500) + '\n…' : text;
  return escapeHTML(truncated);
}

export function renderHeadersHTML(headers) {
  return (headers || []).map(h =>
    `<div class="header-row">` +
    `<span class="header-name">${escapeHTML(h.name)}</span>` +
    `<span class="header-value">${escapeHTML(h.value)}</span>` +
    `</div>`
  ).join('');
}

export function statusClass(code) {
  if (code >= 200 && code < 300) return 'status-2xx';
  if (code >= 400 && code < 500) return 'status-4xx';
  if (code >= 500)               return 'status-5xx';
  return 'status-2xx';
}

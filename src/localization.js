'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_LOCALIZATION_DIR = '.slidey-locales';

const TEXT_KEYS = new Set([
  'title', 'subtitle', 'eyebrow', 'narration', 'body', 'lede', 'caption',
  'label', 'sub', 'detail', 'value', 'question', 'answer', 'winner',
  'author', 'role', 'app', 'session', 'callout', 'note', 'status',
]);

const HTML_TEXT_KEYS = new Set([
  'titleHtml', 'subtitleHtml', 'labelHtml', 'subHtml', 'bodyHtml', 'ledeHtml',
  'captionHtml', 'detailHtml',
]);

const TEXT_ARRAY_KEYS = new Set([
  'lines', 'bullets', 'columns', 'cells', 'flow', 'effects',
]);

const NON_TEXT_PATH_PARTS = new Set([
  'meta.theme.css', 'meta.theme.background', 'meta.theme.fontFamily',
  'meta.theme.colors', 'meta.context', 'meta.themePacks', 'meta.locales', 'meta.personas.id',
  'id', 'type', 'variant', 'style', 'icon', 'kind', 'lang', 'src', 'path',
  'href', 'gif', 'cover', 'avatar', 'sourceFile', 'sourceRef', 'reference',
  'ref', 'from', 'to', 'rankdir', 'side', 'mode', 'fit', 'rate', 'voice',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLocale(locale) {
  const out = String(locale || '').trim();
  if (!out || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(out)) {
    throw new Error(`invalid locale: ${locale || '(empty)'}`);
  }
  return out;
}

function pointer(parts) {
  return '/' + parts.map(part => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

function pointerParts(ptr) {
  if (ptr === '') return [];
  if (!ptr || ptr[0] !== '/') throw new Error(`invalid JSON pointer: ${ptr}`);
  return ptr.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function getAt(obj, ptr) {
  let cur = obj;
  for (const part of pointerParts(ptr)) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setAt(obj, ptr, value) {
  const parts = pointerParts(ptr);
  if (!parts.length) throw new Error('cannot replace the root object from a locale entry');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur == null || typeof cur !== 'object' || !(part in cur)) {
      throw new Error(`locale entry path does not exist in base deck: ${ptr}`);
    }
    cur = cur[part];
  }
  const key = parts[parts.length - 1];
  if (cur == null || typeof cur !== 'object' || !(key in cur)) {
    throw new Error(`locale entry path does not exist in base deck: ${ptr}`);
  }
  if (typeof cur[key] !== typeof value) {
    throw new Error(`locale entry type mismatch at ${ptr}: base is ${typeof cur[key]}, translation is ${typeof value}`);
  }
  cur[key] = value;
}

function pathMatches(parts, suffix) {
  const want = suffix.split('.');
  if (parts.length < want.length) return false;
  for (let i = 0; i < want.length; i++) {
    if (String(parts[parts.length - want.length + i]) !== want[i]) return false;
  }
  return true;
}

function isExcluded(parts) {
  if (parts[0] === 'meta' && parts[1] === 'locales') return true;
  return [...NON_TEXT_PATH_PARTS].some(suffix => pathMatches(parts, suffix));
}

function isTextPath(parts, value) {
  if (typeof value !== 'string') return false;
  if (isExcluded(parts)) return false;
  const key = String(parts[parts.length - 1] || '');
  if (TEXT_KEYS.has(key) || HTML_TEXT_KEYS.has(key)) return true;
  const parentKey = String(parts[parts.length - 2] || '');
  return TEXT_ARRAY_KEYS.has(parentKey);
}

function collectTextEntries(value, baseParts = [], out = new Map()) {
  if (typeof value === 'string') {
    if (isTextPath(baseParts, value)) out.set(pointer(baseParts), value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectTextEntries(item, baseParts.concat(i), out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => collectTextEntries(item, baseParts.concat(key), out));
  }
  return out;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableObject(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function hashJson(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(stableObject(value)))
    .digest('hex');
}

function localeRef(spec, locale) {
  const locales = spec && spec.meta && spec.meta.locales;
  if (!locales || typeof locales !== 'object') return null;
  const entry = locales[locale];
  if (!entry) return null;
  if (typeof entry === 'string') return { path: entry };
  if (typeof entry === 'object') return entry;
  return null;
}

function defaultLocalePath(specPath, locale) {
  const dir = path.dirname(specPath);
  const base = path.basename(specPath).replace(/\.slidey\.json$/i, '').replace(/\.json$/i, '');
  return path.join(dir, DEFAULT_LOCALIZATION_DIR, `${base}.${locale}.slidey.locale.json`);
}

function resolveLocalePath(specPath, locale, spec = null) {
  const ref = localeRef(spec, locale);
  const raw = ref && (ref.path || ref.file || ref.src);
  if (raw) return path.resolve(path.dirname(specPath), raw);
  return defaultLocalePath(specPath, locale);
}

function applyLocale(spec, locale, opts = {}) {
  const normalizedLocale = normalizeLocale(locale);
  const specPath = opts.specPath || process.cwd();
  const overlayPath = opts.overlayPath || resolveLocalePath(specPath, normalizedLocale, spec);
  if (!fs.existsSync(overlayPath)) {
    throw new Error(`locale overlay not found for "${normalizedLocale}": ${overlayPath}`);
  }
  let overlay;
  try {
    overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
  } catch (err) {
    throw new Error(`failed to parse locale overlay ${overlayPath}: ${err.message}`);
  }
  const entries = overlay.entries || overlay.translations;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new Error(`locale overlay ${overlayPath} must contain an object "entries" map`);
  }
  const expectedHash = overlay.generatedFrom && overlay.generatedFrom.sourceTextHash;
  if (expectedHash && opts.allowStale !== true) {
    const currentHash = hashJson(Object.fromEntries(collectTextEntries(spec)));
    if (currentHash !== expectedHash) {
      throw new Error(`locale overlay "${normalizedLocale}" is stale for this deck (source text hash changed)`);
    }
  }
  const out = clone(spec);
  for (const [ptr, text] of Object.entries(entries)) {
    setAt(out, ptr, text);
  }
  out.meta = out.meta || {};
  out.meta.locale = normalizedLocale;
  out.meta.localization = {
    source: path.relative(path.dirname(specPath), overlayPath).replace(/\\/g, '/'),
    generatedFrom: overlay.generatedFrom || null,
  };
  return out;
}

function readDeck(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function extractLocale(baseSpec, translatedSpec, opts = {}) {
  const locale = normalizeLocale(opts.locale || (translatedSpec.meta && translatedSpec.meta.locale) || 'translated');
  const sourceLocale = opts.sourceLocale || (baseSpec.meta && baseSpec.meta.locale) || 'source';
  const baseEntries = collectTextEntries(baseSpec);
  const translatedEntries = collectTextEntries(translatedSpec);
  const entries = {};
  const missing = [];
  const extra = [];
  for (const [ptr, baseText] of baseEntries.entries()) {
    if (!translatedEntries.has(ptr)) {
      missing.push(ptr);
      continue;
    }
    const translatedText = translatedEntries.get(ptr);
    if (translatedText !== baseText) entries[ptr] = translatedText;
  }
  for (const ptr of translatedEntries.keys()) {
    if (!baseEntries.has(ptr)) extra.push(ptr);
  }
  return {
    locale,
    sourceLocale,
    generator: 'slidey localize extract',
    generatedAt: new Date(0).toISOString(),
    generatedFrom: {
      baseTitle: baseSpec.meta && baseSpec.meta.title || null,
      translatedTitle: translatedSpec.meta && translatedSpec.meta.title || null,
      sourceTextHash: hashJson(Object.fromEntries(baseEntries)),
      translatedTextHash: hashJson(Object.fromEntries(translatedEntries)),
      entryCount: Object.keys(entries).length,
      missing,
      extra,
    },
    entries,
  };
}

function attachLocaleRef(spec, locale, overlayRelPath, opts = {}) {
  const out = clone(spec);
  out.meta = out.meta || {};
  out.meta.locale = opts.sourceLocale || out.meta.locale || 'en';
  out.meta.locales = out.meta.locales || {};
  out.meta.locales[normalizeLocale(locale)] = {
    label: opts.label || locale,
    path: overlayRelPath.replace(/\\/g, '/'),
  };
  return out;
}

module.exports = {
  DEFAULT_LOCALIZATION_DIR,
  applyLocale,
  attachLocaleRef,
  collectTextEntries,
  extractLocale,
  hashJson,
  readDeck,
  resolveLocalePath,
};

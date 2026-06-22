'use strict';

const fs = require('fs');
const { SCHEMA } = require('./schema');
const { resolveAsset } = require('./assets');

const VALID_TYPES = [
  'title', 'narrative', 'diagram', 'diagram-svg', 'mermaid', 'trace', 'transcript',
  'thread', 'stat', 'cta', 'terminal-gif', 'cards', 'code', 'table', 'chart',
  'image', 'image-compare', 'book', 'request',
];

let _validate;
function getValidate() {
  if (!_validate) {
    const Ajv = require('ajv');
    const ajv = new Ajv({ allErrors: true, discriminator: true, strict: false });
    _validate = ajv.compile(SCHEMA);
  }
  return _validate;
}

/**
 * Validate a parsed slidey spec against the JSON Schema.
 * Returns { valid: boolean, errors: string[], count: number }
 * where errors are human-readable lines and count is the number of distinct problems.
 */
function validateSpec(spec, opts = {}) {
  const validate = getValidate();
  const valid = validate(spec);
  const semantic = validateSemantics(spec, opts);
  if (valid && semantic.errors.length === 0) {
    return { valid: true, errors: [], warnings: semantic.warnings, count: 0 };
  }
  const { lines, count } = formatErrors(validate.errors, spec);
  return {
    valid: false,
    errors: [...lines, ...semantic.errors],
    warnings: semantic.warnings,
    count: count + semantic.errors.length,
  };
}

function validateSemantics(spec, opts = {}) {
  const specPath = opts.specPath || null;
  const errors = [];
  const warnings = [];
  const scenes = Array.isArray(spec && spec.scenes) ? spec.scenes : [];

  scenes.forEach((scene, sceneIdx) => {
    if (!scene || scene.type !== 'book') return;
    const books = Array.isArray(scene.books) ? scene.books.slice(0, 3) : [];
    books.forEach((book, bookIdx) => {
      const prefix = `  Scene ${sceneIdx} — book ${bookIdx}:`;
      if (!book || !book.cover) return;
      const ref = book.cover;
      if (/^data:/i.test(ref) || /^https?:\/\//i.test(ref)) return;
      const abs = resolveAsset(specPath, ref);
      if (!fs.existsSync(abs)) {
        errors.push(`${prefix} cover not found: ${ref}`);
        return;
      }
      const dims = imageSize(abs);
      if (!dims) {
        warnings.push(`${prefix} could not read cover dimensions: ${ref}`);
        return;
      }
      if (dims.width < 240 || dims.height < 320) {
        warnings.push(`${prefix} cover is low resolution (${dims.width}x${dims.height}); use at least 240x320 for rendered book slides`);
      }
    });
  });

  validateRequiredScenes(spec, errors);
  return { errors, warnings };
}

function validateRequiredScenes(spec, errors) {
  const requirements = (spec && spec.meta && (spec.meta.required_scenes || spec.meta.requiredScenes)) || [];
  if (!Array.isArray(requirements)) return;
  const scenes = Array.isArray(spec.scenes) ? spec.scenes : [];
  requirements.forEach((req, i) => {
    if (!req || !req.type) {
      errors.push(`  meta.required_scenes[${i}]: missing required field "type"`);
      return;
    }
    let matches = scenes.filter(s => s && s.type === req.type);
    if (Number.isInteger(req.first)) matches = matches.slice(0, Math.max(0, req.first));
    const count = matches.length;
    if (Number.isInteger(req.min) && count < req.min) {
      errors.push(`  meta.required_scenes[${i}]: requires at least ${req.min} scene(s) of type "${req.type}" (found ${count})`);
    }
    if (Number.isInteger(req.max) && count > req.max) {
      errors.push(`  meta.required_scenes[${i}]: allows at most ${req.max} scene(s) of type "${req.type}" (found ${count})`);
    }
  });
}

function imageSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.length >= 24 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) break;
      const marker = buf[off + 1];
      const len = buf.readUInt16BE(off + 2);
      if (len < 2) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      off += 2 + len;
    }
  }
  return null;
}

// ── Error formatting ────────────────────────────────────────────────────────

function formatErrors(rawErrors, spec) {
  // Split errors into scene-level and global
  const byScene = {};
  const global = [];

  for (const err of rawErrors || []) {
    const m = err.instancePath.match(/^\/scenes\/(\d+)(.*)/);
    if (m) {
      const idx = parseInt(m[1], 10);
      if (!byScene[idx]) byScene[idx] = [];
      byScene[idx].push({ ...err, _subPath: m[2] });
    } else {
      global.push(err);
    }
  }

  const lines = [];
  let count = 0;

  // Global errors
  for (const err of dedupe(global)) {
    const path = err.instancePath || '(root)';
    lines.push(`  ${path}: ${err.message}${paramsHint(err)}`);
    count++;
  }

  // Scene errors — one block per scene
  const sceneIdxs = Object.keys(byScene).map(Number).sort((a, b) => a - b);
  for (const idx of sceneIdxs) {
    const scene = spec && spec.scenes && spec.scenes[idx];
    const typeLabel = scene && scene.type ? ` — type: "${scene.type}"` : '';
    const unknownType = scene && scene.type && !VALID_TYPES.includes(scene.type);

    lines.push(`\n  Scene ${idx}${typeLabel}:`);

    if (unknownType) {
      lines.push(`    • unknown type "${scene.type}". Valid types: ${VALID_TYPES.join(', ')}`);
      count++;
      continue;
    }

    const errs = dedupe(byScene[idx]);
    for (const err of errs) {
      lines.push(`    • ${formatOne(err, idx, scene)}`);
      count++;
    }
  }

  return { lines, count };
}

function formatOne(err, sceneIdx, scene) {
  const sub = err._subPath || '';
  const field = sub.replace(/^\//, '') || 'scene';

  if (err.keyword === 'required') {
    const missing = err.params && err.params.missingProperty;
    return `missing required field "${missing || field}"`;
  }

  if (err.keyword === 'enum') {
    const allowed = err.params && err.params.allowedValues;
    const at = field ? `"${field}"` : 'value';
    const hint = allowed ? `. Allowed: ${allowed.map(v => `"${v}"`).join(', ')}` : '';
    return `${at}: ${err.message}${hint}`;
  }

  if (err.keyword === 'const') {
    return `${field}: ${err.message}`;
  }

  if (err.keyword === 'type') {
    const want = err.params && err.params.type;
    return `"${field}" must be ${want || 'the correct type'} (got ${jsonType(err.data)})`;
  }

  if (err.keyword === 'minItems') {
    return `"${field}" must have at least ${err.params.limit} item(s)`;
  }

  if (err.keyword === 'maxItems') {
    return `"${field}" has too many items (max ${err.params.limit}) — extra items will be clipped`;
  }

  if (err.keyword === 'minimum') {
    return `"${field}" must be ≥ ${err.params.limit}`;
  }

  if (err.keyword === 'additionalProperties') {
    const extra = err.params && err.params.additionalProperty;
    return `unknown field "${extra || field}" in ${sub ? sub.split('/').slice(0, -1).join('/') || 'scene' : 'meta'}`;
  }

  if (err.keyword === 'discriminator') {
    return `"type" must be one of: ${VALID_TYPES.join(', ')}`;
  }

  return `${field}: ${err.message}${paramsHint(err)}`;
}

function paramsHint(err) {
  if (!err.params) return '';
  if (err.keyword === 'enum') return '';
  if (err.keyword === 'required') return '';
  return '';
}

function jsonType(val) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

// Remove exact duplicates (same instancePath + keyword).
function dedupe(errs) {
  const seen = new Set();
  return errs.filter(e => {
    const key = `${e.instancePath}|${e.keyword}|${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { validateSpec };

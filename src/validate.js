'use strict';

const { SCHEMA } = require('./schema');

const VALID_TYPES = [
  'title', 'narrative', 'diagram', 'diagram-svg', 'trace', 'transcript',
  'thread', 'stat', 'cta', 'terminal-gif', 'cards', 'code', 'table', 'chart', 'request',
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
function validateSpec(spec) {
  const validate = getValidate();
  const valid = validate(spec);
  if (valid) return { valid: true, errors: [], count: 0 };
  const { lines, count } = formatErrors(validate.errors, spec);
  return { valid: false, errors: lines, count };
}

// ── Error formatting ────────────────────────────────────────────────────────

function formatErrors(rawErrors, spec) {
  // Split errors into scene-level and global
  const byScene = {};
  const global = [];

  for (const err of rawErrors) {
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

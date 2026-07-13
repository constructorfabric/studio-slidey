'use strict';

const fs = require('fs');
const path = require('path');

const BUILTIN_PACKS = [
  require('../data/theme-packs/builtin-vscode.json'),
];

const DISCOVERY_FILES = [
  'slidey.packs.json',
  'slidey.theme-pack.json',
  'slidey.template-pack.json',
];

const DISCOVERY_DIRS = [
  '.slidey/packs',
  '.slidey/theme-packs',
  '.slidey/template-packs',
  'slidey-packs',
  'theme-packs',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanRuntimeMeta(meta) {
  if (!meta || typeof meta !== 'object') return meta || {};
  const next = { ...meta };
  delete next._themePacks;
  delete next._slideyPacks;
  return next;
}

function cleanRuntimeSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return spec;
  if (!spec.meta || typeof spec.meta !== 'object') return { ...spec };
  return { ...spec, meta: cleanRuntimeMeta(spec.meta) };
}

function normalizeThemes(themes) {
  if (!themes) return {};
  if (!Array.isArray(themes)) return themes && typeof themes === 'object' ? themes : {};
  return themes.reduce((acc, theme) => {
    if (theme && typeof theme === 'object' && typeof theme.id === 'string') {
      const { id, ...rest } = theme;
      acc[id] = rest;
    }
    return acc;
  }, {});
}

function normalizeLayouts(layouts) {
  if (!Array.isArray(layouts)) return [];
  return layouts
    .filter((entry) => entry && typeof entry === 'object' && entry.scene && typeof entry.scene === 'object')
    .map((entry) => ({
      id: String(entry.id || entry.scene.type || '').trim(),
      label: entry.label || entry.name || entry.title || '',
      type: entry.type || entry.scene.type || '',
      variant: entry.variant || entry.scene.variant || '',
      scene: entry.scene,
    }))
    .filter((entry) => entry.id && entry.type);
}

function normalizePack(pack, source = '') {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return null;
  return {
    id: pack.id || pack.name || (source ? path.basename(source, path.extname(source)) : ''),
    name: pack.name || pack.id || '',
    source,
    themes: normalizeThemes(pack.themes || pack.colorSchemes || pack.schemes),
    layouts: normalizeLayouts(pack.layouts || pack.templates || pack.sceneTemplates),
  };
}

function readPackFile(filePath) {
  try {
    return normalizePack(JSON.parse(fs.readFileSync(filePath, 'utf8')), filePath);
  } catch (err) {
    const wrapped = new Error(`failed to load Slidey pack ${filePath}: ${err.message}`);
    wrapped.cause = err;
    throw wrapped;
  }
}

function discoverPackFiles(root) {
  const files = [];
  for (const file of DISCOVERY_FILES) {
    const abs = path.join(root, file);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) files.push(abs);
  }
  for (const dir of DISCOVERY_DIRS) {
    const absDir = path.join(root, dir);
    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) continue;
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isFile() && /\.json$/i.test(entry.name)) files.push(path.join(absDir, entry.name));
    }
  }
  return [...new Set(files)].sort();
}

function explicitPackFiles(spec, specPath) {
  const refs = spec && spec.meta && Array.isArray(spec.meta.themePacks) ? spec.meta.themePacks : [];
  const base = specPath ? path.dirname(specPath) : process.cwd();
  return refs
    .filter((ref) => typeof ref === 'string' && ref.trim())
    .map((ref) => path.isAbsolute(ref) ? ref : path.resolve(base, ref));
}

function inlinePacks(spec) {
  const refs = spec && spec.meta && Array.isArray(spec.meta.themePacks) ? spec.meta.themePacks : [];
  return refs
    .filter((ref) => ref && typeof ref === 'object' && !Array.isArray(ref))
    .map((pack) => normalizePack(pack, 'meta.themePacks'))
    .filter(Boolean);
}

function loadThemePacks(specPath = null, spec = {}, opts = {}) {
  const roots = [];
  if (opts.workspaceRoot) roots.push(path.resolve(opts.workspaceRoot));
  if (specPath) roots.push(path.dirname(path.resolve(specPath)));
  roots.push(process.cwd());

  const files = [];
  for (const root of [...new Set(roots)]) files.push(...discoverPackFiles(root));
  files.push(...explicitPackFiles(spec, specPath));

  const packs = BUILTIN_PACKS.map((pack) => normalizePack(pack, 'builtin')).filter(Boolean);
  for (const file of [...new Set(files)]) packs.push(readPackFile(file));
  packs.push(...inlinePacks(spec));
  return packs.filter(Boolean);
}

function attachRuntimeThemePacks(spec, specPath = null, opts = {}) {
  const next = cleanRuntimeSpec(clone(spec));
  next.meta = next.meta || {};
  next.meta._themePacks = loadThemePacks(specPath, next, opts);
  return next;
}

function stripRuntimeThemePacks(spec) {
  return cleanRuntimeSpec(clone(spec));
}

module.exports = {
  BUILTIN_PACKS,
  loadThemePacks,
  attachRuntimeThemePacks,
  stripRuntimeThemePacks,
};

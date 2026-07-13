#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { browserExecutableError, closeBrowser, launchOptions } = require('./browser');
const { runSetupDoctor } = require('./setup-doctor');
const { validateSpec } = require('./validate');
const { SCHEMA } = require('./schema');
const { sceneShowOpts } = require('./assets');
const { auditSpec } = require('./audit');
const { runCheck } = require('./check');
const { estimateBoundaries } = require('./timing');
const { tempRoot } = require('./temp-path');
const { versionOf } = require('./spec-version');
const { addressableScenes, resolveSceneAddress, sceneIdOf } = require('./scene-address');
const { normalizeDeckDefinitions, resolveDeckSpec, inlineChildDeckFiles } = require('./collections');
const { applyPronunciationsWithDetails } = require('./narration');
const { attachRuntimeThemePacks, loadThemePacks, stripRuntimeThemePacks } = require('./theme-packs');

const ROOT_DIR = path.resolve(__dirname, '..');
const RENDER_BUNDLE = path.join(ROOT_DIR, 'dist-render', 'render.html');
const SPEC_EXT = new Set(['.json', '.jsonl']);
const READONLY_SUFFIX = '.readonly.slidey.json';

// Auto-discovery (workspace_tree) lists specs that follow the `.slidey.json`
// convention plus generated `.jsonl` traces. Explicit reads stay permissive.
function isDiscoverableSpec(name) {
  return /\.(?:readonly\.)?slidey\.json$/i.test(name) || /\.jsonl$/i.test(name);
}

function isReadOnlySlideySpec(name) {
  return new RegExp(`${READONLY_SUFFIX.replace('.', '\\.')}$`, 'i').test(name);
}

function isEditableSpec(name) {
  return /\.json$/i.test(name) && !isReadOnlySlideySpec(name);
}

function ensureEditable(abs) {
  if (!isEditableSpec(abs)) {
    throw new Error('only editable .json specs can be edited; .readonly.slidey.json is read-only');
  }
}
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-render', 'dist-web-single', '.git', '.worktrees']);

// MCP uses stdout for JSON-RPC. Keep every existing Slidey diagnostic off
// stdout so build/render logs cannot corrupt the protocol stream.
console.log = (...args) => process.stderr.write(args.join(' ') + '\n');

function parseArgs(argv) {
  const opts = { root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--root' || arg === '-r') && argv[i + 1]) {
      opts.root = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write([
        'slidey-mcp',
        '',
        'Usage:',
        '  slidey-mcp --root <workspace>',
        '',
        'Runs a stdio MCP server exposing Slidey viewing, editing, validation, and debugging tools.',
        '',
      ].join('\n'));
      process.exit(0);
    }
  }
  opts.root = path.resolve(opts.root);
  return opts;
}

const CONFIG = parseArgs(process.argv.slice(2));
const BROWSER_TOOL_TIMEOUT_MS = Number(process.env.SLIDEY_MCP_BROWSER_TIMEOUT_MS || 30000);
const BROWSER_TOOLS = new Set([
  'slidey_render_png',
  'slidey_render_html',
  'slidey_audit',
  'slidey_review_deck',
  'slidey_contact_sheet',
  'slidey_prepare_review_artifact',
  'slidey_doctor',
]);
const LAYOUT_GALLERY_PATH = path.join(ROOT_DIR, 'examples', 'layout-gallery.slidey.json');

// Keep the editor-facing read tools deliberately small.  A deck may contain
// large rrweb traces, embedded images, or hundreds of scenes, so an agent
// should be able to orient itself and retrieve one target scene before it ever
// needs slidey_read_spec's full document.
function compactSceneOutline(scene, sceneIndex, deckId = null, deckTitle = null) {
  return {
    sceneIndex,
    sceneId: sceneIdOf(scene, sceneIndex),
    deck: deckId,
    deckTitle,
    type: scene.type,
    title: scene.title || scene.headline || scene.eyebrow || scene.question || null,
    subtitle: scene.subtitle || scene.lede || null,
  };
}

function deckOverview(spec) {
  const sourceScenes = Array.isArray(spec.scenes) ? spec.scenes : [];
  const decks = normalizeDeckDefinitions(spec);
  return {
    meta: spec.meta || {},
    sceneCount: sourceScenes.length,
    scenes: sourceScenes.map((scene, sceneIndex) => compactSceneOutline(scene, sceneIndex)),
    library: spec.library ? {
      title: spec.library.title || null,
      decks: decks.filter((deck) => !deck.source).map((deck) => ({
        id: deck.id,
        title: deck.title,
        parent: deck.parent,
        deckType: deck.deckType,
        sceneCount: deck.sceneCount,
        purpose: deck.purpose || null,
        description: deck.description || null,
      })),
    } : null,
  };
}

function searchableText(scene) {
  const fields = ['id', 'key', 'title', 'headline', 'eyebrow', 'subtitle', 'lede', 'body', 'question', 'caption', 'narration'];
  const values = [];
  for (const field of fields) {
    const value = scene && scene[field];
    if (typeof value === 'string') values.push({ field, text: value });
    if (Array.isArray(value) && field === 'narration') {
      value.forEach((cue) => {
        if (cue && typeof cue.text === 'string') values.push({ field, text: cue.text });
      });
    }
  }
  return values;
}

function excerpt(text, query) {
  const matchAt = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, matchAt - 80);
  const end = Math.min(text.length, matchAt + query.length + 160);
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function loadLayoutGuideDeck() {
  try {
    const raw = fs.readFileSync(LAYOUT_GALLERY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.scenes) ? parsed.scenes : [];
  } catch (_) {
    return [];
  }
}

function layoutGalleryId(type, variant = '') {
  return variant ? `${type}-${variant}` : type;
}

function layoutGalleryLabel(scene, type, variant) {
  if (typeof scene.title === 'string' && scene.title.trim()) return scene.title.trim();
  if (typeof scene.eyebrow === 'string' && scene.eyebrow.trim()) return `${type}: ${scene.eyebrow.trim()}`;
  if (typeof scene.question === 'string' && scene.question.trim()) return `${type}: ${scene.question.trim()}`;
  if (typeof scene.lede === 'string' && scene.lede.trim()) return `${type}: ${scene.lede.trim()}`;
  return variant ? `${type} (${variant})` : type;
}

function buildLayoutGalleryFromGuide(scenes) {
  const sourceScenes = Array.isArray(scenes) ? scenes : [];
  const seen = new Set();
  const layouts = [];
  const issues = [];

  for (const scene of sourceScenes) {
    if (!scene || typeof scene !== 'object') {
      issues.push('layout guide contains a non-object scene entry');
      continue;
    }
    const type = typeof scene.type === 'string' ? scene.type.trim() : '';
    if (!type) {
      issues.push('layout guide scene is missing required "type"');
      continue;
    }
    const variant = typeof scene.variant === 'string' ? scene.variant.trim() : '';
    // Meme scenes share type "meme" and carry no variant, so they would all
    // collapse to a single gallery id. Discriminate them by their template id
    // (a valid scene field) so each template shows as its own gallery entry.
    const discriminator = variant || (type === 'meme' && typeof scene.template === 'string' ? scene.template.trim() : '');
    const id = layoutGalleryId(type, discriminator);
    if (seen.has(id)) continue;

    layouts.push({
      id,
      label: layoutGalleryLabel(scene, type, variant),
      type,
      variant,
      scene,
    });
    seen.add(id);
  }

  return {
    layouts,
    issues,
    valid: issues.length === 0,
    sourceScenes: sourceScenes.length,
    uniqueScenes: layouts.length,
  };
}

function fallbackLayoutGallery() {
  return [
    { id: 'title', label: 'Title', type: 'title', variant: '', scene: { type: 'title', title: 'Title slide', subtitle: 'Add your subtitle', eyebrow: 'Section' } },
    { id: 'narrative', label: 'Narrative', type: 'narrative', variant: '', scene: { type: 'narrative', eyebrow: 'Narrative', lede: 'A short takeaway', body: 'Start writing the scene copy here.' } },
    { id: 'cards-grid', label: 'Cards (grid)', type: 'cards', variant: 'grid', scene: { type: 'cards', variant: 'grid', title: 'Grid cards', columns: 2, cards: [{ label: 'Point', sub: 'Describe a key idea' }, { label: 'Point', sub: 'Add supporting context' }] } },
    { id: 'code-source', label: 'Code block', type: 'code', variant: 'source', scene: { type: 'code', variant: 'source', title: 'Code', lang: 'javascript', code: "console.log('Hello from Slidey');" } },
    { id: 'diagram-svg', label: 'Diagram', type: 'diagram-svg', variant: '', scene: { type: 'diagram-svg', title: 'Diagram', panels: [{ label: 'Main flow', auto_layout: true, rankdir: 'TB', ranksep: 100, nodesep: 80, marginx: 50, marginy: 50, overlap_gap: 24, overlap_iterations: 12, resolve_overlaps: true, nodes: [{ id: 'start', label: 'Start' }, { id: 'end', label: 'Done' }], edges: [{ from: 'start', to: 'end' }] }] } },
    { id: 'table-data', label: 'Table', type: 'table', variant: 'data', scene: { type: 'table', variant: 'data', title: 'Table', columns: ['Stage', 'Status'], rows: [{ cells: ['Draft', 'Ready'] }] } },
    { id: 'chart-bar', label: 'Chart', type: 'chart', variant: 'bar', scene: { type: 'chart', variant: 'bar', title: 'Chart', series: [{ name: 'Series 1', points: [{ x: 'A', y: 7 }, { x: 'B', y: 12 }] }] } },
    { id: 'mermaid', label: 'Mermaid', type: 'mermaid', variant: '', scene: { type: 'mermaid', title: 'Mermaid', source: 'flowchart TD\nA[Input] --> B[Process]\nB --> C[Output]' } },
  ];
}

const LAYOUT_GUIDE_BUILD = buildLayoutGalleryFromGuide(loadLayoutGuideDeck());
const BUILTIN_LAYOUT_GALLERY = LAYOUT_GUIDE_BUILD.layouts.length
  ? LAYOUT_GUIDE_BUILD.layouts
  : fallbackLayoutGallery();

if (LAYOUT_GUIDE_BUILD.layouts.length && !LAYOUT_GUIDE_BUILD.valid) {
  console.error(`slidey layout gallery integrity warning: ${LAYOUT_GUIDE_BUILD.issues.join('; ')}`);
}

function jsonText(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}

function okResult(value) {
  return { content: jsonText(value) };
}

function errorResult(message, details = null) {
  const payload = details ? { error: message, details } : { error: message };
  return { isError: true, content: jsonText(payload) };
}

function safeResolve(rel = '') {
  if (typeof rel !== 'string') throw new Error('path must be a string');
  // An ABSOLUTE input path is an explicit, intentional choice by the caller —
  // honor it verbatim (e.g. validating/rendering a deck that lives outside the
  // MCP workspace root, like a deck in another repo). The workspace-escape
  // guard below exists to stop RELATIVE inputs from traversing out via `../`;
  // it must not mangle an absolute path. (Previously `path.resolve(root, './' +
  // absPath)` rewrote `/abs/x` into `<root>/abs/x` → "spec not found".)
  if (path.isAbsolute(rel)) return path.resolve(rel);
  const abs = path.resolve(CONFIG.root, '.' + path.sep + rel);
  const rootWithSep = CONFIG.root.endsWith(path.sep) ? CONFIG.root : CONFIG.root + path.sep;
  if (abs !== CONFIG.root && !abs.startsWith(rootWithSep)) {
    throw new Error(`path escapes workspace root: ${rel}`);
  }
  return abs;
}

function relPath(abs) {
  return path.relative(CONFIG.root, abs).replace(/\\/g, '/');
}

function requireSpecPath(inputPath) {
  const abs = safeResolve(inputPath || '');
  if (!fs.existsSync(abs)) throw new Error(`spec not found: ${inputPath}`);
  if (!fs.statSync(abs).isFile()) throw new Error(`not a file: ${inputPath}`);
  if (!SPEC_EXT.has(path.extname(abs).toLowerCase())) {
    throw new Error(`expected a .json or .jsonl spec: ${inputPath}`);
  }
  return abs;
}

function readSpecFile(inputPath) {
  const abs = requireSpecPath(inputPath);
  const buf = fs.readFileSync(abs);
  const raw = buf.toString('utf8');
  const parsedSpec = /\.jsonl$/i.test(abs) ? require('./trace').buildSpecFromFile(abs) : JSON.parse(raw);
  const inlined = inlineChildDeckFiles(parsedSpec, { specPath: abs });
  const spec = attachRuntimeThemePacks(inlined.spec, abs, { workspaceRoot: CONFIG.root });
  const generated = /\.jsonl$/i.test(abs);
  // Content version: hand this back to writeSpecFile as baseVersion so a write
  // built from a stale read can't silently clobber a concurrent edit.
  return { abs, raw, spec, generated, editable: isEditableSpec(abs) && !generated, version: versionOf(buf) };
}

function inferMode(spec) {
  if (spec && spec.meta && spec.meta.mode) return spec.meta.mode;
  return (spec.scenes || []).some(scene => scene && scene.type === 'request') ? 'api' : 'pitch';
}

function writeSpecFile(inputPath, spec, opts = {}) {
  const abs = requireSpecPath(inputPath);
    ensureEditable(abs);
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('spec must be a JSON object');
  if (!Array.isArray(spec.scenes) || spec.scenes.length === 0) throw new Error('spec must have a non-empty "scenes" array');
  const body = JSON.stringify(stripRuntimeThemePacks(spec), null, 2) + '\n';
  const nextBytes = Buffer.from(body, 'utf8');
  // Optimistic concurrency: when the caller passes the baseVersion it read, a
  // mismatch means the file changed underneath (e.g. the human saved an edit in
  // the viewer since the AI read it). Refuse to clobber unless force:true (OURS);
  // the caller should otherwise re-read and re-apply (THEIRS). Identical content
  // is never a conflict. No baseVersion → unchecked write (back-compat).
  if (opts.baseVersion && opts.force !== true) {
    const currentBytes = fs.readFileSync(abs);
    const currentVersion = versionOf(currentBytes);
    if (opts.baseVersion !== currentVersion && !currentBytes.equals(nextBytes)) {
      const err = new Error(
        `conflict: ${relPath(abs)} changed on disk since version ${opts.baseVersion} (now ${currentVersion}). ` +
        'Re-read it with slidey_read_spec and re-apply your change (THEIRS), or pass force:true to overwrite (OURS).',
      );
      err.code = 'ESPECCONFLICT';
      err.currentVersion = currentVersion;
      throw err;
    }
  }
  fs.writeFileSync(abs, nextBytes);
  return { path: relPath(abs), bytes: Buffer.byteLength(body), mtimeMs: fs.statSync(abs).mtimeMs, version: versionOf(nextBytes) };
}

function cloneSpecValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function layoutGalleryForSpec(specPath = null, spec = {}) {
  const byId = new Map(BUILTIN_LAYOUT_GALLERY.map((entry) => [entry.id, entry]));
  for (const pack of loadThemePacks(specPath, spec, { workspaceRoot: CONFIG.root })) {
    for (const layout of pack.layouts || []) {
      byId.set(layout.id, {
        id: layout.id,
        label: layout.label || layoutGalleryLabel(layout.scene, layout.type, layout.variant),
        type: layout.type || layout.scene.type,
        variant: layout.variant || layout.scene.variant || '',
        scene: layout.scene,
        pack: pack.id || pack.name || '',
      });
    }
  }
  return [...byId.values()];
}

function layoutById(layoutId, specPath = null, spec = {}) {
  return layoutGalleryForSpec(specPath, spec).find((entry) => entry.id === layoutId) || null;
}

function clampSceneIndex(index, sceneCount) {
  if (!Number.isInteger(index)) throw new Error('sceneIndex must be an integer');
  if (sceneCount <= 0) throw new Error('spec must contain at least one scene');
  if (index < 0 || index >= sceneCount) throw new Error(`sceneIndex must be between 0 and ${sceneCount - 1}`);
  return index;
}

function clampIndexForInsert(index, length) {
  if (!Number.isInteger(index)) return length;
  return Math.max(0, Math.min(index, length));
}

function sanitizeScene(scene) {
  return cloneSpecValue(scene);
}

function buildTree(absDir, relDir = '') {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const dirs = [];
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const childAbs = path.join(absDir, entry.name);
    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const children = buildTree(childAbs, childRel);
      if (children.length) dirs.push({ name: entry.name, type: 'dir', path: childRel, children });
    } else if (entry.isFile() && isDiscoverableSpec(entry.name)) {
      files.push({ name: entry.name, type: 'file', path: childRel, editable: isEditableSpec(entry.name) });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  return [...dirs.sort(byName), ...files.sort(byName)];
}

function pointerParts(pointer) {
  if (pointer === '') return [];
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw new Error(`invalid JSON pointer: ${pointer}`);
  return pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function parentForPointer(doc, pointer) {
  const parts = pointerParts(pointer);
  if (parts.length === 0) return { parent: null, key: null };
  let parent = doc;
  for (const part of parts.slice(0, -1)) {
    if (Array.isArray(parent)) {
      const idx = part === '-' ? parent.length : Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) throw new Error(`array index not found in pointer: ${pointer}`);
      parent = parent[idx];
    } else if (parent && typeof parent === 'object' && Object.prototype.hasOwnProperty.call(parent, part)) {
      parent = parent[part];
    } else {
      throw new Error(`object key not found in pointer: ${pointer}`);
    }
  }
  return { parent, key: parts[parts.length - 1] };
}

function getPointer(doc, pointer) {
  let node = doc;
  for (const part of pointerParts(pointer)) {
    if (Array.isArray(node)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= node.length) throw new Error(`array index not found in pointer: ${pointer}`);
      node = node[idx];
    } else if (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, part)) {
      node = node[part];
    } else {
      throw new Error(`object key not found in pointer: ${pointer}`);
    }
  }
  return node;
}

function applyJsonPatch(doc, operations) {
  if (!Array.isArray(operations)) throw new Error('operations must be an array');
  const target = structuredClone(doc);
  for (const op of operations) {
    if (!op || typeof op !== 'object') throw new Error('each patch operation must be an object');
    const { parent, key } = parentForPointer(target, op.path);
    if (op.op === 'test') {
      const actual = getPointer(target, op.path);
      if (JSON.stringify(actual) !== JSON.stringify(op.value)) throw new Error(`test failed at ${op.path}`);
      continue;
    }
    if (parent === null) {
      if (op.op === 'replace') return op.value;
      throw new Error(`operation ${op.op} is not supported at the document root`);
    }
    if (Array.isArray(parent)) {
      const idx = key === '-' ? parent.length : Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx > parent.length) throw new Error(`invalid array index in pointer: ${op.path}`);
      if (op.op === 'add') parent.splice(idx, 0, op.value);
      else if (op.op === 'replace') {
        if (idx >= parent.length) throw new Error(`array index not found in pointer: ${op.path}`);
        parent[idx] = op.value;
      } else if (op.op === 'remove') {
        if (idx >= parent.length) throw new Error(`array index not found in pointer: ${op.path}`);
        parent.splice(idx, 1);
      } else {
        throw new Error(`unsupported patch op: ${op.op}`);
      }
    } else if (parent && typeof parent === 'object') {
      if (op.op === 'add' || op.op === 'replace') {
        if (op.op === 'replace' && !Object.prototype.hasOwnProperty.call(parent, key)) throw new Error(`object key not found in pointer: ${op.path}`);
        parent[key] = op.value;
      } else if (op.op === 'remove') {
        if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new Error(`object key not found in pointer: ${op.path}`);
        delete parent[key];
      } else {
        throw new Error(`unsupported patch op: ${op.op}`);
      }
    } else {
      throw new Error(`cannot patch through non-container at ${op.path}`);
    }
  }
  return target;
}

async function loadRenderPage(spec, specPath, sceneIndex, stepIndex) {
  const executableError = browserExecutableError();
  if (executableError) throw new Error(executableError);
  const puppeteer = require('puppeteer');
  require('./render-bundle').ensureRenderBundle();
  const sceneStepsPath = path.join(ROOT_DIR, 'web', 'sceneSteps.mjs');
  const sceneStepsUrl = pathToFileURL(sceneStepsPath);
  sceneStepsUrl.searchParams.set('mtime', String(fs.statSync(sceneStepsPath).mtimeMs));
  const { stepsForScene, applyShow } = await import(sceneStepsUrl.href);
  const scenes = Array.isArray(spec.scenes) ? spec.scenes : [];
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex >= scenes.length) {
    throw new Error(`sceneIndex must be between 0 and ${Math.max(0, scenes.length - 1)}`);
  }
  const scene = scenes[sceneIndex];
  const steps = stepsForScene(scene);
  const pageSteps = steps.length ? steps : [null];
  const resolvedStepIndex = stepIndex == null ? pageSteps.length - 1 : stepIndex;
  if (!Number.isInteger(resolvedStepIndex) || resolvedStepIndex < 0 || resolvedStepIndex >= pageSteps.length) {
    throw new Error(`stepIndex must be between 0 and ${pageSteps.length - 1} for scene ${sceneIndex}`);
  }

  const { width = 1920, height = 1080 } = (spec.meta && spec.meta.resolution) || {};
  const mode = inferMode(spec);
  const browser = await puppeteer.launch(launchOptions({ width, height }));
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`file://${RENDER_BUNDLE}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__slideyReady === true', { timeout: 15000 });
    await page.emulateMediaType('screen');
    await page.evaluate((meta, m) => {
      window.slidey.setMeta(meta);
      window.slidey.setMode(m);
      document.body.classList.add('instant');
    }, spec.meta || {}, mode);
    await page.evaluate(applyShow, scene, sceneShowOpts(scene, specPath));
    // Apply EVERY reveal step up to and including the requested one, so the PNG
    // shows the cumulative on-screen state the audience actually sees at that
    // moment (title + items 0..N + caption) — not the single step's element in
    // isolation. setState() accumulates into the store's `revealed` set, so this
    // mirrors live nav and the geometry audit (src/audit.js applies pageSteps the
    // same way). Omitting stepIndex resolves to the last step → the fully-built
    // composite frame.
    const appliedSteps = pageSteps.slice(0, resolvedStepIndex + 1).filter(Boolean);
    if (appliedSteps.length) {
      await page.evaluate((steps) => { for (const s of steps) window.slidey.setState(s); }, appliedSteps);
    }
    const step = pageSteps[resolvedStepIndex];
    await page.evaluate('window.__slideySettle && window.__slideySettle()');
    return { browser, page, scene, step, appliedSteps, steps: pageSteps, width, height, sceneIndex, stepIndex: resolvedStepIndex };
  } catch (err) {
    await closeBrowser(browser);
    throw err;
  }
}

// Video scenes are not rendered through the Vue bundle (it excludes the rrweb
// web player). Instead we drive the REAL clip headlessly and screenshot a frame:
// an rrweb source seeks its Replayer to `atSec` (a genuine reconstructed DOM
// frame, not a placeholder); an MP4 `src` grabs a frame ~10% in. `atSec` is
// clamped to the clip duration so a caller can scrub the whole replay without a
// browser. Returns null if the source is missing so the caller can fall back to
// the Vue render.
async function renderVideoPoster(args, spec, specPath, sceneIndex, scene) {
  const executableError = browserExecutableError();
  if (executableError) throw new Error(executableError);
  const { width = 1920, height = 1080 } = (spec.meta && spec.meta.resolution) || {};
  const tmpPng = path.join(tempRoot(), `slidey-mcp-poster-${process.pid}-${sceneIndex}.png`);
  const specDir = path.dirname(specPath || '.');
  // atSecond (explicit scrub) overrides the scene start; both default to the
  // exporter's "~10% in" representative frame when unset.
  const requested = typeof args.atSecond === 'number' ? args.atSecond : scene.start;
  let atSec = requested;
  let durationSec = null;
  let note = 'real rrweb replay frame, seeked headlessly (the interactive bundle plays the full clip in-browser)';
  try {
    if (scene.rrweb) {
      const rrwebPath = path.resolve(specDir, scene.rrweb);
      if (!fs.existsSync(rrwebPath)) return null;
      const { loadRrweb } = require('./rrweb-format');
      const { extractRrwebPoster } = require('./rrweb-render');
      // Clamp the requested seek into the clip so an out-of-range atSecond yields
      // the last frame rather than an error.
      try {
        const meta = loadRrweb(rrwebPath);
        if (meta && typeof meta.durationMs === 'number') {
          durationSec = meta.durationMs / 1000;
          if (typeof requested === 'number') atSec = Math.max(0, Math.min(requested, durationSec));
        }
      } catch (_) { /* duration is best-effort; render still proceeds */ }
      await extractRrwebPoster(rrwebPath, tmpPng, { width, height, fit: scene.fit || 'contain', atSec: atSec || undefined });
    } else if (scene.src) {
      const v = require('./video');
      const src = path.resolve(specDir, scene.src);
      if (!fs.existsSync(src)) return null;
      const dur = v.probeDuration(src);
      durationSec = dur || null;
      atSec = typeof requested === 'number'
        ? Math.max(0, Math.min(requested, dur || requested))
        : Math.max(0, scene.start || 0) + Math.min(1, (dur || 0) * 0.1);
      note = 'real video frame extracted at the requested time (the interactive bundle plays the full clip)';
      v.extractPoster({ src, outPng: tmpPng, width, height, fit: scene.fit || 'contain', atSec });
    } else {
      return null;
    }
    const data = fs.readFileSync(tmpPng).toString('base64');
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            path: args.path,
            sceneIndex,
            poster: true,
            note,
            source: scene.rrweb || scene.src,
            atSec: atSec || 0,
            durationSec,
            width,
            height,
          }, null, 2),
        },
        { type: 'image', mimeType: 'image/png', data },
      ],
    };
  } finally {
    try { fs.unlinkSync(tmpPng); } catch (_) { /* best-effort cleanup */ }
  }
}

async function renderPng(args) {
  const { abs, spec: fileSpec } = readSpecFile(args.path);
  const address = resolveSceneAddress(fileSpec, args);
  const spec = address.spec;
  const scenes = Array.isArray(spec.scenes) ? spec.scenes : [];
  const scene = scenes[address.sceneIndex];
  if (scene && scene.type === 'video' && (scene.rrweb || scene.src)) {
    const poster = await renderVideoPoster(args, spec, abs, address.sceneIndex, scene);
    if (poster) return poster;
  }
  const session = await loadRenderPage(spec, abs, address.sceneIndex, args.stepIndex);
  try {
    const data = await session.page.screenshot({ type: 'png', encoding: 'base64' });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            path: args.path,
            deck: address.deckId,
            sceneIndex: session.sceneIndex,
            stepIndex: session.stepIndex,
            step: session.step,
            appliedSteps: session.appliedSteps,
            steps: session.steps,
            width: session.width,
            height: session.height,
          }, null, 2),
        },
        { type: 'image', mimeType: 'image/png', data },
      ],
    };
  } finally {
    await closeBrowser(session.browser);
  }
}

async function renderHtml(args) {
  const { abs, spec: fileSpec } = readSpecFile(args.path);
  const address = resolveSceneAddress(fileSpec, args);
  const spec = address.spec;
  const session = await loadRenderPage(spec, abs, address.sceneIndex, args.stepIndex);
  try {
    const html = await session.page.evaluate(() => {
      const root = document.getElementById('root') || document.body;
      const styles = Array.from(document.querySelectorAll('style,link[rel="stylesheet"]'))
        .map((node) => node.outerHTML)
        .join('\n');
      return [
        '<!doctype html>',
        '<html>',
        '<head>',
        '<meta charset="utf-8">',
        styles,
        '</head>',
        `<body class="${document.body.className}">`,
        root.outerHTML,
        '</body>',
        '</html>',
      ].join('\n');
    });
    return okResult({
      path: args.path,
      deck: address.deckId,
      sceneIndex: session.sceneIndex,
      stepIndex: session.stepIndex,
      step: session.step,
      appliedSteps: session.appliedSteps,
      steps: session.steps,
      html,
    });
  } finally {
    await closeBrowser(session.browser);
  }
}

// bundleSpec renders a spec to a single self-contained interactive HTML deck by
// running the same `web/build-single.mjs` builder the `slidey bundle` CLI uses
// (which inlines JS/CSS/assets, including the rrweb clip, and embeds the spec as
// window.__SLIDEY_SPEC__). Validates first unless skipValidate is set, so the
// MCP never ships a deck with blank slides. Returns the written .html path.
function bundleSpec(absSpec, spec, absOut, { skipValidate = false } = {}) {
  if (!skipValidate) {
    const validation = validateSpec(spec, { specPath: absSpec });
    if (!validation.valid) {
      const problems = (validation.errors || []).join('\n');
      const err = new Error(`spec is invalid (${validation.count || (validation.errors || []).length} problem(s)) — refusing to bundle a deck that won't render correctly; fix these or pass skipValidate=true:\n${problems}`);
      err.validation = validation;
      throw err;
    }
  }
  const script = path.join(ROOT_DIR, 'web', 'build-single.mjs');
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  require('child_process').execFileSync(process.execPath, [script, absSpec, absOut], { stdio: 'pipe' });
  return absOut;
}

function captureConsole(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  try {
    const value = fn();
    return { value, output: lines.join('\n') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function toolInputSchema(properties, required = []) {
  return { type: 'object', additionalProperties: false, properties, required };
}

function sceneTitle(scene = {}) {
  return scene.title || scene.headline || scene.eyebrow || scene.label || scene.value || '';
}

function graphPathEntries(scene = {}) {
  const raw = Array.isArray(scene.path) && scene.path.length ? scene.path : (Array.isArray(scene.focus) ? scene.focus : []);
  return raw
    .map((entry) => (typeof entry === 'string' ? { node: entry } : entry))
    .filter((entry) => entry && typeof entry === 'object' && entry.node);
}

function graphEdgeId(edge, index) {
  return String(edge.id || `${edge.from}-${edge.to}-${index}`);
}

function addIssue(issues, severity, kind, message, extra = {}) {
  issues.push({ severity, kind, message, ...extra });
}

// Mirrors GraphScene.vue's grid-slot resolution (graphGrid + gridPosition):
// true when a node's position is deterministically known ahead of render,
// either via a grid col/row slot or a pinned x/y/position. Used to decide
// whether an "unanchored" edge-label warning is actionable (BUG G-3).
function graphSceneGrid(scene) {
  const template = scene.layoutTemplate || scene.template || '';
  const raw = scene.grid && typeof scene.grid === 'object' ? scene.grid : {};
  if (!template && !Object.keys(raw).length) return null;
  const preset = template === 'lane-grid-3x5' || template === 'grid-3x5'
    ? { columns: 5, rows: 3 } : {};
  const columns = Number(raw.columns || raw.cols || preset.columns || 5);
  const rows = Number(raw.rows || raw.lanes || preset.rows || 3);
  if (!Number.isFinite(columns) || columns < 1 || !Number.isFinite(rows) || rows < 1) return null;
  return { columns, rows };
}

function nodeHasResolvablePosition(scene, node) {
  if (!node) return false;
  if (node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)) return true;
  if (Number.isFinite(node.x) && Number.isFinite(node.y)) return true;
  const grid = graphSceneGrid(scene);
  if (!grid) return false;
  const col = node.col ?? node.column ?? node.gridColumn ?? node.grid?.col ?? node.grid?.column;
  const row = node.row ?? node.lane ?? node.gridRow ?? node.grid?.row ?? node.grid?.lane;
  return col != null && row != null && Number.isFinite(Number(col)) && Number.isFinite(Number(row));
}

// BUG G-4 fix: projection-mode graph scenes (scene.projection + scene.state)
// previously passed the static audit trivially even when `projection` didn't
// resolve to a file or `state` wasn't a key in it — the only guard was a
// runtime `throw` inside the browser renderer, surfaced as an on-slide error
// string with no pre-render signal. Statically resolve the projection JSON
// (same resolution rule as src/assets.js sceneShowOpts) and check it here.
function auditProjectionScene(scene, sceneIndex, specPath, issues) {
  if (!scene.projection) return;
  if (/^(data:|https?:)/i.test(scene.projection)) return; // not statically resolvable; skip
  const abs = path.resolve(path.dirname(specPath || process.cwd()), scene.projection);
  if (!fs.existsSync(abs)) {
    addIssue(issues, 'error', 'missing-projection-file', `projection "${scene.projection}" does not resolve to a file on disk`, {});
    return;
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    addIssue(issues, 'error', 'invalid-projection-json', `projection "${scene.projection}" is not valid JSON: ${err.message}`, {});
    return;
  }
  if (!scene.state) {
    addIssue(issues, 'warning', 'missing-projection-state', 'projection scene has no "state" — nothing will render', {});
    return;
  }
  const states = (data && typeof data.states === 'object' && data.states) || {};
  const graphs = Array.isArray(data.graphs) ? data.graphs : [];
  const hasState = Object.prototype.hasOwnProperty.call(states, scene.state);
  const hasBareGraph = graphs.some((g) => g && g.id === scene.state);
  if (!hasState && !hasBareGraph) {
    addIssue(issues, 'error', 'missing-projection-state', `state/graph "${scene.state}" is not a key in "${scene.projection}"'s states, nor a graph id`, {});
  }
}

function graphAuditSpec(spec, { specPath } = {}) {
  const scenes = [];
  let errors = 0;
  let warnings = 0;
  const graphScenes = (spec.scenes || [])
    .map((scene, sceneIndex) => ({ scene, sceneIndex }))
    .filter(({ scene }) => scene && scene.type === 'graph');

  for (const { scene, sceneIndex } of graphScenes) {
    const issues = [];
    auditProjectionScene(scene, sceneIndex, specPath, issues);
    const nodeById = new Map((Array.isArray(scene.nodes) ? scene.nodes : []).map((node) => [String(node.id), node]));
    const nodes = Array.isArray(scene.nodes) ? scene.nodes : [];
    const edges = Array.isArray(scene.edges) ? scene.edges : [];
    const nodeIds = new Set(nodes.map((node) => String(node.id)));
    const edgeIds = new Set(edges.map((edge, index) => graphEdgeId(edge, index)));
    const degree = new Map(nodes.map((node) => [String(node.id), 0]));

    for (const edge of edges) {
      const from = String(edge.from || '');
      const to = String(edge.to || '');
      if (!nodeIds.has(from)) addIssue(issues, 'error', 'missing-edge-node', `edge from references missing node "${from}"`, { ref: `edges/${edge.id || `${from}-${to}`}` });
      if (!nodeIds.has(to)) addIssue(issues, 'error', 'missing-edge-node', `edge to references missing node "${to}"`, { ref: `edges/${edge.id || `${from}-${to}`}` });
      if (nodeIds.has(from)) degree.set(from, (degree.get(from) || 0) + 1);
      if (nodeIds.has(to)) degree.set(to, (degree.get(to) || 0) + 1);
      // BUG G-3 fix: GraphScene.vue's edgeLabelOffset() computes a real,
      // position-aware label offset whenever BOTH endpoints have a
      // deterministic position (a grid col/row slot, or a pinned x/y) — that
      // heuristic is not noise, so only warn when at least one endpoint's
      // position is left to a force layout (cose/etc.), where the renderer
      // has nothing to reason from and silently falls back to a static
      // offset that can collide.
      const hasExplicitOffset = Number.isFinite(edge.labelMarginX) || Number.isFinite(edge.labelMarginY)
        || Number.isFinite(edge.labelX) || Number.isFinite(edge.labelY);
      const heuristicCanAnchor = nodeHasResolvablePosition(scene, nodeById.get(from)) && nodeHasResolvablePosition(scene, nodeById.get(to));
      if (edge.label && !hasExplicitOffset && !heuristicCanAnchor) {
        addIssue(issues, 'warning', 'unanchored-edge-label', `edge "${edge.id || `${from}-${to}`}" has a label without explicit label offset, and no grid/pinned position for the renderer's auto-offset heuristic to anchor to`, {
          ref: `edges/${edge.id || `${from}-${to}`}`,
          suggestedPatch: [
            { op: 'add', path: `/scenes/${sceneIndex}/edges/${edges.indexOf(edge)}/labelMarginY`, value: -28 },
          ],
        });
      }
      if ((edge.curve === 0 || edge.curve === null) || edge.controlPointDistances === 0 || edge.controlPointWeights === 0) {
        addIssue(issues, 'warning', 'zero-curve-control', `edge "${edge.id || `${from}-${to}`}" has a zero/null curve control that may trigger Cytoscape warnings`, {
          ref: `edges/${edge.id || `${from}-${to}`}`,
          suggestedPatch: [
            { op: 'replace', path: `/scenes/${sceneIndex}/edges/${edges.indexOf(edge)}/curve`, value: 'bezier' },
          ],
        });
      }
    }

    for (const node of nodes) {
      const id = String(node.id);
      if ((degree.get(id) || 0) === 0 && nodes.length > 1) {
        addIssue(issues, 'warning', 'disconnected-node', `node "${id}" has no incident edges`, { ref: `nodes/${id}` });
      }
      const label = `${node.label || node.id || ''} ${node.sub || ''}`.trim();
      const width = Number(node.w || node.width || 210);
      if (label.length > 28 && width < 260) {
        addIssue(issues, 'warning', 'node-label-fit', `node "${id}" has long label text for a narrow default-sized node`, {
          ref: `nodes/${id}`,
          suggestedPatch: [
            { op: 'add', path: `/scenes/${sceneIndex}/nodes/${nodes.indexOf(node)}/w`, value: 320 },
          ],
        });
      }
    }

    const pathEntries = graphPathEntries(scene);
    const focusedNodes = new Set(pathEntries.map((entry) => String(entry.node)));
    pathEntries.forEach((entry, stepIndex) => {
      const node = String(entry.node);
      if (!nodeIds.has(node)) addIssue(issues, 'error', 'missing-focus-node', `focus step ${stepIndex} references missing node "${node}"`, { step: stepIndex, ref: `path/${stepIndex}` });
      const refs = [entry.edge, ...(Array.isArray(entry.edges) ? entry.edges : [])].filter(Boolean).map(String);
      for (const edgeId of refs) {
        if (!edgeIds.has(edgeId)) addIssue(issues, 'error', 'missing-focus-edge', `focus step ${stepIndex} references missing edge "${edgeId}"`, { step: stepIndex, ref: `path/${stepIndex}` });
      }
      if (!entry.note && entry.view !== 'overview' && entry.overview !== true && entry.fit !== true) {
        addIssue(issues, 'warning', 'missing-focus-note', `focus step ${stepIndex} for node "${node}" has no note`, { step: stepIndex, ref: `path/${stepIndex}` });
      }
    });

    const importantNodes = [...degree.entries()].filter(([, count]) => count >= 3).map(([id]) => id);
    for (const id of importantNodes) {
      if (!focusedNodes.has(id)) addIssue(issues, 'warning', 'unfocused-important-node', `high-degree node "${id}" is not included in the focus path`, { ref: `nodes/${id}` });
    }

    if (nodes.length > 20) {
      addIssue(issues, 'warning', 'dense-overview', `${nodes.length} nodes; overview may be unreadable without strong focus reveals`, { suggestedPatch: [{ op: 'add', path: `/scenes/${sceneIndex}/focusMode`, value: 'neighborhood' }] });
    }
    if (edges.length > Math.max(24, nodes.length * 1.4)) {
      addIssue(issues, 'warning', 'dense-edge-bundle', `${edges.length} edges for ${nodes.length} nodes; overview edge bundles may hide labels`);
    }
    if (nodes.length > 8 && pathEntries.length < Math.ceil(nodes.length / 3)) {
      addIssue(issues, 'warning', 'thin-focus-path', `${pathEntries.length} focus step(s) for ${nodes.length} nodes; dense graph likely needs more reveal interpretation`);
    }

    const overviewScore = issues.some((issue) => issue.kind === 'dense-overview' || issue.kind === 'dense-edge-bundle') ? 'needs_focus' : 'readable';
    const revealScore = issues.some((issue) => issue.kind === 'missing-focus-node' || issue.kind === 'missing-focus-edge') ? 'broken'
      : issues.some((issue) => issue.kind === 'missing-focus-note' || issue.kind === 'thin-focus-path') ? 'needs_work'
        : 'readable';
    errors += issues.filter((issue) => issue.severity === 'error').length;
    warnings += issues.filter((issue) => issue.severity === 'warning').length;
    scenes.push({
      scene: sceneIndex,
      title: sceneTitle(scene),
      nodes: nodes.length,
      edges: edges.length,
      focusSteps: pathEntries.length,
      overviewScore,
      revealScore,
      issues,
    });
  }

  return {
    status: errors ? 'failed' : warnings ? 'needs_work' : 'passed',
    summary: { graphScenes: scenes.length, errors, warnings },
    scenes,
  };
}

function resolvedPronunciationMap(spec) {
  const pronunciations = spec && spec.meta && spec.meta.narration && spec.meta.narration.pronunciations;
  if (!pronunciations || typeof pronunciations !== 'object' || Array.isArray(pronunciations)) return {};
  return Object.fromEntries(Object.entries(pronunciations)
    .filter(([term, spokenAs]) => term && typeof spokenAs === 'string' && spokenAs));
}

async function narrationPlanForSpec(spec, specPath) {
  const { stepsForScene } = await import(pathToFileURL(path.join(ROOT_DIR, 'web', 'sceneSteps.mjs')).href);
  const scenes = [];
  const issues = [];
  const decks = [];
  const resolvedDecks = [{ id: '__source', title: (spec.meta && spec.meta.title) || 'Full deck', spec }];
  for (const deck of normalizeDeckDefinitions(spec)) {
    if (deck.source) continue;
    const resolved = resolveDeckSpec(spec, { deckId: deck.id });
    if (resolved.deck && resolved.deck.id === deck.id) {
      resolvedDecks.push({ id: deck.id, title: deck.title || deck.id, spec: resolved.spec });
    }
  }

  for (const deck of resolvedDecks) {
    const pronunciationMap = resolvedPronunciationMap(deck.spec);
    const deckScenes = [];
    for (const [sceneIndex, scene] of (deck.spec.scenes || []).entries()) {
      const steps = stepsForScene(scene);
      const sceneNarration = Array.isArray(scene.narration)
        ? scene.narration.map((cue) => cue && cue.text).filter(Boolean)
        : (scene.narration ? [String(scene.narration)] : []);
      const entries = [];
      const pushEntry = (stepIndex, state, text, source, ref = null) => {
        const normalized = String(text || '').trim();
        const pronunciation = applyPronunciationsWithDetails(normalized, pronunciationMap);
        entries.push({ stepIndex, state, source, ref, text: normalized, spokenText: pronunciation.text, appliedTerms: pronunciation.appliedTerms, wordCount: normalized ? normalized.split(/\s+/).length : 0 });
      };

      if (scene.type === 'graph') {
        const pathEntries = graphPathEntries(scene);
        let stepIndex = 0;
        if (scene.title) pushEntry(stepIndex++, 'graph_title', sceneNarration[0] || scene.title, sceneNarration[0] ? 'scene.narration' : 'title');
        pushEntry(stepIndex++, 'graph_frame', sceneNarration[stepIndex - 1] || '', sceneNarration[stepIndex - 1] ? 'scene.narration' : 'none');
        pathEntries.forEach((entry, focusIndex) => {
          const fallback = entry.note || '';
          pushEntry(stepIndex++, `graph_focus_${focusIndex}`, sceneNarration[stepIndex - 1] || fallback, sceneNarration[stepIndex - 1] ? 'scene.narration' : (fallback ? 'focus.note' : 'none'), `path/${focusIndex}`);
          if (!entry.note) addIssue(issues, 'warning', 'missing-graph-focus-note', `deck ${deck.id} scene ${sceneIndex} focus step ${focusIndex} has no focus note`, { deck: deck.id, scene: sceneIndex, step: focusIndex });
        });
        if (scene.caption) pushEntry(stepIndex++, 'graph_caption', scene.narrateCaption === false || scene.captionNarration === false ? '' : scene.caption, 'caption');
      } else {
        const pageSteps = steps.length ? steps : [null];
        pageSteps.forEach((state, stepIndex) => {
          const text = sceneNarration[stepIndex] || (stepIndex === 0 ? (scene.narration || '') : '');
          pushEntry(stepIndex, state, text, text ? 'scene.narration' : 'none');
        });
      }

      const repeated = new Set();
      for (const entry of entries) {
        if (entry.wordCount > 70) addIssue(issues, 'warning', 'long-reveal-narration', `deck ${deck.id} scene ${sceneIndex} step ${entry.stepIndex} has ${entry.wordCount} narration words`, { deck: deck.id, scene: sceneIndex, step: entry.stepIndex });
        if (entry.text) {
          const key = entry.text.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
          if (repeated.has(key)) addIssue(issues, 'warning', 'repeated-narration', `deck ${deck.id} scene ${sceneIndex} repeats narration text across reveal steps`, { deck: deck.id, scene: sceneIndex, step: entry.stepIndex });
          repeated.add(key);
        }
      }
      if (scene.caption && scene.narration && scene.caption === scene.narration) {
        addIssue(issues, 'warning', 'caption-as-narration', `deck ${deck.id} scene ${sceneIndex} caption exactly matches slide narration`, { deck: deck.id, scene: sceneIndex });
      }
      const scenePlan = { deck: deck.id, scene: sceneIndex, title: sceneTitle(scene), type: scene.type, steps: entries };
      scenes.push(scenePlan);
      deckScenes.push(scenePlan);
    }
    decks.push({ id: deck.id, title: deck.title, pronunciationMap, scenes: deckScenes });
  }
  return {
    path: specPath ? relPath(specPath) : undefined,
    status: issues.some((issue) => issue.severity === 'error') ? 'failed' : issues.length ? 'needs_work' : 'passed',
    summary: { decks: decks.length, scenes: scenes.length, issues: issues.length },
    issues,
    pronunciationMap: decks[0].pronunciationMap,
    decks,
    scenes,
  };
}

function summarizeSpec(spec) {
  return {
    sceneCount: Array.isArray(spec.scenes) ? spec.scenes.length : 0,
    scenes: (spec.scenes || []).map((scene, sceneIndex) => ({
      scene: sceneIndex,
      type: scene.type,
      title: sceneTitle(scene),
    })),
  };
}

function diffArrays(before = [], after = [], keyFn) {
  const beforeMap = new Map(before.map((item, index) => [keyFn(item, index), { item, index }]));
  const afterMap = new Map(after.map((item, index) => [keyFn(item, index), { item, index }]));
  return {
    added: [...afterMap.entries()].filter(([key]) => !beforeMap.has(key)).map(([key, value]) => ({ id: key, index: value.index })),
    removed: [...beforeMap.entries()].filter(([key]) => !afterMap.has(key)).map(([key, value]) => ({ id: key, index: value.index })),
    retained: [...afterMap.entries()].filter(([key]) => beforeMap.has(key)).map(([key, value]) => ({ id: key, beforeIndex: beforeMap.get(key).index, afterIndex: value.index })),
  };
}

async function diffDecks(beforePath, afterPath) {
  const beforeRead = readSpecFile(beforePath);
  const afterRead = readSpecFile(afterPath);
  const beforeScenes = beforeRead.spec.scenes || [];
  const afterScenes = afterRead.spec.scenes || [];
  const sceneCount = Math.max(beforeScenes.length, afterScenes.length);
  const scenes = [];
  for (let i = 0; i < sceneCount; i++) {
    const before = beforeScenes[i] || null;
    const after = afterScenes[i] || null;
    if (!before || !after) {
      scenes.push({ scene: i, change: before ? 'removed' : 'added', before: before && { type: before.type, title: sceneTitle(before) }, after: after && { type: after.type, title: sceneTitle(after) } });
      continue;
    }
    const changes = [];
    for (const field of ['type', 'title', 'headline', 'eyebrow', 'body', 'caption', 'narration']) {
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) changes.push({ field, before: before[field], after: after[field] });
    }
    if (before.type === 'graph' || after.type === 'graph') {
      const nodes = diffArrays(before.nodes || [], after.nodes || [], (node, index) => String(node.id || index));
      const edges = diffArrays(before.edges || [], after.edges || [], graphEdgeId);
      const pathChanged = JSON.stringify(before.path || before.focus || []) !== JSON.stringify(after.path || after.focus || []);
      if (nodes.added.length || nodes.removed.length) changes.push({ field: 'graph.nodes', ...nodes });
      if (edges.added.length || edges.removed.length) changes.push({ field: 'graph.edges', ...edges });
      if (pathChanged) changes.push({ field: 'graph.path', before: before.path || before.focus || [], after: after.path || after.focus || [] });
    }
    if (changes.length) scenes.push({ scene: i, change: 'modified', before: { type: before.type, title: sceneTitle(before) }, after: { type: after.type, title: sceneTitle(after) }, changes });
  }
  return {
    before: relPath(beforeRead.abs),
    after: relPath(afterRead.abs),
    summary: { changedScenes: scenes.length, beforeScenes: beforeScenes.length, afterScenes: afterScenes.length },
    scenes,
  };
}

async function reviewDeck(args) {
  const { abs, spec } = readSpecFile(args.path);
  const validation = validateSpec(spec, { specPath: abs });
  const { value: checkViolations, output: checkOutput } = captureConsole(() => runCheck(spec));
  const graphAudit = graphAuditSpec(spec, { specPath: abs });
  const narrationPlan = await narrationPlanForSpec(spec, abs);
  let browserAudit = null;
  if (args.browserAudit !== false) {
    try {
      const report = await auditSpec(spec, { specPath: abs });
      browserAudit = { ok: true, ...report };
    } catch (err) {
      browserAudit = { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }
  const issueCount = (validation.errors || []).length
    + checkViolations
    + graphAudit.summary.errors
    + graphAudit.summary.warnings
    + narrationPlan.summary.issues
    + (browserAudit && browserAudit.ok ? browserAudit.summary.findings : 0)
    + (browserAudit && browserAudit.ok === false ? 1 : 0);
  const status = !validation.valid || checkViolations || graphAudit.summary.errors || (browserAudit && browserAudit.ok && browserAudit.summary.errors)
    ? 'failed'
    : issueCount ? 'needs_work' : 'passed';
  return {
    path: relPath(abs),
    status,
    summary: {
      scenes: (spec.scenes || []).length,
      issues: issueCount,
      validationErrors: (validation.errors || []).length,
      checkViolations,
      graphWarnings: graphAudit.summary.warnings,
      narrationIssues: narrationPlan.summary.issues,
      browserFindings: browserAudit && browserAudit.ok ? browserAudit.summary.findings : null,
    },
    validation,
    check: { violations: checkViolations, output: checkOutput },
    graphAudit,
    narrationPlan,
    browserAudit,
  };
}

async function contactSheet(args) {
  const { abs, spec: fileSpec } = readSpecFile(args.path);
  let spec = fileSpec;
  let deckId = null;
  let deckTitle = null;
  if (args.deck != null) {
    const resolved = resolveDeckSpec(fileSpec, { deckId: String(args.deck) });
    if (!resolved.deck || resolved.deck.id !== String(args.deck)) {
      const known = (resolved.decks || []).filter((d) => !d.source).map((d) => d.id);
      throw new Error(`unknown library deck "${args.deck}"${known.length ? ` — known decks: ${known.join(', ')}` : ''}`);
    }
    spec = resolved.spec;
    deckId = resolved.deck.id;
    deckTitle = resolved.deck.title || deckId;
  }
  const { stepsForScene } = await import(pathToFileURL(path.join(ROOT_DIR, 'web', 'sceneSteps.mjs')).href);
  const scenes = Array.isArray(args.scenes) && args.scenes.length ? args.scenes : (spec.scenes || []).map((_, i) => i);
  const outDir = safeResolve(args.outDir || '.artifacts/slidey-contact-sheet');
  fs.mkdirSync(outDir, { recursive: true });
  const captures = [];
  for (const sceneIndex of scenes) {
    clampSceneIndex(sceneIndex, (spec.scenes || []).length);
    const scene = spec.scenes[sceneIndex];
    const steps = stepsForScene(scene);
    const pageSteps = steps.length ? steps : [null];
    const selected = args.steps === 'all'
      ? pageSteps.map((_, i) => i)
      : args.steps === 'focus'
        ? pageSteps.map((step, i) => [step, i]).filter(([step]) => /^graph_focus_/.test(String(step))).map(([, i]) => i)
        : [pageSteps.length - 1];
    for (const stepIndex of selected) {
      const session = await loadRenderPage(spec, abs, sceneIndex, stepIndex);
      try {
        const filePrefix = deckId ? `${deckId}-` : '';
        const file = `${filePrefix}scene-${String(sceneIndex).padStart(3, '0')}-step-${String(stepIndex + 1).padStart(3, '0')}.png`;
        const fileAbs = path.join(outDir, file);
        await session.page.screenshot({ path: fileAbs, type: 'png' });
        captures.push({
          deck: deckId,
          scene: sceneIndex,
          title: sceneTitle(scene),
          stepIndex,
          step: session.step,
          focus: /^graph_focus_/.test(String(session.step)) ? graphPathEntries(scene)[Number(String(session.step).replace('graph_focus_', ''))] || null : null,
          path: relPath(fileAbs),
        });
      } finally {
        await closeBrowser(session.browser);
      }
    }
  }
  const htmlPath = path.join(outDir, 'index.html');
  const html = [
    '<!doctype html><meta charset="utf-8"><title>Slidey contact sheet</title>',
    '<style>body{font-family:system-ui,sans-serif;margin:24px;background:#111;color:#eee}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:18px}figure{margin:0;border:1px solid #333;padding:10px;background:#181818}img{width:100%;display:block}figcaption{font-size:13px;line-height:1.4;color:#ccc;margin-top:8px}</style>',
    '<div class="grid">',
    ...captures.map((capture) => `<figure><img src="${path.basename(capture.path)}"><figcaption>Scene ${capture.scene}, step ${capture.stepIndex + 1}: ${escapeHtml(capture.title || '')}<br>${escapeHtml(capture.step || '')}${capture.focus && capture.focus.note ? `<br>${escapeHtml(capture.focus.note)}` : ''}</figcaption></figure>`),
    '</div>',
  ].join('\n');
  fs.writeFileSync(htmlPath, html);
  return { path: relPath(htmlPath), deck: deckId, deckTitle, captures };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function prepareReviewArtifact(args) {
  const { abs, spec } = readSpecFile(args.path);
  const outDir = safeResolve(args.outDir || `.artifacts/slidey-review/${path.basename(abs).replace(/\W+/g, '-')}`);
  fs.mkdirSync(outDir, { recursive: true });
  const review = await reviewDeck({ path: args.path, browserAudit: args.browserAudit === true });
  const validationPath = path.join(outDir, 'validation.json');
  const graphPath = path.join(outDir, 'graph-audit.json');
  const narrationPath = path.join(outDir, 'narration-plan.json');
  const summaryPath = path.join(outDir, 'deck-summary.json');
  const reviewPath = path.join(outDir, 'review.json');
  fs.writeFileSync(validationPath, JSON.stringify(review.validation, null, 2) + '\n');
  fs.writeFileSync(graphPath, JSON.stringify(review.graphAudit, null, 2) + '\n');
  fs.writeFileSync(narrationPath, JSON.stringify(review.narrationPlan, null, 2) + '\n');
  fs.writeFileSync(summaryPath, JSON.stringify(summarizeSpec(spec), null, 2) + '\n');
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2) + '\n');
  let bundled = null;
  if (args.bundle !== false) {
    const htmlOut = path.join(outDir, `${path.basename(abs).replace(/\.slidey\.json$/i, '').replace(/\.json$/i, '')}.html`);
    try {
      bundleSpec(abs, spec, htmlOut, { skipValidate: args.skipValidate === true });
      bundled = relPath(htmlOut);
    } catch (err) {
      review.bundleError = err && err.message ? err.message : String(err);
      fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2) + '\n');
    }
  }
  return {
    path: relPath(outDir),
    status: review.status,
    bundled,
    files: [validationPath, graphPath, narrationPath, summaryPath, reviewPath].map(relPath),
  };
}

const TOOLS = [
  {
    name: 'slidey_workspace_tree',
    description: 'List Slidey .slidey.json specs, read-only .readonly.slidey.json specs, and generated .jsonl trace specs.',
    inputSchema: toolInputSchema({}),
  },
  {
    name: 'slidey_read_spec',
    description: 'Read a Slidey spec. .jsonl traces and .readonly.slidey.json decks are returned read-only.',
    inputSchema: toolInputSchema({
      path: { type: 'string', description: 'Workspace-relative .slidey.json, .readonly.slidey.json, or .jsonl path.' },
    }, ['path']),
  },
  {
    name: 'slidey_deck_overview',
    description: 'Return a compact deck overview: metadata, top-level slide outline, and library-deck hierarchy. Use this before reading a full spec.',
    inputSchema: toolInputSchema({
      path: { type: 'string', description: 'Workspace-relative .slidey.json, .readonly.slidey.json, or .jsonl path.' },
    }, ['path']),
  },
  {
    name: 'slidey_read_slide',
    description: 'Read one complete slide without returning the whole deck. Address it with top-level sceneIndex (legacy), or scene id; pass deck to scope an id or index to a library hierarchy deck.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      sceneIndex: { type: 'integer', minimum: 0, description: 'Top-level slide index, or the local index when deck is set. Ignored if scene is given.' },
      scene: { type: 'string', description: 'Slide id or key, resolved across top-level and library hierarchy decks unless deck is set.' },
      deck: { type: 'string', description: 'Library hierarchy deck id to scope scene or sceneIndex.' },
    }, ['path']),
  },
  {
    name: 'slidey_search_slides',
    description: 'Search compact slide text (titles, body, captions, and narration) across top-level and library hierarchy decks without reading full slide JSON.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      query: { type: 'string', minLength: 1, description: 'Case-insensitive text to find.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum matching slides to return (default 20).' },
    }, ['path', 'query']),
  },
  {
    name: 'slidey_write_spec',
    description: 'Replace an editable Slidey spec with a full JSON object. New decks should use the .slidey.json extension (e.g. my-deck.slidey.json). Pass the `version` from slidey_read_spec as baseVersion so a concurrent edit (e.g. the human editing in the viewer) is reported as a conflict instead of being clobbered; resolve with force:true to overwrite (OURS) or re-read and re-apply (THEIRS).',
    inputSchema: toolInputSchema({
      path: { type: 'string', description: 'Workspace-relative path; use the .slidey.json extension for new decks.' },
      spec: { type: 'object' },
      baseVersion: { type: 'string', description: 'Optional content version from the last slidey_read_spec. A mismatch aborts the write as a conflict.' },
      force: { type: 'boolean', description: 'Overwrite even if the file changed since baseVersion (OURS). Defaults to false.' },
    }, ['path', 'spec']),
  },
  {
    name: 'slidey_patch_spec',
    description: 'Edit an editable .slidey.json spec with JSON Patch operations: add, replace, remove, and test. Patches apply to the freshest on-disk content, so concurrent edits are preserved; pass baseVersion to also fail loudly if the file changed since you last read it.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      baseVersion: { type: 'string', description: 'Optional content version from the last slidey_read_spec. A mismatch aborts the patch as a conflict.' },
      force: { type: 'boolean', description: 'Apply even if the file changed since baseVersion (OURS). Defaults to false.' },
      operations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          required: ['op', 'path'],
          properties: {
            op: { enum: ['add', 'replace', 'remove', 'test'] },
            path: { type: 'string', description: 'JSON Pointer, e.g. /scenes/0/title.' },
            value: {},
          },
        },
      },
    }, ['path', 'operations']),
  },
  {
    name: 'slidey_layout_gallery',
    description: 'List reusable scene layouts that can be inserted as new slides. Pass path to include packs beside that deck.',
    inputSchema: toolInputSchema({
      path: { type: 'string', description: 'Optional deck path used to resolve project-local Slidey packs.' },
    }),
  },
  {
    name: 'slidey_add_slide',
    description: 'Add a new slide from the layout gallery.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      layout: { type: 'string', description: 'One of the IDs returned by slidey_layout_gallery.' },
      insertIndex: {
        type: 'integer',
        minimum: 0,
        description: 'Insert position in scenes array. Defaults to append to end.',
      },
    }, ['path', 'layout']),
  },
  {
    name: 'slidey_meme_search',
    description: 'Search the meme-template registry (200+ templates). Each result lists the template id, orientation, and its semantic caption fields with example hints. Use the id with slidey_add_meme.',
    inputSchema: toolInputSchema({
      query: { type: 'string', description: 'Free-text query matched against template name, id, keywords, and example captions. Empty returns a sample.' },
      orientation: { type: 'string', enum: ['landscape', 'portrait', 'square'], description: 'Optional filter to fit a particular slot.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max results (default 20).' },
    }),
  },
  {
    name: 'slidey_add_meme',
    description: 'Add a meme slide built from a registry template (find ids with slidey_meme_search). Fill captions via `text` (positional, by box order) or `fields` (keyed by field name); omit both to seed the template\'s example captions.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      template: { type: 'string', description: 'Meme template id from slidey_meme_search, e.g. "db", "drake".' },
      text: { type: 'array', items: { type: 'string' }, description: 'Captions in box order.' },
      fields: { type: 'object', additionalProperties: { type: 'string' }, description: 'Captions keyed by the template field names.' },
      title: { type: 'string', description: 'Optional eyebrow header.' },
      caption: { type: 'string', description: 'Optional footer line.' },
      narration: { type: 'string', description: 'Optional narration for the slide.' },
      insertIndex: { type: 'integer', minimum: 0, description: 'Insert position. Defaults to append.' },
    }, ['path', 'template']),
  },
  {
    name: 'slidey_duplicate_slide',
    description: 'Duplicate a slide and insert it after the original by default.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      sourceIndex: { type: 'integer', minimum: 0, description: 'Index of the source scene to duplicate.' },
      insertIndex: {
        type: 'integer',
        minimum: 0,
        description: 'Insert position in scenes array. Defaults to sourceIndex + 1.',
      },
    }, ['path', 'sourceIndex']),
  },
  {
    name: 'slidey_remove_slide',
    description: 'Remove a slide from a deck.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      sceneIndex: { type: 'integer', minimum: 0, description: 'Index of the scene to remove.' },
    }, ['path', 'sceneIndex']),
  },
  {
    name: 'slidey_reorder_slide',
    description: 'Move a slide from one index to another.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      fromIndex: { type: 'integer', minimum: 0, description: 'Source index to move.' },
      toIndex: { type: 'integer', minimum: 0, description: 'Destination index in the resulting scenes array.' },
    }, ['path', 'fromIndex', 'toIndex']),
  },
  {
    name: 'slidey_validate',
    description: 'Validate a spec against Slidey JSON Schema and semantic checks. Also schema-validates every library.decks[] hierarchy deck\'s inline scenes (errors are labeled library.decks["<id>"].scenes[<i>]). Returns structured errors and warnings.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
    }, ['path']),
  },
  {
    name: 'slidey_scene_summary',
    description: 'Return scene indices, types, titles, reveal steps, estimated timing, and narration snippets.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      fps: { type: 'number', default: 30 },
    }, ['path']),
  },
  {
    name: 'slidey_render_png',
    description: 'Render a particular scene/reveal step as a PNG image using the real Slidey Vue render bundle. For a video/rrweb scene, returns a REAL replay frame seeked headlessly via rrweb (pass atSecond to scrub to any moment). Address the scene with sceneIndex (top-level index, legacy) or scene (a scene id string, resolved across top-level scenes AND every library.decks[] hierarchy deck — pass deck to scope/disambiguate).',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      sceneIndex: { type: 'integer', minimum: 0, description: 'Top-level scene index. Ignored if scene is given. With deck set, indexes that deck\'s own scenes instead.' },
      scene: { type: 'string', description: 'Scene id. Resolved across top-level scenes and every library hierarchy deck when deck is omitted; scoped to one deck when deck is set. Errors listing candidates if ambiguous.' },
      deck: { type: 'string', description: 'Library deck id (library.decks[].id) to scope/resolve sceneIndex or scene against.' },
      stepIndex: { type: 'integer', minimum: 0, description: 'Reveal step index. Omit for final step of the scene.' },
      atSecond: { type: 'number', minimum: 0, description: 'For a video/rrweb scene: replay time (seconds) to seek to before screenshotting. Omit to use the scene start. Clamped to the clip duration.' },
    }, ['path']),
  },
  {
    name: 'slidey_bundle',
    description: 'Render a spec to a single self-contained, interactive HTML deck (the rrweb replay plays in-browser, no external assets). Validates first, then writes the .html. This is the MCP equivalent of `slidey bundle` — no CLI needed.',
    inputSchema: toolInputSchema({
      path: { type: 'string', description: 'Workspace-relative (or absolute) .slidey.json spec to bundle.' },
      out: { type: 'string', description: 'Output .html path. Defaults to the spec path with a .html extension.' },
      skipValidate: { type: 'boolean', description: 'Bundle even if validation reports problems (default false).' },
    }, ['path']),
  },
  {
    name: 'slidey_render_html',
    description: 'Render a particular scene/reveal step and return the HTML snapshot of the rendered slide. Address the scene with sceneIndex (top-level index, legacy) or scene (a scene id string, resolved across top-level scenes AND every library.decks[] hierarchy deck — pass deck to scope/disambiguate).',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      sceneIndex: { type: 'integer', minimum: 0, description: 'Top-level scene index. Ignored if scene is given. With deck set, indexes that deck\'s own scenes instead.' },
      scene: { type: 'string', description: 'Scene id. Resolved across top-level scenes and every library hierarchy deck when deck is omitted; scoped to one deck when deck is set. Errors listing candidates if ambiguous.' },
      deck: { type: 'string', description: 'Library deck id (library.decks[].id) to scope/resolve sceneIndex or scene against.' },
      stepIndex: { type: 'integer', minimum: 0, description: 'Reveal step index. Omit for final step of the scene.' },
    }, ['path']),
  },
  {
    name: 'slidey_check',
    description: 'Run Slidey static diagram-svg geometry checks and return the report. Walks top-level scenes AND every library.decks[] hierarchy deck\'s own scenes; findings from a library deck are labeled "library.decks[\\"<id>\\"]" in the output.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
    }, ['path']),
  },
  {
    name: 'slidey_audit',
    description: 'Run the browser-based rendered geometry audit. This catches off-page content, overflow, overlap, tiny text, contrast, broken images, and template leaks.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      deck: { type: 'string', description: 'Library deck id (library.decks[].id). When set, audits that deck\'s own scenes instead of the top-level scenes[]; sceneIndex then indexes within that deck.' },
      sceneIndex: { type: 'integer', minimum: 0, description: 'Optional single scene to audit (within the top-level deck, or within `deck` when set).' },
    }, ['path']),
  },
  {
    name: 'slidey_review_deck',
    description: 'Run the deck-review workbench pass: schema validation, static checks, graph audit, narration plan, and browser visual audit by default.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      browserAudit: { type: 'boolean', description: 'Run browser visual QA. Defaults true; set false for a fast semantic review.' },
    }, ['path']),
  },
  {
    name: 'slidey_graph_audit',
    description: 'Run graph-specific QA for Cytoscape scenes: node/edge references, disconnected nodes, focus-path coverage, label risks, dense overviews, and suggested JSON patches.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
    }, ['path']),
  },
  {
    name: 'slidey_contact_sheet',
    description: 'Render scene/reveal screenshots into an inspectable HTML contact sheet. Use steps:"focus" for graph focus reveals, "all" for all reveals, or omit for final frames. Pass deck to capture a library.decks[] hierarchy deck\'s own scenes instead of the top-level deck.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      deck: { type: 'string', description: 'Library deck id (library.decks[].id). When set, scenes/scene indices are resolved against that deck\'s own scenes instead of the top-level scenes[].' },
      scenes: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'Scene indices to capture (within the top-level deck, or within `deck` when set). Defaults to all scenes in scope.' },
      steps: { type: 'string', enum: ['final', 'focus', 'all'], description: 'Which reveal steps to capture. Defaults to final.' },
      outDir: { type: 'string', description: 'Output directory. Defaults to .artifacts/slidey-contact-sheet.' },
    }, ['path']),
  },
  {
    name: 'slidey_narration_plan',
    description: 'Report resolved pronunciation maps plus raw and spoken narration, applied terms, timing-sized reveal chunks, graph focus notes, and narration risks for top-level and nested library decks.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
    }, ['path']),
  },
  {
    name: 'slidey_diff_deck',
    description: 'Summarize semantic differences between two decks: scene changes, text/narration changes, graph node/edge changes, and focus-path changes.',
    inputSchema: toolInputSchema({
      beforePath: { type: 'string' },
      afterPath: { type: 'string' },
    }, ['beforePath', 'afterPath']),
  },
  {
    name: 'slidey_prepare_review_artifact',
    description: 'Write a review bundle under .artifacts: bundled HTML, validation JSON, graph audit, narration plan, deck summary, and aggregate review JSON.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      outDir: { type: 'string', description: 'Output directory. Defaults to .artifacts/slidey-review/<deck>.' },
      bundle: { type: 'boolean', description: 'Write bundled HTML. Defaults true.' },
      skipValidate: { type: 'boolean', description: 'Bundle even if validation reports problems. Defaults false.' },
      browserAudit: { type: 'boolean', description: 'Include browser visual audit in the aggregate review. Defaults false for artifact speed/reliability.' },
    }, ['path']),
  },
  {
    name: 'slidey_schema',
    description: 'Return the authoritative Slidey JSON Schema used by validation and the editor.',
    inputSchema: toolInputSchema({}),
  },
  {
    name: 'slidey_docs',
    description: 'Return the bundled LLM authoring guide for Slidey specs.',
    inputSchema: toolInputSchema({}),
  },
  {
    name: 'slidey_doctor',
    description: 'Verify the local Slidey export toolchain: packages, browser, ffmpeg/ffprobe, and optional Edge TTS narration.',
    inputSchema: toolInputSchema({
      narration: { type: 'boolean', description: 'Check narrated MP4 dependencies. Default true.' },
      ttsSample: { type: 'boolean', description: 'Generate a tiny online Edge TTS sample. Default true when narration is true.' },
      browser: { type: 'boolean', description: 'Launch the headless browser and take a screenshot. Default true.' },
      voice: { type: 'string', description: 'Edge TTS voice to test. Default en-AU-NatashaNeural.' },
    }),
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case 'slidey_workspace_tree':
      return okResult({ root: CONFIG.root, children: buildTree(CONFIG.root) });

    case 'slidey_read_spec': {
      const { abs, raw, spec, generated, editable, version } = readSpecFile(args.path);
      return okResult({ path: relPath(abs), generated, editable: editable, raw: generated ? undefined : raw, spec, version });
    }

    case 'slidey_deck_overview': {
      const { abs, spec, generated, editable, version } = readSpecFile(args.path);
      return okResult({
        path: relPath(abs),
        generated,
        editable,
        version,
        ...deckOverview(spec),
      });
    }

    case 'slidey_read_slide': {
      const { abs, spec, generated, editable, version } = readSpecFile(args.path);
      const resolved = resolveSceneAddress(spec, args);
      const slide = resolved.spec.scenes[resolved.sceneIndex];
      return okResult({
        path: relPath(abs),
        generated,
        editable,
        version,
        ...compactSceneOutline(slide, resolved.sceneIndex, resolved.deckId, resolved.deckTitle),
        slide,
      });
    }

    case 'slidey_search_slides': {
      const { abs, spec } = readSpecFile(args.path);
      const query = String(args.query || '').trim();
      if (!query) throw new Error('query must not be empty');
      const limit = Number.isInteger(args.limit) ? args.limit : 20;
      const matches = [];
      for (const entry of addressableScenes(spec).entries) {
        const fields = searchableText(entry.scene)
          .filter(({ text }) => text.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
          .map(({ field, text }) => ({ field, excerpt: excerpt(text, query) }));
        if (!fields.length) continue;
        matches.push({
          ...compactSceneOutline(entry.scene, entry.index, entry.deckId, entry.deckTitle),
          matches: fields,
        });
        if (matches.length >= limit) break;
      }
      return okResult({ path: relPath(abs), query, count: matches.length, matches });
    }

    case 'slidey_write_spec': {
      const written = writeSpecFile(args.path, args.spec, { baseVersion: args.baseVersion, force: args.force });
      const validation = validateSpec(args.spec, { specPath: safeResolve(args.path) });
      return okResult({ ok: validation.valid, written, validation });
    }

    case 'slidey_patch_spec': {
      const { abs, spec, version } = readSpecFile(args.path);
      ensureEditable(abs);
      const patched = applyJsonPatch(spec, args.operations);
      // Guard the just-read version so an interleaving write between this read
      // and our write is caught (force:true overrides). Patches still apply to
      // the freshest on-disk content, so they incorporate concurrent edits.
      const written = writeSpecFile(args.path, patched, {
        baseVersion: args.baseVersion || version,
        force: args.force,
      });
      const validation = validateSpec(patched, { specPath: abs });
      return okResult({ ok: validation.valid, written, validation, sceneCount: Array.isArray(patched.scenes) ? patched.scenes.length : 0 });
    }
    case 'slidey_layout_gallery': {
      let gallerySpecPath = null;
      let gallerySpec = {};
      if (args.path) {
        const read = readSpecFile(args.path);
        gallerySpecPath = read.abs;
        gallerySpec = read.spec;
      }
      const gallery = layoutGalleryForSpec(gallerySpecPath, gallerySpec);
      return okResult({
        layouts: gallery.map((entry) => ({
          id: entry.id,
          label: entry.label,
          type: entry.scene.type,
          scene: entry.scene,
          pack: entry.pack,
        })),
      });
    }

    case 'slidey_add_slide': {
      const { abs, spec } = readSpecFile(args.path);
      ensureEditable(abs);
      const scenes = cloneSpecValue(Array.isArray(spec.scenes) ? spec.scenes : []);
      const layout = layoutById(args.layout, abs, spec);
      if (!layout) {
        const validLayouts = layoutGalleryForSpec(abs, spec).map((entry) => entry.id).join(', ');
        throw new Error(`unknown layout "${args.layout}". use slidey_layout_gallery to list valid values: ${validLayouts}`);
      }
      const insertIndex = clampIndexForInsert(args.insertIndex, scenes.length);
      const scene = sanitizeScene(layout.scene);
      scenes.splice(insertIndex, 0, scene);
      const updated = { ...spec, scenes };
      const written = writeSpecFile(args.path, updated);
      const validation = validateSpec(updated, { specPath: abs });
      return okResult({ ok: validation.valid, written, validation, sceneIndex: insertIndex, scene, sceneCount: updated.scenes.length });
    }

    case 'slidey_meme_search': {
      const memes = require('./memes/registry');
      const matches = memes.search(args.query || '', {
        orientation: args.orientation || null,
        limit: Number.isInteger(args.limit) ? args.limit : 20,
      });
      return okResult({ count: matches.length, matches });
    }

    case 'slidey_add_meme': {
      const memes = require('./memes/registry');
      const template = memes.get(args.template);
      if (!template) {
        const hits = memes.search(args.template || '', { limit: 8 })
          .map((m) => `${m.id} (${m.name})`).join(', ');
        throw new Error(`unknown meme template "${args.template}". search with slidey_meme_search.${hits ? ` did you mean: ${hits}` : ''}`);
      }
      const { abs, spec } = readSpecFile(args.path);
      ensureEditable(abs);
      const scenes = cloneSpecValue(Array.isArray(spec.scenes) ? spec.scenes : []);
      const insertIndex = clampIndexForInsert(args.insertIndex, scenes.length);
      const scene = { type: 'meme', template: template.id };
      if (args.title) scene.title = String(args.title);
      if (args.fields && typeof args.fields === 'object') scene.fields = { ...args.fields };
      if (Array.isArray(args.text)) scene.text = args.text.map((t) => String(t ?? ''));
      // No captions supplied → seed the template's example captions so the slide
      // renders something meaningful out of the box.
      if (!scene.fields && !scene.text) {
        scene.text = (template.example || template.boxes.map((b) => b.hint || '')).map((t) => String(t ?? ''));
      }
      if (args.caption) scene.caption = String(args.caption);
      if (args.narration) scene.narration = String(args.narration);
      scenes.splice(insertIndex, 0, scene);
      const updated = { ...spec, scenes };
      const written = writeSpecFile(args.path, updated);
      const validation = validateSpec(updated, { specPath: abs });
      return okResult({
        ok: validation.valid, written, validation,
        sceneIndex: insertIndex, scene,
        template: memes.summary(template),
        sceneCount: updated.scenes.length,
      });
    }

    case 'slidey_duplicate_slide': {
      const { abs, spec } = readSpecFile(args.path);
      ensureEditable(abs);
      const scenes = cloneSpecValue(Array.isArray(spec.scenes) ? spec.scenes : []);
      const sourceIndex = clampSceneIndex(args.sourceIndex, scenes.length);
      const insertIndex = clampIndexForInsert(
        Number.isInteger(args.insertIndex) ? args.insertIndex : sourceIndex + 1,
        scenes.length + 1,
      );
      const scene = sanitizeScene(scenes[sourceIndex]);
      scenes.splice(insertIndex, 0, scene);
      const updated = { ...spec, scenes };
      const written = writeSpecFile(args.path, updated);
      const validation = validateSpec(updated, { specPath: abs });
      return okResult({
        ok: validation.valid,
        written,
        validation,
        sourceIndex,
        sceneIndex: insertIndex,
        scene,
        sceneCount: updated.scenes.length,
      });
    }

    case 'slidey_remove_slide': {
      const { abs, spec } = readSpecFile(args.path);
      ensureEditable(abs);
      const scenes = cloneSpecValue(Array.isArray(spec.scenes) ? spec.scenes : []);
      if (scenes.length <= 1) throw new Error('deck must contain at least one scene');
      const sceneIndex = clampSceneIndex(args.sceneIndex, scenes.length);
      const removed = scenes.splice(sceneIndex, 1)[0];
      const updated = { ...spec, scenes };
      const written = writeSpecFile(args.path, updated);
      const validation = validateSpec(updated, { specPath: abs });
      return okResult({
        ok: validation.valid,
        written,
        validation,
        removedSceneIndex: sceneIndex,
        scene: removed,
        sceneCount: updated.scenes.length,
      });
    }

    case 'slidey_reorder_slide': {
      const { abs, spec } = readSpecFile(args.path);
      ensureEditable(abs);
      const scenes = cloneSpecValue(Array.isArray(spec.scenes) ? spec.scenes : []);
      const fromIndex = clampSceneIndex(args.fromIndex, scenes.length);
      const toIndex = clampSceneIndex(args.toIndex, scenes.length);
      if (fromIndex === toIndex) {
        return okResult({ ok: true, written: { path: relPath(abs), bytes: 0, mtimeMs: fs.statSync(abs).mtimeMs }, validation: validateSpec(spec, { specPath: abs }), sourceIndex: fromIndex, targetIndex: toIndex });
      }
      const [scene] = scenes.splice(fromIndex, 1);
      scenes.splice(toIndex, 0, scene);
      const updated = { ...spec, scenes };
      const written = writeSpecFile(args.path, updated);
      const validation = validateSpec(updated, { specPath: abs });
      return okResult({ ok: validation.valid, written, validation, sourceIndex: fromIndex, targetIndex: toIndex, sceneCount: updated.scenes.length });
    }

    case 'slidey_validate': {
      const { abs, spec, generated } = readSpecFile(args.path);
      return okResult({ path: relPath(abs), generated, ...validateSpec(spec, { specPath: abs }) });
    }

    case 'slidey_scene_summary': {
      const { abs, spec } = readSpecFile(args.path);
      const { stepsForScene } = await import(pathToFileURL(path.join(ROOT_DIR, 'web', 'sceneSteps.mjs')).href);
      const fps = args.fps || 30;
      const boundaries = estimateBoundaries(spec, null, { specPath: abs });
      return okResult({
        path: relPath(abs),
        fps,
        sceneCount: Array.isArray(spec.scenes) ? spec.scenes.length : 0,
        scenes: (spec.scenes || []).map((scene, i) => {
          const steps = stepsForScene(scene);
          const boundary = boundaries.find((b) => b.sceneIndex === i);
          const narration = Array.isArray(scene.narration)
            ? scene.narration.map((cue) => cue && cue.text).filter(Boolean).join(' ')
            : (scene.narration || '');
          return {
            sceneIndex: i,
            type: scene.type,
            title: scene.title || scene.headline || scene.eyebrow || null,
            stepCount: steps.length || 1,
            steps: steps.length ? steps : [null],
            startSeconds: boundary ? Number((boundary.startFrame / fps).toFixed(3)) : null,
            durationSeconds: boundary ? Number((boundary.durationFrames / fps).toFixed(3)) : null,
            narration: narration ? String(narration).slice(0, 240) : null,
          };
        }),
      });
    }

    case 'slidey_render_png':
      return await renderPng(args);

    case 'slidey_render_html':
      return await renderHtml(args);

    case 'slidey_bundle': {
      const { abs, spec } = readSpecFile(args.path);
      const absOut = args.out
        ? safeResolve(args.out)
        : abs.replace(/\.slidey\.json$/i, '.html').replace(/\.json$/i, '.html');
      const written = bundleSpec(abs, spec, absOut, { skipValidate: !!args.skipValidate });
      return okResult({
        path: relPath(abs),
        bundled: relPath(written),
        bytes: fs.statSync(written).size,
        selfContained: true,
        note: 'Single-file interactive deck — open in a browser or host as-is; the rrweb replay plays inline.',
      });
    }

    case 'slidey_check': {
      const { spec } = readSpecFile(args.path);
      const { value, output } = captureConsole(() => runCheck(spec));
      return okResult({ path: args.path, violations: value, output });
    }

    case 'slidey_audit': {
      const { abs, spec: fileSpec } = readSpecFile(args.path);
      let spec = fileSpec;
      let auditDeckId = null;
      if (args.deck != null) {
        const resolved = resolveDeckSpec(fileSpec, { deckId: String(args.deck) });
        if (!resolved.deck || resolved.deck.id !== String(args.deck)) {
          const known = (resolved.decks || []).filter((d) => !d.source).map((d) => d.id);
          throw new Error(`unknown library deck "${args.deck}"${known.length ? ` — known decks: ${known.join(', ')}` : ''}`);
        }
        spec = resolved.spec;
        auditDeckId = resolved.deck.id;
      }
      const selectedScenes = Number.isInteger(args.sceneIndex) ? new Set([args.sceneIndex]) : null;
      const report = await auditSpec(spec, { specPath: abs, selectedScenes });
      return okResult({ path: relPath(abs), deck: auditDeckId, ...report });
    }

    case 'slidey_review_deck':
      return okResult(await reviewDeck(args));

    case 'slidey_graph_audit': {
      const { abs, spec } = readSpecFile(args.path);
      return okResult({ path: relPath(abs), ...graphAuditSpec(spec, { specPath: abs }) });
    }

    case 'slidey_contact_sheet':
      return okResult(await contactSheet(args));

    case 'slidey_narration_plan': {
      const { abs, spec } = readSpecFile(args.path);
      return okResult(await narrationPlanForSpec(spec, abs));
    }

    case 'slidey_diff_deck':
      return okResult(await diffDecks(args.beforePath, args.afterPath));

    case 'slidey_prepare_review_artifact':
      return okResult(await prepareReviewArtifact(args));

    case 'slidey_schema':
      return okResult(SCHEMA);

    case 'slidey_docs': {
      const guide = path.join(ROOT_DIR, '.claude', 'skills', 'slidey-authoring', 'SKILL.md');
      let body = fs.readFileSync(guide, 'utf8');
      body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');
      return okResult(body);
    }

    case 'slidey_doctor':
      return okResult(await runSetupDoctor({
        browser: args.browser !== false,
        narration: args.narration !== false,
        ttsSample: args.ttsSample !== false,
        voice: args.voice,
      }));

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

async function callToolWithTimeout(name, args = {}) {
  if (!BROWSER_TOOLS.has(name)) return await callTool(name, args);
  let timer;
  try {
    return await Promise.race([
      callTool(name, args),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${name} timed out after ${BROWSER_TOOL_TIMEOUT_MS}ms while launching or driving Chrome`));
        }, BROWSER_TOOL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function listResources() {
  return [
    {
      uri: 'slidey://schema',
      name: 'Slidey JSON Schema',
      description: 'Authoritative JSON Schema for Slidey specs.',
      mimeType: 'application/json',
    },
    {
      uri: 'slidey://docs',
      name: 'Slidey Authoring Guide',
      description: 'Bundled LLM-facing guide for authoring and debugging Slidey presentations.',
      mimeType: 'text/markdown',
    },
  ];
}

function readResource(uri) {
  if (uri === 'slidey://schema') {
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(SCHEMA, null, 2) }],
    };
  }
  if (uri === 'slidey://docs') {
    const guide = path.join(ROOT_DIR, '.claude', 'skills', 'slidey-authoring', 'SKILL.md');
    let body = fs.readFileSync(guide, 'utf8');
    body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');
    return {
      contents: [{ uri, mimeType: 'text/markdown', text: body }],
    };
  }
  throw new Error(`unknown resource: ${uri}`);
}

async function handleRequest(message) {
  const { id, method, params = {} } = message;
  if (id === undefined || id === null) return null;
  try {
    let result;
    if (method === 'initialize') {
      result = {
        protocolVersion: params.protocolVersion || '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'slidey-mcp', version: '1.0.0' },
      };
    } else if (method === 'tools/list') {
      result = { tools: TOOLS };
    } else if (method === 'tools/call') {
      try {
        result = await callToolWithTimeout(params.name, params.arguments || {});
      } catch (err) {
        result = errorResult(err && err.message ? err.message : String(err));
      }
    } else if (method === 'resources/list') {
      result = { resources: listResources() };
    } else if (method === 'resources/read') {
      result = readResource(params.uri);
    } else {
      throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
    }
    return { jsonrpc: '2.0', id, result };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: err.code || -32000,
        message: err && err.message ? err.message : String(err),
      },
    };
  }
}

function writeMessage(message, transport = 'jsonl') {
  const body = JSON.stringify(message);
  if (transport === 'framed') {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
    return;
  }
  process.stdout.write(`${body}\n`);
}

let buffer = Buffer.alloc(0);
async function dispatchRawMessage(raw, transport) {
  if (!raw.trim()) return;
  let message;
  try {
    message = JSON.parse(raw);
  } catch (err) {
    writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32700, message: err.message } }, transport);
    return;
  }
  if (message.id === undefined || message.id === null) return;
  const response = await handleRequest(message);
  if (response) writeMessage(response, transport);
}

process.stdin.on('data', async (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    if (buffer.length === 0) return;

    if (/^content-length:/i.test(buffer.slice(0, Math.min(buffer.length, 32)).toString('utf8'))) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd).toString('utf8');
      const match = header.match(/content-length:\s*(\d+)/i);
      if (!match) {
        process.stderr.write('[slidey-mcp] malformed Content-Length header\n');
        buffer = Buffer.alloc(0);
        return;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      const raw = buffer.slice(bodyStart, bodyStart + length).toString('utf8');
      buffer = buffer.slice(bodyStart + length);
      await dispatchRawMessage(raw, 'framed');
      continue;
    }

    const lineEnd = buffer.indexOf('\n');
    if (lineEnd === -1) return;
    const raw = buffer.slice(0, lineEnd).toString('utf8').trimEnd();
    buffer = buffer.slice(lineEnd + 1);
    await dispatchRawMessage(raw, 'jsonl');
  }
});

process.stdin.resume();

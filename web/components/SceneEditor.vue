<script setup>
import { computed, reactive, ref } from 'vue';
import { getByPath, setByPath, coerceValue } from '../spec-paths.js';
import layoutGalleryDeck from '../../examples/layout-gallery.slidey.json';

const props = defineProps({
  deck: { type: Object, required: true },
  spec: { type: Object, required: true },
  activePath: { type: String, default: '' },
  dirty: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  saveError: { type: String, default: '' },
  schema: { type: Object, default: null },
  narrationState: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['change', 'save', 'revert', 'listen-narration', 'stop-narration']);

const LAYOUT_GALLERY_FALLBACK = [
  { id: 'title', label: 'Title', type: 'title', variant: '', scene: { type: 'title', title: 'Title slide', subtitle: 'Add your subtitle', eyebrow: 'Section' } },
  { id: 'narrative', label: 'Narrative', type: 'narrative', variant: '', scene: { type: 'narrative', eyebrow: 'Narrative', lede: 'A short takeaway', body: 'Start writing the scene copy here.' } },
  { id: 'cards-grid', label: 'Cards (grid)', type: 'cards', variant: 'grid', scene: { type: 'cards', variant: 'grid', title: 'Grid cards', columns: 2, cards: [{ label: 'Point', sub: 'Describe a key idea' }, { label: 'Point', sub: 'Add supporting context' }] } },
  { id: 'code-source', label: 'Code block', type: 'code', variant: 'source', scene: { type: 'code', variant: 'source', title: 'Code', lang: 'javascript', code: "console.log('Hello from Slidey');" } },
  { id: 'diagram-svg', label: 'Diagram', type: 'diagram-svg', variant: '', scene: { type: 'diagram-svg', title: 'Diagram', panels: [{ label: 'Main flow', auto_layout: true, rankdir: 'TB', ranksep: 100, nodesep: 80, marginx: 50, marginy: 50, overlap_gap: 24, overlap_iterations: 12, resolve_overlaps: true, nodes: [{ id: 'start', label: 'Start' }, { id: 'end', label: 'Done' }], edges: [{ from: 'start', to: 'end' }] }] } },
  { id: 'table-data', label: 'Table', type: 'table', variant: 'data', scene: { type: 'table', variant: 'data', title: 'Table', columns: ['Stage', 'Status'], rows: [{ cells: ['Draft', 'Ready'] }] } },
  { id: 'chart-bar', label: 'Chart', type: 'chart', variant: 'bar', scene: { type: 'chart', variant: 'bar', title: 'Chart', series: [{ name: 'Series 1', points: [{ x: 'A', y: 7 }, { x: 'B', y: 12 }] }] } },
  { id: 'mermaid', label: 'Mermaid', type: 'mermaid', variant: '', scene: { type: 'mermaid', title: 'Mermaid', source: 'flowchart TD\nA[Input] --> B[Process]\nB --> C[Output]' } },
];

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
    if (seen.has(id)) {
      issues.push(`duplicate layout id "${id}" in guide deck`);
      continue;
    }
    layouts.push({ id, label: layoutGalleryLabel(scene, type, variant), type, variant, scene });
    seen.add(id);
  }
  return {
    layouts,
    issues,
    sourceScenes: sourceScenes.length,
    valid: issues.length === 0,
  };
}

const LAYOUT_GUIDE_BUILD = buildLayoutGalleryFromGuide(layoutGalleryDeck?.scenes || []);
const BUILTIN_LAYOUT_GALLERY = LAYOUT_GUIDE_BUILD.layouts.length ? LAYOUT_GUIDE_BUILD.layouts : LAYOUT_GALLERY_FALLBACK;
const layoutGalleryIntegrity = computed(() => {
  const messages = [];
  if (!Array.isArray(layoutGalleryDeck?.scenes)) messages.push('layout guide deck missing or unreadable');
  if (!LAYOUT_GUIDE_BUILD.layouts.length) messages.push('layout guide returned no valid entries; using fallback list');
  for (const issue of LAYOUT_GUIDE_BUILD.issues) messages.push(issue);
  const deckCount = Array.isArray(layoutGalleryDeck?.scenes) ? layoutGalleryDeck.scenes.length : 0;
  if (deckCount > LAYOUT_GUIDE_BUILD.layouts.length) {
    const skipped = deckCount - LAYOUT_GUIDE_BUILD.layouts.length;
    messages.push(`layout parser skipped ${skipped} scene(s) while building gallery; check for duplicates or malformed entries`);
  }
  return messages;
});

function findGalleryLayout(id) {
  return layoutGalleryMap.value.get(id);
}

const SKIP_KEYS = new Set([
  'gif', 'src', 'capture', 'from', 'to', 'id', 'markerId',
  'viewBox', 'x', 'y', 'w', 'h', 'at', 'until', 'start', 'end', 'speed',
  'duration', 'turn', 'turns', 'input', 'output', 'tokens', 'cost',
]);
const MULTILINE_KEYS = new Set([
  'narration', 'body', 'lede', 'caption', 'annotation', 'code', 'tree',
  'text', 'roomView', 'outcome', 'detail', 'question', 'answer',
]);

const sceneIndex = computed(() => props.deck.state.sceneIndex);
const scene = computed(() => (props.spec.scenes || [])[sceneIndex.value] || {});
const canSave = computed(() => /\.json$/i.test(props.activePath || ''));
const semanticMessages = reactive({});
const selectedLayout = ref(BUILTIN_LAYOUT_GALLERY[0]?.id || 'title');
const showLayoutGallery = ref(false);
const canRevert = computed(() => canSave.value && props.dirty && !props.saving);
const sceneCount = computed(() => Array.isArray(props.spec.scenes) ? props.spec.scenes.length : 0);
const layoutGallery = computed(() => {
  const byId = new Map(BUILTIN_LAYOUT_GALLERY.map((item) => [item.id, item]));
  const packs = Array.isArray(props.spec?.meta?._themePacks) ? props.spec.meta._themePacks : [];
  for (const pack of packs) {
    const layouts = Array.isArray(pack && pack.layouts) ? pack.layouts : [];
    for (const layout of layouts) {
      if (!layout || !layout.scene || typeof layout.scene !== 'object') continue;
      const id = String(layout.id || layout.scene.type || '').trim();
      if (!id) continue;
      byId.set(id, {
        id,
        label: layout.label || layoutGalleryLabel(layout.scene, layout.type || layout.scene.type, layout.variant || layout.scene.variant || ''),
        type: layout.type || layout.scene.type,
        variant: layout.variant || layout.scene.variant || '',
        scene: layout.scene,
        pack: pack.id || pack.name || '',
      });
    }
  }
  return [...byId.values()];
});
const layoutGalleryMap = computed(() => new Map(layoutGallery.value.map((item) => [item.id, item])));
const selectedGallery = computed(() => layoutGallery.value.find(item => item.id === selectedLayout.value) || layoutGallery.value[0]);
const canDuplicateCurrent = computed(() => canSave.value && scene.value.type);
const canDeleteCurrent = computed(() => canSave.value && sceneCount.value > 1);
const canMoveCurrentUp = computed(() => canSave.value && sceneIndex.value > 0);
const canMoveCurrentDown = computed(() => canSave.value && sceneIndex.value + 1 < sceneCount.value);

function openLayoutGallery() {
  if (!canSave.value) return;
  selectedLayout.value = selectedGallery.value?.id || layoutGallery.value[0]?.id || 'title';
  showLayoutGallery.value = true;
}

function closeLayoutGallery() {
  showLayoutGallery.value = false;
}

function specScenes() {
  if (!Array.isArray(props.spec.scenes)) return [];
  return props.spec.scenes;
}

function cloneScene(sceneData) {
  return JSON.parse(JSON.stringify(sceneData));
}

async function goToScene(index) {
  if (!props.deck) return;
  const max = Math.max(0, (Array.isArray(props.spec.scenes) ? props.spec.scenes.length : 1) - 1);
  const safeIndex = Math.max(0, Math.min(index, max));
  if (typeof props.deck.gotoScene === 'function') return props.deck.gotoScene(safeIndex);
  if (props.deck.state && typeof props.deck.state.sceneIndex === 'number') props.deck.state.sceneIndex = safeIndex;
  return props.deck.render();
}

async function duplicateCurrentScene() {
  if (!canDuplicateCurrent.value) return;
  const scenes = specScenes();
  const index = sceneIndex.value;
  scenes.splice(index + 1, 0, cloneScene(scene.value));
  emit('change');
  await props.deck.render();
  await goToScene(index + 1);
}

async function removeCurrentScene() {
  if (!canDeleteCurrent.value) return;
  const scenes = specScenes();
  const index = sceneIndex.value;
  scenes.splice(index, 1);
  const next = Math.min(Math.max(index, 0), scenes.length - 1);
  emit('change');
  await props.deck.render();
  await goToScene(next);
}

function moveCurrentSceneBy(offset) {
  if (!canSave.value) return;
  const scenes = specScenes();
  const from = sceneIndex.value;
  const to = from + offset;
  if (to < 0 || to >= scenes.length) return;
  const sceneToMove = scenes.splice(from, 1)[0];
  scenes.splice(to, 0, sceneToMove);
  emit('change');
  return (async () => {
    await props.deck.render();
    return goToScene(to);
  })();
}

function previewLineFor(layout) {
  const scene = layout?.scene || {};
  const candidates = [scene.title, scene.eyebrow, scene.lede, scene.question, scene.subtitle, scene.label];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  if (Array.isArray(scene.cards)) return `${scene.cards.length} cards`;
  if (Array.isArray(scene.series)) return `${scene.series.length} series`;
  if (Array.isArray(scene.panels)) return `${scene.panels.length} panel(s)`;
  if (Array.isArray(scene.rows)) return `${scene.rows.length} rows`;
  return '';
}

function onPickLayout(layoutId) {
  selectedLayout.value = layoutId || selectedLayout.value;
  void addSlideFromGallery(layoutId);
}

async function addSlideFromGallery(layoutId) {
  if (!canSave.value) return;
  const scenes = specScenes();
  const targetId = layoutId || selectedLayout.value;
  const template = findGalleryLayout(targetId)?.scene;
  if (!template) return;
  const index = sceneIndex.value + 1;
  scenes.splice(index, 0, cloneScene(template));
  emit('change');
  await props.deck.render();
  await goToScene(index);
  closeLayoutGallery();
}

function labelFor(path) {
  const pretty = path
    .filter(p => p !== 'scenes' && p !== sceneIndex.value)
    .map(p => typeof p === 'number' ? `#${p + 1}` : String(p).replace(/([A-Z])/g, ' $1'))
    .join(' / ');
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

function sceneSchemas() {
  return props.schema?.properties?.scenes?.items?.oneOf || [];
}

function sceneTypeOptions() {
  return sceneSchemas()
    .map(s => s?.properties?.type?.const)
    .filter(Boolean);
}

function schemaForScene() {
  const type = scene.value.type;
  return sceneSchemas().find(s => s?.properties?.type?.const === type) || null;
}

function schemaForPath(path) {
  if (path.length === 1 && path[0] === 'type') return { type: 'string', enum: sceneTypeOptions() };
  let schema = schemaForScene();
  for (const part of path) {
    if (!schema) return null;
    if (schema.oneOf) {
      schema = typeof part === 'number'
        ? schema.oneOf.find(s => s.type === 'array') || schema.oneOf[0]
        : schema.oneOf.find(s => s.type === 'object' || s.properties) || schema.oneOf.find(s => s.type === 'string') || schema.oneOf[0];
    }
    if (Array.isArray(part)) return null;
    if (typeof part === 'number') {
      schema = schema.items || null;
    } else {
      schema = schema.properties?.[part] || schema.additionalProperties || null;
    }
  }
  if (schema?.oneOf) {
    const primitive = schema.oneOf.find(s => s.enum || ['string', 'number', 'integer', 'boolean'].includes(s.type));
    return primitive || schema.oneOf[0];
  }
  return schema || null;
}

function inputKind(schema, value) {
  if (schema?.enum?.length) return 'enum';
  if (schema?.const != null) return 'const';
  if (schema?.type === 'boolean' || typeof value === 'boolean') return 'boolean';
  if (schema?.type === 'number' || schema?.type === 'integer' || typeof value === 'number') return 'number';
  return 'string';
}

function collectFields(value, path = [], fields = [], opts = {}) {
  if (value == null) return fields;
  const schema = schemaForPath(path);
  const kind = inputKind(schema, value);
  if (['string', 'number', 'boolean', 'enum', 'const'].includes(kind) && ['string', 'number', 'boolean'].includes(typeof value)) {
    const key = path[path.length - 1];
    if ((opts.includeNarration || path[0] !== 'narration') && (!SKIP_KEYS.has(key) || schema?.enum?.length || path.length === 1)) {
      fields.push({
        path,
        label: labelFor(path),
        schema,
        kind,
        multiline: typeof value === 'string' && (value.includes('\n') || value.length > 90 || MULTILINE_KEYS.has(key)),
        description: schema?.description || '',
      });
    }
    return fields;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectFields(item, [...path, i], fields, opts));
    return fields;
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach((key) => {
      if (!SKIP_KEYS.has(key)) collectFields(value[key], [...path, key], fields, opts);
    });
  }
  return fields;
}

const textFields = computed(() => collectFields(scene.value));
const sceneIssues = computed(() => {
  const s = schemaForScene();
  if (!s) return [];
  const issues = [];
  for (const key of s.required || []) {
    if (scene.value[key] == null) issues.push(`Missing required field "${key}"`);
  }
  Object.entries(s.properties || {}).forEach(([key, fieldSchema]) => {
    const value = scene.value[key];
    if (value == null) return;
    if (Array.isArray(value)) {
      if (fieldSchema.minItems != null && value.length < fieldSchema.minItems) issues.push(`"${key}" needs at least ${fieldSchema.minItems} item(s)`);
      if (fieldSchema.maxItems != null && value.length > fieldSchema.maxItems) issues.push(`"${key}" allows at most ${fieldSchema.maxItems} item(s)`);
    }
  });
  return issues;
});
const narrationFields = computed(() => {
  const n = scene.value.narration;
  if (typeof n === 'string') return [{ path: ['narration'], label: 'Narration', multiline: true }];
  if (Array.isArray(n) || (n && typeof n === 'object')) {
    return collectFields(n, ['narration'], [], { includeNarration: true }).filter(f => /text$/i.test(String(f.path[f.path.length - 1])));
  }
  return [];
});
const hasNarration = computed(() => scene.value.narration != null);
const isVideoNarrationCues = computed(() => scene.value.type === 'video' && Array.isArray(scene.value.narration));
const pronunciationRows = computed(() => {
  const dict = props.spec?.meta?.narration?.pronunciations || {};
  return Object.entries(dict).map(([term, value]) => ({ term, value }));
});
const canListenNarration = computed(() =>
  Boolean(props.narrationState?.supported && props.narrationState?.hasSceneNarration && !props.narrationState?.live));

function ensureNarrationMeta() {
  if (!props.spec.meta || typeof props.spec.meta !== 'object') props.spec.meta = {};
  if (!props.spec.meta.narration || typeof props.spec.meta.narration !== 'object') props.spec.meta.narration = {};
  if (!props.spec.meta.narration.pronunciations || typeof props.spec.meta.narration.pronunciations !== 'object') {
    props.spec.meta.narration.pronunciations = {};
  }
  return props.spec.meta.narration;
}

function uniquePronunciationTerm(base = 'term') {
  const dict = ensureNarrationMeta().pronunciations;
  if (!dict[base]) return base;
  let i = 2;
  while (dict[`${base} ${i}`]) i += 1;
  return `${base} ${i}`;
}

function addPronunciation() {
  const dict = ensureNarrationMeta().pronunciations;
  dict[uniquePronunciationTerm()] = '';
  emit('change');
}

function updatePronunciationTerm(oldTerm, nextTerm) {
  const next = String(nextTerm || '').trim();
  if (!next || next === oldTerm) return;
  const dict = ensureNarrationMeta().pronunciations;
  const value = dict[oldTerm] || '';
  delete dict[oldTerm];
  dict[next] = value;
  emit('change');
}

function updatePronunciationValue(term, value) {
  ensureNarrationMeta().pronunciations[term] = String(value || '');
  emit('change');
}

function removePronunciation(term) {
  const dict = ensureNarrationMeta().pronunciations;
  delete dict[term];
  emit('change');
}

async function update(path, value) {
  const kind = inputKind(schemaForPath(path), getByPath(scene.value, path));
  setByPath(scene.value, path, coerceValue(value, kind));
  validateField(path);
  try {
    await props.deck.render();
  } catch (err) {
    semanticMessages[keyFor(path)] = [String(err.message || err)];
  }
  emit('change');
}

async function addNarration() {
  scene.value.narration = '';
  await props.deck.render();
  emit('change');
}

async function addNarrationCue() {
  const existing = scene.value.narration;
  if (!Array.isArray(existing)) {
    const text = typeof existing === 'string' ? existing : '';
    scene.value.narration = text ? [{ at: 0, text }] : [];
  }
  scene.value.narration.push({ at: 0, text: '' });
  await props.deck.render();
  emit('change');
}

async function removeNarrationCue(index) {
  if (!Array.isArray(scene.value.narration)) return;
  scene.value.narration.splice(index, 1);
  await props.deck.render();
  emit('change');
}

function listenOrStopNarration() {
  if (props.narrationState?.speaking && !props.narrationState?.live) emit('stop-narration');
  else emit('listen-narration');
}

function keyFor(path) {
  return path.join('.');
}

function validateField(path) {
  const schema = schemaForPath(path);
  const value = getByPath(scene.value, path);
  const key = keyFor(path);
  const messages = [];
  if (schema?.enum?.length && !schema.enum.includes(value)) {
    messages.push(`Must be one of: ${schema.enum.join(', ')}`);
  }
  if (schema?.type === 'integer' && (!Number.isInteger(value))) messages.push('Must be an integer');
  if (schema?.type === 'number' && typeof value !== 'number') messages.push('Must be a number');
  if (typeof value === 'number') {
    if (schema?.minimum != null && value < schema.minimum) messages.push(`Must be >= ${schema.minimum}`);
    if (schema?.exclusiveMinimum != null && value <= schema.exclusiveMinimum) messages.push(`Must be > ${schema.exclusiveMinimum}`);
  }
  const semantic = semanticValidation(path, value);
  if (semantic) messages.push(semantic);
  if (messages.length) semanticMessages[key] = messages;
  else delete semanticMessages[key];
}

function semanticValidation(path, value) {
  const last = path[path.length - 1];
  if (scene.value.type === 'code' && last === 'code') {
    const lang = String(scene.value.lang || '').toLowerCase();
    if (['python', 'py', 'python3'].includes(lang)) return validatePythonByPattern(value);
    if (['json'].includes(lang)) {
      try { JSON.parse(value); } catch (err) { return String(err.message || err); }
    }
  }
  if (last === 'url' && value && !/^(https?:\/\/|\/|\{\{)/.test(String(value))) {
    return 'URL should start with http://, https://, /, or a {{context}} variable';
  }
  return '';
}

function validatePythonByPattern(source) {
  const code = String(source || '');
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  const stack = [];
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const closing = new Set(Object.values(pairs));
  let inTriple = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    let quote = null;
    let escaped = false;
    let logical = '';
    for (let c = 0; c < raw.length; c++) {
      const ch = raw[c];
      const next3 = raw.slice(c, c + 3);
      if (inTriple) {
        if (next3 === inTriple) { inTriple = null; c += 2; }
        continue;
      }
      if (quote) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (next3 === '"""' || next3 === "'''") { inTriple = next3; c += 2; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '#') break;
      logical += ch;
      if (pairs[ch]) stack.push({ want: pairs[ch], line: lineNo, col: c + 1 });
      else if (closing.has(ch)) {
        const top = stack.pop();
        if (!top || top.want !== ch) return `line ${lineNo}, column ${c + 1}: unmatched "${ch}"`;
      }
    }
    if (quote) return `line ${lineNo}: unterminated string literal`;
    const trimmed = logical.trim();
    if (!trimmed) continue;
    if (/^(def|class|if|elif|else|for|while|try|except|finally|with|match|case)\b/.test(trimmed) && !trimmed.endsWith(':')) {
      return `line ${lineNo}: block statement should end with ":"`;
    }
    if (/^(return|yield|raise|break|continue|pass)\S/.test(trimmed)) {
      return `line ${lineNo}: expected whitespace after keyword`;
    }
    if (/^(def|class)\s+[A-Za-z_]\w*\s*$/.test(trimmed)) {
      return `line ${lineNo}: incomplete declaration`;
    }
  }
  if (inTriple) return 'unterminated triple-quoted string';
  if (stack.length) {
    const top = stack[stack.length - 1];
    return `line ${top.line}, column ${top.col}: missing "${top.want}"`;
  }
  return '';
}
</script>

<template>
  <aside class="slidey-editor">
    <div class="slidey-editor-head">
      <div>
        <div class="slidey-editor-kicker">scene {{ sceneIndex + 1 }}</div>
        <div class="slidey-editor-title">{{ scene.type || 'scene' }}</div>
      </div>
      <div class="slidey-editor-head-actions">
        <button
          class="slidey-editor-save"
          :disabled="!canSave || !dirty || saving"
          :title="canSave ? 'Save changes to disk' : 'Only .json specs can be saved'"
          @click="emit('save')"
        >{{ saving ? 'Saving' : dirty ? 'Save' : 'Saved' }}</button>
        <button
          class="slidey-editor-revert"
          :disabled="!canRevert"
          title="Discard changes from this edit session"
          @click="emit('revert')"
        >Revert</button>
      </div>
    </div>

    <section class="slidey-editor-section slidey-editor-section-compact">
      <div class="slidey-editor-section-title">Slide actions</div>
      <div class="slidey-editor-slide-meta">Current slide {{ sceneIndex + 1 }} of {{ sceneCount }}</div>
      <div class="slidey-editor-slide-controls">
        <button
          class="slidey-editor-btn"
          :disabled="!canDuplicateCurrent"
          title="Create a copy of the current slide and insert after it"
          @click="duplicateCurrentScene"
        >Duplicate</button>
        <button
          class="slidey-editor-btn"
          :disabled="!canDeleteCurrent"
          title="Delete the current slide"
          @click="removeCurrentScene"
        >Delete</button>
        <button
          class="slidey-editor-btn"
          :disabled="!canMoveCurrentUp"
          title="Move this slide up"
          @click="moveCurrentSceneBy(-1)"
        >Move up</button>
        <button
          class="slidey-editor-btn"
          :disabled="!canMoveCurrentDown"
          title="Move this slide down"
          @click="moveCurrentSceneBy(1)"
        >Move down</button>
      </div>
      <div class="slidey-editor-field">
        <span>New slide layout</span>
        <div class="slidey-gallery-row">
          <button
            class="slidey-editor-btn slidey-layout-picker-trigger"
            :disabled="!canSave"
            @click="openLayoutGallery"
          >
            Select layout ({{ selectedGallery?.label || 'pick one' }})
          </button>
          <button
            class="slidey-editor-add"
            :disabled="!canSave"
            @click="onPickLayout(selectedLayout)"
          >Add slide</button>
        </div>
        <p v-if="layoutGalleryIntegrity.length" class="slidey-editor-note slidey-layout-integrity-note">
          Layout catalog warning: <br />
          {{ layoutGalleryIntegrity.join(' | ') }}
        </p>
      </div>
    </section>

    <div v-if="saveError" class="slidey-editor-error">{{ saveError }}</div>
    <div v-if="!canSave" class="slidey-editor-note">This deck is view-only because it is not a JSON spec.</div>
    <div v-if="sceneIssues.length" class="slidey-editor-warning">
      <div v-for="issue in sceneIssues" :key="issue">{{ issue }}</div>
    </div>

    <section class="slidey-editor-section">
      <div class="slidey-editor-section-title-row">
        <div class="slidey-editor-section-title">Narration</div>
        <button
          class="slidey-editor-btn slidey-editor-listen"
          :disabled="!canListenNarration && !(narrationState?.speaking && !narrationState?.live)"
          :title="narrationState?.supported ? 'Listen to this slide narration' : 'Edge TTS preview is available in the Slidey web viewer and VS Code preview'"
          @click="listenOrStopNarration"
        >{{ narrationState?.speaking && !narrationState?.live ? 'Stop' : 'Listen' }}</button>
      </div>
      <template v-if="isVideoNarrationCues">
        <div v-for="(cue, i) in scene.narration" :key="i" class="slidey-narration-cue">
          <div class="slidey-narration-cue-head">
            <span>Cue {{ i + 1 }}</span>
            <button class="slidey-editor-mini" :disabled="!canSave" @click="removeNarrationCue(i)">Remove</button>
          </div>
          <label class="slidey-editor-field">
            <span>At seconds</span>
            <input
              type="number"
              step="0.1"
              min="0"
              :value="cue.at ?? 0"
              :disabled="!canSave"
              @input="update(['narration', i, 'at'], $event.target.value)"
            />
          </label>
          <label class="slidey-editor-field">
            <span>Chapter</span>
            <input
              :value="cue.chapter || ''"
              :disabled="!canSave"
              @input="update(['narration', i, 'chapter'], $event.target.value)"
            />
          </label>
          <label class="slidey-editor-field">
            <span>Text</span>
            <textarea
              :value="cue.text || ''"
              :disabled="!canSave"
              rows="3"
              spellcheck="true"
              @input="update(['narration', i, 'text'], $event.target.value)"
            ></textarea>
          </label>
        </div>
        <button class="slidey-editor-add" :disabled="!canSave" @click="addNarrationCue">Add cue</button>
      </template>
      <template v-else-if="hasNarration && narrationFields.length">
        <label v-for="field in narrationFields" :key="field.path.join('.')" class="slidey-editor-field">
          <span>{{ field.label }}</span>
          <textarea
            :value="getByPath(scene, field.path)"
            :disabled="!canSave"
            rows="4"
            spellcheck="true"
            @input="update(field.path, $event.target.value)"
          ></textarea>
        </label>
        <button v-if="scene.type === 'video'" class="slidey-editor-btn" :disabled="!canSave" @click="addNarrationCue">Use timed cues</button>
      </template>
      <div v-else class="slidey-editor-inline-actions">
        <button class="slidey-editor-add" :disabled="!canSave" @click="addNarration">Add narration</button>
        <button v-if="scene.type === 'video'" class="slidey-editor-btn" :disabled="!canSave" @click="addNarrationCue">Add timed cue</button>
      </div>
      <p v-if="narrationState?.error" class="slidey-editor-field-error">{{ narrationState.error }}</p>
    </section>

    <section class="slidey-editor-section">
      <div class="slidey-editor-section-title-row">
        <div class="slidey-editor-section-title">Pronunciations</div>
        <button class="slidey-editor-btn slidey-editor-listen" :disabled="!canSave" @click="addPronunciation">Add</button>
      </div>
      <p v-if="!pronunciationRows.length" class="slidey-editor-empty">No pronunciation fixes.</p>
      <div v-for="row in pronunciationRows" :key="row.term" class="slidey-pronunciation-row">
        <input
          :value="row.term"
          :disabled="!canSave"
          placeholder="Term"
          @change="updatePronunciationTerm(row.term, $event.target.value)"
        />
        <input
          :value="row.value"
          :disabled="!canSave"
          placeholder="Spoken respelling"
          @input="updatePronunciationValue(row.term, $event.target.value)"
        />
        <button
          class="slidey-editor-mini"
          :disabled="!canSave"
          aria-label="Remove pronunciation"
          @click="removePronunciation(row.term)"
        >×</button>
      </div>
    </section>

    <section class="slidey-editor-section">
      <div class="slidey-editor-section-title">Text</div>
      <p v-if="!textFields.length" class="slidey-editor-empty">No editable text fields on this scene.</p>
      <label v-for="field in textFields" :key="field.path.join('.')" class="slidey-editor-field">
        <span>{{ field.label }}</span>
        <select
          v-if="field.kind === 'enum'"
          :value="getByPath(scene, field.path)"
          :disabled="!canSave"
          @change="update(field.path, $event.target.value)"
        >
          <option v-for="option in field.schema.enum" :key="option" :value="option">{{ option }}</option>
        </select>
        <input
          v-else-if="field.kind === 'boolean'"
          type="checkbox"
          :checked="getByPath(scene, field.path)"
          :disabled="!canSave"
          @change="update(field.path, $event.target.checked)"
        />
        <input
          v-else-if="field.kind === 'number'"
          type="number"
          :step="field.schema && field.schema.type === 'integer' ? 1 : 'any'"
          :value="getByPath(scene, field.path)"
          :disabled="!canSave"
          @input="update(field.path, $event.target.value)"
        />
        <textarea
          v-else-if="field.multiline"
          :value="getByPath(scene, field.path)"
          :disabled="!canSave"
          rows="3"
          spellcheck="true"
          @input="update(field.path, $event.target.value)"
        ></textarea>
        <input
          v-else
          :value="getByPath(scene, field.path)"
          :disabled="!canSave"
          spellcheck="true"
          @input="update(field.path, $event.target.value)"
        />
        <p v-if="field.description" class="slidey-editor-help">{{ field.description }}</p>
        <p v-if="semanticMessages[keyFor(field.path)]" class="slidey-editor-field-error">
          {{ semanticMessages[keyFor(field.path)].join(' · ') }}
        </p>
      </label>
    </section>
    <div v-if="showLayoutGallery" class="slidey-layout-modal-backdrop" @click.self="closeLayoutGallery">
      <div class="slidey-layout-modal" role="dialog" aria-modal="true" aria-label="Add slide layout">
        <header class="slidey-layout-modal-head">
          <div>
            <h2>Choose layout</h2>
            <p>Select one layout to insert after slide {{ sceneIndex + 1 }}</p>
          </div>
          <button class="slidey-layout-close" @click="closeLayoutGallery" aria-label="Close layout picker">×</button>
        </header>
        <div class="slidey-layout-grid">
          <button
            v-for="item in layoutGallery"
            :key="item.id"
            class="slidey-layout-card"
            :class="{ 'is-active': item.id === selectedLayout }"
            @click="onPickLayout(item.id)"
          >
            <div class="slidey-layout-card-preview" :class="`type-${item.type}`">
              <div class="slidey-layout-card-preview-title">{{ item.type }}</div>
              <div v-if="item.variant" class="slidey-layout-card-preview-variant">{{ item.variant }}</div>
            </div>
            <div class="slidey-layout-card-copy">
              <p class="slidey-layout-card-label">{{ item.label }}</p>
              <p class="slidey-layout-card-subtitle">{{ previewLineFor(item) }}</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

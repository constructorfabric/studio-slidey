<script setup>
import { computed, reactive } from 'vue';

const props = defineProps({
  deck: { type: Object, required: true },
  spec: { type: Object, required: true },
  activePath: { type: String, default: '' },
  dirty: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  saveError: { type: String, default: '' },
  schema: { type: Object, default: null },
});
const emit = defineEmits(['change', 'save']);

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

function labelFor(path) {
  const pretty = path
    .filter(p => p !== 'scenes' && p !== sceneIndex.value)
    .map(p => typeof p === 'number' ? `#${p + 1}` : String(p).replace(/([A-Z])/g, ' $1'))
    .join(' / ');
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

function getByPath(root, path) {
  return path.reduce((obj, key) => (obj == null ? undefined : obj[key]), root);
}

function setByPath(root, path, value) {
  let obj = root;
  for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
  obj[path[path.length - 1]] = value;
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

function coerceValue(raw, field) {
  if (field.kind === 'boolean') return !!raw;
  if (field.kind === 'number') {
    if (raw === '') return '';
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  return raw;
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

async function update(path, value) {
  const field = { path, kind: inputKind(schemaForPath(path), getByPath(scene.value, path)) };
  setByPath(scene.value, path, coerceValue(value, field));
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
      <button
        class="slidey-editor-save"
        :disabled="!canSave || !dirty || saving"
        :title="canSave ? 'Save changes to disk' : 'Only .json specs can be saved'"
        @click="emit('save')"
      >{{ saving ? 'Saving' : dirty ? 'Save' : 'Saved' }}</button>
    </div>

    <div v-if="saveError" class="slidey-editor-error">{{ saveError }}</div>
    <div v-if="!canSave" class="slidey-editor-note">This deck is view-only because it is not a JSON spec.</div>
    <div v-if="sceneIssues.length" class="slidey-editor-warning">
      <div v-for="issue in sceneIssues" :key="issue">{{ issue }}</div>
    </div>

    <section class="slidey-editor-section">
      <div class="slidey-editor-section-title">Narration</div>
      <template v-if="hasNarration && narrationFields.length">
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
      </template>
      <button v-else class="slidey-editor-add" :disabled="!canSave" @click="addNarration">Add narration</button>
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
  </aside>
</template>

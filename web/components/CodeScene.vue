<script setup>
import { computed } from 'vue';
import { store } from '../store.js';
import { highlightJSON } from '../format.js';

// ── Reveal step base-names ──────────────────────────────────────────────────
// Mirrors stepsForScene('code') and the store reveal table the integrator adds.
//   code_header  → filename / call chrome bar (or function-io call line)
//   code_body    → the artifact body (source / diff / tree / config / returns)
//   code_notes   → annotations / footnotes, only when present
//
// Reveal is intentionally coarse: header, body, then notes. We never segment
// the body line-by-line (the spec forbids over-segmentation).

const scene   = computed(() => store.scene || {});
const variant = computed(() => scene.value.variant || 'source');

// Source/config code split into lines, keyed for highlight + annotation gutters.
const codeLines = computed(() => {
  const code = scene.value.code;
  if (typeof code !== 'string') return [];
  // Split but keep a trailing empty line out so we don't render a blank row.
  const arr = code.replace(/\n$/, '').split('\n');
  return arr.map((text, i) => ({ n: i + 1, text }));
});

// 1-based line numbers to emphasise (source variant).
const highlightSet = computed(() => new Set(scene.value.highlight || []));

// annotations: [{ line, text }] — rendered below the body as a footnote list.
const annotations = computed(() => Array.isArray(scene.value.annotations) ? scene.value.annotations : []);

const hasNotes = computed(() => annotations.value.length > 0);

// diff: classify each line by its leading marker.
const diffLines = computed(() => {
  const code = scene.value.code;
  if (typeof code !== 'string') return [];
  return code.replace(/\n$/, '').split('\n').map(text => {
    const head = text.charAt(0);
    let kind = 'ctx';
    if (head === '+') kind = 'add';
    else if (head === '-') kind = 'del';
    return { text, kind };
  });
});

// config: JSON/YAML — reuse highlightJSON for JSON-ish bodies, escape otherwise.
const configHtml = computed(() => {
  const code = scene.value.code;
  if (typeof code !== 'string') return '';
  const trimmed = code.trim();
  const looksJSON = (scene.value.lang || '').toLowerCase().includes('json')
    || trimmed.startsWith('{') || trimmed.startsWith('[');
  if (looksJSON) {
    try { return highlightJSON(code.replace(/\n$/, '')); } catch (_) { /* fall through */ }
  }
  // YAML / other: escape, then dim comment lines and colour keys.
  return code.replace(/\n$/, '').split('\n').map(line => {
    const esc = line
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (/^\s*#/.test(line)) return `<span class="code-dim">${esc}</span>`;
    const m = esc.match(/^(\s*[\w.\-]+)(:)(.*)$/);
    if (m) return `<span class="code-key">${m[1]}</span>${m[2]}<span class="code-val">${m[3]}</span>`;
    return esc;
  }).join('\n');
});

// log: dim leading timestamp, colour error/warn lines.
function logKind(line) {
  if (/\b(ERROR|FATAL|Error|Exception|Traceback|panic:)\b/.test(line)) return 'err';
  if (/\b(WARN|WARNING|Warning)\b/.test(line)) return 'warn';
  return 'info';
}
const logLines = computed(() => {
  const code = scene.value.code;
  if (typeof code !== 'string') return [];
  return code.replace(/\n$/, '').split('\n').map(text => {
    // Pull a leading [..] or ISO-ish timestamp out so it can be dimmed.
    const m = text.match(/^(\s*(?:\[[^\]]*\]|\d{4}-\d\d-\d\d[T ][\d:.]+Z?))\s*(.*)$/);
    return {
      ts: m ? m[1] : '',
      rest: m ? m[2] : text,
      kind: logKind(text),
    };
  });
});
</script>

<template>
  <div id="code-region" class="scene-region active" :data-variant="variant">
    <!-- Chrome / header bar. For function-io this is the call line. -->
    <div
      id="code-header"
      class="code-header reveal"
      :class="{ shown: store.isRevealed('code-header') }"
    >
      <template v-if="variant === 'function-io'">
        <span class="code-dot code-dot-call">▸</span>
        <code class="code-call">{{ scene.call || scene.title || '' }}</code>
      </template>
      <template v-else>
        <span class="code-chrome-dots"><i></i><i></i><i></i></span>
        <span class="code-filename">{{ scene.title || '' }}</span>
        <span v-if="scene.lang" class="code-lang">{{ scene.lang }}</span>
      </template>
    </div>

    <!-- Body -->
    <div
      id="code-body"
      class="code-body reveal"
      :class="{ shown: store.isRevealed('code-body') }"
    >
      <!-- source -->
      <pre v-if="variant === 'source'" class="code-pre"><div
          v-for="l in codeLines"
          :key="l.n"
          class="code-line"
          :class="{ 'code-line-hl': highlightSet.has(l.n) }"
        ><span class="code-gutter">{{ l.n }}</span><span class="code-text">{{ l.text || ' ' }}</span></div></pre>

      <!-- diff -->
      <pre v-else-if="variant === 'diff'" class="code-pre"><div
          v-for="(l, i) in diffLines"
          :key="i"
          class="code-diff-line"
          :class="`code-diff-${l.kind}`"
        >{{ l.text || ' ' }}</div></pre>

      <!-- function-io: call (header above) ▸ returns -->
      <div v-else-if="variant === 'function-io'" class="code-io">
        <pre v-if="typeof scene.code === 'string'" class="code-pre code-io-body"><div
            v-for="l in codeLines"
            :key="l.n"
            class="code-line"
          ><span class="code-text">{{ l.text || ' ' }}</span></div></pre>
        <div class="code-io-arrow"><span class="code-io-arrow-line"></span><span class="code-io-arrow-label">returns</span></div>
        <pre class="code-pre code-io-returns"><code>{{ scene.returns || '' }}</code></pre>
      </div>

      <!-- tree -->
      <pre v-else-if="variant === 'tree'" class="code-pre code-tree"><code>{{ scene.tree || '' }}</code></pre>

      <!-- config -->
      <pre v-else-if="variant === 'config'" class="code-pre"><code v-html="configHtml"></code></pre>

      <!-- log -->
      <pre v-else-if="variant === 'log'" class="code-pre code-log"><div
          v-for="(l, i) in logLines"
          :key="i"
          class="code-log-line"
          :class="`code-log-${l.kind}`"
        ><span v-if="l.ts" class="code-log-ts">{{ l.ts }}</span><span class="code-log-msg">{{ l.rest }}</span></div></pre>

      <!-- fallback: raw code -->
      <pre v-else class="code-pre"><code>{{ scene.code || '' }}</code></pre>
    </div>

    <!-- Annotations (footnotes) -->
    <div
      v-if="hasNotes"
      id="code-notes"
      class="code-notes reveal"
      :class="{ shown: store.isRevealed('code-notes') }"
    >
      <div v-for="(a, i) in annotations" :key="i" class="code-note">
        <span class="code-note-mark">L{{ a.line }}</span>
        <span class="code-note-text">{{ a.text }}</span>
      </div>
    </div>

    <!-- Optional caption below everything (revealed with notes / body) -->
    <div
      v-if="scene.caption"
      class="code-caption reveal"
      :class="{ shown: store.isRevealed('code-body') }"
    >{{ scene.caption }}</div>
  </div>
</template>

<style scoped>
#code-region {
  gap: 28px;
  max-width: 1500px;
  margin: 0 auto;
  width: 100%;
  text-align: left;
}

/* Header / chrome bar ----------------------------------------------------- */
.code-header {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  max-width: 1200px;
  background: #161b22;
  border: 1px solid #30363d;
  border-bottom: none;
  border-radius: 12px 12px 0 0;
  padding: 16px 24px;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}
.code-chrome-dots { display: inline-flex; gap: 8px; }
.code-chrome-dots i {
  width: 13px; height: 13px; border-radius: 50%;
  background: #30363d; display: inline-block;
}
.code-filename { font-size: 26px; color: #e6edf3; letter-spacing: 0.01em; }
.code-lang {
  margin-left: auto; font-size: 18px; color: #8b949e;
  text-transform: uppercase; letter-spacing: 0.14em;
}

/* function-io call line in the header */
.code-dot-call { color: #58a6ff; font-size: 26px; }
.code-call { font-size: 28px; color: #58a6ff; }

/* Body -------------------------------------------------------------------- */
.code-body {
  width: 100%;
  max-width: 1200px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 0 0 12px 12px;
  overflow: hidden;
}
.code-pre {
  margin: 0;
  padding: 28px 32px;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 26px;
  line-height: 1.55;
  color: #e6edf3;
  white-space: pre;
  overflow-x: auto;
}

/* source lines + gutter + highlight */
.code-line { display: flex; gap: 24px; padding: 0 8px; border-radius: 4px; }
.code-line-hl { background: rgba(88, 166, 255, 0.12); box-shadow: inset 3px 0 0 #58a6ff; }
.code-gutter { color: #484f58; text-align: right; min-width: 2.2em; user-select: none; }
.code-text { color: #e6edf3; }

/* diff */
.code-diff-line { padding: 0 12px; border-radius: 3px; }
.code-diff-add { color: #3fb950; background: rgba(63, 185, 80, 0.12); }
.code-diff-del { color: #f85149; background: rgba(248, 81, 73, 0.12); }
.code-diff-ctx { color: #8b949e; }

/* function-io */
.code-io { display: flex; flex-direction: column; gap: 0; }
.code-io-body { color: #e6edf3; }
.code-io-arrow {
  display: flex; align-items: center; gap: 16px;
  padding: 6px 32px;
}
.code-io-arrow-line { flex: 1; height: 1px; background: #30363d; }
.code-io-arrow-label {
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 18px; color: #8b949e;
  text-transform: uppercase; letter-spacing: 0.16em;
}
.code-io-returns code { color: #3fb950; }

/* tree */
.code-tree code { color: #e6edf3; }

/* config — reuse the request JSON token palette */
.code-key { color: #79c0ff; }
.code-val { color: #a5d6ff; }
.code-dim { color: #484f58; }
:deep(.json-key)     { color: #79c0ff; }
:deep(.json-string)  { color: #a5d6ff; }
:deep(.json-number)  { color: #f2cc60; }
:deep(.json-boolean) { color: #ff7b72; }

/* log */
.code-log { font-size: 24px; }
.code-log-line { display: flex; gap: 18px; }
.code-log-ts { color: #484f58; flex: none; }
.code-log-msg { color: #8b949e; }
.code-log-info .code-log-msg { color: #c9d1d9; }
.code-log-warn .code-log-msg { color: #f0883e; }
.code-log-err .code-log-msg, .code-log-err .code-log-ts { color: #f85149; }

/* annotations */
.code-notes {
  display: flex; flex-direction: column; gap: 12px;
  width: 100%; max-width: 1200px;
}
.code-note {
  display: flex; gap: 16px; align-items: baseline;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 22px; color: #adb6c0;
}
.code-note-mark {
  flex: none; color: #58a6ff; font-weight: bold;
  min-width: 2.6em;
}
.code-note-text { color: #adb6c0; }

/* caption */
.code-caption {
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 22px; color: #8b949e;
  text-align: center; width: 100%; max-width: 1200px;
}
</style>

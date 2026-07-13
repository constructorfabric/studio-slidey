<script setup>
import { computed } from 'vue';
import { store } from '../store.js';

const scene = computed(() => store.scene || {});

const logoLines = [
  [{ text: '  \\  |  / ', tone: 'gold' }],
  [{ text: ' ── ███ ──', tone: 'gold' }],
  [{ text: '    ███   ', tone: 'gold' }],
  [{ text: '    ▟█▙   ', tone: 'clay' }],
  [{ text: '   ▟███▙  ', tone: 'adobe' }],
  [{ text: '  ▟█████▙ ', tone: 'clay' }],
  [
    { text: '  ', tone: 'none' },
    { text: '███', tone: 'clay' },
    { text: '█', tone: 'door' },
    { text: '███', tone: 'clay' },
    { text: ' ', tone: 'none' },
  ],
  [{ text: ' █████████', tone: 'rust' }],
];

const defaultMenuItems = [
  { label: 'Start onboarding', hint: 'discover project, then ask before writes' },
  { label: 'Review setup plan', hint: 'read-only preview' },
  { label: 'Skip for now', hint: 'stay in idle' },
];

function normalizeMenuItem(item) {
  if (typeof item === 'string') return { label: item, hint: '' };
  if (!item || typeof item !== 'object') return { label: 'Untitled action', hint: '' };
  return {
    label: item.label || item.title || item.intent || 'Untitled action',
    hint: item.hint || item.description || item.detail || '',
  };
}

const appTitle = computed(() => scene.value.appTitle || 'kitsoki · project onboarding');
const subtitle = computed(() => scene.value.subtitle || 'v1.2.0 · local setup story');
const status = computed(() => scene.value.status || 'session sess_42... · story onboarding · state intro');
const choicePrompt = computed(() => scene.value.choicePrompt || 'Start Kitsoki onboarding?');
const footer = computed(() => scene.value.footer || '[↑/↓ move • Enter pick • Tab chat • Esc cancel]');
const hints = computed(() => {
  if (Array.isArray(scene.value.hints) && scene.value.hints.length) return scene.value.hints.slice(0, 5);
  return [
    '/help        list commands',
    '/world       inspect current state',
    '/quit        exit',
  ];
});
const menuItems = computed(() => {
  if (Array.isArray(scene.value.menuItems) && scene.value.menuItems.length) {
    return scene.value.menuItems.slice(0, 6).map(normalizeMenuItem);
  }
  return defaultMenuItems;
});
const selectedIndex = computed(() => {
  const raw = Number(scene.value.selectedIndex ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.min(Math.max(Math.trunc(raw), 0), menuItems.value.length - 1);
});
</script>

<template>
  <div id="kitsokitui-region" class="scene-region active">
    <div
      id="kitsokitui-frame"
      class="kitsokitui-frame reveal"
      :class="{ shown: store.isRevealed('kitsokitui-frame') }"
    >
      <div class="kitsokitui-titlebar">
        <span class="kitsokitui-dots"><i></i><i></i><i></i></span>
        <span class="kitsokitui-title" data-edit-path='["title"]'>{{ scene.title || 'kitsoki run' }}</span>
        <span class="kitsokitui-live">TUI</span>
      </div>

      <div class="kitsokitui-screen">
        <div
          id="kitsokitui-welcome"
          class="kitsokitui-welcome reveal"
          :class="{ shown: store.isRevealed('kitsokitui-welcome') }"
        >
          <pre class="kitsokitui-logo" aria-hidden="true"><span
              v-for="(line, lineIndex) in logoLines"
              :key="lineIndex"
              class="kitsokitui-logo-line"
            ><span
                v-for="(segment, segmentIndex) in line"
                :key="segmentIndex"
                :class="`tone-${segment.tone}`"
              >{{ segment.text }}</span></span></pre>
          <div class="kitsokitui-copy">
            <div class="kitsokitui-app-title" data-edit-path='["appTitle"]'>
              <span class="kitsokitui-star">✻</span>{{ appTitle }}
            </div>
            <div class="kitsokitui-subtitle" data-edit-path='["subtitle"]'>{{ subtitle }}</div>
            <div class="kitsokitui-hints">
              <div
                v-for="(hint, i) in hints"
                :key="i"
                class="kitsokitui-hint"
                :data-edit-path="JSON.stringify(['hints', i])"
              >{{ hint }}</div>
            </div>
            <div class="kitsokitui-status" data-edit-path='["status"]'>{{ status }}</div>
          </div>
        </div>

        <div
          id="kitsokitui-menu"
          class="kitsokitui-menu reveal"
          :class="{ shown: store.isRevealed('kitsokitui-menu') }"
        >
          <div class="kitsokitui-menu-header">
            <span data-edit-path='["choicePrompt"]'>{{ choicePrompt }}</span>
            <span class="kitsokitui-menu-keys">↑/↓</span>
          </div>
          <div class="kitsokitui-menu-rule"></div>
          <div class="kitsokitui-menu-list">
            <div
              v-for="(item, i) in menuItems"
              :key="i"
              class="kitsokitui-menu-row"
              :class="{ active: i === selectedIndex }"
            >
              <span class="kitsokitui-menu-caret">{{ i === selectedIndex ? '▸' : '' }}</span>
              <span class="kitsokitui-menu-label" :data-edit-path="JSON.stringify(['menuItems', i, 'label'])">
                {{ item.label }}
              </span>
              <span
                v-if="item.hint"
                class="kitsokitui-menu-hint"
                :data-edit-path="JSON.stringify(['menuItems', i, 'hint'])"
              >{{ item.hint }}</span>
            </div>
          </div>
          <div class="kitsokitui-menu-footer" data-edit-path='["footer"]'>{{ footer }}</div>
        </div>
      </div>
    </div>

    <div
      v-if="scene.caption"
      id="kitsokitui-caption"
      class="kitsokitui-caption reveal"
      :class="{ shown: store.isRevealed('kitsokitui-caption') }"
      data-edit-path='["caption"]'
      data-edit-multiline
    >{{ scene.caption }}</div>
  </div>
</template>

<style scoped>
#kitsokitui-region {
  gap: 22px;
  width: 100%;
  max-width: 1680px;
  margin: 0 auto;
  text-align: left;
}

.kitsokitui-frame {
  width: 100%;
  background: #0d1117;
  border: 1px solid #4b5563;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(255, 255, 255, 0.02);
}

.kitsokitui-titlebar {
  height: 52px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  background: #111827;
  border-bottom: 1px solid #4b5563;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

.kitsokitui-dots {
  display: inline-flex;
  gap: 8px;
}

.kitsokitui-dots i {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #7d2e1c;
  display: inline-block;
}

.kitsokitui-dots i:nth-child(2) { background: #e0a23a; }
.kitsokitui-dots i:nth-child(3) { background: #3aa3a0; }

.kitsokitui-title {
  color: #f9fafb;
  font-size: 20px;
  font-weight: 700;
}

.kitsokitui-live {
  margin-left: auto;
  color: #22d3ee;
  border: 1px solid #3b82f6;
  background: rgba(37, 99, 235, 0.16);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 15px;
}

.kitsokitui-screen {
  min-height: 710px;
  padding: 40px 52px 34px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  background: linear-gradient(180deg, #111827 0%, #0d1117 100%);
}

.kitsokitui-welcome {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  align-items: stretch;
  gap: 32px;
  min-height: 405px;
  border: 5px solid #e0a23a;
  border-radius: 3px;
  padding: 30px 38px;
  background: rgba(13, 17, 23, 0.84);
  color: #f0e3c8;
  box-shadow: inset 0 0 0 1px rgba(244, 207, 149, 0.18);
}

.kitsokitui-logo {
  margin: 0;
  align-self: center;
  justify-self: center;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 34px;
  line-height: 1.12;
  white-space: pre;
  text-shadow: 0 0 22px rgba(224, 162, 58, 0.18);
}

.kitsokitui-logo-line {
  display: block;
}

.tone-gold { color: #e0a23a; }
.tone-clay { color: #a8492b; }
.tone-adobe { color: #c97b4a; }
.tone-rust { color: #7d2e1c; }
.tone-door { color: #3a2418; }

.kitsokitui-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

.kitsokitui-app-title {
  color: #e0a23a;
  font-size: 36px;
  font-weight: 800;
  line-height: 1.12;
  overflow-wrap: anywhere;
}

.kitsokitui-star {
  color: #3aa3a0;
  margin-right: 12px;
}

.kitsokitui-subtitle {
  color: #b59b76;
  font-size: 24px;
  line-height: 1.25;
}

.kitsokitui-hints {
  display: grid;
  gap: 7px;
  margin-top: 18px;
}

.kitsokitui-hint {
  color: #b59b76;
  font-size: 24px;
  line-height: 1.24;
  white-space: pre-wrap;
}

.kitsokitui-status {
  margin-top: 18px;
  color: #6b7280;
  font-size: 23px;
  font-style: italic;
  overflow-wrap: anywhere;
}

.kitsokitui-menu {
  padding: 22px 26px 18px;
  background: rgba(17, 24, 39, 0.96);
  border: 1px solid #4b5563;
  border-radius: 8px;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

.kitsokitui-menu-header {
  display: flex;
  align-items: center;
  gap: 18px;
  color: #f9fafb;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 800;
}

.kitsokitui-menu-keys {
  margin-left: auto;
  color: #6b7280;
  font-size: 19px;
  font-weight: 600;
}

.kitsokitui-menu-rule {
  height: 1px;
  margin: 14px 0 12px;
  background: #4b5563;
}

.kitsokitui-menu-list {
  display: grid;
  gap: 6px;
}

.kitsokitui-menu-row {
  display: grid;
  grid-template-columns: 32px minmax(260px, max-content) minmax(0, 1fr);
  align-items: baseline;
  column-gap: 12px;
  min-height: 39px;
  padding: 5px 10px;
  color: #10b981;
  border: 1px solid transparent;
  border-radius: 6px;
}

.kitsokitui-menu-row.active {
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.13);
  border-color: rgba(124, 58, 237, 0.42);
  font-weight: 800;
}

.kitsokitui-menu-caret {
  width: 32px;
  color: #7c3aed;
  font-size: 27px;
  line-height: 1;
}

.kitsokitui-menu-label {
  min-width: 0;
  font-size: 24px;
  line-height: 1.24;
  overflow-wrap: anywhere;
}

.kitsokitui-menu-hint {
  min-width: 0;
  color: #6b7280;
  font-size: 21px;
  line-height: 1.28;
  font-style: italic;
  overflow-wrap: anywhere;
}

.kitsokitui-menu-footer {
  margin-top: 14px;
  color: #6b7280;
  font-size: 20px;
  line-height: 1.25;
  font-style: italic;
}

.kitsokitui-caption {
  font-size: 28px;
  line-height: 1.42;
  color: var(--slidey-text, #f3ead8);
  text-align: center;
  max-width: 1400px;
  margin: 0 auto;
}
</style>

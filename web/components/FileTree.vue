<script setup>
// Recursive workspace tree for the viewer sidebar. Folders collapse/expand, and
// normal Slidey specs are rendered as decks directly instead of exposing their
// `.slidey.json` filenames as separate wrapper rows.
import { ref } from 'vue';

const props = defineProps({
  nodes:     { type: Array,    required: true },
  active:    { type: String,   default: '' },
  activeDeck:{ type: String,   default: '' },
  select:    { type: Function, required: true },
  depth:     { type: Number,   default: 0 },
});

const collapsed = ref(new Set());
const isOpen = (p) => !collapsed.value.has(p);
function toggle(p) {
  const s = new Set(collapsed.value);
  s.has(p) ? s.delete(p) : s.add(p);
  collapsed.value = s;
}
const nodeKey = (node) => {
  if (!node) return '';
  if (node.type === 'deck') return `${node.path || ''}#deck:${node.deckId || ''}`;
  if (node.type === 'deckGroup') return `${node.path || ''}#group`;
  return node.path || node.name || '';
};
const hasChildren = (node) => Boolean(node && node.children && node.children.length);
const isDeckActive = (node) => node && node.type === 'deck' && node.path === props.active && node.deckId === props.activeDeck;
const isFileActive = (node) => node && node.type === 'file' && node.path === props.active;
const pad = (extra = 0) => ({ paddingLeft: `${props.depth * 14 + 8 + extra}px` });
</script>

<template>
  <ul class="slidey-tree" :class="{ root: depth === 0 }">
    <li v-for="node in nodes" :key="nodeKey(node)">
      <template v-if="node.type === 'dir'">
        <div class="slidey-tree-row dir" :style="pad()" @click="toggle(nodeKey(node))">
          <span class="slidey-tree-caret">{{ isOpen(nodeKey(node)) ? '▾' : '▸' }}</span>
          <span class="slidey-tree-name">{{ node.name }}</span>
        </div>
      </template>
      <template v-else-if="node.type === 'deckGroup'">
        <div class="slidey-tree-row deck-group" :style="pad()" @click="toggle(nodeKey(node))">
          <span class="slidey-tree-caret">{{ isOpen(nodeKey(node)) ? '▾' : '▸' }}</span>
          <span class="slidey-tree-name">{{ node.name }}</span>
        </div>
      </template>
      <template v-else-if="node.type === 'deck'">
        <div
          class="slidey-tree-row deck"
          :class="[`deck-${node.deckType || 'hierarchy'}`, { active: isDeckActive(node) }]"
          :style="pad(hasChildren(node) ? 0 : 14)"
          :title="node.description || node.name"
          @click="select(node.path, null, node.deckId)"
        >
          <span
            v-if="hasChildren(node)"
            class="slidey-tree-caret"
            @click.stop="toggle(nodeKey(node))"
          >{{ isOpen(nodeKey(node)) ? '▾' : '▸' }}</span>
          <span class="slidey-tree-deck-dot" aria-hidden="true"></span>
          <span class="slidey-tree-name">{{ node.name }}</span>
          <span v-if="node.deckType === 'subset'" class="slidey-tree-kind">Subset</span>
        </div>
      </template>
      <template v-else>
        <div
          class="slidey-tree-row file"
          :class="{ active: isFileActive(node), collection: hasChildren(node) }"
          :style="pad(hasChildren(node) ? 0 : 14)"
          @click="select(node.path)"
        >
          <span
            v-if="hasChildren(node)"
            class="slidey-tree-caret"
            @click.stop="toggle(nodeKey(node))"
          >{{ isOpen(nodeKey(node)) ? '▾' : '▸' }}</span>
          <span v-if="node.editable === false" class="slidey-tree-lock" title="Read-only (clone to edit)">🔒</span>
          <span class="slidey-tree-name">{{ node.name }}</span>
        </div>
      </template>
      <FileTree
        v-show="hasChildren(node) && isOpen(nodeKey(node))"
        :nodes="node.children || []"
        :active="active"
        :active-deck="activeDeck"
        :select="select"
        :depth="depth + 1"
      />
    </li>
  </ul>
</template>

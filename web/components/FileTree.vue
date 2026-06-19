<script setup>
// VS-Code-style recursive file tree for the viewer sidebar. Renders spec files
// (.json/.jsonl) grouped by folder; folders collapse/expand; the active file is
// highlighted. Recurses by referencing itself (script-setup auto-names the
// component from its filename). Selection + expansion state are passed down as
// plain props so every recursion level shares them — no emit bubbling.
import { ref } from 'vue';

const props = defineProps({
  nodes:     { type: Array,    required: true },
  active:    { type: String,   default: '' },
  select:    { type: Function, required: true },
  collapsed: { type: Object,   default: null }, // shared ref(Set) of collapsed dir paths
  depth:     { type: Number,   default: 0 },
});

// Root level creates the shared collapsed-set ref; deeper levels reuse it.
const collapsed = props.collapsed || ref(new Set());
const isOpen = (p) => !collapsed.value.has(p);
function toggle(p) {
  const s = new Set(collapsed.value);
  s.has(p) ? s.delete(p) : s.add(p);
  collapsed.value = s;
}
const pad = (extra = 0) => ({ paddingLeft: `${props.depth * 14 + 8 + extra}px` });
</script>

<template>
  <ul class="slidey-tree" :class="{ root: depth === 0 }">
    <li v-for="node in nodes" :key="node.path">
      <template v-if="node.type === 'dir'">
        <div class="slidey-tree-row dir" :style="pad()" @click="toggle(node.path)">
          <span class="slidey-tree-caret">{{ isOpen(node.path) ? '▾' : '▸' }}</span>
          <span class="slidey-tree-name">{{ node.name }}</span>
        </div>
        <FileTree
          v-show="isOpen(node.path)"
          :nodes="node.children"
          :active="active"
          :select="select"
          :collapsed="collapsed"
          :depth="depth + 1"
        />
      </template>
      <div
        v-else
        class="slidey-tree-row file"
        :class="{ active: node.path === active }"
        :style="pad(14)"
        @click="select(node.path)"
      >
        <span class="slidey-tree-name">{{ node.name }}</span>
      </div>
    </li>
  </ul>
</template>

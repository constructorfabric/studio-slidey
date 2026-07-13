<script setup>
import { store } from '../store.js';

// bodyHtml/ledeHtml are optional companion fields (set by `slidey convert`
// from Markdown, or hand-authored) carrying inline emphasis and
// `<a data-slidey-ref="target">` links. When absent, body/lede render as
// plain text exactly as before (and stay directly click-to-edit via
// data-edit-path).
</script>

<template>
  <div id="narrative-region" class="scene-region active">
    <div id="narrative-eyebrow" class="reveal" :class="{ shown: store.isRevealed('narrative-eyebrow') }" data-edit-path='["eyebrow"]'>{{ store.scene.eyebrow || '' }}</div>
    <div id="narrative-rule"></div>
    <div id="narrative-body" class="reveal" :class="{ shown: store.isRevealed('narrative-body') }">
      <span v-if="store.scene.bodyHtml" v-html="store.scene.bodyHtml"></span>
      <span v-else data-edit-path='["body"]' data-edit-multiline>{{ store.scene.body || '' }}</span>
    </div>
    <div id="narrative-lede" class="reveal" :class="{ shown: store.isRevealed('narrative-lede') }">
      <span v-if="store.scene.ledeHtml" v-html="store.scene.ledeHtml"></span>
      <span v-else data-edit-path='["lede"]' data-edit-multiline>{{ store.scene.lede || '' }}</span>
    </div>
  </div>
</template>

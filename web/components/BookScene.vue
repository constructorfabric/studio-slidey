<script setup>
import { computed } from 'vue';
import { store } from '../store.js';

const sc = computed(() => store.scene || {});
const books = computed(() => (sc.value.books || []).slice(0, 3));
const shown = name => store.isRevealed(name);
const coverSrc = i => store.bookCoverDataUris[i] || books.value[i]?.dataUri || books.value[i]?.cover || '';
const metaLine = book => [book.authors, book.year].filter(Boolean).join(', ');
const publisherLine = book => [book.publisher, book.isbn ? `ISBN ${book.isbn}` : ''].filter(Boolean).join(' / ');
</script>

<template>
  <div id="book-region" class="scene-region active">
    <div
      v-if="sc.title"
      id="book-title"
      class="book-title reveal"
      :class="{ shown: shown('book-title') }"
    >{{ sc.title }}</div>

    <div class="book-grid" :class="`book-count-${books.length}`">
      <article
        v-for="(book, i) in books"
        :id="`book-item-${i}`"
        :key="book.title || i"
        class="book-card reveal"
        :class="{ shown: shown(`book-item-${i}`) }"
      >
        <div class="book-cover-wrap">
          <img
            v-if="coverSrc(i)"
            class="book-cover"
            :src="coverSrc(i)"
            :alt="book.alt || book.title || ''"
          />
          <div v-else class="book-cover-fallback">
            <span>{{ book.title }}</span>
            <small>{{ book.authors }}</small>
          </div>
        </div>

        <div class="book-info">
          <div class="book-name">{{ book.title }}</div>
          <div v-if="book.subtitle" class="book-subtitle">{{ book.subtitle }}</div>
          <div v-if="metaLine(book)" class="book-meta">{{ metaLine(book) }}</div>
          <div v-if="publisherLine(book)" class="book-publisher">{{ publisherLine(book) }}</div>
          <div v-if="book.takeaway" class="book-takeaway">{{ book.takeaway }}</div>
        </div>
      </article>
    </div>

    <div
      v-if="sc.caption"
      id="book-caption"
      class="book-caption reveal"
      :class="{ shown: shown('book-caption') }"
    >{{ sc.caption }}</div>
  </div>
</template>

<style scoped>
#book-region {
  width: 100%;
  max-width: 1680px;
  margin: 0 auto;
  gap: 30px;
}

.book-title {
  font-size: 36px;
  font-weight: bold;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #58a6ff;
  text-align: center;
}

.book-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 28px;
  align-items: stretch;
}

.book-count-1 { grid-template-columns: minmax(0, 1180px); justify-content: center; }
.book-count-2 { grid-template-columns: repeat(2, minmax(0, 540px)); justify-content: center; }

.book-card {
  min-height: 705px;
  border: 1px solid #30363d;
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(22, 27, 34, 0.98), rgba(13, 17, 23, 0.98));
  padding: 24px;
  display: grid;
  grid-template-rows: 390px 1fr;
  gap: 22px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.24);
}

.book-count-1 .book-card {
  min-height: 560px;
  grid-template-columns: 360px minmax(0, 1fr);
  grid-template-rows: 1fr;
  align-items: center;
  gap: 44px;
  padding: 34px 42px;
}

.book-cover-wrap {
  width: 100%;
  height: 390px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.book-count-1 .book-cover-wrap {
  height: 492px;
}

.book-cover {
  max-width: 100%;
  max-height: 100%;
  aspect-ratio: 2 / 3;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.36);
  background: #010409;
}

.book-count-1 .book-cover {
  width: 100%;
  height: 100%;
}

.book-cover-fallback {
  width: 260px;
  height: 390px;
  border: 1px solid #30363d;
  border-radius: 4px;
  background: #161b22;
  color: #f0f6fc;
  padding: 26px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: left;
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.36);
}

.book-count-1 .book-cover-fallback {
  width: 328px;
  height: 492px;
}

.book-cover-fallback span {
  font-size: 30px;
  line-height: 1.15;
  font-weight: 750;
}

.book-cover-fallback small {
  color: #8b949e;
  font-size: 18px;
  line-height: 1.35;
}

.book-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.book-count-1 .book-info {
  gap: 14px;
}

.book-name {
  color: #f0f6fc;
  font-size: 28px;
  font-weight: 760;
  line-height: 1.12;
}

.book-count-1 .book-name {
  font-size: 42px;
  line-height: 1.08;
}

.book-subtitle {
  color: #c9d1d9;
  font-size: 20px;
  line-height: 1.25;
  font-style: italic;
}

.book-count-1 .book-subtitle {
  font-size: 27px;
  line-height: 1.25;
}

.book-meta,
.book-publisher {
  color: #8b949e;
  font-size: 18px;
  line-height: 1.35;
}

.book-count-1 .book-meta,
.book-count-1 .book-publisher {
  font-size: 23px;
}

.book-takeaway {
  margin-top: auto;
  color: #7ee787;
  font-size: 21px;
  line-height: 1.32;
  border-top: 1px solid #30363d;
  padding-top: 14px;
}

.book-count-1 .book-takeaway {
  margin-top: 20px;
  font-size: 28px;
  line-height: 1.32;
  padding-top: 22px;
}

.book-caption {
  font-size: 28px;
  color: #8b949e;
  text-align: center;
  max-width: 1420px;
  line-height: 1.45;
  margin: 0 auto;
}
</style>

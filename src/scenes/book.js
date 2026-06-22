/**
 * SLIDEY - Book scene
 *
 * Bibliographic book-cover slide. Designed for 1-3 books with local cover
 * assets inlined by src/assets.js so exports stay deterministic.
 */

'use strict';

const TIMING = require('../timing');
const { sceneShowOpts } = require('../assets');

function bookCount(scene) {
  return Math.min(3, Math.max(0, (scene.books || []).length));
}

async function render(page, scene, ctx) {
  const opts = sceneShowOpts(scene, ctx.specPath);
  await page.evaluate((s, o) => window.slidey.showBook(s, o.bookCoverDataUris || []), scene, opts);
  if (scene.title) await ctx.setState('book_title');
  for (let i = 0; i < bookCount(scene); i++) {
    await ctx.setState(`book_item_${i}`);
  }
  if (scene.caption) await ctx.setState('book_caption');
  await ctx.hold(scene.hold ?? TIMING.book_hold ?? TIMING.cards_hold, 'book_hold');
  await page.evaluate(() => window.slidey.hideBook());
  await ctx.hold(TIMING.inter_scene, 'inter_scene');
}

module.exports = { render, bookCount };

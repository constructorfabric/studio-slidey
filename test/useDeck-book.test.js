'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('interactive deck loader resolves book covers relative to the spec base', async () => {
  const oldWindow = global.window;
  const oldFetch = global.fetch;
  const oldFileReader = global.FileReader;

  let fetchedUrl = '';
  let shown = null;
  const states = [];

  global.window = {
    location: { href: 'http://localhost:4321/viewer/' },
    slidey: {
      showBook(scene, coverDataUris) { shown = { scene, coverDataUris }; },
      setState(step) { states.push(step); },
    },
  };
  global.fetch = async (url) => {
    fetchedUrl = url;
    return { blob: async () => ({ marker: 'cover-bytes' }) };
  };
  global.FileReader = class {
    readAsDataURL(blob) {
      this.result = `data:image/jpeg;base64,${blob.marker}`;
      this.onload();
    }
  };

  try {
    const { createDeck } = await import('../web/useDeck.js');
    const deck = createDeck({
      scenes: [{
        type: 'book',
        title: 'Book',
        books: [{
          title: 'General System Theory',
          authors: 'Ludwig von Bertalanffy',
          cover: 'assets/books/general-system-theory.jpg',
          takeaway: 'Open systems.',
        }],
      }],
    }, 'http://localhost:4321/workspace/docs/decks/');

    await deck.render();

    assert.equal(fetchedUrl, 'http://localhost:4321/workspace/docs/decks/assets/books/general-system-theory.jpg');
    assert.deepEqual(shown.coverDataUris, ['data:image/jpeg;base64,cover-bytes']);
    assert.deepEqual(states, ['book_title']);
  } finally {
    global.window = oldWindow;
    global.fetch = oldFetch;
    global.FileReader = oldFileReader;
  }
});

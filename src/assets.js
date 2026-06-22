'use strict';

const fs = require('fs');
const path = require('path');

const MIME = {
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function resolveAsset(specPath, src) {
  if (!src || /^data:/i.test(src) || /^https?:\/\//i.test(src)) return src || '';
  return path.resolve(path.dirname(specPath || process.cwd()), src);
}

function assetDataUri(specPath, src) {
  const p = resolveAsset(specPath, src);
  if (!p || /^data:/i.test(p) || /^https?:\/\//i.test(p)) return p || '';
  if (!fs.existsSync(p)) return '';
  const ext = path.extname(p).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
}

function sceneShowOpts(scene, specPath) {
  const opts = {};
  if (scene.type === 'terminal-gif' && scene.gif) {
    opts.gifDataUri = assetDataUri(specPath, scene.gif);
  }
  if (scene.type === 'book' && Array.isArray(scene.books)) {
    opts.bookCoverDataUris = scene.books
      .slice(0, 3)
      .map(book => assetDataUri(specPath, book && book.cover));
  }
  return opts;
}

module.exports = { resolveAsset, assetDataUri, sceneShowOpts };

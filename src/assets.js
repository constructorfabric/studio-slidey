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
  if (scene.type === 'image' && scene.src) {
    opts.imageDataUri = assetDataUri(specPath, scene.src);
  }
  if (scene.type === 'image-compare') {
    opts.leftImageDataUri = assetDataUri(specPath, scene.left && scene.left.src);
    opts.rightImageDataUri = assetDataUri(specPath, scene.right && scene.right.src);
  }
  if (scene.type === 'meme' && scene.template) {
    // Best-effort sync cache read for the PDF/PNG export path; the MP4 render
    // path resolves (and warms the cache) asynchronously in scenes/meme.js.
    try {
      const tpl = require('./memes/registry').get(scene.template);
      if (tpl) opts.memeDataUri = require('./memes/cache').memeImageDataUriSync(tpl);
    } catch (_) { /* registry/cache best-effort */ }
  }
  if (scene.type === 'book' && Array.isArray(scene.books)) {
    opts.bookCoverDataUris = scene.books
      .slice(0, 3)
      .map(book => assetDataUri(specPath, book && book.cover));
  }
  // video (rrweb source): load the session log + derived chapters so the live
  // RrwebPlayer can mount and paint a poster frame in still renders (PNG/HTML
  // export + the MCP render tools). Without this the player shows its "No
  // session replay or video source loaded" placeholder and the scene can't be
  // visually QA'd. Best-effort: a missing/unreadable log just falls back to the
  // placeholder rather than failing the render. (MP4 `src` videos have no
  // headless poster path and are left to the placeholder.)
  // graph (projection input mode): resolve the projection JSON server-side so
  // the MP4/PDF/PNG/MCP render paths (no browser fetch available) see the same
  // data the interactive viewer fetches client-side via web/useDeck.js.
  if (scene.type === 'graph' && scene.projection) {
    try {
      const projectionAbs = resolveAsset(specPath, scene.projection);
      if (projectionAbs && !/^(data:|https?:)/i.test(projectionAbs) && fs.existsSync(projectionAbs)) {
        opts.projectionData = JSON.parse(fs.readFileSync(projectionAbs, 'utf8'));
      }
    } catch (_) { /* best-effort; the scene shows its no-data fallback */ }
  }
  if (scene.type === 'video' && scene.rrweb) {
    try {
      const rrwebAbs = resolveAsset(specPath, scene.rrweb);
      if (rrwebAbs && !/^(data:|https?:)/i.test(rrwebAbs) && fs.existsSync(rrwebAbs)) {
        const { loadRrweb, chaptersFromEvents } = require('./rrweb-format');
        const { events } = loadRrweb(rrwebAbs);
        const chapters = chaptersFromEvents(events, { specPath: rrwebAbs });
        opts.rrweb = { events, chapters };
      }
    } catch (_) { /* poster is best-effort; fall back to placeholder */ }
  }
  return opts;
}

module.exports = { resolveAsset, assetDataUri, sceneShowOpts };

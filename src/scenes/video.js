/**
 * SLIDEY — Video scene
 *
 * Embeds a demo MP4 into the deck timeline. Two sources:
 *   "src":     "demos/tour.mp4"     — a pre-rendered video (relative to the spec)
 *   "capture": "demos/tour.json"    — a tour spec captured on the fly via the
 *                                     slidey tour engine (src/tour), then embedded
 *
 * Two layouts:
 *   "mode": "fullscreen" (default)  — fills the frame; letterboxed on the deck
 *                                     background ("fit":"contain") or cropped
 *                                     ("fit":"cover").
 *   "mode": "embedded"              — inset in a deck slide with eyebrow/title/
 *                                     caption chrome and a framed border.
 *
 * Overlays (deck-styled, composited by ffmpeg):
 *   - auto lower-third captions from the chapter sidecar (chapters:"auto");
 *   - hand-authored `annotations` keyed to seconds or a chapter id.
 * Default for chapters: "auto" for a pre-rendered `src` (clean video), OFF for a
 * `capture` (its overlays are already baked in at capture time).
 *
 * Narration: a whole-scene string, OR time-keyed cues ({at|chapter, text})
 * resolved here to absolute timestamps and emitted per-cue by narration.js.
 *
 * Unlike other scenes this one produces frames OUTSIDE the Puppeteer screenshot
 * loop — a single ffmpeg pass (src/video.js) writes them straight into the
 * global sequence via ctx.framesDir / framePath / advanceFrames.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const video = require('../video');
const { renderOverlays } = require('../overlay-render');

/** Resolve the demo MP4 (capturing a tour first if `capture` is set) + chapters. */
async function resolveSource(scene, ctx) {
  const specDir = path.dirname(ctx.specPath);
  if (scene.src) {
    const abs = path.resolve(specDir, scene.src);
    if (!fs.existsSync(abs)) throw new Error(`video scene: src not found: ${abs}`);
    return { src: abs, captured: false, chapters: null };
  }
  if (scene.capture) {
    const tourPath = path.resolve(specDir, scene.capture);
    if (!fs.existsSync(tourPath)) throw new Error(`video scene: capture tour not found: ${tourPath}`);
    const tour = JSON.parse(fs.readFileSync(tourPath, 'utf-8'));
    if (!tour.specPath) tour.specPath = path.relative(process.cwd(), tourPath);
    const { captureToVideo } = require('../tour');
    const outMp4 = path.join(os.tmpdir(), `slidey-cap-${ctx.sceneIndex}-${process.pid}.mp4`);
    const res = await captureToVideo(tour, outMp4, { fps: ctx.fps });
    return { src: res.mp4, captured: true, chapters: res.chapters };
  }
  throw new Error('video scene: requires "src" or "capture"');
}

/** Resolve the chapter list per the scene's `chapters` setting. */
function resolveChapters(scene, src, capturedChapters, specDir) {
  if (scene.chapters === false) return [];
  if (typeof scene.chapters === 'string') return video.loadSidecar(path.resolve(specDir, scene.chapters).replace(/\.chapters\.json$/, ''));
  // auto / undefined: prefer captured chapters; else the sibling sidecar.
  if (capturedChapters && capturedChapters.length) return capturedChapters;
  return video.loadSidecar(src);
}

/** Map a chapter id → its start seconds (within the trimmed video). */
function chapterStartSec(chapters, id, trimStart) {
  const ch = chapters.find(c => c.id === id);
  if (!ch) return 0;
  return Math.max(0, (ch.start_ms / 1000) - (trimStart || 0));
}

async function render(page, scene, ctx) {
  const specDir = path.dirname(ctx.specPath);
  const { src, captured, chapters: capturedChapters } = await resolveSource(scene, ctx);
  const dur = video.probeDuration(src);
  if (!dur) throw new Error(`video scene: could not probe duration of ${src}`);

  const width  = ctx.width  || 1920;
  const height = ctx.height || 1080;
  const fps    = ctx.fps;
  const trimStart = Math.max(0, scene.start || 0);
  const startNumber = ctx.frameIndex();
  const frameCount  = video.videoFrameCount(dur, scene, fps);
  const sceneSec    = video.effectiveDuration(dur, scene);
  const embedded    = scene.mode === 'embedded';

  // chapters default: auto for a clean `src`, off for a `capture` (already baked).
  const chaptersDefault = captured ? false : 'auto';
  const chapterMode = scene.chapters != null ? scene.chapters : chaptersDefault;
  const chapters = chapterMode === false ? []
    : resolveChapters({ ...scene, chapters: chapterMode }, src, capturedChapters, specDir);

  // Embedded inset rect: centered 16:9 panel with room for title above / caption below.
  let inset = null;
  if (embedded) {
    const w = Math.round(width * 0.66);
    const h = Math.round((w * 9) / 16);
    inset = { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2) + 10, w, h };
  }

  // ── Build deck-styled overlays ────────────────────────────────────────────
  const overlayItems = [];
  if (embedded) {
    overlayItems.push({ id: 'chrome', kind: 'chrome', eyebrow: scene.eyebrow, title: scene.title, caption: scene.caption, inset });
  }
  // Auto lower-third captions from chapters (timed). In embedded mode they sit
  // inside the inset's lower edge; fullscreen uses the lower-third default.
  const timed = [];
  for (const ch of chapters) {
    const startSec = Math.max(0, (ch.start_ms / 1000) - trimStart);
    const endSec   = Math.max(startSec, (ch.end_ms / 1000) - trimStart);
    if (startSec >= sceneSec) continue;
    const pos = embedded
      ? { x: inset.x + 24, y: inset.y + inset.h - 84 }
      : {};
    timed.push({ id: ch.id, kind: 'caption', text: ch.label, startSec, endSec, ...pos });
  }
  // Hand-authored annotations (override / add on top). In embedded mode, an
  // annotation with no explicit position sits inside the inset's lower edge so
  // it doesn't collide with the slide caption below the frame.
  for (let i = 0; i < (scene.annotations || []).length; i++) {
    const a = scene.annotations[i];
    const startSec = a.chapter ? chapterStartSec(chapters, a.chapter, trimStart) : (a.at || 0);
    const endSec   = a.until != null ? a.until : sceneSec;
    const x = a.x != null ? a.x : (embedded ? inset.x + 24 : undefined);
    const y = a.y != null ? a.y : (embedded ? inset.y + inset.h - 84 : undefined);
    timed.push({ id: `anno-${i}`, kind: 'caption', text: a.text, sub: a.sub, startSec, endSec, x, y });
  }
  overlayItems.push(...timed);

  // Render overlay PNGs (deck palette) via the shared browser, then composite.
  let rendered = [];
  if (overlayItems.length) {
    const ovDir = path.join(ctx.framesDir, `_ov-${ctx.sceneIndex}`);
    rendered = await renderOverlays(page.browser(), overlayItems, { width, height, outDir: ovDir });
  }
  const byId = new Map(rendered.map(r => [r.id, r.png]));
  const ffOverlays = overlayItems.map(item => {
    const png = byId.get(item.id);
    if (!png) return null;
    if (item.kind === 'chrome') return { png };               // static, whole scene
    return { png, startSec: item.startSec, endSec: item.endSec };
  }).filter(Boolean);

  const { frameCount: actual } = video.extractFrames({
    src,
    framesDir: ctx.framesDir,
    startNumber,
    fps, width, height,
    fit: scene.fit || 'contain',
    start: trimStart,
    end: scene.end,
    speed: scene.speed,
    frameCount,
    inset,
    overlays: ffOverlays,
  });

  ctx.advanceFrames(actual);

  // ── Resolve time-keyed narration cues → absolute timestamps ───────────────
  if (Array.isArray(scene.narration)) {
    const sceneStart = startNumber / fps;
    const cues = scene.narration.map(c => {
      const at = c.chapter ? chapterStartSec(chapters, c.chapter, trimStart) : (c.at || 0);
      return { startSeconds: sceneStart + Math.min(at, sceneSec), text: c.text };
    }).filter(c => c.text);
    ctx.setNarrationCues(cues);
  }

  if (ctx.onProgress) ctx.onProgress(startNumber + actual - 1, null, 'video');
}

module.exports = { render };

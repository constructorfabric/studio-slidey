/**
 * SLIDEY — rrweb baked rasterizer (opt-in)
 *
 * Turns an `*.rrweb.json` event log into a deterministic PNG frame sequence (and
 * MP4) by driving rrweb's Replayer in headless Chrome: for each frame we seek
 * `replayer.pause(t)` and screenshot the reconstructed DOM. Seeking — not
 * wall-clock playback — is what keeps frames byte-stable across runs.
 *
 * The output MP4 is at the CAPTURED viewport; the `video` scene's existing
 * extractFrames() then scales/pads/insets it to the deck resolution, so the
 * whole fit / overlay / chapter pipeline is reused unchanged. This is the
 * "render = freeze-frame default, rrweb seek-rasterize opt-in" path.
 */

'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const { loadRrweb } = require('./rrweb-format');
const { rrwebBundlePath } = require('./tour/rrweb-capture');
const { framesToVideo } = require('./assembler');
const { launchOptions } = require('./browser');

/** Locate rrweb's replay stylesheet (sits alongside the UMD bundle). */
function rrwebStylePath() {
  const dir = path.dirname(rrwebBundlePath());
  const candidate = path.join(dir, 'style.css');
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Rasterize an rrweb log to a PNG sequence in `framesDir`.
 *
 * @param {string} rrwebPath  Path to `*.rrweb.json` (or a bare event array).
 * @param {string} framesDir
 * @param {object} opts  { fps=30, startFrame=0, onProgress? }
 * @returns {Promise<{ frameCount, viewport, startFrame, durationMs }>}
 */
async function rasterizeRrweb(rrwebPath, framesDir, opts = {}) {
  const fps = opts.fps || 30;
  const startFrame = opts.startFrame || 0;
  const onProgress = opts.onProgress || null;

  const { events, viewport, durationMs } = loadRrweb(rrwebPath);
  if (!events || events.length < 2) throw new Error(`rrweb log has no replayable events: ${rrwebPath}`);

  const bundle = fs.readFileSync(rrwebBundlePath(), 'utf8');
  const stylePath = rrwebStylePath();
  const style = stylePath ? fs.readFileSync(stylePath, 'utf8') : '';

  fs.mkdirSync(framesDir, { recursive: true });
  const framePath = (n) => path.join(framesDir, `frame-${String(n).padStart(6, '0')}.png`);

  let browser;
  try {
    browser = await puppeteer.launch(launchOptions({
      width: viewport.width,
      height: viewport.height,
      args: ['--disable-gpu'],
    }));
    const page = await browser.newPage();
    await page.setViewport({
      width: viewport.width, height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor || 1,
    });

    // A bare host page; rrweb builds the replay iframe inside #root.
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${style}` +
      `html,body{margin:0;padding:0;background:#fff}` +
      `#root{position:relative;width:${viewport.width}px;height:${viewport.height}px;overflow:hidden}` +
      `.replayer-wrapper{position:absolute;top:0;left:0}</style></head>` +
      `<body><div id="root"></div></body></html>`,
      { waitUntil: 'load' },
    );
    await page.addScriptTag({ content: bundle });

    const total = await page.evaluate((evts) => {
      const root = document.getElementById('root');
      // eslint-disable-next-line no-undef
      window.__player = new window.rrweb.Replayer(evts, {
        root, speed: 1, skipInactive: false, showWarning: false, mouseTail: false,
        UNSAFE_replayCanvas: false,
      });
      const meta = window.__player.getMetaData();
      return Math.max(0, meta.totalTime || 0);
    }, events);

    const spanMs = total || durationMs;
    const frameCount = Math.max(1, Math.round((spanMs / 1000) * fps));
    const root = await page.$('#root');

    let frameIndex = startFrame;
    for (let i = 0; i < frameCount; i++) {
      const t = Math.min(spanMs, Math.round((i / fps) * 1000));
      // Seek (deterministic) and let the DOM settle a tick before the shot.
      await page.evaluate((ms) => window.__player.pause(ms), t);
      await new Promise((r) => setTimeout(r, 0));
      await (root || page).screenshot({ path: framePath(frameIndex) });
      if (onProgress) onProgress(frameIndex, `t=${t}ms`);
      frameIndex++;
    }

    return { frameCount, viewport, startFrame, durationMs: spanMs };
  } finally {
    if (browser) {
      // close() then hard-kill the child: when a process opens a second browser
      // (here, alongside the main render loop) Puppeteer's transport socket can
      // linger past close() and hang process exit. Killing the child releases it.
      const proc = browser.process();
      await browser.close().catch(() => {});
      if (proc && !proc.killed) { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }
    }
  }
}

/**
 * Rasterize an rrweb log straight to an MP4 (at the captured viewport).
 * @returns {Promise<{ mp4, frameCount, durationMs, viewport }>}
 */
async function rasterizeRrwebToVideo(rrwebPath, outMp4, opts = {}) {
  const fps = opts.fps || 30;
  const framesDir = opts.framesDir
    ? path.resolve(opts.framesDir)
    : fs.mkdtempSync(path.join(require('os').tmpdir(), 'slidey-rrweb-ras-'));
  const ownFrames = !opts.framesDir;
  try {
    const { frameCount, durationMs, viewport } = await rasterizeRrweb(rrwebPath, framesDir, {
      fps, onProgress: opts.onProgress,
    });
    fs.mkdirSync(path.dirname(path.resolve(outMp4)), { recursive: true });
    framesToVideo(framesDir, path.resolve(outMp4), fps, null);
    return { mp4: path.resolve(outMp4), frameCount, durationMs, viewport };
  } finally {
    if (ownFrames && !opts.keepFrames) fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

/**
 * Render a single representative still from an rrweb log, fitted to the deck
 * resolution — for the PNG/PDF exporters (one Replayer seek + screenshot, no
 * full rasterize). @returns {Promise<string>} outPng
 */
async function extractRrwebPoster(rrwebPath, outPng, opts = {}) {
  const { spawnSync } = require('child_process');
  const { fitFilter } = require('./video');
  const width = opts.width || 1920;
  const height = opts.height || 1080;

  const { events, viewport, durationMs } = loadRrweb(rrwebPath);
  if (!events || events.length < 2) throw new Error(`rrweb log has no replayable events: ${rrwebPath}`);
  const bundle = fs.readFileSync(rrwebBundlePath(), 'utf8');
  const stylePath = rrwebStylePath();
  const style = stylePath ? fs.readFileSync(stylePath, 'utf8') : '';
  const atMs = opts.atSec != null ? Math.round(opts.atSec * 1000) : Math.round(durationMs * 0.1);

  const tmpPng = outPng + '.native.png';
  let browser;
  try {
    browser = await puppeteer.launch(launchOptions({
      width: viewport.width,
      height: viewport.height,
      args: ['--disable-gpu'],
    }));
    const page = await browser.newPage();
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.deviceScaleFactor || 1 });
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${style}` +
      `html,body{margin:0;padding:0;background:#fff}` +
      `#root{position:relative;width:${viewport.width}px;height:${viewport.height}px;overflow:hidden}` +
      `.replayer-wrapper{position:absolute;top:0;left:0}</style></head><body><div id="root"></div></body></html>`,
      { waitUntil: 'load' },
    );
    await page.addScriptTag({ content: bundle });
    await page.evaluate((evts, ms) => {
      const root = document.getElementById('root');
      window.__player = new window.rrweb.Replayer(evts, { root, speed: 1, skipInactive: false, showWarning: false, mouseTail: false });
      window.__player.pause(ms);
    }, events, atMs);
    await new Promise((r) => setTimeout(r, 0));
    const root = await page.$('#root');
    await (root || page).screenshot({ path: tmpPng });
  } finally {
    if (browser) {
      // close() then hard-kill the child: when a process opens a second browser
      // (here, alongside the main render loop) Puppeteer's transport socket can
      // linger past close() and hang process exit. Killing the child releases it.
      const proc = browser.process();
      await browser.close().catch(() => {});
      if (proc && !proc.killed) { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }
    }
  }

  // Fit the native-size still onto the deck background.
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  const r = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', tmpPng,
    '-vf', fitFilter(width, height, opts.fit || 'contain'),
    outPng,
  ], { encoding: 'utf8' });
  fs.rmSync(tmpPng, { force: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`rrweb poster fit failed (status ${r.status}):\n${(r.stderr || '').slice(0, 400)}`);
  return outPng;
}

module.exports = { rasterizeRrweb, rasterizeRrwebToVideo, extractRrwebPoster };

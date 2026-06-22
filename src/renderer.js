/**
 * SLIDEY — Frame Renderer (scene-type dispatcher)
 *
 * Drives a Puppeteer browser through each scene in the spec, capturing PNG
 * frames that ffmpeg will stitch into a video. Each scene type is a module
 * in scenes/ that owns its visual loading and progressive-reveal sequence;
 * the dispatcher here only manages the page, the frame counter, the timing
 * helpers, and per-scene context.
 *
 * For live `request` scenes, the runner executes the real HTTP request
 * first, then the response is rendered. Mock and playback modes skip the
 * HTTP call. See scenes/request.js.
 *
 * Visual look:   the Vue render bundle (dist/render.html), shared with the
 *   interactive web app and the PDF exporter. Build it with `npm run build:render`.
 * Animation pacing: timing.js (frames per state name).
 */

'use strict';

const puppeteer = require('puppeteer');
const path      = require('path');
const fs        = require('fs');
const TIMING    = require('./timing');
const { launchOptions } = require('./browser');

// Self-contained Vue render harness (built by `npm run build:render` →
// web/inline-render.mjs). Loaded via file://; exposes the same window.slidey.*
// surface the scene modules drive, plus window.__slideyReady / __slideySettle.
const RENDER_BUNDLE = path.resolve(__dirname, '..', 'dist-render', 'render.html');

const SCENE_MODULES = {
  title:          require('./scenes/title'),
  request:        require('./scenes/request'),
  narrative:      require('./scenes/narrative'),
  diagram:        require('./scenes/diagram'),
  'diagram-svg':  require('./scenes/diagram-svg'),
  'terminal-gif': require('./scenes/terminal-gif'),
  trace:          require('./scenes/trace'),
  transcript:     require('./scenes/transcript'),
  thread:         require('./scenes/thread'),
  stat:           require('./scenes/stat'),
  cta:            require('./scenes/cta'),
  cards:          require('./scenes/cards'),
  code:           require('./scenes/code'),
  table:          require('./scenes/table'),
  chart:          require('./scenes/chart'),
  book:           require('./scenes/book'),
  video:          require('./scenes/video'),
};

/**
 * Render every scene in `spec` to PNG frames inside `framesDir`.
 *
 * @param {object}   spec            - Parsed spec (.demo.json / .pitch.json)
 * @param {string}   framesDir       - Directory for frame-NNNNNN.png
 * @param {number}   fps             - Target frames per second
 * @param {function} onProgress      - Optional callback(frameIndex, total, label)
 * @param {string}   captureLogPath  - Optional path for live-response capture log
 * @param {string}   specPath        - Absolute path to the spec (used to resolve
 *                                     relative asset paths like gif/audio files)
 * @param {Set}      selectedScenes  - Optional Set of scene indices to render.
 *                                     If null, render all. Skipped scenes leave
 *                                     no frames — the assembled MP4 contains
 *                                     only the picked scenes back-to-back.
 * @returns {Promise<number>} Total frames written
 */
async function generateFrames(spec, framesDir, fps = 30, onProgress = null, captureLogPath = null, specPath = null, selectedScenes = null, noGaps = false) {
  const { width = 1920, height = 1080 } = (spec.meta && spec.meta.resolution) || {};
  const mode = (spec.meta && spec.meta.mode) || 'api';  // 'api' | 'pitch'

  // Shared HTTP context (mutated by request-scene captures across scenes)
  const requestContext = Object.assign({}, (spec.meta && spec.meta.context) || {});

  // Rebuilds dist-render if missing OR stale vs web/ — the MP4 always renders
  // the current viewer renderer.
  require('./render-bundle').ensureRenderBundle();

  const browser = await puppeteer.launch(launchOptions({ width, height }));

  let frameIndex = 0;
  const captureLog = [];
  // Per-scene start frames so narration audio can be positioned at correct
  // timestamps in the final MP4. Each entry: { sceneIndex, startFrame, type, narration }.
  const sceneBoundaries = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`file://${RENDER_BUNDLE}`, { waitUntil: 'load' });
    // Wait for Vue to mount + install window.slidey before driving it.
    await page.waitForFunction('window.__slideyReady === true', { timeout: 15000 });

    // Apply global metadata + mode (chrome bar visibility, brand, etc.)
    await page.evaluate((meta, m) => {
      window.slidey.setMeta(meta);
      window.slidey.setMode(m);
    }, spec.meta || {}, mode);

    if (noGaps) {
      await page.evaluate(() => document.body.classList.add('instant'));
    }

    const framePath = n => path.join(framesDir, `frame-${String(n).padStart(6, '0')}.png`);

    const hold = async (n, label = '') => {
      // Settle barrier: Vue patches the DOM asynchronously, so flush its pending
      // render (nextTick + fonts + image decode) before capturing — otherwise a
      // screenshot races an un-applied reveal. All frame capture funnels through
      // hold(), so this single await covers every scene module unchanged.
      await page.evaluate('window.__slideySettle && window.__slideySettle()');
      for (let i = 0; i < n; i++) {
        await page.screenshot({ path: framePath(frameIndex) });
        if (onProgress) onProgress(frameIndex, null, label);
        frameIndex++;
      }
    };

    const setState = async stepName => {
      await page.evaluate(s => window.slidey.setState(s), stepName);
      const frames = TIMING[stepName] ?? 20;
      await hold(frames, stepName);
    };

    // --no-gaps: setState still fires DOM updates (so all .reveal elements get
    // .shown before any frames are captured) but skips the reveal-animation
    // hold frames. Only the scene's explicit hold() calls capture frames, by
    // which point the full scene is visible. Combined with body.instant (no
    // CSS fade), scenes cut hard with complete content, no blank frames.
    const sceneSetState = noGaps
      ? async stepName => { await page.evaluate(s => window.slidey.setState(s), stepName); }
      : setState;

    // Per-scene rendering loop
    for (let sceneIndex = 0; sceneIndex < (spec.scenes || []).length; sceneIndex++) {
      if (selectedScenes && !selectedScenes.has(sceneIndex)) continue;
      const scene = spec.scenes[sceneIndex];
      const boundary = {
        sceneIndex,
        startFrame: frameIndex,
        type: scene.type,
        narration: scene.narration || null,
      };
      sceneBoundaries.push(boundary);
      const mod   = SCENE_MODULES[scene.type];
      if (!mod) {
        throw new Error(
          `[slidey] unknown scene type "${scene.type}" at scenes[${sceneIndex}]. ` +
          `Known types: ${Object.keys(SCENE_MODULES).join(', ')}.`
        );
      }

      // scene.seamless: per-scene equivalent of --no-gaps (skip inter_scene,
      // suppress reveal animations). body.instant is toggled around each such
      // scene so transitions elsewhere in the video are unaffected.
      const isSeamless = noGaps || scene.seamless;
      if (!noGaps && scene.seamless) {
        await page.evaluate(() => document.body.classList.add('instant'));
      }

      const sceneHold = isSeamless
        ? async (n, label) => { if (label !== 'inter_scene') await hold(n, label); }
        : hold;
      const sceneStateSet = isSeamless
        ? async stepName => { await page.evaluate(s => window.slidey.setState(s), stepName); }
        : setState;
      const ctx = {
        sceneIndex,
        specPath: specPath || process.cwd(),
        hold: sceneHold, setState: sceneStateSet,
        frameIndex: () => frameIndex,
        onProgress,
        requestContext,
        captureLog: captureLogPath ? captureLog : null,
        // Frame-emitting surface for scenes that produce frames OUTSIDE the
        // Puppeteer screenshot loop (e.g. the `video` scene, which ffmpeg-
        // extracts an MP4 straight into the global sequence). A scene writes
        // frame-NNNNNN.png starting at frameIndex() into framesDir, then calls
        // advanceFrames(n) so the global counter and narration timing stay exact.
        framesDir,
        framePath,
        fps,
        width,
        height,
        advanceFrames: n => { frameIndex += n; },
        // Attach resolved time-keyed narration cues to this scene's boundary so
        // narration.js can emit one audio segment per cue at its own timestamp
        // (used by the video scene for narration synced to chapter/seconds).
        setNarrationCues: cues => { boundary.narrationCues = cues; },
      };

      await mod.render(page, scene, ctx);

      if (!noGaps && scene.seamless) {
        await page.evaluate(() => document.body.classList.remove('instant'));
      }
    }

  } finally {
    await browser.close();
  }

  if (captureLogPath && captureLog.length > 0) {
    fs.writeFileSync(captureLogPath, JSON.stringify(captureLog, null, 2), 'utf-8');
    console.log(`[slidey] Capture log written: ${captureLogPath} (${captureLog.length} live scenes)`);
  }

  return { frameCount: frameIndex, sceneBoundaries };
}

module.exports = { generateFrames };

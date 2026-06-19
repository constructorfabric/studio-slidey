/**
 * SLIDEY — Tour chapter sidecar
 *
 * Records one [start_ms, end_ms) window per tour step and writes the
 * producer-agnostic `<video>.chapters.json` sidecar. The shape is kept
 * byte-compatible with kitsoki's recorder (internal/video.Chapter and
 * tests/playwright/_helpers/server.ts ChapterRecorder) so any consumer — the
 * slidey `video` scene, kitsoki's feedback panel — reads one uniform list
 * regardless of producer.
 *
 * Unlike kitsoki's wall-clock recorder, windows here are derived from FRAME
 * ranges (freeze-frame capture): start_ms = startFrame / fps * 1000. This is
 * exact and deterministic — the sidecar lines up with the rendered MP4 because
 * both come from the same frame count.
 */

'use strict';

const fs = require('fs');

class ChapterRecorder {
  constructor(fps) {
    this.fps = fps;
    this.chapters = [];
    this._open = null;
  }

  /** Begin a chapter for `stepId` at `startFrame`. Closes any open one first. */
  open(stepId, label, specPath, startFrame, line) {
    this.close(startFrame);
    this._open = { id: stepId, label: label || stepId, specPath, line, startFrame };
  }

  /** Close the current chapter, sealing its end at `endFrame`. */
  close(endFrame) {
    if (!this._open) return;
    const o = this._open;
    const toMs = (f) => Math.round((f / this.fps) * 1000);
    this.chapters.push({
      index: this.chapters.length,
      id: o.id,
      label: o.label,
      start_ms: toMs(o.startFrame),
      end_ms: toMs(endFrame),
      source_ref: Object.assign(
        { kind: 'tour', spec_path: o.specPath || '', step_id: o.id },
        o.line ? { line: o.line } : {},
      ),
    });
    this._open = null;
  }

  /** Finalize (closing any open chapter at `endFrame`) and return the list. */
  list(endFrame) {
    this.close(endFrame);
    return this.chapters;
  }
}

/**
 * Write `<videoPath>.chapters.json`. Returns the sidecar path, or null when
 * there is no video or no chapters.
 */
function writeChapters(videoPath, chapters) {
  if (!videoPath || !chapters || chapters.length === 0) return null;
  const sidecar = `${videoPath}.chapters.json`;
  fs.writeFileSync(sidecar, JSON.stringify(chapters, null, 2) + '\n');
  return sidecar;
}

module.exports = { ChapterRecorder, writeChapters };

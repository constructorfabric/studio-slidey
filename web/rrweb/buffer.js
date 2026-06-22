/**
 * SLIDEY — rrweb session-capture buffer (browser, app-agnostic)
 *
 * A rolling rrweb recorder that keeps roughly the last `retainCheckpoints ×
 * checkoutEveryNms` of DOM activity. Generalized from kitsoki's
 * tools/runstatus/src/data/session-capture.ts so slidey owns the canonical
 * implementation and kitsoki re-imports it (for its bug-report capture) instead
 * of maintaining a private copy.
 *
 * Two shapes are exported:
 *   - createSessionCapture(opts) → an isolated recorder instance (preferred for
 *     embedding; no shared global state), and
 *   - a module-level singleton (startSessionCapture / snapshotSessionEvents /
 *     __resetSessionCapture) that mirrors kitsoki's original drop-in API.
 *
 * rrweb is INJECTABLE (pass `record`) so tests drive the buffer with a stub
 * emitter and never load the real, DOM-heavy library; in production the real
 * rrweb.record is lazily imported.
 *
 * Privacy: a snapshot is typically written into a committed artifact, so masking
 * is the safety boundary. Defaults mask all inputs AND all text nodes and block
 * password fields; what survives is interaction flow + layout — the replay's
 * real value. A producer that needs verbatim text (e.g. an on-purpose product
 * demo) opts out explicitly via { maskAllText:false }.
 */

/** type=2 FullSnapshot (a checkout point); type=4 Meta (href + viewport). */
const FULL_SNAPSHOT = 2;
// rrweb emits exactly one Meta at record start and does NOT re-emit it on later
// checkouts — so once buffer trimming drops the original Meta we must re-prepend
// it, or every snapshot past the first checkout (~one interval in) replays blank
// (the Replayer needs a Meta before the first FullSnapshot to size its iframe).
const META = 4;

const DEFAULTS = {
  checkoutEveryNms: 15000,
  retainCheckpoints: 2, // ≈ retainCheckpoints × checkoutEveryNms of history
  maskAllInputs: true,
  maskAllText: true,
  blockSelector: 'input[type="password"]',
};

/**
 * Create an isolated rolling-buffer recorder. Returns control functions; no
 * module-level state is touched, so multiple recorders can coexist.
 *
 * @param {object} [opts]
 * @param {(o:object)=>(()=>void)|undefined} [opts.record] rrweb.record impl (injected for tests)
 * @param {number}  [opts.checkoutEveryNms=15000]
 * @param {number}  [opts.retainCheckpoints=2]
 * @param {boolean} [opts.maskAllInputs=true]
 * @param {boolean} [opts.maskAllText=true]
 * @param {string}  [opts.blockSelector]
 * @param {boolean} [opts.recordCanvas=false]  capture <canvas> (heavier logs)
 * @param {boolean} [opts.inlineStylesheet=true]
 * @param {boolean} [opts.inlineImages=false]
 */
export function createSessionCapture(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };

  let buffer = [];
  // Index (into buffer) of the previous full-snapshot checkpoint; -1 until the
  // first checkout. A queue of recent checkpoint indices lets us retain N.
  let checkpoints = [];
  // The first Meta event (type=4); retained verbatim so we can re-prepend it to
  // a snapshot whose trimming dropped it (else the Replayer renders blank).
  let firstMeta = null;
  let stopFn;
  let started = false;

  function onEmit(event) {
    try {
      if (event.type === META && !firstMeta) firstMeta = event;
      if (event.type === FULL_SNAPSHOT) {
        // New checkpoint. Keep at most `retainCheckpoints` of them: when we have
        // more than that, drop everything before the oldest one we still want.
        checkpoints.push(buffer.length);
        if (checkpoints.length > cfg.retainCheckpoints) {
          const dropBefore = checkpoints[checkpoints.length - cfg.retainCheckpoints];
          if (dropBefore > 0) {
            buffer = buffer.slice(dropBefore);
            checkpoints = checkpoints.map((i) => i - dropBefore).filter((i) => i >= 0);
          }
        }
      }
      buffer.push(event);
    } catch {
      /* never throw out of the emit path */
    }
  }

  function buildRecordOptions() {
    // Only pass keys rrweb understands; rrweb tolerates unknown keys but keep it
    // tight. emit is required; the rest are recording knobs.
    const o = {
      emit: onEmit,
      checkoutEveryNms: cfg.checkoutEveryNms,
      maskAllInputs: cfg.maskAllInputs,
      recordCanvas: cfg.recordCanvas,
      inlineStylesheet: cfg.inlineStylesheet !== false,
      inlineImages: cfg.inlineImages,
    };
    if (cfg.maskAllText) o.maskTextSelector = '*';
    if (cfg.blockSelector) o.blockSelector = cfg.blockSelector;
    return o;
  }

  /** Start recording. Idempotent while a capture is active. */
  function start(recordImpl) {
    if (started) return;
    started = true;
    const rec = recordImpl || cfg.record;
    const o = buildRecordOptions();
    try {
      if (rec) {
        stopFn = rec(o) || undefined;
      } else {
        // Lazy-load the real rrweb so it isn't eager in the host bundle.
        import('rrweb')
          .then((mod) => {
            const r = mod && mod.record;
            if (r && started) stopFn = r(o) || undefined;
          })
          .catch(() => {
            /* recording unavailable — non-fatal */
          });
      }
    } catch {
      /* never let capture init throw */
    }
  }

  /**
   * Snapshot the current rolling buffer (a copy). If trimming dropped the
   * original Meta, re-prepend the retained one so the snapshot starts with a
   * Meta before its first FullSnapshot.
   */
  function snapshot() {
    const events = buffer.slice();
    const firstFullIdx = events.findIndex((e) => e.type === FULL_SNAPSHOT);
    if (firstFullIdx >= 0) {
      const metaBeforeFull = events
        .slice(0, firstFullIdx)
        .some((e) => e.type === META);
      if (!metaBeforeFull && firstMeta) events.unshift(firstMeta);
    }
    return events;
  }

  /** Stop recording and reset all state. */
  function reset() {
    try {
      if (stopFn) stopFn();
    } catch {
      /* ignore */
    }
    stopFn = undefined;
    buffer = [];
    checkpoints = [];
    firstMeta = null;
    started = false;
  }

  return {
    start,
    snapshot,
    reset,
    /** Live event count (for UI gates: a replay needs ≥ 2 events). */
    get length() {
      return buffer.length;
    },
    get isRecording() {
      return started;
    },
  };
}

// --- Module-level singleton: drop-in for kitsoki's original API ---------------

let _singleton = null;
function singleton() {
  if (!_singleton) _singleton = createSessionCapture();
  return _singleton;
}

/** Start the shared recorder. Pass an rrweb record() impl for tests. */
export function startSessionCapture(record) {
  singleton().start(record);
}

/** Snapshot the shared recorder's rolling buffer (a copy). */
export function snapshotSessionEvents() {
  return singleton().snapshot();
}

/** Stop + reset the shared recorder (mainly for tests). */
export function __resetSessionCapture() {
  if (_singleton) _singleton.reset();
  _singleton = null;
}

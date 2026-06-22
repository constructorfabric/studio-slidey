/**
 * SLIDEY — rrweb source format + chapter extraction (node side)
 *
 * Defines the `*.rrweb.json` envelope slidey produces/consumes and the converter
 * that turns in-log `slidey.chapter` custom events into the producer-agnostic
 * Chapter[] list (source_ref.kind:"rrweb") — byte-compatible with the existing
 * `<video>.mp4.chapters.json` sidecar so the `video` scene reads one uniform
 * shape regardless of whether the source is a captured MP4 or an rrweb log.
 *
 * Why custom events carry the chapters: it makes the rrweb log self-describing
 * (a kitsoki bug report can carry the same markers), so the sidecar is just a
 * convenience mirror — the log is the single source of truth.
 *
 * Envelope shape (`<base>.rrweb.json`):
 *   {
 *     "schemaVersion": 1,
 *     "source": "slidey-capture",
 *     "viewport": { "width": 1600, "height": 900, "deviceScaleFactor": 1 },
 *     "startTime": <ms epoch>, "endTime": <ms epoch>, "durationMs": <n>,
 *     "events": [ ...rrweb events... ]
 *   }
 */

'use strict';

const fs = require('fs');

const EVENT_META = 4; // { data: { href, width, height } }
const EVENT_CUSTOM = 5; // { data: { tag, payload } }
const CHAPTER_TAG = 'slidey.chapter';

const SCHEMA_VERSION = 1;

/** Wall-clock span of an event log, in ms (0 for <2 events). */
function rrwebDuration(events) {
  if (!Array.isArray(events) || events.length < 2) return 0;
  const first = events[0].timestamp;
  const last = events[events.length - 1].timestamp;
  if (typeof first !== 'number' || typeof last !== 'number') return 0;
  return Math.max(0, last - first);
}

/** Viewport from the first Meta event, falling back to a default. */
function rrwebViewport(events, fallback) {
  const meta = (events || []).find((e) => e && e.type === EVENT_META && e.data);
  if (meta && typeof meta.data.width === 'number' && typeof meta.data.height === 'number') {
    return { width: meta.data.width, height: meta.data.height };
  }
  return Object.assign({ width: 1600, height: 900 }, fallback || {});
}

/**
 * Extract chapters from `slidey.chapter` custom events. Each marker opens a
 * window that closes at the next marker (or the log end). Times are ms relative
 * to the FIRST event's timestamp — i.e. the Replayer timeline, so chapter
 * windows line up with both live replay and a baked render of the same log.
 *
 * Marker payload: { id, label, specPath?, line? }
 *
 * @returns {Array<{index,id,label,start_ms,end_ms,source_ref}>}
 */
function chaptersFromEvents(events, opts = {}) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const t0 = events[0].timestamp || 0;
  const endRel = rrwebDuration(events);
  const specPathDefault = opts.specPath || '';

  const marks = [];
  for (const e of events) {
    if (e && e.type === EVENT_CUSTOM && e.data && e.data.tag === CHAPTER_TAG) {
      const p = e.data.payload || {};
      marks.push({
        id: p.id || `step-${marks.length}`,
        label: p.label || p.id || `step-${marks.length}`,
        specPath: p.specPath || specPathDefault,
        line: p.line,
        start_ms: Math.max(0, Math.round((e.timestamp || t0) - t0)),
      });
    }
  }

  return marks.map((m, i) => {
    const next = marks[i + 1];
    const end_ms = next ? next.start_ms : endRel;
    return {
      index: i,
      id: m.id,
      label: m.label,
      start_ms: m.start_ms,
      end_ms,
      source_ref: Object.assign(
        { kind: 'rrweb', spec_path: m.specPath || '', step_id: m.id },
        m.line ? { line: m.line } : {},
      ),
    };
  });
}

/** Build the `*.rrweb.json` envelope from a raw event log. */
function buildEnvelope(events, opts = {}) {
  const first = events && events.length ? events[0].timestamp : 0;
  const last = events && events.length ? events[events.length - 1].timestamp : 0;
  return {
    schemaVersion: SCHEMA_VERSION,
    source: opts.source || 'slidey-capture',
    viewport: Object.assign(
      rrwebViewport(events, opts.viewport),
      opts.viewport && opts.viewport.deviceScaleFactor
        ? { deviceScaleFactor: opts.viewport.deviceScaleFactor }
        : {},
    ),
    startTime: first,
    endTime: last,
    durationMs: rrwebDuration(events),
    events: events || [],
  };
}

/** Write `<path>` (envelope). Returns the path. */
function writeEnvelope(filePath, envelope) {
  fs.writeFileSync(filePath, JSON.stringify(envelope) + '\n');
  return filePath;
}

/**
 * Load an rrweb source. Accepts either the envelope shape `{ events: [...] }`
 * or a bare event array (kitsoki bug-report logs are bare arrays). Returns a
 * normalized `{ events, viewport, durationMs, schemaVersion?, source? }`.
 */
function loadRrweb(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const events = Array.isArray(raw) ? raw : raw.events || [];
  const env = Array.isArray(raw) ? {} : raw;
  return {
    events,
    viewport: env.viewport || rrwebViewport(events),
    durationMs: env.durationMs != null ? env.durationMs : rrwebDuration(events),
    schemaVersion: env.schemaVersion,
    source: env.source,
  };
}

module.exports = {
  CHAPTER_TAG,
  EVENT_CUSTOM,
  EVENT_META,
  SCHEMA_VERSION,
  rrwebDuration,
  rrwebViewport,
  chaptersFromEvents,
  buildEnvelope,
  writeEnvelope,
  loadRrweb,
};

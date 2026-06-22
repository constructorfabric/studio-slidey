// SLIDEY — rrweb chapter extraction (browser, ESM)
//
// Browser-side mirror of src/rrweb-format.js's chaptersFromEvents, returning the
// fields the RrwebPlayer scrub bar needs ({id,label,start_ms,end_ms}). Chapters
// live in the log as `slidey.chapter` custom events (type 5), so a self-contained
// rrweb log needs no sidecar to show chapter markers.

const EVENT_CUSTOM = 5;
export const CHAPTER_TAG = 'slidey.chapter';

/** @returns {Array<{id,label,start_ms,end_ms}>} */
export function chaptersFromEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const t0 = events[0].timestamp || 0;
  const endRel = events.length >= 2
    ? Math.max(0, (events[events.length - 1].timestamp || t0) - t0)
    : 0;
  const marks = [];
  for (const e of events) {
    if (e && e.type === EVENT_CUSTOM && e.data && e.data.tag === CHAPTER_TAG) {
      const p = e.data.payload || {};
      marks.push({
        id: p.id || `step-${marks.length}`,
        label: p.label || p.id || `step-${marks.length}`,
        start_ms: Math.max(0, Math.round((e.timestamp || t0) - t0)),
      });
    }
  }
  return marks.map((m, i) => ({
    id: m.id,
    label: m.label,
    start_ms: m.start_ms,
    end_ms: marks[i + 1] ? marks[i + 1].start_ms : endRel,
  }));
}

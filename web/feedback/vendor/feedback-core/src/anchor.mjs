// anchor.mjs — req-producer-owned-anchors: a generic anchor envelope where
// ONLY the producer interprets scope/step/ref. This module (a consumer-side
// core) validates envelope SHAPE and freezes it; it never parses the meaning
// of scope/step/ref, and anchorDisplayFields exposes values for display
// verbatim — the one legal consumer use.
//
// req-data-avoidance-default: the envelope carries ids, refs, labels, bboxes
// and a url — never raw DOM text, screenshots, or replay logs. Producers
// wanting more attach it under `extra` (still subject to privacy review).

/** Envelope fields a producer may stamp. */
const FIELDS = ["producer", "artifactId", "scope", "step", "ref", "label", "bbox", "mediaTimeMs", "url", "extra"];

/**
 * @param {object} raw
 * @returns {Readonly<object>} frozen anchor envelope
 */
export function createAnchor(raw) {
  if (!raw || typeof raw !== "object") throw new TypeError("anchor: envelope object required");
  if (!raw.producer || typeof raw.producer !== "string") throw new TypeError("anchor: producer (string) is required — anchors are producer-owned");
  if (!raw.artifactId || typeof raw.artifactId !== "string") throw new TypeError("anchor: artifactId (string) is required");
  if (raw.bbox != null && (!Array.isArray(raw.bbox) || raw.bbox.length !== 4 || raw.bbox.some((v) => typeof v !== "number"))) {
    throw new TypeError("anchor: bbox must be [x, y, w, h] numbers when present");
  }
  if (raw.mediaTimeMs != null && typeof raw.mediaTimeMs !== "number") throw new TypeError("anchor: mediaTimeMs must be a number when present");
  const unknown = Object.keys(raw).filter((k) => !FIELDS.includes(k));
  if (unknown.length) throw new TypeError(`anchor: unknown field(s) ${unknown.join(", ")} — producers extend via extra`);
  const anchor = {};
  for (const f of FIELDS) if (raw[f] !== undefined) anchor[f] = raw[f];
  return Object.freeze(anchor);
}

/**
 * The only consumer-legal read: fields for DISPLAY, meaning un-interpreted.
 * @param {object} anchor
 * @returns {Array<[string, unknown]>}
 */
export function anchorDisplayFields(anchor) {
  return FIELDS.filter((f) => anchor[f] !== undefined).map((f) => [f, anchor[f]]);
}

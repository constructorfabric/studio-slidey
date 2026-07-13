// sinks.mjs — req-multi-sink-routing (v0.1 slice) + req-idempotent-submission
// enforcement + req-sink-lifecycle-ops' contract shape (erase/replaceEvidence
// optional members; local sink implements both).
//
// v0.1 sinks: local JSONL note, reviewed artifact bundle, no-op dry-run.
// GitHub/Jira/Linear/AI dispatch are kitsoki-parity follow-ons (each already
// a draft req in the catalog) — the CONTRACT here already carries them.
// The frontend never learns upload mechanics: it hands the router a reviewed
// bundle and gets back {ref, sink, deduped}.

/** Local JSONL sink: host supplies the append/erase/replace persistence. */
export function localJsonlSink({ append, erase, replaceEvidence } = {}) {
  const lines = [];
  return {
    id: "local-jsonl",
    lines,
    async submit(bundle) {
      const line = JSON.stringify(bundle);
      lines.push(line);
      if (append) await append(line);
      return { ref: bundle.idempotencyKey };
    },
    async erase(id, reason) {
      if (erase) return erase(id, reason);
      const i = lines.findIndex((l) => JSON.parse(l).idempotencyKey === id);
      if (i >= 0) lines.splice(i, 1, JSON.stringify({ erased: id, reason }));
      return { erased: id };
    },
    async replaceEvidence(id, bundle) {
      if (replaceEvidence) return replaceEvidence(id, bundle);
      const i = lines.findIndex((l) => JSON.parse(l).idempotencyKey === id);
      if (i >= 0) lines[i] = JSON.stringify(bundle);
      return { replaced: id };
    },
  };
}

/** Reviewed-artifact-bundle sink: the note IS the artifact. */
export function bundleSink() {
  const bundles = [];
  return {
    id: "bundle",
    bundles,
    async submit(bundle) {
      bundles.push(bundle);
      return { ref: bundle.idempotencyKey };
    },
  };
}

/** No-op dry-run sink. */
export function dryRunSink() {
  const seen = [];
  return {
    id: "dry-run",
    seen,
    async submit(bundle) {
      seen.push(bundle.idempotencyKey);
      return { ref: `dry-${bundle.idempotencyKey}` };
    },
  };
}

/**
 * HTTP transport for a reviewed-bundle intake endpoint.  A non-2xx response
 * remains an error so the UI can retry using the stable idempotency key.
 */
export function httpSink({ url, fetch = globalThis.fetch } = {}) {
  if (!url || typeof url !== "string") throw new TypeError("httpSink: url (string) is required");
  if (typeof fetch !== "function") throw new TypeError("httpSink: fetch function is required");
  return {
    id: "http",
    async submit(bundle) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle),
      });
      if (!response.ok) throw new Error(`httpSink: POST ${url} failed (${response.status})`);
      const receipt = await response.json();
      if (!receipt || typeof receipt.ref !== "string") throw new Error("httpSink: response must contain a string ref");
      return receipt;
    },
  };
}

/**
 * Router: kind -> sink, with idempotency-key dedupe. Retrying a submit
 * (network failure, duplicate click) never creates a second item: an
 * already-settled key returns the SAME receipt, marked deduped.
 */
export function createRouter({ sinks, route }) {
  const byId = new Map(sinks.map((s) => [s.id, s]));
  const settled = new Map(); // idempotencyKey -> receipt
  return {
    async submit(bundle) {
      if (!bundle?.reviewed) throw new Error("router: refusing non-reviewed payload");
      const key = bundle.idempotencyKey;
      if (settled.has(key)) return { ...settled.get(key), deduped: true };
      const sinkId = route ? route(bundle.kind) : sinks[0].id;
      const sink = byId.get(sinkId);
      if (!sink) throw new Error(`router: no sink ${sinkId}`);
      const receipt = { ...(await sink.submit(bundle)), sink: sinkId, deduped: false };
      settled.set(key, receipt);
      return receipt;
    },
  };
}

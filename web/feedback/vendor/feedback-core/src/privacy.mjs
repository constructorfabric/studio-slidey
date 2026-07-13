// privacy.mjs — req-privacy-fail-closed + req-data-avoidance-default +
// req-raw-drafts-stay-local's classification half.
//
// A privacy manifest classifies every field path a bundle may carry.
// Sensitivities: "public" | "user_provided" | "low" | "high". A field the
// manifest has NOT classified is unknown — and unknown BLOCKS submit
// (fail closed, with the reason listed), it is never silently allowed.
// A "high" field additionally requires an explicit host-declared policy
// (hostPolicies[path] = "allow" | "hash" | "strip") before it may leave the
// browser; "hash"/"strip" transform the reviewed bundle accordingly.

const SENSITIVITIES = ["public", "user_provided", "low", "high"];

/**
 * @param {{fields?: Record<string,string>, hostPolicies?: Record<string,string>}} spec
 */
export function createPrivacyManifest(spec = {}) {
  const fields = { ...(spec.fields || {}) };
  for (const [path, s] of Object.entries(fields)) {
    if (!SENSITIVITIES.includes(s)) throw new TypeError(`privacy: field ${path} has invalid sensitivity ${s}`);
  }
  const hostPolicies = { ...(spec.hostPolicies || {}) };
  return Object.freeze({ fields: Object.freeze(fields), hostPolicies: Object.freeze(hostPolicies) });
}

/**
 * Flatten a bundle's payload into dotted field paths. Array elements are
 * walked INDEX-FREE (evidence[2].label classifies as "evidence.label"): a
 * manifest classifies field shapes, not positions. An empty array
 * contributes no paths — nothing there to leak. An array of primitives is
 * the array's own path.
 */
export function fieldPaths(obj, prefix = "") {
  const out = new Set();
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          for (const p of fieldPaths(item, path)) out.add(p);
        } else if (item !== undefined) {
          out.add(path);
        }
      }
    } else if (v && typeof v === "object") {
      for (const p of fieldPaths(v, path)) out.add(p);
    } else {
      out.add(path);
    }
  }
  return [...out];
}

/**
 * The fail-closed verdict. ok:false lists every violation; the reporter or
 * host must resolve them (classify the field, or declare a high-risk
 * policy) before the bundle can leave the browser.
 * @returns {{ok: boolean, violations: Array<{path: string, reason: string}>}}
 */
export function privacyVerdict(payload, manifest) {
  const violations = [];
  for (const path of fieldPaths(payload)) {
    const s = manifest.fields[path];
    if (s === undefined) {
      violations.push({ path, reason: "unknown sensitivity — not classified by the privacy manifest" });
    } else if (s === "high" && !manifest.hostPolicies[path]) {
      violations.push({ path, reason: "high-risk field lacks a host-declared policy (allow|hash|strip)" });
    }
  }
  return { ok: violations.length === 0, violations };
}

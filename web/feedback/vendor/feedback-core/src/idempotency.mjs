// idempotency.mjs — req-idempotent-submission: every reviewed bundle carries
// a stable idempotency key derived from its reviewed CONTENT (kind, anchor
// identity, user text, evidence digests) — never from timestamps or randoms,
// so a retry after a network failure or a duplicate click produces the SAME
// key and the sink router dedupes on it. FNV-1a 64-bit over canonical JSON:
// deterministic, dependency-free, browser-safe (stability, not secrecy, is
// the requirement).

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function fnv1a64(str) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** @param {{kind: string, anchor: object, userText?: string, evidence?: Array<{digest: string}>}} reviewed */
export function idempotencyKey(reviewed) {
  const basis = {
    kind: reviewed.kind,
    anchor: {
      producer: reviewed.anchor.producer,
      artifactId: reviewed.anchor.artifactId,
      scope: reviewed.anchor.scope ?? null,
      step: reviewed.anchor.step ?? null,
      ref: reviewed.anchor.ref ?? null,
    },
    userText: reviewed.userText ?? "",
    evidence: (reviewed.evidence || []).map((e) => e.digest).sort(),
  };
  return `fb-${fnv1a64(canonical(basis))}`;
}

export function contentDigest(value) {
  return fnv1a64(canonical(value));
}

// machine.mjs — req-capture-review-submit: collect a draft locally, show it
// for review, submit ONLY the reviewed bundle — even for low-friction kinds.
// req-raw-drafts-stay-local: raw evidence stays on the draft (local); the
// reviewed bundle carries only privacy-passed fields plus evidence DIGESTS
// and short reviewed snippets; user-entered text is marked user_provided.
//
// States: draft -> in_review -> (blocked <-> in_review) -> reviewed -> submitted.
// Feedback is not mutation: the reviewed note is the artifact.

import { createAnchor } from "./anchor.mjs";
import { isKind, KIND_CONFIG } from "./kinds.mjs";
import { privacyVerdict } from "./privacy.mjs";
import { contentDigest, idempotencyKey } from "./idempotency.mjs";

export function createDraft(kind, anchorSpec, { draftId, context } = {}) {
  if (!isKind(kind)) throw new TypeError(`draft: unknown kind ${kind}`);
  const anchor = anchorSpec.producer ? createAnchor(anchorSpec) : anchorSpec; // pre-built frozen anchors pass through
  return {
    state: "draft",
    draftId: draftId ?? `draft-${contentDigest({ kind, anchor })}`,
    kind,
    anchor,
    evidence: [], // raw items live HERE and nowhere else pre-review
    userText: "",
    // Context is producer-owned diagnostic data.  It is deliberately carried
    // through the same reviewed projection and privacy verdict as every other
    // outbound field; unclassified paths therefore fail closed.
    ...(context === undefined ? {} : { context }),
  };
}

/**
 * Attach a raw evidence item to the local draft. Raw payloads never leave
 * the draft: review projects each item to {kind, label, digest, snippet?}.
 */
export function attachEvidence(draft, { kind, label, payload, snippet }) {
  if (draft.state !== "draft" && draft.state !== "in_review") throw new Error(`evidence: cannot attach in state ${draft.state}`);
  draft.evidence.push({ kind, label, payload, snippet: snippet ?? null, digest: contentDigest(payload) });
  return draft;
}

export function setUserText(draft, text) {
  draft.userText = String(text);
  return draft;
}

/**
 * Project the draft into its review view: what the user (and privacy
 * manifest) actually judges. Raw payloads are NOT in the projection.
 */
export function beginReview(draft, manifest) {
  draft.state = "in_review";
  const payload = reviewedPayload(draft);
  const verdict = privacyVerdict(payload, manifest);
  draft.lastVerdict = verdict;
  if (!verdict.ok) draft.state = "blocked";
  return { payload, verdict, kindConfig: KIND_CONFIG[draft.kind] };
}

function reviewedPayload(draft) {
  return {
    kind: draft.kind,
    anchor: { ...draft.anchor },
    userText: draft.userText, // marked user_provided by the manifest
    evidence: draft.evidence.map((e) => ({ kind: e.kind, label: e.label, digest: e.digest, snippet: e.snippet })),
    ...(draft.context === undefined ? {} : { context: draft.context }),
  };
}

/**
 * Approve the review: only legal from a passing in_review state. Produces
 * the frozen reviewed bundle — the ONLY thing a sink may ever receive —
 * with its stable idempotency key.
 */
export function approveReview(draft, manifest) {
  const required = KIND_CONFIG[draft.kind].requiredFields;
  if (required.includes("userText") && !draft.userText.trim()) {
    throw new Error(`review: kind ${draft.kind} requires userText`);
  }
  const payload = reviewedPayload(draft);
  const verdict = privacyVerdict(payload, manifest);
  if (!verdict.ok) {
    draft.state = "blocked";
    const reasons = verdict.violations.map((v) => `${v.path}: ${v.reason}`).join("; ");
    throw new Error(`review: privacy fails closed — ${reasons}`);
  }
  draft.state = "reviewed";
  const bundle = Object.freeze({
    ...payload,
    reviewed: true,
    idempotencyKey: idempotencyKey(payload),
  });
  draft.reviewedBundle = bundle;
  return bundle;
}

/**
 * Submit via a router/sink. Refuses anything that is not a reviewed bundle —
 * this is the code-level guarantee behind req-raw-drafts-stay-local.
 */
export async function submit(draft, router) {
  if (draft.state !== "reviewed" || !draft.reviewedBundle?.reviewed) {
    throw new Error(`submit: only a reviewed bundle may be submitted (state: ${draft.state})`);
  }
  const receipt = await router.submit(draft.reviewedBundle);
  draft.state = "submitted";
  draft.receipt = receipt;
  return receipt;
}

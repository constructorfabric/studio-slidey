// kinds.mjs — req-generic-kinds: bug is one kind of several, never privileged
// (lim-not-bug-specific). A kind may change copy, required fields, review UI
// hints, and sink routing — it must NOT fork the anchor or evidence model:
// kind configs carry presentation/routing metadata only, and every kind's
// draft flows through the same machine, anchor envelope, and privacy review.

export const KINDS = Object.freeze([
  "bug",
  "content_comment",
  "copy_feedback",
  "design_feedback",
  "question",
  "ai_instruction",
  "issue_request",
  "approval",
  "rejection",
]);

/**
 * Per-kind presentation/routing metadata. Deliberately NO anchor or evidence
 * schema hooks here — that is the "must not fork the model" clause.
 * @type {Record<string, {label: string, requiredFields: string[], reviewHint: string}>}
 */
export const KIND_CONFIG = Object.freeze({
  bug: { label: "Report a bug", requiredFields: ["userText"], reviewHint: "Describe what went wrong; evidence is attached below." },
  content_comment: { label: "Comment on content", requiredFields: ["userText"], reviewHint: "Your comment anchors to the highlighted content." },
  copy_feedback: { label: "Suggest copy", requiredFields: ["userText"], reviewHint: "Suggest replacement wording for the anchored text." },
  design_feedback: { label: "Design feedback", requiredFields: ["userText"], reviewHint: "Feedback anchors to the selected region." },
  question: { label: "Ask a question", requiredFields: ["userText"], reviewHint: "Questions route to the surface's owner." },
  ai_instruction: { label: "Instruct the agent", requiredFields: ["userText"], reviewHint: "The reviewed bundle dispatches to an authoring/refine flow." },
  issue_request: { label: "Request an issue", requiredFields: ["userText"], reviewHint: "Creates a tracked issue at the configured sink." },
  approval: { label: "Approve", requiredFields: [], reviewHint: "Records an approval of the anchored artifact." },
  rejection: { label: "Reject", requiredFields: ["userText"], reviewHint: "Records a rejection; say why so it can be actioned." },
});

export function isKind(kind) {
  return KINDS.includes(kind);
}

// Framework-free state controller used by the Vue composable and test suite.
// Keeping state transitions here makes privacy blocking testable without a DOM.
import {
  createDraft, setUserText, beginReview, approveReview, submit,
} from "../../feedback-core/src/index.mjs";

export function createFeedbackReporter({ anchorFor, manifest, router, context } = {}) {
  if (typeof anchorFor !== "function") throw new TypeError("feedback-vue: anchorFor function is required");
  const state = { phase: "choose", kind: null, draft: null, review: null, receipt: null, error: null };
  const notify = () => state.onChange?.({ ...state });
  return {
    state,
    subscribe(listener) { state.onChange = listener; return () => { if (state.onChange === listener) state.onChange = null; }; },
    choose(kind) {
      state.kind = kind;
      state.draft = createDraft(kind, anchorFor(kind), { context });
      state.review = null;
      state.receipt = null;
      state.error = null;
      state.phase = "draft";
      notify();
    },
    setText(text) { if (!state.draft) throw new Error("feedback-vue: choose a kind first"); setUserText(state.draft, text); notify(); },
    review() {
      if (!state.draft) throw new Error("feedback-vue: choose a kind first");
      state.review = beginReview(state.draft, manifest);
      state.phase = "review";
      notify();
      return state.review;
    },
    async submit() {
      if (!state.draft || !state.review?.verdict.ok) throw new Error("feedback-vue: privacy review must pass before submit");
      try {
        approveReview(state.draft, manifest);
        state.receipt = await submit(state.draft, router);
        state.phase = "receipt";
        state.error = null;
        notify();
        return state.receipt;
      } catch (error) { state.error = error; notify(); throw error; }
    },
  };
}

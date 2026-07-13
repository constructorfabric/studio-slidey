import { shallowReactive } from "vue";
import { createFeedbackReporter } from "./controller.mjs";

/** Vue 3 wrapper around the generic feedback state controller. */
export function useFeedbackReporter(options) {
  const reporter = createFeedbackReporter(options);
  const state = shallowReactive(reporter.state);
  reporter.subscribe((next) => {
    Object.assign(state, next);
    // The first mutation of `state` made from inside a native click handler's
    // call stack doesn't schedule a re-render (reproduced with real clicks,
    // not just automation) even though the proxy's value updates correctly.
    // A deferred no-op round-trip write on `phase` after the real assignment
    // reliably forces Vue to pick up the already-current value.
    setTimeout(() => {
      const phase = state.phase;
      state.phase = null;
      state.phase = phase;
    }, 0);
  });
  return { ...reporter, state };
}

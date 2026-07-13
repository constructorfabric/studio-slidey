<script setup>
import { ref } from "vue";
import { anchorDisplayFields } from "../../feedback-core/src/index.mjs";
import { useFeedbackReporter } from "./useFeedbackReporter.mjs";

const props = defineProps({
  kinds: { type: Array, required: true },
  anchorFor: { type: Function, required: true },
  manifest: { type: Object, required: true },
  router: { type: Object, required: true },
  context: { default: undefined },
});
const emit = defineEmits(["close", "submitted"]);
const reporter = useFeedbackReporter(props);
const text = ref("");
function select(kind) { reporter.choose(kind.id ?? kind.kind ?? kind); text.value = ""; }
function review() { reporter.setText(text.value); reporter.review(); }
async function send() { const receipt = await reporter.submit(); emit("submitted", receipt); }
</script>

<template>
  <section class="fb-modal" role="dialog" aria-modal="true" aria-label="Send feedback">
    <header class="fb-head">
      <div class="fb-titleblock">
        <div class="fb-kicker">Feedback</div>
        <h2 v-if="reporter.state.phase === 'choose'">What's this about?</h2>
        <h2 v-else-if="reporter.state.phase === 'draft'">{{ reporter.state.kind }}</h2>
        <h2 v-else-if="reporter.state.phase === 'review'">Review feedback</h2>
        <h2 v-else>Feedback sent</h2>
      </div>
      <button class="fb-close" type="button" aria-label="Close feedback" @click="emit('close')">×</button>
    </header>
    <div class="fb-body">
      <div v-if="reporter.state.phase === 'choose'" class="fb-choose">
        <template v-for="(group, index) in kinds" :key="group.label ?? index">
          <h3 v-if="group.kinds">{{ group.label }}</h3>
          <button v-for="kind in (group.kinds ?? [group])" :key="kind.id ?? kind.kind ?? kind" class="fb-kind" type="button" @click="select(kind)">{{ kind.label ?? kind }}</button>
        </template>
      </div>
      <div v-else-if="reporter.state.phase === 'draft'" class="fb-draft">
        <textarea v-model="text" class="fb-textarea" aria-label="Feedback" placeholder="Tell us what happened…" />
        <button class="fb-btn fb-btn-primary" type="button" @click="review">Review</button>
      </div>
      <div v-else-if="reporter.state.phase === 'review'" class="fb-review">
        <p class="fb-verdict" :data-ok="reporter.state.review.verdict.ok">{{ reporter.state.review.verdict.ok ? 'Ready to send' : "Can't send yet" }}</p>
        <ul class="fb-anchor-fields"><li v-for="([key, value]) in anchorDisplayFields(reporter.state.review.payload.anchor)" :key="key"><strong>{{ key }}</strong>: {{ value }}</li></ul>
        <pre class="fb-payload">{{ JSON.stringify(reporter.state.review.payload, null, 2) }}</pre>
        <ul v-if="!reporter.state.review.verdict.ok" class="fb-violations"><li v-for="violation in reporter.state.review.verdict.violations" :key="violation.path">{{ violation.path }}: {{ violation.reason }}</li></ul>
        <button class="fb-btn fb-btn-primary" type="button" :disabled="!reporter.state.review.verdict.ok" @click="send">Submit</button>
      </div>
      <div v-else class="fb-receipt">
        <p>{{ reporter.state.receipt?.ref }}</p>
      </div>
    </div>
    <footer class="fb-footer">Powered by studio-sassfully</footer>
  </section>
</template>

<style>
.fb-modal {
  display: flex;
  flex-direction: column;
  width: min(30rem, calc(100vw - 56px));
  max-height: calc(100vh - 56px);
  border: 1px solid var(--fb-border, #30363d);
  border-radius: 10px;
  overflow: hidden;
  background: var(--fb-bg, #0d1117);
  color: var(--fb-fg, #f0f6fc);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.46);
}
.fb-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--fb-border, #30363d);
  background: var(--fb-head-bg, #161b22);
}
.fb-titleblock { min-width: 0; }
.fb-kicker { color: var(--fb-accent, #58a6ff); font-size: 11px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; }
.fb-titleblock h2 { margin: 3px 0 0; font-size: 18px; font-weight: 700; line-height: 1.25; }
.fb-close {
  flex: none;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--fb-border, #30363d);
  border-radius: 8px;
  background: transparent;
  color: var(--fb-fg, #f0f6fc);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.fb-close:hover, .fb-close:focus-visible { border-color: var(--fb-accent, #58a6ff); color: #fff; outline: none; }
.fb-body { min-height: 0; overflow-y: auto; padding: 18px; }
.fb-choose h3 { margin: 14px 0 6px; color: #8b949e; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
.fb-choose h3:first-child { margin-top: 0; }
.fb-kind {
  display: block;
  width: 100%;
  margin: 0 0 6px;
  padding: 10px 12px;
  border: 1px solid var(--fb-border, #30363d);
  border-radius: 8px;
  background: transparent;
  color: var(--fb-fg, #f0f6fc);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.fb-kind:hover, .fb-kind:focus-visible { border-color: var(--fb-accent, #58a6ff); background: #1f6feb22; outline: none; }
.fb-textarea {
  display: block;
  width: 100%;
  min-height: 8rem;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--fb-border, #30363d);
  border-radius: 8px;
  background: #010409;
  color: var(--fb-fg, #f0f6fc);
  font: inherit;
  font-size: 14px;
  resize: vertical;
  box-sizing: border-box;
}
.fb-textarea:focus-visible { border-color: var(--fb-accent, #58a6ff); outline: none; }
.fb-btn {
  padding: 8px 16px;
  border: 1px solid var(--fb-border, #30363d);
  border-radius: 8px;
  background: transparent;
  color: var(--fb-fg, #f0f6fc);
  font: 700 13px/1 inherit;
  cursor: pointer;
}
.fb-btn-primary { border-color: var(--fb-accent, #58a6ff); background: #1f6feb; color: #fff; }
.fb-btn-primary:hover, .fb-btn-primary:focus-visible { background: #388bfd; outline: none; }
.fb-btn:disabled { opacity: 0.4; cursor: default; }
.fb-verdict { margin: 0 0 12px; font-size: 13px; font-weight: 700; }
.fb-verdict[data-ok="false"] { color: var(--fb-danger, #f85149); }
.fb-verdict[data-ok="true"] { color: var(--fb-success, #3fb950); }
.fb-anchor-fields { margin: 0 0 12px; padding: 0; list-style: none; font-size: 13px; color: #c9d1d9; }
.fb-anchor-fields li { margin-bottom: 3px; }
.fb-anchor-fields strong { color: #8b949e; font-weight: 600; }
.fb-payload {
  max-height: 14rem;
  margin: 0 0 12px;
  padding: 10px 12px;
  overflow: auto;
  border: 1px solid var(--fb-border, #30363d);
  border-radius: 8px;
  background: #010409;
  color: #8b949e;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.fb-violations { margin: 0 0 12px; padding-left: 18px; color: var(--fb-danger, #f85149); font-size: 13px; }
.fb-footer {
  flex: none;
  padding: 8px 18px;
  border-top: 1px solid var(--fb-border, #30363d);
  background: var(--fb-head-bg, #161b22);
  color: #6e7681;
  font-size: 11px;
  text-align: center;
  letter-spacing: 0.02em;
}
</style>

// reporter.mjs — the chromeless reporter: a floating trigger + panel with no
// host chrome assumptions, every render seam host-replaceable (2.3's
// "floating trigger + host-replaceable"). DOM only; safe to import in node
// (mount throws without a document). The reporter is a THIN shell over the
// machine: capture -> review (privacy verdict shown, fail-closed blocks the
// submit button) -> submit(reviewed bundle) via the host-provided router.

import { createDraft, attachEvidence, setUserText, beginReview, approveReview, submit } from "./machine.mjs";
import { KIND_CONFIG, KINDS } from "./kinds.mjs";

/**
 * @param {{
 *   document?: Document,
 *   anchorFor: () => object,            // producer stamps the anchor at trigger time
 *   manifest: object,                    // privacy manifest
 *   router: object,                      // sink router
 *   kinds?: string[],
 *   renderTrigger?: (open: () => void) => Element,   // host-replaceable seams
 *   renderPanel?: (api: object) => Element,
 * }} opts
 */
export function mountReporter(opts) {
  const doc = opts.document ?? (typeof document !== "undefined" ? document : null);
  if (!doc) throw new Error("reporter: a DOM document is required to mount");
  const kinds = opts.kinds ?? KINDS;
  const host = doc.createElement("div");
  host.setAttribute("data-feedback-reporter", "");

  let panel = null;
  const open = () => {
    if (panel) return;
    const draft = createDraft(kinds[0], opts.anchorFor());
    panel = (opts.renderPanel ?? defaultPanel)(panelApi(draft));
    host.appendChild(panel);
  };
  const close = () => {
    if (panel) { panel.remove(); panel = null; }
  };

  function panelApi(draft) {
    return {
      draft,
      kinds,
      kindConfig: (k) => KIND_CONFIG[k],
      setKind: (k) => { draft.kind = k; },
      setText: (t) => setUserText(draft, t),
      attach: (item) => attachEvidence(draft, item),
      review: () => beginReview(draft, opts.manifest),
      approve: () => approveReview(draft, opts.manifest),
      submit: () => submit(draft, opts.router),
      close,
      document: doc,
    };
  }

  const trigger = (opts.renderTrigger ?? defaultTrigger)(open, doc);
  host.appendChild(trigger);
  doc.body.appendChild(host);
  return { host, open, close };
}

function defaultTrigger(open, doc) {
  const b = doc.createElement("button");
  b.textContent = "Feedback";
  b.setAttribute("data-feedback-trigger", "");
  b.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483000;padding:8px 14px;border-radius:20px;border:1px solid #8884;background:#111;color:#fff;cursor:pointer;font:13px system-ui";
  b.addEventListener("click", open);
  return b;
}

function defaultPanel(api) {
  const doc = api.document;
  const p = doc.createElement("div");
  p.setAttribute("data-feedback-panel", "");
  p.style.cssText = "position:fixed;bottom:64px;right:16px;z-index:2147483000;width:320px;background:#fff;color:#111;border:1px solid #8886;border-radius:10px;padding:12px;font:13px system-ui;box-shadow:0 8px 30px #0003";

  const select = doc.createElement("select");
  for (const k of api.kinds) {
    const o = doc.createElement("option");
    o.value = k; o.textContent = api.kindConfig(k).label;
    select.appendChild(o);
  }
  select.addEventListener("change", () => api.setKind(select.value));

  const text = doc.createElement("textarea");
  text.rows = 3; text.style.cssText = "width:100%;margin:8px 0";
  text.addEventListener("input", () => api.setText(text.value));

  const verdictBox = doc.createElement("div");
  verdictBox.setAttribute("data-feedback-verdict", "");

  const reviewBtn = doc.createElement("button");
  reviewBtn.textContent = "Review";
  const submitBtn = doc.createElement("button");
  submitBtn.textContent = "Submit";
  submitBtn.disabled = true; // nothing leaves the browser un-reviewed

  reviewBtn.addEventListener("click", () => {
    const { verdict } = api.review();
    verdictBox.textContent = verdict.ok
      ? "Privacy review passed — the reviewed note below is what will be sent."
      : "Blocked: " + verdict.violations.map((v) => `${v.path} (${v.reason})`).join("; ");
    submitBtn.disabled = !verdict.ok;
  });
  submitBtn.addEventListener("click", async () => {
    api.approve();
    const receipt = await api.submit();
    verdictBox.textContent = `Submitted (${receipt.sink}: ${receipt.ref})`;
    submitBtn.disabled = true;
  });

  const closeBtn = doc.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", api.close);

  p.append(select, text, verdictBox, reviewBtn, submitBtn, closeBtn);
  return p;
}

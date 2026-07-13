// SLIDEY — inline `data-slidey-ref` link classification
//
// Markdown-derived (or hand-authored) `<a data-slidey-ref="TARGET">label</a>`
// anchors inside a `*Html` field (bodyHtml, labelHtml, introHtml, ...) route to
// one of three existing modal surfaces depending on TARGET's shape:
//
//   "deck:<deckId>"            → in-app deck switch (same as a `library` link)
//   "deck:<deckId>#<sceneId>"  → deck switch landing on a specific scene
//   "*.rrweb.json"             → the rrweb session-replay modal
//   anything else              → the reference viewer modal (image, video,
//                                 markdown, code, json, diff, text, or html —
//                                 kind is inferred the same way `references[]`
//                                 entries are, via inferReferenceKind()).
//
// This module has no DOM/Vue dependency so it can be unit tested directly and
// shared between the click-router (App.vue) and anything that wants to
// preview a target's destination ahead of time.
'use strict';

const RRWEB_RE = /\.rrweb\.json(?:[?#].*)?$/i;
const DECK_RE = /^deck:([^:#]+)(?:[:#](.+))?$/i;

export function classifyInlineRefTarget(raw) {
  const target = String(raw == null ? '' : raw).trim();
  if (!target) return null;

  const deckMatch = target.match(DECK_RE);
  if (deckMatch) {
    return {
      kind: 'deck',
      deck: deckMatch[1],
      scene: deckMatch[2] ? deckMatch[2].trim() : '',
    };
  }

  if (RRWEB_RE.test(target)) {
    return { kind: 'rrweb', ref: target };
  }

  return { kind: 'reference', src: target };
}

export default classifyInlineRefTarget;

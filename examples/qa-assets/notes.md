# Inline Reference QA Notes

This Markdown file exercises the reference viewer's Markdown path.

## Summary

The on-slide preview should show only one selected section, while the modal
should show this complete Markdown file from the top.

## Expandable section

- This section is intentionally selected by heading in the QA deck.
- Clicking the embedded Markdown panel should open the full file in a modal.
- Inline code such as `slidey embed QA` should be styled.

## Safety checks

- Headings, paragraphs, and bullets should render as readable prose.
- Raw HTML must be escaped: <script>alert("no")</script>

```js
export function checked() {
  return "fenced code stays readable";
}
```

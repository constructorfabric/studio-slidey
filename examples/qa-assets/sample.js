const KNOWN_KINDS = new Set(['markdown', 'code', 'json', 'text', 'image', 'video']);

function labelFor(ref) {
  if (ref.label) return ref.label;
  const src = ref.src || ref.path || ref.href || '';
  return src.split('/').pop() || 'reference';
}

export function summarizeReferences(scene) {
  const refs = Array.isArray(scene.references) ? scene.references : [];
  return refs.map((ref) => {
    const value = typeof ref === 'string' ? { src: ref } : ref;
    return {
      label: labelFor(value),
      kind: KNOWN_KINDS.has(value.kind) ? value.kind : 'file',
      src: value.src || value.path || value.href,
    };
  });
}

console.log(summarizeReferences({
  references: [
    { label: 'Notes', src: 'notes.md', kind: 'markdown' },
  ],
}));

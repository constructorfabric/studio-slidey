def normalize_reference(ref):
    if isinstance(ref, str):
        return {"src": ref, "label": ref.split("/")[-1]}
    return ref


print(normalize_reference("docs/design-notes.md"))

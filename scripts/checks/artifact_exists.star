# artifact_exists.star — the doc/tutorial types' type-provided gate check
# (materialization-first taxonomy, .context/materialization-first.md): a
# generated document deliverable is REAL iff every artifact path the node
# declares in check_inputs.paths exists and is non-empty. Deliberately the
# weakest useful assertion — it proves the materialize story actually
# produced the declared file, nothing about its prose; types whose content
# is machine-checkable (test-suite, demo, deck) carry stronger assertions.
#
# Reproduce by hand:
#   kitsoki starlark run scripts/checks/artifact_exists.star \
#     --inputs '{"paths":[".artifacts/<node-id>/brief.md"]}' \
#     --capabilities '{"fs":{"read":[".artifacts/**","docs/**"]}}'

def _check_path(ctx, path):
    detail = {"path": path, "ok": False}
    if path == "":
        detail["reason"] = "empty path in inputs.paths"
        return detail
    if not ctx.fs.exists(path):
        detail["reason"] = "artifact does not exist (materialize this node to produce it)"
        return detail
    if len(ctx.fs.read(path)) == 0:
        detail["reason"] = "artifact exists but is empty"
        return detail
    detail["ok"] = True
    detail["reason"] = "artifact exists and is non-empty"
    return detail

def main(ctx):
    paths = ctx.inputs["paths"]
    if len(paths) == 0:
        return {"ok": False, "reasons": ["inputs.paths is empty — a doc deliverable must declare its artifact paths"], "evidence": []}
    evidence = [_check_path(ctx, p) for p in paths]
    reasons = ["%s: %s" % (d["path"], d["reason"]) for d in evidence if not d["ok"]]
    return {"ok": len(reasons) == 0, "reasons": reasons, "evidence": evidence}

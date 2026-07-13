# flows_recorded.star — the test-suite deliverable type's TYPE-PROVIDED gate
# check (materialization-first taxonomy, .context/materialization-first.md):
# every test-suite node is judged by this same assertion, parameterized by
# its own check_inputs.reports ("a recorded no-LLM flow session runs clean
# against each repo"). This is what the portal shows (and the materialize
# driver enforces as the job's check:gate stage) instead of trusting a
# prose gate sentence.
#
# It is a pure validator over evidence files: scripts/record-flow-evidence.sh
# runs `kitsoki test flows --json` against each product repo's dev-story
# instance and drops one pog/evidence/flows-<repo>.json per repo (written
# even when the run fails, with exit != 0 and report: null, so this check
# always has something honest to read). The starlark sandbox deliberately has
# no shell exec — evidence generation is the recorder's job; judging the
# evidence is this script's job. Reproduce either half by hand:
#
#   scripts/record-flow-evidence.sh
#   kitsoki starlark run scripts/checks/flows_recorded.star \
#     --inputs '{"reports":[{"repo":"studio-sassfully","path":"pog/evidence/flows-studio-sassfully.json"}]}' \
#     --capabilities '{"fs":{"read":["pog/evidence/**"]}}'
#
# A repo passes iff its evidence file exists, parses, records exit 0, and its
# embedded FlowReport (kitsoki internal/testrunner FlowReport: capitalized
# Results/Passed/Failed keys) shows Failed == 0 and Passed >= 1. The overall
# gate is the conjunction across every repo in inputs.reports.

def _check_repo(ctx, entry):
    repo = entry.get("repo", "")
    path = entry.get("path", "")
    detail = {"repo": repo, "path": path, "ok": False}
    if repo == "" or path == "":
        detail["reason"] = "reports entry needs both repo and path"
        return detail
    if not ctx.fs.exists(path):
        detail["reason"] = "no evidence recorded (run scripts/record-flow-evidence.sh)"
        return detail
    evidence = json.decode(ctx.fs.read(path))
    if evidence.get("repo") != repo:
        detail["reason"] = "evidence file is for repo %s, expected %s" % (evidence.get("repo"), repo)
        return detail
    detail["recorded_at"] = evidence.get("recorded_at", "")
    detail["repo_commit"] = evidence.get("repo_commit", "")
    detail["command"] = evidence.get("command", "")
    if evidence.get("exit") != 0:
        detail["reason"] = "recorded run exited %s (flows did not run clean)" % evidence.get("exit")
        return detail
    report = evidence.get("report")
    if report == None:
        detail["reason"] = "recorded run carries no flow report"
        return detail
    passed = report.get("Passed", 0)
    failed = report.get("Failed", 0)
    detail["passed"] = passed
    detail["failed"] = failed
    if failed > 0:
        detail["reason"] = "%d recorded flow(s) failed" % failed
        return detail
    if passed < 1:
        detail["reason"] = "no recorded flows ran (need at least one)"
        return detail
    detail["ok"] = True
    detail["reason"] = "%d recorded no-LLM flow(s) ran clean" % passed
    return detail

def main(ctx):
    reports = ctx.inputs["reports"]
    if len(reports) == 0:
        return {"ok": False, "reasons": ["inputs.reports is empty — nothing to verify"], "evidence": []}
    evidence = [_check_repo(ctx, entry) for entry in reports]
    reasons = ["%s: %s" % (d["repo"], d["reason"]) for d in evidence if not d["ok"]]
    return {"ok": len(reasons) == 0, "reasons": reasons, "evidence": evidence}

#!/usr/bin/env bash
# record-flow-evidence.sh — run this repo's recorded no-LLM flow suite
# (`kitsoki test flows` against the dev-story instance) and drop the evidence
# envelope under pog/evidence/. This is the GENERATOR half of the test-suite
# type's gate check; the JUDGE half is scripts/checks/flows_recorded.star,
# which the materialize driver runs over this file. Evidence is written even
# when the run fails — exit != 0 and report: null — so the check always
# judges recorded reality, never absence.
#
# Kitsoki binary: $POG_KITSOKI_BIN, else `kitsoki` on PATH.
set -u

cd "$(dirname "$0")/.."
mkdir -p pog/evidence

KITSOKI_BIN="${POG_KITSOKI_BIN:-kitsoki}"
app_rel="stories/materialize-doc/app.yaml"
out="pog/evidence/flows-slidey.json"
raw="pog/evidence/flows-slidey.report.json"
cmd="kitsoki test flows ${app_rel} --json ${raw}"

echo "recording slidey: ${cmd}"
"${KITSOKI_BIN}" test flows "${app_rel}" --json "${raw}" >"pog/evidence/flows-slidey.log" 2>&1
exit_code=$?

commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

report=null
if [ -s "${raw}" ]; then
  report="$(cat "${raw}")"
fi

cat >"${out}" <<EOF
{
  "schema": "pog/evidence-flow-run/v0",
  "repo": "slidey",
  "app": "${app_rel}",
  "command": "${cmd}",
  "exit": ${exit_code},
  "recorded_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repo_commit": "${commit}",
  "report": ${report}
}
EOF
echo "  -> ${out} (exit ${exit_code})"

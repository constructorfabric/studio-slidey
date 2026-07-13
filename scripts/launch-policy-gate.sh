#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q -b main
git -C "$tmp" config user.email gate@example.test
git -C "$tmp" config user.name gate
touch "$tmp/README"
git -C "$tmp" add README
git -C "$tmp" commit -qm seed
mkdir -p "$tmp/hooks"
cp "$root/scripts/git-hooks/reference-transaction" "$tmp/hooks/reference-transaction"
cp "$root/scripts/git-hooks/pre-commit" "$tmp/hooks/pre-commit"
git -C "$tmp" config core.hooksPath "$tmp/hooks"
if git -C "$tmp" switch -c forbidden >/dev/null 2>&1; then
  echo "FAIL: reference-transaction allowed a primary branch switch" >&2
  exit 1
fi
if git -C "$tmp" commit --allow-empty -qm forbidden >/dev/null 2>&1; then
  echo "FAIL: pre-commit allowed a direct commit to main" >&2
  exit 1
fi
payload='{"tool_input":{"command":"git switch -c forbidden"}}'
decision="$(printf '%s' "$payload" | (cd "$tmp" && CLAUDE_PROJECT_DIR="$tmp" bash "$root/.claude/hooks/block-bare-checkout.sh"))"
printf '%s' "$decision" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null
echo "launch-policy-gate: primary checkout, direct main commit, and agent-facing switch refused"

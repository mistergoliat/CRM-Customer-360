#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${1:-integration/autonomous-commerce}"
CLAUDE_REF="${2:-ai/claude/ac-pr04}"
CODEX_REF="${3:-ai/codex/ac-infra-ingress}"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

git diff --name-only "$BASE_REF...$CLAUDE_REF" | sort -u > "$tmpdir/claude"
git diff --name-only "$BASE_REF...$CODEX_REF" | sort -u > "$tmpdir/codex"

echo "Claude changed files:"
cat "$tmpdir/claude" || true
echo
echo "Codex changed files:"
cat "$tmpdir/codex" || true
echo

overlap="$(comm -12 "$tmpdir/claude" "$tmpdir/codex")"

if [[ -n "$overlap" ]]; then
  echo "ERROR: overlapping changed files:"
  echo "$overlap"
  exit 1
fi

echo "No direct file overlap detected."
echo "Manual semantic-overlap review is still mandatory."

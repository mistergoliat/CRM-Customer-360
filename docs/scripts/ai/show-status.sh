#!/usr/bin/env bash
set -euo pipefail

echo "== Worktrees =="
git worktree list
echo
echo "== Active AI branches =="
git for-each-ref --sort=-committerdate \
  --format='%(refname:short) | %(committerdate:iso8601) | %(subject)' \
  'refs/heads/ai/*'
echo
echo "== Integration branch =="
git log -1 --oneline integration/autonomous-commerce 2>/dev/null || \
  echo "integration/autonomous-commerce does not exist yet"
echo
echo "== Handoffs =="
find docs/ai/handoffs -maxdepth 1 -type f -name '*.md' -print 2>/dev/null || true

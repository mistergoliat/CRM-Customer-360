#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$ROOT")"
PARENT="$(dirname "$ROOT")"
BASE_REF="${1:-HEAD}"

CLAUDE_PATH="${AI_CLAUDE_WORKTREE:-$PARENT/${REPO_NAME}-claude}"
CODEX_PATH="${AI_CODEX_WORKTREE:-$PARENT/${REPO_NAME}-codex}"

create_worktree() {
  local path="$1"
  local branch="$2"

  if git -C "$ROOT" worktree list --porcelain | grep -Fxq "worktree $path"; then
    echo "Worktree already exists: $path"
    return
  fi

  if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$ROOT" worktree add "$path" "$branch"
  else
    git -C "$ROOT" worktree add -b "$branch" "$path" "$BASE_REF"
  fi
}

create_worktree "$CLAUDE_PATH" "ai/claude/ac-pr04"
create_worktree "$CODEX_PATH" "ai/codex/ac-infra-ingress"

echo
echo "Claude worktree: $CLAUDE_PATH"
echo "Codex worktree:  $CODEX_PATH"
echo
echo "Run Claude Code from the Claude worktree with docs/ai/prompts/CLAUDE_START.md."
echo "Run Codex from the Codex worktree with docs/ai/prompts/CODEX_START.md."

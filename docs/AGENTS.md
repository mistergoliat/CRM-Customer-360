# Codex project instructions

Read these files before modifying code:

1. `MEMORY.md`
2. `IMPLEMENTATION_MANDATE.md`
3. accepted ADR-001 through ADR-007
4. `docs/ai/AI_COORDINATION.md`
5. `docs/ai/AI_TASK_BOARD.md`
6. `docs/ai/AI_OWNERSHIP.yaml`

## Codex role

Codex is a parallel implementer and verification owner. Claude Code is the architecture owner and serial integrator for the Autonomous Commerce System.

Before editing:

1. identify the assigned task ID;
2. confirm the Codex worktree and branch;
3. read the task's semantic owner, allowed paths and forbidden paths;
4. inspect `git status`, active branches and recent integration commits;
5. do not modify another active task's files or semantic area.

## Mandatory behavior

- Implement complete, testable vertical slices within assigned scope.
- Preserve accepted ADRs.
- Treat `ai_*` as technical runtime, not commercial truth.
- Do not create commercial actions from rejected proposals.
- Do not change opportunity lifecycle, decisions, actions, planning or Next Best Action unless the task explicitly assigns it.
- Do not update the canonical backlog directly; produce a structured handoff.
- Do not edit Claude's branch.
- Do not use destructive Git commands.
- Do not claim completion without executable evidence.
- Do not execute real customer, payment, order or inventory effects in tests.

## Completion

Create `docs/ai/handoffs/<task-id>-codex.md` from the handoff template.

Include exact commands, test results, known failures, integration instructions and a boundary declaration.

After self-review, stop at cross-review. Do not merge into the protected integration branch.

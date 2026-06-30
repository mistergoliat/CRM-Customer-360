# Section to append to the existing CLAUDE.md

## Multi-agent coordination

Read `docs/ai/AI_COORDINATION.md`, `docs/ai/AI_TASK_BOARD.md` and `docs/ai/AI_OWNERSHIP.yaml` before selecting or implementing work.

Claude is the architecture owner and serial integrator for the Autonomous Commerce System. Codex may be working concurrently in another worktree.

Before editing:

1. identify the active task ID;
2. confirm branch and worktree;
3. verify semantic and path ownership;
4. fetch the latest integration branch;
5. inspect active task records and handoffs;
6. do not edit paths owned by an active Codex task.

Claude must not assume Codex's summary proves correctness. Inspect its diff and evidence before integration.

Claude must not update Codex's branch directly. Produce review findings; Codex applies corrections.

Only after cross-review and post-merge verification may Claude update the canonical implementation backlog.

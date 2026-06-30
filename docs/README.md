# Dual-agent development ecosystem

This package coordinates Claude Code and OpenAI Codex working concurrently on the Autonomous Commerce System.

It does not let both agents edit the same checkout. The operating model is:

- one repository;
- two isolated Git worktrees;
- one task owner per task;
- explicit path ownership;
- frozen ADR contracts;
- structured handoffs;
- cross-review;
- serial integration.

Copy the contents into the repository root. Merge the supplied instruction sections into existing `CLAUDE.md` or `AGENTS.md` files instead of overwriting project-specific content.

Start with:

```bash
bash scripts/ai/create-worktrees.sh
```

Then open Claude Code in the Claude worktree and Codex in the Codex worktree using the prompts under `docs/ai/prompts/`.

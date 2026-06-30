# AI Coordination Protocol

## 1. Purpose

Claude Code and Codex may work simultaneously, but they do not share live internal context. Coordination occurs through Git, task records, pull requests, test evidence and structured handoffs.

The repository is the durable source of coordination. Chat history is not.

## 2. Roles

### Claude Code — architecture owner and integrator

Claude owns:

- accepted ADR interpretation;
- commercial-domain semantics;
- CommercialEvent and CommercialCycle;
- CommercialContext integration;
- opportunity lifecycle and terminality;
- accepted commercial decisions;
- commercial actions and Next Best Action;
- policy, approval, outcome and escalation semantics;
- integration order;
- final backlog updates after accepted merges.

Claude may implement core work. Claude is also the final architectural reviewer for Codex changes.

### Codex — parallel implementation and verification owner

Codex owns isolated work packages that have frozen contracts, such as:

- infrastructure reproducibility;
- provider ingress hardening;
- catalog boundary and adapters;
- contract tests;
- architecture-conformance tests;
- E2E and browser-level verification;
- observability tooling;
- non-core refactors explicitly assigned in a task record.

Codex must not alter commercial semantics unless the task explicitly assigns that responsibility.

### Human — release authority

The human owner decides:

- disputed architecture;
- durable product decisions not covered by ADRs;
- production credentials and deployment;
- final merge when cross-review remains inconclusive;
- exceptions to ownership boundaries.

Neither agent merges its own work directly into the protected integration branch.

## 3. Control plane and execution plane

### Control plane

Use GitHub Issues/Projects and pull requests when available.

Each task must include:

- task ID;
- owner;
- base commit;
- branch;
- worktree;
- dependencies;
- allowed paths;
- forbidden paths;
- frozen contracts;
- acceptance criteria;
- required tests;
- status;
- handoff document.

When GitHub is unavailable, use `docs/ai/AI_TASK_BOARD.md` on a dedicated coordination branch. Do not use a shared uncommitted file across worktrees.

### Execution plane

Each agent uses a separate worktree and branch. Uncommitted changes are never shared.

Recommended branches:

```text
ai/claude/<task-id>
ai/codex/<task-id>
integration/autonomous-commerce
```

## 4. Non-overlap rule

Two active tasks may not modify the same file or the same semantic owner.

Path separation alone is insufficient. These are semantic conflicts even when files differ:

- two migrations changing the same lifecycle;
- two services deciding Next Best Action;
- two definitions of opportunity terminality;
- two adapters writing to the same external system;
- two agents updating the canonical backlog simultaneously.

Before starting, every task must state its semantic owner.

## 5. Locked artifacts

The following are locked unless a dedicated architecture task authorizes changes:

- accepted ADR files;
- canonical commercial state machines;
- shared schema contracts;
- migration numbering registry;
- root dependency lockfiles;
- canonical implementation backlog;
- production deployment configuration.

Codex writes findings to a handoff report. Claude, as integrator, updates the canonical backlog after review.

## 6. Task lifecycle

```text
READY
→ CLAIMED
→ IN_PROGRESS
→ SELF_REVIEW
→ CROSS_REVIEW
→ CHANGES_REQUESTED | ACCEPTED
→ INTEGRATION
→ MERGED
→ VERIFIED
```

`BLOCKED` may occur from any non-terminal status.

A task is not complete because code exists. Completion requires:

- acceptance criteria passed;
- required tests passed;
- diff reviewed;
- no ownership violation;
- handoff produced;
- integration verification passed.

## 7. Handoff contract

Every completed task produces:

```text
docs/ai/handoffs/<task-id>-<agent>.md
```

The report must contain:

- base commit;
- final commit;
- behavior before;
- behavior after;
- files changed;
- schema or contract changes;
- tests and exact results;
- manual verification;
- unresolved risks;
- known failures;
- integration instructions;
- rollback notes;
- explicit statement of forbidden areas not modified.

The receiving agent must read the handoff and inspect the diff. Summaries are evidence indexes, not substitutes for code review.

## 8. Cross-review

### Claude reviews Codex

Claude verifies:

- ADR compliance;
- no commercial source-of-truth leak;
- no hidden strategy in adapters;
- migrations and contracts are compatible;
- no task-scope expansion;
- integration order is safe.

### Codex reviews Claude

Codex verifies:

- tests cover state transitions;
- idempotency and concurrency;
- failure paths;
- environment reproducibility;
- API contract regressions;
- missing user-reachable verification;
- implementation claims match executable evidence.

The reviewer does not edit the author's branch. It produces findings. The task owner applies corrections.

## 9. Integration protocol

1. Fetch the latest integration branch.
2. Rebase or merge the task branch according to repository policy.
3. Run `scripts/ai/check-overlap.sh`.
4. Run focused tests.
5. Run architecture and contract tests.
6. Run build/typecheck/lint.
7. Inspect migrations and generated artifacts.
8. Integrate one task at a time.
9. Run post-merge smoke tests.
10. Update the canonical backlog with real evidence.

Concurrent development is allowed. Concurrent integration is not.

## 10. Database migration protocol

Maintain a migration reservation record in the task or issue.

A task modifying the database must declare:

- reserved migration identifier;
- tables affected;
- compatibility strategy;
- data migration behavior;
- rollback or forward-fix strategy;
- whether another active task touches the same tables.

Do not renumber a migration after another branch depends on it. Do not edit already-applied shared migrations.

## 11. Failure and conflict protocol

Stop and mark the task `BLOCKED` when:

- the task requires changing a locked contract;
- another branch owns the same semantic area;
- an ADR is contradictory or insufficient for a durable decision;
- a required environment cannot be reproduced;
- tests reveal data loss, identity mixing, duplicated effects or bypassed authorization.

Do not resolve architectural conflict by silently choosing whichever implementation is easier.

## 12. Current recommended parallel lanes

### Claude lane

Primary task:

```text
AC-PR04 — Freeze opportunity lifecycle and terminality
```

Scope:

- opportunity lifecycle contract;
- terminality;
- valid transitions;
- relationship with CommercialContext and future planning;
- core commercial tests.

### Codex lane

Primary task:

```text
AC-INFRA-INGRESS — Reproducible DB bootstrap and production-safe WhatsApp ingress
```

Scope:

- permanent environment-variable fix;
- empty-volume MariaDB bootstrap;
- app-user creation and grants;
- migration smoke test;
- webhook carve-out from admin middleware;
- provider-specific verification/authenticity;
- duplicate response timestamp contract;
- integration and ingress tests.

Codex must not modify opportunity lifecycle, commercial decisions, actions or planning.

### Subsequent Codex lane

```text
AC-CATALOG — ADR-005 Catalog Boundary
```

This begins after `AC-INFRA-INGRESS` is accepted, unless it can run in a third isolated worktree without touching shared dependencies or lockfiles.

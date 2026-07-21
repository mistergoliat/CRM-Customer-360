---
title: AI SDR Follow-up Cancellation and Replanning Contract
doc_id: product-ai-sdr-follow-up-cancellation-replanning
status: active
version: "1.1.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for:
  - follow-up mutation contract (cancel/expire/block/replan/supersede/replace)
depends_on:
  - ../PRODUCT_NORTH_STAR.md
  - ./ai-sdr-follow-up-scheduling-engine.md
  - ../architecture/adr/ADR-009-persistence-boundary.md
supersedes: []
tags:
  - product
  - contract
---

# AI SDR Follow-up Cancellation and Replanning Contract

## 1. Goal

This contract defines the pure mutation layer that consumes a follow-up scheduling result and describes how the logical state of a follow-up action should change.

It answers one question only:

`what should be cancelled, expired, blocked, replanned, superseded, or replaced?`

It does not persist changes and it does not execute them.

## 2. Scheduling vs mutation

The follow-up scheduling decision engine (`ai-sdr-follow-up-scheduling-engine.md`) decides the operational state of a candidate action:

- `ready`
- `wait`
- `cancel`
- `expire`
- `replan`
- `block`
- `invalid`

This contract consumes that decision and produces a deterministic mutation plan.

The split is intentional:

- scheduling decides;
- mutation describes logical writes;
- repository/runtime applies them later.

## 3. Plan types

Supported plan types:

- `no_change`
- `cancel_action`
- `expire_action`
- `block_action`
- `replan_action`
- `supersede_action`
- `cancel_and_create_replacement`

`ready` and `wait` both map to `no_change`.

## 4. Cancellation

Cancellation is used for cases such as:

- customer reply;
- human takeover;
- closed case;
- closed opportunity;
- duplicate action;
- disabled follow-up.

The original action is marked cancelled, keeps its lineage, and does not create an outbox command.

## 5. Expiration

Expiration marks the original action as expired when the scheduling engine has already determined that the action can no longer be processed.

Typical reasons:

- `action_expired`
- `max_attempts_reached`
- `replacement_would_exceed_expiry`

Expiration does not create a replacement automatically.

## 6. Blocking

Blocking marks the action as blocked when policy, risk, approval, AI state, or opportunity state prevent further progress.

Typical reasons:

- `ai_blocked`
- `opportunity_paused`
- `policy_blocked`
- `risk_too_high`
- `approval_required`
- `conflicting_action`

Blocking does not send or execute anything.

## 7. Replanning

Replanning has two strategies:

- in-place update when the action is non-terminal and the policy allows it;
- supersede + replacement when lineage must be preserved or the stage context changed.

In-place replanning updates the schedule of the same logical action.

Supersede replanning keeps the original action immutable after cancellation and creates a child replacement action.

## 8. Stage change

If the opportunity stage changed after the original action was created, the old context is considered stale.

The contract must not silently reuse that stale context.

Instead, it either:

- supersedes the original action and creates a replacement;
- or cancels and creates a replacement when the policy requires it.

Lineage is preserved through:

- `parentActionId`
- `replacementActionId`
- generation

## 9. Lineage

Lineage exists so a later runtime can explain why a follow-up action changed shape over time.

The following relationships are canonical:

- original action -> child replacement
- original action -> superseding action
- mutation plan -> deterministic audit trail

No lineage field should contain secrets or raw payloads.

## 10. Generation

Replacement actions may increase generation when configured.

Generation is deterministic and derived from the original action context and the replanning policy.

This prevents accidental ambiguity between multiple replacements of the same original action.

## 11. Idempotency

The same input must produce:

- the same plan id;
- the same plan key;
- the same replacement action id;
- the same audit event ids;
- the same operations.

That makes the contract safe to replay and easy to validate in memory.

## 12. Optimistic concurrency

The plan is designed for a future repository/runtime that can reject stale writes.

The in-memory applier simulates:

- expected status checks;
- duplicate plan detection;
- duplicate action id detection;
- duplicate idempotency key detection;
- rollback on failure.

## 13. Rollback

If one operation fails, the mutation applier must restore the previous snapshot.

That keeps the contract free of partial state.

The contract itself never persists rollback logic; it only describes it.

## 14. Audit

If auditing is required, the plan includes canonical audit event drafts.

Allowed metadata is intentionally small:

- oldStatus
- newStatus
- oldScheduledFor
- newScheduledFor
- reason
- opportunityStage
- attemptCount
- generation

No raw message bodies, phone numbers, credentials, or webhook payloads belong in metadata.

## 15. Pure function contract

This module must remain pure.

It must not use:

- `Date.now()`
- `crypto.randomUUID()`
- `Math.random()`
- timers
- `process.env`
- fetch
- DB clients
- SQL

The same input must always produce the same output.

## 16. In-memory applier

`applyFollowUpMutationPlanInMemory(state, plan)` is the local contract test harness for the mutation plan.

It applies the operations in order, validates expected statuses, simulates rollback, and returns both snapshots.

This is useful for contract tests before any repository implementation exists.

## 17. Relation to the scheduling decision engine

The scheduling decision engine produces `FollowUpSchedulingResult`.

This contract consumes that result directly and never recalculates cooldown, business hours, or expiry.

That keeps the responsibility split clean:

- scheduling decision engine: decide what should happen;
- this contract: describe how the logical action state should mutate.

## 18. Relation to future runtime

A future repository/runtime may use this contract to:

- update an existing action;
- create a replacement action;
- append audit events;
- reject conflicting writes;
- preserve idempotency.

It still must not send WhatsApp, call Meta, or activate a scheduler on its own.
The downstream outbox worker and execution gate remain separate layers that consume these plans later.

## 19. Relation to persistence

The mutation contract is storage agnostic at the type level, but the authorized store today is MariaDB (see [ADR-009](../architecture/adr/ADR-009-persistence-boundary.md)) - a different engine would require a new ADR, not a change to this contract's plan shape.

The storage layer is responsible for writes. This contract is only responsible for describing them.

## 20. Current limits

Current limits are explicit:

- no repository mutation runtime;
- no scheduler runtime;
- no persistence;
- no outbox worker;
- no Meta;
- no live follow-up.

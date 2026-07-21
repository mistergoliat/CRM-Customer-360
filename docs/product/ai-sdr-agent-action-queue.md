---
title: AI SDR Agent Action Queue
doc_id: product-ai-sdr-agent-action-queue
status: active
version: "1.1.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for:
  - crm_agent_actions schema and lifecycle contract
  - action queue idempotency rules
depends_on:
  - ../PRODUCT_NORTH_STAR.md
  - ./ai-sdr-action-lifecycle-contract.md
  - ../architecture/adr/ADR-003-commercial-action-source-of-truth.md
  - ../architecture/adr/ADR-009-persistence-boundary.md
supersedes: []
tags:
  - product
  - contract
---

# AI SDR Agent Action Queue

## Purpose

`crm_agent_decisions.next_action_json` is enough for read-only recommendation and operator inspection.
`crm_agent_actions` becomes necessary when the product needs a durable, idempotent queue of governed actions that can survive review, scheduling, cancellation and eventual outbox execution.

This document defines the contract for that queue. It does not define execution.

## Why this table exists

The durable queue is needed because the system now needs to distinguish between:

- a recommendation,
- a reviewable proposal,
- an approved action,
- a future executable command,
- and the eventual execution record.

Without a durable action row, the product cannot safely support:

- operator approval/rejection/edit,
- delayed execution,
- cancellation when the customer replies,
- queue previews,
- action-level idempotency,
- lifecycle audit beyond the decision log.

## Why not `crm_followup_tasks`

Follow-up is an action type, not a separate table yet.

`crm_followup_tasks` would only be justified once the repository has a real scheduler with:

- due jobs,
- retries,
- cancellation rules,
- expiry,
- executor semantics.

Follow-up stays inside `crm_agent_actions` so the lifecycle stays unified.

## Schema

The physical table is `crm_agent_actions`.

Key columns:

- `action_id`
- `idempotency_key`
- `opportunity_id`
- `decision_id`
- `decision_row_id`
- `conversation_case_id`
- `message_id`
- `wa_id`
- `channel`
- `action_type`
- `status`
- `risk_level`
- `approval_requirement`
- `draft_payload_json`
- `final_payload_json`
- `execution_payload_json`
- `draft_message`
- `final_message`
- `scheduled_for`
- `expires_at`
- `attempt_number`
- `max_attempts`
- `block_reasons_json`
- `cancel_reason`
- `failure_reason`
- `policy_status`
- `policy_notes_json`
- `source`
- `created_by`
- `approved_by`
- `approved_at`
- `executed_at`
- `cancelled_at`
- `outbox_message_id`
- `lifecycle_version`
- `policy_version`
- `runtime_version`
- timestamps

The table has unique constraints on:

- `action_id`
- `idempotency_key`

It also indexes the foreign-key-ish and lookup columns needed for queue views and future executors.

## Lifecycle

Conceptually:

`Decision -> NextAction -> ProposedAction -> OperatorReview -> ApprovedAction -> ExecutableCommand -> ExecutionResult`

Queue rows can represent:

- proposed actions,
- reviewable actions,
- blocked actions,
- cancelled actions,
- scheduled actions,
- executed actions.

An action only reaches `executing`/`executed` after passing policy (`follow_up_dispatch_policy` or the equivalent gate for its action type) and the execution gate. See `ai-sdr-action-lifecycle-contract.md` for the full status/transition list and `docs/ACTIVE_RELEASE.md` for the evidence of which action types are hardened in production today.

## Idempotency

`idempotency_key` is the primary guard against duplicate queue rows.

Same key means:

- no duplicate insert,
- update the existing non-terminal row if needed,
- leave terminal rows unchanged.

Since ACS-R1-05-T01, `schedule_followup` rows use `plan.idempotencyKey` (a hash of the full `CommercialFollowUpPlan`, computed by `follow-up-planner/planFollowUp.ts` and including `attemptNumber` but deliberately excluding `scheduledFor` - see `ai-sdr-follow-up-planner.md`) instead of the permanent `sales-action:{opportunityKey}:{actionType}` key still used by every other action type. A permanent key cannot express "retry after a terminal outcome" - it would keep resolving to `existing_action_reused` forever after the first row.

The duplicate guard for `schedule_followup` is a semantic comparison, not key equality alone (`loadFollowUpActionHistory`/`upsertFollowUpActionRow`, `sales-consultative/repository.ts`), scoped strictly by `opportunity_id` when known (never falls back to `wa_id` across a different, already-identified opportunity), or by exact `conversation_case_id` before `wa_id` when it is not (`action_type = 'schedule_followup'` always). Only an explicit status set counts as active - `planned`, `requires_review`, `executing` (`FOLLOW_UP_ACTIVE_ACTION_STATUSES`, `followUpPlanAdapter.ts`); an unknown status degrades safely to inactive rather than being inferred from "not terminal". When an active row exists, the freshly-computed plan is compared against it (`planId`, `intent`, `attemptNumber`): a match is an exact retry (`existing_action_reused`, no insert); a mismatch is a genuine conflict (`active_followup_exists`, no insert, no overwrite - T01 does not implement supersession or automatic cancellation). Only when no active row exists does the queue advance to the next attempt, whose number is `max(attempt_number` of rows in `{executing, executed, failed}) + 1` - `rejected`/`blocked`/`cancelled`/`expired` rows never consumed a real commercial attempt and do not exhaust `maxAttempts`. The idempotency key remains a real DB-level uniqueness backstop against a narrow race window, not the primary dedup mechanism.

Since ACS-R1-05-T02, reaching this point in the flow (no active row, no existing key) is not enough on its own for `schedule_followup`: `follow_up_dispatch_policy` (`sales-consultative/followUpDispatchPolicy.ts`) must also allow or require-review the plan, evaluated fresh against real opt-out/quiet-hours/identity-conflict/ai-blocked signals immediately before the INSERT - never cached, never inferred from the plan's own `policyNotes`. A denied or failed-safe dispatch produces no row at all (same "no insert, no overwrite" contract as `active_followup_exists`); a review-required dispatch can still insert, but only as `status = "requires_review"`, never `"planned"`. This does not change the idempotency key computation or the history scoping above - the gate runs strictly after both.

## Flags

The queue and its execution path are flag-gated. Current flag names and defaults are not duplicated here to avoid drift - see `docs/ACTIVE_RELEASE.md` for the live, evidenced set (operational loop enable, legacy engine gate, outbox/follow-up worker enable, real-send gate).

## Persistence safety

This milestone allows only writes to `crm_agent_actions`.

It does not write to:

- `crm_opportunities`
- `crm_agent_decisions`
- `brain_message_outbox`
- `n8n_*`

Permission errors must fail safe and preserve the legacy flow.

## Relation to outbox

Future chain:

`crm_agent_decisions.next_action_json -> crm_agent_actions -> approved action -> brain_message_outbox -> worker -> Meta send`

No non-approved action may write directly to outbox.

## Persistence

`crm_agent_actions` and `brain_message_outbox` live in MariaDB, the sole authorized store for the commercial domain - see [ADR-009](../architecture/adr/ADR-009-persistence-boundary.md). No same-entity dual-write is allowed.

## Relation to scheduler

Scheduling is only a future concern.

`scheduled_for` is a durable hint, not a running scheduler.
The follow-up scheduling decision engine decides whether that hint is ready, waiting, cancelled, expired, replanned or blocked.
The follow-up cancellation and replanning contract then turns that decision into a deterministic mutation plan for the next runtime layer.

The queue only becomes executable after a separate execution gate and future executor are validated.

## Relation to autonomy

This table is a prerequisite for controlled autonomy, not autonomy itself.

It gives the backend a durable action queue that can later be gated by:

- policy,
- approval,
- outbox,
- scheduler,
- whitelist/autonomy controls.

A sandbox eligibility contract reads from this queue and marks eligible actions; that allowlist gate is a pilot control, not permanent production logic (see `docs/ACTIVE_RELEASE.md`'s controlled-pilot allowlist). The storage-agnostic execution gate turns an eligible action into a canonical outbox command without sending anything by itself. The outbox worker contract consumes that canonical outbox row without collapsing queue, gate and transport into one layer. The WhatsApp transport contract maps the canonical message command into a provider request via an injected HTTP client.

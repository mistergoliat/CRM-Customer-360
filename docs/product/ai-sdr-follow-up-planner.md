---
title: AI SDR Follow-up Planner
doc_id: product-ai-sdr-follow-up-planner
status: active
version: "1.1.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for:
  - follow-up planning contract (pure, dry-run decision surface)
depends_on:
  - ../PRODUCT_NORTH_STAR.md
  - ../product/follow-up-decision-policy.md
  - ./ai-sdr-agent-action-queue.md
supersedes: []
tags:
  - product
  - contract
---

# AI SDR Follow-up Planner

## Purpose

The follow-up planner is a pure dry-run engine that decides whether a commercial opportunity should get a follow-up recommendation, when it should happen, and what safe draft could be suggested.

It does not persist anything and it does not execute anything.

## Planning vs persistence vs execution

- Planning: compute a follow-up recommendation, draft, risk, approval requirement, block or cancel reason.
- Persistence: store a durable action or task in DB.
- Execution: send a message, schedule a worker, or touch outbox.

This document covers planning only.

## Input

`planCommercialFollowUp(input)` consumes a pure snapshot:

- current time and timezone,
- opportunity state,
- case context,
- conversation context,
- last decision,
- follow-up policy.

It does not read DB by itself.

## Output

The main output is `CommercialFollowUpPlan`.

It always keeps:

- `executable = false`
- `persisted = false`

The planner can return:

- `not_needed`
- `recommended`
- `requires_operator_review`
- `blocked`
- `cancelled`
- `expired`
- `invalid`

## Cancellation

If the customer replied after the last agent message, the plan becomes `cancelled`.

That means the pending follow-up should be reevaluated by the operational loop instead of being sent.

## Cooldown

If the last agent message is still inside the cooldown window, the plan is `blocked`.

The planner can still suggest a future `scheduledFor` value, but that does not mean a scheduler exists.

## Risk and blocking

The planner blocks follow-up when it sees signals like:

- complaint,
- warranty,
- return,
- exchange,
- refund,
- legal,
- angry_customer,
- human_request.

It also blocks when:

- WhatsApp identity is missing,
- the channel is missing,
- the case is closed,
- AI is blocked,
- a human owner is active and policy requires blocking or review,
- max attempts were reached,
- the opportunity is terminal.

## Draft safety

Draft text must be short and non-invasive.

It must not invent:

- price,
- stock,
- delivery,
- dispatch,
- discount,
- warranty promises.

## Relation to `next_action_json`

`crm_agent_decisions.next_action_json` remains the canonical read-only proposal from the operational loop.

The follow-up planner consumes that context and can refine it into a planning result, but it does not replace the decision log.

## Relation to `crm_agent_actions`

`crm_agent_actions` now provides the durable queue boundary for approved or reviewable follow-up actions.

Since ACS-R1-05-T01, `sales-consultative/repository.ts` is a real, connected caller of this planner: `followUpPlanAdapter.ts` translates the already-loaded sales-consultative context (opportunity, draft message, cadence hint) into `CommercialFollowUpPlanningInput` and calls `planCommercialFollowUp` before persisting a `schedule_followup` row. The planner itself still does not write to the DB (`executable`/`persisted` remain `false` on its output) - the repository reads `plan.status`/`attemptNumber`/`maxAttempts`/`scheduledFor`/`riskLevel`/`approvalRequirement`/`policyNotes`/`idempotencyKey` and maps them onto the row via two independent mappings (`mapFollowUpPlanStatusToActionStatus`: `recommended -> planned`, `requires_operator_review -> requires_review`; `mapFollowUpPlanStatusToPolicyStatus`: `recommended -> allowed`, `requires_operator_review -> requires_review`; every other status stays non-executable). This is in addition to the pre-existing read-only preview caller (`action-queue/buildActionQueueViewModel.ts`, case-detail UI).

`planId`/`idempotencyKey` (`buildSignature`/`finalizePlan`) deliberately exclude `scheduledFor` from the identity hash: `scheduledFor` derives from `createdAt` (the caller's `now`) plus `policy.defaultDelayHours`, so it drifts on every call even for the exact same logical plan. Two calls at different wall-clock moments for the same opportunity/intent/attemptNumber/status/policy produce the same `planId`/`idempotencyKey` - this is what lets `sales-consultative/repository.ts` tell an exact retry apart from a genuinely different plan (ACS-R1-05-T01.1).

Since ACS-R1-05-T02, a plan's `status`/`attemptNumber`/etc. is no longer the last word on whether a row becomes executable: `sales-consultative/repository.ts` runs `follow_up_dispatch_policy` (`followUpDispatchPolicy.ts`, real opt-out/quiet-hours/identity-conflict/ai-blocked signals through `policy/evaluateCommercialPolicy.ts`) immediately before the INSERT. A `recommended` plan can still land as `action.status = "requires_review"` (never `"planned"`) if the channel gate demands review (quiet hours, human owner active); it can be denied outright (no row persisted) on opt-out, identity conflict, or AI-blocked. This planner's own output (`plan.status`, `executable`/`persisted` always `false`) is unchanged by T02 - the gate is strictly a downstream persistence-layer concern.

The queue is the correct destination when the product must:

- persist operator review,
- persist approvals or edits,
- schedule execution,
- cancel or reschedule actions,
- audit the lifecycle of an action.

`crm_agent_actions` (`ai-sdr-agent-action-queue.md`) is that table for the action queue. This planner remains read-only planning only.

## Relation to `brain_message_outbox`

The future path is:

`next_action_json -> follow-up plan -> future durable action -> approved action -> brain_message_outbox -> worker -> Meta send`

No non-approved plan may write to outbox directly.

## Why no `crm_followup_tasks` yet

`crm_followup_tasks` is only useful once a real scheduler exists.

Today the planner needs to:

- recommend,
- explain,
- be tested,
- stay read-only.

That is not enough to justify another durable table.

## When to move to persistence

Move to persistence when the repo can prove:

- permissioned writes work,
- idempotency is stable,
- action lifecycle is contractually clear,
- review and approval have a durable target,
- retries do not duplicate work.

## When to move to execution control

Move to execution control only after:

- persistence is validated,
- approval lifecycle exists,
- outbox integration is ready,
- scheduler semantics are explicit,
- the operator can review the action before send.

## Runtime authority (ACS-R1-05-T05)

`docs/audits/follow-up-runtime-reconciliation.md` found five parallel implementations of follow-up decision logic (P2-1). `ACS-R1-05-T05` closed that gap without changing this planner's contract:

- **Canonical productive chain**: `sales-consultative/engine.ts` (trigger) -> `follow-up-planner/planFollowUp.ts` (this document, `planCommercialFollowUp` - the only source of `intent`/`scheduledFor`/`attemptNumber`/`maxAttempts`/`status`/`riskLevel`/`approvalRequirement`/`idempotencyKey`) -> `sales-consultative/followUpDispatchPolicy.ts` (gate) -> `sales-consultative/repository.ts` (persistence, `crm_agent_actions`) -> `autonomous-followup-worker.ts`/`runFollowupTick.ts` -> `runNativeAutonomousCycle` -> `canonicalOutboxWriter.ts` -> `autonomous-outbox-worker.ts` -> Meta.
- **Removed (dead, zero productive callers)**: `multi-request/requestFollowups.ts`'s scheduler/persister (`scheduleRequestFollowup`, `scheduleFollowupFromDefinition`, `runRequestFollowupTick`) - it computed its own `delayMinutes`-based cooldown and wrote `crm_agent_actions` rows under `action_type = 'request_followup'` through a path nothing in production ever called. The module's read-only projection (`listPendingFollowupsForRequest`, used by `requestsView.ts` for the HUB request panel) was kept - it is not a planner, it does not compute or persist anything.
- **Isolated as a dev-only sandbox, not production coverage**: `lib/brain/commercial/autonomous-loop/**` (+ its private dependencies `follow-up-scheduling/**`, `follow-up-replanning/**`) and `lib/brain/messaging/outbox-worker/**` (hyphenated). Both are fully in-memory (fake transport, fake DB state), reachable only from `app/(hub)/dev/ai-sdr-simulator` behind `BRAIN_SCENARIO_SIMULATOR_ENABLED`/`BRAIN_SCENARIO_SIMULATOR_ALLOW_EXECUTE_FAKE` (both default `false`). They are no longer re-exported from the production `lib/brain/commercial`/`lib/brain/messaging` barrels, and `tests/commercial/followUpRuntimeAuthority.test.ts` asserts no production file outside that dev boundary imports them.
- `policy/evaluateCommercialPolicy.ts` is unaffected - it is already the real, connected `follow_up_dispatch_policy` gate since `ACS-R1-05-T02` (see `follow-up-decision-policy.md`).

After `T05`, no configuration selects an alternate planner for productive follow-up: `planCommercialFollowUp` is the only one with a real caller.

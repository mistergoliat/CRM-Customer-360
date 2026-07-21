---
title: AI SDR Action Lifecycle Contract
doc_id: product-ai-sdr-action-lifecycle-contract
status: active
version: "1.1.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for:
  - action lifecycle boundary (decision to executable command)
  - action type / status / approval / risk vocabulary
depends_on:
  - ../PRODUCT_NORTH_STAR.md
  - ./ai-sdr-agent-action-queue.md
  - ../architecture/adr/ADR-003-commercial-action-source-of-truth.md
supersedes: []
tags:
  - product
  - contract
---

# AI SDR Action Lifecycle Contract

This document defines the lifecycle boundary between a commercial decision and a future executable command.

It is contractual and read-only. It does not define persistence, execution, endpoints or runtime orchestration.

## 1. Core concepts

The lifecycle is split into these conceptual artifacts:

- `Decision`: what the agent concluded and why.
- `NextAction`: the next governed recommendation, still read-only.
- `ProposedAction`: a candidate action prepared for review.
- `OperatorReview`: the human review draft over a proposal.
- `ApprovedAction`: a proposal accepted by governance or review.
- `ExecutableCommand`: a technical command ready for an executor.
- `ExecutionResult`: the result of executing that command.

The canonical conceptual chain is:

`Decision -> NextAction -> ProposedAction -> OperatorReview -> ApprovedAction -> ExecutableCommand -> ExecutionResult`

The agent never executes directly. The operator or policy authorizes. The executor only runs valid commands.

## 2. Why `next_action_json` is enough today

`crm_agent_decisions.next_action_json` is sufficient when the system only needs to:

- show a recommendation,
- explain the recommendation,
- keep the shell read-only,
- avoid persistence of approvals,
- avoid scheduling,
- avoid outbox writes,
- avoid execution.

That remains the read-only boundary for `next_action_json` alone.

## 3. When a durable action entity is needed

A future durable action entity becomes necessary when the product must:

- persist approve/reject/edit decisions,
- keep a command draft beyond a single read model,
- schedule a later execution,
- cancel or reschedule follow-up,
- connect to `brain_message_outbox`,
- audit the full action lifecycle,
- guarantee idempotency at the action level.

That durable entity now exists as `crm_agent_actions` (see section 8).

## 4. Type contract

The TypeScript contract lives in `lib/brain/commercial/action-lifecycle/*`.

The canonical read-only types are:

- `CommercialNextAction`
- `CommercialProposedAction`
- `CommercialOperatorReviewDraft`
- `CommercialApprovedAction`
- `CommercialExecutableCommandPreview`
- `CommercialExecutionResult`

The validated lifecycle transition boundary is:

`validateActionLifecycleTransition(...)`

The structural validators are pure and fail closed.

### Action types

The contract recognizes these action types:

- `send_whatsapp_reply`
- `schedule_followup`
- `create_internal_task`
- `prepare_quote_draft`
- `take_over_case`
- `pause_ai`
- `request_more_context`
- `mark_lost_candidate`
- `no_action`

### Statuses

The contract recognizes these statuses:

- `draft`
- `proposed`
- `requires_review`
- `approved`
- `rejected`
- `edited`
- `blocked`
- `planned`
- `scheduled`
- `executing`
- `executed`
- `failed`
- `cancelled`
- `expired`

### Review decisions

The human review draft recognizes:

- `approve`
- `reject`
- `edit`
- `request_more_context`
- `take_over`
- `mark_not_useful`

### Approval requirements

The approval requirement boundary recognizes:

- `none`
- `operator_review`
- `manager_review`
- `blocked`

### Risk levels

The risk boundary recognizes:

- `low`
- `medium`
- `high`
- `critical`
- `unknown`

## 5. Non-negotiable invariants

- `executable` is always `false` at this contract layer.
- `persisted` is always `false` in the human review draft.
- `canExecute` is always `false` in the command preview.
- Direct execution from `proposed` or `requires_review` is blocked.
- Terminal states are protected.
- This layer never executes; execution happens downstream, through the execution gate and outbox, after policy accepts an action (see `ai-sdr-agent-action-queue.md`).

Allowed conceptual transitions include:

- `draft -> proposed`
- `proposed -> requires_review`
- `requires_review -> approved`
- `requires_review -> rejected`
- `requires_review -> edited`
- `edited -> approved`
- `approved -> planned`
- `planned -> scheduled`
- `planned -> cancelled`
- `scheduled -> cancelled`
- `scheduled -> expired`

Any transition into execution remains blocked at this contract layer.

## 6. Relation to outbox and follow-up

The future path is:

`crm_agent_decisions.next_action_json -> crm_agent_actions -> approved action -> brain_message_outbox -> outbox worker -> Meta send -> canonical outbound`

No non-approved decision may write directly to `brain_message_outbox`.

Follow-up may eventually start as `schedule_followup`, but only after a durable action layer exists and the product decides that scheduler semantics are required.

## 7. Relation to the operator shell

The operator shell (`operator-copilot-contract.md`) shows the read-only recommendation surface; this document defines the action lifecycle contract that supports it. The follow-up planner (`ai-sdr-follow-up-planner.md`) sits on top of that shell. `crm_agent_actions` (`ai-sdr-agent-action-queue.md`) is the durable agent action queue.

## 8. Decision on `crm_agent_actions`

`crm_agent_actions` is now the durable queue boundary (see `ai-sdr-agent-action-queue.md`).

It should be used when the repository has a real need for:

- persisted approvals,
- action-level idempotency,
- delayed execution,
- command lifecycle audit,
- outbox integration.

Until then, `next_action_json` remains the correct model boundary for read-only recommendation surfaces.

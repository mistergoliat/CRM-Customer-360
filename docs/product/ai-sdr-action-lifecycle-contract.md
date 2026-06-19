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

That is the current P1K-011A boundary.

## 3. When a durable action entity is needed

A future durable action entity becomes necessary when the product must:

- persist approve/reject/edit decisions,
- keep a command draft beyond a single read model,
- schedule a later execution,
- cancel or reschedule follow-up,
- connect to `brain_message_outbox`,
- audit the full action lifecycle,
- guarantee idempotency at the action level.

That durable entity is introduced in P1K-012A, after the dry-run planning milestones establish the read-only boundary.
P1K-011B is now the dry-run follow-up planning milestone that can recommend follow-up without making it durable yet.

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

- `executable` is always `false` in P1K-011A.
- `persisted` is always `false` in the human review draft.
- `canExecute` is always `false` in the command preview.
- Direct execution from `proposed` or `requires_review` is blocked.
- Terminal states are protected.
- Execution remains disabled in this phase.

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

Any transition into execution remains blocked with the P1K-011A execution reason.

## 6. Relation to outbox and follow-up

The future path is:

`crm_agent_decisions.next_action_json -> crm_agent_actions -> approved action -> brain_message_outbox -> outbox worker -> Meta send -> canonical outbound`

No non-approved decision may write directly to `brain_message_outbox`.

Follow-up may eventually start as `schedule_followup`, but only after a durable action layer exists and the product decides that scheduler semantics are required.

## 7. Relation to the operator shell

`P1K-010` shows the read-only recommendation surface.
`P1K-011A` defines the action lifecycle contract that supports that shell.
`P1K-011B` adds the dry-run follow-up planner on top of that shell.
`P1K-012A` introduces the durable agent action queue schema once the DB permissions and persistence model are ready.

## 8. Decision on `crm_agent_actions`

`crm_agent_actions` is now the durable queue boundary introduced by `P1K-012A`.

It should be used when the repository has a real need for:

- persisted approvals,
- action-level idempotency,
- delayed execution,
- command lifecycle audit,
- outbox integration.

Until then, `next_action_json` remains the correct model boundary for read-only recommendation surfaces.

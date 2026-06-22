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

P1K-012A keeps follow-up inside `crm_agent_actions` so the lifecycle stays unified.

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
- scheduled actions that are still non-executable.

In P1K-012A:

- `executable` remains `false`,
- `persisted` remains `false` at the planning layer,
- `canExecute` remains `false` at the command preview layer,
- outbox is not written,
- nothing is sent.

## Idempotency

`idempotency_key` is the primary guard against duplicate queue rows.

Same key means:

- no duplicate insert,
- update the existing non-terminal row if needed,
- leave terminal rows unchanged.

## Flags

Defaults remain off:

- `BRAIN_AGENT_ACTION_QUEUE_ENABLED=false`
- `BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED=false`

Behavior:

- queue disabled -> no runtime creation/persistence,
- persistence disabled -> dry-run only,
- enabled with persistence -> durable queue writes are allowed, but still no execution.

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

## Persistence decision

P1K-012D-B defines the storage boundary for the queue and the outbox:

- legacy cases and messages stay in MariaDB for P1;
- the new brain domain, including `crm_agent_actions` and `brain_message_outbox`, targets PostgreSQL/Supabase;
- the queue contract itself remains storage-agnostic until `P1K-012D-C` ships;
- no same-entity dual-write is allowed.

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

P1K-012C introduces the sandbox-only eligibility contract that reads from this queue and marks eligible actions read-only.
That sandbox whitelist is temporary and must not be treated as permanent production logic.
P1K-012D-A introduces the storage-agnostic execution gate that turns an eligible action into a canonical outbox command without sending anything yet.
P1K-012F-A defines the outbox worker contract that later consumes that canonical outbox row without collapsing the queue, the gate and the transport into one layer.
P1K-012F-B defines the WhatsApp transport adapter contract that maps the canonical message command into a provider request via an injected HTTP client.

## Future milestones

- `P1K-012B` exposes the queue in the read-only operator surface.
- `P1K-012C` will define the execution gate and the whitelisted sandbox reply contract.
- `P1K-012D-A` defines the storage-agnostic execution gate contract and the canonical outbox bridge.
- `P1K-012F-A` defines the outbox worker contract after the bridge, before any live send.
- `P1K-012F-B` defines the WhatsApp transport adapter under the worker, before any real Meta integration.
## P1K-012G

The autonomous commercial loop consumes action queue items and routes them to sandbox, execution gate, transport and follow-up stages. It does not redefine queue semantics or persistence rules.

## P1K-012H

The scenario simulator can seed queue-like synthetic states to replay complete flows. It does not mutate the real queue model and keeps the action queue contract read-only.

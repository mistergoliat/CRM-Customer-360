---
title: Autonomous Commerce State Model
doc_id: product-autonomous-commerce-state-model
status: active
version: "1.1.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for:
  - durable state domain boundaries and table ownership
depends_on:
  - ../PRODUCT_NORTH_STAR.md
  - ../architecture/adr/ADR-003-commercial-action-source-of-truth.md
supersedes: []
tags:
  - product
  - contract
---

# Autonomous Commerce State Model

## Goal

Define the durable state boundaries for the autonomous commerce system and map them to the current repo tables.

## State domains

### 1. Conversation state

Owned by:

- `conversation`
- `conversation_message`

Current fields observed:

- `conversation.public_id`
- `conversation.channel`
- `conversation.provider`
- `conversation.channel_account_id`
- `conversation.external_contact_id`
- `conversation.external_thread_id`
- `conversation.customer_id`
- `conversation.status`
- `conversation.owner_type`
- `conversation.owner_id`
- `conversation.ai_enabled`
- `conversation.human_owner_active`
- `conversation.last_message_at`
- `conversation.last_inbound_at`
- `conversation.last_outbound_at`

Valid conceptual states:

- `open`
- `waiting_customer`
- `waiting_system`
- `waiting_human`
- `closed`

Invalid or ambiguous transitions:

- closing a conversation because an opportunity is terminal without updating the conversation state;
- reusing a conversation for a different customer;
- writing outbound before inbound is persisted;
- treating `ai_enabled = 0` as a legacy-only hint instead of a hard control;
- treating `human_owner_active` as anything other than a human-attention control on the conversation.

### 2. Opportunity stage

Owned by:

- `crm_opportunities`

Current fields observed:

- `opportunity_key`
- `status`
- `stage`
- `temperature`
- `priority`
- `current_summary`
- `requirements_json`
- `missing_requirements_json`
- `product_interests_json`
- `objections_json`
- `signals_json`
- `waiting_for`
- `next_action_type`
- `next_action_due_at`
- `owner_type`
- `owner_id`
- `human_owner_active`
- `ai_blocked`
- `closed_at`

Current stage vocabulary in the repo:

- legacy shared contracts in `lib/brain/commercial/types.ts` and `lib/brain/commercial/constants.ts` still use:
  - `discovery`
  - `qualification`
  - `solution_fit`
  - `quotation`
  - `negotiation`
  - `closing`
  - `post_sale_handoff`
- the consultative native flow already maps runtime reasoning toward the PRD target vocabulary:
  - `discovery`
  - `qualification`
  - `recommendation`
  - `objection_handling`
  - `purchase_intent`
  - `checkout_support`
  - `follow_up`
  - `won`
  - `lost`
  - `handoff`

Notes:

- `stage` is commercial.
- `status` is lifecycle.
- `conversation.human_owner_active` controls human attention on the conversation.
- `conversation.ai_enabled` authorizes automated replies on the conversation.
- `owner_type` and `owner_id` carry commercial ownership.
- `crm_opportunities.human_owner_active` remains a legacy field to normalize away.
- `human_owner_active` and `ai_blocked` are controls, not the opportunity itself.
- the repo still contains both historical and target stage vocabularies, so the transition is not yet fully frozen.

### 3. Turn objective

Owned by:

- consultative engine result
- inbound processing context

Current turn objective examples:

- ask qualification question
- recommend product
- recommend alternative
- handle objection
- schedule follow-up
- handoff to human
- close won
- close lost

This state is currently transient in runtime and only partially durable through decision/action records.

### 4. Action lifecycle

Owned by:

- `crm_agent_actions`

Current fields observed:

- `action_id`
- `idempotency_key`
- `opportunity_id`
- `decision_id`
- `decision_row_id`
- `conversation_case_id`
- `message_id`
- `wa_id`
- `action_type`
- `status`
- `scheduled_for`
- `final_message`
- `draft_message`
- `executed_at`
- `cancelled_at`
- `failure_reason`
- `outbox_message_id`

Desired lifecycle:

- `proposed`
- `awaiting_approval`
- `scheduled`
- `ready`
- `executing`
- `completed`
- `cancelled`
- `expired`
- `blocked`
- `failed`

Current repo reality:

- action creation is real;
- execution semantics are still split between consultative output and outbox dispatch;
- `crm_agent_actions` is now the accepted durable action boundary;
- `brain_message_outbox` is a downstream transport queue, not the action truth;
- cancel/expire rules exist partially, not yet as the final product contract.
- the repo still uses legacy status aliases such as `planned` in some flows, so lifecycle vocabulary is not fully normalized yet.

### 5. Agent execution lifecycle and action terminal semantics

- `completed`, `cancelled`, and `expired` are terminal;
- `failed` may be terminal or recoverable depending on retry policy;
- `blocked` may be temporary or definitive depending on reason code.

Owned by:

- `ai_agent_execution`
- `ai_agent_decision`
- `ai_tool_execution`
- `ai_conversation_state`

Current role:

- technical execution trace
- shadow / observability / agent runtime artifacts

This layer is not the same as the commercial truth layer.

### 6. Transport intent

Owned by:

- `brain_message_outbox`

Current role:

- transport intent and dispatch projection
- worker lock/send/retry lifecycle
- provider message correlation

Current fields observed in the repo:

- `dedupe_key`
- `status`
- `source`
- `wa_id`
- `phone_number_id`
- `conversation_case_id`
- `message_text`
- `provider_message_id`
- `provider_status`
- `provider_status_updated_at`
- `locked_at`
- `sent_at`
- `failed_at`

This table is not the commercial action source of truth. It is a transport boundary downstream from `crm_agent_actions`.

Delivery ownership after Meta acceptance:

- `brain_message_outbox.provider_status` and `provider_status_updated_at` retain the technical delivery lifecycle;
- `conversation_message.status` is the visible timeline projection for operators;
- `commercial_event` records the fact of the status change;
- the delivery projection is monotonic, so stale statuses do not regress the visible state.

## Ownership matrix

| State | Owner table | Notes |
| --- | --- | --- |
| Customer identity | `master_customer`, `customer_external_identity` | provisional identity exists before a final master model |
| Conversation thread | `conversation` | native conversation is the thread source of truth |
| Message timeline | `conversation_message` | inbound/outbound canonical timeline |
| Commercial opportunity | `crm_opportunities` | durable commercial state |
| Need profile | `crm_sales_need_profiles` | durable profile of need and missing info |
| Decision | `crm_agent_decisions` | durable commercial decision log |
| Action | `crm_agent_actions` | governed action lifecycle |
| Outbound intent | `brain_message_outbox` | transport-intent queue |
| Technical AI execution | `ai_*` tables | observability and runtime traces |
| Audit | `hub_audit_log` | cross-cutting audit trail |

## Duplicate or overlapping fields

- `conversation.human_owner_active` and `crm_opportunities.human_owner_active`
  - conversation control is canonical; opportunity field is legacy and should be normalized away
- `conversation.ai_enabled` and `crm_opportunities.ai_blocked`
  - conversation automation control vs opportunity automation block
- `conversation.external_contact_id` and `customer_external_identity.external_id`
  - thread identity vs customer external identity projection
- `crm_opportunities.next_action_type` and `crm_agent_actions.action_type`
  - opportunity projection vs durable action source
- `crm_opportunities.next_action_due_at` and `crm_agent_actions.scheduled_for`
  - read projection vs action schedule
- `ai_agent_decision` and `crm_agent_decisions`
  - technical AI evidence vs commercial durable decision
- `brain_message_outbox` and `conversation_message`
  - transport intent vs canonical timeline message
- `crm_agent_actions.outbox_message_id` and `brain_message_outbox.id`
  - action-to-transport correlation, not a second source of action truth

## Deterministic rules

- inbound must be persisted before AI execution;
- a single inbound message must not create duplicate decision or outbox rows;
- outbound acceptance by Meta must not be replayed if timeline projection fails later;
- handoff must stop AI outbound and follow-up execution;
- `crm_agent_actions` is the authoritative mutable action layer;
- `crm_opportunities.next_action_type` and `next_action_due_at` are projections, not editable sources;
- `ai_*` tables are observability, not commercial truth;
- terminal opportunities need explicit reactivation policy before reuse.
- `ActionOutcome` is the terminal observable result of an action, not the action itself.
- `CommercialEvent.causationId` can reference only another `commercial_event.id`;
- direct Meta inbound and status events set `causationId = null`;
- message and action identifiers belong in payload or metadata, not in `causationId`.

## Required migrations still implied by the model

- formalize a single canonical conversation/opportunity boundary for autonomous commerce;
- codify terminal-state reactivation rules;
- codify a single follow-up state machine inside `crm_agent_actions`;
- normalize action lifecycle status vocabulary if production execution is enabled;
- add `next_action_id` to the opportunity projection if a richer action rebuild path is needed;
- add explicit cross-reference fields only if audit joins become too expensive.

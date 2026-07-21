---
title: Autonomous Commerce First Vertical
doc_id: product-autonomous-commerce-first-vertical
status: active
version: "1.1.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for:
  - first vertical scope and acceptance criteria
depends_on:
  - ../PRODUCT_NORTH_STAR.md
  - ../product/autonomous-commerce-prd.md
supersedes: []
tags:
  - product
  - contract
---

# Autonomous Commerce First Vertical

## Target slice

Customer asks about a product on WhatsApp, the system identifies the customer, opens or reuses the conversation, qualifies the need, consults the catalog, recommends a product, handles an objection, creates the next action, sends the answer, and updates the strategy.

## Flow

```text
cliente consulta
-> identificar
-> oportunidad
-> descubrimiento
-> catalogo
-> recomendacion
-> objecion
-> next best action
-> respuesta
-> follow-up
-> resultado
-> actualizacion de estrategia
```

## Scope

Included:

- native WhatsApp inbound
- customer resolution
- conversation persistence
- need profile persistence
- opportunity persistence
- product recommendation
- objection handling
- action creation
- outbox persistence
- worker send path
- provider status projection
- UI timeline visibility

Excluded for this first vertical:

- voice
- email
- marketing automation
- advanced pricing policy
- refund/return flows
- multi-tenant SaaS

## Data

Primary tables:

- `master_customer`
- `customer_external_identity`
- `conversation`
- `conversation_message`
- `crm_sales_need_profiles`
- `crm_opportunities`
- `crm_agent_decisions`
- `crm_agent_actions`
- `brain_message_outbox`
- `hub_audit_log`

## Tools

Required:

- `get_customer_context`
- `get_recent_conversation`
- `get_active_opportunity`
- `get_sales_need_profile`
- `search_products`
- `get_product_details`
- `get_product_price`
- `get_product_stock`
- `get_product_dimensions`
- `get_product_compatibility`
- `get_related_products`
- `create_opportunity`
- `update_opportunity`
- `save_sales_need_profile`
- `record_product_interest`
- `record_objection`
- `create_follow_up_action`
- `cancel_follow_up_action`
- `request_human_handoff`
- `queue_customer_message`

Not allowed as direct tools:

- `send_whatsapp`
- raw SQL
- direct Meta send

## State requirements

- inbound message persisted first
- opportunity reused when possible
- need profile updated, not recreated blindly
- one primary next action per turn
- outbox row created for sendable responses
- provider acceptance recorded before timeline projection is considered complete
- follow-up canceled when new inbound arrives

## UI minimum

- conversation list
- conversation detail
- inbound/outbound timeline
- customer summary
- opportunity summary
- need profile summary
- decisions
- actions
- AI enabled / handoff controls

## Tests

Minimum tests for this vertical:

- new inbound creates provisional customer
- creates WhatsApp identity
- creates conversation
- persists inbound before AI SDR
- duplicate webhook does not duplicate rows
- second turn reuses customer and conversation
- recommendation uses catalog data
- objection creates alternative
- outbox created once
- worker sends once
- timeline projection does not re-send after provider acceptance
- handoff blocks AI response
- ai_enabled=false blocks AI response
- follow-up is created
- new inbound cancels follow-up

## Acceptance criteria

- the first vertical works from a real WhatsApp inbound event;
- the same conversation and opportunity survive across turns;
- the outbound path is the same for AI SDR and follow-up;
- the UI shows the native timeline and status;
- duplicates do not create duplicate sends or duplicate decisions;
- no legacy runtime is needed for this vertical.

## Risks

- catalog incompleteness;
- provider credentials;
- allowlist misconfiguration;
- accidental fallback to legacy paths;
- state duplication between opportunity and action.

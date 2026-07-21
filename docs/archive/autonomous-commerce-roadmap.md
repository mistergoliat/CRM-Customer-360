---
title: Autonomous Commerce Roadmap
doc_id: product-autonomous-commerce-roadmap
status: historical
version: "2.0.0"
owner: product
last_reviewed: 2026-07-09
source_of_truth_for:
  - historical capability sequence snapshot
depends_on:
  - ../ROADMAP.md
  - ../product/MVP_EXECUTION_MAP.md
superseded_by: docs/ROADMAP.md
supersedes: []
tags:
  - product
  - historical
---

# Autonomous Commerce Roadmap

Esta pagina conserva la secuencia historica previa a ACS. No es un roadmap activo.

## Canonicos actuales

- [ROADMAP](../ROADMAP.md)
- [MVP execution map](../product/MVP_EXECUTION_MAP.md)

## Estado

- `P1K`, `P1L`, `P1M`, `P2` y `P3` son etiquetas historicas.
- La secuencia ACS activa vive en `docs/ROADMAP.md`.
- La paralelizacion y ownership viven en `docs/product/MVP_EXECUTION_MAP.md`.

## Nota

El contenido detallado a continuacion se conserva integro como referencia historica. No debe usarse para planificacion activa: describe la secuencia de capacidades previa a la adopcion de ACS y de `docs/ROADMAP.md`.

---

## Contenido historico completo

This roadmap is organized by complete capabilities, not by historical phase labels.

### 1. Observe and persist events

Outcome:

- every relevant inbound/outbound/provider status event is persisted and deduplicated.

Reuse:

- `app/api/integrations/whatsapp/webhook/route.ts`
- `lib/brain/native-whatsapp/service.ts`
- `lib/brain/messaging/outboxWorker.ts`

Changes needed:

- unify event normalization under one runtime contract;
- clarify which events are technical vs commercial.

Tables:

- `conversation`
- `conversation_message`
- `brain_message_outbox`

Tests:

- inbound duplicate suppression
- status duplicate suppression
- provider idempotency

### 2. Understand customer and opportunity

Outcome:

- the system keeps one usable commercial memory per customer/thread.

Reuse:

- `crm_sales_need_profiles`
- `crm_opportunities`
- `crm_agent_decisions`
- `crm_agent_actions`

Changes needed:

- define a final authority boundary between AI technical tables and CRM commercial tables.

### 3. Decide next best action

Outcome:

- one explicit commercial decision per turn.

Reuse:

- `lib/brain/commercial/sales-consultative/engine.ts`
- `lib/brain/commercial/sales-consultative/repository.ts`

Changes needed:

- productize the turn objective model;
- align stage/status vocabulary with the PRD;
- reduce leftover historical abstractions.

### 4. Consult catalog and knowledge

Outcome:

- recommendations are based on verified catalog data, not free text.

Reuse:

- current product repository adapter
- consultative engine filters and scoring

Changes needed:

- introduce a formal `CatalogService` boundary;
- make source of truth explicit for price, stock, dimensions, compatibility and related items.

### 5. Execute commercial actions

Outcome:

- actions become governed commands and not just reasoning outputs.

Reuse:

- `crm_agent_actions`
- `brain_message_outbox`
- `outboxWorker`

Changes needed:

- finalize action lifecycle;
- ensure all sends go through one outbound pipeline.

### 6. Measure results

Outcome:

- each action and send is auditable and measurable.

Reuse:

- `hub_audit_log`
- `ai_*` tables
- `conversation_message` statuses

Changes needed:

- define stable metrics and event names for autonomous commerce.

### 7. Manage follow-ups

Outcome:

- follow-ups are scheduled, canceled and executed without duplicating sends.

Reuse:

- `crm_agent_actions`
- outbox worker

Changes needed:

- formal follow-up state machine;
- cancellation on new inbound;
- policy checks before dispatch.

### 8. Close and reactivate opportunities

Outcome:

- opportunity terminal states are explicit and reactivation is controlled.

Reuse:

- `crm_opportunities`
- consultative engine

Changes needed:

- final policy for terminal states;
- controlled reopening rules.

### 9. Operate by WhatsApp

Outcome:

- real WhatsApp is a product channel, not a test endpoint.

Reuse:

- webhook route
- Meta adapter
- outbox worker

Changes needed:

- keep Meta send fail-closed;
- keep allowlist explicit;
- keep UI separate from transport.

### 10. Expand to voice and other channels

Outcome:

- the same commercial loop works across channels.

Reuse:

- conversation and opportunity model
- action/outbox pattern

Changes needed:

- channel abstraction;
- call/voice tool contract;
- channel-specific policy.

### Recommended order

1. Observe and persist events
2. Understand customer and opportunity
3. Decide next best action
4. Consult catalog and knowledge
5. Execute commercial actions
6. Measure results
7. Manage follow-ups
8. Close and reactivate opportunities
9. Operate by WhatsApp
10. Expand to voice and other channels

### Main risks

- rebuilding a chatbot instead of a commercial loop;
- allowing duplicate runtimes;
- keeping legacy and native truth sources in parallel;
- exposing tools without real implementation;
- using UI surfaces as product proof.

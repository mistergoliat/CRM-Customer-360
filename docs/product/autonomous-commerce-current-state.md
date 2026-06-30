# Autonomous Commerce Current State

## Context

- Branch: `PRD1`
- Last commit: `cbe0393 Merge pull request #28 from mistergoliat/AISDR`
- Working tree at inspection time: clean except for the new PRD file at `docs/product/autonomous-commerce-prd.md`
- Native slice present: yes
  - `lib/brain/native-whatsapp/service.ts`
  - `app/api/integrations/whatsapp/webhook/route.ts`
  - `lib/domains/conversations/repository.ts`
  - `app/(hub)/conversations/page.tsx`
  - `app/(hub)/conversations/[id]/page.tsx`

## Executive summary

The repo already contains a real native WhatsApp -> conversation -> consultative AI SDR -> outbox -> timeline path, but it is still mixed with legacy runtime and shadow-era contracts.

Current strengths:

- native inbound webhook exists;
- native conversation read model exists;
- consultative sales engine persists opportunities, need profiles, decisions, actions and outbox rows;
- canonical outbound projection to `conversation_message` exists;
- UI reads native conversation data;
- tests cover the native slice.

Current gaps:

- `processInbound` still remains the general orchestration entry point and still carries legacy/shadow concerns;
- `processInbound` is not the same as the native WhatsApp runtime;
- catalog access is still mostly repository-driven and not yet a formally isolated `CatalogService`;
- AI execution tables exist, but the source of truth for commercial autonomy is still split between technical AI tables and CRM tables;
- several docs still describe earlier shadow/dry-run milestones that are now historical.

## Capability status by area

### 1. Inbound capture

- Implemented and productively wired:
  - `GET/POST /api/integrations/whatsapp/webhook`
  - `processNativeWhatsAppInbound(...)`
  - `applyMetaDeliveryStatus(...)`
- Evidence:
  - `app/api/integrations/whatsapp/webhook/route.ts`
  - `lib/brain/native-whatsapp/service.ts`
  - `lib/brain/messaging/metaClient.ts`
  - `tests/native/native-whatsapp.test.ts`
- Status:
  - productively implemented
  - still fail-closed by flags and allowlist

### 2. Customer identity

- Implemented:
  - `master_customer`
  - `customer_external_identity`
  - provisional identity creation from WhatsApp sender
- Evidence:
  - `migrations/010_native_whatsapp_identity_and_conversation_controls.sql`
  - `lib/integrations/customer-external-identity/repository.ts`
  - `lib/integrations/customer-master/customer-repository.ts`
  - `lib/brain/native-whatsapp/service.ts`
- Status:
  - implemented but still provisional, not a final Customer Master architecture

### 3. Conversations and messages

- Implemented:
  - `conversation`
  - `conversation_message`
  - native list/detail UI
  - native conversation detail read model
- Evidence:
  - `lib/domains/conversations/repository.ts`
  - `lib/domains/conversations/types.ts`
  - `app/(hub)/conversations/page.tsx`
  - `app/(hub)/conversations/[id]/page.tsx`
  - `lib/brain/native-whatsapp/service.ts`
- Status:
  - productively implemented

### 4. Commercial reasoning

- Implemented:
  - `lib/brain/commercial/sales-consultative/engine.ts`
  - `lib/brain/commercial/sales-consultative/repository.ts`
  - stages, objections, recommendation, follow-up decision, handoff, queueing
- Evidence:
  - `lib/brain/commercial/sales-consultative/types.ts`
  - `lib/brain/commercial/sales-consultative/engine.ts`
  - `lib/brain/commercial/sales-consultative/repository.ts`
  - `tests/commercial/sales-consultative.test.ts`
  - `tests/commercial/sales-consultative-service.test.ts`
- Status:
  - implemented and partially integrated
  - still needs strict product framing and tool boundary cleanup

### 5. Opportunity and action memory

- Implemented:
  - `crm_opportunities`
  - `crm_sales_need_profiles`
  - `crm_agent_decisions`
  - `crm_agent_actions`
- Evidence:
  - `lib/brain/native-whatsapp/service.ts`
  - `lib/brain/commercial/sales-consultative/repository.ts`
  - `docs/product/lead-opportunity-contract.md`
  - `docs/product/ai-sdr-operating-model.md`
- Status:
  - productively implemented
  - still split across commercial and technical AI layers

### 6. Outbox and outbound

- Implemented:
  - `brain_message_outbox`
  - worker acquisition / lock / send / status updates
  - canonical outbound projection to `conversation_message`
  - Meta adapter with allowlist and fail-closed flags
- Evidence:
  - `lib/brain/messaging/outboxWorker.ts`
  - `lib/brain/messaging/outboundMessages.ts`
  - `lib/brain/messaging/metaClient.ts`
  - `lib/brain/messaging/metaSendAdapter.ts`
  - `tests/native/native-whatsapp.test.ts`
- Status:
  - productively implemented
  - still governed by flags, not default-on

### 7. AI technical tables

- Implemented:
  - `ai_agent_execution`
  - `ai_agent_decision`
  - `ai_tool_execution`
  - `ai_conversation_state`
- Evidence:
  - schema usage in `lib/brain/processInbound.ts`
  - AI/copilot docs under `docs/product/`
- Status:
  - implemented as technical observability and execution artifacts
  - not yet the product truth for commercial autonomy

### 8. UI

- Implemented and real:
  - conversations list/detail read native tables
  - case detail still exists as product UI
  - AI SDR related surfaces exist, but some remain preview or operator views
- Evidence:
  - `app/(hub)/conversations/page.tsx`
  - `app/(hub)/conversations/[id]/page.tsx`
  - `app/(hub)/cases/[id]/page.tsx`
  - `app/(hub)/opportunities/[id]/page.tsx`
  - `app/(hub)/dev/ai-sdr-simulator/page.tsx`
- Status:
  - mixed
  - conversations UI is native
  - some AI SDR UI surfaces are still operational previews or historical aids

## Current classification

- Inbound webhook: integrated
- Native conversation memory: integrated
- Commercial reasoning: partial to integrated
- Outbox worker: integrated
- Meta send adapter: integrated but fail-closed
- AI SDR product autonomy: partial
- Legacy runtime elimination: partial
- Tool boundary clarity: partial
- Product documentation foundation: partial but strong

## Concrete contradictions still visible in the repo

- `docs/product/ai-sdr-implementation-blueprint.md` still describes historical P1K sequencing and shadow-only phases.
- `lib/brain/processInbound.ts` still orchestrates general inbound behavior and carries legacy-era branching.
- `docs/backlog.md` still contains historical phases and mixed intent.
- `docs/product/agentic-crm-blueprint.md` still frames the broader product in pre-autonomous terms.

## What is real now

- WhatsApp inbound can reach native persistence.
- A message can create or reuse a customer, conversation, opportunity and need profile.
- Consultative output can create a next best action and outbox row.
- Outbound can be projected into native conversation timeline.
- Delivery status can project back to the outbox and timeline.
- The native slice has tests.

## What is still not yet the final product

- A single product-grade Autonomous Commerce runtime contract.
- A formally isolated CatalogService boundary.
- A complete UI for operating the autonomous commerce loop.
- A final authority model that clearly separates technical AI observability from commercial truth.
- Full elimination of legacy runtime pathways.


---
title: Autonomous Commerce Capability Map
doc_id: product-autonomous-commerce-capability-map
status: historical
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
source_of_truth_for:
  - historical capability map
depends_on:
  - product/autonomous-commerce-prd
supersedes: []
tags:
  - product
  - historical
---

# Autonomous Commerce Capability Map

This map derives commercial work units from the PRD and aligns them with the repo state.

## Capabilities

| Capability | Event | Goal | Inputs | Required state | Tools / commands | Expected result | Measurement | Autonomy | Current repo state | Dependencies |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Observe events | webhook, inbound status, user reply, timer | Capture real commercial signals | Meta webhook, message payload, status payload | conversation, message, audit | webhook route, inbound normalizer | normalized event stored | ingest success, dedupe rate | 0-2 | implemented | Meta, MariaDB |
| Resolve customer | inbound from known/unknown sender | Identify the customer | sender phone, sender id, account ids | customer + external identity | identity repo, master customer repo | customer resolved or provisional created | resolution rate, conflict rate | 1-2 | implemented | customer_master, customer_external_identity |
| Maintain conversation | inbound or outbound event | Preserve thread state | customer, channel, thread ids, timestamps | conversation, conversation_message | conversation repository | one durable thread per customer/channel | conversation reuse, duplicate prevention | 1-2 | implemented | conversation tables |
| Build need profile | qualifying message or new signal | Persist sales need context | text, recent messages, product context | crm_sales_need_profiles | consultative repo | profile updated, missing info tracked | profile completeness, stability | 1-2 | implemented | CRM tables |
| Project Customer 360 | customer open, operator view, or read API request | Consolidate the customer read model without becoming source of truth | customer identity, conversations, opportunities, profiles, actions, outcomes, quotes, orders, addresses, lifecycle events | customer 360 snapshot | Customer360QueryService + ports/adapters | read-only 360 snapshot with source/freshness/completeness metadata | snapshot coverage, partial-failure survival, freshness | 1-2 | implemented | master_customer, customer_external_identity, conversation tables, CRM tables, customer_addresses |
| Manage customer addresses | delivery or quote preparation | Persist and reuse multiple addresses per customer | customer, address book, selection context | customer_addresses, request facts | customer-addresses domain | address chosen, confirmed or rejected explicitly | selection correctness, confirmation rate | 1-2 | implemented | customer_addresses |
| Create/update opportunity | commercial intent | Keep one active commercial record | customer context, profile, stage hints | crm_opportunities | consultative repo | opportunity created or updated | opportunity reuse, stage progression | 1-3 | implemented | CRM tables |
| Decide next best action | each inbound/commercial turn | Choose one primary action | conversation, profile, opportunity, catalog findings | crm_agent_decisions, crm_agent_actions | sales consultative engine | decision persisted with action | stage fit, action fit, handoff rate | 2-3 | implemented | consultative engine |
| Consult catalog | recommendation or objection | Find valid products | need profile, price range, space, compatibility | catalog read model | search/get detail/price/stock/dimensions/compatibility | candidate set and recommendation | recommendation validity, stock fit | 1-3 | partial | product repository / Prestashop adapter |
| Handle objections | objection detected | Reduce friction or reroute | objection type, product candidates | decision/action state | objection detection, alternative selection | reasoned objection response | objection resolution rate | 2-3 | implemented | consultative engine |
| Queue customer message | response generated | Persist a future send | message, conversation, eligibility | brain_message_outbox | queue command | planned outbox row | queue success, duplicate rate | 2-3 | implemented | outbox table |
| Dispatch outbound | worker acquires row | Send through Meta safely | outbox row, flags, allowlist | locked/sent/failed states | outbox worker, Meta adapter | provider_message_id saved | send success, retry rate | 2-3 | implemented but gated | Meta, worker flags |
| Project timeline | sent/delivery/read status | Keep UI and conversation in sync | provider message id, status event | conversation_message, outbox | canonical outbound projection | visible timeline update | projection success | 2 | implemented | conversation_message |
| Handoff to human | risk, request, block, operator control | Stop AI and transfer ownership | conversation state, policy, operator action | ai_enabled, human_owner_active, opportunity flags | request_human_handoff, UI controls | AI stops, human takes over | handoff rate, blocked-send rate | 3 | partial | conversation, opportunity |
| Follow-up execution | silence or due action | Recontact at the right time | action due, policy, inbound window | crm_agent_actions, outbox | follow-up planner / worker | scheduled or canceled follow-up | follow-up success, cancellation correctness | 2-3 | partial | actions, outbox, worker |
| Close opportunity | won or lost evidence | Finish the commercial loop | customer response, policy, state | crm_opportunities | stage transition commands | terminal opportunity state | close rate, loss reason quality | 2-3 | partial | opportunity state machine |
| Operate from UI | operator supervision | Let humans inspect/control | conversation, opportunity, action, decision | read models | hubs pages | operational visibility | operator task completion | 1-2 | partial | CRM UI |

## Capability groups

### 1. Commercial sensing

- observe events
- resolve customer
- maintain conversation
- build need profile

### 2. Commercial reasoning

- create/update opportunity
- decide next best action
- consult catalog
- handle objections

### 3. Commercial execution

- queue outbound
- dispatch outbound
- project timeline
- follow-up execution

### 4. Governance and control

- handoff to human
- close opportunity
- operate from UI

## Current repo reality

- The repo already has a native WhatsApp-to-CRM path.
- The consultative engine can reason over products and produce actions.
- The outbox and timeline path is real.
- The commercial autonomy is still not fully unified under one product contract.
- Some AI/operational docs are historical and need consolidation against this map.

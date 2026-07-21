---
title: Autonomous Commerce Authority Matrix
doc_id: product-autonomous-commerce-authority-matrix
status: active
version: "1.1.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for:
  - autonomy levels
  - IA-decides / backend-validates / system-executes matrix
depends_on:
  - ../PRODUCT_NORTH_STAR.md
  - ../architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md
supersedes: []
tags:
  - product
  - contract
---

# Autonomous Commerce Authority Matrix

## Autonomy levels

- Level 0: observe only
- Level 1: propose and draft
- Level 2: execute low-risk governed actions
- Level 3: manage a full opportunity within policy
- Level 4: omnichannel autonomy with human escalation for exceptions

## Matrix

| Capability | IA decides | Backend validates | System executes | Requires policy | Requires human | Prohibited | Autonomy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Produce AI plan | yes | yes | no | yes | no | plan as effect | 2-3 |
| Evaluate capability availability | no | yes | yes | yes | no | treating unavailable as available | 2-3 |
| Resolve customer identity | partial | yes | yes | yes | no | no | 1-2 |
| Create conversation | no | yes | yes | yes | no | no | 1-2 |
| Persist inbound message | no | yes | yes | yes | no | no | 1-2 |
| Build need profile | yes | yes | yes | yes | no | no | 2 |
| Create/update opportunity | yes | yes | yes | yes | no | no | 2-3 |
| Recommend product | yes | yes | yes | yes | no | inventing product data | 2-3 |
| Recommend alternative | yes | yes | yes | yes | no | inventing price/stock | 2-3 |
| Handle objection | yes | yes | yes | yes | no | discounts or promises | 2-3 |
| Queue outbound message | yes | yes | yes | yes | sometimes | direct WhatsApp send | 2-3 |
| Send Meta message | no | yes | yes | yes | yes for enablement | default-on sends | 2-3 |
| Project outbound timeline | no | yes | yes | yes | no | skip provider_message_id persistence | 2 |
| Create follow-up action | yes | yes | yes | yes | sometimes | silent auto-spam | 2-3 |
| Cancel follow-up action | yes | yes | yes | yes | sometimes | cancel without reason/audit | 2-3 |
| Create escalation | yes | yes | yes | yes | sometimes | auto-routing without policy or audit | 3 |
| Handoff to human | yes | yes | yes | yes | yes | auto-reenable AI without policy | 3 |
| Mark won | yes | yes | yes | yes | sometimes | close by hallucination only | 3 |
| Mark lost | yes | yes | yes | yes | sometimes | close by guess only | 3 |
| Modify price | no | yes | no | yes | yes | unauthorized discounting | prohibited |
| Create discount | no | yes | no | yes | yes | autonomous discounting | prohibited |
| Modify orders | no | yes | no | yes | yes | order mutations in AI runtime | prohibited |
| Return/refund | no | yes | no | yes | yes | autonomous refunding | prohibited |
| Reopen terminal opportunity | no by default | yes | yes if explicit | yes | yes | silent reopen | restricted |

## Authority rules

### AI can decide

- discovery strategy
- qualification questions
- recommendation ordering
- objection response draft
- next best action proposal
- follow-up suggestion
- escalation creation

### Backend must validate

- state transitions
- idempotency
- channel policy
- allowlist checks
- terminal-state rules
- duplicate prevention
- capability evaluation results
- plan-to-action acceptance

### System can execute

- persist conversation and message
- persist profile, opportunity, decisions and actions
- queue outbox
- dispatch via worker when enabled
- project provider statuses back to the timeline
- preserve outcome and escalation continuity on technical failure
- route, accept, resolve, and return escalations within policy

### Human approval required

- discounts
- non-standard price changes
- order mutations
- refund / return decisions
- sensitive escalations
- reopening terminal opportunities if policy requires it

### Prohibited

- writing SQL directly from the agent
- bypassing the outbox to send Meta directly
- inventing product data
- inventing stock or dimensions
- silent side effects

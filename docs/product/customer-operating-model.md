# Customer Operating Model

## Core principle

Customer is the central entity of the operating model.

Everything important must hang off Customer:

- identity
- conversations
- intents
- opportunities
- quotes
- follow-ups
- cases
- campaigns
- agent decisions
- approved actions
- timeline events

In the P1K stage, Customer must already support the AI SDR commercial model: lead, opportunity, conversation, follow-up, and quote draft. The system can operate with provisional identity while Customer Master is still pending.

The detailed Lead and Opportunity contract lives in `docs/product/lead-opportunity-contract.md`.

This document is the conceptual operating model. The technical minimum spec lives in `docs/customer-identity-spec.md`, the resolver contract lives in `docs/customer-identity-contract.md`, and the source ownership map lives in `docs/customer-identity-source-mapping.md`.

The AI SDR commercial operating model lives in `docs/product/ai-sdr-operating-model.md`.

## Identity rule

Email is the primary identity when it exists and is usable.

When email does not exist, the system must fall back to the best available provisional identity, usually:

1. `wa_id`
2. `phone`
3. `prestashop_customer_id`
4. `order_id`
5. `invoice_number`
6. `rut`
7. `contact_id`
8. future AppSheet ids

This is a provisional identity map, not a final Customer Master implementation.

CRM is the target source of record for centralized customer information, but it is not yet implemented as persistent master.

## Identity map

A Customer can have many identities.

| Identity type | Role | Notes |
|---|---|---|
| `email` | Primary identity when available | Best cross-channel anchor for sales and CRM. |
| `wa_id` | WhatsApp anchor | Common first touch from inbound WhatsApp. |
| `phone` | Supporting identity | Useful after normalization and dedupe. |
| `prestashop_customer_id` | Ecommerce identity | Links customer data from PrestaShop / MariaDB. |
| `order_id` | Transaction identity | Supports purchase and post-sale context. |
| `invoice_number` | Document identity | Supports support and reconciliation. |
| `rut` | Regional legal identity | Useful where present and trustworthy. |
| `appsheet_customer_id` | Future external identity | Reserved for later operational sources. |

PrestaShop should be treated as a strong partial source, not as a copy of the future CRM master.

## Timeline

Customer timeline is the canonical operational history.

Minimum event types:

- inbound message
- outbound message
- conversation started
- conversation updated
- intent detected
- opportunity created
- opportunity updated
- quote drafted
- quote approved
- follow-up proposed
- follow-up approved
- case created
- case updated
- campaign drafted
- campaign approved
- agent decision recorded
- approved action recorded
- operator action recorded

Timeline events must be append-only at the conceptual level. Any future storage layer should preserve original events and not overwrite history.

## Difference between entities

| Concept | Meaning | Not a substitute for |
|---|---|---|
| Customer | Central commercial entity | Case, conversation, queue |
| Customer identity | A single identifier in the identity map | Customer Master |
| Conversation | Channel interaction thread | Customer identity |
| Intent | Commercial or service signal | Opportunity |
| Lead | Pre-opportunity commercial signal | Customer |
| Opportunity | Commercial chance with state | Conversation |
| Quote | Commercial proposal or draft | Case |
| Follow-up | Next operational step | Campaign |
| FollowUpPlan | Planned next step with governance | Task queue |
| QuoteDraft | Draft commercial proposal | Final quote |
| CommercialTask | Internal operational work item | Customer |
| AgentDecision | Structured reasoning output | Executed action |
| OperatorReview | Human approval or edit | AgentDecision |
| Case | Support, incident, or post-sale flow | Customer |
| Campaign | Future marketing action | Opportunity |
| Work Queue | Operational view of pending work | Source of truth |

Lead and Opportunity are separate commercial layers. Lead captures provisional interest and identity quality; Opportunity captures a concrete sales chance with its own lifecycle.

## Work Queue rule

Work Queue and Work Item are only operational views.

They can be used for:

- prioritization
- assignment
- approvals
- internal task management

They must not become the deterministic center of the model.

Leads from WhatsApp can exist before a persistent Customer Master exists.

Opportunity state, follow-up plan, and quote draft are commercial layers under Customer, not replacements for Customer.

## Operational layers

1. Identity
2. Conversation
3. Intent
4. Opportunity
5. Governance
6. Approved execution

## Modeling principles

1. Customer first.
2. Identity map before final Customer Master.
3. Separate conversation, intent, opportunity, and case.
4. Treat queue as view, not truth.
5. Preserve timeline as audit history.
6. Record agent decisions and approved actions explicitly.

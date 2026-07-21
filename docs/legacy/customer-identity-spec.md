---
title: P1J-001 Spec - Customer Identity / Customer Master Minimum
doc_id: customer-identity-spec
status: superseded
superseded_by: docs/data/customer-onboarding-identity-contract.md
version: "1.1.0"
owner: architecture
last_reviewed: 2026-07-21
source_of_truth_for: []
depends_on: []
supersedes: []
tags:
  - historical
---

> **SUPERSEDED (2026-07-21).** Companion to `docs/customer-identity-contract.md` (P1J-era resolver), same superseding chain. Kept as historical record; not a reference for new work.

# P1J-001 Spec - Customer Identity / Customer Master Minimum

## Purpose

Define the technical minimum for Customer identity, merge, timeline, source mapping, and future integration contracts.

This is a specification only. It does not create migrations, endpoints, or runtime logic.

The resolver contract that consumes this spec lives in `docs/customer-identity-contract.md`.
The source ownership mapping that constrains the future master lives in `docs/customer-identity-source-mapping.md`.

## Scope

Included:

- `customer_master` as central entity
- `customer_identity` as identity map
- `customer_timeline_event` as minimum timeline event
- Customer Candidate Read Model as a bridge before persistent master
- identity types and confidence rules
- creation and merge rules
- source ownership mapping and precedence
- future integration contracts
- future migrations and endpoints
- acceptance criteria for later implementation

Excluded:

- clustering
- marketing segmentation
- Customer 360 visual UI
- quote engine
- follow-up engine
- SaaS multi-tenant model
- migrations
- endpoints
- n8n workflow changes
- product logic implementation

## Canonical entities

### `customer_master`

Central commercial entity for the product.

Minimum conceptual fields:

- `customer_master_id`
- `primary_email`
- `primary_wa_id`
- `primary_phone`
- `confidence_state`
- `identity_state`
- `merge_state`
- `review_state`
- `created_at`
- `updated_at`
- `source_system`

`customer_master` is the anchor for all customer-related data.

### `customer_identity`

Identity map entry linked to a `customer_master`.

Minimum conceptual fields:

- `customer_identity_id`
- `customer_master_id`
- `identity_type`
- `identity_value`
- `is_primary`
- `is_verified`
- `confidence`
- `source_system`
- `source_record_id`
- `created_at`
- `updated_at`

### `customer_timeline_event`

Append-only event record for the customer timeline.

Minimum conceptual fields:

- `customer_timeline_event_id`
- `customer_master_id`
- `event_type`
- `event_source`
- `event_ref_type`
- `event_ref_id`
- `event_payload`
- `confidence`
- `created_at`
- `created_by`

## Identity types

The identity map must support at least:

- `email`
- `wa_id`
- `phone`
- `prestashop_customer_id`
- `order_id`
- `invoice_number`
- `rut`
- `appsheet_customer_id`

## Confidence rules

| Identity type | Confidence default | Notes |
|---|---|---|
| `email` | high when verified | Primary identity when present. |
| `prestashop_customer_id` | high | Strong ecommerce anchor. |
| `wa_id` | medium to high depending on origin | Medium when inferred, higher when direct inbound. |
| `phone` | medium | Requires normalization and matching support. |
| `order_id` | high when sourced from trusted DB | Strong transactional anchor. |
| `invoice_number` | high when sourced from trusted DB | Strong document anchor. |
| `rut` | medium to high depending on validation | Needs regional format and trust checks. |
| `appsheet_customer_id` | medium | Future identity, trust depends on source. |

## Source mapping and ownership

The future Customer Master is the system of record objective for centralized customer information.

PrestaShop is a high-confidence partial source, not a complete system of record.

WhatsApp is an engagement and lead source.

HUB operator is a manual trusted source.

AppSheet is a transitional / contaminating source.

n8n is a technical transitional source.

POS general customer is a transactional weak source unless identity is captured.

Future email marketing is an engagement / campaign source.

Future voice/call tool is an engagement / action source with higher sensitivity.

Use `docs/customer-identity-source-mapping.md` for the full source-by-source ownership map.

## Creation rule

1. If email exists, create or attach as primary identity.
2. If email does not exist but `wa_id` exists, create a provisional Customer.
3. If a future email appears, attach it to the existing Customer.
4. Never create duplicate Customers if a strong identity match already exists.
5. Before any persistent Customer Master exists, prefer a Customer Candidate Read Model over direct writes.

## Merge rule

1. Auto-merge only when there is a strong identity match.
2. Conflicts must be marked `needs_review`.
3. Do not destroy source data.
4. Preserve all linked identities and original provenance.
5. Keep a merge trace for future audit.

Strong match examples:

- exact verified email
- exact `prestashop_customer_id`
- exact `order_id` or `invoice_number` from trusted DB source

Weak match examples:

- fuzzy phone similarity without supporting source
- incomplete identity without trusted provenance

## Customer Candidate Read Model

Before Customer Master persistence, the bridge model should be a Customer Candidate Read Model.

This model:

- resolves candidates from existing sources
- does not write `customer_master`
- does not perform destructive merge
- does not finalize identity
- returns confidence, source matches, warnings, and write policy

The candidate model is the bridge between source mapping and future persistent master design.

## Identity resolution behavior

The resolver should work as follows:

1. Normalize all incoming identity values.
2. Find the best matching customer candidates.
3. Score confidence per identity.
4. Promote or attach identities when match strength is sufficient.
5. Send ambiguous cases to `needs_review`.

## Integration with existing sources

### `n8n_conversation_cases`

- Use as a transitional operational source.
- Link cases to `customer_master` through identity references.
- Do not let case become the canonical customer entity.
- Never let n8n override source ownership rules.

### `n8n_conversation_messages`

- Use for conversation history and timeline backfill.
- Map messages to customer timeline events.

### `n8n_wa_inbound_messages`

- Use as inbound signal source for `wa_id` and conversation creation.
- Use for provisional customer creation when email is missing.

### `ps_customer` / `ps_orders`

- Use as high-confidence ecommerce sources when they exist.
- Use to backfill identities and strengthen merge confidence.
- PrestaShop should not be treated as a copy of CRM customer master.

### AppSheet future

- Treat AppSheet ids as future external identities.
- They should attach through `customer_identity`, not replace the core master.
- Treat AppSheet as transitional/importable, not authoritative.

## Future migrations

Proposed future migrations, not to be created in this task:

1. `customer_master`
2. `customer_identity`
3. `customer_timeline_event`
4. optional review table for ambiguous merges
5. optional candidate review projection

## Future endpoints

Proposed future endpoints, not to be created in this task:

1. `POST /api/customers/resolve`
2. `POST /api/customers/merge`
3. `GET /api/customers/:id`
4. `GET /api/customers/:id/timeline`
5. `GET /api/customers/:id/identity-map`

## Criteria for later implementation

1. Identity resolution must be deterministic and explainable.
2. Auto-merge must only occur on strong matches.
3. Ambiguity must land in `needs_review`.
4. Source data must remain intact.
5. Timeline events must remain append-only.
6. Future integrations must attach through identity map, not bypass it.
7. The implementation must not require customer clustering or segmentation.
8. The implementation must respect source ownership and not copy PrestaShop blindly.

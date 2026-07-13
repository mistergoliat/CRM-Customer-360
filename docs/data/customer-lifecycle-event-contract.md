---
title: Customer lifecycle event contract
doc_id: data-customer-lifecycle-event-contract
status: approved
version: "2.0.0"
owner: product
last_reviewed: 2026-07-13
source_of_truth_for:
  - CustomerLifecycleEvent
depends_on:
  - architecture/adr/ADR-008-customer-360-boundary
supersedes: []
tags:
  - data-contract
---
# Customer lifecycle event contract

## Contract name

`CustomerLifecycleEvent`

## Schema version

`1.0.0`

## Purpose

Normalize heterogeneous commercial and operational signals into a single customer timeline view.

## Root shape

```ts
type CustomerLifecycleEvent = {
  contractName: "CustomerLifecycleEvent";
  schemaVersion: "1.0.0";
  eventId: string;
  eventType: string;
  source: string;
  entityType: string;
  entityId: string;
  customerId: string | null;
  occurredAt: string;
  summary: string;
  severity: "low" | "medium" | "high";
  metadata: Record<string, unknown>;
};
```

## Canonical event families

- conversation
- opportunity
- profile
- action
- outcome
- quote
- order
- address
- commercial_event

## Rules

1. Events are append-only in the read model.
2. Ordering is by `occurredAt`, then by source priority.
3. Events may be synthesized from native rows, but never invented without source evidence.
4. `commercial_event` is a valid source of lifecycle entries.
5. Address selection and confirmation are separate events.
6. `customerId = null` is valid: identity/onboarding audit events (ACS-R1-04-T07) can exist before a customer is resolved - anchored instead to a conversation or an unresolved external identity. A consumer must never assume `customerId` is present.

## Examples

- `conversation_started`
- `message_received`
- `message_sent`
- `opportunity_created`
- `profile_updated`
- `action_scheduled`
- `action_completed`
- `quote_created`
- `quote_sent`
- `quote_accepted`
- `order_projected`
- `address_added`
- `address_confirmed`

## ACS-R1-04-T07 addition

`commercial_event` gained four descriptive, non-authoritative `CommercialEventType` members for identity/onboarding audit evidence (never a new table, never a second `crm_capability_executions`):

- `customer_identity_resolution_recorded` - local or external (`customer_service`) identity resolution outcome, pre-plan or post-plan.
- `customer_onboarding_transition_recorded` - an effective `CustomerOnboardingState` transition only (no event when a mutation is a no-op).
- `customer_identity_capability_outcome_recorded` - the business outcome of `resolve_customer`/`create_customer`/`link_external_identity`, distinct from the Capability Gateway's own technical status (e.g. Gateway `completed` with business outcome `conflict`).
- `customer_session_warning_recorded` - a structured `NativeSessionWarning` code (`lib/brain/commercial/native-cycle/customer-session/warnings.ts`), never free text.

All four are allowlisted and PII-free (no email, phone, `wa_id`, external id, names, order reference, consent text, message text, raw HTTP, stack traces or DB errors) and idempotent via `dedupe_key` - see `lib/brain/commercial/events/dedupe.ts`. They are descriptive audit evidence only; `resolve_customer` authority still requires fresh, same-turn evidence per `docs/data/customer-creation-linking-authority-contract.md` - a historical `no_match` event never authorizes a later `create_customer`.

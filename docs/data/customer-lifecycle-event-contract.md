---
title: Customer lifecycle event contract
doc_id: data-customer-lifecycle-event-contract
status: approved
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
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
  customerId: string;
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

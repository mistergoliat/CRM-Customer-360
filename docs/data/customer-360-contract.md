---
title: Customer 360 contract
doc_id: data-customer-360-contract
status: approved
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
source_of_truth_for:
  - Customer360Snapshot
  - CustomerLifecycleEvent
  - Customer360Metadata
depends_on:
  - architecture/adr/ADR-008-customer-360-boundary
supersedes: []
tags:
  - data-contract
---
# Customer 360 contract

## Contract name

`Customer360Snapshot`

## Schema version

`1.0.0`

## Root shape

```ts
type Customer360Snapshot = {
  contractName: "Customer360Snapshot";
  schemaVersion: "1.0.0";
  snapshotVersion: number;
  customerId: string;
  identity: Customer360Identity;
  profile: Customer360Profile;
  sections: Customer360Sections;
  lifecycle: CustomerLifecycleSection;
  metadata: Customer360Metadata;
};
```

## Identity

La identidad es provisional mientras `Customer Service` no exista como source of truth.

```ts
type Customer360Identity = {
  state: "provisional" | "resolved" | "partial" | "conflicted" | "unknown";
  source: string;
  sourceRecordId: string | null;
  customerKey: string | null;
  displayName: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  platformOrigin: string | null;
  linkedIdentities: Array<{
    type: string;
    value: string;
    source: string;
    verified: boolean;
  }>;
};
```

## Sections

```ts
type Customer360Section<TItem> = {
  state: "real" | "partial" | "unavailable" | "error";
  source: string;
  lastUpdatedAt: string | null;
  warnings: string[];
  items: TItem[];
};
```

### Sections included

- `addresses`
- `conversations`
- `opportunities`
- `profiles`
- `actions`
- `outcomes`
- `quotes`
- `orders`
- `commercialEvents`

## Freshness

```ts
type Customer360Freshness = {
  source: string;
  lastActivityAt: string | null;
  lastRefreshedAt: string;
  state: "fresh" | "stale" | "unknown";
};
```

## Completeness

```ts
type Customer360Completeness = {
  state: "complete" | "partial" | "minimal" | "insufficient";
  score: number;
  missing: string[];
};
```

## Metadata

```ts
type Customer360Metadata = {
  source: string;
  freshness: Customer360Freshness;
  completeness: Customer360Completeness;
  warnings: string[];
};
```

## Lifecycle feed

The timeline is assembled from projected native sources and normalized into a single append-only view.

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

## Notes

- `orders` are projections, not masters.
- `quotes` are versioned documents, not customer identity.
- `address_id` is not inferred from `is_default`.

---
title: Customer address contract
doc_id: data-customer-address-contract
status: approved
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
source_of_truth_for:
  - CustomerAddress
depends_on:
  - architecture/adr/ADR-008-customer-360-boundary
supersedes: []
tags:
  - data-contract
---
# Customer address contract

## Contract name

`CustomerAddress`

## Schema version

`1.0.0`

## Purpose

Represent a customer address as an independent entity with explicit ownership, activity and default state.

## Root shape

```ts
type CustomerAddress = {
  contractName: "CustomerAddress";
  schemaVersion: "1.0.0";
  addressId: string;
  customerId: number;
  createdByActionId: string | null;
  addressLabel: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  streetName: string;
  streetNumber: string;
  unit: string | null;
  commune: string;
  city: string | null;
  region: string;
  postalCode: string | null;
  deliveryNotes: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
```

## Rules

1. Many addresses per customer.
2. `isDefault` is only a suggestion.
3. Confirmation is per request, not per customer.
4. `createdByActionId` makes creation idempotent.
5. Inactive addresses cannot be selected for new operations.
6. Snapshots used by quotes/orders/dispatches must be immutable copies.

## Readiness for physical actions

An address is ready only when the operational request has explicitly confirmed it and the address belongs to the customer, is active and complete.

## States

- `selected`
- `confirmed`
- `not_found`
- `not_owner`
- `inactive`
- `no_selection`
- `selection_mismatch`
- `error`

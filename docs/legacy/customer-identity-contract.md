---
title: P1J-001 Contract - Customer Identity Read Model + Resolver Contract
doc_id: customer-identity-contract
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

> **SUPERSEDED (2026-07-21).** P1J-era single-resolver design (`resolveCustomerCandidate`, direct `customer_master_id` output) that predates the ACS identity model. The canonical model splits identity resolution across `customer_external_identity` + `crm_customer_onboarding_state`/`CustomerOnboardingService` + the external Customer Service boundary - see `docs/data/customer-onboarding-identity-contract.md` and `docs/data/customer-creation-linking-authority-contract.md`. Kept as historical record of the earlier design; not a reference for new work.

# P1J-001 Contract - Customer Identity Read Model + Resolver Contract

## Purpose

Define the input/output contract for customer identity resolution before implementing migrations or production endpoints.

The TypeScript contract lives in `lib/customer-identity/types.ts`, `lib/customer-identity/constants.ts`, and `lib/customer-identity/index.ts`.

This is a read-model contract first. It is intentionally read-only in the initial phase.
It consumes source ownership rules from `docs/customer-identity-source-mapping.md`.

## Contract goals

- Resolve customer identity from multiple commercial sources.
- Return a stable customer read model.
- Seed timeline events from incoming signals.
- Explain confidence and conflicts explicitly.
- Avoid destructive merge behavior.
- Prepare the future write-enabled path without enabling it now.

## Input shape

The resolver must accept a normalized input shape containing at least:

- `wa_id`
- `email`
- `phone`
- `id_customer`
- `id_order`
- `invoice_number`
- `conversation_case_id`
- `message_id`

### Input contract

```json
{
  "source": "n8n|hub|brain|system",
  "mode": "read_only",
  "wa_id": "56912345678",
  "email": "customer@example.com",
  "phone": "+56912345678",
  "id_customer": "12345",
  "id_order": "A-99121",
  "invoice_number": "F-123456",
  "conversation_case_id": 8123,
  "message_id": "wamid.HBgM...",
  "context": {
    "channel": "whatsapp|email|web|manual",
    "origin": "inbound|outbound|backfill|operator",
    "allow_candidates": true,
    "allow_write": false
  }
}
```

TypeScript name:

- `CustomerIdentityResolutionInput`

### Input rules

- `mode` must be `read_only` initially.
- `allow_write` must be `false` in the initial contract.
- Any missing field is allowed.
- At least one identity signal should be present for useful resolution.
- `message_id` and `conversation_case_id` are optional but help timeline seeding and source traceability.

## Output shape

The resolver must return a stable output shape with:

- `customer`
- `identities`
- `resolution`
- `timeline_seed`
- `warnings`
- `metadata`
- `sourceMatches`
- `writePolicy`

### Output contract

```json
{
  "customer": {
    "customer_master_id": "cm_123",
    "primary_identity_type": "email",
    "primary_identity_value": "customer@example.com",
    "identity_state": "resolved",
    "merge_state": "none",
    "review_state": "clear"
  },
  "identities": [
    {
      "identity_type": "email",
      "identity_value": "customer@example.com",
      "confidence": "high",
      "is_primary": true,
      "source": "verified_email"
    }
  ],
  "resolution": {
    "state": "resolved_existing",
    "confidence": "high",
    "matched_by": "verified_email",
    "candidate_count": 1,
    "needs_review": false
  },
  "timeline_seed": [
    {
      "event_type": "inbound_message_received",
      "event_ref_type": "message_id",
      "event_ref_id": "wamid.HBgM...",
      "confidence": "medium"
    }
  ],
  "warnings": [],
  "metadata": {
    "resolver_version": "p1j-001-contract-1",
    "read_only": true,
    "source_system": "brain",
    "resolved_at": "2026-06-16T00:00:00Z"
  },
  "sourceMatches": [
    {
      "source": "prestashop",
      "matched_by": "email",
      "confidence": "high"
    },
    {
      "source": "whatsapp",
      "matched_by": "wa_id",
      "confidence": "medium"
    }
  ],
  "writePolicy": {
    "can_create_customer_master": false,
    "can_attach_identity": false,
    "reason": "source_ownership_not_defined"
  }
}
```

TypeScript name:

- `CustomerIdentityResolutionResult`

## Resolution states

The resolver must support these states:

- `resolved_existing`
- `created_provisional`
- `linked_identity`
- `conflict_needs_review`
- `not_enough_identity`
- `skipped_read_only`

### State meaning

- `resolved_existing`: a strong match points to an existing customer.
- `created_provisional`: a provisional customer would be created in future write-enabled mode, or represented as a logical candidate in read-only mode.
- `linked_identity`: an identity was attached to a candidate customer without a full merge.
- `conflict_needs_review`: multiple strong candidates or conflicting strong identities were found.
- `not_enough_identity`: input is too weak to resolve with confidence.
- `skipped_read_only`: the resolver identified an actionable write path but did not execute it because the mode is read-only.
- `skipped_read_only` is expected during the initial composite read-only phase, and is not an error.

TypeScript name:

- `CustomerIdentityResolutionStatus`

## Confidence levels

The contract uses these levels:

- `high`
- `medium`
- `low`

TypeScript name:

- `CustomerIdentityConfidence`

## Identity precedence

When multiple identities are present, precedence must follow this order:

1. `prestashop_customer_id`
2. verified `email`
3. `order_id` or `invoice_number` from DB
4. normalized `phone`
5. `wa_id`

TypeScript constant:

- `CUSTOMER_IDENTITY_PRECEDENCE`

### Precedence notes

- Higher precedence identity wins only if it is valid and consistent.
- Lower precedence identities can still strengthen confidence.
- Precedence does not override conflict rules.

## No-merge rules

The resolver must not merge when any of the following is true:

- strongly verified emails differ
- `prestashop_customer_id` differs across strong candidates
- `phone` and `wa_id` only produce an ambiguous match
- `invoice_number` or `order_id` is already associated with another strong customer

When no-merge rules trigger, the resolver must return `conflict_needs_review` or `not_enough_identity`, not a destructive merge.

TypeScript constant:

- `CUSTOMER_NO_MERGE_REASONS`

## Read-only initial mode

The initial contract is read-only.

TypeScript default options:

- `CUSTOMER_DEFAULT_READ_ONLY_OPTIONS`

Read-only mode means:

- the resolver can return candidates,
- the resolver can seed timeline events conceptually,
- the resolver cannot write `customer_master`,
- the resolver cannot merge destructively,
- the resolver cannot attach identities in storage,
- the resolver cannot mark review state in storage,
- the resolver cannot append persistent timeline events yet.
- the resolver can still emit a customer candidate read model and source matches for review.

## Future write-enabled mode

The future write-enabled contract may allow:

- `create_provisional_customer`
- `attach_identity`
- `mark_conflict_needs_review`
- `append_timeline_event`

Future write-enabled behavior must still preserve source data and merge traces.

TypeScript constant groups:

- `CUSTOMER_STRONG_IDENTITY_TYPES`
- `CUSTOMER_PROVISIONAL_IDENTITY_TYPES`
- `sourceMatches`
- `writePolicy`

## Integration with Brain Context Engine

Later, Brain Context Engine should consume this contract as follows:

- `resolver_identity` must be enriched with `customer_resolution`.
- `customer_context` should point to `customer_master` when it exists.
- `customer_context` should carry the identity map and resolution state.
- `customer_context.customer_candidate` should expose the read-only composite resolution while `customer_master` is still absent.
- `timeline_seed` should feed context packs and operational summaries.
- `sourceMatches` should tell the context engine which sources contributed and at what confidence.

## Integration with HUB

Later, HUB should render three things from this contract:

- Customer profile
- Customer timeline
- Identity review queue

The review queue must surface conflicts and ambiguous matches, not hide them.

## Acceptance criteria for later implementation

1. Resolver input is stable and documented.
2. Output shape is stable and explainable.
3. Strong identities are resolved deterministically.
4. Conflicts are never merged destructively.
5. Read-only mode is explicit.
6. Write-enabled mode is reserved for future implementation.
7. Brain Context Engine integration points are clear.
8. HUB integration points are clear.
9. The contract does not imply clustering, segmentation, quote, or follow-up logic.
10. The contract does not imply persistent customer writes yet.

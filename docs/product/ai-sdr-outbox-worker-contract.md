---
title: AI SDR Outbox Worker Contract
doc_id: product-ai-sdr-outbox-worker-contract
status: active
version: "1.1.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for:
  - outbox worker contract (claim, lease, retry, delivery classification)
depends_on:
  - ../PRODUCT_NORTH_STAR.md
  - ./ai-sdr-whatsapp-transport-contract.md
  - ../architecture/adr/ADR-009-persistence-boundary.md
supersedes: []
tags:
  - product
  - contract
---

# AI SDR Outbox Worker Contract

## 1. Goal

This contract defines the pure worker layer that claims an outbox row, applies lease semantics, invokes a transport abstraction, and returns a deterministic mutation plan: outbox worker contract, fake transport, retry classification, and in-memory runtime only.

It answers one question only:

`what should happen to a claimed outbox row after the transport result is known?`

It does not talk to Meta, it does not write SQL, and it does not run a scheduler.

## 2. Execution gate vs outbox vs transport

The execution gate produces a canonical outbox command.

The outbox worker consumes an existing outbox row.

The transport abstraction attempts delivery.

The responsibilities are intentionally separated:

- execution gate inserts the delivery intent;
- outbox worker coordinates claim, lease, transport and result classification;
- transport only sends a command and returns a result.

## 3. States

Canonical outbox statuses:

- `pending`
- `claimed`
- `processing`
- `retry_scheduled`
- `delivered`
- `failed`
- `dead_letter`
- `cancelled`

Terminal outbox statuses:

- `delivered`
- `dead_letter`
- `cancelled`

`failed` is treated as a non-claimable administrative outcome in this contract.

## 4. Claim

The worker only claims rows that are eligible for processing.

Claiming establishes:

- `status = claimed`
- `claimedBy = workerId`
- `claimedAt = now`
- `leaseExpiresAt = now + leaseSeconds`

Claiming is deterministic and should not duplicate work across workers.

## 5. Lease

The lease protects an in-flight row from concurrent workers.

If a claimed row outlives its lease, it can be reclaimed when `recoverExpiredLeases = true`.

Rows with active leases that belong to another worker are skipped.

## 6. Processing

Before the transport is called, the row is marked `processing`.

That transition increments the attempt count and stamps `lastAttemptAt`.

This keeps the lifecycle auditable even when the transport is fake.

## 7. Retry

Retry is deterministic.

The base delay grows exponentially and is compared against any transport-provided `retryAfterSeconds`.

The final delay is capped by `maxRetrySeconds`.

## 8. Exponential backoff

The retry delay uses a predictable pattern:

`baseRetrySeconds * 2^(attemptCount - 1)`

That value is then compared against `retryAfterSeconds`.

No jitter is used in this task.

## 9. Rate limits

`rate_limited` is treated like a temporary failure, but the retry delay must respect the transport-provided wait hint.

The worker does not invent its own shorter retry window when the provider says to wait longer.

## 10. Permanent failures

Permanent failures go to dead letter immediately.

Typical examples:

- `invalid_recipient`
- `invalid_payload`
- `authentication_error`
- `permission_error`
- `policy_rejected`
- `provider_duplicate`

## 11. Dead letter

Dead letter is the terminal sink for rows that cannot continue.

This contract uses `status = dead_letter` for expired rows and exhausted retry rows.

## 12. Expired leases

Expired leases can be reclaimed when the worker is configured to do so.

That allows deterministic recovery of orphaned work without introducing a scheduler.

## 13. Idempotency

The same input must produce:

- the same plan id;
- the same plan key;
- the same audit event id;
- the same provider message id;
- the same retry calculation.

Idempotency keys remain unique per command.

## 14. Optimistic concurrency

The in-memory runtime simulates optimistic concurrency through:

- expected status checks;
- duplicate plan key detection;
- duplicate idempotency key detection;
- lease recovery checks.

## 15. Batch processing

Batch processing is sequential.

The worker claims up to `batchSize` rows and processes them one by one.

That keeps the runtime deterministic and easier to test.

## 16. Fake transport

The fake transport supports deterministic scenarios:

- `accepted`
- `duplicate_accepted`
- `temporary_failure`
- `permanent_failure`
- `rate_limited`
- `timeout`

The fake transport never issues a network call and never reveals full recipient details in its internal trace.

## 17. Audit

Audit events are safe by construction.

Allowed metadata:

- `oldStatus`
- `newStatus`
- `attemptCount`
- `maxAttempts`
- `retryAt`
- `delaySeconds`
- `errorCode`
- `workerId`
- `leaseExpiresAt`
- `providerMessageId`

No raw provider payload, full phone number, or message body belongs in audit metadata.

## 18. Error sanitization

Transport and runtime errors must be sanitized before they leave the worker contract.

The sanitized string must not expose:

- tokens;
- headers;
- stack traces;
- full recipient numbers;
- raw payloads.

## 19. Pure contract

This module must remain pure.

It must not use:

- `Date.now()`
- `Math.random()`
- `crypto.randomUUID()`
- timers
- `process.env`
- fetch
- DB clients
- SQL

All time arithmetic depends on explicit timestamps.

## 20. Current limits

Current limits are explicit:

- no repository wiring at this contract layer;
- no real worker runtime;
- no real WhatsApp transport;
- no Meta;
- no live send.

## 21. Relation to persistence

The worker contract is storage agnostic at the type level. The authorized store for the real worker's persistence, when wired, is MariaDB (see [ADR-009](../architecture/adr/ADR-009-persistence-boundary.md)) - the worker behavior and plan shape do not change based on storage engine.

## 22. Relation to a future Meta adapter

The transport contract will later be backed by a real Meta adapter.

That adapter must remain behind the transport boundary and must not leak provider payloads into the worker plan.

## 23. Relation to future transport adapters

This milestone already includes the fake transport needed for deterministic tests and in-memory processing.

The WhatsApp transport contract (`ai-sdr-whatsapp-transport-contract.md`) adds the provider adapter below this worker. It keeps provider mapping, validation and HTTP abstraction out of the worker while preserving the same worker shape. A later integration can extend that adapter with a real Meta client, but the pure worker shape should remain stable.

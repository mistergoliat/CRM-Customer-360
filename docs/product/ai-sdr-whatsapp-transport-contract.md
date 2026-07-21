---
title: AI SDR WhatsApp Transport Contract
doc_id: product-ai-sdr-whatsapp-transport-contract
status: active
version: "1.1.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for:
  - WhatsApp transport adapter contract (request build, response classification, sanitization)
depends_on:
  - ../PRODUCT_NORTH_STAR.md
  - ./ai-sdr-outbox-worker-contract.md
supersedes: []
tags:
  - product
  - contract
---

# AI SDR WhatsApp Transport Contract

## 1. Objective

This contract defines the provider-specific transport boundary for WhatsApp text delivery.

It sits below the outbox worker and above any future real HTTP client. The worker keeps lifecycle, retry and lease semantics; this adapter only translates a canonical send command into a WhatsApp request and classifies the provider response.

No real Meta call is made in this milestone.

## 2. Separation of concerns

The runtime chain is:

```text
outbox record
-> outbox worker
-> MessageTransport
-> WhatsApp transport adapter
-> injected HTTP client
-> provider response
```

Responsibilities are separated as follows:

- outbox worker: claim, lease, retry, dead letter;
- WhatsApp transport adapter: validate, build request, classify response, sanitize errors;
- HTTP client: perform the future network call.

## 3. MessageTransport contract

The adapter implements the canonical `MessageTransport.send()` contract used by the worker.

The input is the same internal command shape already used by the outbox worker:

- `commandId`
- `idempotencyKey`
- `channel = whatsapp`
- `commandType = whatsapp_text`
- `recipient`
- `messageText`
- `sandbox`
- `attemptedAt`

## 4. Request shape

The adapter builds a canonical WhatsApp text request:

```text
POST {graphBaseUrl}/{graphApiVersion}/{phoneNumberId}/messages
```

The request body is fixed to text delivery only:

- `messaging_product = whatsapp`
- `recipient_type = individual`
- `to`
- `type = text`
- `text.preview_url = false`
- `text.body`

The request summary used for audit never exposes the token, the full recipient or the full message body.

## 5. Configuration

Required configuration:

- enabled flag;
- sandbox flag;
- Graph base URL;
- Graph API version;
- phone number ID;
- access token;
- timeout;
- whitelist recipients;
- exact whitelist matching;
- max text length.

The adapter fails closed when configuration is incomplete or when sandbox is not enabled.

## 6. Whitelist sandbox

This contract only allows sandbox usage; live send belongs to the outbox worker's own real-send gate (see `docs/ACTIVE_RELEASE.md` for the controlled-pilot allowlist).

Recipient validation is exact-match only after normalization to digits. Partial prefixes, wildcard matches and implicit number fixing are rejected.

This keeps the adapter deterministic and prevents accidental live delivery paths.

## 7. Validation

Validation occurs before request construction.

It checks:

- transport enabled;
- sandbox required;
- command and idempotency identifiers;
- whatsapp channel and text command type;
- recipient presence and whitelist match;
- non-empty message text;
- message length;
- placeholder / raw payload rejection;
- phone number ID, API version, access token and timeout.

## 8. HTTP classification

The adapter classifies provider responses into `MessageTransportResult` values.

Successful 2xx responses require a provider message ID.

The adapter also normalizes:

- invalid recipient / payload errors;
- authentication and permission failures;
- rate limiting;
- temporary provider unavailability;
- duplicate-accepted scenarios when explicitly signaled.

## 9. Provider error sanitization

Provider errors are reduced to a safe envelope:

- provider code;
- provider subcode;
- safe message;
- masked trace ID.

Raw bodies, tokens, headers, stack traces and full recipients stay out of the output.

## 10. Retry ownership

Retry is owned by the outbox worker, not by this adapter.

The adapter never sleeps, never retries and never schedules future work. It only returns a result the worker can interpret.

## 11. Idempotency

The request id is deterministic and derived from the command and idempotency key.

That keeps the same input stable across retries and makes worker-level deduplication reproducible.

## 12. Observability

The trace object is safe by design:

- request id;
- command id;
- masked recipient;
- timestamps;
- HTTP status;
- result status;
- error code;
- provider message ID;
- sandbox flag;
- simulated flag.

No message text, token or raw provider payload is exposed.

## 13. Fake HTTP client

The fake client exists only for tests.

It supports deterministic scenarios such as accepted, malformed success, invalid recipient, invalid payload, authentication error, permission error, policy rejection, rate limit, provider unavailable, timeout, network error, duplicate accepted and unknown error.

The fake keeps raw requests only for assertions in tests; safe logs remain redacted.

## 14. Limits

Current limits are explicit:

- no real HTTP client;
- no Meta SDK;
- no media;
- no templates;
- no buttons;
- no audio;
- no documents;
- no reactions;
- no calls;
- no DB;
- no SQL.

## 15. Relation to the outbox worker

The outbox worker contract (`ai-sdr-outbox-worker-contract.md`) owns worker lifecycle and transport-agnostic delivery classification.

This document is the provider adapter below it, so the worker never needs to know Meta-specific request details.

## 16. Relation to future Meta integration

A later integration can replace the fake HTTP client with a real Meta client without changing the worker contract.

That future client must keep credentials and raw provider payloads behind the same sanitization boundary.

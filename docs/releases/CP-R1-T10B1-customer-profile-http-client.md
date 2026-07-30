---
title: CP-R1-T10B1 - CRM Customer Profile HTTP Client
doc_id: cp-r1-t10b1-customer-profile-http-client
status: implemented_pending_real_smoke
tags:
  - release
  - customer-profile
  - integration
---

# CP-R1-T10B1 - CRM Customer Profile HTTP Client

Branch: `feat/cp-r1-t10b1-customer-profile-client`, base `develop` (contains the
ACS-R1-05.1-T02.7 merge, PR #74 / `1dcc8bd`). `main` in this repo is a
manually-promoted production snapshot (see project memory
`deployment-workflow`) and was 183 commits behind `develop` at the time this
task started - it does not yet contain T02.7 either. Branching from `develop`
was the only base that actually satisfies "after the T02.7 merge"; this is
noted here as a deviation from the literal task instruction ("Base: main"),
not silently assumed. No commit, push or PR was made for this task.

## Objective

Build a defensive HTTP client so the CRM (future Sales Agent orchestrator)
can query two read-only endpoints already implemented and deployed by
MS-pesaschile-customer-profile:

- `GET /v1/customers/:masterCustomerId/purchased-products`
- `GET /v1/customers/:masterCustomerId/purchase-behavior`

This task is transport plumbing only. It does not add a capability, a
recommendation context, RFM/lifecycle interpretation, or any runtime wiring.

## Architecture

Customer Profile is the source of historical purchase facts for an
already-resolved `masterCustomerId`. The CRM does not resolve identity here
and does not query PrestaShop directly - both remain the exclusive
responsibility of MS-pesaschile-customer-profile.

New module: `lib/customer-profile/` (`types.ts`, `httpCustomerProfileAdapter.ts`,
`index.ts`), modeled directly on the existing `lib/catalog/` and
`lib/integrations/customer-service/` HTTP adapters (same fetch/AbortController
transport shape, same "exactly one physical HTTP call per invocation, retry
belongs to a future gateway/orchestrator" rule, same fail-closed factory
pattern as `createCustomerServicePort`).

Deliberately kept separate from two existing, conceptually different modules
in this repo:

- `lib/integrations/customer-service/` - identity/onboarding
  (`resolveCustomer`/`createCustomer`/`linkExternalIdentity`), a different
  microservice.
- `lib/domains/customer-360/local-adapter.ts` - local SQL read model inside
  this repo's own database.

## Routes consumed

Both routes, request shapes and every status code below were read directly
from the real service's source
(`C:\Users\Goli\Pesas Chile\MS\MS-pesaschile-customer-profile`):
`src/http/routes/index.ts`,
`src/domain/customer-purchased-products/contracts.ts`,
`src/domain/customer-purchase-behavior/contracts.ts`, and both integration
test files under `tests/integration/`. Nothing in the client's field list or
status mapping was invented.

- `GET /v1/customers/:masterCustomerId/purchased-products?limit&offset`
  (`limit` 1-100 default 20, `offset` >=0 default 0 - both left to the
  server to default when omitted by the caller).
- `GET /v1/customers/:masterCustomerId/purchase-behavior?topProducts&topVariants`
  (both 1-10, default 10, left to the server to default when omitted).

## Identity contract

`masterCustomerId: string` is required input, supplied by the caller -
never resolved, never read from a global, never looked up by email/phone/DNI.
Validated client-side against the exact bound the real route enforces
(`/^[0-9]{1,20}$/`, no trim - leading/trailing whitespace is rejected, not
silently normalized) before any network call is made. An invalid id never
reaches `fetch`.

## Result states

`CustomerProfileLookupResult<T>` (`lib/customer-profile/types.ts`), a closed
discriminated union: `available` (with `data`), `customer_not_found`,
`customer_not_linked`, `degraded` (`reason` + `retryable`), `failed` (`code` +
`retryable`). `available` with an empty `products`/`topProducts`/`topVariants`
array is a valid customer with no purchase history - never conflated with
`customer_not_found` (identity does not exist) or `customer_not_linked` (no
PrestaShop link). Every HTTP status the real routes can return (200/404/503/
400/401/403/429/5xx) is mapped explicitly in `httpCustomerProfileAdapter.ts`;
nothing falls through to a generic "unknown error".

## Timeout and retry ownership

`fetch` + `AbortController`, timeout configurable via
`CUSTOMER_PROFILE_SERVICE_TIMEOUT_MS` (default 5000ms, same pattern as the
catalog/customer-service adapters). Exactly one physical HTTP call per method
invocation - no adapter-level retry loop. Retry ownership belongs to a future
Capability Gateway / orchestrator, never to this adapter.

## Security

No name, email, phone, DNI, full product name, full payload, API key, or
secret-bearing URL is ever logged by this module (it does not log at all -
logging, if added, is a caller/orchestrator concern for a later task). Error
results never echo the upstream response body, message, or stack - a `failed`
result carries only a closed `code` + `retryable` boolean. Verified with a
dedicated test asserting a 500 body containing a fake internal hostname and
stack trace never appears in the serialized result.

## Degradation

`unavailable` (config: `CUSTOMER_PROFILE_SERVICE_BASE_URL` not set) and
`degraded` (upstream PrestaShop dependency down, `prestashop_unavailable` /
`prestashop_timeout`, `retryable: true`) are both real, non-exceptional
outcomes a caller must handle - never thrown as an exception, never a crash.
No fallback to local SQL and no alternate route to Customer Profile exists in
this adapter.

A Customer Profile failure (`degraded`, `unavailable` or `failed`) must never
block a future generic product recommendation for the same customer.
Customer Profile is an optional enrichment signal, not a hard dependency of
the recommendation path. This behavior will be implemented in `CP-R1-T10B2`
and later integration tasks.

The real service (`src/app.ts`) does not enforce an `x-api-key` middleware
today, unlike catalog-service/customer-service. `CUSTOMER_PROFILE_SERVICE_API_KEY`
is still added to `.env.example` and sent as `x-api-key` whenever configured
(forward-compatible), but building a config only requires the base URL - a
missing API key alone never produces an `unavailable`/`authentication_error`
result, because the real service does not require one. If auth is added to
the microservice later, this is a one-line change (require the key in
`readHttpCustomerProfileAdapterConfig`), tracked as debt below.

## Explicitly out of scope

`CustomerRecommendationContext`, the `get_product_recommendations`
capability, Catalog Service SearchProducts V2 integration, any change to the
Agent Tool Loop / `buildAgentStepPromptPackage.ts` / `pendingCatalogAction` /
`CatalogPort`, RFM or lifecycle runtime, Capability Gateway registration
(`CAPABILITY_GATEWAY_REGISTRY`, `AGENT_LOOP_TOOL_POOL`), and any change to
MS-pesaschile-customer-profile or MS-pesaschile-catalog-service. None of
these were touched.

## Validation

- `npx tsc --noEmit` - clean.
- `npm run lint` - clean (repo `lint` script only targets `app components lib
  middleware.ts next.config.ts tailwind.config.ts` - it does not lint `tests/`
  or `docs/`).
- `npm test` (`tests/**/*.test.ts`, includes the 26 new tests in
  `tests/customer-profile/httpCustomerProfileAdapter.test.ts`) - see command
  output for full-suite pass/fail counts and any pre-existing unrelated
  failures.
- `npm run build` - clean.
- `git status --short` / `git diff --stat` confirm the change set is limited
  to `lib/customer-profile/**`, `tests/customer-profile/**`, `.env.example`,
  and this document - no auth, cases, chats, dashboard, API route, schema,
  Capability Gateway, or Agent Tool Loop file was touched.

Tests cover (all against a real local `http` server per the existing
`tests/catalog/httpCatalogAdapter.test.ts` pattern - never a mocked
`fetch`): missing base URL, optional API key, timeout, base URL
normalization; invalid/empty/email/alphanumeric/whitespace/too-long
`masterCustomerId` rejected without a network call; 200 available with items
and with an empty list; pagination and `hasMore`; decimal amounts preserved
as strings; `catalogStatus` including `deleted_or_unavailable`; both 404
variants; both 503 `degraded` reasons; 400/401/403/429/500; invalid JSON body;
invalid response shape; API key header presence/absence; exactly-one-call:
the same coverage for `getPurchaseBehavior` (summary, `topProducts`,
`topVariants`, empty arrays, shares as strings, `isRepeated`,
`daysSinceLastPurchase`); and a security test confirming a secret string
embedded in an upstream 500 body never reaches the returned result.

## Next task

`CP-R1-T10B2` - CustomerRecommendationContext Mapper.

## Confirmations

- No commit was made.
- No push was made.
- No PR was created.
- No other repository was modified (MS-pesaschile-customer-profile and
  MS-pesaschile-catalog-service were only read, for contract auditing).
- The `get_product_recommendations` capability was not integrated; nothing
  was registered in the Capability Gateway or the Agent Tool Loop.

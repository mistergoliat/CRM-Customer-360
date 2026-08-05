---
title: CP-R1-T10B8B - Catalog Recommendation Gateway Adapter
doc_id: cp-r1-t10b8b-catalog-recommendation-gateway-adapter
status: implemented_not_wired
tags:
  - release
  - catalog
  - recommendations
  - capability-gateway
---

# CP-R1-T10B8B - Catalog Recommendation Gateway Adapter

Branch: `feat/cp-r1-t10b8b-catalog-recommendation-gateway-adapter`, base
`develop` (contains the CP-R1-T10B8A merge, PR #80 / `30fd9dc`). No commit,
push or PR was made for this task.

## Correction (review pass)

The first implementation of this task was returned `CHANGES_REQUIRED` for two
blockers, both now fixed:

1. **`explicitRepurchaseRequested` was accepted and validated but never
   forwarded to T10B7.** Root cause (see "Explicit repurchase audit" below):
   T10B6's `BuildSearchProductsV2RequestInput` had no top-level channel for
   that signal - the only path was
   `recommendationContext.recommendationIntent.explicitRepurchaseRequested`,
   and `CustomerRecommendationContext.masterCustomerId` is required-non-null,
   making it structurally impossible to carry the signal in generic mode
   without fabricating identity. **Fix**: a minimal, additive, precedented
   change to T10B6 itself (`searchProductsV2RequestTypes.ts` +
   `buildSearchProductsV2Request.ts`) - a new top-level
   `explicitRepurchaseRequested?: boolean` field, merged with the
   `recommendationContext`-nested one via logical OR, exactly mirroring how
   `explicitExcludedProducts` already works as a dual top-level/nested,
   OR-merged field in the same function. T10B7 required **zero** changes
   (its input type is `BuildSearchProductsV2RequestInput & {signal}`, so the
   new field flows through automatically). This is a cross-task change to
   T10B6 - reported here explicitly, not applied silently, per this
   correction task's own instruction.
2. **Two new integration tests depended on a local MariaDB and failed with
   `ECONNREFUSED 127.0.0.1:3306`.** Fix: `catalogRecommendationGatewayAdapterIntegration.test.ts`
   no longer calls the real `executeGovernedCapability` (which always writes
   to `crm_capability_executions`). It now calls a test-local
   `executeWithFakePersistence` helper that mirrors that function's exact
   orchestration (real `resolveCapabilityGatewayDefinition`, real
   `checkAvailability`, real `execute` with the real retry loop, real
   `buildRequestSummary`/`buildResponseSummary` fallback) but swaps the final
   DB write for an in-memory array. No production code was changed to
   accommodate this - the fake lives entirely in the test file. All 15 (now
   20, see below) integration tests pass with zero database dependency.

## Purpose

Wire `CatalogRecommendationCapability` (CP-R1-T10B7) into the existing
Capability Gateway infrastructure via an internal, productive
`CapabilityGatewayDefinition` (`recommend_catalog_products`), consuming the
verified identity from `CP-R1-T10B8A`
(`trustedCustomerSession.masterCustomerIdentity`). The capability becomes
executable through `executeGovernedCapability` (audited, persisted,
retry-governed like every other Gateway capability) but is **not** exposed to
the model - not added to `AGENT_LOOP_TOOL_POOL`, no tool alias, no prompt
change.

## Existing architecture

```
CapabilityGatewayDefinition ("recommend_catalog_products")
  -> catalogRecommendationGatewayAdapter.ts (this task)
     -> CatalogRecommendationCapability (T10B7, real, cached singleton, unmodified)
        -> buildSearchProductsV2Request (T10B6, real - one minimal, additive
           field added by this task's correction, see below)
           -> CatalogSearchProductsV2Client (T10B5, real, unmodified)
              -> SearchProducts V2 (HTTP)
```

Identity:

```
CapabilityGatewayContext.trustedCustomerSession (T10B8A, real, unmodified)
  .masterCustomerIdentity.status === "resolved"
    -> masterCustomerId forwarded to T10B7
  .masterCustomerIdentity.status === "identity_unresolved" | session absent
    -> masterCustomerId omitted -> T10B7 runs generic mode
```

T10B5, T10B7 and T10B8A were not modified. T10B6 received one minimal,
additive, cross-task correction (see "Explicit repurchase audit" below) -
everything else in this task lives in one new file
(`catalogRecommendationGatewayAdapter.ts`) plus the minimal registry/barrel
wiring described below.

## Auditoria previa

Read directly, no name/route/behavior assumed without confirmation (original
pass - see "Explicit repurchase audit" for the correction pass's additional
reading):

- `lib/brain/commercial/capability-gateway/types.ts` - confirmed
  `CapabilityGatewayDefinition` (`capability`, `version`, `description`,
  `governance`, `maxRetries`, optional `inputSchema`, `checkAvailability`,
  `execute`, optional `buildRequestSummary`/`buildResponseSummary`),
  `CapabilityGatewayContext` (already carries `trustedCustomerSession?:
  NativeCustomerSessionExecutionContext | null` - a documentary-only
  restriction to identity capabilities, not an enforced one; any capability
  can read it), and `CapabilityExecutionOutcome` - confirmed the real
  `CapabilityGatewayExecutionStatus` union is `completed |
  missing_information | denied | requires_approval | temporarily_blocked |
  invalid_arguments | failed` (no `blocked` member).
- `lib/brain/commercial/capability-gateway/registry.ts` - confirmed the
  factory-function-per-capability pattern (`searchProductsCapability(getPort)`
  pushed into `CAPABILITY_GATEWAY_REGISTRY`), the `mapCatalogErrorToOutcome`
  precedent for mapping catalog port errors, and the lazy-singleton-with-
  test-reset pattern (`cachedPort`/`getSharedCatalogPort`/
  `resetCapabilityGatewayCatalogPortForTests`) this task's own singleton
  copies.
- `lib/brain/commercial/capability-gateway/executeCapability.ts` - confirmed
  the full flow: unregistered-capability denial, `checkAvailability` gate
  (never calls `execute` when not `available`), a retry loop bounded by
  `definition.maxRetries`, `buildRequestSummary`/`buildResponseSummary`
  fallback to raw `input`/`outcome.data` when absent, and persistence via
  `insertCapabilityExecution` (which uses `safeExecute` and never throws -
  a DB failure returns `{ok:false, publicId:null}`). **This exact function's
  logic is what the correction pass's `executeWithFakePersistence` test
  helper mirrors** - see "Integration DB isolation" below.
- `lib/brain/commercial/capability-gateway/customerIdentityCapabilities.ts` -
  confirmed the `buildRequestSummary`/`buildResponseSummary` allowlist
  pattern used only where raw input/output can carry PII, and that
  `resolve_customer`/`create_customer`/`link_external_identity` all read
  `context.trustedCustomerSession` directly, never `inputSchema` (not
  model-facing).
- `lib/brain/commercial/capability-gateway/companyKnowledgeCapability.ts` -
  confirmed the no-external-dependency factory shape (`capabilityFn(): 
  CapabilityGatewayDefinition`).
- `migrations/022_crm_capability_executions.sql` - confirmed the persisted
  columns; no `warnings_json` column exists (warnings stay in-memory only,
  same as every other Gateway capability today).
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts` - confirmed
  `AGENT_LOOP_TOOL_POOL = ["search_products", "get_product_details",
  "search_company_knowledge", "explore_catalog"]`, `buildToolDescriptions()`
  (exported - only iterates `AGENT_LOOP_TOOL_POOL`, reads `.inputSchema` off
  each resolved definition), and that `processUseToolStep` gates on both pool
  membership AND Gateway registration - `batch_get_products` is the existing
  precedent for "registered in the Gateway, deliberately absent from the
  pool, has no `inputSchema` need either way".
- `lib/brain/commercial/capability-gateway/toolAliases.ts` /
  `lib/brain/tools/types.ts` (`BrainToolName`) -
  confirmed neither references this task's capability; both untouched.
- `lib/catalog/search-products-v2/httpCatalogSearchProductsV2Client.ts` -
  confirmed `readHttpCatalogSearchProductsV2ClientConfig()` (exported, pure,
  synchronous, no fetch, returns `null` when unconfigured, throws
  `CatalogSearchProductsV2ConfigurationError` only when a present value is
  structurally malformed) and `createCatalogSearchProductsV2Client()` (never
  throws for missing config - returns a fail-closed client that always
  answers `configuration_error` without any network call).
- `lib/catalog/search-products-v2/types.ts` - confirmed the 12
  `SearchProductsV2ClientErrorCode` values and that `SearchProductsV2ClientError.message`
  is always already sanitized (never a raw body/header/secret).
- `lib/brain/commercial/recommendation-context/types.ts` - confirmed
  `CustomerRecommendationContext.masterCustomerId` is a **required,
  non-nullable** field, and that its `recommendationIntent` sub-object
  (`sourceProduct`, `explicitExcludedProducts`, `explicitRepurchaseRequested`)
  has no identity field of its own - the coupling to identity comes entirely
  from the outer `CustomerRecommendationContext` wrapper, not from the intent
  itself (load-bearing fact for the correction - see below).
- `lib/brain/commercial/capabilities/catalog-recommendation/types.ts` /
  `catalogRecommendationCapability.ts` - confirmed
  `CatalogRecommendationCapabilityInput` (= `BuildSearchProductsV2RequestInput`
  + `signal`), the `completed`/`skipped`/`failed` result union, and that
  `createProductionCatalogRecommendationCapability()` is a **non-memoized**
  factory (a new `CatalogSearchProductsV2Client` and capability instance per
  call) - explicitly left for this task to cache in a composition root.
- `lib/brain/commercial/identity/master-customer/types.ts` - confirmed
  `MasterCustomerIdentityResolution` (`resolved` with `masterCustomerId:
  string`, or `identity_unresolved` with one of 7 `reason` values:
  `identity_absent`, `identity_not_verified`, `identity_source_unsupported`,
  `projection_not_confirmed`, `identity_conflict`,
  `identity_temporarily_unavailable`, `invalid_master_customer_id`).
- `lib/brain/commercial/native-cycle/customer-session/types.ts` - confirmed
  `NativeCustomerSessionExecutionContext.masterCustomerIdentity` is a
  dedicated, separate field from `identity.customerId` (never a rename/
  fallback of each other), and that `CapabilityGatewayContext` already types
  `trustedCustomerSession` against this exact type - no propagation change
  needed; `runAgentToolLoop.ts` already assembles
  `gatewayContext.trustedCustomerSession = input.trustedCustomerSession ??
  null` for every capability call.
- `lib/db.ts` - confirmed there is no existing dependency-injection seam for
  the mysql2 `Pool` (`getPool()` always constructs a real pool from resolved
  config; `resetPoolForTests()` only nulls the module-level singleton, it
  cannot inject a fake) - confirming that removing the MariaDB dependency
  from this task's own tests required a test-local orchestration mirror
  rather than a production DI seam (which would have been "modifying
  production to accommodate the test").
- `tests/commercial/capabilityGateway.test.ts`,
  `tests/commercial/createCustomerCapability.test.ts`,
  `tests/catalog-recommendation/catalogRecommendationCapabilityIntegration.test.ts`,
  `tests/recommendation-context/buildSearchProductsV2Request.test.ts` -
  confirmed the `node:http` local-server integration precedent, the
  `session()`/`context()` fixture pattern for
  `NativeCustomerSessionExecutionContext`, that DB-backed tests in this
  environment fail with `ECONNREFUSED 127.0.0.1:3306` (no local MariaDB) -
  a pre-existing, environmental condition this task's own regression suite
  runs still hit (in unrelated files) but no longer hits in this task's own
  new files - and (correction pass) that every existing explicit-repurchase
  test in T10B6's own suite went through `recommendationContext` with a
  non-null `masterCustomerId` - **zero generic-mode explicit-repurchase
  coverage existed before this correction**.

Grepped for `recommend_catalog_products`, `RecommendCatalogProducts`,
`CatalogRecommendationCapability`, `masterCustomerIdentity`,
`trustedCustomerSession` outside this task's own new files and their tests -
confirmed no prior wiring existed and none beyond what is documented here was
introduced (`AGENT_LOOP_TOOL_POOL`, `toolAliases.ts`, `BrainToolName`,
`recentCatalogContext.ts`, `pendingCatalogAction.ts` and
`buildToolObservation.ts` are all grep-confirmed untouched).

## Explicit repurchase audit

Answering the six required questions with code evidence:

1. **¿Existe un campo top-level para `explicitRepurchaseRequested`?** Before
   this correction: no. `BuildSearchProductsV2RequestInput` had
   `masterCustomerId`, `sourceProduct`, `recommendationContext`, `query`,
   `explicitExcludedProducts`, `correlationId`, `limit`, `inStockOnly` - no
   repurchase field. A code comment stated this was deliberate: "There is
   deliberately no top-level `explicitRepurchaseRequested` flag: that signal
   only exists inside a built `recommendationContext`."
2. **¿La señal solo existe dentro de `recommendationContext`?** Yes, confirmed
   in `buildSearchProductsV2Request.ts` (pre-correction): `const
   explicitRepurchaseRequested = input.recommendationContext?.recommendationIntent.explicitRepurchaseRequested
   ?? false;` - the only read path.
3. **¿Puede construirse una intención de recomendación sin `masterCustomerId`?**
   Yes, structurally: the nested `recommendationIntent` object itself
   (`{sourceProduct, explicitExcludedProducts, explicitRepurchaseRequested}`)
   has no identity field. The blocker was never the *intent* shape - it was
   that T10B6 only accepted that intent wrapped inside the full
   `CustomerRecommendationContext`, whose *outer* `masterCustomerId: string`
   field is required-non-null.
4. **¿`CustomerRecommendationContext` mezcla identidad e intención de forma
   que impide el modo genérico?** Yes - confirmed by reading `types.ts`:
   `masterCustomerId: string` (not `string | null`, not optional) sits
   alongside `recommendationIntent` as sibling required fields of the same
   object. A caller with no identity literally cannot construct a
   type-valid `CustomerRecommendationContext`, so routing repurchase intent
   exclusively through it forced every repurchase caller through identified
   mode - never a deliberate product requirement, just a side effect of
   reusing that one wrapper type for both identity and intent.
5. **¿T10B6 ya tiene tests de recompra explícita genérica?** No. Grepped
   `tests/recommendation-context/buildSearchProductsV2Request.test.ts`
   (pre-correction): every `explicitRepurchaseRequested` test used
   `contextFixture(...)`, whose `masterCustomerId` defaults to `"555"` and is
   never overridden to absent in any repurchase test. Zero generic-mode
   coverage existed.
6. **¿Qué contrato mínimo debe ajustarse para preservar la señal?** Add
   `explicitRepurchaseRequested?: boolean` as a **top-level** field on
   `BuildSearchProductsV2RequestInput` (T10B6's own type), merged with the
   `recommendationContext`-nested value via logical OR inside
   `buildSearchProductsV2Request.ts` - the exact same duplicated-source,
   OR-merged shape T10B6 already uses for `explicitExcludedProducts`
   (`const rawExclusions = [...(input.recommendationContext?...??[]),
   ...(input.explicitExcludedProducts??[])]`). No redesign: one field added
   to one type, one line of logic changed from a single nested read to an OR
   of two reads. T10B7 needed zero changes (structural intersection type).

## Chosen repurchase solution

**Option A** (preferred, per this correction task's own instructions) -
applied. `explicitRepurchaseRequested=true` + a valid `sourceProduct` now
reaches T10B7/T10B6 in **both** identified and generic mode, producing
`request.context.explicitRepurchaseProducts=[sourceProduct]`. Verified:

- Never inferred from ownership/history (T10B6's own `v1-frozen rule` comment
  and tests, both pre-existing and newly added, are untouched/extended, not
  replaced).
- Never requires `masterCustomerId` (generic-mode integration test, real
  chain, real server).
- Never fabricates a `CustomerRecommendationContext` with false identity -
  T10B8B still never builds one at all; the new top-level T10B6 field makes
  that unnecessary.
- Never duplicates `sourceProduct` (unit test: `Object.keys(call).filter(k
  => k === "sourceProduct").length === 1`).
- A contradiction (source product also in the exclusion list) still produces
  `skipped: "contradictory_product_context"` - verified via the real T10B6
  chain (no context needed at all to trigger it now) and via the top-level
  field specifically (T10B6 unit test: "contradictions (top-level): ... zero
  context needed").
- `false`/`undefined` never adds `explicitRepurchaseProducts` (T10B6 unit
  tests + T10B8B unit test).

## Gateway definition

New file:
`lib/brain/commercial/capability-gateway/catalogRecommendationGatewayAdapter.ts`.

```ts
export function recommendCatalogProductsCapability(
  getCapability: () => CatalogRecommendationCapability
): CapabilityGatewayDefinition
```

Same DI-factory shape as `searchProductsCapability(getPort)` in
`registry.ts` - takes an injected getter so unit tests can supply a fake
`CatalogRecommendationCapability` with zero HTTP/DB. Registered in
`CAPABILITY_GATEWAY_REGISTRY` (`registry.ts`) as:

```ts
recommendCatalogProductsCapability(getSharedCatalogRecommendationCapability)
```

`capability: "recommend_catalog_products"`,
`version: "capability-gateway.v1"` (same version string every other
capability in this Gateway uses), `governance: { sideEffect: "read_only",
authority: "autonomous", riskClass: "low" }` (identical to
`search_products`/`get_product_details`/`explore_catalog`).

**`inputSchema` is now set** (correction pass, section 7): a JSON Schema
(draft-07 subset, same style as `SEARCH_PRODUCTS_INPUT_SCHEMA`/
`EXPLORE_CATALOG_INPUT_SCHEMA` in `registry.ts`) is attached even though this
capability is not in `AGENT_LOOP_TOOL_POOL`. Confirmed by reading
`executeCapability.ts` that the Gateway never consults `inputSchema` to gate
`execute()` for **any** capability - it exists purely for
`buildToolDescriptions()`, which itself only iterates
`AGENT_LOOP_TOOL_POOL`. So a schema being present here has **zero** runtime
effect on validation (the hand-written parser below remains the real,
enforced validator) and **zero** exposure effect (confirmed by a dedicated
test: `buildToolDescriptions()` still never returns an entry for
`recommend_catalog_products`) - it exists solely for documentation/future
agent-facing reuse, per this correction task's explicit instruction ("un
schema registrado en Gateway no implica exposición al modelo").

## Input

```ts
export type RecommendCatalogProductsGatewayInput = {
  sourceProduct: { productId: number; combinationId?: number | null };
  query?: string | null;
  explicitRepurchaseRequested?: boolean;
  excludedProducts?: readonly { productId: number; combinationId?: number | null }[];
  limit?: number;
  inStockOnly?: boolean;
};
```

Parsed by a strict, allowlisted, hand-written parser
(`parseRecommendCatalogProductsInput`) - the same class of raw-JSON-to-typed
parsing every existing Gateway capability already does
(`asQueryText`/`asProductId` in `registry.ts`). This parser is the real
runtime validator regardless of the `inputSchema` now also present (see
"Gateway definition" above - the Gateway itself never validates against
`inputSchema`). Rules:

- **Only** the six keys above are accepted at the top level; any other key
  (including every explicitly forbidden one - `masterCustomerId`,
  `customerId`, `customerMode`, `recommendationContext`, `correlationId`,
  `signal`, `ownership`, `purchasedProducts`, `apiKey`, or any typo/unknown
  field) is rejected as `invalid_arguments` / `errorCode:
  "unsupported_field"`, **before** the capability is ever called.
- `sourceProduct` is required and must structurally be `{productId: number,
  combinationId?: number | null}` (only those two keys) - missing or
  malformed is `invalid_arguments` (`source_product_required` or a specific
  type-mismatch code), never a call to T10B7. Business validity (positivity,
  `combinationId === 0` normalization to "base product", mismatch checks) is
  T10B6's job and is never duplicated here - a structurally valid but
  business-invalid `sourceProduct` (e.g. `productId: -1`) reaches T10B7/T10B6
  and comes back as a `skipped` result (see "Skipped" below).
  `excludedProducts` entries are parsed the same way, one by one.
- `query`, `limit`, `inStockOnly` are optional and type-checked
  (string/number/boolean respectively) if present; a present-but-wrong-typed
  value is `invalid_arguments`, never silently coerced or dropped.
- `explicitRepurchaseRequested` is type-checked (must be `boolean` if
  present) and, **as of this correction, forwarded verbatim** to T10B7's
  input (never inferred, never defaulted when the caller omits it entirely -
  confirmed by a unit test that the key is simply absent from the call when
  the caller never sets it).

## Trusted identity

Read exclusively from:

```ts
const resolution = context.trustedCustomerSession?.masterCustomerIdentity;
const masterCustomerId = resolution?.status === "resolved" ? resolution.masterCustomerId : undefined;
```

- `status === "resolved"` -> `masterCustomerId` is `resolution.masterCustomerId`
  verbatim, forwarded to T10B7's `masterCustomerId` field.
- Anything else (`identity_unresolved` with any of its 7 reasons, or
  `trustedCustomerSession` absent/`null`) -> `masterCustomerId` is
  `undefined` - T10B7/T10B6 build a generic-mode request.
- `identity.customerId` (the separate, non-master-customer identity space) is
  **never** read as a fallback - confirmed by a dedicated unit test.
- `context.trustedCustomerSession` and `resolution` are never mutated.
- This identity resolution is entirely independent of
  `explicitRepurchaseRequested` - both signals are read/forwarded
  orthogonally (verified: identified+repurchase, generic+repurchase,
  session-absent+repurchase, session-null+repurchase are each their own
  test).

## Non-blocking generic mode

Verified for all 7 `identity_unresolved` reasons plus an absent session
(8 base cases, plus the same 8 cases repeated with
`explicitRepurchaseRequested: true` - 16 tests total): the capability is
always invoked, always returns `masterCustomerId: undefined`, and the
Gateway outcome is never `temporarily_blocked`, never `denied`, never
`requires_approval`, and never a technical `failed` caused by the identity
state itself - regardless of whether repurchase was requested.
`identity_unresolved` is a normal, expected runtime state - not a defect and
not a reason to skip calling SearchProducts V2.

## Completed

`CatalogRecommendationCapabilityResult.status === "completed"` maps to
`CapabilityExecutionOutcome.status === "completed"` with:

```ts
data: {
  status: "completed",
  customerMode, recommendations, excluded, warnings,
  personalization, execution, statistics, snapshot, metadata
}
```

Every field is passed through unmodified - no sort, filter, dedupe, ID
conversion, candidate selection, `get_product_details` call, ownership
stripping, or score recomputation. `errorCode: null`, `retryable: false`.
`evidence` carries one entry: `{source: "catalog_recommendation_capability",
summary: "recommend_catalog_products returned N recommendation(s)
(customerMode=...)."}`.

## Empty

`recommendations: []` -> `status: "completed"`,
`data.metadata.recommendationCount: 0` - never `skipped`/`failed`, never a
fabricated fallback.

## Degraded

`execution.degraded: true` (HTTP 200 from Catalog Service) -> `status:
"completed"`, `data.metadata.degraded: true`, `data.execution.degradationReasons`
preserved verbatim - never reclassified as an error, never retried.

## Skipped

`CatalogRecommendationCapabilityResult.status === "skipped"` maps to:

```ts
{ status: "completed", data: { status: "skipped", reason }, errorCode: null, retryable: false, evidence: [] }
```

Decision: the real `CapabilityGatewayExecutionStatus` union has **no
`blocked` member** (confirmed by reading `types.ts` directly, not assumed
from conceptual wording), so the preferred alternative applies -
`status: "completed"` carrying a `{status: "skipped", reason}` payload in the
generic `data` field the contract already supports. `reason` is the exact
`BuildSearchProductsV2RequestSkipReason` string T10B6 produced, never
renamed, never re-collapsed, never re-called against T10B7 a second time.
All 10 reasons covered by dedicated unit tests, plus one dedicated
integration test for the repurchase-specific contradiction case (real
T10B6, zero HTTP calls). **Distinguishability from a real `completed` result
(section 9)**: the `skipped` payload has no `recommendations` key at all
(not even `[]`) - verified by a dedicated integration test that also asserts
the *persisted* `responseSummary` (via the fake persistence executor)
carries `status:"skipped"`+exact `reason` and omits `recommendations`
entirely, distinguishing it unambiguously from a completed-with-empty-result
row (`responseSummary.status === "completed"`, `recommendations: []`).

## Failed

`CatalogRecommendationCapabilityResult.status === "failed"` (i.e.
`SearchProductsV2ClientError`, T10B5's own taxonomy, reused verbatim, never
redefined) maps to:

```ts
{
  status: "failed",
  data: { status: "failed", code, retryable, message, httpStatus?, providerErrorCode? },
  errorCode: code,
  retryable,
  evidence: [{ source: "catalog_search_products_v2", summary: message }]
}
```

All 12 `SearchProductsV2ClientErrorCode` values covered by dedicated unit
tests (`configuration_error`, `invalid_request`, `timeout`, `aborted`,
`network_error`, `unauthorized`, `forbidden`, `rate_limited`,
`catalog_service_error`, `invalid_response_body`, `invalid_response_schema`,
`unexpected_http_status`). `SOURCE_PRODUCT_NOT_FOUND` (HTTP 404) /
`SOURCE_PRODUCT_INACTIVE` (HTTP 409) verified end-to-end (integration tests,
real local server) to surface as `code: "catalog_service_error"` with
`providerErrorCode` carrying the remote code, exactly as T10B5 classifies
them. `message` is T10B5's own already-sanitized string (never a raw body/
header/API key/stack) - `data` never includes `masterCustomerId`, `query`,
`sourceProduct`, `excludedProducts`, request/response bodies, or headers.

## Error taxonomy

Reused verbatim from T10B5/T10B7 - no new taxonomy introduced. `errorCode` on
the Gateway outcome is exactly `SearchProductsV2ClientErrorCode`.

## Availability

```ts
async checkAvailability() {
  try {
    const config = readHttpCatalogSearchProductsV2ClientConfig();
    if (config === null) return { status: "unavailable", reason: "catalog_search_products_v2_not_configured" };
    return { status: "available", reason: null };
  } catch {
    return { status: "unavailable", reason: "catalog_search_products_v2_not_configured" };
  }
}
```

Pure, synchronous, local configuration check (T10B5's own exported
`readHttpCatalogSearchProductsV2ClientConfig()`) - no `fetch`, no DB read, no
Customer Profile call, and **no read of `trustedCustomerSession`/identity at
all**: availability answers "is SearchProducts V2 technically configured?",
never "is the customer identified?". A present-but-malformed config (throws
`CatalogSearchProductsV2ConfigurationError`) is also treated as
`unavailable` rather than propagating an uncaught exception through the
Gateway. Verified by an integration test (fake persistence executor, real
`checkAvailability`): with `CATALOG_SERVICE_BASE_URL`/`CATALOG_SERVICE_API_KEY`
unset, the result reports `availability: "unavailable"`,
`status: "temporarily_blocked"`, `retryable: true`, and the local test
server never receives a request.

## Governance

`{ sideEffect: "read_only", authority: "autonomous", riskClass: "low" }` -
identical to `search_products`/`get_product_details`/`explore_catalog`
(this capability performs no mutation and requires no operator
pre-approval).

## Retry ownership

`maxRetries: 0`. Rationale: T10B5 already makes exactly one physical HTTP
call per invocation and owns no retry of its own; T10B7 does not retry
either; duplicating a recommend call on a transient failure would mean a
second, possibly-different recommendation set for the same conversational
turn, which is worse than surfacing `retryable: true` and letting a
higher-level policy decide. This mirrors `search_company_knowledge`'s own
`maxRetries: 0` (the other capability in this Gateway with no retry budget)
rather than the `maxRetries: 1` used by the three catalog-port capabilities.
Verified: an HTTP 503 response from the real local server produces exactly
one physical request (`requestCount === 1`) and a `retryCount: 0` Gateway
result (via the fake persistence executor - the retry loop it runs is a
byte-for-byte copy of the real one).

## Correlation

`context.correlationId` (the Gateway's own, never accepted from the caller's
input - a `correlationId` key in the raw input is rejected as
`unsupported_field`) is forwarded as `correlationId` on the T10B7 input.
T10B6 normalizes it into `callContext.correlationId`, and T10B5 maps that
into the `x-correlation-id` HTTP header - never the request body. Verified
end-to-end against a real local server.

## Cancellation

`CapabilityGatewayContext` has **no `AbortSignal`/`signal` field at all**
(confirmed by reading `types.ts` directly) - there is nothing for this
adapter to "reuse". No `AbortController` was invented, and `signal` is never
set on the T10B7 input (it stays `undefined`, matching T10B7's own optional
field). This is a real, documented limitation: a call through this Gateway
adapter cannot currently be cancelled mid-flight; the only bound on how long
a request can run is T10B5's own internal `CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS`
(default 3000ms, verified by a dedicated integration test with a server that
never responds).

## Production instance

```ts
let cachedCapability: CatalogRecommendationCapability | undefined;
export function getSharedCatalogRecommendationCapability(): CatalogRecommendationCapability {
  if (!cachedCapability) cachedCapability = createProductionCatalogRecommendationCapability();
  return cachedCapability;
}
export function resetCatalogRecommendationCapabilityForTests() { cachedCapability = undefined; }
```

Same lazy-module-singleton-with-test-reset shape as `getSharedCatalogPort`/
`resetCapabilityGatewayCatalogPortForTests` in `registry.ts`. Constructed
once per process, on first use (never at import time -
`createProductionCatalogRecommendationCapability()` itself never performs a
`fetch`, per T10B7's own contract). Fail-closed when unconfigured: verified
by a dedicated unit test that calls `.execute(...)` on the production
capability with no `CATALOG_SERVICE_*` env vars set and asserts a
`configuration_error` failed result with **zero** network activity, never a
thrown exception.

**Singleton audit (correction pass, section 8)**:

- *Lazy initialization, one instance per process*: verified (two calls
  return the same `===` reference).
- *Two "concurrent" calls during first initialization*: `getSharedCatalogRecommendationCapability()`
  has no `await` inside it, so JS's single-threaded execution model already
  guarantees no interleaving is possible - verified with a regression test
  (two microtask-deferred calls via `Promise.all`) that guards this
  invariant against a future accidental `async` refactor.
- *`resetForTests` exported from the "productive" barrel*: audited against
  the three existing precedents in this same barrel
  (`resetCapabilityGatewayCatalogPortForTests`, `resetCustomerServicePortForTests`,
  `resetOnboardingServiceForTests` - all exported from
  `lib/brain/commercial/capability-gateway/index.ts`, the same barrel
  production code imports `executeGovernedCapability`/`CAPABILITY_GATEWAY_REGISTRY`
  from). No separate "test-only barrel" exists anywhere in this codebase for
  any of these four singletons. `resetCatalogRecommendationCapabilityForTests`
  matches that established, repo-wide convention exactly - **not a defect**,
  flagged and left as-is rather than inventing new, inconsistent
  infrastructure for this one capability.
- *Zero fetch during construction*: structurally guaranteed
  (`createProductionCatalogRecommendationCapability` has no `await`/`fetch`
  inside itself, confirmed by reading T10B7's source) and confirmed
  behaviorally by the fail-closed unit test above.
- *Configuration faltante fail-closed*: verified (same test).
- *Registry never captures a stale reference*: `recommendCatalogProductsCapability(getCapability)`
  stores the **getter function**, not a resolved instance - `execute()`
  calls `getCapability()` fresh on every invocation. Verified with a
  dedicated integration test: resolve the definition once, execute it while
  unconfigured (`configuration_error`), then configure + reset the singleton,
  then execute the **same** resolved `definition` object again - it picks up
  the new instance immediately, proving no stale capture at
  registry-build time.

## Registry

Registered in `CAPABILITY_GATEWAY_REGISTRY` (`registry.ts`), the same array
every other governed capability lives in - `resolveCapabilityGatewayDefinition("recommend_catalog_products")`
resolves it, and it is fully executable via `executeGovernedCapability`
(availability, retry budget, persistence, evidence - identical pipeline to
`search_products`). Re-exported from the Gateway's `index.ts` barrel
(`recommendCatalogProductsCapability`, `getSharedCatalogRecommendationCapability`,
`resetCatalogRecommendationCapabilityForTests`,
`RecommendCatalogProductsGatewayInput`) alongside the other capability
exports.

## Agent Loop visibility

**Not** added to `AGENT_LOOP_TOOL_POOL` (`runAgentToolLoop.ts`), not aliased
in `toolAliases.ts`, not added to `BrainToolName`/`SalesAgentToolName`, no
prompt change. The capability now carries an `inputSchema` (correction
pass), but that alone does not expose it - `buildToolDescriptions()` only
ever iterates `AGENT_LOOP_TOOL_POOL`, confirmed by a dedicated test that
calls the real `buildToolDescriptions()` and asserts no entry named
`recommend_catalog_products` exists in its output. `AGENT_LOOP_TOOL_POOL`
(cast to `readonly string[]`) is separately confirmed to not include
`"recommend_catalog_products"` - and the existing, unmodified test at
`tests/agent-loop/runAgentToolLoop.test.ts:985` (asserting the pool's exact
4-member closed set) continues to pass unchanged, confirming this task
altered nothing the Agent Tool Loop or the model can see. `batch_get_products`
is this repo's own precedent for "registered in the Gateway, deliberately
outside the pool".

## Persistence

No new production persistence code. `executeGovernedCapability` persists
exactly as it already does for every other capability without a
`buildRequestSummary`/`buildResponseSummary` override (`search_products`/
`explore_catalog`'s own precedent) - this task deliberately defines
**neither**, because it is already safe by construction: the raw `input`
persisted as `request_summary_json` is the caller-facing
`RecommendCatalogProductsGatewayInput`, which can **never** contain
`masterCustomerId` (any caller attempt to supply it is rejected as
`unsupported_field` before `execute()` even reads `context`), and the `data`
payload persisted as `response_summary_json` (`{status, customerMode,
recommendations, ...}` / `{status:"skipped", reason}` / `{status:"failed",
code, retryable, message, httpStatus?, providerErrorCode?}`) never carries
`masterCustomerId`, `identity.customerId`, request/response bodies, headers,
or the API key either. No `commercial_event`, `recentCatalogContext`,
`pendingCatalogAction`, or outbox row is written - those remain explicitly
out of scope (T10B8C/D).

## Integration DB isolation

The real `executeGovernedCapability` always writes to
`crm_capability_executions` (no DI seam exists in `lib/db.ts`/`repository.ts`
today - confirmed by reading both directly). Adding one purely to satisfy a
test would be "modificar producción para acomodar el test" - explicitly
forbidden. Instead, `catalogRecommendationGatewayAdapterIntegration.test.ts`
defines `executeWithFakePersistence(capabilityName, input, context,
persisted)`: a test-local function that reproduces
`executeCapability.ts#executeGovernedCapability`'s exact steps -
`resolveCapabilityGatewayDefinition` (real), `definition.checkAvailability`
(real), the retry loop bounded by `definition.maxRetries` (real, same
bound/condition), `definition.buildRequestSummary`/`buildResponseSummary`
fallback (real, identical fallback-to-raw-input/data logic) - with only the
final `insertCapabilityExecution` DB call replaced by `persisted.push(...)`
into an in-memory array. Every assertion in that file still exercises the
**real** registered `CapabilityGatewayDefinition`, the **real** T10B7/T10B6/
T10B5 chain, and the **real** local `node:http` server - only the
persistence backend is faked. `executeGovernedCapability`'s own correctness
(this identical orchestration logic) remains covered separately by
`tests/commercial/capabilityGateway.test.ts` against a real database - not
duplicated here.

## Persistence fake

Verified via the fake persistence executor (integration tests):
`capabilityName === "recommend_catalog_products"`, `executionStatus`
matches the real outcome status, `correlationId` matches the caller's,
`retryCount === 0` (matching `maxRetries: 0`), `requestSummary` is bounded
(the caller-facing input only), never contains `masterCustomerId` or
`customerId`, never the API key or any header; a skipped result's
`responseSummary` is `{status:"skipped", reason}` with no fabricated
`recommendations` key, distinguishing it from a real completed result at the
persisted-row level, not just the returned outcome.

## Security

Verified by code inspection and dedicated tests (never `JSON.stringify` on
`context`/`input` as a whole; no logger added - this repo's other capability
adapters do not log directly inside `execute()` either, same reasoning
T10B7 documented): a resolved `masterCustomerId` never appears in the
Gateway outcome's `data`/`errorCode`/`evidence` (unit test, whole-outcome
`JSON.stringify` search) even when explicit repurchase is also requested; a
`failed` outcome never includes `sourceProduct`, `query`, or
`excludedProducts` (unit test); the fake-persisted execution row never
includes the resolved `masterCustomerId` or the configured API key
(integration test, whole-row `JSON.stringify` search, also checks for the
`x-api-key` header name, and separately asserts `masterCustomerId`/
`customerId` are absent as keys of the persisted `requestSummary`).
`trustedCustomerSession` itself is never serialized anywhere - only its
`.masterCustomerIdentity.status`/`.masterCustomerId` fields are ever read.

## Concurrency

Zero mutable state in the adapter itself - `parseRecommendCatalogProductsInput`,
`mapCatalogRecommendationResultToOutcome` and `execute()` only touch local
variables and their own arguments; the only module-level mutable state is the
lazy singleton (`cachedCapability`), which holds a stateless client/capability
pair, never per-call data. Verified with two concurrent `execute()` calls -
one with a resolved identity and a fast fake response, one generic and
artificially delayed, each with a distinct `correlationId` and
`sourceProduct` - asserting neither call's `masterCustomerId`,
`sourceProduct`, or `correlationId` leaks into the other's recorded call.

## Immutability

`input`/`context` are never mutated by this adapter (no field is ever
assigned back onto either). Whether the returned `data.recommendations`
etc. are independently isolated per call is entirely inherited from T10B7
(and, beneath it, T10B5) - see T10B7's own "Immutability" section
(`docs/releases/CP-R1-T10B7-catalog-recommendation-capability.md`) for the
full disclaimer; this task performs no additional cloning of its own and
introduces no new aliasing risk beyond what T10B7 already documents.

## Unit tests

`tests/commercial/catalogRecommendationGatewayAdapter.test.ts` - 89 tests
(72 original + 17 added in this correction), fake
`CatalogRecommendationCapability` injected via the DI factory, no HTTP, no
DB: input validation (valid `sourceProduct`, missing `sourceProduct`,
non-numeric `productId`/`combinationId`, `combinationId: 0`, optional
`query`/`limit`/`inStockOnly`, `excludedProducts` array + malformed entry +
non-array, `explicitRepurchaseRequested` forwarded true/false/omitted +
wrong-typed, 9 forbidden/unknown top-level fields each rejected); identity
resolved (exact `masterCustomerId` forwarded, `identity.customerId` never
used as fallback); all 7 `identity_unresolved` reasons plus session
absent/null (8 cases, always generic, always invoked, never blocked);
**explicit repurchase** (identity resolved, all 7 `identity_unresolved`
reasons, session absent, session null - 10 dedicated tests - plus
no-duplicate-sourceProduct, contradiction-inputs-forwarded-unchanged, and an
ownership-never-infers-repurchase test); correlation forwarding; completed
(full field-by-field preservation); empty; degraded; all 10 skip reasons;
all 12 T10B5 error codes; 2 security tests; factory (singleton identity,
reset forces a new instance, **concurrent-initialization regression test**,
unconfigured fail-closed with zero network calls); one concurrency test;
governance; registry/Agent-Loop-visibility tests (now includes an
`inputSchema`-presence test and a `buildToolDescriptions()`-exclusion test).

## Integration tests

`tests/commercial/catalogRecommendationGatewayAdapterIntegration.test.ts` -
20 tests (15 original + 5 added in this correction: 2 explicit-repurchase
end-to-end tests, 1 repurchase-contradiction test, 1
skipped-persistence-distinguishability test, 1 singleton-stale-reference
test), real `CapabilityGatewayDefinition.checkAvailability`/`.execute` (via
the fake persistence executor - see "Integration DB isolation") + real
`CatalogRecommendationCapability` (T10B7) + real
`buildSearchProductsV2Request` (T10B6, including this correction's new
top-level field) + real `HttpCatalogSearchProductsV2Client` (T10B5) + local
`node:http` server (no mocked `fetch`, no productive Catalog Service call,
**no MariaDB**): identity resolved sends `customer.customerId`/
`context.customerId`; identity unresolved sends no `customer` field; session
absent runs generic; completed with recommendations; empty; HTTP 200
degraded; a skipped mapper result (missing `sourceProduct`) never reaches
the server; explicit repurchase contradiction is skipped by the real T10B6
chain with zero HTTP calls; explicit repurchase in generic mode reaches the
server with `explicitRepurchaseProducts` set and no `customer` field;
explicit repurchase with identity resolved reaches the server with both
`customer`/`context.customerId` and `explicitRepurchaseProducts` set; HTTP
404 `SOURCE_PRODUCT_NOT_FOUND`; HTTP 409 `SOURCE_PRODUCT_INACTIVE`; HTTP 503
(retryable, exactly 1 physical request - `maxRetries: 0`); timeout;
correlation header; persistence via the fake executor (never leaks
`masterCustomerId`/API key, bounded `requestSummary`); skipped persistence
is distinguishable from completed; `recommend_catalog_products` not in
`AGENT_LOOP_TOOL_POOL`; availability reflects real unconfigured T10B5 state
with zero HTTP calls; the registry-held definition never captures a stale
capability instance across a reset.

**20/20 pass with zero database dependency**, run twice consecutively with
identical results (0 flakiness observed, 0 `only`/`skip`/`todo`, process
exits with code 0 - no open handles, since no DB pool is ever created by
this file anymore).

## Regression suites

Capability Gateway + identity capabilities + T10B8A + T10B7 + T10B6 (incl.
this task's own T10B6 correction and its 11 new tests) + T10B5 +
customer-session, run together (16 files, 586 tests): 565 pass, 21 fail -
all 21 are pre-existing DB-dependent failures caused by the unavailable
local database, with multiple surfaced error shapes (12x
`ECONNREFUSED 127.0.0.1:3306` thrown directly; 6x `AssertionError:
customer_create_failed` from `customerSessionCustomer360Gate.test.ts`'s own
`seedConversation` helper; 2x `Error: Missing DATABASE_NAME` from
`customerSession.test.ts`/`customerSessionPrivacy.test.ts`, which - unlike
`capabilityGateway.test.ts` - never set `DATABASE_*` env vars themselves; 1x
a plain `AssertionError` on `executionPublicId !== null` in
`capabilityGateway.test.ts`, where `insertCapabilityExecution` degraded
silently instead of throwing) - same root cause throughout, different
proximate error per file/helper, in files unrelated to this task; **zero
failures in this task's own files** (down from 23/2 in the pre-correction
pass - both previously-failing DB-dependent T10B8B tests are now gone from
the failure list entirely, not skipped or removed - replaced by equivalent,
passing, DB-free assertions).

## Full-suite baseline

`npm test` (full suite, `tests/**/*.test.ts`), this corrected branch vs. the
`develop` baseline already established in the pre-correction pass (same
environment, same `node_modules`):

| | develop (baseline) | this branch (corrected) |
|---|---|---|
| tests | 2343 | 2461 |
| pass | 1870 | 1988 |
| fail | 473 | 473 |

`2343 + 118 = 2461` and `1870 + 118 = 1988` exact - this correction pass
added exactly 118 new tests across three files (17 unit + 5 integration + 11
new T10B6 tests for the top-level `explicitRepurchaseRequested` field, incl.
the `false`/`false` truth-table row added after review) and **every one of
them passes** (118/118, 0 new fails). The fail count is **byte-for-byte
identical** between `develop` and this branch: 473 = 473.

The `2461`/`1988` figures are derived, not from a single fresh full-suite
run: the last full-suite run performed in this environment
(`2460`/`1987`/`473`, rigorously identifier-diffed against a fresh `develop`
worktree - see below) was taken immediately before adding the
`false`/`false` test, which was independently verified passing in isolation
(`tests/recommendation-context/buildSearchProductsV2Request.test.ts` alone:
125/125, up from 124/124 without it - a clean +1 pass, 0 fail delta). A
second full-suite run was attempted afterward but is **not used** here: an
unrelated, untracked directory (`lib/integrations/customer-profile/` and
`tests/customer-profile-client/*.test.ts`, three files, ~28 tests) appeared
in this same working tree during this session from concurrent, unrelated
work (not part of T10B8B, not created by this task - see the closure
audit's own flagged observation) and inflated that run's total to `2488`,
which does not isolate this task's own contribution. Arithmetic composition
(`2460 + 1 = 2461`, `1987 + 1 = 1988`) is therefore more accurate than that
contaminated run.

Identifier-level diff (every `✖ <test name>` line from both the last clean
full-suite runs, timing suffix stripped, set-compared): both files contain
exactly 474 lines (473 test failures + 1 trailing "failing tests:" header
line) and every line matches except for `node:test`'s own file-level failure
headers, which differ only by the worktree's absolute path
(`CRM-Customer-360-develop-baseline` vs `CRM-Customer-360`) - the same test
files, same failures, same root cause on both trees. This task's own two
previously-failing DB-dependent identifiers (`integration: a skipped mapper
result (missing sourceProduct) never reaches the real server` and
`integration: persisted execution audits the call and never leaks
masterCustomerId or the API key`) **no longer exist as test names at all**
(replaced, not skipped, by DB-free equivalents) and do not appear anywhere
in either failure set. Zero new failing identifiers attributable to this
task's logic - a stronger result than the pre-correction pass, which still
had 2 task-owned DB-dependent failures.

## Typecheck

`npx tsc --noEmit` - clean.

## Lint

`npm run lint` - 0 errors, 34 pre-existing warnings in unrelated files
(identical set to the develop baseline documented in
`docs/releases/CP-R1-T10B7-catalog-recommendation-capability.md`) - no new
warnings introduced by this task's files, including the T10B6 correction.

## Build

`npm run build` - clean.

## Documentation

- `docs/integrations/catalog-recommendation-gateway-adapter.md` - relations,
  scope, Gateway definition/input/identity/mapping contracts (updated for
  explicit repurchase + `inputSchema`), availability, governance, security,
  concurrency, Agent Loop visibility, explicitly out-of-scope (updated -
  explicit repurchase removed from the out-of-scope list, now supported).
- This document - adds "Correction (review pass)", "Explicit repurchase
  audit", "Chosen repurchase solution", "Integration DB isolation",
  "Persistence fake", and an expanded "Production instance" singleton audit.

## Risks

- The T10B6 correction (`explicitRepurchaseRequested` top-level field) is a
  cross-task change reported here per this correction task's explicit
  instruction, not silently applied. It is additive and backward-compatible
  (existing `recommendationContext`-only callers are unaffected - the merge
  is an OR, never a mismatch/breaking check) and covered by 11 new T10B6
  unit tests plus this task's own end-to-end integration tests, but it does
  widen T10B6's public contract - any future consumer of
  `BuildSearchProductsV2RequestInput` should be aware a second source for
  this signal now exists.
- No `AbortSignal` exists on `CapabilityGatewayContext` today, so a call
  through this adapter cannot be cancelled mid-flight - bounded only by
  T10B5's own internal timeout. Documented, not addressed (would require a
  Gateway-wide contract change, out of scope for a single capability
  adapter).
- `createProductionCatalogRecommendationCapability()`'s own non-memoization
  (T10B7's documented risk) is resolved for the Gateway's own runtime path
  by this task's singleton - but any other future caller that invokes the
  factory directly (bypassing `getSharedCatalogRecommendationCapability()`)
  would still reconstruct a fresh instance per call, exactly as T10B7 itself
  already warned.
- `executeWithFakePersistence` (test-only) is a manually maintained mirror of
  `executeGovernedCapability`'s orchestration - if that production function's
  logic changes in the future, this test helper must be updated to match, or
  it will silently stop reflecting real Gateway behavior. This is an
  accepted, documented maintenance cost of avoiding a production DI seam
  that this task's own instructions explicitly forbade adding.

## Next task

`CP-R1-T10B8C` - Recommendation Tool Exposure and Observation.

## Confirmaciones

- No se hizo commit.
- No se hizo push.
- No se creo PR.
- No se acepta y descarta `explicitRepurchaseRequested` - se reenvia y se
  prueba en ambos modos.
- No se depende de MariaDB en los tests nuevos (0 de 20 tests de
  integracion requieren DB).
- No se llamo Customer Profile directamente.
- No se agrego la tool al Agent Loop.
- No se modifico `AGENT_LOOP_TOOL_POOL`.
- No se modificaron prompts.
- No se modifico `buildToolObservation`.
- No se modifico `recentCatalogContext`.
- No se modifico `pendingCatalogAction`.
- No se llamo `get_product_details`.
- No se resolvio `sourceProduct` desde texto.
- No se uso `identity.customerId` como `masterCustomerId`.
- No se bloqueo por `identity_unresolved`.
- No se modificaron T10B5/T10B7/T10B8A. **T10B6 si se modifico** (cambio
  minimo, aditivo, reportado explicitamente arriba - no silencioso), unica
  excepcion explicitamente permitida por esta tarea de correccion.
- No se modifico Catalog Service ni Customer Profile.

---
title: CP-R1-T10B6 - Identity and Recommendation Context Wiring
doc_id: cp-r1-t10b6-identity-recommendation-context-wiring
status: implemented_not_wired
tags:
  - release
  - catalog
  - recommendations
  - integration
---

# CP-R1-T10B6 - Identity and Recommendation Context Wiring

Branch: `feat/cp-r1-t10b6-identity-recommendation-context-wiring`, base
`develop` (contains the CP-R1-T10B5 merge, PR #77 / `b6947d8`). No commit,
push or PR was made for this task.

**Post-implementation correction (same branch, still no commit):** the
initial implementation let `recommendationContext`'s own `masterCustomerId`/
`recommendationIntent.sourceProduct` silently win over the matching
top-level input fields whenever both were present, without ever comparing
them. This correction removes that silent precedence: when both sources are
present, each is normalized independently and compared - a disagreement now
produces `status: "skipped"` (`customer_identity_mismatch`/
`source_product_mismatch`), never a silent choice. See "Fuentes duplicadas"
below (this document's "Customer identity"/"Source product" sections) and
the identically-renamed section in the integration doc for the corrected
behavior - no remaining claim that "precedence makes a mismatch
impossible" survives anywhere in either document.

## Purpose

Build a deterministic, pure mapper that turns an already-resolved
`masterCustomerId` + source product + `CustomerRecommendationContext`
(CP-R1-T10B2) into a valid `SearchProductsV2ClientRequest` + call context
(CP-R1-T10B5). This closes the gap between the CRM's commercial context and
the external Catalog Service contract, without yet calling the endpoint,
without a capability, and without touching the Agent Loop.

## Architecture

- **Customer Profile**: keeps real purchase history and ownership; not
  queried directly by this mapper (it only reads the already-built
  `CustomerRecommendationContext`).
- **Catalog Service**: receives `masterCustomerId` as an opaque
  `customerId`, generates recommendations, computes ranking, attaches
  ownership, applies exclusions/preferences/repurchase, exposes warnings/
  personalization/execution metadata - none of this is recomputed here.
- **CRM** (this task): resolves identity, knows the current intent, builds
  the request - never recalculates score, never recalculates ownership,
  never infers historical affinity, never invents an identity.
- **Sales Agent**: will consume the future capability later
  (`CP-R1-T10B7`/`T10B8`) - not touched here.

Duplicated-source rule (see "Customer identity"/"Source product" below for
the full detail): `masterCustomerId` and `sourceProduct` can each be
supplied both as a top-level input field and inside `recommendationContext`.
The top-level fields exist specifically for when no context could be built
at all (Customer Profile fully unavailable) but identity/source product are
still known from elsewhere in the same turn. When only one source is
present, it is used as-is. When both are present, each is normalized
independently and then compared: agreement uses the normalized value;
disagreement produces `status: "skipped"` - the mapper never silently picks
one over the other.

## Auditoria previa

Read directly, no name/route assumed without confirmation:

- `lib/brain/commercial/recommendation-context/types.ts` /
  `buildCustomerRecommendationContext.ts` (CP-R1-T10B2) - full re-read of
  `CustomerRecommendationContext`, `ProductReference` (`{productId: number;
  combinationId?: number}`), the `recommendationIntent` shape, and the
  internal `validateProductReference`/dedup conventions this task's own
  helper mirrors (but does not reuse - different output semantics, see
  "Product identity" below). Confirmed via `tests/recommendation-context/
  buildCustomerRecommendationContext.test.ts` fixtures that Customer
  Profile's own data genuinely uses `productAttributeId: 0` as its "base
  product, no variant" convention - directly relevant to the
  `combinationId===0` normalization rule below.
- `lib/catalog/search-products-v2/types.ts` /
  `httpCatalogSearchProductsV2Client.ts` (CP-R1-T10B5) - re-confirmed exact
  export names (`SearchProductsV2ClientRequest`,
  `SearchProductsV2ProductIdentity`, `SearchProductsV2RequestContext`,
  `SearchProductsV2ClientCallContext`) and the real request-shape rules
  (`customer`/`context.customerId` must match, `explicitRepurchaseProducts`
  must not overlap `excludedProducts`, `filters.productIds` unsupported)
  that this mapper's output must already satisfy.
- `masterCustomerId` flow across the CRM runtime: confirmed the lowercase
  `masterCustomerId` field name is scoped specifically to the Customer
  Profile port / `CustomerRecommendationContext` (CP-R1-T10B1/T10B2) - a
  different, capitalized `customerMasterId` identifier is used elsewhere
  (`lib/domains/customer-service`, `lib/customer-identity`,
  `lib/brain/commercial/*`) and is never conflated with it here. Confirmed
  no other module resolves `masterCustomerId` (lowercase) independently -
  `buildCustomerRecommendationContext.ts` remains its only producer/consumer
  today. The native WhatsApp per-turn pipeline resolves a fresh identity at
  `ResolvedNativeCustomerSession.execution.identity.customerId` (nullable) -
  a future wiring task, not this one, is responsible for translating that
  into this mapper's `masterCustomerId` input field.
- `correlationId` conventions: confirmed there is no shared generator/UUID
  helper for correlation ids in this repo - the native WhatsApp pipeline
  computes one once per turn
  (`lib/brain/native-whatsapp/service.ts#processNativeWhatsAppInbound`) and
  threads it through every downstream call as a plain `string`. This mapper
  never generates one, matching that convention - it only accepts, validates
  and forwards whatever the caller supplies.
- Agent Loop / Capability Gateway / `recentCatalogContext` /
  `pendingCatalogAction` / `AGENT_LOOP_TOOL_POOL`: grepped for any reference
  to the new files or to `SearchProductsV2`/`buildSearchProductsV2Request` -
  zero matches outside this task's own module, confirming no accidental
  wiring.

## Input contract

`BuildSearchProductsV2RequestInput`
(`lib/brain/commercial/recommendation-context/searchProductsV2RequestTypes.ts`):

```ts
type BuildSearchProductsV2RequestInput = {
  masterCustomerId?: string | null;
  sourceProduct?: ProductReference | null;
  recommendationContext?: CustomerRecommendationContext | null;
  query?: string | null;
  explicitExcludedProducts?: readonly ProductReference[];
  correlationId?: string | null;
  limit?: number;
  inStockOnly?: boolean;
};
```

There is deliberately no top-level `explicitRepurchaseRequested` flag - that
signal only exists inside a built `recommendationContext`
(`recommendationIntent.explicitRepurchaseRequested`), since it has no
meaning independent of a resolved commercial context.

## Result contract

```ts
type BuildSearchProductsV2RequestResult =
  | {
      status: "ready";
      request: SearchProductsV2ClientRequest;
      callContext: { correlationId?: string };
      metadata: {
        customerMode: "identified" | "generic";
        explicitRepurchaseApplied: boolean;
        excludedProductCount: number;
      };
    }
  | {
      status: "skipped";
      reason:
        | "source_product_missing"
        | "source_product_invalid"
        | "source_product_mismatch"
        | "invalid_customer_identity"
        | "customer_identity_mismatch"
        | "contradictory_product_context"
        | "invalid_excluded_product"
        | "invalid_query"
        | "invalid_correlation_id"
        | "invalid_limit";
    };
```

Adjusted from the task brief's conceptual list: `source_product_ambiguous`
was **not** implemented - this mapper's input is always a single, already-
resolved `ProductReference | null`, never a candidate set, so it has no way
to detect or produce "ambiguous" (ambiguity resolution is explicitly out of
scope, upstream of this mapper). `invalid_excluded_product`, `invalid_limit`,
`customer_identity_mismatch` and `source_product_mismatch` were **added** -
the first two in the original implementation (not present in the brief's
illustrative list, but required by its own explicit fail-closed preference
for malformed exclusions and by its own explicit test requirements for
out-of-range `limit`); the mismatch pair in this post-implementation
correction, per an explicit follow-up instruction to remove the silent
precedence between duplicated identity sources. `customer_identity_mismatch`/
`source_product_mismatch` are deliberately distinct from
`contradictory_product_context`: the latter represents a contradiction
between an exclusion and an explicit repurchase signal, never between two
duplicated identity sources. Never throws for any of these expected,
structured conditions - only a genuine programming error (e.g. a
`TypeError` from malformed JS at the call site) would ever throw, and this
mapper does not introduce any new throw path beyond what TypeScript itself
would already catch at compile time for a well-typed caller.

## Customer identity

`masterCustomerId` can be supplied both as the top-level
`input.masterCustomerId` and inside `recommendationContext.masterCustomerId`
(a required field there). `resolveCustomerIdentity()` resolves the two
sources:

- **neither present** -> generic mode (`masterCustomerId: undefined`);
- **only one present** -> used as-is, validated normally;
- **both present** -> each normalized independently first (see below); if
  either fails normalization -> `status: "skipped"`,
  `reason: "invalid_customer_identity"` (checked before any comparison); if
  both are valid but normalize to **different** strings -> `status:
  "skipped"`, `reason: "customer_identity_mismatch"` - neither value is
  silently preferred; if both normalize to the **same** string -> that
  value is used.

Normalization: `/^[0-9]{1,20}$/` (matches CP-R1-T10B1's exact bound) plus an
explicit all-zeros rejection (`"0"`, `"00"`, ...) that the bare regex alone
would not catch. Trimmed before validation - a deliberate, documented
divergence from CP-R1-T10B1's HTTP adapter (which validates the *untrimmed*
string against the same pattern, rejecting whitespace outright): this
task's own brief explicitly lists "trim" as the first rule for this layer,
and this mapper sits one layer above the wire boundary T10B1 validates, so
a slightly more lenient trim here is reasonable and was explicitly
requested. Leading zeros are preserved verbatim, never stripped (no
evidence in this repo that real `masterCustomerId` values are
leading-zero-free - preserving is the safe default, per the task's own "no
eliminar leading zeros sin una decision explicita").

A legitimately absent identity (`status: "ready"`,
`metadata.customerMode: "generic"`) is never conflated with an invalid one
(`status: "skipped"`) or a mismatched one - three distinct conditions, three
distinct outcomes. Never resolved by email/phone/DNI/name/conversation text
- this mapper only ever reads the `masterCustomerId` string(s) it is given.

## Product identity

`toSearchProductsV2ProductIdentity` (exported) is the single conversion
point for every product identity this mapper touches - source product, each
exclusion, the repurchase entry. `productId` must be a positive, finite
integer (`0`/negative/decimal/`NaN`/`Infinity` all rejected).
`combinationId`: `undefined`/`null`/`0` all normalize to "omitted" (base
product); a positive finite integer becomes `String(combinationId)`;
negative/decimal/non-finite is rejected. `combinationId: "0"` as a literal
string is never produced - Customer Profile's own `productAttributeId: 0`
convention (confirmed real via CP-R1-T10B2's own test fixtures) means a
naive `String(combinationId)` without this normalization would have
produced exactly that bug.

## Source product

Required for `status: "ready"`. Same duplicated-source rule as customer
identity, applied via `resolveSourceProductIdentity()`:

- **neither present** -> `status: "skipped"`, `reason:
  "source_product_missing"`;
- **only one present** -> used as-is, validated normally;
- **both present** -> each converted independently via
  `toSearchProductsV2ProductIdentity` first; if either conversion fails
  -> `status: "skipped"`, `reason: "source_product_invalid"` (checked
  before any comparison); compared by the converted identity's exact
  runtime key (`productId` + optional `combinationId`, with
  `combinationId: 0` already normalized to "absent" by the conversion
  step - a base product and its own variant are always distinct); a
  mismatch -> `status: "skipped"`, `reason: "source_product_mismatch"` -
  neither is silently preferred; agreement -> that identity is used.

This mapper never searches for a product, never resolves ambiguity, and
never substitutes `matchingPurchases` (historical evidence) for an
explicitly missing source product - a customer's purchase history is never
treated as "the product they mean now."

## Query

Trimmed once. Empty after trim -> omitted (not an error - the input never
declares query as mandatory). `>240` characters after trim -> `skipped`/
`invalid_query`. Case, accents, units and internal whitespace are never
touched (`"20 kg"` stays `"20 kg"`, never `"20kg"`) - that normalization
belongs to Catalog Service, confirmed explicitly out of scope by the task
brief.

## Explicit repurchase

v1-frozen rule: `explicitRepurchaseRequested=true` + a valid source product
-> `context.explicitRepurchaseProducts = [sourceProductIdentity]`, always
exactly the source product's own identity, never derived from ownership,
`matchingPurchases`, or repeated-purchase behavior (all three verified by
dedicated tests using a context whose `sourceProductHistory`/
`purchaseHistory` carry rich historical data that must have zero effect on
this signal). `false` -> `explicitRepurchaseProducts` omitted entirely.

## Preferred products

Deliberately omitted in v1 - `CustomerRecommendationContext` has no
"preferred products" concept (only source product, exclusions, and
purchase/repeat-behavior evidence), and this task does not invent one from
`matchingPurchases`, repeat behavior, ownership, RFM, or segments. Verified
by a dedicated test using a context with rich `matchingPurchases`/
`repeatedProducts` data that confirms `context.preferredProducts` is never
present in the output.

## Exclusions

Union of `recommendationContext?.recommendationIntent.explicitExcludedProducts`
and the top-level `input.explicitExcludedProducts` (both are legitimate,
independent sources per the task brief - context items first, then
top-level ones). Each entry normalized through the same product-identity
helper; deduplicated by the *converted* identity (so `{productId:5,
combinationId:0}` and `{productId:5}` collapse into one entry - both mean
"the base product"), preserving first-appearance order. A single
structurally invalid entry fails the entire mapper closed
(`invalid_excluded_product`) rather than silently sending a partial list -
the task brief's own explicit preference, since a partial exclusion list
would silently change commercial intent.

## Validation order

Deterministic order, documented directly above
`buildSearchProductsV2Request()`:

1. normalize/validate customer identity (both sources, if both present);
2. detect `customer_identity_mismatch`;
3. normalize/validate source product identity (both sources, if both
   present);
4. detect `source_product_mismatch`;
5. validate `query`;
6. validate `correlationId`;
7. validate `limit`/`inStockOnly`;
8. process exclusions (merge + normalize + dedupe);
9. detect the exclusion-vs-explicit-repurchase contradiction;
10. build the request.

A customer identity mismatch is therefore always detected before the
product-exclusion contradiction check ever runs - confirmed by a dedicated
test that constructs an input where both conditions would apply
simultaneously and asserts `customer_identity_mismatch` wins.

## Contradictions

The only contradiction detected: the source product (the repurchase target)
is also present in the exclusion list, while `explicitRepurchaseRequested`
is `true` -> `skipped`/`contradictory_product_context`. Evaluated by exact
runtime identity - confirmed by dedicated tests that excluding the base
product while repurchasing a different variant (or vice versa) is **not** a
contradiction, since a product base and a specific variant are distinct
identities (the task brief's own explicit "politica recomendada").
Duplicate exclusions are silently deduplicated (never an error after
dedup). This reason is distinct from `customer_identity_mismatch`/
`source_product_mismatch`: it represents a contradiction between an
exclusion and an explicit repurchase signal, never between two duplicated
identity sources (see "Validation order" above and "New skipped reasons").

## Correlation ID

Delivered exclusively via `callContext.correlationId` (mapped by the future
caller into the `x-correlation-id` header, exactly as CP-R1-T10B5's client
already expects) - never placed in the request body. Validated: trim,
length 1-128, `^[A-Za-z0-9._:-]+$` (identical bound to the real Catalog
Service contract). Absent -> omitted from `callContext` (T10B5/Catalog
Service may generate one). Present but invalid -> `skipped`/
`invalid_correlation_id`. This mapper never generates a correlation id
itself - no central generator exists in this repo to reuse (see "Auditoria
previa").

## Limit and filters

`limit`: integer 1-20, omitted (never defaulted) when unspecified, rejected
(`invalid_limit`) when out of range or non-integer - closing a gap the task
brief's illustrative reason list did not name but its own test requirements
(section 24) explicitly required. `inStockOnly`: passed through verbatim
when defined, omitted otherwise - never defaulted to `true` without an
approved commercial policy. `filters.productIds` is never added (schema-legal
upstream, rejected at runtime by the real service - same rule CP-R1-T10B5
already established).

## Immutability

Pure function: no fetch, no SQL, no `Date.now`, no random, no env, no logs.
Never mutates `input`, `recommendationContext`, `sourceProduct`, or any
exclusion array - every output array/object is freshly constructed via
spread/map, never a reference into an input array. Verified by dedicated
tests: mutating the input (including its arrays) after the call never
changes an already-returned result; mutating the returned request's
`excludedProducts` array never changes the input; the output array is
confirmed to be a different array reference than the input array
(`assert.notEqual`).

## T10B5 compatibility

`tests/recommendation-context/buildSearchProductsV2RequestT10B5Compatibility.test.ts`
feeds real requests built by this mapper into the real CP-R1-T10B5 HTTP
client (`createHttpCatalogSearchProductsV2Client`) against a real local
`node:http` server - never a re-implementation of T10B5's own parser/
validator. Confirms: a generic request is accepted (never rejected as
`invalid_request` by T10B5's own client-side validation); an identified
request's `customer`/`context.customerId` are coherent and accepted;
exclusions and explicit repurchase serialize and are accepted; the
correlation id from `callContext` arrives as the `x-correlation-id` header
and never inside the body.

## T10B2 regression

`tests/recommendation-context/buildCustomerRecommendationContext.test.ts`
run unchanged: 58/58 passing, identical to before this task. Confirms
`CustomerRecommendationContext`'s existing behavior is untouched:
`matchingPurchases` remains purely informational, ownership is never
reinterpreted, `explicitRepurchaseRequested` keeps its existing semantics
(a signal this task consumes, never redefines), and no automatic preference
was introduced into that module.

## Targeted tests

- `tests/recommendation-context/buildSearchProductsV2Request.test.ts` - 116
  tests (101 from the original implementation + 15 added by this
  correction): the product-identity helper (base/variant/`combinationId=0`/
  all rejection cases/no input mutation); source product (valid base, valid
  variant, missing, 6 invalid-identity cases, no mutation; **agreement**
  cases - same base, top-level `combinationId=0` vs. context base, same
  variant; **mismatch** cases - different products, base-vs-variant,
  different variants, one-invalid-one-valid in both directions, no request
  built and no input mutated on mismatch); customer identity (valid, trim,
  generic mode, leading zeros preserved, 9 invalid-value cases;
  **agreement** cases - same id, same id after trim; **mismatch** cases -
  different ids, one-invalid-one-valid in both directions, no request built
  and no input mutated on mismatch); query (trim, omit empty/undefined, 240
  accepted, 241 rejected, internal whitespace and units preserved, no
  mutation); explicit repurchase (false omitted, base target, variant
  target, ownership/`matchingPurchases`/repeat-behavior never activate it -
  unaffected by this correction); preferred products (never populated -
  unaffected); exclusions (base, variant, exact dedup, base-vs-variant
  never deduped together, `combinationId=0` normalization, invalid entry
  fails closed, order preserved, context+top-level merge, no mutation -
  unaffected); contradictions (source excluded + repurchase true,
  exact-variant exclusion + repurchase, base-excluded/variant-repurchase
  and variant-excluded/base-repurchase both confirmed non-contradictory,
  duplicate exclusions never error, **a customer identity mismatch is
  caught before the exclusion-vs-repurchase contradiction check ever runs**
  - validation-order proof); correlation (valid, trim, absent, empty,
  `>128`, invalid characters, never in body - unaffected); limit/filters
  (valid, `0`, `21`, decimal, omitted-not-defaulted, `inStockOnly`
  true/false/undefined, `filters.productIds` never present - unaffected);
  result (`ready` shape, all 10 `skipped` reasons including the two new
  mismatch reasons, `customerMode`, `explicitRepurchaseApplied`,
  `excludedProductCount`); immutability (post-call input mutation never
  changes an already-returned result, post-call result mutation never
  changes the input, fresh array references).
- `tests/recommendation-context/buildSearchProductsV2RequestT10B5Compatibility.test.ts` -
  5 tests, real local `node:http` server, real T10B5 client, no fetch mock
  - unaffected by this correction (none of its scenarios involve duplicated
  sources).

Run twice consecutively - 179/179 (116+5+58, including the T10B2 regression
suite) passing both times, no flakiness observed, 0 `only`/`skip`/`todo`.

## Full-suite baseline

`npm test` (full suite, `tests/**/*.test.ts`, 2229 tests after this
correction) run as evidence only, per this repo's documented full-suite
flakiness: 1756 pass, 473 fail. Verified rigorously, not just by count: the
473 failing tests' exact `file:line:col` identifiers were diffed against
the same clean `develop` worktree baseline captured during CP-R1-T10B5's
closure audit - zero differences, and the `ECONNREFUSED`/`ERR_ASSERTION`/
`TypeError` distribution (606/390/8) is identical too.
`1741 (pre-correction) + 15 = 1756` exact (this correction added 15 net new
tests to `buildSearchProductsV2Request.test.ts`: 3 stale precedence-based
tests were replaced with 18 new ones covering agreement/mismatch/invalid
combinations). All 473 are pre-existing DB-dependent tests (`connect
ECONNREFUSED 127.0.0.1:3306`) requiring a local MariaDB instance not
running in this environment - unrelated to this change.

## Typecheck

`npx tsc --noEmit` - clean.

## Lint

`npm run lint` - 0 errors, 34 pre-existing warnings in unrelated files
(identical set to before this task).

## Build

`npm run build` - clean.

## Documentation

- `docs/integrations/search-products-v2-request-wiring.md` - full field
  mapping table, duplicated-source compatibility rule (agree-or-skip),
  validation order, product-identity normalization, generic mode,
  contradictions, security - updated by this correction.
- This document.

## Risks

- **Resolved by this correction**: the original implementation let
  `recommendationContext`'s own `masterCustomerId`/
  `recommendationIntent.sourceProduct` silently win over the matching
  top-level input fields whenever both were present, without comparing
  them - a caller passing contradictory values would never have been told.
  This is no longer the behavior: both sources are now compared after
  normalization, and a disagreement produces a structured `skipped` result.
  Kept here as a record of the correction, not as an open risk.
- `invalid_excluded_product`, `invalid_limit`, `customer_identity_mismatch`
  and `source_product_mismatch` are all additions beyond the original task
  brief's illustrative `reason` list - justified above ("Result contract"),
  but a future task reconciling the reason taxonomy across CP-R1-T10Bx
  should be aware these were added here.
- No wiring exists yet to populate `masterCustomerId`/`sourceProduct`/
  `correlationId` from the real native WhatsApp turn
  (`ResolvedNativeCustomerSession.execution.identity.customerId`, the
  turn's `correlationId`) - that translation is explicitly deferred to a
  future capability task (`CP-R1-T10B7`), not implemented here.

## Next task

`CP-R1-T10B7` - Catalog Recommendation Capability.

## Confirmaciones

- No commit fue hecho.
- No push fue hecho.
- No PR fue creado.
- Catalog Service no fue llamado (solo un servidor `node:http` local en
  tests).
- `master_customer` no fue consultado.
- Identidad no fue resuelta por PII (email/telefono/DNI/nombre).
- `CustomerRecommendationContext`/`buildCustomerRecommendationContext` no
  fueron modificados - solo leidos.
- El Agent Loop no fue conectado.
- Ninguna capability fue creada.
- Catalog Service y Customer Profile no fueron modificados.
- No se implemento la normalizacion "20 kg" -> "20kg".
- No se implemento RFM ni clustering.

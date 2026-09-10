# SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B4 - search_products_by_semantics integration

**Verdict:** `TR_B4_IMPLEMENTED_MODEL_BENCHMARK_PENDING`

**Mode:** IMPLEMENTATION

**Depends on:** `SALES-AGENT-R3-CAPABILITY-SEMANTICS-TOOL-REQUEST-A0` (audit) and `SALES-AGENT-R3-CAPABILITY-SEMANTICS-TR-B1-B2` (generic foundation: `evidenceProduced`/`evidenceRequired`/`useWhen`/`doNotUseWhen`/`operationSemantics` on `CapabilityGatewayDefinition`, `resolveCapabilitiesProducingEvidence`).

## 0. Pre-flight - upstream verification

`A0` had left `TR-B4` blocked pending confirmation that `search_products_by_semantics` actually exists upstream. It does, complete, in `mistergoliat/MS-pesaschile-catalog-service`:

- `POST /v1/products/semantic-discovery/query` (`src/interfaces/http/routes/semanticDiscoveryQueryRoute.ts`, `src/application/catalog/semantic-discovery/{contracts,defaultSemanticDiscoveryService}.ts`)
- `GET /v1/products/semantics/registry`, `GET /v1/products/training-semantics/registry` (`client/catalogClient.ts`)
- Auth: `x-api-key` + `x-correlation-id` - identical to every other endpoint this CRM already calls.
- The 8 expected axes match exactly: `PRODUCT_FAMILY`/`DISCIPLINE`/`USE_CONTEXT` (product), `EXERCISE_CAPABILITY`/`TRAINING_FUNCTION`/`BODY_REGION`/`MUSCLE_GROUP`/`TRAINING_PATTERN` (training).
- Error vocabulary confirmed from `src/shared/errors.ts`: `INVALID_SEMANTIC_DISCOVERY_REQUEST` (400), `PRODUCT_SEMANTICS_UNAVAILABLE`/`TRAINING_SEMANTICS_UNAVAILABLE` (503), `*_SNAPSHOT_MISMATCH` (409, only when a request carries `expectedSnapshots`).
- Upstream itself already validates codes against its own registry server-side (`defaultSemanticDiscoveryService.ts#validateRequest`) and already ships a porcelain client (`client/semanticDiscoveryCapability.ts`) that pre-validates codes against a cached registry before calling the server - this CRM implementation follows the same client-side-validation shape, independently, for its own boundary (never imports that client - ADR-005: ported, not depended on cross-repo).

Not blocked. Continued in the same task.

## 1. Catalog Port

`lib/catalog/types.ts` gained the semantic-discovery domain types (axes, requirement/result/lineage shapes, compact registry projections) and three new **optional** `CatalogPort` methods - same additive discipline as `getProductSemantics?`, so no existing `CatalogPort` test double breaks:

- `querySemanticDiscovery?(input, context)`
- `getProductSemanticsRegistry?(context)`
- `getTrainingSemanticsRegistry?(context)`

`lib/catalog/httpCatalogAdapter.ts` implements all three, reusing `CATALOG_SERVICE_BASE_URL`/`CATALOG_SERVICE_API_KEY`/`CATALOG_SERVICE_TIMEOUT_MS` and the existing `x-api-key`/`x-correlation-id` headers. `querySemanticDiscovery` sends `{schemaVersion:1, requirements, options:{limit}}` - it **never sends `expectedSnapshots`** (no cross-call snapshot pinning in this adapter; the upstream field is optional and this CRM never pins). The semantic-discovery/registry UPPER_SNAKE error vocabulary is mapped into the existing generic `CatalogPortErrorCode` enum (`invalid_input`/`unauthorized`/`unavailable`/etc.) - no new port-level error codes were needed.

## 2. CRM DTO / validation boundary

Request shape at the boundary (`lib/brain/commercial/capability-gateway/searchProductsBySemanticsCapability.ts`):

```
{ requirements: [{ axis, codes, mode: "required"|"preferred", match: "any"|"all" }], limit? }
```

`relations` (an upstream-optional `DIRECT`/`SUPPORTED`/`FAMILY_DERIVED` refinement for training axes) is deliberately **not exposed** - nothing in this task's boundary needs it, so it is never sent upstream. This is the one scope simplification made beyond what the task spec enumerated; it can be added later as a pure addition if a real need appears.

Output preserves `productId`, `matchedRequirements`, compact `productSemantics`/`trainingSemantics`, `totalMatches`, `truncated`, and a domain `outcome`.

## 3. Outcome mapping

| Domain outcome | Gateway status | errorCode |
| --- | --- | --- |
| `matched` | `completed` | - |
| `no_match` | `completed` | - |
| `invalid_argument` | `invalid_arguments` | `invalid_argument` |
| `invalid_code` | `invalid_arguments` | `invalid_code` (+ `data.invalidRequirements`) |
| `registry_mismatch` | `temporarily_blocked` (retryable) | `registry_mismatch` |
| technical failure | generic mapping from `CatalogPortError` | port error code (`timeout`/`unavailable`/`unauthorized`/...) |

`NO_MATCH` is `results: []`, `totalMatches: 0`, Gateway `status: "completed"` - it never becomes `failed`/`temporarily_blocked`.

`registry_mismatch` fires when the two registries cannot be fetched/parsed into the expected shape (transport failure, malformed payload, or a missing expected axis) - conceptually the same "registry sync failure" category the upstream's own porcelain client already uses internally, given a CRM-local name. It is distinct from a technical failure of the query call itself.

Invalid/stale codes fail closed: `validateCodesAgainstRegistry` never silently drops, relaxes, remaps, or converts `required` to `preferred`. It returns exactly the axis + the specific bad codes for that axis.

## 4. Capability registration

Registered in `CAPABILITY_GATEWAY_REGISTRY` (`registry.ts`) as `search_products_by_semantics`:

- `governance: { sideEffect: "read_only", authority: "autonomous", riskClass: "low" }`
- Added to `AGENT_LOOP_TOOL_POOL` (`runAgentToolLoop.ts`) and classified `READ_TOOL` in `AGENT_CAPABILITY_EXPOSURE_CLASSIFICATION` (`agent-capability-exposure/types.ts`) - both through the existing allowlist mechanisms, no capability-specific branch added to `runAgentToolLoop.ts`/`processUseToolStep`.

## 5. Capability semantics

```
useWhen: "Use when the customer expresses a functional, training, exercise, body-region, discipline,
use-context, or similar semantic requirement without sufficiently identifying a concrete catalog product."

doNotUseWhen: "Do not use only to retrieve current price, stock, variants, or link for an already
identified product - use get_product_details for that. Do not replace nominal product resolution
(search_products) when the customer already names a concrete product."

evidenceProduced: ["PRODUCT_IDENTITY", "SEMANTIC_ELIGIBILITY"]
```

No `evidenceRequired`. These render through `TR-B2`'s existing generic tool-line renderer - no new prompt code was needed.

## 6. Canonical vocabulary

Catalog remains authoritative. CRM caches a compact, per-process, lazily-loaded projection of the two registries (`resetSearchProductsBySemanticsRegistryForTests()` clears it for tests) - product axis values keep `code`/`label`(`labelEs`)/`description`(`definition`)/`residual`; training axis values keep codes only (the upstream registry has no per-code label/definition for those axes). Registry `version`/`hash` fields are read but not currently surfaced to the model beyond drift detection inside the capability itself - no `CapabilityVocabularyProvider` abstraction was introduced (task explicitly asked not to).

## 7. Planner context

Nothing new was added to the dynamic runtime context. The trusted vocabulary reaches the model exclusively through the existing `inputSchema`/`useWhen`/`doNotUseWhen` rendering path (`buildToolDescriptions()` -> `buildAgentStepPromptPackage.ts`) - the raw canonical codes themselves are not currently projected into the prompt as a standalone vocabulary block; the model must rely on the axis enum plus the tool description, and on `invalid_code` observations (which name the specific bad codes) to self-correct. No `semanticIntent`/`activeSemanticRequirements`/`currentSemanticGoal` persisted anywhere.

## 8. Input validation

Structural validation (`validateStructure`) happens before any registry/HTTP call. Canonical-code validation (`validateCodesAgainstRegistry`) happens after the registry is loaded, before the query is sent. An invalid code returns a typed, repairable observation (see section 9) - never a silent repair.

## 9. Tool observation

`buildToolObservation.ts` gained `projectSearchProductsBySemantics` (matched/no_match, capped at `MAX_SEMANTIC_DISCOVERY_RESULTS = 10`, `truncated` forced `true` if that live cap cuts further than the capability itself already reported) and a dedicated `invalid_code` branch (`projectSearchProductsBySemanticsInvalidCode`) surfacing `{status:"blocked", errorCode:"invalid_code", data:{invalidRequirements}}`.

## 10-11. Product evidence integration / current-product-details boundary

Because the capability declares `evidenceProduced: ["PRODUCT_IDENTITY", "SEMANTIC_ELIGIBILITY"]`, its `productId`s automatically become valid evidence for every consumer that already reads `resolveCapabilitiesProducingEvidence("PRODUCT_IDENTITY")`:

- `resolveObservedRecommendationSourceProduct.ts` (used by both `recommend_catalog_products`' `sourceProduct` gate and `select_products`' per-item evidence gate) - no consumer-specific exclusion was added for this new producer (the anti-recursion exclusion stays scoped to `recommend_catalog_products` by name, unchanged).
- `pendingCatalogAction.ts#collectAllowedProductIds`
- `recentCatalogContext.ts`

Each of these three files still switches on the observation's *payload shape* per tool (they always did, even before `TR-B1/B2`), so one small, additive branch was added to each for `search_products_by_semantics`'s `results[]` shape (distinct from `search_products`'s `items[]`/`explore_catalog`'s `products[]`). No evidence-gate *policy* changed - the gate is still "was this productId observed", generically.

`get_product_details` and `select_products` both accept a `productId` sourced from a semantic-discovery result, verified via `tests/agent-loop/resolveObservedRecommendationSourceProduct.test.ts`'s new cases. Semantic discovery never authorizes `CURRENT_PRODUCT_DETAILS` (price/stock/variants/public link) - those still require a real `get_product_details` call; the capability's `evidenceProduced` list does not include `CURRENT_PRODUCT_DETAILS`, and `AGENT_CAPABILITY_EXPOSURE`/gateway tests assert this.

## 12-13. RecentCatalogContext / PendingCatalogAction

`RecentCatalogContext` accepts a semantic-discovery result as a fifth `sourceTool` - recent observed catalog evidence only, no topic/relevance/superseded state added. `RecentCatalogContextProduct.name` became **optional** (additive) because a semantic-discovery result carries no commercial product name (semantic eligibility only) - every other producer still always sets it. Two legacy call sites that previously assumed `name` was always present were adjusted minimally: `runNativeAgentToolLoopCycle.ts` (`name: product.name ?? null`) and `lib/brain/commercial/multi-intent/requirementResolver.ts` (skips a nameless candidate - that legacy resolver requires a name; it is outside this task's runtime scope but needed to keep compiling).

No semantic `PendingCatalogAction` was created. `collectAllowedProductIds` gained one additive branch so a semantic-discovery result observed this turn can still satisfy an existing `send_product_link` pending action's candidate list, same treatment as `search_products`/`explore_catalog`.

## 14-16. No automatic chaining / search vs. semantic discovery vs. explore

No sequencing logic was added anywhere. `runAgentToolLoop.ts`'s `processUseToolStep` has no `search_products_by_semantics`-specific branch beyond the same evidence-gate wiring every other catalog tool already goes through generically. The four capabilities' boundaries (`search_products` nominal, `search_products_by_semantics` canonical/functional, `get_product_details` current details, `explore_catalog` ranking/filter) are rendered as `description`/`useWhen`/`doNotUseWhen` text for the model to reason over - never `if`/`else` routing in the runtime.

## 17-21. Tests

- `tests/catalog/httpCatalogAdapterSemanticDiscovery.test.ts` (10): endpoint/method/headers/correlation id/canonical request serialization (never sends `expectedSnapshots`), NO_MATCH as `ok:true`, real upstream error codes (`INVALID_SEMANTIC_DISCOVERY_REQUEST`, `TRAINING_SEMANTICS_UNAVAILABLE`), network timeout, malformed response, both registry endpoints (happy path + malformed).
- `tests/commercial/searchProductsBySemanticsCapability.test.ts` (11): `checkAvailability`, governance/evidence metadata, structural `invalid_argument` (three shapes, zero HTTP calls), `invalid_code` (product and training axis), `matched`, `no_match` (still `completed`), `registry_mismatch`, technical failure (timeout), training-axis requirement support, registry caching (fetched once across two calls).
- `tests/agent-loop/buildToolObservation.test.ts` (+5): matched/no_match/cap-and-truncate/invalid_code/technical-failure-fallback projections.
- `tests/agent-loop/resolveObservedRecommendationSourceProduct.test.ts` (+3): cross-turn and same-turn evidence resolution via this new producer, plus a registry-membership assertion proving no anti-recursion-style exclusion was added for it.
- `tests/agent-loop/recentCatalogContext.test.ts`: existing SQL-placeholder-count assertion updated from 4 to 5 tools (expected, non-regressive - the dynamic `IN (...)` list is derived from the registry, not hardcoded).

Gateway/exposure exhaustiveness (`tests/commercial/agentCapabilityExposure.test.ts`) passes unmodified against the new registration - it already fails closed on any capability missing a classification entry.

## 22. Regression

`npx tsc --noEmit` and `npm run lint` (project ESLint CLI) are clean across the full repository. Targeted regression runs (`tests/agent-loop/*`, `tests/commercial/*`, `tests/catalog/*`, `tests/catalog-recommendation/*`) are green except for 4 pre-existing DB-dependent failures in `tests/agent-loop/pendingCatalogAction.test.ts` ("DB: ..." tests) - confirmed to fail identically against a clean `develop` checkout (`git stash`/`git stash pop`) with no local MariaDB available in this environment; unrelated to this task's changes.

No behavioral change to `search_products`, `get_product_details`, `explore_catalog`, `recommend_catalog_products`, `select_products`, or `create_quote` beyond the additive evidence-producer set they already read generically. Turn settlement, live-turn assimilation, open-turn execution, finalization, outbox, dispatch, shipping, Quote Service integration, and customer onboarding were not touched.

## 23. Model-backed acceptance

Not run in this session - no live DeepSeek benchmark infrastructure was available. Verdict is `TR_B4_IMPLEMENTED_MODEL_BENCHMARK_PENDING` per the task's own allowed exit criteria.

## 24. C2

Not implemented. `catalogEvidenceVsSelection`/`catalogDiscoveryFreshness`/`supersededByNewerDiscovery`/`OpenQuestionContinuitySignal` remain deferred, unchanged.

## Files changed

- `lib/catalog/types.ts` - semantic-discovery domain types, 3 new optional `CatalogPort` methods.
- `lib/catalog/httpCatalogAdapter.ts` - real HTTP implementation + parsers + error mapping.
- `lib/brain/commercial/capability-gateway/searchProductsBySemanticsCapability.ts` (new) - the capability itself.
- `lib/brain/commercial/capability-gateway/registry.ts` - registration.
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts` - `AGENT_LOOP_TOOL_POOL` entry.
- `lib/brain/commercial/agent-capability-exposure/types.ts` - `READ_TOOL` classification.
- `lib/brain/commercial/agent-loop/buildToolObservation.ts` - projection + `invalid_code` branch.
- `lib/brain/commercial/agent-loop/recentCatalogContext.ts` - fifth `sourceTool`, optional `name`.
- `lib/brain/commercial/agent-loop/pendingCatalogAction.ts` - additive evidence branch.
- `lib/brain/commercial/agent-loop/resolveObservedRecommendationSourceProduct.ts` - additive live-evidence branch.
- `lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts`, `lib/brain/commercial/multi-intent/requirementResolver.ts` - minimal fixes for `name` becoming optional.
- Tests listed in section 17-21 above.

## Debt / known gaps

- No cross-call snapshot pinning (`expectedSnapshots`) - a registry update mid-session is picked up transparently by the next query, never surfaced as drift to the model. Acceptable: this is a read-only discovery tool, not a transactional one.
- `relations` (training-axis DIRECT/SUPPORTED/FAMILY_DERIVED refinement) is not exposed - add only if a real need appears.
- No live DeepSeek acceptance benchmark run.
- `operational: not_verified` in `CAPABILITY_MATRIX.md` - no smoke test against a deployed Catalog Service was run in this session.

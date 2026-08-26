# SALES-AGENT-R2-ID-R2-A11 - Repeat Purchase / Customer-Aware Commercial Objectives

## Veredicto

`ID_R2_A11_REPEAT_PURCHASE_VALIDATED`

`PRODUCTION_PRESTASHOP_SOURCE: DEPLOYMENT_BLOCKER` (see section 13 - does not block this task's own code verdict, per PARTE 25's own framing, but must be resolved before productive rollout of the complete identity/history flow).

## Baseline

- `docs/releases/SALES-AGENT-R2-ID-R2-A10-customer-profile-consumption.md` - the single safe Customer Profile boundary (`loadCommercialCustomerContext`), LEVEL_3-gated, prestashopCustomerId-only. Reused unchanged here.
- A09's own "Next slice" note and A06/A07/A09's repeated documentation of the exact gap this task closes: *"no live `CommercialObjectiveType` maps to a LEVEL_3 requirement today"* (`customer_profile_history`, Agent Tool Loop-only). Confirmed still true at the start of this task via `tests/commercial/readyToLinkE2E.test.ts`'s own guardrail test - now inverted (section 4).

## 1. Objective semantics

`REPEAT_PURCHASE` (new `CommercialObjectiveType`) represents "the customer wants to repeat something they bought before" - never "load Customer Profile" (Customer Profile is a data source A10 built, not a customer intent). Distinguished from `SELECT_PRODUCTS`/`CHANGE_QUANTITY` (a product named directly, in the customer's own current words) at the semantic-planner layer by a dedicated `repeat_purchase` intent type (section 9), and distinguished from `DISCOVER_PRODUCTS`/`RECOMMEND_PRODUCTS`/`CREATE_QUOTE` structurally (different objective type, different step chain).

Once purchase history resolves to a single product name, `REPEAT_PURCHASE` hands off entirely to the **exact same** catalog-resolution/selection chain `SELECT_PRODUCTS` already uses (section 5) - it never becomes a second, parallel "buy" mechanism. `REPEAT_PURCHASE`'s own, distinct responsibility is exactly one thing: turn purchase history into a `productReference` (a historical fact), nothing more.

## 2. Data audit (PARTE 1)

Confirmed exactly what Customer Profile's purchased-products data can and cannot answer (re-verified against A10's real types, `lib/integrations/customer-profile/types.ts` and the A10 projection `lib/brain/commercial/customer-profile-context/types.ts`):

- `CustomerPurchasedProductsItem`: `productId` (ps_product space, never assumed equal to Catalog's product-id space), `productAttributeId`, `productName`, `productReference` (SKU - **dropped** by A10's own projection step, `buildPurchasedProductsContext`, never carried through to `CustomerProfilePurchasedProductContext`), `totalQuantityPurchased` (lifetime aggregate, never per-order), `orderCount`, `first/lastPurchasedAt`, `totalSpentTaxIncl`, `catalogStatus` (`"linked"|"deleted_or_unavailable"` - PrestaShop-side existence only, never live Catalog Service availability).
- **No order-line-item composition exists anywhere in this contract.** `CustomerProfileResponse.recentOrders`/`CustomerProfileRecentOrderContext` are order **headers** only (no product list). This means "repeat my exact last order" cannot be answered as a literal set - only "here is what you've bought before" (aggregated per product) is answerable. `REPEAT_PURCHASE` is scoped to exactly that, never a fabricated order reconstruction (PARTE 12).
- No SKU/reference ever reaches this boundary, so catalog re-resolution can only ever go through the historical product **name** (section 5), never a direct id/SKU lookup - this is not a shortcut, it is the only path A10's data actually supports, and it happens to be exactly the fail-safe PARTE 9/10 demand (never trust a historical id as still valid).

## 3. Customer Profile boundary reuse (PARTE 6/21)

`lib/brain/commercial/capability-gateway/getCustomerPurchaseHistoryCapability.ts` is the **only** new production code that talks to Customer Profile. Its `execute()` reads identity exclusively from `context.trustedCustomerSession.runtimeIdentity` (never a tool-request argument, never derived from `opportunityId`/`conversationId`) and calls A10's `loadCommercialCustomerContext({runtimeIdentity, historyNeeds: ["REORDER"], requestId})` unchanged - the exact same function the Agent Tool Loop's hidden loader already calls (`runNativeAgentToolLoopCycle.ts`, unmodified by this task). One underlying boundary, two callers, confirmed by grep: `loadCommercialCustomerContext`/`createProductionCustomerProfileCapabilities` have exactly the call sites A10 already had, plus this one new capability.

The capability accepts an injectable `loadContext` parameter (default: the real A10 boundary) - the same dependency-injection pattern `search_products`'s own `getPort()` parameter already uses in this file - purely for testability; production (`registry.ts`) always calls it with zero arguments.

Registered in the Capability Gateway (`registry.ts`), governance `{sideEffect: "read_only", authority: "autonomous", riskClass: "low"}`, **deliberately not aliased** in `toolAliases.ts` - the Sales Agent LLM never calls it directly, matching `batch_get_products`/`recommend_catalog_products`'s existing precedent (PARTE 6: registration and LLM-tool-exposure are separable, confirmed by this codebase's own structure). Only `CommercialWork`'s deterministic executor ever dispatches it, via a `REPEAT_PURCHASE` objective's `LOAD_PURCHASE_HISTORY` step.

`context.trustedCustomerSession` did not previously reach `executeCommercialWork`'s capability-dispatch context at all (no prior capability needed it). `runCommercialWorkInboundCycle.ts` and `settleCommercialWorkProjection.ts` now thread it through explicitly - every other capability still ignores it, unchanged. A real bug was found and fixed while wiring the same-turn identity-resettle path (`runCommercialWorkInboundCycle.ts`'s post-onboarding resettle block): the refreshed `RuntimeIdentityContext` was being applied to the projection gate but **not** to `trustedCustomerSession`, which would have let a `REPEAT_PURCHASE` step that turns READY within that exact same-turn resettle round execute against the **stale**, pre-onboarding identity. Fixed by overriding `trustedCustomerSession.runtimeIdentity` with the freshly-resolved identity for that specific resettle call.

## 4. Identity requirement (PARTE 3)

One line, reusing A06/A07 unchanged: `commercialIdentityGate.ts`'s `COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION.REPEAT_PURCHASE = "customer_profile_history"` (the operation A06 already defined with `MINIMUM_LEVEL LEVEL_3_PRESTASHOP_LINKED`). `applyCommercialIdentityGate` (unmodified) handles everything else generically - no hand-rolled `if (identityLevel === ...)` check exists anywhere in `REPEAT_PURCHASE`'s own projection code. This is the literal fix for the gap A06/A09 both named: `customer_profile_history` now has a real `CommercialObjectiveType` reaching it (confirmed by `tests/commercial/readyToLinkE2E.test.ts`'s own guardrail test, inverted from "not reachable" to "reachable" - see section 12).

## 5. History -> Catalog resolution chain (PARTE 8/9/10)

`applyObjectiveState`'s old inline `SELECT_PRODUCTS`/`CHANGE_QUANTITY` body (`buildCommercialWorkProjection.ts`) and `deriveCommercialWorkSteps.ts`'s matching step-deriving body were extracted, **unchanged in behavior**, into shared functions `resolveProductSelectionState`/`deriveProductSelectionSteps`. `REPEAT_PURCHASE`'s own case (`applyRepeatPurchaseObjectiveState`) is a **prelude**, never a duplicate:

1. No `LOAD_PURCHASE_HISTORY` execution yet -> `READY` (drives the step).
2. Execution completed, 0 products -> `COMPLETED`, terminal, successful "nothing to repeat" (PARTE 13, section 6).
3. Execution completed, 1 product after `productHint` filtering -> sets `inputs.productReference`/`quantity` from the historical match, then calls `resolveProductSelectionState` - from this point on it is running the **identical** code path a fresh `SELECT_PRODUCTS` request already uses: `needsSearch` -> `SEARCH_PRODUCTS` step -> T12 `resolveProductIntent` -> `resolved`/`clarification_required`/`no_match`. A historical product is **never** trusted as still sellable - it is re-validated against the live catalog exactly like any other product reference (PARTE 9/10, tests RPH07/26/27).
4. Execution completed, 2+ products remain after hint filtering -> `WAITING_CUSTOMER` with `REPEAT_PURCHASE_AMBIGUOUS` (new `CommercialMissingRequirement`/`CommercialWorkBlockerCode`, never collapsed into catalog-space `PRODUCT_AMBIGUOUS` - those are a different stage, resolved after a productReference already exists) and the real candidates attached (`inputs.historicalPurchaseCandidates`, new field - never the catalog-space `productCandidates`). No arbitrary choice, ever (PARTE 8, test RPH08).
5. Technical failure -> `WAITING_SYSTEM` (retryable) or `FAILED` (not retryable) - never `WAITING_CUSTOMER`, identity untouched (PARTE 14, tests RPH14/15).

`REPEAT_PURCHASE` was added to the "selection" supersession family (`deriveCommercialObjectives.ts`) - the mechanism that resolves ambiguity disambiguation for free: once the customer names one of the listed historical products, that reply is an ordinary `select_products` intent (parsed by the unmodified planner), producing a fresh `SELECT_PRODUCTS` objective that **supersedes** the waiting `REPEAT_PURCHASE` - never a second, bespoke "pick by ordinal/name from historicalPurchaseCandidates" resolver.

## 6. Quantity semantics (PARTE 11)

`objective.inputs.quantity` resolution order: current-turn explicit quantity (from the `repeat_purchase` intent, if the customer stated one) wins; the historical product's own `totalQuantityPurchased` is used only when the current turn supplied none (`objective.inputs.quantity ?? match.quantity`). Tested explicitly (RPH12, both directions).

## 7. Discontinued product (PARTE 10)

A historical product that Catalog's T12 resolution reports as `no_match` reuses the **existing** `PRODUCT_NOT_FOUND` path unchanged (`"No encontré '{reference}' en el catálogo. ¿Puedes confirmarme el nombre exacto?"`) - never a fabricated selection (RPH10). **Debt, explicit**: PARTE 10's aspirational "puede derivar a Catalog recommendation/alternatives" is **not** built in this task - it would require a second capability call (`explore_catalog`/`recommend_catalog_products`) chained onto a `no_match` outcome, which is exactly the "customer-aware recommendation" PARTE 17 explicitly defers to a future slice. Documented here, not silently dropped.

## 8. Failure / degrade behavior (PARTE 13/14/16)

- No purchase history at all (`PROFILE_NOT_FOUND` or `AVAILABLE` with an empty product list) -> objective `COMPLETED`, never `WAITING_CUSTOMER`, never re-opens onboarding (RPH13). The finalizer (section 10) tells the customer plainly and the conversation moves to ordinary discovery on its own next turn - no automatic `DISCOVER_PRODUCTS` objective is synthesized (none is ever seeded in this codebase today, per the architecture audit - see section 12).
- Customer Profile system failure -> identity is never touched (RuntimeIdentityContext is read-only input here, never mutated) and unrelated objectives in the same work are completely unaffected (RPH15/16, tested with a coexisting `SET_DESTINATION` objective).
- RFM is never read anywhere in this task's code (PARTE 16, confirmed by construction - `historyNeeds: ["REORDER"]` only, `getCustomerPurchaseHistoryCapability.ts` never calls `getRfm`).

## 9. Planner (PARTE 18)

New closed-vocabulary intent `repeat_purchase` (`multi-intent/types.ts`), with an optional `productHint` (customer's own words narrowing which purchase, e.g. "discos" from "los discos que compré antes" - never invented when the customer said something generic). `buildIntentPlannerPromptPackage.ts` gained a dedicated phrase-to-intent example table (`REPEAT_PURCHASE_EXAMPLES`), same format A08.7 already proved fixes prompt-salience gaps for a narrow, easily-confused distinction (repeat_purchase vs. select_products). `parseCommercialIntentPlan.ts`/`requirementResolver.ts`/`semanticIntentAdapter.ts` all gained the matching deterministic branch - `repeat_purchase` always resolves `status: "ready"` with zero requirements at this layer (identity is a `CommercialWork`-level gate, never a semantic-planning-layer requirement).

**Debt, explicit**: phrase-recognition accuracy against a real LLM is unverified in this task (RPH01) - no test in this entire codebase calls a live LLM (every planner test, before and after this task, uses an offline-scripted provider). This is the same limitation every other planner feature here already carries, not a new gap this task introduces.

## 10. Sequencing (PARTE 19)

```
REPEAT_PURCHASE (identity gate, reused)
  -> LOAD_PURCHASE_HISTORY (new step type, read-only, get_customer_purchase_history)
  -> SEARCH_PRODUCTS (existing step type/capability, reused)
  -> SELECT_PRODUCTS (existing step type/capability, reused)
  -> [shipping/quote objectives, entirely unchanged, unaware REPEAT_PURCHASE ever existed]
```

No parallel workflow was created. `buildCommercialWorkFinalizerMessage.ts` gained `REPEAT_PURCHASE` cases in `completedClause` ("Encontré tu compra anterior y dejé registrada ..." / "No encontré compras anteriores registradas para repetir" when items never resolved), `pendingClause` ("estoy revisando tu historial de compras"), and `buildMissingInfoQuestion` (a new `REPEAT_PURCHASE_AMBIGUOUS` branch listing real historical product names, `historicalPurchaseCandidatesList`). Every other missing-requirement branch (`PRODUCT_AMBIGUOUS`, `PRODUCT_NOT_FOUND`, `IDENTITY_EVIDENCE`, etc.) is inherited for free once `resolveProductSelectionState` takes over.

## 11. E2E: onboarding -> LEVEL_3 -> history (PARTE 20)

`tests/commercial/repeatPurchaseE2E.test.ts` runs the fully organic path - real `runCommercialWorkInboundCycle`, real semantic planner (offline-scripted provider, same discipline as every sibling test), real projection, real identity gate, real same-work resume, real Capability Gateway dispatch (a real `crm_capability_executions` row) - against real MariaDB (`crm_test`). This is exactly the reachability A08.1/A09 could not demonstrate for any real objective (their own PSB18-20 proof was explicitly harness-bounded, using a `CREATE_QUOTE`-labeled probe objective since nothing real reached LEVEL_3). Turn 1 (LEVEL_2): `REPEAT_PURCHASE` is `WAITING_CUSTOMER` with an `IDENTITY_REQUIREMENT` blocker, zero `get_customer_purchase_history` dispatches. Turn 2 (LEVEL_3, same work, same `publicId`): the objective is no longer identity-blocked, and a real `get_customer_purchase_history` execution row now exists.

**What this test does not prove**: a successful Customer Profile HTTP round trip - no live Customer Profile service is reachable in this sandbox (`CUSTOMER_PROFILE_ENABLED=false`, the deterministic default), so the real capability call resolves to a real, observable `failed`/`customer_profile_unavailable` execution row - a genuine environmental limitation, not a code defect, and the same class of limitation this codebase already documents for Catalog/Carrier service smoke tests. The full success data-flow (history resolved -> Catalog re-validation -> `SELECT_PRODUCTS` completion) is proven in full, with injected fakes, by `tests/commercial/repeatPurchaseObjective.test.ts` (13 tests) and `tests/commercial/getCustomerPurchaseHistoryCapability.test.ts` (6 tests).

## 12. Privacy (PARTE 15/21/22)

`RepeatPurchaseHistoryResult` (the capability's own output type) carries only `historicalProductId`/`historicalName`/`quantity`/`lastPurchasedAt` per product - never email/phone/address/payment/raw order data/internal identity ids/RFM. Verified by test (`getCustomerPurchaseHistoryCapability.test.ts`: "RPH25... raw commercialHistory never reaches outcome.data"), which is also exactly what gets persisted as `crm_capability_executions.response_summary_json` (no custom `buildResponseSummary` was needed - the capability's own `data` is already minimized, so the Gateway's default persistence behavior is already privacy-safe). No new identity evidence is ever written by this capability (it has zero write imports - `loadCommercialCustomerContext`, `queryRows` reads elsewhere, nothing else).

## 13. Production PrestaShop source gate (PARTE 25)

Audited (not redesigned) A02's `ps_customer`/`ps_orders` candidate readers (`lib/integrations/prestashop-mirror/repository.ts`, `findPrestashopCustomerIdsByEmail`/`findPrestashopCustomerIdsByOrderReference`). Both issue **unqualified** table references (`` FROM `ps_customer` ``/`` FROM `ps_orders` ``, no database prefix) - they read from whatever database the shared connection pool (`@/lib/db`) is currently configured against, via `DB_NAME`/`DATABASE_NAME`. This repo's own `.env` sets `DATABASE_NAME=main_management` (confirmed by direct read of the non-secret variable name), and no reference to a distinct `pesas_productiva` connection exists anywhere in this codebase.

This means the *de facto* current wiring makes `main_management.ps_customer`/`main_management.ps_orders` the production PrestaShop candidate source - exactly the configuration PARTE 25 asks to flag unless it is "an intentionally maintained replica with an explicit contract." No such contract is documented anywhere in this repo. **`PRODUCTION_PRESTASHOP_SOURCE: DEPLOYMENT_BLOCKER`** - this does not block this task's own code verdict (PARTE 25 explicitly separates the two), but must be resolved (confirm with ops whether `main_management` genuinely is/mirrors `pesas_productiva`, or reconfigure the connection) before a productive rollout of the complete LEVEL_3 identity + repeat-purchase flow.

## 14. Tests (PARTE 24)

- `tests/commercial/repeatPurchaseObjective.test.ts` (13 tests) - projection-layer matrix: RPH03/04/18 (identity gate reuse), RPH07/26/27 (history -> real catalog re-resolution, never trusts historical id), RPH08 (ambiguity, no arbitrary choice, `productHint` narrowing), RPH10 (discontinued -> no fabricated selection), RPH12 (quantity override both directions), RPH13 (no history -> completed, no onboarding), RPH14/15/16 (failure semantics, unrelated objective unaffected), RPH21 (no duplicate history step once resolved), plus a supersession test (ambiguity resolution mechanism).
- `tests/commercial/getCustomerPurchaseHistoryCapability.test.ts` (6 tests) - RPH05/06 (prestashopCustomerId forwarding, numeric-collision-safe fixture), RPH25 (no raw payload), registration/tool-alias check, PROFILE_NOT_FOUND/SYSTEM_UNAVAILABLE mapping.
- `tests/commercial/repeatPurchaseE2E.test.ts` (2 tests) - RPH19/20/22 (real onboarding-resume reachability, restart correctness) - see section 11.
- `tests/agent-loop/multi-intent/parseCommercialIntentPlan.test.ts` (+3), `requirementResolver.test.ts` (+1), `tests/commercial/r2SemanticIntentAdapter.test.ts` (+3) - deterministic planner-layer coverage (RPH01's non-LLM half, RPH02's regression guard).
- Two pre-existing tests updated to match this task's own explicit, intended change: `tests/commercial/commercialIdentityRequirement.test.ts` ("catalog integrity" - added a documented capability-name-to-operation override, since `get_customer_purchase_history` is the first CommercialWork capability whose name genuinely differs from its governing operation name) and `tests/commercial/readyToLinkE2E.test.ts` ("PARTE 1" guardrail - inverted from "not reachable" to "reachable", exactly this task's mandate; the file's other, independent decision-layer probe test is untouched).

**Regression**: full `tests/commercial/*` (1999 tests) and `tests/agent-loop/*` (525 tests) suites, plus `tests/agent-loop/multi-intent/*`. All green except pre-existing, confirmed-unrelated flakes (7x the documented `Missing DATABASE_NAME` file-level hook flake; a wall-clock timing assertion and a shared-`crm_test`-scope concurrency assertion, both 100% green on isolated re-run; two follow-up-configuration tests in a domain this task never touched, also 100% green isolated). `npx tsc --noEmit`: clean. `npx eslint` on every touched directory: clean (0 errors, only pre-existing unrelated warnings). `npm run build`: clean.

## 15. Debts (consolidated)

- No automatic "discontinued -> catalog alternatives" suggestion (section 7) - reuses existing `PRODUCT_NOT_FOUND` clarification wording instead.
- No live-LLM phrase-recognition validation (section 9) - same limitation as every planner feature in this codebase.
- E2E proves organic reachability, not a live Customer Profile HTTP success (section 11) - full data-flow success is proven at the unit/capability level only.
- `PRODUCTION_PRESTASHOP_SOURCE: DEPLOYMENT_BLOCKER` (section 13) - infra/ops confirmation needed, not a code defect.
- Customer-aware recommendation (RFM + history + Catalog, PARTE 17) is explicitly out of scope - see next slice.
- Disambiguation-reply resolution for 2+ historical products relies entirely on the customer's next message being classified as an ordinary `select_products` intent by the unmodified planner - no bespoke "pick by ordinal from historicalPurchaseCandidates" mechanism exists (same class of limitation the pre-existing catalog-ambiguity flow already has).

## 16. Next slice

Per PARTE 17/"NEXT SLICE": now that repeat purchase works end-to-end, evaluate **customer-aware recommendations/personalization** (history + RFM + Catalog) as one option, or **ID-R2 omnichannel identity adapters** (Instagram/Facebook) as the other - not both in the same task.

## Criterio de salida - checklist

1. Real repeat-purchase commercial objective exists - section 1/4 (`REPEAT_PURCHASE`). OK
2. Requires LEVEL_3 via A06 - section 4 (`commercialIdentityGate.ts`, one line, reused). OK
3. Below LEVEL_3 activates gating/onboarding - section 4/11 (identical, unmodified A07 mechanism; E2E turn 1). OK
4. LEVEL_3 uses the A10 Customer Profile boundary - section 3 (`loadCommercialCustomerContext`, unchanged). OK
5. Uses prestashopCustomerId - section 3 (`context.trustedCustomerSession.runtimeIdentity.prestashopCustomerId`), tested at the capability layer (RPH05/06) with a numeric-collision fixture. OK
6. History never skips Catalog - section 5 (every resolved productReference passes through the real `search_products`/T12 chain). OK
7. Historical product is re-validated against the current catalog - section 5/7 (RPH07/26/27/10). OK
8. Ambiguity never chooses arbitrarily - section 5 (RPH08, `REPEAT_PURCHASE_AMBIGUOUS`, real candidates only). OK
9. CP failure never destroys identity - section 8 (RuntimeIdentityContext is read-only input, RPH14/15). OK
10. CP failure never disables the public catalog - section 8 (RPH16, unrelated objective unaffected in the same test). OK
11. Same CommercialWork continues after onboarding - section 11 (E2E, same `publicId`). OK
12. No duplicate history step/work - section 5/11 (RPH21; E2E confirms exactly one `crm_commercial_work` row and one capability execution). OK
13. Prompt never leaks PII - section 12 (minimized `RepeatPurchaseHistoryResult`, verified by test). OK
14. Agent Tool Loop and CommercialWork share the same boundary - section 3 (single `loadCommercialCustomerContext` call site count, both consumers). OK
15. Real E2E eliminates the harness artifact for LEVEL_3 consumption - section 11 (organic reachability through the real pipeline, replacing A08.1/A09's `CREATE_QUOTE`-probe harness for this specific proof). OK

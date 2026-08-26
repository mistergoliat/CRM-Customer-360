# SALES-AGENT-R2-A12 - Customer-Aware Recommendations

## Veredicto

`ID_R2_A12_CUSTOMER_AWARE_RECOMMENDATIONS_VALIDATED`

## Baseline

- `docs/releases/SALES-AGENT-R2-ID-R2-A11-repeat-purchase-customer-aware-objectives.md` - the direct template. `REPEAT_PURCHASE`'s own "Next slice" section names this exact task ("customer-aware recommendations, RFM + history + Catalog").
- `docs/releases/SALES-AGENT-R2-ID-R2-A10-customer-profile-consumption.md` - the single safe Customer Profile boundary (`loadCommercialCustomerContext`), reused unchanged.
- A separate, older track (CP-R1: `CustomerRecommendationContext`, `recommend_catalog_products`, `docs/releases/CP-R1-T10B*.md`) was audited and explicitly **not** reused - it reads identity via the pre-A10 `masterCustomerIdentity` model A10 already replaced, and is only reachable from the legacy Agent Tool Loop, never from CommercialWork. Reusing it would have resurrected an identity-space bug A10 fixed.

## 1. Objective semantics

`CUSTOMER_AWARE_RECOMMENDATION` (new `CommercialObjectiveType`) represents "recommend something based on what I usually buy or my purchase behavior in general" - distinct from `REPEAT_PURCHASE` (a **specific** past purchase, "lo mismo de siempre") and from `SELECT_PRODUCTS` (a product named directly this turn). It is also distinct from the pre-existing `RECOMMEND_PRODUCTS`/`COMPARE_PRODUCTS` objective types, which remain planner-unreachable, ungated (`operations.ts`: `{kind:"NONE"}`) scaffolding by design - this task does not revive them.

Once a search query is resolved (from the customer's own words this turn, or from a historical signal), the objective hands off to the **same** `search_products`/T12 chain every other product request uses (never a parallel candidate-fetching mechanism), and never auto-advances to checkout the way `REPEAT_PURCHASE` does on a single match - a recommendation is always presented and the customer always confirms, even for exactly one candidate.

## 2. Identity requirement - a design correction made during planning

One line, reusing A06/A07 unchanged, identical to `REPEAT_PURCHASE`: `commercialIdentityGate.ts`'s `COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION.CUSTOMER_AWARE_RECOMMENDATION = "customer_profile_history"`.

Worth recording explicitly: an earlier design draft considered **skipping** this gate, reasoning from the spec's own CAR02/CAR16 ("generic recommendation still works without identity"). Reading `commercialIdentityGate.ts` directly disproved that: `RECOMMEND_PRODUCTS` is already a *different*, ungated objective type in this codebase's own vocabulary, reserved for a plain/generic recommendation that isn't wired to any planner intent today. `CUSTOMER_AWARE_RECOMMENDATION` is the new, deliberately-gated, personalized one - identity-insufficient correctly triggers the standard onboarding gate/resume (CAR03/CAR04), with **zero** new gating code. Degradation for missing history or a Customer Profile outage (section 5) is a capability-output decision, made entirely downstream of this gate, never a reason to weaken it.

## 3. Candidate source (PARTE 6/7/10)

Candidate generation routes entirely through the already-CommercialWork-native `search_products` capability (T12 `resolveProductIntent`), never `recommend_catalog_products`/`catalogRecommendationGatewayAdapter.ts` (the CP-R1 capability - see Baseline). Reasons: that adapter requires a resolved `sourceProduct.productId` (this task only ever has a name string), reads identity via the stale `masterCustomerIdentity` model, and is shared with the live legacy Agent Tool Loop - touching it risks that runtime for no benefit. `search_products`'s `ProductIntentResolutionResult.candidates` is already populated regardless of `resolution.status` (`resolved`/`clarification_required`/`no_match`), so a short product/category name already returns bounded, current, priced/linked candidates with zero new HTTP integration - `buildCommercialWorkProjection.ts`'s `applyRecommendationSearchState` reuses `latestSearchProductsExecution`/`parseProductIntentResolution` unchanged. The existing hardcoded `limit: 5` in `commercialWorkExecutor.ts`'s `SEARCH_PRODUCTS` gateway-input case already satisfies the spec's 5-10 band - no executor change needed.

## 4. Historical signal selection (PARTE 5, Decision 4a)

New capability `lib/brain/commercial/capability-gateway/getCustomerRecommendationSignalCapability.ts` calls A10's `loadCommercialCustomerContext({runtimeIdentity, historyNeeds: ["PRODUCT_RECOMMENDATION"]})` - a literal that already existed in `CUSTOMER_HISTORY_NEEDS`, wired identically to `"REORDER"` in the loader, zero loader changes needed.

`purchaseBehavior.topProducts` has **no documented or enforced order** - checked `lib/integrations/customer-profile/http-client.ts`/`schemas.ts` (the client parses the wire array verbatim, no client-side sort is ever applied) and `CP-R1-T10B2`'s own doc (explicitly treats `topProducts` as "evidence only," never a pre-ranked list). Trusting `topProducts[0]` would have been an unverified assumption. The capability instead exposes a standalone, named pure function, `selectRecommendationHistoricalSignal(topProducts)` (never inlined into `execute()`, so the heuristic can change without touching the capability's CP/Gateway contract): sort by `orderCount` desc, tie-break `totalQuantityPurchased` desc, tie-break `lastPurchasedAt` desc. Documented deliberately as a **"historical signal selection heuristic"** - "purchased in the most distinct orders, then the highest cumulative quantity, then the most recent" - never claimed as "customer preference." Tested (CAR26) with a deliberately scrambled fixture to prove the selection is a real sort, not an accidental `[0]`.

## 5. Degradation semantics (PARTE 12/13, Decision 5) - the deliberate divergence from REPEAT_PURCHASE

`getCustomerRecommendationSignalCapability`'s outcome mapping collapses `PROFILE_NOT_FOUND`, `SYSTEM_UNAVAILABLE` (retryable or not), and `AVAILABLE`-with-empty-`topProducts` all into the **same** `{status: "completed", data: {status: "NO_SIGNAL"}}` business outcome - never `denied`, never `temporarily_blocked`/`failed`. This is the deliberate, spec-mandated divergence from `getCustomerPurchaseHistoryCapability.ts` (which correctly blocks on CP failure, since there is no sensible generic substitute for "repeat this specific past purchase"). For a recommendation, losing personalization must never block the conversation - `applyCustomerAwareRecommendationObjectiveState` treats `NO_SIGNAL` exactly like "no queryHint either": ask one short, identity-free clarifying question, never re-open onboarding, never invent a query. `IDENTITY_INSUFFICIENT` still maps to `denied`, defensively, exactly like A11 - structurally unreachable once the objective-level gate (section 2) is in place.

Proven for real (not an injected fake) in `customerAwareRecommendationE2E.test.ts`: in the exact same "no live Customer Profile" sandbox condition that makes `get_customer_purchase_history` genuinely `FAILED` (`repeatPurchaseE2E.test.ts`), `get_customer_recommendation_signal` completes with a real, persisted `{status:"NO_SIGNAL"}` row.

## 6. Query precedence (PARTE 11, Decision 4) - signal always loads, current intent always wins the query

`LOAD_RECOMMENDATION_SIGNAL` always runs first, unconditionally - even when the current turn already carries a `queryHint`. This is a **deliberate consistency/auditability choice, not a free optimization**: the step has real Customer Profile/network/DB/latency cost, and running it unconditionally means every `CUSTOMER_AWARE_RECOMMENDATION` objective produces the same audited shape (a real attempt at a historical signal, recorded, regardless of what ultimately wins) and keeps the signal available as context for a future ranking/explanation feature. Once the signal execution completes, `queryHint` **always** wins the actual search query when present (CAR25/CAR29) - the loaded signal is still attached to the objective (`rfmSegmentLabel`) but never blended into the query text in this version. **Disclosed limitation**: when `queryHint` wins, the historical signal is loaded but not used to rank, filter, or explain the resulting candidates - there is no ranking mechanism in this codebase yet that safely consumes a secondary signal alongside an explicit constraint. This is written down deliberately, not implied to be complete "current intent overrides history" semantics.

Exactly one signal-capability execution per objective lifecycle either way (mirrors `latestPurchaseHistoryExecution`'s single-most-recent-execution pattern; CAR30).

## 7. RFM (PARTE 4, Decision 6) - captured, inert

`rfmSegmentLabel?: string` is populated only from `customerRfm.segment.code` when `status === "AVAILABLE"` - never raw recency/frequency/monetary numbers. It comes along for free with the same `loadCommercialCustomerContext` call, so it is captured and persisted, but **nothing in this task reads it** - not the search query, not the finalizer's wording, not any ranking/filtering. A hook for a future task, not active behavior. This version's demonstrable capability is fully "real history -> signal -> current Catalog -> safe candidates" without RFM in the loop at all.

## 8. Presentation, never auto-select (PARTE 9, Decision 7)

Unlike `REPEAT_PURCHASE` (which auto-advances to checkout on exactly one match, because the customer named a specific past purchase), a recommendation always presents its bounded candidate list and waits - even for a single candidate (CAR28), since these are suggestions, not something the customer already committed to. The customer naming one next turn is parsed by the existing planner as an ordinary `select_products` intent, which supersedes the pending recommendation objective via the existing "selection" supersession family (`deriveCommercialObjectives.ts`) - never a bespoke reply parser. This is also how "the LLM cannot invent outside the candidate set" is satisfied structurally: `buildCommercialWorkFinalizerMessage.ts` is a fully deterministic template (no LLM narration step exists in CommercialWork's response path at all), listing only the real candidates on the objective via the **existing** `productCandidatesList` helper, exactly like `PRODUCT_AMBIGUOUS`/`REPEAT_PURCHASE_AMBIGUOUS` already do (CAR27: `recommendationCandidates` is built exclusively from the `SEARCH_PRODUCTS` execution's own candidates; the signal capability's own result type never carries a `productId` field at all, so there is nothing from history that could leak into a "current" id).

## 9. A real, pre-existing bug found and fixed (shared with REPEAT_PURCHASE)

Building this task's E2E test exposed a genuine, pre-existing defect in `commercialWorkExecutor.ts`/`deriveCommercialWorkSteps.ts`, shared with `REPEAT_PURCHASE`, never previously surfaced:

- `refreshObjectiveState` (`commercialWorkExecutor.ts`) generically marks an objective `COMPLETED` the instant **all** of its owned steps report `"completed"` - correct for most step types, but wrong for a "gathering" step (`LOAD_PURCHASE_HISTORY`/`LOAD_RECOMMENDATION_SIGNAL`) whose completion always requires a follow-up reprojection to interpret (e.g. "0 candidates" vs "N candidates, ask which one" vs "no signal, ask a query"). Fixed with a `GATHERING_STEP_TYPES` exclusion from that shortcut.
- `deriveCommercialWorkSteps.ts` re-derives the **same** step id for a gathering step every round, mirroring the objective's current status. Once the executor has already persisted that step `COMPLETED` (a real, successful capability call), a later round trying to move it to `WAITING_CUSTOMER` hit `transitions.ts`'s step state machine, which correctly refuses to un-complete a step - a real, reproduced `CommercialWorkPersistenceError: Invalid CommercialWorkStep transition COMPLETED -> WAITING_CUSTOMER`, silently swallowed by `settleCommercialWorkProjection`'s `catch { return work; }`, discarding the correct objective state. Fixed with `gatheringStepAlreadyExecuted(objective, capabilityName)` (checks `objective.evidence` for a `completed` `capability_execution` entry for that capability): once true, the step always derives as `COMPLETED`, regardless of what the objective's own status becomes next - the finalizer never reads step status, only `objective.missingRequirements`/`blockers`, so nothing downstream needed the step to mirror the wait.

`REPEAT_PURCHASE` never surfaced this because a Customer Profile failure there is itself a real terminal `FAILED`/`WAITING_SYSTEM` (no generic substitute exists for "repeat this specific purchase") - its own "2+ candidates, ask which one" scenario (RPH08) has the identical latent defect, just never exercised end-to-end against the real DB transition validator (RPH08's own unit test never touches persistence). `CUSTOMER_AWARE_RECOMMENDATION` is the first objective designed to complete its gathering step cleanly even when Customer Profile is unavailable, which is what exposed the gap. Fixed once, at the shared root, for both objective types - not worked around locally.

## 10. Planner (PARTE 16)

New closed-vocabulary intent `customer_aware_recommendation` (`multi-intent/types.ts`), with an optional `queryHint` (customer's own words narrowing what they want this turn - "económico", "para entrenar en casa", "discos" - never invented for a bare "qué me recomiendas"). `buildIntentPlannerPromptPackage.ts` gained a dedicated phrase-to-intent example table (`CUSTOMER_AWARE_RECOMMENDATION_EXAMPLES`) with explicit negative-contrast examples against both `repeat_purchase` and `select_products`, same format A11 already proved fixes prompt-salience gaps for a narrow, easily-confused distinction. `parseCommercialIntentPlan.ts`/`requirementResolver.ts`/`semanticIntentAdapter.ts` all gained the matching deterministic branch - always resolves `status: "ready"` with zero requirements at this layer (identity is a `CommercialWork`-level gate, never a semantic-planning-layer requirement).

## 11. Sequencing (PARTE 17)

```
CUSTOMER_AWARE_RECOMMENDATION (identity gate, reused)
  -> LOAD_RECOMMENDATION_SIGNAL (new step type, read-only, get_customer_recommendation_signal)
  -> SEARCH_PRODUCTS (existing step type/capability, reused)
  -> [customer names a candidate -> ordinary SELECT_PRODUCTS objective, supersedes this one]
```

No parallel workflow was created. `buildCommercialWorkFinalizerMessage.ts` gained `CUSTOMER_AWARE_RECOMMENDATION` cases in `completedClause` (the zero-candidates terminal outcome only, worded to reflect one T12 search from one derived query - "No encontré opciones actuales que pueda recomendarte con ese criterio" - never implying a global catalog review), `pendingClause`, and `buildMissingInfoQuestion` (two new branches: `RECOMMENDATION_CANDIDATES`, reusing the existing `productCandidatesList` helper, and `RECOMMENDATION_QUERY_HINT`, the one clarifying question). A picked candidate completes as an ordinary `SELECT_PRODUCTS` objective - the existing case already handles that, no change needed there.

## 12. E2E (PARTE 20/21 partial)

`tests/commercial/customerAwareRecommendationE2E.test.ts` mirrors `repeatPurchaseE2E.test.ts`'s scope exactly: real `runCommercialWorkInboundCycle`, real semantic planner (offline-scripted provider), real projection, real identity gate, real same-work resume, real Capability Gateway dispatch (a real `crm_capability_executions` row for `get_customer_recommendation_signal`) - against real MariaDB. Turn 1 (LEVEL_2): identity-blocked, zero dispatches. Turn 2 (LEVEL_3, same work `publicId`): a real dispatch happens, and - the key A12-specific proof - the real "no live Customer Profile" condition produces a real, persisted `{status:"NO_SIGNAL"}`/`completed` row (never `FAILED`), with the objective correctly ending `WAITING_CUSTOMER`/`RECOMMENDATION_QUERY_HINT` (never re-onboarding). A restart-safety test (CAR30) and a `repeat_purchase`-still-routes-correctly regression (CAR15) round out the file.

**What this does not prove**: a full `search_products`/Catalog happy path with real candidates - no live Catalog Service is reachable in this sandbox either, same limitation `repeatPurchaseE2E.test.ts` already documents. That data flow (signal/queryHint -> Catalog candidates -> bounded presentation -> supersession into an ordinary `select_products`) is proven in full, with injected fakes, by `customerAwareRecommendationObjective.test.ts`. Part 21's real owner-number WhatsApp live test was not attempted - no live Meta/owner-phone access in this environment, the same documented limitation as every prior R2 task (A10, A11).

## 13. Privacy (PARTE 8/19)

`RecommendationSignalResult` (the capability's own output type) carries only `queryText`/`rfmSegmentLabel` - never email/phone/address/payment/raw order data/internal identity ids, and never a `productId` (there is nothing here a later step could mistake for a current catalog id - section 8/CAR27). Verified by test (`getCustomerRecommendationSignalCapability.test.ts`'s PII-shaped-key scan, and the E2E test's own scan of the persisted `crm_capability_executions` row). No new identity evidence is ever written by this capability (zero write imports).

## 14. Tests

- `tests/commercial/customerAwareRecommendationObjective.test.ts` (13 tests) - CAR03/04 (identity gate reuse, signal always loads even with a queryHint present), CAR09/12 (signal -> query, no-signal-no-hint -> plain question), CAR25/29 (queryHint always wins, including under a real Customer-Profile-unavailable NO_SIGNAL), CAR19/27/28 (bounded, Catalog-only candidates, never auto-selected, never a historical id), CAR14 (Catalog failure never serves stale history as current), CAR30 projection-half (no duplicate step derivation once resolved), plus a supersession test.
- `tests/commercial/getCustomerRecommendationSignalCapability.test.ts` (10 tests) - registration/tool-alias check, `IDENTITY_INSUFFICIENT` -> `denied`, `PROFILE_NOT_FOUND`/`SYSTEM_UNAVAILABLE` (both) -> `NO_SIGNAL`/`completed`, RFM present/absent, CAR26 (deterministic selection, scrambled fixture + explicit tie-break coverage), PII-shaped-key scan.
- `tests/agent-loop/multi-intent/parseCommercialIntentPlan.test.ts` (+4), `requirementResolver.test.ts` (+1) - deterministic planner-layer coverage.
- `tests/commercial/customerAwareRecommendationE2E.test.ts` (3 tests) - see section 12.
- One pre-existing test updated to match this task's own explicit, intended change: `tests/commercial/commercialIdentityRequirement.test.ts` ("catalog integrity" - added `get_customer_recommendation_signal -> customer_profile_history` to the documented capability-name-to-operation override, same pattern `get_customer_purchase_history` already established).

**Regression**: full `tests/commercial/*` (139 files, ~1200+ tests across 4 chunked batches) and `tests/agent-loop/*` (40 files, ~600 tests across 2 chunked batches). All green except pre-existing, confirmed-unrelated failures verified identical against the clean `develop` baseline via `git stash` with the exact same batch split (7x the documented `Missing DATABASE_NAME` file-level hook artifact; 17 `prestashopIdentityBridge.test.ts` PSB* failures + `linkExternalIdentityCapability.test.ts`/`processInboundCommercialShadow.test.ts` errors, all confirmed pre-existing and unrelated to this task's files). `npx tsc --noEmit`: clean. `npm run build`: clean.

## 15. Debts (consolidated)

- Disclosed in section 6: when `queryHint` wins, the loaded historical signal is not blended into ranking/filtering/explanation - a real, future enhancement, not claimed as done.
- RFM is captured but inert (section 7) - a hook, not active behavior.
- No live-LLM phrase-recognition validation (section 10) - same limitation every planner feature in this codebase already carries.
- E2E proves organic reachability and real degradation semantics, not a live Catalog Service happy path (section 12) - full candidate data-flow success is proven at the unit/capability level only.
- Part 21's real owner-number WhatsApp live test was not attempted (section 12) - no live Meta/owner-phone access in this environment.
- `RECOMMEND_PRODUCTS`/`COMPARE_PRODUCTS` (the pre-existing, ungated, generic recommendation objective types) remain planner-unreachable scaffolding - reviving them into a real "recommend anything, no history needed" flow is a separate, future task, not part of this one (see section 1).

## 16. Next slice

No specific next slice is mandated by this task. Candidates worth naming for a future session: (a) blending the historical signal into candidate ranking/explanation once `queryHint` wins (section 6's disclosed limitation), (b) reviving `RECOMMEND_PRODUCTS` as the genuinely generic, no-identity recommendation path CAR02/CAR16 gesture at, (c) ID-R2 omnichannel identity adapters (Instagram/Facebook), matching A11's own alternative-next-slice framing.

## Criterio de salida - checklist

1. Real commercial objective exists, distinct from `repeat_purchase`/`recommend_products`/`discover_products`/`select_products` - section 1/10. OK
2. Identity requirement reuses A06 - section 2 (one line, `commercialIdentityGate.ts`). OK
3. Same work resumes after onboarding - section 2 (identical, unmodified A07 mechanism). OK
4. A10 boundary is reused - section 4/6 (`loadCommercialCustomerContext`, unchanged). OK
5. Catalog remains the authority for current products - section 3/8 (every candidate is a real `search_products`/T12 result). OK
6. History is never used as a catalog - section 3/8/9 (historical signal only ever becomes query text, never a productId). OK
7. RFM is a signal, never a decision - section 7 (captured, inert, no ranking/filtering reads it). OK
8. No history degrades correctly - section 5/6 (plain clarifying question, never onboarding, never invented data). OK
9. CP failure never breaks generic recommendation - section 5/12 (proven for real: `NO_SIGNAL`/`completed`, never `WAITING_SYSTEM`). OK
10. Catalog failure never produces stale recommendations - section 8/9 (technical failure path never touches history data). OK
11. LLM never invents outside the candidate set - section 8 (no LLM narration step exists in this response path at all). OK
12. PII never reaches the prompt - section 13 (minimized `RecommendationSignalResult`, verified by test). OK
13. No duplicated capability/runtime - section 3/9 (reuses `search_products`; new capability follows the exact A11 pattern, one root-cause fix shared with it). OK
14. Tests demonstrate real personalization - section 12/14 (E2E + unit coverage across the full CAR matrix). OK

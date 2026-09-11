# SALES-AGENT-R3-CAPABILITY-SEMANTICS-COMMERCIAL-POLICY-V1 - Complete Capability Semantics + Commercial Behavior Policy

**Verdict:** `R3_CAPABILITY_SEMANTICS_COMMERCIAL_POLICY_V1_IMPLEMENTED_LIVE_BENCHMARK_PENDING`

**Mode:** IMPLEMENTATION

**Depends on:** `SALES-AGENT-R3-CAPABILITY-SEMANTICS-TR-B1-B2` (the generic `useWhen`/`doNotUseWhen`/`evidenceProduced`/`evidenceRequired`/`operationSemantics` fields and `renderToolLine`'s projection of them) and `SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B4` (the `search_products_by_semantics` capability whose omission from three prompt rules this task found and fixed).

## 1. The gap this closes

`TR-B1-B2` built the infrastructure for model-facing capability semantics and populated it for exactly one capability. At the start of this task, of the 11 capabilities in `AGENT_LOOP_TOOL_POOL`:

- **1 of 11** declared `useWhen`/`doNotUseWhen` (`search_products_by_semantics`, from `TR-B4`).
- 2 declared `operationSemantics` (`select_products`, `create_quote`).
- The other 10 were projected to the model as a bare `description` plus a JSON Schema - no stated boundary against their neighbors.

The observable consequence, and the behavior this task targets: the model would run `search_products_by_semantics`, get a valid result, and then immediately run `search_products` with the same need re-expressed as free text. Nothing in the prompt told it that the second call resolved no remaining information need - and, as section 4 documents, two prompt rules actively told it the semantic result was *not* usable evidence.

This task completes the semantics for all 11 and adds the two transversal policies that were missing. It builds **no new mechanism**: no router, no second planner, no intent map, no keyword table, no persistent `currentIntent`/`conversationStage`, no workflow graph. The decision stays exactly where it was:

```
message + conversation + durable state + observations
  + available capabilities + capability semantics
        -> DeepSeek -> chosen capability
```

## 2. Capability semantics: 11/11

Every pool capability now states the full contract. Three of the six elements were already structural fields and are reused as-is rather than restated in prose:

| Contract element | Where it lives |
|---|---|
| PURPOSE | `description` |
| USE WHEN | `useWhen` |
| DO NOT USE WHEN + BOUNDARY | `doNotUseWhen` (names the neighboring capability that owns the excluded problem) |
| REQUIRES | `evidenceRequired` (+ prose in `description` for state-based requirements the evidence enum does not model, e.g. `calculate_shipping`'s destination) |
| PRODUCES | `evidenceProduced` |
| EFFECT | `operationSemantics` |

No new `CapabilityEvidenceType` or `CapabilityOperationSemantics` member was introduced. Adding, say, a `SHIPPING_DESTINATION_STATE` evidence type to express `calculate_shipping`'s requirement structurally would have changed evidence semantics for every consumer of `resolveCapabilitiesProducingEvidence` - out of scope, and the task's own gate E forbids it. That requirement is stated in prose instead.

### Bare-clause convention (real defect fixed)

`renderToolLine` renders `` `Use when: ${useWhen}.` `` and `` `Do not use when: ${doNotUseWhen}.` `` - it supplies the connector and the terminating period itself. `search_products_by_semantics`' original strings repeated both, so the live prompt contained:

```
Use when: Use when the customer expresses a functional, training, ... product..
```

Every string is now a bare clause: no leading connector, no trailing period, no padding. Asserted for all 11 in `tests/commercial/capabilityCommercialPolicySemantics.test.ts` (`[B]`), and documented on the field itself in `capability-gateway/types.ts` so the next author does not reintroduce it.

### Boundary prose is never a wording trigger

`useWhen` describes the customer's **situation** and the **unresolved problem**; it never quotes a phrase, names a keyword, or maps wording to a tool. A dedicated test (`[B]`) rejects any quoted string (`"`, `“`, `”`, `«`, `»`) and the tokens `keyword`/`says`/`phrase` inside any of the 22 clauses. Straight apostrophes are allowed - they are ordinary English possessives, not quoted customer speech.

### The declared boundaries

- **`search_products`** - resolve which concrete product the customer is naming nominally. Not for functional needs (`search_products_by_semantics`), not for ranking/extremes (`explore_catalog`), not for rehydrating an identified product (`get_product_details`), not for company knowledge - and explicitly not for repeating a retrieval a successful semantic discovery already performed.
- **`get_product_details`** - current commercial facts for one already-identified product, and the only capability whose evidence authorizes sharing a product URL. Not for discovering identity; reading details is never a commercial selection.
- **`search_company_knowledge`** - knowledge specific to the company itself. Never identifies a product, never changes durable state.
- **`explore_catalog`** - the catalog as an ordered or filtered set. Its `description` previously ended with `"Not for open-ended semantic product discovery (use search_products)"`, which became false the moment `search_products_by_semantics` landed; that routing prose moved into `doNotUseWhen` and now names the correct neighbor.
- **`search_products_by_semantics`** - which products satisfy what the customer needs/wants to do/train, interpreted through the canonical semantic vocabulary. Its `doNotUseWhen` now carries the anti-repetition boundary explicitly.
- **`recommend_catalog_products`** - products related or complementary to an already-identified source product. Its `description` carried three separate boundary statements inline; those moved to `useWhen`/`doNotUseWhen` rather than being duplicated in both places.
- **`set_shipping_destination`** - persist the destination this opportunity must use. Neither calculates shipping nor chooses a carrier.
- **`select_products`** - persist the confirmed selection. Its `description` stated full-replacement semantics in prose *and* declared `operationSemantics: "FULL_REPLACEMENT"`, so the model read the same fact twice; the prose copy is gone (the generated sentence stays).
- **`calculate_shipping`** - real alternatives from the durable selection and destination. Calculating options never represents the customer's choice.
- **`select_shipping_option`** - persist the alternative the customer committed to, inferred from the whole context, **never limited to ordinals or particular words**.
- **`create_quote`** - materialize a formal quote from durable commercial state. Never from hypothetical interest.

## 3. Two transversal immutable policies

Both live in the immutable layer of `buildAgentStepPromptPackage.ts` (layer 2, evidence/tool rules) - never editable, never derived from `SalesAgentPromptConfiguration`, and covered by the existing `IMMUTABLE_CONFIGURATION_BOUNDARY_LINE` that forbids identity configuration from contradicting them.

### 3.1 Capability selection policy (task section 2)

`CAPABILITY_SELECTION_POLICY_RULE_LINES` - three lines, rendered immediately before the tool catalog it governs, **gathering only** (choosing a capability is impossible once the tool budget is spent - the `LLM-R1-T03` classification):

1. Choose capabilities by the unresolved problem they solve, the evidence and state they require, and the effect they produce.
2. Never choose a capability because words in the customer's message resemble its name or description.
3. After a successful tool observation, use another capability only when it resolves a distinct remaining information need or performs a justified state transition - never repeat equivalent retrieval through a neighboring capability without a distinct purpose.

Line 3 is what the `search_products_by_semantics -> search_products` pattern violates. It is stated generically so it covers every neighboring pair; that specific sequence is **not** hardcoded anywhere.

### 3.2 Commercial Behavior Policy V1 (task section 3)

`COMMERCIAL_BEHAVIOR_POLICY_RULE_LINES` - eight lines, deliberately separate from `useWhen`/`doNotUseWhen`: **a capability's semantics state what it CAN do; this states what kind of salesperson to be with them.** Every line is a commercial judgment the model makes, never a condition the runtime evaluates - in particular there is no `productId exists -> always recommend` trigger anywhere.

Ordered so that finalization renders a contiguous suffix (`slice(4)`), the same never-duplicated-copy discipline `SHIPPING_DESTINATION_FINALIZATION_RULE_LINES` and `SELECT_PRODUCTS_FINALIZATION_RULE_LINES` already use:

| # | Line | Phase |
|---|---|---|
| 0 | Conversion: move a qualified conversation toward concrete purchase progress; prefer executing the next useful capability over asking permission or over a clarifying question that would not change the next action. | gathering |
| 1 | Links: proactively obtain the verified canonical URL with `get_product_details` and include it in the same reply; do not routinely ask whether the customer wants the link. | gathering |
| 2 | Cross-sell: when a product is clearly identified or selected, consider whether related catalog products could materially improve the purchase, and use `recommend_catalog_products` when the relationship adds real commercial value. | gathering |
| 3 | Quote: when intent and the required selection are both established, prefer progressing toward a real quote over unnecessary exploratory dialogue. | gathering |
| 4 | Never recommend to force an upsell; never contradict an explicit customer constraint or a request to avoid extra products. | both |
| 5 | Shipping: with no competing customer preference, favor the lowest-cost verified alternative when presenting or recommending; explicit priorities (speed, carrier, timing) override that default. | both |
| 6 | Recommending the cheapest alternative is not selecting it - an option becomes the customer's choice only once the conversation establishes that they chose it. | both |
| 7 | Never state or promise a quote from hypothetical interest. | both |

Lines 0-3 are all "execute the next capability" judgments, impossible with no tool budget left. Lines 4-7 govern what the response text may prefer, claim or promise, so they travel into finalization too.

### Permission-seeking, without deleting `pendingCatalogAction`

The task called for removing unnecessary permission-seeking around product links. `COMMERCIAL_CLOSING_RULE_LINES` was **not** deleted - `pendingCatalogAction` continuity depends on it, and the multi-product offer (`"¿Quieres que te envíe el link de alguno de estos productos?"`) is a genuine choice question, not permission-seeking.

Instead, policy line 1 tells the model to go get the link, and states that the closing offer applies **only when the link could not be verified this turn**. That is already exactly what that block's own rules 0 and 4 say (rule 0: include a verified link directly instead of asking; rule 4: never add the closing offer when a link was already delivered or verified this turn). The gap was never the closing rule - it was that nothing instructed the model to proactively obtain the link in the first place. One line closes it; no existing rule and no test assertion about the closing phrasing had to change.

## 4. Three real drifts corrected (pre-existing debt, found not introduced)

### 4.1 The observed-product-evidence allowlist (the direct cause of the targeted behavior)

Two prompt rules named the valid evidence sources for a product selection and a recommendation source:

> `...must be one already observed this conversation via search_products, get_product_details, or explore_catalog...`

The runtime gate that actually enforces this (`resolveObservedRecommendationSourceProduct.ts`) derives its set from the registry's `evidenceProduced: PRODUCT_IDENTITY` minus the anti-recursion exclusion - which since `TR-B4` means **four** tools including `search_products_by_semantics`. The prompt was telling the model that a successful semantic discovery could not ground a selection or a `sourceProduct`. That is false, and it is a direct incentive to re-run the same search as free text via `search_products` - the exact behavior task section 2 targets.

Fixed at the root: `listObservedCatalogEvidenceTools()` is now exported from that same resolver and both prompt lines are template strings built from it. This removes the last hand-maintained copy of a list that `TR-B1-B2` had already consolidated everywhere else; it cannot drift again.

### 4.2 Link evidence stated per-tool instead of generally

`PRODUCT_PUBLIC_LINK_RULE_LINES` carried two lines naming `search_products` and `explore_catalog` as insufficient link evidence. Both predate `search_products_by_semantics` and `recommend_catalog_products` joining the pool, so by omission they implied those two *were* sufficient. Consolidated into one general rule naming all four and stating the real invariant: only `get_product_details` returns `publicLink` at all. `ADAPTIVE_PRODUCT_PRESENTATION_RULE_LINES` had the same per-tool phrasing and was generalized the same way. Net: one line fewer, one gap closed.

### 4.3 Stale documentation

- `catalogRecommendationGatewayAdapter.ts` carried two comments asserting `recommend_catalog_products` was **not** in `AGENT_LOOP_TOOL_POOL` and that `buildToolDescriptions()` never read its `inputSchema`. Both have been false since `CP-R1-T10B8C` registered it. Corrected.
- `registry.ts`'s `EXPLORE_CATALOG_INPUT_SCHEMA` doc described `search_products` as "open-ended semantic/textual discovery". Corrected to name the real three-way split.
- `tests/agent-loop/recommendCatalogProductsToolExposure.test.ts` asserted an exact named pool list that was never updated when `TR-B4` added `search_products_by_semantics`. **This test was already failing against a clean `develop`** (verified via `git stash -u`), i.e. inherited red, not caused here. Fixed.

## 5. Gates (task section 5)

| Gate | Result |
|---|---|
| **A.** 11/11 pool capabilities resolve a Gateway definition | pass |
| **B.** 11/11 declare sufficient model-facing semantics (+ bare-clause convention, + anti-wording-trigger guard) | pass |
| **C.** `buildToolDescriptions()` projects `useWhen`/`doNotUseWhen` correctly, verified on the rendered prompt | pass |
| **D.** No intent router, keyword map or deterministic tool routing appeared | pass |
| **E.** `inputSchema`, `governance`, evidence semantics and `operationSemantics` unchanged | pass (frozen 11-row golden table) |
| **F.** Commercial Behavior Policy present in the immutable prompt | pass (all 8 gathering, suffix of 4 in finalization) |
| **G.** R3 Stable Agent deterministic suite green | pass (38/38); full `tests/agent-loop` 736/736 |
| **H.** `typecheck` / `eslint` / `git diff --check` | pass (0 errors, 40 pre-existing warnings) |

`npm run build` (27/27 pages) and `npm run docs:validate` are also clean.

Gate D is a static guard over the 11 files that form the capability-selection surface, asserting none contains `currentIntent`, `conversationStage`, `workflowGraph`, `INTENT_TO_`, `_BY_INTENT`, `TOOL_FOR_` or `intentRouter` **in code** (block and line comments are stripped first, so prose describing what is forbidden - including `conversationContinuity.ts`'s own "this is exactly what it is NOT" note - cannot trip it). `keyword` is deliberately not on the list: `companyKnowledgeCapability` owns a real lexical fixture search *inside* one capability, which is retrieval, not capability selection. Gate D also asserts `buildToolDescriptions()` has no selection branch - the same 11 tools, in pool order, on every call.

## 6. Tests

New file `tests/commercial/capabilityCommercialPolicySemantics.test.ts` (14 tests, sections A-F above). It complements rather than duplicates the two existing suites: `capabilityEvidenceSemantics.test.ts` owns evidence classification (`TR-B1-B2`), `buildAgentStepPromptPackage.test.ts` owns per-rule prompt rendering.

`tests/commercial/capabilityEvidenceSemantics.test.ts` was narrowed: one test asserted that five capabilities had **no** `useWhen`/`doNotUseWhen`, which now contradicts the 11/11 contract. Those two fields were removed from its assertions (the evidence/operation-semantics assertions, which did not change, stay), and a new test proves the fields are still *structurally* optional using `batch_get_products` - the one registered capability that is deliberately never exposed to the model.

`tests/agent-loop/buildAgentStepPromptPackage.test.ts`: two link-evidence assertions updated for the consolidated rule, and the two prompt-length fixtures re-measured (gathering 23521 -> 25982, finalization 20420 -> 21218), with the delta accounted for line by line in the existing running comment. Those fixtures use a hand-built one-tool `availableTools`, so the 11 capabilities' new tool-line semantics are **not** in those numbers.

**The 25-case R3 corpus was not modified, and no expectation was weakened to obtain a PASS.**

Regression on `tests/commercial` was compared against a clean `develop` via `git stash -u`: identical failing-test names except one MariaDB-dependent flake (`selectShippingOptionCapability`, "resolved: selecting an observed optionIndex persists exactly that option" - green twice in isolation). The remaining failures are the pre-existing DB-connectivity set already documented throughout this workstream.

## Files changed

Production:

- `lib/brain/commercial/capability-gateway/registry.ts` - `useWhen`/`doNotUseWhen` for `search_products`, `get_product_details`, `explore_catalog`; three `description` rewrites; stale schema doc corrected.
- `lib/brain/commercial/capability-gateway/searchProductsBySemanticsCapability.ts` - `USE_WHEN`/`DO_NOT_USE_WHEN` rewritten as bare clauses; convention documented.
- `lib/brain/commercial/capability-gateway/catalogRecommendationGatewayAdapter.ts` - semantics added, boundary prose moved out of `description`, two stale comments corrected.
- `companyKnowledgeCapability.ts`, `shippingDestinationCapability.ts`, `selectProductsCapability.ts`, `calculateShippingCapability.ts`, `selectShippingOptionCapability.ts`, `createQuoteCapability.ts` - semantics added (`selectProductsCapability` also drops the duplicated full-replace sentence and corrects its stale evidence list).
- `lib/brain/commercial/capability-gateway/types.ts` - `useWhen`/`doNotUseWhen` field doc updated (bare-clause convention, 11/11 coverage).
- `lib/brain/commercial/agent-loop/resolveObservedRecommendationSourceProduct.ts` - exports `listObservedCatalogEvidenceTools()`.
- `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts` - both policy blocks + the finalization suffix; link-evidence consolidation; two rule lines derived from the exported allowlist.

Tests: `tests/commercial/capabilityCommercialPolicySemantics.test.ts` (new), `tests/commercial/capabilityEvidenceSemantics.test.ts`, `tests/agent-loop/buildAgentStepPromptPackage.test.ts`, `tests/agent-loop/recommendCatalogProductsToolExposure.test.ts`.

Docs: `docs/ACTIVE_RELEASE.md` (entry), this file. `docs/CAPABILITY_MATRIX.md` is unchanged - no new capability and no real technical/operational state change; this task adds model-facing prose and two immutable prompt blocks only.

## Debt / known gaps

- **The live benchmark gate was not executed.** Task section 6 requires a live DeepSeek run before this is considered validated. There is no network route from this session to the real Catalog Service or to MariaDB - the same limitation already recorded for `TR-B4`/`TR-B4.1`/`TR-B5`. Everything above is deterministic evidence; none of it proves the model's real behavior changed.
- `EXPLORE_CATALOG_RULE_LINES` indices 1 and 2 now partly restate `explore_catalog`'s own `useWhen`/`doNotUseWhen`, and index 2 still enumerates only `explore_catalog`/`search_products` as identification sources. Deduplicating them would shift the indices `EXPLORE_CATALOG_FINALIZATION_RULE_LINES` selects (`[0]`, `[3]`, `[5]`) and the tests asserting them; left as a separate cleanup. The capability-level semantics state the correct, source-agnostic boundary, so this is a redundancy, not a contradiction.
- `calculate_shipping`'s REQUIRES (durable destination + durable selection) is prose in its `description`, not a structural `evidenceRequired` - no evidence type models shipping state, and adding one would change evidence semantics (gate E).
- No enforcement exists for any of these prompt rules, by design - same as every other rule block in this file. The runtime does not validate or rewrite what the model says.

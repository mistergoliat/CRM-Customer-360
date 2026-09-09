# SALES-AGENT-R3-CAPABILITY-SEMANTICS-TR-B1-B2 -- Generic Capability Evidence + Semantics Foundation

MODE: IMPLEMENTATION. Implements the `TR-B1` (generic evidence typing) and
`TR-B2` (outcome projection fix + `useWhen`/`doNotUseWhen`/`operationSemantics`
rendering) slices identified by
[SALES-AGENT-R3-CAPABILITY-SEMANTICS-TOOL-REQUEST-A0](SALES-AGENT-R3-CAPABILITY-SEMANTICS-TOOL-REQUEST-A0-AUDIT.md).
`TR-B3` (pre-Gateway rejection observability), `TR-B4`
(`search_products_by_semantics`) and `TR-B5` (live-model benchmark) are
explicitly out of scope, per the task brief.

## 1. What changed

### 1.1 `CapabilityGatewayDefinition` (`lib/brain/commercial/capability-gateway/types.ts`)

Five new fields, all optional and additive - every existing capability
definition remains valid with zero changes:

```
evidenceProduced?: CapabilityEvidenceType[]
evidenceRequired?: CapabilityEvidenceType[]
useWhen?: string
doNotUseWhen?: string
operationSemantics?: "FULL_REPLACEMENT" | "CREATE_SNAPSHOT"
```

`CapabilityEvidenceType` = `PRODUCT_IDENTITY | SEMANTIC_ELIGIBILITY |
CURRENT_PRODUCT_DETAILS | COMMERCIAL_SELECTION_STATE | QUOTE_CREATED`
(exactly the 5 values the audit justified - no invented values).
`operationSemantics` intentionally has no `"READ"` member - that would only
duplicate `governance.sideEffect: "read_only"`, per the task's own
instruction not to restate governance as operation semantics.

### 1.2 Populated capabilities

| Capability | evidenceRequired | evidenceProduced | operationSemantics |
|---|---|---|---|
| `search_products` | - | `[PRODUCT_IDENTITY]` | - |
| `get_product_details` | - | `[PRODUCT_IDENTITY, CURRENT_PRODUCT_DETAILS]` | - |
| `explore_catalog` | - | `[PRODUCT_IDENTITY]` | - |
| `recommend_catalog_products` | - | `[PRODUCT_IDENTITY]` | - |
| `select_products` | `[PRODUCT_IDENTITY]` | `[COMMERCIAL_SELECTION_STATE]` | `FULL_REPLACEMENT` |
| `create_quote` | - | `[QUOTE_CREATED]` | `CREATE_SNAPSHOT` |

No other capability declares any of these fields in this slice (deliberately
minimal - no invented evidence relations for capabilities the task did not
name).

### 1.3 Evidence-lookup refactor - careful, not a blind collapse

The audit found **three** independently hand-maintained tool-name allowlists
standing in for one declared concept. They are NOT identical, and the
refactor preserves that:

- **`resolveObservedRecommendationSourceProduct.ts`** (`OBSERVED_EVIDENCE_SOURCE_TOOLS`):
  base set now derived from `resolveCapabilitiesProducingEvidence("PRODUCT_IDENTITY")`
  (registry.ts, new export), then **explicitly** subtracts
  `recommend_catalog_products` via its own named constant
  (`RECOMMEND_CATALOG_PRODUCTS_EXCLUDED_AS_RECURSIVE_SOURCE`) with a comment
  explaining why - this is a **consumer-specific provenance policy**
  (CP-R1-T10B8D's anti-recursion rule), never a structural fact the registry
  should encode. `recommend_catalog_products` still declares
  `evidenceProduced: [PRODUCT_IDENTITY]` (true - it does structurally produce
  product identity); it is simply excluded, by name, as its own recursive
  source. **Regression test added**: a live/historical `recommend_catalog_products`
  observation must never resolve as evidence for another
  `recommend_catalog_products` call, both via the pre-existing tests (already
  passing before this task, kept unchanged) and one new explicit test tying
  the exclusion to the registry-derived producer set directly.
- **`pendingCatalogAction.ts#collectAllowedProductIds`**: this consumer's
  own policy (CP-R1-T10B8D) already treats `recommend_catalog_products`
  candidates as legitimate evidence - so this one collapses cleanly to the
  registry-derived set **with no subtraction**, added as a membership guard
  before the existing per-tool extraction branches (which stay, since each
  tool's `data` shape differs - `items[]` vs `products[]` vs a bare
  `productId` vs `recommendations[]` - that is a real shape difference, not
  duplicated policy).
- **`recentCatalogContext.ts`**: the SQL `capability_name IN (...)` clause
  was a hardcoded string literal. Now built as dynamic placeholders
  (`IN (?, ?, ?, ?)`) bound from the same registry-derived list, in the same
  position the literal used to occupy - behavior-preserving (same 4 tools),
  confirmed by the existing test suite plus one updated test that now
  asserts the dynamic placeholder shape and the tool set via bound params
  instead of a hardcoded regex.

No behavior change in any of the three consumers - only where the tool-name
set comes from.

### 1.4 Outcome projection fix (`buildToolObservation.ts#projectSearchProducts`)

Confirmed live bug (Section 1.1/12 of the A0 audit): T12's own
`resolved`/`clarification_required`/`no_match` classification
(`SearchProductsCapabilityData.productIntent.resolution.status`) never
reached the model - `projectSearchProducts` only ever emitted
`{query, items}`. Fixed by surfacing it as `resolutionStatus` on the
projected object, omitted (never a literal `undefined`) when `productIntent`
is absent (older fixtures/callers). The Gateway's own `status` stays
`"completed"` regardless - `NO_MATCH` remains a successful business outcome,
never reprojected as a technical failure.

### 1.5 Prompt rendering (`buildAgentStepPromptPackage.ts`)

`renderToolLine` now appends, only when present on the tool description:

- `useWhen`/`doNotUseWhen` as plain boundary sentences (`Use when: ...`,
  `Do not use when: ...`).
- One fixed, capability-independent sentence per `operationSemantics` value
  (`OPERATION_SEMANTICS_SENTENCES`), generated once instead of hand-written
  per capability.

**Consolidation**: `select_products`' full-replace semantics used to be
stated 4 separate ways (per the A0 audit, Section 1.2/5.1): `description`,
`SELECT_PRODUCTS_RULE_LINES[2]`, a doc comment on
`selectProductsCapability()`, a doc comment on the evidence-gate call site.
This task removes `SELECT_PRODUCTS_RULE_LINES[2]` (the customer-facing
duplicate) - the sentence is now generated exactly once from
`operationSemantics: "FULL_REPLACEMENT"` alongside the tool's own listing.
`SELECT_PRODUCTS_FINALIZATION_RULE_LINES` (`.slice(4)` -> `.slice(3)`)
still yields the same 4 trailing lines (blocked-status handling, quantity
validation, the T08C evidence-binding rule, the intent-vs-executed-state
rule) - finalization never rendered tool lines anyway, so this line was
never part of its subset. **Test added**: the generated sentence renders
exactly once, and the old hand-written sentence text never reappears
anywhere in the prompt.

`useWhen`/`doNotUseWhen` are declared as fields and rendered by the same
mechanism, but **deliberately left unpopulated for every real capability in
this slice** - the task's own Section 6 scopes this to "only where an
existing, proven boundary already exists", and every existing boundary
sentence in this codebase (e.g. `SELECT_PRODUCTS_RULE_LINES[0]`,
`EXPLORE_CATALOG_RULE_LINES[0]`) is currently entangled with other
sequencing/composition guidance in its own `*_RULE_LINES` block; extracting
just the boundary clause without duplicating it would mean rewriting those
blocks, which is out of this slice's scope. The fields and their rendering
are proven end-to-end by synthetic tool descriptions in the new tests, ready
for a future capability (or a future consolidation pass) to populate.

## 2. What did NOT change (explicit scope boundaries honored)

- No `search_products_by_semantics` capability, no Catalog HTTP client
  method, no `SEMANTIC_ELIGIBILITY` producer (`TR-B4`, out of scope).
- No new `ToolRequest` type - `ReadToolRequest`/`CommercialActionRequest`
  remain the two legitimate governance-class-specific surfaces.
- No `basis`/`stateVersion` field anywhere.
- No pre-Gateway rejection observability (`TR-B3`, out of scope) - a blocked
  `use_tool` step (dedupe/evidence/exposure) still leaves only an ephemeral
  warning, unchanged.
- No workflow state, no `currentIntent`/`activeTopic`/`nextStep`.
- `RecentCatalogContext` still types "which product", never "which topic" -
  unchanged.

## 3. Tests

New:

- `tests/commercial/capabilityEvidenceSemantics.test.ts` (13 tests) -
  registry metadata per capability, `resolveCapabilitiesProducingEvidence`
  classification, and a sanity check that untouched capabilities gained
  none of the 5 new fields.
- `tests/agent-loop/buildToolObservation.test.ts` (+4 tests) -
  `resolutionStatus` for `resolved`/`clarification_required`/`no_match`,
  plus the omitted-when-absent case.
- `tests/agent-loop/buildAgentStepPromptPackage.test.ts` (+5 tests) -
  `operationSemantics` rendering (`FULL_REPLACEMENT`/`CREATE_SNAPSHOT`),
  absence when undeclared, `useWhen`/`doNotUseWhen` rendering, and the real
  registry's `select_products`/`create_quote` definitions end-to-end via
  `buildToolDescriptions()`. Golden prompt length updated (23731 -> 23521,
  gathering only; finalization unchanged at 20420 - the removed sentence was
  never part of its subset).
- `tests/agent-loop/resolveObservedRecommendationSourceProduct.test.ts`
  (+1 test) - the anti-recursive exclusion tied explicitly to the
  registry-derived producer set (existing anti-chaining tests kept, unchanged).

Updated (behavior-preserving, not a regression):

- `tests/agent-loop/recentCatalogContext.test.ts` - one test updated to
  assert the new dynamic-placeholder SQL shape and the tool list via bound
  params instead of a hardcoded literal regex.

All directly-relevant suites run green (229 tests, single combined run):
`buildAgentStepPromptPackage` (86), `buildToolObservation`,
`resolveObservedRecommendationSourceProduct`, `pendingCatalogAction`,
`recentCatalogContext` (28), `capabilityGateway`, `selectProductsCapability`,
`createQuoteCapability` (7, unchanged), `capabilityEvidenceSemantics` (13).

`npx tsc --noEmit`, `npm run lint` (scoped to touched files, 0 errors) and
`npm run build` (27/27 pages) are clean.

A full `npm test` run (12 batches) shows pre-existing failures unrelated to
this task (identity/onboarding, IDE10/IDE20 email dedup, shipping
supersession, the A13 conversational benchmark, and a `DATABASE_NAME`
isolation cluster affecting several files when run outside their own env
wrapper) - confirmed by cross-referencing the failing test names against the
list of files this task touched: zero overlap.

## 4. Risks / debt

- `useWhen`/`doNotUseWhen` are declared but unpopulated - a deliberate scope
  boundary (Section 1.5 above), not a bug. A future consolidation pass can
  populate them once the entangled `*_RULE_LINES` prose is worth splitting.
- `TR-B3` (pre-Gateway rejection observability) remains open, recommended as
  the next slice by the A0 audit and by `ACTIVE_RELEASE.md`.

## 5. Verdict

`TR_B1_B2_IMPLEMENTED`

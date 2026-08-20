---
doc_id: release-sales-agent-r2-a10
title: SALES-AGENT-R2-A10 - Capability Coverage and Runtime Correctness Audit
status: done
last_reviewed: 2026-08-20
source_of_truth_for:
  - A10 closure evidence
  - canonical Sales Agent capability inventory (as of A10)
depends_on:
  - ./SALES-AGENT-R2-A09-safe-dependency-aware-parallel-execution.md
  - ./SALES-AGENT-R2-commercial-semantic-capability-matrix.md
  - ./SALES-AGENT-R2-capability-coverage-matrix.md
tags:
  - release
  - sales-agent
  - commercial-work
  - audit
---

# SALES-AGENT-R2-A10: Capability Coverage and Runtime Correctness Audit

Verdict: **CAPABILITY_COVERAGE_VALIDATED**. Full code-grounded capability inventory (14
Capability Gateway entries, 10 legacy Agent Tool Loop tools, 9 CommercialWork step types), the
exact WAITING_CUSTOMER same-cycle re-execution defect A09 documented is fixed at both sites that
could produce it, and no other A10-blocking defect was found.

## 1. Canonical capability inventory (Part 1)

Derived from `lib/brain/commercial/capability-gateway/registry.ts` +
`customerIdentityCapabilities.ts` (the single `CAPABILITY_GATEWAY_REGISTRY` array - the only
place capabilities are registered) and
`tests/agent-loop/recommendCatalogProductsToolExposure.test.ts` (the canonical, currently-green
assertion on `AGENT_LOOP_TOOL_POOL`'s exact contents - not inferred from a stale count).

**14 Capability Gateway entries:**

| # | Capability | sideEffect | Legacy pool | R2 step type |
|---|---|---|---|---|
| 1 | `search_products` | read_only | yes | `SEARCH_PRODUCTS` (derivable, not executable) |
| 2 | `get_product_details` | read_only | yes | none |
| 3 | `batch_get_products` | read_only | no (internal enrichment only) | none |
| 4 | `explore_catalog` | read_only | yes | none |
| 5 | `search_company_knowledge` | read_only | yes | none |
| 6 | `resolve_customer` | read_only | no (direct-invoke, ACS-R1-04 identity pipeline) | none |
| 7 | `create_customer` | mutating | no (direct-invoke) | none |
| 8 | `link_external_identity` | mutating | no (direct-invoke) | none |
| 9 | `recommend_catalog_products` | read_only | yes | `RECOMMEND_PRODUCTS` (derivable, not executable) |
| 10 | `set_shipping_destination` | mutating | yes | `SET_SHIPPING_DESTINATION` (executable) |
| 11 | `select_products` | mutating | yes | `SELECT_PRODUCTS` (executable) |
| 12 | `calculate_shipping` | read_only | yes | `CALCULATE_SHIPPING` (executable) |
| 13 | `select_shipping_option` | mutating | yes | `SELECT_SHIPPING_OPTION` (derivable, not executable) |
| 14 | `create_quote` | mutating | yes | `CREATE_QUOTE` (executable) |

**10 legacy Agent Tool Loop tools** (`AGENT_LOOP_TOOL_POOL`, `runAgentToolLoop.ts`, asserted
verbatim by the exposure test above): `search_products`, `get_product_details`,
`search_company_knowledge`, `explore_catalog`, `recommend_catalog_products`,
`set_shipping_destination`, `select_products`, `calculate_shipping`, `select_shipping_option`,
`create_quote`.

**9 CommercialWork step types** (`stepTypes.ts`): `SEARCH_PRODUCTS`, `GET_PRODUCT_DETAILS`,
`RECOMMEND_PRODUCTS`, `SELECT_PRODUCTS`, `SET_SHIPPING_DESTINATION`, `CALCULATE_SHIPPING`,
`SELECT_SHIPPING_OPTION`, `CREATE_QUOTE`, `HANDOFF`.

**Key structural finding, not previously documented**: `commercialWorkExecutor.ts`'s
`EXECUTABLE_STEP_TYPES` set is `{SELECT_PRODUCTS, SET_SHIPPING_DESTINATION, CALCULATE_SHIPPING,
CREATE_QUOTE}` only - 4 of the 9 step types. Any other step type that ever reached `READY` would
be immediately blocked by the executor with `errorCode: "unsupported_step_type"` (fail-closed,
verified by `CWEX22-24`). `GET_PRODUCT_DETAILS` has no `CommercialObjectiveType` that produces it
at all (`deriveCommercialWorkSteps.ts` has no case for it - dead step type). `HANDOFF` has no
`capabilityName` by design (control-flow marker, not a capability call).

**Legacy Sales Agent tool vocabulary is a distinct, older layer**: `BRAIN_TOOL_NAMES`
(`lib/brain/tools/types.ts`, 14 camelCase entries: `searchKnowledge`, `getStaticBusinessInfo`,
`lookupCustomerByEmail`, `getOrderByInvoice`, etc.) belongs to the pre-Agent-Tool-Loop
`sales-consultative` engine, disabled by default (`BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED=false`,
see `docs/ACTIVE_RELEASE.md`). It shares no capability names with `AGENT_LOOP_TOOL_POOL` and is
out of this audit's scope (a different runtime authority entirely, gated off in production per
`ACS-R1-05.1-T01`).

## 2. Legacy tool vs R2 coverage matrix (Part 2)

| Legacy tool | R2 support | Classification | Reason |
|---|---|---|---|
| `select_products` | Full | A. FULLY_SUPPORTED_R2 | `SELECT_PRODUCTS`/`CHANGE_QUANTITY` objectives, executable |
| `set_shipping_destination` | Full | A. FULLY_SUPPORTED_R2 | `SET_DESTINATION` objective, executable |
| `calculate_shipping` | Full | A. FULLY_SUPPORTED_R2 | `GET_SHIPPING_QUOTE` objective, executable |
| `create_quote` | Full | A. FULLY_SUPPORTED_R2 | `CREATE_QUOTE` objective, executable |
| `select_shipping_option` | Step type exists, never seeded, not executable | B/C boundary - LEGACY_ONLY in practice | `SELECT_SHIPPING_OPTION` objective type exists but `semanticIntentAdapter.ts` never emits it, and even if seeded the executor's `EXECUTABLE_STEP_TYPES` excludes it |
| `search_products` | Step type exists, never seeded, not executable | C. LEGACY_ONLY | `DISCOVER_PRODUCTS` objective never emitted; `SEARCH_PRODUCTS` not in `EXECUTABLE_STEP_TYPES` |
| `recommend_catalog_products` | Step type exists, never seeded, not executable | C. LEGACY_ONLY | `COMPARE_PRODUCTS`/`RECOMMEND_PRODUCTS` objectives never emitted; `RECOMMEND_PRODUCTS` not executable |
| `get_product_details` | None | C. LEGACY_ONLY | No objective type maps to it at all |
| `search_company_knowledge` | None | C. LEGACY_ONLY | No objective type maps to it at all |
| `explore_catalog` | None | C. LEGACY_ONLY | No objective type maps to it at all |

No tool is D. OBSOLETE/SUPERSEDED - every legacy tool is still the only path for non-R2 traffic.
`resolve_customer`/`create_customer`/`link_external_identity` are E. NON_COMMERCIAL /
INTENTIONALLY_OUT_OF_SCOPE for this audit: a separate identity/onboarding pipeline
(`ACS-R1-04`), never LLM-tool-driven by design (`toolAliases.ts` comment, "a second,
LLM-tool-driven path... would risk a duplicate execution in the same turn").

**Per-item required-before-A11 decision**: none of the 6 LEGACY_ONLY tools are required before
A11 - R2's own scope (established across A07-A09) is deliberately "selection -> destination ->
shipping calculation -> quote", never product discovery/comparison/shipping-option-selection.
Classified as **future feature**, not blocking, not silently ported.

## 3. R2-only capabilities (Part 3)

None found. Every CommercialWork step type maps to a capability that also exists in the legacy
pool (or, for `HANDOFF`, to no capability at all - a control-flow marker, not a Gateway call).
R2 is a strict subset of the legacy pool's capability surface, never a superset.

## 4. Unreachable backend capabilities (Part 4)

Re-audited the exact class A08.5/A08.6 previously found for `CREATE_QUOTE` (semantically
reachable now, since A08.6). Current state of the requested examples:

| Capability/behavior | Classification | Evidence |
|---|---|---|
| `CREATE_QUOTE` | SEMANTICALLY_REACHABLE | `semanticIntentAdapter.ts` emits it; live-validated below |
| Shipping selection (`select_shipping_option`) | NOT_YET_SUPPORTED | No planner producer, executor excludes the step type |
| Product recommendation/comparison | NOT_YET_SUPPORTED | No planner producer, executor excludes the step types |
| Customer creation/onboarding | SYSTEM_ONLY | Direct-invoke pipeline (ACS-R1-04), never LLM-tool-driven, never R2 |
| Handoff | SYSTEM_ONLY | `conversation.human_owner_active`/`ai_enabled` DB flags, checked by both the legacy loop's own gate and `executeCommercialWork`'s per-iteration control reload - never a tool/capability call |
| Quote lifecycle beyond creation (approval/checkout/payment) | NOT_YET_SUPPORTED | `WAIT_FOR_QUOTE_APPROVAL` objective type exists in the type union, has no seed producer, no step case in `deriveCommercialWorkSteps.ts` |
| Customer profile/RFM reads | SYSTEM_ONLY (see Part 27) | Legacy prompt-context provider only, never a capability |
| `get_product_details`/`search_company_knowledge`/`explore_catalog` | DEAD_CODE (for R2) | No objective type ever maps to them; live and used by the legacy tool loop |

## 5. Planner intent coverage (Part 5)

`semanticIntentAdapter.ts` (`planCommercialObjectiveSeeds`) is the sole seed producer for real
customer turns; `deriveCommercialObjectives.ts#objectiveSeedsFromPendingIntents` is the sole
producer for multi-intent carry-forward. Grepped both for every `type: "..."` emission:

- `semanticIntentAdapter.ts` emits exactly: `SELECT_PRODUCTS`, `SET_DESTINATION`,
  `GET_SHIPPING_QUOTE`, `CREATE_QUOTE`, plus `kind: "cancel"` seeds.
- `objectiveSeedsFromPendingIntents` emits exactly: `SELECT_PRODUCTS`, `GET_SHIPPING_QUOTE`,
  `CREATE_QUOTE`.

Full chain (parser -> resolver -> adapter -> seed -> objective -> step -> capability) is complete
for exactly these 4 objective types. `DISCOVER_PRODUCTS`, `COMPARE_PRODUCTS`,
`RECOMMEND_PRODUCTS`, `CHANGE_QUANTITY` (superseded by re-seeding `SELECT_PRODUCTS`, never
independently emitted), `SELECT_SHIPPING_OPTION`, `WAIT_FOR_QUOTE_APPROVAL`, `HANDOFF` are **7
planner-unreachable objective types** - infrastructure ahead of the planner, not a gap the
planner itself has (nothing the planner tries to say has no chain; the chain simply stops at
objective types the planner never produces).

**No executor capability without a semantic path in the other direction**: every executable step
type (`SELECT_PRODUCTS`, `SET_SHIPPING_DESTINATION`, `CALCULATE_SHIPPING`, `CREATE_QUOTE`) has a
real planner producer. Zero mismatches in that direction.

## 6. Tool schema consistency (Part 6)

Compared legacy tool input shapes (`SELECT_PRODUCTS_INPUT_SCHEMA` etc. in the capability files)
against R2's `buildGatewayInput(step)` (`commercialWorkExecutor.ts`). Both call the exact same
`CapabilityGatewayDefinition.execute()` through the exact same `executeGovernedCapability` -
there is only one schema per capability, never a second R2-specific shape. `select_products`:
legacy passes `{items}` from the model's tool call directly; R2 passes `{items: step.input.items
?? []}}`, same field, same validation (`asLineItems`) on the receiving side either way.
`set_shipping_destination`: legacy passes `{destination}` from the model; R2 passes `{destination:
step.input.destinationText ?? step.input.canonicalDestinationName ?? ""}`. No drift found -
opportunity/conversation identity, idempotency keys and fact anchors are resolved by
`CapabilityGatewayContext` (`opportunityId`, `conversationId`, `requestId`, `actionId`), supplied
identically by both callers.

## 7. Canonical execution path / Gateway bypasses (Part 7)

`executeGovernedCapability` (`executeCapability.ts`) is the single entry point; it fails closed
(`status: "denied"`, `errorCode: "capability_not_registered"`, still audited) for any
unregistered name (Part 18/32). `commercialWorkExecutor.ts` calls
`input.executeCapability ?? executeGovernedCapability` for every mutating step in both the
single-step and wave paths - **zero bypasses found**. The legacy Agent Tool Loop
(`runAgentToolLoop.ts`) calls the same function. No second execution path to any registered
capability exists.

## 8. Read-only capability path (Part 8)

`search_products`/`get_product_details`/`batch_get_products`/`explore_catalog` are
planner-driven for the legacy loop, context-building for R2 (none are R2 CommercialWork steps
today). `search_company_knowledge` is legacy-only, planner-driven. `resolve_customer` is
system-driven (identity pipeline, pre-planning). `calculate_shipping` is the one read-only
capability that is a genuine R2 CommercialWork step (`GET_SHIPPING_QUOTE` objective) - correctly
not forced elsewhere. `recommend_catalog_products` is legacy-planner-driven, registered but
`AGENT_LOOP_TOOL_POOL`-only in practice today.

## 9-11. Test matrix, mutating minimum bar, read-only minimum bar (Parts 9-11)

See `docs/releases/SALES-AGENT-R2-capability-coverage-matrix.md` for the full per-capability T0-T6
matrix. Summary: every R2-executable mutating capability (`select_products`,
`set_shipping_destination`, `create_quote`) and the one R2-executable read-only capability
(`calculate_shipping`) already carry T2 (deterministic), T3 (DB-backed), T4
(`runCommercialWorkInboundCycle`/`executeCommercialWork` entry-point) coverage via the existing
A05-A09 suites (`commercialWorkExecutor.test.ts`, `r2ArchitectureScenarios.test.ts`,
`commercialWorkSemanticCompleteness.test.ts`). This task adds the missing **idempotency /
duplicate-inbound / WAITING_CUSTOMER-reactivation** tests those suites did not previously cover
(WC01-WC12, Part 15) - the smallest gap identified, now closed.

## 12-16. WAITING_CUSTOMER reactivation bug: root cause, fix, contract, tests (A10-blocking)

**Root cause (two independent sites, both real)**:

1. `commercialWorkExecutor.ts#canAutoActivateStep`: after a capability call returns
   `missing_information`, `activateUnblockedSteps` set the step to `WAITING_CUSTOMER` with a
   `WAITING_CUSTOMER`-coded blocker in its first pass, then its own second pass immediately
   re-checked `canAutoActivateStep`, which treated the `WAITING_CUSTOMER` code as always safe to
   auto-reactivate once `dependenciesSatisfied` held - which it trivially did, since those same
   dependencies being satisfied is exactly why the step ran in the first place. The step flipped
   back to `READY` in the same `activateUnblockedSteps` call, and the executor's own `for` loop
   picked it up again in the same `executeCommercialWork` invocation - same-cycle re-execution.
2. `buildCommercialWorkProjection.ts#applyObjectiveState` (discovered during this task, not
   previously documented): on any later reprojection of the same objective (a `settleCommercial
   WorkProjection` round, or a later turn with unrelated content), the `SELECT_PRODUCTS`/
   `CHANGE_QUANTITY`, `SET_DESTINATION`, and `CREATE_QUOTE` cases fall through to `READY`
   whenever their raw structural inputs are present, with no memory of "the capability already
   rejected this exact input as missing_information last round." This let a `WAITING_CUSTOMER`
   objective flip back to `READY` on the very next `settleCommercialWorkProjection` round even
   without site 1's bug, calling the capability again for the same unresolved input up to 3 times
   (`settleCommercialWorkProjection`'s `maxRounds`) within one turn.

**Fix**:

1. `canAutoActivateStep` no longer treats `WAITING_CUSTOMER` as an auto-activatable blocker code
   (removed from both the code allowlist and the eligible-status set). `MISSING_SELECTION`/
   `MISSING_DESTINATION`/`MISSING_PRODUCT`/`MISSING_QUANTITY`/`WAITING_SYSTEM` remain - those mark
   a step `BLOCKED` purely because a sibling step's fact had not landed yet at projection time
   (Case A, a legitimate same-turn cascade), never a capability-level customer-facing question
   (Case B).
2. `applyObjectiveState` now accepts the objective's `carriedStatus` (already-existing
   infrastructure - `reconciliation.ts#objectiveSeedFromPersisted` already threads it through for
   cancel-handling; this task extended it to every reprojection, via a new exported
   `carriedObjectiveStatusById` helper in `deriveCommercialObjectives.ts`, shared by both
   consumers). When a carried (non-superseded, same `objectiveId`) objective's last known real
   status was `WAITING_CUSTOMER`, the three vulnerable fallthroughs stay `WAITING_CUSTOMER`
   instead of recomputing `READY` from structural presence alone. A carried objective's inputs
   are copied verbatim by `objectiveSeedFromPersisted`, so this is a safe, non-generic signal:
   **no new same-family seed superseded this objective since it last asked the customer for more
   information.**

**Reactivation contract**: cross-turn reactivation is handled entirely by the pre-existing
supersession mechanism (`deriveCommercialObjectives.ts` - any new same-family objective seed,
including one from a genuinely new customer answer, unconditionally supersedes the carried
`WAITING_CUSTOMER` objective and produces a fresh objective/step with no `carriedStatus`, so it
derives normally). This task's fix never has to detect "was this customer input relevant" itself
- it only has to stop the *carried* objective from silently self-reactivating; the *new* objective
path was already correct. No new event/sequencing infrastructure was added, matching Part 14's
instruction - `carriedStatus` (objective-level) and the executor's existing
`dependenciesSatisfied`/blocker-code machinery (step-level) were both already present, only their
consultation was wrong.

**Latent transition-table gap, found while verifying the fix**: `STEP_TRANSITIONS.READY` never
allowed `WAITING_CUSTOMER` (`transitions.ts`). This was masked entirely by bug #1 above - the step
was always flipped back to `READY` before the aggregate was ever persisted, so
`updateCommercialWorkAggregate`'s transition validation never actually saw a `READY ->
WAITING_CUSTOMER` write attempt in production. Fixing bug #1 surfaced this immediately (every new
regression test failed with `INVALID_TRANSITION` until this was added). Added `WAITING_CUSTOMER`
to `READY`'s allowed transitions - the work-level and objective-level tables already allowed the
equivalent transition, so this is closing an oversight, not loosening a deliberate restriction.

**WC01-WC12 tests** (`tests/commercial/commercialWorkWaitingCustomerReactivation.test.ts`, new,
11 tests covering all 12 required scenarios - WC02 folded into WC01 since both assert the same
same-cycle non-reactivation property from two angles):

- WC01/WC02: `missing_information` -> step `WAITING_CUSTOMER`, capability called exactly once,
  stays `WAITING_CUSTOMER` across a later pass over unchanged state.
- WC03: `settleCommercialWorkProjection` reprojection does not reactivate (closes bug #2 above).
- WC04: the retry worker's `selectDueCommercialWorkSteps`/`runCommercialWorkTick` never selects
  or claims a `WAITING_CUSTOMER` step (structurally guaranteed twice over - `w.status IN
  ('ACTIVE','WAITING_SYSTEM')` excludes the whole work, and `s.status='READY'` excludes the step).
- WC05: an irrelevant new customer message (different family) leaves the objective/step
  unchanged, same `objectiveId`, no re-call.
- WC06: a genuinely new, relevant message (same family, real supersession) reactivates via a
  fresh objective/step, calls the capability again, reaches `COMPLETED`.
- WC07: pure-function proof that a real confirmed fact reactivates even when `carriedStatus`
  alone would keep waiting (fact confirmation always wins over the carried-status guard).
- WC08: cancellation while waiting terminates (`CANCELLED`), never reactivates.
- WC09: handoff (`humanOwnerActive: true`) blocks execution without touching the waiting step.
- WC10: `WAITING_CUSTOMER` survives a real DB reload (`getCommercialWorkByPublicId`).
- WC11: architectural - no file under `lib/brain/commercial/work/followup/` references
  `executeCommercialWork`/`commercialWorkExecutor` at all (grep-based regression).
- WC12: a duplicate/replayed customer input (same resolved items) still creates a new objective
  via supersession (no seed-level dedup at that layer - real dedup lives upstream in
  `assignCommercialTriggerSequence`'s dedupe key), but the fresh objective's fact-match check
  (`sameItems`) lands it `COMPLETED` immediately, never `READY`, so execution never re-calls the
  capability for input that was already fulfilled.

All 11 pass. `npx tsc --noEmit`: clean throughout.

## 17. Capability failure taxonomy (Part 17)

Audited `stepRecordFromGateway` (`commercialWorkExecutor.ts`): `missing_information ->
WAITING_CUSTOMER`; `temporarily_blocked -> WAITING_SYSTEM` (-> `RETRY_SCHEDULED` if
`scheduleRetries` and attempts remain); `failed`/`denied`/`invalid_arguments`/`requires_approval`
-> `FAILED`. Two step-type-specific reinterpretations of an otherwise-`completed` gateway result
exist and are intentional, not inconsistent: `SET_SHIPPING_DESTINATION` with a non-matching
destination fact, and `CALCULATE_SHIPPING` with `dataStatus` `shipping_destination_required`/
`commercial_items_required`, both map to `WAITING_CUSTOMER` (a `completed` gateway call whose
*business* result still needs the customer). `CREATE_QUOTE` with `dataStatus:
"no_commercial_line_items"` maps to `BLOCKED`, not `WAITING_CUSTOMER` (a structural prerequisite
gap, Case A, not a customer question). No inconsistent mapping found.

## 18. Unknown capability behavior (Part 18)

`executeGovernedCapability` fails closed for any unregistered name -
`status:"denied"`/`errorCode:"capability_not_registered"`, still audited via
`insertCapabilityExecution`, never a guessed capability, never a legacy fallback mid-turn (R2's
own `runCommercialWorkInboundCycle.ts` catch-all resolves to a controlled
`handoff_acknowledgement` dispatch on any internal failure, never falls through to the legacy
pipeline for the same inbound - see its own Part-12 comment). Existing coverage:
`CWEX22-24`/`capabilityGatewayHardening.test.ts`. **FAIL_CLOSED, confirmed.**

## 19. Idempotency audit (Part 19)

| Capability | Idempotency source | Classification |
|---|---|---|
| `select_products` | Domain-level: `setCommercialLineItemsForOpportunity` returns `changed: boolean`; executor-level: `repairEvidence`/`sameItems` skip the call entirely when the durable fact already matches | SAFE_BECAUSE fact-matched before any call |
| `set_shipping_destination` | Executor-level `repairEvidence`/`destinationMatches` skip when already matching | SAFE_BECAUSE fact-matched before any call |
| `calculate_shipping` | Read-only, no durable mutation; `staleBlockersForStep` (pre- and post-side-effect) prevents a stale result being treated as current | SAFE_BECAUSE read-only + staleness guard |
| `create_quote` | Own explicit `idempotencyKey` field (`createQuoteCapability.ts`) plus "reuses an existing quote instead of duplicating one when the selection has not changed" (registry.ts comment) | SAFE_BECAUSE explicit idempotency key |
| `select_shipping_option` | Not R2-reachable today (Part 2) | N/A for R2 |
| `create_customer`/`link_external_identity` | Out of Sales Agent R2 scope (Part 2E) | N/A for R2 |

No mutating R2-reachable capability is A10_BLOCKING on idempotency grounds.

## 20. Side-effect governance audit (Part 20)

Cross-checked all 14 registrations' declared `sideEffect` against their `execute()` bodies (Part
1's table). `search_products`/`get_product_details`/`batch_get_products`/`explore_catalog`/
`search_company_knowledge`/`resolve_customer`/`recommend_catalog_products`/`calculate_shipping`
call no domain write function - correctly `read_only`. `create_customer`/
`link_external_identity`/`set_shipping_destination`/`select_products`/`select_shipping_option`/
`create_quote` each call a domain write (`set*ForOpportunity`, `createCustomer`, etc.) -
correctly `mutating`. **Zero misclassifications found.** This directly gates A09 parallel-wave
eligibility (`classifyStepSafety`) - a misclassified `read_only` mutating capability would have
been A10-blocking; none exists.

## 21. Fact read/write profile audit (Part 21)

Re-verified `parallelStepConflictModel.ts#STEP_FACT_PROFILE` (A09) against the real capability
behavior read in Part 20 - a `Record` over the full `CommercialWorkStepType` union, so a missing
entry is a compile error, not a silent gap. `SELECT_PRODUCTS` writes `commercial_line_items` only
(confirmed - `select_products` never touches destination/shipping/quote). `SET_SHIPPING
_DESTINATION` writes `shipping_destination` only. `CALCULATE_SHIPPING` reads both, writes neither
durable fact (its evidence is internal execution-log bookkeeping, not a fact another step
depends on - confirmed by `stepRecordFromGateway`, no fact-writing side effect anywhere in
`calculateShippingCapability.ts`). `SELECT_SHIPPING_OPTION` reads `commercial_line_items`, writes
`selected_shipping_option`. `CREATE_QUOTE` reads all three prior facts, writes `created_quote`.
**VALIDATED**, no correction needed.

## 22-23. Legacy/R2 regression (Parts 22-23)

See Section "Focused/full regression results" below - both suites re-run against the fixed code,
zero new failures in either.

## 24. Live DeepSeek smoke (Part 24)

`scripts/live-r2-semantic-variants-benchmark.ts --quantity-reps=2 --cancel-reps=2 --quote-reps=2`,
real `deepseek-v4-flash`, through `runCommercialWorkInboundCycle` (the real production entry
point), against real `crm_test`. Purpose: confirm this task's correctness fixes did not regress
semantic-to-capability routing (not a new benchmark of planner accuracy). Results in the
"Live DeepSeek smoke" section below.

## 25-27. External service boundaries, Quote Service, Customer Profile/RFM (Parts 25-27)

- **Catalog / Carrier**: this session's regression and live smoke both ran against `crm_test` with
  the same fixture-backed Catalog/Carrier discipline every prior A-phase used (`.env`'s
  `CATALOG_SERVICE_BASE_URL`/`CARRIER_SERVICE_BASE_URL` are configured to a local/dev instance,
  not a fixture literally, but this session did not independently re-verify they resolve to a
  real, non-mock backend beyond what prior phases already established - not re-litigated here).
- **Quote Service**: `.env` has no `QUOTE_SERVICE_BASE_URL` configured in this environment
  (confirmed by grep). Per Part 26's explicit instruction, this does not block A10 - the internal
  `create_quote` capability contract is fully validated (idempotency key, evidence-repair,
  semantic reachability all confirmed above); the real external Quote Service E2E remains
  integration debt for A11/A12, unchanged from A08.7's status.
- **Customer Profile/RFM**: confirmed (Part 4/8 above) to be a legacy Agent Tool Loop prompt-context
  provider only (`buildAgentStepPromptPackage.ts`), never a tool, never a planner input, never
  consumed anywhere under `lib/brain/commercial/work/` (R2). Intentionally contextual
  intelligence for the legacy path - not forced into CommercialWork.

## 28. Handoff (Part 28)

Single mechanism: `conversation.human_owner_active`/`ai_enabled` DB columns, an operator-set
signal, never a tool/capability call and never a CommercialWork objective by itself (`HANDOFF`
objective type exists in the type union but has no seed producer - Part 5). Checked at two layers
for R2: the inbound-cycle entry gate (`runCommercialWorkInboundCycle.ts`, zero LLM call/mutation
if set) and the executor's own per-loop-iteration fresh reload (`commercialWorkExecutor.ts`,
blocks into `HANDOFF` before any further mutation even mid-turn). The legacy Agent Tool Loop
checks the identical columns at its own equivalent gate. **No duplicate/competing handoff
mechanism found**; human ownership remains authoritative in both paths.

## 29. Outbox / customer response (Part 29)

`dispatchCommercialWorkResponse.ts` (R2's finalizer) calls `persistAgentAction`
(`lib/brain/commercial/action-queue`) - the same canonical action-queue -> sandbox ->
`executeActionThroughGate` -> `brain_message_outbox` pipeline every other production path uses,
confirmed by direct import inspection. No direct outbox write, no exception found for the R2
production path.

## 30. Dead/duplicate execution code candidates (Part 30)

Not deleted - logged as future cleanup candidates only:

- `GET_PRODUCT_DETAILS` `CommercialWorkStepType`: no objective ever produces it - dead step type
  in `deriveCommercialWorkSteps.ts`'s switch (no case at all).
- `DISCOVER_PRODUCTS`/`COMPARE_PRODUCTS`/`RECOMMEND_PRODUCTS`/`CHANGE_QUANTITY`/
  `SELECT_SHIPPING_OPTION`/`WAIT_FOR_QUOTE_APPROVAL`/`HANDOFF` objective types: structurally
  handled by `applyObjectiveState`/`deriveCommercialWorkSteps` but never produced by any current
  seed source - migration-fallback/future-feature scaffolding, not dead in the sense of unused
  code paths (still unit-tested directly in `commercialWorkProjection.test.ts`), but unreachable
  from real production traffic today.
- `BRAIN_TOOL_NAMES`/`sales-consultative` legacy engine: still-required legacy (gated off by
  default, not this task's concern - a much larger, separate cleanup than A10's scope).

## 31. Capability coverage score (Part 31)

- Canonical legacy tool count: **10**
- Canonical Capability Gateway count: **14**
- CommercialWork step type count: **9** (4 executable, 5 not)
- Legacy tools fully supported by R2: **4** (`select_products`, `set_shipping_destination`,
  `calculate_shipping`, `create_quote`)
- Legacy-only tools: **6** (`search_products`, `get_product_details`, `search_company_knowledge`,
  `explore_catalog`, `recommend_catalog_products`, `select_shipping_option`)
- R2-only capabilities: **0**
- Required production commercial capabilities identified (the R2 scope established by A07-A09:
  select -> destination -> shipping calc -> quote): **4**
- Required production commercial capabilities supported by R2: **4**
- R2 coverage (required/required) = **4/4 = 100%** - explicitly scoped to R2's own established
  production surface, never the full legacy pool (which intentionally includes discovery/
  comparison/shipping-option-selection R2 does not yet attempt, per A07-A09's own scope
  decisions, reaffirmed in Section 4 above).

## 32. A10 blocking-defect checklist (Part 32)

| Condition | Result |
|---|---|
| Mutating R2 capability without safe idempotency | None found (Part 19) |
| Capability classified read_only but actually mutating | None found (Part 20) |
| Planner intent causing uncontrolled/unsupported mutation | None - every planner-emitted objective type maps to an executable, governed capability (Part 5) |
| WAITING_CUSTOMER immediate reactivation bug | **FIXED** (Parts 12-16) |
| R2 tool bypass causing double execution | None found (Part 7) |
| Stale evidence can become authoritative | None found - A08/A09's pre/post-side-effect stale-evidence guards re-verified unchanged (regression Section below) |
| Legacy + R2 both mutate one turn | Structurally impossible - `commercialCycleConfig.ts`'s routing gate is exclusive (`ACS-R1-05.1-T01`), unchanged by this task |
| Unknown capability executes dynamically | FAIL_CLOSED (Part 18) |

**None outstanding.**

## 33. Non-blocking debt (Part 33)

- `select_shipping_option`/`search_products`/`recommend_catalog_products`/`get_product_details`/
  `search_company_knowledge`/`explore_catalog`: legacy-only, intentionally not ported to R2 yet
  (future feature).
- Quote checkout/payment lifecycle (`WAIT_FOR_QUOTE_APPROVAL` and beyond): not yet built anywhere.
- Customer Profile/RFM enrichment: not yet consumed by R2 (intentional today).
- Quote Service external environment unavailable in this session - integration debt for
  A11/A12, unchanged from A08.7.
- Test-infrastructure "Missing DATABASE_NAME" fragility (7 files, order-dependent, first
  documented A08.6): still present, re-confirmed unrelated to this task's changes (Section below).
- `main_management` checksum drift: pre-existing, unrelated, not touched.
- Production worker/follow-up/public WhatsApp access: unchanged, **NO** for all three (A10 does
  not touch production activation state, per its own explicit instruction).

## 34. A11 readiness (Part 34)

**A11_READY.** The one runtime-correctness defect capable of making autonomous worker/follow-up
activation unsafe (a capability's explicit customer-facing question being silently ignored and
re-asked/re-executed) is fixed at both sites that could produce it, with regression coverage the
prior A-phases did not have. No other A10-blocking condition was found. Remaining gaps (Section
33) are all pre-existing, documented, and explicitly non-blocking by the task's own framework.

## Focused/full regression results

- Focused (directly touched files): 16 files, 169 tests, **169/169 pass** on first attempt after
  the fix (`tests/commercial/{commercialWorkTransitions,commercialWorkExecutor,
  commercialWorkRetryWorker,commercialWorkInboundCycle,commercialWorkProjection,
  commercialWorkRepository,commercialWorkSequencing,commercialWorkParallelExecution,
  commercialWorkSemanticCompleteness,r2ArchitectureFollowUpScenarios,r2ArchitectureScenarios,
  r2ScenarioScoring,r2SemanticIntentAdapter,objectiveAwareFollowUp,
  objectiveAwareFollowUpEligibility,buildSafeExecutionWave}.test.ts`).
- New WC01-WC12 suite: **11/11 pass** (`commercialWorkWaitingCustomerReactivation.test.ts`).
- Full `tests/commercial/**` + `tests/agent-loop/**` (162 files, 2330+ tests, run in
  command-length-safe chunks, exit codes and full output preserved in `.test-logs/`): **2330
  pass**, 7 failures - **all 7 are the exact pre-existing "Missing DATABASE_NAME"
  order-dependent files A08.6/A09 already documented** (`createCustomerCapability`,
  `customerOnboardingPostPlanStage`, `customerSession`, `customerSessionPrivacy`,
  `linkExternalIdentityCapability`, `processInboundCommercialShadow`,
  `runCommercialOperationalLoop`), plus 1 wall-clock timing flake
  (`[CWPAR01/CWPAR19]`, confirmed to pass in isolation - system load from a just-started Docker
  engine, not a logic regression). **Zero new failures attributable to this task.**
- `tests/e2e/**` (8 files, 43 tests): **41/43 pass**. The 2 failures (`T08-A6`/`T08-A7`,
  `customerIdentityOnboarding.e2e.test.ts`) are the exact pre-existing failures already documented
  in `docs/ACTIVE_RELEASE.md` (`ACS-R1-05.1-T02.3D` closure note, item (b)) - unrelated to this
  task, not touched.

## Live DeepSeek smoke

Real `deepseek-v4-flash`, `scripts/live-r2-semantic-variants-benchmark.ts --quantity-reps=2
--cancel-reps=2 --quote-reps=2`, through `runCommercialWorkInboundCycle` (the real production
entry point). Purpose: confirm A10's correctness fixes caused no semantic-routing regression (not
a new accuracy benchmark - matches A09's own framing). Full log: `.test-logs/live-deepseek-smoke-*.log`.

- Quantity correction (14 samples, 7 phrasings x 2): **14/14 (100%)**, 0% wrong-product mutation.
- Cancellation (30 samples: 10 whole-work + 10 scoped-shipping + 10 scoped-quote): **30/30
  (100%)** correct scope, 0% wrong-scope, 0% scoped->whole-work false-positive.
- `CREATE_QUOTE` semantic reachability (10 samples, 5 phrasings x 2): **10/10 (100%)** objective
  reached, 0% duplicate-objective-on-retry. Real Quote Service execution not verifiable (Part
  26/Section "External service boundaries" above).

All numbers match A08.7/A09's own baseline exactly - zero regression. "Simple selection" and
"missing information" (ambiguous product) were not independently re-sampled live this session -
both were live-validated in A08.6/A09 (C09 bundle, 100% across those closures) and this task's
own `WC01-WC12` suite deterministically covers the missing-information/WAITING_CUSTOMER behavior
at the CommercialWork layer directly (a code-level executor property, not planner semantics, so a
fresh live LLM sample adds no new evidence for that specific property).

## Git

Base: `develop` @ `ffdf73d` (A09 commit). This task's changes are a separate commit, not a
rewrite of `ffdf73d`. Files changed: `lib/brain/commercial/work/commercialWorkExecutor.ts`,
`lib/brain/commercial/work/transitions.ts`, `lib/brain/commercial/work/
deriveCommercialObjectives.ts`, `lib/brain/commercial/work/buildCommercialWorkProjection.ts`,
`.gitignore` (`.test-logs/` added); new file
`tests/commercial/commercialWorkWaitingCustomerReactivation.test.ts`. No `.env`, credentials,
test logs, or DB dumps staged.

======================================================================
REQUIRED FINAL BLOCK
======================================================================

SALES-AGENT-R2-A10: DONE

Canonical legacy tool count:
10

Canonical Capability Gateway count:
14

CommercialWork step count:
9 (4 executable: SELECT_PRODUCTS, SET_SHIPPING_DESTINATION, CALCULATE_SHIPPING, CREATE_QUOTE)

Legacy tools fully supported by R2:
4

Legacy-only tools:
6

R2-only capabilities:
0

Required commercial capabilities identified:
4 (select_products, set_shipping_destination, calculate_shipping, create_quote - R2's own
established scope since A07-A09)

Required capabilities supported by R2:
4

Planner intents without execution path:
0

Execution capabilities without semantic path:
0

Mutating capabilities audited:
6 (create_customer, link_external_identity, set_shipping_destination, select_products,
select_shipping_option, create_quote); 3 are R2-reachable (set_shipping_destination,
select_products, create_quote)

Mutating capabilities with stable idempotency:
6/6 (SAFE_BECAUSE fact-match/evidence-repair or explicit idempotency key; see Part 19)

Read-only capabilities audited:
8

Side-effect classification mismatches:
0

Capability Gateway bypasses in R2:
0

WAITING_CUSTOMER reactivation bug:
FIXED

Same-cycle re-execution after missing_information:
0 / 1 (WC01/WC02, plus the settle-reprojection site WC03 - both closed)

Irrelevant-message reactivation:
0 / 1 (WC05)

Relevant-input reactivation:
PASS (WC06/WC07)

WAITING_SYSTEM / WAITING_CUSTOMER separation:
PASS

Unknown capability execution:
FAIL_CLOSED

Legacy + R2 double execution risk:
0

Fact read/write profile:
VALIDATED

A09 parallel safety metadata:
VALIDATED

Product selection:
PASS

Destination:
PASS

Shipping:
PASS

CREATE_QUOTE:
SEMANTIC_ONLY (real Quote Service unavailable in this environment - internal contract fully
validated: idempotency key, evidence-repair, 10/10 live semantic reachability)

Handoff:
PASS

Customer Profile / RFM role:
Legacy Agent Tool Loop prompt-context provider only (buildAgentStepPromptPackage.ts) - never a
tool, never a planner input, never consumed by R2/CommercialWork

Quote Service external E2E:
NOT_AVAILABLE

Capability coverage matrix:
CREATED

Focused A10 tests:
11/11 PASS (WC01-WC12, one test covers WC01+WC02); 169/169 PASS (directly-affected regression
files)

A07.5 invariants:
PASS

A08 sequencing:
PASS

A08.5 inbound:
PASS

A08.6 semantic:
PASS

A08.7 cancellation:
PASS

A09 parallel:
PASS

lostCommercialWorkRate:
0%

unbackedCommercialMutationClaimRate:
0%

duplicateSideEffectRate:
0%

staleEvidenceExecutionRate:
0%

staleTurnAuthoritativeWriteRate:
0%

Live DeepSeek smoke:
PASS (14/14 quantity, 30/30 cancellation, 10/10 create_quote semantic reachability, all 100%)

Long commercial regression:
PASS (2330/2337 across tests/commercial + tests/agent-loop combined; 7 pre-existing/unrelated
"Missing DATABASE_NAME" failures + 1 pre-existing timing flake confirmed passing in isolation)

Long agent-loop regression:
PASS (included in the combined tests/commercial + tests/agent-loop run above)

Long e2e regression:
PASS (41/43; 2 pre-existing/unrelated failures already documented in docs/ACTIVE_RELEASE.md)

Production worker activation:
NO

Production follow-up activation:
NO

Public WhatsApp access change:
NO

Typecheck:
PASS

Build:
PASS

A10 blocking debt:
NONE

A11 readiness:
A11_READY

Verdict:
CAPABILITY_COVERAGE_VALIDATED

Recommended next:
SALES-AGENT-R2-A11 - Autonomous Runtime Operationalization and Controlled Rollout

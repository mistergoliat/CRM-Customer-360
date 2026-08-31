# SALES-AGENT-R3-A04 -- Read / Action Tool Surface Separation

Status: implemented, real-database verified. No production routing changed,
`SalesAgentHarness` was not built or made primary, no new Capability Gateway
capability was added, no capability was removed from
`AGENT_LOOP_TOOL_POOL`/`CommercialActionRequest`, and Capability Gateway was
never bypassed. Establishes the permanent R3 agent-facing capability model:
every capability the future `SalesAgentHarness` may see resolves to exactly
one of `READ_TOOL`, `COMMERCIAL_ACTION`, or `NOT_AGENT_EXPOSED`
(`docs/architecture/SALES-AGENT-R3-A00-target-architecture.md`, Phase 2.C/D,
Phase 6's `R3-A04` line item).

## Architectural invariant (unchanged, now structurally enforced end to end)

```
LLM may invoke reads.
LLM may request mutations.
LLM may never directly invoke a mutating business capability.
```

```
READ:                              MUTATION:
Agent                              Agent
  |                                  |
ReadToolRequest                    CommercialActionRequest
  |                                  |
ReadToolGateway                    validation
  |                                  |
Capability Gateway  <---------------+  identity/governance (R3-A02, reused)
  |                                  |
read-only capability                Capability Gateway
                                       |
                                     mutating capability
```

## Phase 1/2 -- Audit and canonical classification

Read live code before classifying anything (`AGENT_LOOP_TOOL_POOL` in
`agent-loop/runAgentToolLoop.ts`, `CAPABILITY_GATEWAY_REGISTRY` in
`capability-gateway/registry.ts`, `capability-gateway/identityGate.ts`,
`commercial-action-request/*`, `multi-intent/actionPlanExecutor.ts`), not
capability names.

**Before this slice**: `processUseToolStep` (`runAgentToolLoop.ts`) had
exactly one branch: `buildCommercialActionRequestFromAtlStep(...)` returns
non-null for the four R3-A03 mutating actions and routes through
`CommercialActionRequest`; everything else -- every read-only tool -- fell
through to a bare `executeGovernedCapability(step.tool, ...)` call with no
typed request object, no explicit classification, and no boundary preventing
a future mutating capability from being silently added to that same
fallback. This is the exact undifferentiated allowlist A00 Phase 5 flagged
("`AGENT_LOOP_TOOL_POOL` / `toolAliases.ts` -- Fixed LLM-facing tool
allowlist, read+mutate mixed").

**New canonical source**: `lib/brain/commercial/agent-capability-exposure/types.ts`
exports `AGENT_CAPABILITY_EXPOSURE_CLASSIFICATION: Record<string, AgentCapabilityExposure>`,
one explicit entry per capability registered in `CAPABILITY_GATEWAY_REGISTRY`
(17 entries at the time of this task), plus `resolveAgentCapabilityExposure()`
(defaults unknown capabilities to `NOT_AGENT_EXPOSED`, fail closed) and
`listCapabilitiesByExposure()`. This module never re-derives existence,
governance, schemas, or execution -- `capability-gateway/registry.ts` remains
the single source of truth for those; the classification map only answers
"may an agent see/use this capability, and through which surface?". A test
(`agentCapabilityExposure.test.ts`, "every capability registered... has
exactly one R3 classification, no gaps, no stale entries") diffs this map's
keys against the live registry both directions, so a future capability added
to the Gateway without a classification entry fails a test rather than
silently reaching either surface or falling through the old bare-Gateway path.

### Exhaustive classification (all 17 registered capabilities)

| Capability | sideEffect | authority | risk | Identity req. | Current caller(s) before A04 | R3 classification |
|---|---|---|---|---|---|---|
| `search_products` | read_only | autonomous | low | NONE | ATL (pool) | **READ_TOOL** |
| `get_product_details` | read_only | autonomous | low | NONE | ATL (pool) | **READ_TOOL** |
| `explore_catalog` | read_only | autonomous | low | NONE | ATL (pool) | **READ_TOOL** |
| `search_company_knowledge` | read_only | autonomous | low | NONE | ATL (pool) | **READ_TOOL** |
| `recommend_catalog_products` | read_only | autonomous | low | NONE | ATL (pool) | **READ_TOOL** |
| `calculate_shipping` | read_only | autonomous | low | NONE | ATL (pool) | **READ_TOOL** |
| `select_products` | mutating | autonomous | low | NONE | ATL via `CommercialActionRequest` | **COMMERCIAL_ACTION** |
| `set_shipping_destination` | mutating | autonomous | low | NONE | ATL via `CommercialActionRequest` | **COMMERCIAL_ACTION** |
| `select_shipping_option` | mutating | autonomous | low | NONE | ATL via `CommercialActionRequest` | **COMMERCIAL_ACTION** |
| `create_quote` | mutating | autonomous | medium | `MINIMUM_LEVEL LEVEL_2` | ATL via `CommercialActionRequest` | **COMMERCIAL_ACTION** |
| `batch_get_products` | read_only | autonomous | low | NONE | internal hydration only, no alias | **NOT_AGENT_EXPOSED** |
| `resolve_customer` | read_only | autonomous | low | NONE | `resolveNativeCustomerSession` directly | **NOT_AGENT_EXPOSED** |
| `create_customer` | mutating | autonomous (self-governed) | medium | excluded by design | `runCustomerOnboardingPostPlanStage` directly | **NOT_AGENT_EXPOSED** |
| `link_external_identity` | mutating | autonomous (self-governed) | medium | `MINIMUM_LEVEL LEVEL_2` | `runCustomerOnboardingPostPlanStage` directly | **NOT_AGENT_EXPOSED** |
| `link_prestashop_identity` | mutating | autonomous (self-governed) | medium | own `READY_TO_LINK` precondition | `runCustomerOnboardingPostPlanStage` directly | **NOT_AGENT_EXPOSED** |
| `get_customer_purchase_history` | read_only | autonomous | low | `customer_profile_history` -> `LEVEL_3` (re-gated internally) | CommercialWork executor only, no alias | **NOT_AGENT_EXPOSED** |
| `get_customer_recommendation_signal` | read_only | autonomous | low | `customer_profile_history` -> `LEVEL_3` (re-gated internally) | CommercialWork executor only, no alias | **NOT_AGENT_EXPOSED** |

`AGENT_LOOP_TOOL_POOL` (the fixed 10-entry array `runAgentToolLoop.ts` already
enforced pre-A04) is exactly the union of the `READ_TOOL` and
`COMMERCIAL_ACTION` rows above -- verified by test
(`agentCapabilityExposure.test.ts`, "every capability in AGENT_LOOP_TOOL_POOL
is classified READ_TOOL or COMMERCIAL_ACTION, never NOT_AGENT_EXPOSED").

**Documentation-vs-code discrepancy found and evidence-recorded, not
silently corrected**: `docs/releases/SALES-AGENT-R3-A02-generalized-identity-gate.md`'s
own audit table lists `calculate_shipping` as `mutating` and
`get_customer_purchase_history`/`get_customer_recommendation_signal` as
"mutating (durable read persisted as fact)". `git blame` on the three
capability files (`c57b9a7` for `calculate_shipping`, `1135036` for the
select-shipping-option-era commit that predates it, `0ca08bd` for
`get_customer_purchase_history`) shows `governance.sideEffect: "read_only"`
since each capability's original introduction -- never `mutating`, never
changed. Per `AGENTS.md` ("No modificar auditorias historicas"), A02's
document is left untouched; this is the sanctioned way to record the
correction (Phase 8/9's own "document evidence" instruction), not a rewrite
of history.

## Phase 3/4 -- ReadToolRequest domain model and ReadToolGateway

New module `lib/brain/commercial/read-tool-request/`, mirroring A03's
`commercial-action-request/` module shape exactly (same file-per-concern
layout, same DI-seam conventions):

```ts
type ReadToolRequest = {
  requestId: string;       // deterministic - requestIdentity.ts, same
                            // canonicalJson+sha256 pattern as A03's requestId,
                            // used only for observability/dedupe (no mutation-
                            // grade idempotency needed - reads have no
                            // business side effect to duplicate-protect)
  conversationId: number;
  opportunityId: number | null;
  correlationId: string;
  causationId: string | null;
  tool: string;             // a Capability Gateway capability name
  input: Record<string, unknown>;
  createdAt: string;
};
```

`executeReadTool()` (`executeReadTool.ts`) is the ReadToolGateway:

1. resolve ReadTool -> Capability Gateway capability (same name, no alias table)
2. confirm explicit `READ_TOOL` classification -- reject closed otherwise
3. resolve `governance` via `resolveCapabilityGovernance()` -- **read fresh on
   every call, never cached from the classification map**
4. **REQUIRE `governance.sideEffect === "read_only"`** -- the critical
   invariant the task named explicitly. Proven by test
   (`readToolRequest.test.ts`, "a mutating capability is rejected even when
   the exposure classification (injected) incorrectly says READ_TOOL"): an
   injectable `resolveExposure` DI seam on `ExecuteReadToolDependencies` lets
   a test force step 2 to (wrongly) say `READ_TOOL` for `select_products`
   (a genuinely mutating capability) and confirm step 3/4 still independently
   rejects it (`capability_not_read_only`, `executionPublicId: null` --
   `executeGovernedCapability` never called). If a capability's own
   registration later flips from `read_only` to `mutating` without anyone
   touching this module, this check fails it closed automatically, not by
   convention.
5. (deliberately non-blocking -- see below)
6. call `executeGovernedCapability` -- the same, unbypassed execution choke
   point every other caller (R2, ATL's own mutating branch, multi-intent,
   onboarding) already goes through
7. map the result into a typed `ReadToolResult`

### Step 5 -- schema validation is deliberately advisory, not blocking

The task brief's Phase 4 point 5 asks for "validate input against existing
capability schema". A03's `CommercialActionRequest` boundary does this as a
**blocking** pre-Gateway gate for its four mutating actions
(`commercial-action-request/schemaValidation.ts`), and this task's first
implementation of `ReadToolGateway` copied that pattern directly.

**Real regression evidence found during this task's own build** (caught by
running the full `runAgentToolLoop.test.ts` suite after wiring the gateway
in, not assumed): `CapabilityGatewayDefinition.inputSchema` is documented at
its own declaration site (`capability-gateway/types.ts`) as advisory --
*"never required, never enforced at this layer... this is what the model is
told to aim for"* -- and at least two `READ_TOOL` capabilities are
intentionally **more lenient** than their own exported schema:

- `get_product_details`'s `asProductId()` accepts a numeric `productId` even
  though `GET_PRODUCT_DETAILS_INPUT_SCHEMA` types it `string` --
  `runAgentToolLoop.test.ts`'s pre-existing `pendingCatalogAction` tests call
  it with `{ productId: 123 }` (a number) and expect it to reach the real
  capability; a blocking schema gate rejected it instead
  (`toolExecutionCount` stayed `0` instead of `1`).
- `explore_catalog` accepts a legacy `{orderBy, orderDirection}` shape as a
  deliberate bridge for a real, already-documented past production incident
  (`registry.ts#asLegacySortAlias`, ACS-R1-05.1-T02.6.1's real
  `sort_and_limit_required` incident) that `EXPLORE_CATALOG_INPUT_SCHEMA`
  does not reflect (`sort` is declared `required`). A blocking gate produced
  a generic schema-layer error code instead of the capability's own precise,
  tested `sort_and_limit_required` -- `runAgentToolLoop.test.ts`'s own
  regression test for that exact incident caught the mismatch.

Blocking here would duplicate and actively conflict with logic the
capability already, correctly owns -- exactly what Phase 4's own "do not
duplicate capability validation" principle (and A03's own Phase 4 precedent)
warns against, generalized to a case A03 never hit because none of its four
mutating capabilities have this kind of intentional leniency. Unlike
`CommercialActionRequest`'s mutations, a read has no business side effect a
malformed call could corrupt -- every read capability's own `execute()`
already validates required fields before any external call
(`asQueryText`/`asProductId`/etc.), so nothing protective is lost by leaving
this to `execute()` alone. `executeReadTool.ts` documents this decision
inline with the exact evidence above; `readToolRequest.test.ts` proves it
both ways (`search_company_knowledge` with a missing `query` reaches the real
capability and gets its own `query_required`, not a pre-Gateway rejection;
`calculate_shipping` with `{}` reaches the real capability).

## Phase 5 -- Disjointness proof

`intersection(listCapabilitiesByExposure("READ_TOOL"), listCapabilitiesByExposure("COMMERCIAL_ACTION")) = []`,
tested directly (`agentCapabilityExposure.test.ts`, "READ_TOOL and
COMMERCIAL_ACTION capability sets are disjoint"), plus a second test proving
the `COMMERCIAL_ACTION` set is *exactly* `COMMERCIAL_ACTION_SUPPORTED_CAPABILITIES`
(A03's own canonical set, `commercial-action-request/actionCapabilityMapping.ts`)
-- no drift between the two modules is possible without failing a test.
`CommercialActionRequest` itself (A03, `SELECT_PRODUCTS` /
`SET_SHIPPING_DESTINATION` / `SELECT_SHIPPING_OPTION` / `CREATE_QUOTE`,
mapped 1:1 to their capabilities) is unchanged by this task -- no fifth
action, no schema duplication, no new registry.

## Phase 6/12 -- Provider-neutral AgentToolCatalog

`lib/brain/commercial/agent-capability-exposure/agentToolCatalog.ts`:

```ts
type AgentToolCatalog = {
  readTools: AgentReadToolDescriptor[];       // {name, description, inputSchema, surfaceNote}
  commercialActions: AgentCommercialActionDescriptor[]; // {actionType, capability, description, inputSchema, surfaceNote}
};
```

`buildAgentToolCatalog()` derives `readTools` from `AGENT_LOOP_TOOL_POOL`
filtered to `READ_TOOL` (never a second hardcoded tool list) and
`commercialActions` from `COMMERCIAL_ACTION_REQUEST_TYPES` +
`actionCapabilityMapping.ts` -- every `description`/`inputSchema` field is
read straight from the Capability Gateway/A03 mapping, never redefined here.
`surfaceNote` carries the exact framing text the task specified
(`READ_TOOL_SURFACE_NOTE` = *"Invoke this tool to retrieve information. It
has no business side effect."*, `COMMERCIAL_ACTION_SURFACE_NOTE` = *"Request
this commercial action. The request may be denied, blocked, require
identity, or fail. Requesting it does not authorize execution."*) as a
distinct field, never mixed into `description`.

**Deliberately not wired into `runAgentToolLoop.ts`'s live
`buildToolDescriptions()` in this slice.** That function's output feeds the
real, already-deployed prompt today; Phase 7 requires preserving existing
customer-visible semantics unchanged, and `SalesAgentHarness` -- the actual
consumer this catalog's richer, surfaceNote-carrying shape is for -- does not
exist yet (explicitly out of scope for A04, per the task's own "Do not build
the complete SalesAgentHarness"). This is the intermediate, provider-neutral
shape a future Harness prompt/tool-schema builder can render differently
(DeepSeek, an OpenAI-compatible provider, or a future one) without depending
on any provider-specific JSON -- exactly Phase 12's "define the intermediate
shape... do not implement several serializers now" instruction. Tested for
exhaustiveness and absence of internal-only capabilities
(`agentCapabilityExposure.test.ts`, "AgentToolCatalog.readTools contains
exactly the READ_TOOL subset... no internal-only capability").

## Phase 7 -- ATL adaptation

`processUseToolStep` (`runAgentToolLoop.ts`) previously had the two-branch
fallback described in Phase 1. It now classifies explicitly, before either
adapter is consulted:

```
const exposure = resolveAgentCapabilityExposure(step.tool);
if (exposure === "NOT_AGENT_EXPOSED") -> fail closed (blocked observation,
                                          governance: "blocked_not_exposed",
                                          never reaches either adapter)
else if (exposure === "COMMERCIAL_ACTION") -> buildCommercialActionRequestFromAtlStep(...)
                                               -> executeCommercialActionRequest (A03, unchanged)
else (READ_TOOL)                           -> buildReadToolRequestFromAtlStep(...)
                                               -> executeReadTool (new)
```

Every check that already ran before this point -- dedupe, the
`recommend_catalog_products`/`select_products` evidence gates, the
`get_product_details` pending-recommendation gate -- is untouched; only the
final dispatch changed. The `NOT_AGENT_EXPOSED` branch is structurally
unreachable today (`AGENT_LOOP_TOOL_POOL` only contains capabilities
classified `READ_TOOL` or `COMMERCIAL_ACTION`, proven by test), kept as
defense in depth so a future pool addition without a classification entry
fails closed instead of silently falling through to a bare Gateway call --
exactly the gap this task closes. `agentStepTypes.ts#AgentLoopStepRecord.governance`
and `events/types.ts#AgentToolLoopStepSummary.governance` both gained the new
`"blocked_not_exposed"` value, additively (existing `!== "authorized"` checks
in `shadowRecorder.ts` and the multi-intent scorer already treat any
non-`"authorized"` value generically, verified unaffected by test).

`buildReadToolRequestFromAtlStep` (`read-tool-request/atlAdapter.ts`) mirrors
A03's `buildCommercialActionRequestFromAtlStep` exactly: returns `null` when
`conversationId` is unavailable (the caller then falls back to calling
`executeGovernedCapability` directly, byte-identical to pre-A04 behavior --
e.g. the benchmark harness) or when the tool is not classified `READ_TOOL`.

**Multi-intent (`multi-intent/actionPlanExecutor.ts`) is intentionally not
touched.** Read live: its `PlannedActionStep{capability, arguments}` is never
a raw model tool-call name -- it is the deterministic output of
`executionPlanner.ts` resolving a bounded, enum-typed
`CommercialIntentPlan` (one LLM call into a fixed intent vocabulary,
`parseCommercialIntentPlan.ts`) into capability arguments. There is no
"model names a capability, runtime calls it" shape here for this task's
read/action split to apply to -- the model never picks a capability by name
in multi-intent. A03's own Phase 10 already deferred multi-intent's
`CommercialActionRequest` adoption to a future task with the same reasoning;
this task does not reopen that scope.

## Phase 8 -- calculate_shipping decision: READ_TOOL, evidence-backed

Real audit of `calculateShippingCapability.ts#execute()` (not documentation):
resolves the already-durable `shipping_destination` (T13D) and
`commercial_line_items` (T13E.2) facts, hydrates products via
`CatalogPort.batchGetProducts` (read), calls `CarrierService.quoteAll()`
(external read/query, never a write), and returns a computed quote. It
**persists nothing of its own** -- no `crm_request_facts` write, no
`INSERT`/`UPDATE` anywhere in the function body. `governance.sideEffect` has
been `"read_only"` since this capability's introduction (`git blame c57b9a7`,
`git log -p` confirms no history of `"mutating"`). Classified `READ_TOOL`.
This matches `docs/architecture/SALES-AGENT-R3-A00-target-architecture.md`
Phase 2.C's own characterization ("`calculate_shipping` (a read-only external
call)") -- no material contradiction found, so A00 is left unmodified.

## Phase 9 -- customer history / recommendation signal: NOT_AGENT_EXPOSED

Real audit of `getCustomerPurchaseHistoryCapability.ts` and
`getCustomerRecommendationSignalCapability.ts`: both `execute()` functions
call `loadCommercialCustomerContext()` and map its result to a typed output
-- no persistence anywhere in either file. `governance.sideEffect` has been
`"read_only"` since introduction (`git blame 0ca08bd`). Structurally, both
could pass `ReadToolGateway`'s critical `read_only` check today.

Classified `NOT_AGENT_EXPOSED` anyway, per the task's own explicit Phase 9
preference: neither capability is aliased in `AGENT_LOOP_TOOL_POOL` today --
both are dispatched exclusively by `CommercialWork`'s deterministic
`REPEAT_PURCHASE`/`CUSTOMER_AWARE_RECOMMENDATION` executor, gated on live
`LEVEL_3_PRESTASHOP_LINKED` identity via their own internal re-gate inside
`loadCommercialCustomerContext` (never the generic A02 gate, since that gate
skips read-only capabilities entirely -- `identityGate.ts`'s own first line,
`if (governance.sideEffect !== "mutating") return { allowed: true };`).
Exposing either as a free-standing agent-callable read tool would let the
model pull a customer's purchase history/recommendation signal outside the
controlled objective flow that today's identity re-gate was built around, for
no product need this task was asked to add. LEVEL_3 identity protection is
preserved exactly as-is (unchanged code, unchanged gate). No adapter was
built to expose a "safer read projection" either -- `loadCommercialCustomerContext`
itself already is that safer, narrower boundary, and it remains
CommercialWork-only.

## Phase 10 -- recommend_catalog_products decision: READ_TOOL

`recommend_catalog_products` is already in `AGENT_LOOP_TOOL_POOL`
(`CP-R1-T10B8C`), already `governance.sideEffect: "read_only"`, and already
has real, tested, evidence-gated ATL infrastructure built around it
(`resolveObservedRecommendationSourceProduct.ts`, `pendingCatalogAction.ts`'s
recommendation-continuity tracking, `buildToolObservation.ts`'s dedicated
projection). Removing it from the agent-visible surface (making it
`NOT_AGENT_EXPOSED` on the theory that the future Harness should recombine
lower-level reads itself) would be a real customer-visible behavior
regression against an already-deployed capability -- explicitly prohibited
by this task ("no routing changes", "preserve... customer-visible
semantics", "do not remove ATL"). Classified `READ_TOOL`, preserving current
behavior exactly. `registry.ts`'s own comment on this capability
("deliberately not added to AGENT_LOOP_TOOL_POOL") is stale documentation
predating `CP-R1-T10B8C` (which did add it) -- noted here as evidence, not
edited (out of scope: not this task's file to fix, and editing a comment
carries no functional weight).

## Phase 11 -- Future capability extension contract

Every future agent-usable capability must provide, before it can be called
by any agent-facing runtime:

1. Capability Gateway registration (`capability-gateway/registry.ts`)
2. governance metadata (`sideEffect`/`authority`/`riskClass`)
3. input schema (`CapabilityGatewayDefinition.inputSchema`)
4. output contract (typed `execute()` return shape)
5. **an explicit R3 exposure classification** -- one new entry in
   `agent-capability-exposure/types.ts#AGENT_CAPABILITY_EXPOSURE_CLASSIFICATION`:
   `READ_TOOL`, `COMMERCIAL_ACTION`, or `NOT_AGENT_EXPOSED`. Omitting this
   entry is not a silent default to "exposed" -- `resolveAgentCapabilityExposure`
   defaults an unclassified name to `NOT_AGENT_EXPOSED`, and
   `agentCapabilityExposure.test.ts`'s exhaustiveness test fails the build if
   a registered capability has no entry at all, in either direction.
6. tests: at minimum, the capability's exposure classification, and (if
   `COMMERCIAL_ACTION`) an `actionCapabilityMapping.ts` entry.

Illustrative worked examples per the task brief: `search_inventory` /
`get_expected_restock` -> `READ_TOOL`; `calculate_financing` -> `READ_TOOL`
if genuinely pure (audit first, per Phase 8's method); `apply_discount` /
`create_order` / `refund_order` -> `COMMERCIAL_ACTION` (each would also need
a new `CommercialActionRequestType` in A03's module, still no second
Capability Gateway); `link_identity`-shaped capabilities -> `NOT_AGENT_EXPOSED`
unless explicitly designed otherwise, matching every identity capability's
classification in this task's own matrix.

Adding one requires none of: a new semantic intent enum, a new conversational
objective, a new planner branch, a new Harness runtime path -- the
classification map is the only new artifact, and `ReadToolGateway`/
`CommercialActionRequest` are already generic over any capability name.

## Phase 13 -- Observability

Read tool calls continue to land in `crm_capability_executions` -- for free,
since `ReadToolGateway` calls the same `executeGovernedCapability()` every
other caller does; no second audit path was built. `AgentSession` gains its
first real emitter of A01's reserved `READ_TOOL_REQUESTED`/`READ_TOOL_COMPLETED`/
`READ_TOOL_FAILED` vocabulary (`read-tool-request/sessionEvents.ts`, shadow/
additive only -- a session-recording failure never blocks or fails a real
read, same discipline as `commercial-action-request/sessionEvents.ts`).
Payloads are small, fixed-key records (`tool`, `opportunityId`,
`resultStatus`, `stableErrorCode`) -- never raw model output, never a
product/price/stock payload -- verified with an exact `Object.keys` assertion
and a regex sweep for phone/reasoning/prompt patterns
(`readToolRequest.test.ts`). `requestId`/`correlationId`/`causationId`/
`conversationId`/`opportunityId` are threaded through identically to A03's
boundary. No new table was created.

## Phase 14 -- Tests

**New**: `tests/commercial/agentCapabilityExposure.test.ts` (13 tests) and
`tests/commercial/readToolRequest.test.ts` (14 tests), 27 tests total, all
green against real MariaDB (`main_management`, the same local dev database
`commercialActionRequest.test.ts`/`runAgentToolLoop.test.ts` already use).
Covers: exhaustive one-classification-per-registered-capability with no gaps
or stale entries; disjoint `READ_TOOL`/`COMMERCIAL_ACTION` sets; the
`COMMERCIAL_ACTION` set matches A03's mapping exactly; unknown capability
fails closed; the four A03 actions classified `COMMERCIAL_ACTION`; the six
live read tools classified `READ_TOOL` with evidence-backed rationale for
`calculate_shipping`/`recommend_catalog_products`; `get_customer_purchase_history`/
`get_customer_recommendation_signal`/`batch_get_products`/every identity
capability classified `NOT_AGENT_EXPOSED`; every `AGENT_LOOP_TOOL_POOL` entry
resolves to `READ_TOOL` or `COMMERCIAL_ACTION`, never `NOT_AGENT_EXPOSED`;
`AgentToolCatalog` exhaustiveness and no internal-only leakage; ATL adapter
null-cases (mutating tool, `NOT_AGENT_EXPOSED` tool, null conversationId);
deterministic `requestId`; a real read (`search_company_knowledge`, zero
external dependency) completing and writing a real `crm_capability_executions`
row; a genuinely mutating capability rejected by `ReadToolGateway` both under
normal classification and under an injected wrong classification (the
critical invariant, proven in isolation via the `resolveExposure` DI seam);
an unregistered tool name failing closed; schema-mismatch cases proven to
reach the real capability, not be re-validated here (with evidence for why);
`AgentSession` event sequencing for both completed and rejected reads; no
PII/raw-output in session payloads.

**Regressions** (all run against real MariaDB, `--test-concurrency=1`):

- **Batch 1** (322 tests): the two new files above plus
  `tests/agent-loop/{runAgentToolLoop,runNativeAgentToolLoopCycleConfig,
  pendingCatalogAction,recommendCatalogProductsAgentLoopIntegration,
  recommendCatalogProductsToolExposure,recommendCatalogProductsSkippedEventPersistence,
  buildAgentStepPromptPackage,multi-intent/runCommercialMultiIntentLoop}.test.ts`
  plus `tests/commercial/commercialActionRequest.test.ts` (A03's own 29-test
  suite, confirming that boundary is byte-identical after the dispatch
  refactor) -- **322/322 green** on the final run. Getting there surfaced and
  fixed three real test failures during this task's own development, from
  two distinct root causes in the originally-blocking schema-validation step
  (the `explore_catalog` legacy-alias case and the numeric-`productId` case,
  both documented in Phase 4 above) -- confirmed clean only after that step
  was made advisory, not before.
- **Batch 2** (270 tests): `tests/commercial/{capabilityGatewayIdentityGate,
  identityCapabilityGatewaySummaries,selectProductsCapability,
  shippingDestinationCapability,selectShippingOptionCapability,
  createQuoteCapability,calculateShippingCapability,
  catalogRecommendationGatewayAdapter,catalogRecommendationGatewayAdapterIntegration}.test.ts` --
  **270/270 green**.
- **Batch 3** (30 tests): `tests/agent-loop/{benchmark/scoring,
  commercialMutationClaims,multi-intent/actionPlanExecutor}.test.ts` +
  `tests/commercial/agentToolLoopSessionShadow.test.ts` -- **30/30 green**,
  including direct coverage of the new `"blocked_not_exposed"` governance
  value's consumers.
- **Batch 4** (87 tests): `tests/commercial/{agentSessionSanitizer,
  agentSessionStore,agentSessionStoreMariaDb,agentSessionSummary,
  commercialWorkIdentityConversation,commercialWorkIdentityGating,
  commercialWorkIdentityOnboarding}.test.ts` -- **84/87 green**, 3 pre-existing
  failures in `agentSessionStore.test.ts` confirmed identical against the
  unmodified `develop` baseline via `git stash` (fixture events hardcoded at
  `2026-08-30T10:0X:XX.000Z`, `AGENT_SESSION_DEFAULT_MAX_AGE_MS` is a 24h
  window, and this sandbox's real system clock had already advanced to
  `2026-08-31T17:17 UTC` by the time this task ran -- more than 24h past the
  fixtures, so `loadRecentEvents` correctly filters them out as stale). Not
  caused by this task, not touched by this task's diff (`agentSessionStore.test.ts`
  was not modified); registered as pre-existing environment/fixture-clock
  debt, not fixed here (out of scope -- this task does not touch
  `agent-session/store.ts`/`inMemoryAgentSessionStore.ts`).

Total: **706/709 targeted tests green** (322+270+30+84), the remaining 3
confirmed pre-existing and unrelated.

`npx tsc --noEmit`: **zero net-new errors** -- the only remaining diagnostics
are the same pre-existing `experiments/deepseek-harness/**` declaration
errors A02/A03 already documented as baseline, reproduced identically,
untouched by this task. `npm run build`'s type-check step was not run to
completion separately since it fails at the same documented pre-existing
step; per this task's own instruction ("reproduce and document the baseline
exactly rather than changing experimental code"), that is not fixed here.

One real, non-obvious TypeScript finding surfaced and fixed during test
authoring (documented inline in `agentCapabilityExposure.test.ts`, not a
runtime bug): `node:assert/strict`'s `deepEqual` is `deepStrictEqual<T>(actual: unknown, expected: T): asserts actual is T` --
an assertion-signature generic that narrows the *actual* argument's static
type to the *expected* argument's inferred type for the rest of the
enclosing scope. Comparing a `string[]` against an array whose element type
was still the narrow `AgentLoopToolName` union silently narrowed the
`string[]` variable for every later use in the same test, breaking plain
membership checks. Fixed by explicitly widening the `expected` array's
declared type to `string[]`.

## Files changed

New:
`lib/brain/commercial/agent-capability-exposure/{types,agentToolCatalog,index}.ts`,
`lib/brain/commercial/read-tool-request/{types,requestIdentity,atlAdapter,executeReadTool,sessionEvents,index}.ts`,
`tests/commercial/{agentCapabilityExposure,readToolRequest}.test.ts`.

Edited: `agent-loop/runAgentToolLoop.ts` (explicit classification dispatch,
additive imports, `governance` return type widened), `agent-loop/agentStepTypes.ts`
(`AgentLoopStepRecord.governance` gains `"blocked_not_exposed"`),
`events/types.ts` (`AgentToolLoopStepSummary.governance` gains the same,
kept in sync), `agent-session/dedupe.ts` (one new dedupe-key builder,
additive, mirroring the existing `buildCommercialActionRequestDedupeKey`).

## Limitations

- Multi-intent's `actionPlanExecutor.ts` and R2's `commercialWorkExecutor.ts`
  still call `executeGovernedCapability` directly, unmediated by either
  `ReadToolGateway` or `CommercialActionRequest` -- unchanged from A03's own
  documented limitation, and out of scope here: neither runtime has a
  "model names a capability, runtime calls it" shape for this task's split
  to apply to (Phase 7 above).
- `AgentToolCatalog`'s `surfaceNote` framing text exists as a real, tested
  domain value but is not yet rendered into ATL's live prompt
  (`buildToolDescriptions()`/`buildAgentStepPromptPackage.ts` are unchanged) --
  deliberately deferred to the future `SalesAgentHarness`, per Phase 6 above.
- `get_customer_purchase_history`/`get_customer_recommendation_signal` are
  structurally `read_only` today and could technically pass
  `ReadToolGateway`'s critical check if ever aliased into
  `AGENT_LOOP_TOOL_POOL` -- they remain unaliased and `NOT_AGENT_EXPOSED` by
  this task's own classification choice (Phase 9), not by a technical
  impossibility. A future task that wants to expose either to the Harness
  must change the classification map deliberately, not rely on the
  underlying capability's governance alone.
- Schema validation in `ReadToolGateway` is advisory, not enforced (Phase 4) --
  a documented, evidence-backed, deliberate choice, not an oversight.

## Rollback

Revert the two new module directories
(`agent-capability-exposure/`, `read-tool-request/`) and their test files,
and the four edited files
(`runAgentToolLoop.ts`/`agentStepTypes.ts`/`events/types.ts`/`agent-session/dedupe.ts`).
No migration, no schema change, no flag. `processUseToolStep`'s dispatch
reverts to A03's original two-branch fallback the moment the new imports are
removed; every mutating tool call still routes through `CommercialActionRequest`
exactly as A03 left it, and every read-only tool call falls back to calling
`executeGovernedCapability` directly -- the pre-A04 behavior, unchanged in
substance (only the typed boundary and observability around it disappear).

## Recommended R3-A05

Per `docs/architecture/SALES-AGENT-R3-A00-target-architecture.md` Phase 6:
unify follow-up re-entry (replace the legacy synthetic-inbound-message path
with a structured wake event the Harness can never confuse with real
customer text, generalizing `objectiveAwareFollowUp.ts`'s existing
bypass-the-LLM template-dispatch pattern). This task's own read/action split
does not block or require that work; it is the next item A00's own
sequencing already named, and closing it before A06 (`crm_opportunities`
creation on the Harness path) matches A00's stated ordering rationale.

## Exit criteria

Declaring `R3_A04_READ_ACTION_TOOL_SURFACES_VALIDATED`:

- Every agent-visible capability has one explicit R3 classification --
  confirmed, exhaustive test (Phase 2).
- Read and action capability surfaces are structurally disjoint -- confirmed,
  tested both ways (Phase 5).
- A mutating capability cannot execute through `ReadToolGateway` -- confirmed,
  including under an injected wrong classification (Phase 4, the critical
  invariant, tested in isolation).
- `CommercialActionRequest` remains the sole agent-facing mutation boundary --
  confirmed unchanged, 29/29 A03 tests still green (Phase 5/7).
- ATL uses the explicit split -- confirmed, `processUseToolStep` now
  classifies before dispatching (Phase 7).
- No generic agent-tool -> Capability Gateway mutation bypass remains for an
  agent-visible capability -- confirmed: every `AGENT_LOOP_TOOL_POOL` entry
  now resolves through an explicit classified branch, `NOT_AGENT_EXPOSED`
  fails closed as defense in depth (Phase 7).
- `calculate_shipping` classification resolved from real implementation --
  confirmed, `READ_TOOL`, evidence documented (Phase 8).
- Customer history/recommendation signal classification resolved from real
  implementation -- confirmed, `NOT_AGENT_EXPOSED` by deliberate product
  choice over a structurally-eligible capability, evidence documented
  (Phase 9).
- Future capability extension contract is explicit -- confirmed, documented
  and structurally enforced by the exhaustiveness test (Phase 11).
- Provider-neutral agent tool catalog exists -- confirmed, `AgentToolCatalog`
  (Phase 6/12).
- Identity/evidence/governance protections remain intact -- confirmed: A02's
  identity gate untouched and still applies to every `COMMERCIAL_ACTION`;
  ATL's evidence guards (`resolveObservedRecommendationSourceProduct`,
  `commercialMutationClaims`) untouched and still run before either adapter.
- Regressions are clean -- confirmed, 706/709 targeted tests green, the
  remaining 3 pre-existing unrelated failures confirmed identical against
  the `develop` baseline (Phase 14).
- No production routing changed -- confirmed: no flag, no route, no runtime
  branch touched; the only behavior change is that a read-only ATL tool call
  now also produces `AgentSession` `READ_TOOL_*` events, with identical
  Gateway-level behavior otherwise.

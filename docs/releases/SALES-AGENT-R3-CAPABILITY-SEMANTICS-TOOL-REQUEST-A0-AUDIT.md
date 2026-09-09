# SALES-AGENT-R3-CAPABILITY-SEMANTICS-TOOL-REQUEST-A0 -- Generic Capability Semantics + Tool Request Architecture Audit

MODE: FORENSIC ARCHITECTURE AUDIT, READ-ONLY. No production code, prompt,
schema, or runtime file was changed by this task.

## 0. North star discipline applied throughout

Every proposed field below is tested against: does it change what the
architecture *is* (which capabilities exist, what their contract means, what
shape is legal, what evidence/effect class they belong to, whether execution
is authorized, how outcomes are normalized) rather than what the *model
decided this turn*. A field that would only ever hold a per-turn semantic
interpretation (`currentIntent`, `activeTopic`, `nextStep`) is rejected on
sight, independent of how useful it might look, per the task's own
prohibition and per [[SALES-AGENT-R3-V1.8.2-C2-A1]]'s identical "delete-and-
re-derive" test.

---

## 1. Current capability definition model

### 1.1 The real contract today

`CapabilityGatewayDefinition` ([types.ts:99-134](../../lib/brain/commercial/capability-gateway/types.ts#L99-L134)):

```
capability: string
version: string
description: string
governance: { sideEffect: read_only|mutating, authority: autonomous|requires_approval, riskClass: low|medium|high }
maxRetries: number
inputSchema?: Record<string, unknown>          // opaque JSON-Schema-ish, advisory only
checkAvailability(context) -> { status, reason }
execute(input, context) -> { status, data, errorCode, retryable, evidence, warnings? }
buildRequestSummary?(input, context)            // redaction override for audit persistence
buildResponseSummary?(outcome, context)         // redaction override for audit persistence
```

`CURRENT_CAPABILITY_CONTRACT`:

```
fields_present:
  identity:            capability, version
  description:         description (free prose, one field, does double duty as
                        purpose + useWhen + doNotUseWhen + operation semantics)
  input schema:         inputSchema (opaque, advisory -- see Section 8)
  risk / side-effect:   governance.sideEffect, governance.riskClass
  authority:            governance.authority (autonomous vs requires_approval --
                        real policy hook, unused today: zero registered
                        capabilities declare requires_approval, see A00
                        Section E "Confirmation/human approval")
  executor:             execute()
  availability:         checkAvailability()
  redaction/audit:       buildRequestSummary/buildResponseSummary (advisory,
                        only 4 identity capabilities supply these)

fields_missing:
  operationSemantics    (snapshot vs delta vs full-replace vs read -- exists
                        only as prose inside `description` + duplicated prompt
                        rule blocks, see 1.2 below)
  useWhen / doNotUseWhen (exists only as prose inside `description` for some
                        capabilities, and as separate immutable prompt-rule
                        constants for others -- two different places
                        depending on which capability you look at)
  evidenceRequired / evidenceProduced (exists as *working code*, not as
                        declared metadata -- see Section 10)
  outcomeSemantics       (exists as an ad hoc per-tool `data.status` string
                        the model must learn from prose; the Gateway's own
                        7-value CapabilityGatewayExecutionStatus enum is
                        infrastructure-facing, not business-outcome-facing)
  vocabularyProvider     (does not exist anywhere; no registered capability
                        needs one today -- see Section 9)
  downstream authority   (exists only as hardcoded capability-name checks in
                        prompt prose, e.g. PRODUCT_PUBLIC_LINK_RULE_LINES'
                        "search_products is not sufficient evidence for a
                        product link... use get_product_details")

fields_implicit_elsewhere:
  - operationSemantics for select_products: capability `description` string
    (registry via selectProductsCapability.ts) + SELECT_PRODUCTS_RULE_LINES
    (9 prompt-rule lines) + inline code comments in 3 files
    (selectProductsCapability.ts, registry.ts, runAgentToolLoop.ts's evidence
    gate comment block) -- the SAME fact, stated 4 separate times, in prose,
    never once as a field the code itself reads.
  - evidenceRequired for search_products/get_product_details/explore_catalog/
    recommend_catalog_products/select_products: a hardcoded tool-name set,
    `OBSERVED_EVIDENCE_SOURCE_TOOLS` in
    [resolveObservedRecommendationSourceProduct.ts:27](../../lib/brain/commercial/agent-loop/resolveObservedRecommendationSourceProduct.ts#L27),
    and a second, independently-maintained tool-name switch inside
    `collectAllowedProductIds`
    ([pendingCatalogAction.ts:150-203](../../lib/brain/commercial/agent-loop/pendingCatalogAction.ts#L150-L203)),
    and a THIRD, independently-maintained `capability_name IN (...)` SQL
    filter in
    [recentCatalogContext.ts:194](../../lib/brain/commercial/agent-loop/recentCatalogContext.ts#L194).
    Three hand-synced allowlists implementing the same underlying concept
    ("which tools produce observed product identity").
  - outcomeSemantics for search_products: the real upstream classification
    (`resolved`/`clarification_required`/`no_match`, from T12 Product Intent
    Resolution, carried in `SearchProductsCapabilityData.productIntent`,
    [registry.ts:72](../../lib/brain/commercial/capability-gateway/registry.ts#L72))
    exists in the Gateway result's `data`, but
    `buildToolObservation.ts#projectSearchProducts` ([buildToolObservation.ts:20-32](../../lib/brain/commercial/agent-loop/buildToolObservation.ts#L20-L32))
    only ever projects `{query, items}` -- `productIntent` and its
    `resolution.status` never reach the model. **This is a real, currently-
    live information-loss bug**, independent of anything this audit proposes;
    it directly explains the task brief's own Section 12 observation
    ("observation projection loses some of this information").
  - "downstream authority" for get_product_details vs search_products/
    explore_catalog: PRODUCT_PUBLIC_LINK_RULE_LINES (prose only).

duplicated_semantics:
  - select_products' full-replace meaning: capability.description (registry)
    + 9 SELECT_PRODUCTS_RULE_LINES + code comments in 3 files (Section 1.2).
  - "which tools count as observed catalog evidence": 3 independently-
    maintained tool-name allowlists (Section 10).
  - explore_catalog vs search_products vs get_product_details boundaries:
    capability.description text (3x) + EXPLORE_CATALOG_RULE_LINES (6 lines) +
    RECENT_CATALOG_CONTEXT_RULE_LINES (6 lines) + PRODUCT_PUBLIC_LINK_RULE_LINES
    (8 lines) -- the tool-selection boundary is real, correct, and stated
    nowhere near the CapabilityGatewayDefinition that describes the tools it
    governs.
```

### 1.2 Answering the critical question directly

**Yes -- capability meaning is currently split across registry description,
prompt rules, schema, evidence gates, tool observation projection, and
domain-specific code, instead of existing as one coherent generic contract.**
Concretely, for `select_products` alone, its full-replace semantic is stated
in: `capability.description` (1 sentence), `SELECT_PRODUCTS_RULE_LINES[2]`
("Each select_products call must include the customer's complete desired
selection... it replaces the entire previous selection" --
[buildAgentStepPromptPackage.ts:408](../../lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts#L408)),
a doc comment on `selectProductsCapability()` itself
([selectProductsCapability.ts:55-63](../../lib/brain/commercial/capability-gateway/selectProductsCapability.ts#L55-L63)),
and a doc comment on the evidence-gate call site in `runAgentToolLoop.ts`
([runAgentToolLoop.ts:544-559](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts#L544-L559)).
Four independent statements of one fact, hand-synchronized by convention, not
by a single field the code reads once and renders everywhere.

This is real and worth fixing, but it is smaller than it looks: **the
`description` string, read once by both `buildToolDescriptions()`
([runAgentToolLoop.ts:236-241](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts#L236-L241))
and `agentToolCatalog.ts`, is already the single canonical source for
prompt-facing prose** -- the duplication is in code *comments* documenting
that prose's intent for developers, not in a second competing prompt-facing
source of truth. The one duplication that is customer-behavior-relevant is
`description` vs the dedicated `*_RULE_LINES` blocks, and that split is
already principled (Section 7/17 below): `description` for what a capability
does and its shape, `*_RULE_LINES` for cross-turn behavioral policy
(sequencing, evidence reuse, closing-question composition) that genuinely
does not belong inside a one-line tool description.

---

## 2. AgentStep -> tool execution path

### 2.1 Exact trace

```
DeepSeek output (raw JSON)
  -> validateAgentStep()              [validateAgentStep.ts] -- shape only, never governance
  -> processUseToolStep()             [runAgentToolLoop.ts:495-733]
       -> enrichToolArguments()       [budgetMax backfill only, never a routing decision]
       -> buildDedupeKey() + executedCalls.has()   [in-turn duplicate-call guard]
       -> AGENT_LOOP_TOOL_POOL.includes() + resolveCapabilityGatewayDefinition()  [registration check]
       -> evidence gate (recommend_catalog_products / select_products only) [resolveObservedRecommendationSourceProduct]
       -> pendingCatalogAction gate (get_product_details only, recommendation-origin continuity)
       -> resolveAgentCapabilityExposure()   [agent-capability-exposure/types.ts -- READ_TOOL | COMMERCIAL_ACTION | NOT_AGENT_EXPOSED]
       -> IF COMMERCIAL_ACTION:
            ensureCommercialActionOpportunity()          [lazy opportunity resolution]
            buildCommercialActionRequestFromAtlStep()     [commercial-action-request/atlAdapter.ts]
            executeCommercialActionRequest()               [validate -> map capability -> identity gate -> executeGovernedCapability]
       -> IF READ_TOOL:
            buildReadToolRequestFromAtlStep()              [read-tool-request/atlAdapter.ts]
            executeReadTool()                              [exposure re-check -> governance re-check -> executeGovernedCapability]
  -> buildToolObservation()           [buildToolObservation.ts -- allowlisted per-tool projection]
```

`executeGovernedCapability()` ([executeCapability.ts](../../lib/brain/commercial/capability-gateway/executeCapability.ts))
is the single choke point both surfaces converge on: registration check ->
identity gate (`evaluateCapabilityIdentityGate`) -> `checkAvailability()` ->
bounded-retry `execute()` -> `insertCapabilityExecution()` (durable audit
row). No caller bypasses it -- confirmed by `capability-gateway/index.ts`'s
export surface and by both adapters' own doc comments asserting this
("the final, unbypassed execution choke point").

### 2.2 Does a first-class "ToolRequest" already exist under another name?

**Yes, twice, as two structurally near-identical, independently-typed
objects**: `ReadToolRequest` ([read-tool-request/types.ts:16-25](../../lib/brain/commercial/read-tool-request/types.ts#L16-L25))
and `CommercialActionRequest` ([commercial-action-request/types.ts:41-56](../../lib/brain/commercial/commercial-action-request/types.ts#L41-L56)):

| field | ReadToolRequest | CommercialActionRequest |
|---|---|---|
| id | `requestId` (sha256, deterministic) | `requestId` (sha256, deterministic, identical `canonicalJson` algorithm) |
| conversation anchor | `conversationId` | `conversationId` |
| opportunity anchor | `opportunityId` | `opportunityId` |
| tracing | `correlationId` | `correlationId` |
| causation | `causationId` | `causationId` |
| what to call | `tool: string` (raw capability name) | `actionType: CommercialActionRequestType` (mapped via `actionCapabilityMapping.ts`) |
| arguments | `input: Record<string, unknown>` | `input` (discriminated-union-typed per actionType) |
| timestamp | `createdAt` | `createdAt` |
| origin | (none) | `source: agent_tool_loop \| multi_intent \| commercial_work \| sales_agent_harness` |
| result | `ReadToolResult` (6-value status enum + `gatewayResult`) | `CommercialActionResult` (7-value status enum + `gatewayResult`) |

Both: build a deterministic id from the same `canonicalJson`+sha256 pattern
([requestIdentity.ts](../../lib/brain/commercial/read-tool-request/requestIdentity.ts),
[requestIdentity.ts](../../lib/brain/commercial/commercial-action-request/requestIdentity.ts));
emit shadow/additive `AgentSessionStore` events before and after execution
([sessionEvents.ts](../../lib/brain/commercial/read-tool-request/sessionEvents.ts),
[sessionEvents.ts](../../lib/brain/commercial/commercial-action-request/sessionEvents.ts));
synthesize a `CapabilityGatewayResult`-shaped value for a request rejected
before the Gateway is ever called, so `buildToolObservation` needs no second
shape either way; converge on `executeGovernedCapability` as the only real
execution path.

**This is a textbook Conclusion B**: the ToolRequest abstraction already
exists, twice, deliberately split along governance class (per
[SALES-AGENT-R3-A00-target-architecture.md Section 2.C/D](../architecture/SALES-AGENT-R3-A00-target-architecture.md) --
"formally split the pool into a read-only surface... rather than letting
both sit in one undifferentiated allowlist"), and the split is a *feature*
(read has no idempotency/identity-gate concerns a mutation has), not an
accident. **B, never C: do not invent a third abstraction on top of these
two.** Normalizing means recognizing the shared shape (id/conversationId/
opportunityId/correlationId/causationId/createdAt/tool-or-actionType/input)
as the actual generic ToolRequest concept, with the governance-class split
staying a legitimate two-surface realization of it -- not collapsing them
into one type (which would have to either lose the discriminated-union
input typing CommercialActionRequest gets from its action-type mapping, or
force ReadToolRequest to carry idempotency concerns it structurally does not
need).

Per-stage detail:

| stage | data structure | validation boundary | argument mutation | evidence basis | persistence | idempotency | observability | retry |
|---|---|---|---|---|---|---|---|---|
| AgentStep | `AgentStepUseTool` | `validateAgentStep` (shape only) | none | none | none | none | none | none (handled one layer up) |
| processUseToolStep | enriched step | registration + dedupe + evidence gate + exposure classification | `enrichToolArguments` (budgetMax backfill only) | `resolveObservedRecommendationSourceProduct` (recommend/select only) | none yet | in-turn `executedCalls` Set (dedupe, not idempotency) | `warnings[]` array (in-memory, folded into turn-level `commercial_event` later) | none |
| ReadToolRequest / CommercialActionRequest | typed request object | `validateCommercialActionRequest` (schema, action type, ids) -- **ReadToolRequest has no equivalent pre-Gateway schema check, deliberately (Section 2 above's comment: reads have no side effect a malformed call could corrupt)** | none | none (evidence already resolved one layer up) | none yet | deterministic `requestId` (content hash) -- replay-stable, not enforced against a "seen" table (each capability is expected to be idempotent at its own domain layer) | `AgentSessionStore` shadow events (REQUESTED/ACCEPTED/REJECTED/terminal) | none |
| executeGovernedCapability | `CapabilityGatewayResult` | identity gate + `checkAvailability` | none | none | **`crm_capability_executions`, one row per real attempt including each bounded retry** | bounded retry loop (`maxRetries`, capability-declared) | `crm_capability_executions.evidence_json`/`warnings` | capability-declared `maxRetries`, applied uniformly |
| buildToolObservation | `ToolObservation` | none (pure projection) | none | none | none (ephemeral, turn-scoped) | fed back into the next prompt call | n/a |

---

## 3. Three reference capabilities -- comparison matrix

| Semantic property | search_products (proxy for the audited "semantic discovery" axis -- see Section 4) | select_products | create_quote |
|---|---|---|---|
| purpose | resolve a nominal/free-text catalog query to concrete products via T12 Product Intent Resolution | record the customer's confirmed, complete product selection as durable state | create a real Quote-Service draft quote for the current durable selection |
| use when | customer names a concrete product/family by text | customer has confirmed exactly what+how many to buy | customer wants a formal quote for an already-confirmed selection |
| do not use when | claiming a global ranking/extreme (explicit rule, EXPLORE_CATALOG_RULE_LINES[0]) | merely discussing/comparing/recommending (explicit rule, SELECT_PRODUCTS_RULE_LINES[0]) | selection/shipping not yet confirmed (implicit -- `assembleQuoteInput` fails closed, no explicit "do not use when" prose exists) |
| input semantics | `{query: string, limit?}` -- free text, shape-only via JSON Schema | `{items: [{productId, combinationId?, quantity}]}` -- **COMPLETE TARGET STATE, not a delta** (prose-only, Section 5) | `{}` -- **takes no arguments at all**, everything backend state |
| operation semantics | READ, DISCOVERY | MUTATION, FULL_REPLACEMENT (never merge) | MUTATION, CREATE_SNAPSHOT (idempotent by selection-hash reuse) |
| state sensitivity | none (stateless query) | replaces `commercial_line_items` entirely, keyed to `opportunityId` | reads `commercial_line_items`+Catalog pricing at call time; snapshot frozen into the created quote |
| evidence required | none (read has no evidence precondition) | every `{productId, combinationId}` must be independently observed this conversation via search_products/get_product_details/explore_catalog (enforced by `resolveObservedRecommendationSourceProduct`, [runAgentToolLoop.ts:560-577](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts#L560-L577)) | none directly -- reads whatever `commercial_line_items` already durably holds; no fresh catalog observation required to call it |
| evidence produced | `PRODUCT_IDENTITY` (productId/combinationId/name -- **not** current price/stock/link) | `COMMERCIAL_SELECTION_STATE` (the durable, authoritative selection) | `QUOTE_CREATED` (quoteId/quoteNumber/status/total/validUntil) |
| durable effect | none | `commercial_line_items` row set, keyed by opportunity | `created_quote` row + external Quote Service side effect |
| no-effect/no-match outcome | `resolution.status = no_match` (T12) -- **currently dropped by `buildToolObservation`, see 1.1** | n/a (a call always either replaces the selection or is rejected) | n/a (assembly gaps map to an informational `completed` outcome the model can relay, e.g. missing identity/pricing) |
| technical failure | `catalog_service_not_configured`, HTTP error classes via `mapCatalogErrorToOutcome` | `commercial_line_items_persistence_failed` | `catalog_unavailable` (retryable), Quote Service HTTP error classes |
| retryability | `maxRetries: 1` | `maxRetries: 0` (a full-replace call retried blind could silently redo an already-superseded replace) | `maxRetries: 0` (idempotency handled at the domain layer -- hash-keyed reuse, not blind retry) |
| downstream capabilities enabled | `get_product_details`, `select_products` (both via the shared evidence pool) -- **never** a public-link claim on their own | `calculate_shipping`, `create_quote` (both read the durable selection, not the tool call itself) | quote link/reference communication (from the capability's own `data`, never invented) |
| vocabulary source | catalog free text, no canonical registry today | Catalog Service productId/combinationId space (opaque to this capability) | n/a (no arguments) |

Cell classification:

```
EXPLICIT:    input semantics (JSON Schema), governance.sideEffect/authority/riskClass,
             durable effect (code-visible), technical failure codes
IMPLICIT:    evidence required/produced (working code, undeclared metadata),
             downstream capability authorization (prompt prose only),
             use when / do not use when (description + *_RULE_LINES, split
             across two places depending on the capability)
MISSING:     no-effect/no-match outcome class as a declared, generic concept
             (search_products' own resolution.status is dropped in projection --
             the Gateway/AgentStep layer has literally no outcome-class field
             beyond the 7-value infra status enum)
DUPLICATED:  select_products' full-replace semantic (4 independent statements,
             Section 1.2); "which tools produce observed evidence" (3
             independently-maintained allowlists, Section 10)
```

---

## 4. Case A -- search_products_by_semantics

### 4.1 What exists in this repository today: **nothing**

Exhaustive search (`rg -l "search_products_by_semantics|semantic-discovery|semanticDiscovery"`,
`rg -l "PRODUCT_FAMILY|DISCIPLINE|EXERCISE_CAPABILITY|..."`) confirms:

- No Capability Gateway registration exists for `search_products_by_semantics`.
- No `lib/catalog` HTTP adapter method calls `/v1/products/semantic-discovery/query`.
- No canonical-axis vocabulary (`PRODUCT_FAMILY`/`DISCIPLINE`/`USE_CONTEXT`/...)
  appears anywhere in production code -- only in
  `tests/catalog/httpCatalogAdapter.test.ts`, which tests a **different,
  already-wired, single-product** method: `CatalogPort.getProductSemantics(productId)`
  (GET `/v1/products/:productId/semantics`,
  [httpCatalogAdapter.ts:818](../../lib/catalog/httpCatalogAdapter.ts#L818),
  [types.ts:427](../../lib/catalog/types.ts#L427)). This returns one
  product's semantic classification (`primaryProductFamily`, `disciplines`,
  `useContexts`, `classifierVersion`) and is consumed **only** by
  `consoleService.ts` -- the internal Catalog Console debug UI
  (`components/catalog/ProductSemantics.tsx`/`CatalogConsole.tsx`), never by
  the Capability Gateway, never agent-exposed.
- `lib/brain/commercial/work/semanticIntentAdapter.ts` is R2's own multi-
  intent-to-objective mapper ("select_products" intent -> `SELECT_PRODUCTS`
  objective seed) -- an unrelated meaning of "semantic," explicitly out of
  scope (Section 21 DO-NOT-TOUCH).

**Conclusion: Case A is being audited against a capability that is entirely
greenfield on the CRM/R3 side.** The task brief's premise ("Upstream Catalog
already provides... capability: search_products_by_semantics") describes a
contract this audit cannot independently verify from this repository --
`MS-pesaschile-catalog-service` is a separate repo not opened this session
(per [[ref-catalog-service-repo]]). This is flagged explicitly, not asserted
as fact: **before TR-A4/B4 (Section 19) starts, confirm the endpoint is
actually reachable from this environment** -- the single-product
`getProductSemantics` precedent shows the pattern of "client method exists,
never wired to the agent" is already real in this codebase, so "the upstream
contract exists" and "R3 can call it today" are not the same claim.

### 4.2 Can the generic contract express Case A's semantics without semantic-
specific planner code?

**Yes, using exactly the mechanisms Sections 1/10/12 already establish, plus
one already-precedented pattern (`EXPLORE_CATALOG_RULE_LINES`/
`RECOMMEND_CATALOG_PRODUCTS_RULE_LINES`) for `useWhen`/`doNotUseWhen`:**

| Concept the task asks about | Does R3 need a new mechanism? |
|---|---|
| `purpose`/`useWhen`/`doNotUseWhen` | No new mechanism -- `description` (one sentence) + a dedicated `*_RULE_LINES` prose block, exactly the pattern `EXPLORE_CATALOG_RULE_LINES` already establishes for distinguishing search_products/explore_catalog/get_product_details. `useWhen`="quiero algo para entrenar piernas en casa" (functional/training constraints, no product name) vs `doNotUseWhen`="tienen la Leg Press Obelix?" (a named product -- use search_products) is exactly this same kind of boundary, stated the same way. |
| `operationSemantics` | Reuse the enum this audit proposes in Section 17 (`DISCOVERY_READ`) -- already implicit in `governance.sideEffect: "read_only"`, no new axis needed beyond what Section 17 proposes for all three reference capabilities. |
| `vocabularySource` | See Section 9 -- deferred, capability-internal for now (zero second consumer exists to justify a generic field). |
| `evidenceProduced` | **Cannot reuse `PRODUCT_IDENTITY` as-is** -- the task brief is explicit that "semantic eligibility != commercial hydration" (a semantic match is not guaranteed current price/stock/link). This is the one place Case A genuinely needs a *value* the other three discovery tools do not have: `SEMANTIC_ELIGIBILITY`, distinct from `PRODUCT_IDENTITY`. Both plug into the *same* generic `evidenceProduced` field (Section 10) -- no new mechanism, one new enum value. |
| `outcomeClasses` | Reuse Section 12's proposed generic outcome-class projection (`SUCCESS`/`NO_MATCH`/`CLARIFICATION_REQUIRED`/`TECHNICAL_FAILURE`) -- this is not semantic-discovery-specific; it is the same fix `search_products` already needs for its own dropped `resolution.status` (Section 1.1). |

No semantic-specific planner code, no new AgentStep variant, no new
workflow field is required. Case A is additive: one new registry entry, one
new catalog adapter client method, one new `*_RULE_LINES` prose block, and
two enum values reused from mechanisms already justified by the other two
reference capabilities (Sections 10, 12).

---

## 5. Case B -- select_products (the real production failure probe)

### 5.1 Where FULL_REPLACEMENT is currently encoded

Confirmed in four places (Section 1.2): `capability.description`
([selectProductsCapability.ts:69](../../lib/brain/commercial/capability-gateway/selectProductsCapability.ts#L69));
`SELECT_PRODUCTS_RULE_LINES[2]`
([buildAgentStepPromptPackage.ts:408](../../lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts#L408),
verbatim: *"Each select_products call must include the customer's complete
desired selection (every product and quantity they want), never only the
items being added or changed -- it replaces the entire previous
selection."*); a doc comment on the capability function itself; a doc
comment on the evidence-gate call site. **This is already an unusually
explicit, quadruply-stated prompt contract** -- not a gap in *telling* the
model the semantic.

### 5.2 Is DeepSeek currently guaranteed to receive this meaning at every
relevant decision point?

Yes, structurally: `description` reaches the model via `buildToolDescriptions()`
every gathering-phase call, and `SELECT_PRODUCTS_RULE_LINES` reaches it via
`buildEvidenceAndToolRulesLines()` every gathering-phase call too (finalization
sees only the grounding-relevant suffix, `SELECT_PRODUCTS_FINALIZATION_RULE_LINES`,
correctly -- no tool call is possible there). There is no code path where the
model sees the tool listed without also seeing this rule.

### 5.3 Would a richer, centralized capability contract materially reduce this
failure class?

**No -- and this is independently proven, not assumed, by this codebase's own
prior forensic work.** [[sales-agent-r3-c2-audit]] ([SALES-AGENT-R3-V1.8.2-C2-A0](../releases/SALES-AGENT-R3-V1.8.2-C2-A0-CUSTOMER-INSTRUCTION-UNSATISFIED-OBLIGATION-AUDIT.md)
Section 5, and its own Section 16 conclusion) traced the production "25kg
dumbbell" failure to its root cause with real conversation replay and
concluded explicitly: *"the brief's (A) better prompt authority contract is,
per Section 5's direct quotation of SELECT_PRODUCTS_RULE_LINES, already
unusually rigorous for exactly this failure class -- more prompt engineering
in the same direction is not the missing ingredient; a structural evidence
source for the prompt to reference is."* The confirmed PRIMARY cause is
**the absence of an explicit requested-vs-satisfied evidence relation** --
a *per-turn derived fact* ("what did the customer ask for that is not yet in
`commercialLineItems`"), not a *static capability contract fact* ("what does
select_products mean"). These are different layers: Capability Semantics is
declared once, describing the capability; C2's request/satisfaction evidence
is computed fresh every turn, describing this conversation's own state. A
generic `CapabilityDefinition` -- however complete -- cannot express "the
customer asked for X and X is currently absent from durable state," because
that is not a fact about the capability, it is a fact about this turn's
business state.

**Answer: No, richer static capability semantics cannot fix this class.**
What remains outside Capability Semantics' scope is exactly what
[SALES-AGENT-R3-V1.8.2-C2-A1](../releases/SALES-AGENT-R3-V1.8.2-C2-A1-HARNESS-ALIGNED-REQUEST-SATISFACTION-EVIDENCE-DESIGN.md)
already designed for, verdict `R3_C2_DESIGN_READY`, next slice `C2-A2`
(Section 15 maps this precisely). This audit's own generic evidence contract
(Section 10, `evidenceProduced`/`evidenceRequired`) is a real, useful,
different thing: it types *what a tool observed* (identity-level), never
*whether a customer's stated want is currently satisfied* (business-state-
level). The two are complementary, not competing, and this audit does not
attempt to subsume C2 into itself (Section 15).

---

## 6. Case C -- create_quote

### 6.1 Actual semantics

- **Snapshot, not delta**: creates one frozen `created_quote` record from
  current `commercial_line_items` + live Catalog pricing at call time.
- **Reads from commercial state, never supplied explicit lines**: `execute()`
  takes `_input: Record<string, never>` -- literally ignored; everything
  comes from `assembleQuoteInput()`, which reads durable
  `commercial_line_items`/identity/pricing
  ([createQuoteCapability.ts:97-107](../../lib/brain/commercial/capability-gateway/createQuoteCapability.ts#L97-L107)).
- **No shipping dependency today**: `requireShipping: false` is hardcoded --
  a documented, pre-existing contract gap between Carrier MS and Quote
  Service (`docs/audits/SALES-AGENT-R1-T3-create-quote-wiring-audit.md`),
  out of this audit's scope, not something Capability Semantics needs to
  paper over.
- **Identity requirements**: none beyond a resolved `opportunityId`
  (governance-level identity gate applies per Section 11, same as every
  other mutating capability).
- **Idempotency**: `buildIdempotencyKey(opportunityId, selectionFactId)`
  (sha256) -- the Quote Service's own idempotency key, plus a pre-HTTP-call
  reuse check (`getActiveCreatedQuoteForOpportunity` -- if the existing
  quote's `selectionFactId` still matches the current selection's factId,
  the Quote Service is never called a second time).
- **Durable effect**: `created_quote` row (`quoteId`/`quoteNumber`/`status`/
  `currency`/`total`/`validUntil`/`selectionFactId`/`idempotencyKey`).
- **Reuse behavior**: exact-selection-unchanged reuse is capability-internal,
  never model-visible as a choice -- the model always just calls
  `create_quote`; whether that produces `"created"` or `"reused"` is entirely
  backend-decided.
- **Possible outcomes**: `completed`/`created`, `completed`/`reused`,
  `completed`/&lt;assembly error code&gt; (informational, e.g. missing
  selection/pricing/identity -- the model can relay these honestly),
  `denied`/`no_active_opportunity`, `temporarily_blocked`/`catalog_unavailable`,
  `failed`/&lt;Quote Service error class&gt;, `temporarily_blocked`/
  `created_quote_persistence_failed` (a genuinely interesting case: the
  quote WAS created upstream, only local persistence failed -- safely
  retryable because the idempotency key makes a retry return the same quote,
  never a duplicate).

### 6.2 Does the same generic contract describe it without quote-specific
prompt architecture?

**Yes, and this is the cleanest of the three reference capabilities.**
There is no `CREATE_QUOTE_RULE_LINES` constant anywhere in
`buildAgentStepPromptPackage.ts` -- unlike select_products/explore_catalog/
shipping/recommend, create_quote needs **zero dedicated prompt-rule block**.
Its one-sentence `description` (which already states: takes no arguments,
sources from select_products, never includes shipping, reuse-not-duplicate
behavior) is the entire prompt-facing contract. This is direct, positive
evidence that a well-written `description` + the generic
`inputSchema`/`governance` fields already suffice for a `CREATE_SNAPSHOT_MUTATION`-
class capability with no arguments -- confirming the abstraction generalizes
beyond Catalog without special-casing.

---

## 7. Tool selection semantics

`TOOL_SELECTION_SEMANTICS: partially sufficient.`

Descriptions alone are insufficient (confirmed by the codebase's own choice
to add dedicated rule blocks rather than rely on `description` text alone for
search_products/explore_catalog/get_product_details/recommend_catalog_products).
But the actual mechanism that closes the gap already exists and is
consistent: a per-tool-family `*_RULE_LINES` prose block
(`EXPLORE_CATALOG_RULE_LINES`, `RECOMMEND_CATALOG_PRODUCTS_RULE_LINES`,
`RECENT_CATALOG_CONTEXT_RULE_LINES`, `PRODUCT_PUBLIC_LINK_RULE_LINES`), each
stating explicit negative boundaries ("Do not use search_products to claim a
global maximum...", "Never use historical RecentCatalogContext data as
current price...") alongside positive routing guidance. This is real
`doNotUseWhen` content -- it exists, it is immutable (never derived from
`identityConfiguration`), and it is not hardcoded *routing* (an
if/then decision tree) but *boundary description* the model reasons over --
consistent with the north star's "reasoning = model, capability semantics =
architecture-described" split.

What's missing is not a new mechanism but **consistency of where this prose
lives**: today it is a `buildAgentStepPromptPackage.ts`-local constant with
no link back to the `CapabilityGatewayDefinition` it describes -- a future
capability author must know to add a `*_RULE_LINES` block by convention,
not because `CapabilityGatewayDefinition` has a `doNotUseWhen` field
prompting them to. Formalizing `useWhen`/`doNotUseWhen` as *optional*
`CapabilityGatewayDefinition` fields (Section 17) that `buildAgentStepPromptPackage`
renders generically would collapse this ad hoc-but-consistent pattern into
one the registry enforces, without changing a single line of prompt text a
customer would ever see differently.

---

## 8. Input semantics vs JSON Schema

**JSON Schema alone is confirmed insufficient, directly, by the registry's
own documented discipline**: `inputSchema`'s doc comment states outright it
is *"never enforced at this layer... this is what the model is told to aim
for"* ([types.ts:108-119](../../lib/brain/commercial/capability-gateway/types.ts#L108-L119)),
and `executeReadTool.ts`'s own comment (Section 2's per-stage table)
documents two real capabilities (`get_product_details`, `explore_catalog`)
whose actual runtime behavior is deliberately *more lenient* than their own
exported schema (a numeric productId accepted despite the schema typing it
`string`; a legacy `{orderBy, orderDirection}` shape accepted as a real-
incident bridge the schema does not reflect). Schema is shape, not meaning,
by design and by lived incident history in this exact codebase.

`select_products`' full-replace meaning cannot live in JSON Schema at all --
there is no schema vocabulary for "this array is the complete desired state,
not a delta." Same for semantic discovery's "required cannot be silently
relaxed"/"codes come from upstream canonical registry" -- these are
runtime-validation-time facts (T12's own resolution logic), not shape facts.

**Minimal consistent approach: D (a combination), narrowly split by what
each layer is actually good at:**

- **A (JSON Schema)**: shape only -- field names, types, required-ness,
  enums, numeric ranges. Already works, already the single canonical source
  (registry -> both `buildToolDescriptions` and the prompt renderer read the
  same object, never redefined).
- **B (CapabilityDefinition prose fields)**: everything semantic that must
  reach the model's own reasoning -- `useWhen`/`doNotUseWhen`/
  `operationSemantics` framing text. This is what `select_products`' full-
  replace sentence and `search_products_by_semantics`' `useWhen` boundary
  both need.
- **C (trusted runtime context)**: reserved for facts the model must never
  be trusted to self-report (identity level, evidence provenance) --
  already the discipline `trustedCustomerSession` establishes
  (`CapabilityGatewayContext.trustedCustomerSession`, "never derived from
  LLM/tool-request input"). Not what select_products' semantic needs (the
  model DOES need to read and act on the full-replace rule, it is not a
  trust boundary).

No fourth mechanism. A vs B vs C is already the real split this codebase
uses; formalizing it just means giving B (today: ad hoc `*_RULE_LINES`
constants) an optional home on `CapabilityGatewayDefinition` itself
(Section 17).

---

## 9. Vocabulary sources

**Zero registered capabilities need a vocabulary provider today.**
`explore_catalog`'s enums (`sort.by`, `availability`) are small, static,
capability-owned constants baked directly into `EXPLORE_CATALOG_INPUT_SCHEMA`
-- never fetched, never versioned, never drift-prone. The only place a
*dynamic, upstream-authoritative* vocabulary would matter is exactly
Case A's canonical axis codes (`PRODUCT_FAMILY`/`DISCIPLINE`/...), and that
capability does not exist yet (Section 4).

Comparison, evaluated honestly against a zero-consumer baseline:

| Option | complexity | cacheability | registry drift | planner clarity | extensibility | Catalog dependency | future non-Catalog capabilities |
|---|---|---|---|---|---|---|---|
| 1. semantic-specific SemanticRegistryProvider | low (scoped to one capability) | capability owns its own cache | isolated to one capability, cannot leak | fine -- planner never sees vocabulary machinery, only validated codes | none (single-use) | tight, explicit, honest | irrelevant to them |
| 2. generic CapabilityVocabularyProvider | medium (new registry-level concept, one interface, only ever one real implementer) | generic caching layer for a population of one | none, but adds an unused seam other capabilities must understand/ignore | no change (the model never sees provider internals either way) | speculative -- no second consumer today | same tight coupling, just abstracted one layer for nothing | cannot be evaluated without a second real case |
| 3. runtime trustedContext | wrong fit -- `trustedCustomerSession` is specifically for untrusted-input-adjacent facts (identity), not upstream domain vocabulary; conflating the two would blur a discipline that exists for a security reason | n/a | risk of accidentally treating vocabulary as identity-adjacent trust | confusing -- two unrelated concepts sharing one channel | poor | tight | poor |
| 4. generated static schema + hash | low once built, but requires a build/codegen step this repo does not have for any other capability today | excellent (fully static) | real risk: a hash mismatch after Catalog updates its registry needs its own reconciliation flow, unbuilt | good | good, but over-engineered for one consumer | requires Catalog to publish a stable, versioned export -- unverified this exists (Section 4.1) | good in the abstract, unproven here |

**Selected: Option 1, deferred generalization.** Build `search_products_by_semantics`'
axis validation as a capability-owned concern inside its own `execute()`/
`checkAvailability()` (same pattern `EXPLORE_CATALOG_INPUT_SCHEMA`'s enums
already use, and the same pattern `getProductSemantics`'s untouched
classification data already implies). **Do not add `vocabularyProvider` to
`CapabilityGatewayDefinition` in this generalization pass** -- it fails the
Section 17 bar ("applies to at least 2 of 3 reference capabilities," in
spirit: applies to zero of the three audited here) and Option 2's abstract
benefits are unproven without a second real vocabulary-driven capability.
Revisit only when a second one exists.

---

## 10. Evidence contract

### 10.1 Is evidence currently typed, or merely inferred from "which capability
produced which productId"?

**It is genuinely, already, typed at the concept level -- just not declared
as `CapabilityGatewayDefinition` metadata.** `resolveObservedRecommendationSourceProduct.ts`'s
`OBSERVED_EVIDENCE_SOURCE_TOOLS` set
([resolveObservedRecommendationSourceProduct.ts:27](../../lib/brain/commercial/agent-loop/resolveObservedRecommendationSourceProduct.ts#L27))
already treats `search_products`/`get_product_details`/`explore_catalog` as
one interchangeable evidence class (deliberately excluding
`recommend_catalog_products`' own candidates as self-referential evidence --
"no recursive recommend -> recommend chains"). `collectAllowedProductIds`
([pendingCatalogAction.ts:150-203](../../lib/brain/commercial/agent-loop/pendingCatalogAction.ts#L150-L203))
independently re-implements a near-identical classification, this time
*including* `recommend_catalog_products` (for a different consumer:
pendingCatalogAction resolution, not the recommend-sourceProduct gate).
`recentCatalogContext.ts`'s SQL filter
(`capability_name IN ('search_products', 'get_product_details',
'explore_catalog', 'recommend_catalog_products')`, [recentCatalogContext.ts:194](../../lib/brain/commercial/agent-loop/recentCatalogContext.ts#L194))
is a third, independent statement of nearly the same set. **This IS the
working prototype of a generic `evidenceProduced: PRODUCT_IDENTITY` /
`evidenceRequired: PRODUCT_IDENTITY` typed contract** -- three
hand-synchronized tool-name allowlists standing in for one declared enum
value.

### 10.2 Should CapabilityGatewayDefinition declare evidenceProduced/evidenceRequired?

**Yes -- this is the single highest-value, best-justified generalization in
this entire audit.** Declaring it:

- Collapses three independently-maintained allowlists into one lookup
  (`resolveCapabilityGatewayDefinition(tool)?.evidenceProduced`), removing a
  real, live drift risk (a future tool added to one allowlist and not the
  other two silently changes evidence-pool membership for only some
  consumers -- exactly the kind of bug this class of duplication produces).
- Lets `search_products_by_semantics` (Case A) participate in the evidence
  pool by declaring `evidenceProduced: SEMANTIC_ELIGIBILITY` -- a *distinct*
  value from `PRODUCT_IDENTITY`, precisely encoding "semantic eligibility !=
  commercial hydration" (Section 4.2) so a future `get_product_details`/
  `select_products` gate can decide, structurally, whether a semantic-only
  match is sufficient evidence for a mutation (today: it should not be,
  until `get_product_details` re-confirms identity+current data -- exactly
  the same "search_products is not sufficient evidence for a product link"
  discipline PRODUCT_PUBLIC_LINK_RULE_LINES already enforces for
  `search_products` itself).
- Does **not** create excessive architecture: the enum is small (this audit
  needs at most `PRODUCT_IDENTITY`, `SEMANTIC_ELIGIBILITY`,
  `CURRENT_PRODUCT_DETAILS`, `COMMERCIAL_SELECTION_STATE`, `QUOTE_CREATED` --
  five values, each backed by a real, already-distinct capability output
  shape), and every value maps onto data that already exists; nothing is
  invented.

### 10.3 RecentCatalogContext discipline preserved

This audit's proposed typing changes nothing about `RecentCatalogContext`
itself remaining strictly "which product, not which topic" -- it never grows
a `topic`/`currentIntent` field, and `evidenceProduced` types *what a
capability's observation structurally contains*, never *what the
conversation is currently about*. This is the same boundary
[SALES-AGENT-R3-V1.8.2-C2-A1](../releases/SALES-AGENT-R3-V1.8.2-C2-A1-HARNESS-ALIGNED-REQUEST-SATISFACTION-EVIDENCE-DESIGN.md)
Section 7 already draws precisely ("recency is not relevance") -- this
audit's evidence-identity typing and C2's evidence-*freshness*/relevance
concept are adjacent, not the same axis, and neither subsumes the other
(Section 15).

---

## 11. Downstream authority

Today: **100% capability-name-based, hardcoded in prompt prose.**
`PRODUCT_PUBLIC_LINK_RULE_LINES` (8 lines) states, by literal tool name,
that `search_products`/`explore_catalog` observations never authorize a
public-link claim and `get_product_details` alone does. This works, is
safe (fail-closed by construction -- the rule is a negative list, "these
tools are NOT sufficient," never a positive grant the model could
misapply), and is not broken.

**Conclusion: reuse the Section 10 `evidenceProduced` enum for this too,
never a second field.** "May this observation authorize a public-link
claim" is exactly "does this observation's `evidenceProduced` value include
`CURRENT_PRODUCT_DETAILS`" -- the same typed vocabulary answers both
questions. A capability whose `evidenceProduced` is `PRODUCT_IDENTITY` or
`SEMANTIC_ELIGIBILITY` structurally cannot authorize a link claim; one whose
`evidenceProduced` is `CURRENT_PRODUCT_DETAILS` can. This does not need to
become an *enforced* runtime gate immediately (today's prose-only
enforcement is working, low-risk, and this audit is not proposing to
implement it) -- but the prose can be *generated from* the same declared
enum instead of naming tools by hand, so a future capability addition gets
correct downstream-authority prose automatically instead of by a developer
remembering to update `PRODUCT_PUBLIC_LINK_RULE_LINES` by convention.

---

## 12. Outcome semantics

### 12.1 What the model actually receives today

| Capability | Real internal classes | What survives to the model |
|---|---|---|
| search_products | `resolved`/`clarification_required`/`no_match` (T12, in `productIntent.resolution.status`) | **none of it** -- `projectSearchProducts` only emits `{query, items}`; a `no_match` and a `resolved` result with 0 items are currently indistinguishable to the model once items happens to be empty either way, and a genuine `clarification_required` looks identical to a plain `resolved` list. **Confirmed live gap**, independent of this audit's proposals. |
| select_products | `selected`/`invalid_input:<reason>`/`persistence_failed`/`unknown_result` (capability's own `data.status`, plus Gateway-level `invalid_arguments`/`denied`/`failed`) | full pass-through (`projectSelectProducts` is a bare passthrough of `data`) -- but as ad hoc capability-specific strings the model must learn from `SELECT_PRODUCTS_RULE_LINES` prose, never a shared taxonomy |
| create_quote | `created`/`reused`/assembly-error-informational/`denied`/`temporarily_blocked`/`failed` | full pass-through (`projectCreateQuote`, same bare-passthrough pattern) |

### 12.2 Should outcome classes become generic metadata or stay tool-specific
projection?

**A thin generic layer, reusing infrastructure that already exists, without
discarding the capability-specific detail that is genuinely useful.** The
Gateway's own 7-value `CapabilityGatewayExecutionStatus`
(`completed`/`missing_information`/`denied`/`requires_approval`/
`temporarily_blocked`/`invalid_arguments`/`failed`) is already a real,
working, generic outcome taxonomy -- it is infrastructure-facing (mapped
into `READ_TOOL_RESULT_STATUS`/`CommercialActionResultStatus`, both proven
generalizations of the exact same enum, Section 2.2's table), but it stops
one level too coarse for the model: `completed` covers both "found the
product" and "confirmed no match," which is exactly search_products' bug.

The fix does not require a new `CapabilityGatewayDefinition` field at all --
it requires `buildToolObservation.ts#projectSearchProducts` to stop dropping
`productIntent.resolution.status`, and a small, shared
`SUCCESS`/`NO_MATCH`/`CLARIFICATION_REQUIRED` sub-classification convention
any read capability with a genuine "valid empty result" case (search_products
today, search_products_by_semantics tomorrow) can populate inside its own
already-passthrough `data`. This is a bug fix plus a naming convention, not
new architecture -- and it is a **prerequisite** for Case A's acceptance
Case 6 (NO_MATCH must not read as technical failure), so it belongs in the
same implementation slice that adds `search_products_by_semantics`
(Section 19, TR-B2).

---

## 13. Tool request basis / freshness

### 13.1 What exists today

Neither `ReadToolRequest` nor `CommercialActionRequest` carries a
basis/evidenceVersion field. `buildCommercialActionRequestId`/
`buildReadToolRequestId` hash `(conversationId, causationId, tool-or-
actionType, input)` -- replay-stability for the *same logical request*, not
staleness detection against evolving state.

**A real, working precedent for exactly this concept already exists,
narrowly, for one capability**: `select_shipping_option`'s
`checkShippingEvidenceFreshness`
([lib/domains/selected-shipping-option/service.ts:126-146](../../lib/domains/selected-shipping-option/service.ts#L126-L146))
compares a `selectionFactId`/`destinationFactId` pair captured at the time
`calculate_shipping` ran against the CURRENT durable selection/destination
fact ids at execution time -- a mismatch produces
`SHIPPING_CALCULATION_STALE_ERROR_CODE`
(`blocked`, surfaced to the model as a distinct observation via
`projectSelectShippingOptionStale`, [buildToolObservation.ts:127-131](../../lib/brain/commercial/agent-loop/buildToolObservation.ts#L127-L131)).
This is real evidence/state drift detection, already shipped, already
model-visible as a structured (not silent) outcome.

A second, orthogonal freshness mechanism already exists at the *turn* level,
not the *request* level: Live Turn Assimilation
(`BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED`, [[sales-agent-r3-v1-8-1a-harness-semantic-durability]])
discards a stale `use_tool`/`respond`/`handoff` candidate the moment new
inbound arrives mid-cognition, via a universal pre-action gate in
`runAgentToolLoop.ts`. This answers "is the model's *decision* still current
relative to *new customer input*" -- a different axis than "is the
*evidence a mutation is about to act on* still current relative to *other
durable state that changed*," which is what `select_shipping_option`'s
factId check answers.

### 13.2 Minimum generic basis

**The minimum generic concept is: an optional, per-mutating-capability
`basis` -- a small set of `{factType, factId}` pairs the capability's own
evidence gate (or the model's own tool-observation citation) already
resolves, checked against current durable state at execution time, exactly
generalizing what `select_shipping_option` already does for one capability.**

This deliberately does **not** clear the "applies to at least 2 of 3
reference capabilities" bar for a universal field today:
`select_products`' evidence gate already fails closed on
unobserved-productId (a different, sufficient safeguard for its own
semantic); `create_quote`'s idempotency is already handled by its own
selection-factId hash-and-reuse (a *different*, already-adequate mechanism
achieving the same "don't act on stale state" goal via reuse instead of
rejection). Only `select_shipping_option` needs staleness *rejection*
specifically, and it already has it, locally, working.

**Recommendation: do not add a `basis`/`stateVersion` field to
`ReadToolRequest`/`CommercialActionRequest` in this generalization pass.**
Document the `checkShippingEvidenceFreshness` pattern as the canonical
template for any *future* mutating capability that needs its own freshness
check (a capability-local concern, following the Gateway's existing
"capability owns its own domain validation" discipline -- Section 8's same
answer), rather than generalizing a mechanism with a sample size of one.
Revisit if a second mutating capability demonstrates the same need.

---

## 14. Observability

### 14.1 What is already durable, and what is confirmed missing

**Already durable, per real execution**: `crm_capability_executions`
(`request_summary_json`/`response_summary_json`/`evidence_json`/
`execution_status`/`retry_count`/`error_code`, [repository.ts](../../lib/brain/commercial/capability-gateway/repository.ts))
-- one row per attempt that actually reached `executeGovernedCapability`,
keyed by `correlationId`/`decisionId`/`actionId`/`requestId`/
`opportunityId`/`conversationId`. This already durably captures the exact
normalized arguments (`request_summary_json` is the raw `input` unless a
capability supplies a redaction override -- `select_products`/`create_quote`
supply none, so their exact arguments are already fully durable today), the
outcome, and the evidence array. **The task brief's own premise -- "exact
historical select_products arguments were not reconstructible" -- is only
half true**, per [SALES-AGENT-R3-V1.8.2-C2-A0.1](../releases/SALES-AGENT-R3-V1.8.2-C2-A0.1-PRODUCTION-EVIDENCE-RECONCILIATION.md)
Section 3's direct reconciliation: two observability layers exist
(`agent_session_events` "Layer A," the real per-request boundary log, vs
"Layer B," a shadow/additive post-hoc re-projection from in-memory turn
state via `shadowRecorder.ts`), and a stale code comment incorrectly
describes Layer B as non-duplicative when it actually re-emits a second
event per real tool step -- a genuine, precisely-located discrepancy
(comment-vs-code, not a missing capability), already flagged by C2-A0.1 as
"real, locatable... not corrected in this audit-only task." That confusion
is about *which layer to trust for execution counts* (C2-A0.1's answer:
Layer A, `read-tool-request`/`commercial-action-request` sessionEvents,
always), not about the arguments themselves being unrecoverable.

**Confirmed genuinely missing**: a call **rejected before ever reaching the
Gateway** -- duplicate-in-turn, unregistered, evidence-blocked, or
opportunity-resolution-failed (Section 2's `processUseToolStep` table) --
**never gets a `crm_capability_executions` row at all.** It leaves only an
ephemeral `warnings` string (e.g. `agent_loop_tool_blocked_evidence:select_products:source_product_not_observed`)
folded into that turn's own `commercial_event` payload -- present, but not
structured, not queryable as its own typed record, and not present in the
same table every other execution audit lives in. This is exactly what
[[sales-agent-r3-c2-audit]]'s **H2 hypothesis** targets from the model-facing
side ("disclosed to the model as a structured observation distinct from a
silent no-op") -- this audit adds the *observability*-facing half of the
same real gap: today it is invisible to a human debugging
`crm_capability_executions` after the fact, not just to the model in-turn.

### 14.2 Can this be added to an existing execution log rather than a new
table?

**Yes.** `insertCapabilityExecution` already accepts a synthetic-shaped
row (`executeCapability.ts`'s own "capability not registered"/"identity gate
denied" branches already insert a row for THOSE pre-`checkAvailability`
rejections -- proving the table already tolerates "rejected before real
work happened" rows). The gap is narrower than "no logging exists for
rejections" -- it is specifically that `processUseToolStep`'s OWN pre-
Gateway checks (dedupe/evidence/exposure/opportunity-resolution, which run
*before* `executeGovernedCapability` is ever called) short-circuit past
`insertCapabilityExecution` entirely, unlike the Gateway's *own* internal
rejections which already call it. Closing this means having
`processUseToolStep`'s blocked branches call the same insert helper (or the
equivalent `AgentSessionStore` event, already wired via
`read-tool-request`/`commercial-action-request` sessionEvents for calls that
DO reach their adapter -- but a dedupe/evidence-blocked call returns before
either adapter is ever invoked, per Section 2's trace) with a `status:
"blocked"`/`errorCode` pair mirroring what the model already sees in its own
`ToolObservation`. No new table.

---

## 15. Relation to C2

Explicit mapping of [[sales-agent-r3-c2-audit]]'s confirmed findings onto
this audit's proposed mechanisms:

| C2 finding | Solved by this audit's mechanisms? | Why / why not |
|---|---|---|
| Model can make wrong decisions while tools/state are correct | **No.** | Out of scope for a capability-contract/tool-request audit by construction -- this is a cognition-quality question, not an architecture question. Neither audit claims otherwise. |
| Recent evidence != conversational relevance | **No, and not attempted.** | This audit's `evidenceProduced` (Section 10) types *what a tool observed* (identity-level, static per capability); C2's freshness concept is *how recently, and how relevantly* a specific observation was made (per-turn, dynamic). `recentCatalogContext` stays "which product," never grows a topic field, in both audits' designs -- confirmed compatible, not overlapping. |
| Stale decisions should be invalidated and re-derived | **Partially, at a different layer.** | Live Turn Assimilation (Section 13.1) already does this for *decisions vs new customer input*. `select_shipping_option`'s facty freshness check does it for *one mutation vs other durable state*. This audit recommends documenting the latter as a template (Section 13.2) rather than generalizing it now -- C2-A1's own `catalogDiscoveryFreshness` (design-ready, not yet implemented) is the request-satisfaction-specific instance of the same idea, for a different evidence class (catalog discovery activity vs the assistant's own last open question) than `select_shipping_option`'s (shipping fact drift). Neither subsumes the other. |
| Exact mutation arguments must be observable | **Yes, mostly already true; this audit closes the remaining real gap (Section 14).** | `crm_capability_executions` already captures reached-the-Gateway arguments in full; this audit's TR-B3 slice (Section 19) closes the pre-Gateway-rejection blind spot C2-A0.1 independently confirmed exists as a layer-confusion risk, not an arguments-loss risk. |
| Request/effect relation can be lost | **Partially.** | `requestId` (deterministic hash) already links a request to its `crm_capability_executions`/`AgentSessionStore` rows for anything that reaches the Gateway (Section 2.2's table). What can still be lost is the pre-Gateway-rejection case (Section 14), closed by TR-B3, and cross-layer confusion between Layer A/Layer B counts (C2-A0.1's own finding, a documentation/runbook fix C2-A0.1 explicitly left open, not something this audit's mechanisms touch). |

**`catalogEvidenceVsSelection`/`catalogDiscoveryFreshness`/
`supersededByNewerDiscovery` remain necessary, unreplaced by this audit's
generic contract.** They are per-turn derived business facts (a diff between
observed evidence and durable `commercialLineItems`; a temporal fact about
discovery-tool recency relative to the assistant's own last message) --
Capability Semantics describes *capabilities*, once; C2's fields describe
*this conversation's state*, every turn. This audit's `evidenceProduced`
enum is exactly what C2-A1 Section 2.1 already independently chose to reuse
("matched the same way `resolveObservedRecommendationSourceProduct.ts`
already matches evidence -- reusing, not reinventing, the existing matching
logic") -- so implementing this audit's TR-B1 (Section 19) makes C2's own
next slice (`C2-A2`) marginally cleaner to implement (one less hardcoded
tool-name list to hand-maintain), never something that makes `C2-A2`
unnecessary.

---

## 16. Relation to the DeepSeek Harness

| Harness principle | Capability Semantics + Tool Request |
|---|---|
| Append-only causal evidence | `crm_capability_executions`/`AgentSessionStore` events are already append-only; this audit adds no mutable state, only optional declared metadata on an already-append-only-consumed registry. |
| Derive messages fresh | Unaffected -- `evidenceProduced`/outcome-class metadata is read at prompt-build time from the registry (a static, in-memory source, same cost class as `description`/`inputSchema` today), never persisted as conversational state. |
| Model decides | Unchanged and reinforced -- `useWhen`/`doNotUseWhen` are boundary *descriptions* the model reasons over, never routing rules the runtime executes on the model's behalf (exactly Section 0's "architecture decides which capabilities exist... reasoning = model" split, applied consistently). |
| Tools produce observations | Unchanged -- `evidenceProduced`/outcome-class values flow through the exact same `ToolObservation` shape (Section 12), never a parallel channel. |
| No persistent cognitive workflow state | Confirmed clean -- every field this audit proposes (Section 17) is either static per-capability metadata (registry-level, not conversation-level) or an ephemeral per-request/per-turn derivation (Section 13/14, never persisted as "current step"/"stage"). Nothing proposed here is `currentIntent`/`activeTopic`/`nextStep` by any other name. |
| Fresh cognition after recovery | Unaffected -- none of this audit's proposals introduce state that must survive a crash mid-turn; `crm_capability_executions` rows are already durable and already re-derivable into `recentCatalogContext` on every turn, unchanged. |

**A, definitively: this fits as the execution contract underneath the model,
never a second planner.** `CapabilityGatewayDefinition` already is,
structurally, [SALES-AGENT-R3-A00-target-architecture.md](../architecture/SALES-AGENT-R3-A00-target-architecture.md)
Section 2.F's `Capability Gateway` component ("KEEP, unchanged... the shared
execution boundary for 7 independent callers"); `ReadToolRequest`/
`CommercialActionRequest` already ARE A00's Section 2.C/D
(`ReadToolGateway`/`CommercialActionRequest boundary`), already built. This
audit proposes enriching an execution-contract layer A00 already designed
and A03/A04 already implemented -- not adding a new layer between the
Harness's reasoning loop and that contract.

```
Harness reasoning layer (runAgentToolLoop.ts / future SalesAgentHarness)
  - reads AgentSessionStore append-only history
  - decides: use_tool | respond | handoff, with which arguments
  - never knows HOW a capability executes, only WHAT it means (via
    description/useWhen/doNotUseWhen/evidenceProduced -- Capability Semantics)
        |
        v  AgentStep -> ReadToolRequest | CommercialActionRequest
        |
Tool Request execution layer (this audit's scope)
  - validates shape, resolves capability, applies identity gate
  - executes exactly once through executeGovernedCapability
  - normalizes outcome into ToolObservation
  - never reasons about customer intent, never decides "what to do next"
```

---

## 17. Minimum generic contract

Every field below is tested against: which real bug/use case requires it,
which existing mechanism would consume it, whether it is optional, and
whether it applies to at least 2 of the 3 reference capabilities.

```
CapabilityGatewayDefinition (additive, all optional -- every existing
capability definition remains valid with zero changes):

  useWhen?: string
    - real use case: Case A's routing boundary (Section 4.2), Case B's
      "not merely while discussing" boundary (already exists as
      SELECT_PRODUCTS_RULE_LINES[0] prose)
    - consumed by: buildAgentStepPromptPackage.ts (rendered alongside
      description, replacing the need for a bespoke *_RULE_LINES constant
      for the routing-boundary sentence specifically -- NOT replacing rule
      blocks that also carry sequencing/reuse/composition guidance, which
      stay as-is)
    - optional: yes -- absent capabilities render identically to today
    - applies to >=2/3 reference capabilities: yes (search_products'
      useWhen, select_products' useWhen already exist as prose today)

  doNotUseWhen?: string
    - real use case: EXPLORE_CATALOG_RULE_LINES[0]'s existing
      "do not use search_products to claim a ranking" boundary; Case A's
      "a named product -> use search_products, not semantic discovery"
    - consumed by: same renderer as useWhen
    - optional: yes
    - applies to >=2/3: yes (search_products has one today via
      EXPLORE_CATALOG_RULE_LINES' negative-boundary sentence about it;
      select_products has one, SELECT_PRODUCTS_RULE_LINES[0])

  operationSemantics?: "READ" | "FULL_REPLACEMENT_MUTATION" | "CREATE_SNAPSHOT_MUTATION"
    - real use case: Section 3's own matrix -- the exact three classes the
      task brief itself uses to select the three reference capabilities
    - consumed by: buildAgentStepPromptPackage.ts (renders a fixed,
      capability-independent sentence per class -- "this call replaces the
      complete prior state" for FULL_REPLACEMENT_MUTATION, generalizing
      SELECT_PRODUCTS_RULE_LINES[2] instead of hand-writing it per
      capability); future capability authors get this sentence for free
      instead of having to remember to write it (this is what would have
      made select_products' contract a single source instead of four,
      Section 1.2)
    - optional: yes, defaults to no generated sentence (today's behavior
      for every capability that doesn't need one, e.g. create_quote)
    - applies to all 3/3 reference capabilities: yes, by construction

  evidenceProduced?: ("PRODUCT_IDENTITY" | "SEMANTIC_ELIGIBILITY" |
                       "CURRENT_PRODUCT_DETAILS" | "COMMERCIAL_SELECTION_STATE" |
                       "QUOTE_CREATED")[]
  evidenceRequired?: ("PRODUCT_IDENTITY" | ...)[]
    - real use case: Section 10's three hand-synced allowlists; Section 11's
      hardcoded-by-name downstream authority; Case A's SEMANTIC_ELIGIBILITY
      distinction (Section 4.2)
    - consumed by: resolveObservedRecommendationSourceProduct.ts,
      collectAllowedProductIds (pendingCatalogAction.ts),
      recentCatalogContext.ts's SQL filter -- three existing call sites,
      each currently maintaining its own hand-written tool-name list,
      refactored (behavior-preserving) to read this field instead
    - optional: yes -- capabilities with no evidence relevance (create_quote,
      set_shipping_destination) simply omit both
    - applies to all 3/3: yes (search_products PRODUCES PRODUCT_IDENTITY,
      select_products REQUIRES PRODUCT_IDENTITY and PRODUCES
      COMMERCIAL_SELECTION_STATE, create_quote PRODUCES QUOTE_CREATED)

  outcomeClasses?: not a new field -- Section 12's conclusion is this is a
    projection-layer fix (buildToolObservation.ts) plus a shared,
    capability-authored `data`-level convention, not new
    CapabilityGatewayDefinition metadata. Explicitly rejected as a new field
    to avoid inventing structure the existing `data` passthrough already
    supports once the one real bug (dropped resolution.status) is fixed.

Rejected outright (fail the "real bug + >=2/3 capabilities" bar):
  - vocabularyProvider (Section 9 -- zero current consumers)
  - riskClass as a NEW field -- already exists (governance.riskClass),
    unused by this audit's proposals, not touched
  - sideEffect as a NEW field -- already exists (governance.sideEffect)
  - a ToolRequest-level basis/stateVersion field (Section 13.2 -- sample
    size of one, already solved locally for that one case)

ToolRequest (no new type -- ReadToolRequest/CommercialActionRequest already
ARE this concept, Section 2.2; no field is added to either by this audit):
  - id / requestId: already present, both
  - arguments / input: already present, both
  - basis / evidenceVersion: explicitly NOT added (Section 13.2)
```

---

## 18. Implementation readiness

| Area | Current state | Change required | Blocking? |
|---|---|---|---|
| Capability registry | Working, single source of truth for description/inputSchema/governance; no useWhen/doNotUseWhen/operationSemantics/evidenceProduced/evidenceRequired fields | Add 5 optional fields to `CapabilityGatewayDefinition`; populate for the 3 reference capabilities + the 4 existing catalog-evidence tools | No |
| AgentStep | Stable, minimal, already correctly scoped (shape-only validation, no governance) | None | No |
| Tool request | Already exists twice (ReadToolRequest/CommercialActionRequest), proven, no unification needed | None structural; optional: shared doc naming both as one "ToolRequest" family for future readers | No |
| Gateway | `executeGovernedCapability` unchanged, already the single choke point | None | No |
| Prompt/tool description | `buildToolDescriptions`/`buildAgentStepPromptPackage` already read the registry as sole source | Extend renderer to optionally append `useWhen`/`doNotUseWhen`/`operationSemantics` sentences when a capability declares them (additive, byte-identical for every capability that does not) | No |
| Evidence | Already generically working, duplicated across 3 files | Refactor 3 call sites to read `evidenceProduced`/`evidenceRequired` from the registry instead of 3 hand-synced tool-name lists (behavior-preserving refactor, covered by existing test suites) | No |
| Observation | `buildToolObservation.ts` has one confirmed real bug (dropped `resolution.status`) | Fix `projectSearchProducts` to surface `resolution.status`; establish the shared NO_MATCH/CLARIFICATION_REQUIRED convention for future read capabilities | No |
| Catalog adapter | `resolveProductIntent`/`getProductDetails`/`batchGetProducts`/`exploreCatalog`/`getProductSemantics` (single-product, unwired) exist; no semantic-discovery-query client method | Add one new `CatalogPort` method + `httpCatalogAdapter.ts` implementation for `POST /v1/products/semantic-discovery/query` | **Yes, for Case A only** -- gated on confirming the upstream endpoint is reachable (Section 4.1); does not block TR-B1/B2/B3 |
| Semantic registry | Does not exist in this repo at all (Section 4.1) | Net-new capability registration + tool exposure classification + prose rule block, once the upstream endpoint is confirmed | **Yes, for Case A only** |
| select_products | Working, evidence-gated, correctly full-replace by design; production failure class is OUT of this audit's scope (Section 5.3, C2's territory) | None from this audit; `evidenceRequired`/`operationSemantics` population is cosmetic/consolidating, not corrective | No |
| create_quote | Working, cleanest of the three references, needs no prompt-specific architecture (Section 6.2) | None | No |
| Observability | `crm_capability_executions` already captures reached-the-Gateway arguments in full; confirmed gap is pre-Gateway rejections (Section 14.1) and a stale comment about Layer A/B (C2-A0.1's finding, not this audit's to fix) | Add a blocked-before-Gateway audit row/event in `processUseToolStep`'s existing rejection branches | No |

**Verdict: `READY_WITH_SMALL_STRUCTURAL_GAP`.**

The gap is small and precisely bounded: five additive, optional fields on an
already-correct registry contract; one refactor consolidating three already-
correct but hand-duplicated evidence allowlists into one; one real bug fix
in observation projection; one observability gap closure for pre-Gateway
rejections; and one genuinely net-new integration (Case A) whose scope is
ordinary "add a fourth read capability" work, not new architecture, gated on
an external, unverified-from-this-repo dependency (the upstream Catalog
endpoint's actual reachability).

---

## 19. Implementation slices

```
TR-B1  Generic evidence typing
  - Add evidenceProduced?/evidenceRequired? to CapabilityGatewayDefinition
    (5-value enum, Section 17).
  - Populate for the 4 existing catalog-evidence capabilities
    (search_products/get_product_details/explore_catalog/
    recommend_catalog_products: PRODUCT_IDENTITY; select_products:
    requires PRODUCT_IDENTITY, produces COMMERCIAL_SELECTION_STATE;
    create_quote: produces QUOTE_CREATED).
  - Refactor resolveObservedRecommendationSourceProduct.ts's
    OBSERVED_EVIDENCE_SOURCE_TOOLS, collectAllowedProductIds's per-tool
    branches, and recentCatalogContext.ts's SQL filter to read the
    registry field instead of 3 hand-synced literals.
  - Independently testable: existing evidence-gate/recentCatalogContext
    test suites must pass byte-identically (behavior-preserving refactor).
  - Reversible: pure refactor, no flag needed (no behavior change).
  - No Catalog dependency.

TR-B2  Outcome projection fix + useWhen/doNotUseWhen/operationSemantics rendering
  - Fix buildToolObservation.ts#projectSearchProducts to surface
    productIntent.resolution.status (real bug fix, Section 1.1/12).
  - Add useWhen?/doNotUseWhen?/operationSemantics? to
    CapabilityGatewayDefinition; extend buildAgentStepPromptPackage.ts's
    tool-line renderer to append them when present (additive, byte-
    identical output for every capability that omits them -- covered by
    the existing "golden prompt length" test discipline this codebase
    already uses, e.g. tests/agent-loop/buildAgentStepPromptPackage.test.ts).
  - Populate operationSemantics for the 3 reference capabilities only in
    this slice (search_products: READ; select_products:
    FULL_REPLACEMENT_MUTATION; create_quote: CREATE_SNAPSHOT_MUTATION).
  - Independently testable: unit tests on the new projection + prompt
    golden-length tests.
  - Reversible: fields are optional; omitting them reproduces today's
    exact output.
  - No Catalog dependency.

TR-B3  Pre-Gateway rejection observability
  - processUseToolStep's dedupe/evidence/exposure/opportunity-resolution
    rejection branches (runAgentToolLoop.ts:515-635) gain a durable audit
    row (reusing insertCapabilityExecution's existing "rejected before
    real work" shape, same as executeCapability.ts's own
    capability_not_registered/identity-gate branches already do) or an
    equivalent AgentSessionStore event, mirroring the ToolObservation the
    model already receives.
  - Independently testable: assert a row/event exists for each rejection
    class after a blocked call.
  - Reversible: additive logging only, no behavior change.
  - No Catalog dependency.

TR-B4  search_products_by_semantics integration
  - PRE-FLIGHT (blocking this slice only): confirm the upstream
    POST /v1/products/semantic-discovery/query endpoint is reachable from
    this environment -- this audit found zero evidence of it in this repo
    (Section 4.1) and cannot verify a separate repo.
  - New CatalogPort method + httpCatalogAdapter.ts implementation.
  - New Capability Gateway registration: governance.sideEffect=read_only,
    evidenceProduced=[SEMANTIC_ELIGIBILITY] (TR-B1's field),
    useWhen/doNotUseWhen/operationSemantics=DISCOVERY_READ (TR-B2's
    fields) -- following EXPLORE_CATALOG_RULE_LINES' established pattern
    for the doNotUseWhen boundary against search_products/get_product_details.
  - AGENT_LOOP_TOOL_POOL + agent-capability-exposure classification
    (READ_TOOL) entries.
  - Outcome classes (NO_MATCH/CLARIFICATION_REQUIRED) via TR-B2's shared
    convention -- satisfies acceptance Case 6 directly.
  - Server-side fail-closed on invalid/stale registry codes with a typed,
    repairable observation -- satisfies acceptance Case 7 directly (no new
    mechanism: the same invalid_arguments/BLOCKED path every other
    capability already uses).
  - Independently testable: unit tests on the new capability +
    a live-DeepSeek behavioral benchmark (TR-B5) for acceptance Cases 1-4/6/7.
  - Reversible: new capability behind no special flag needed (an
    unregistered/unlisted tool is simply never offered -- adding it to
    AGENT_LOOP_TOOL_POOL is the activation switch, trivially revertible).
  - Depends on the pre-flight check above; does not block TR-B1-B3.

TR-B5  Model-backed acceptance
  - Live-DeepSeek benchmark against this document's Section 20 acceptance
    cases, using the exact methodology already established by
    [SALES-AGENT-R3-V1.8.2-C1](../releases/SALES-AGENT-R3-V1.8.2-C1-HARNESS-ALIGNED-MESSAGE-SEQUENCING.md)/
    C1.1/C2's own live benchmarks (scripts/live-*-benchmark.ts pattern) --
    no new benchmark harness needed.
  - Depends on TR-B1/B2 (Cases 3/6/7) and TR-B4 (Cases 1/2/6/7).
```

### Which Catalog A00.11 work can resume immediately

**TR-B1/B2/B3 have zero Catalog dependency and can proceed immediately**, in
parallel with any Catalog-side A00.11 work, since they touch only
CRM-side registry/prompt/observability code already fully present in this
repository. **TR-B4 is gated on the pre-flight reachability check above** --
this audit cannot determine from this repo alone whether Catalog's
semantic-discovery endpoint is deployed/reachable, so it should not be
scheduled as "ready" without that confirmation first, independent of
whatever Catalog A00.11's own task numbering currently tracks.

---

## 20. Acceptance cases -- how this design would satisfy each

1. **Tool selection** ("piernas en casa"): `search_products_by_semantics`'
   `useWhen` (functional/training constraints, no named product) vs
   `search_products`' `doNotUseWhen`/`useWhen` pair gives the model the
   boundary as prose it reasons over -- no hardcoded routing (TR-B2/B4).
2. **Exact product** ("Leg Press Obelix?"): `search_products` is untouched;
   its existing contract is unchanged by this design.
3. **Full replacement** ("vas a agregar las 25 o no"): `operationSemantics:
   FULL_REPLACEMENT_MUTATION` generates the same explicit sentence
   `SELECT_PRODUCTS_RULE_LINES[2]` already states (TR-B2) -- this audit is
   explicit (Section 5.3) that this does NOT fix the confirmed production
   failure by itself; that requires C2's request/satisfaction evidence,
   already designed (`R3_C2_DESIGN_READY`), a separate, complementary track.
4. **New object after resolved object** ("si con los discos"): unchanged by
   this design -- confirmed (Section 5.3, C2-A0 Section 13/15) to be C2's
   territory (assistant-open-question linkage), not a tool-description gap.
5. **Quote** ("hazme la cotización"): already satisfied today (Section 6.2)
   -- `create_quote`'s existing one-sentence description is sufficient;
   this audit changes nothing here beyond optionally populating
   `operationSemantics: CREATE_SNAPSHOT_MUTATION` for consistency.
6. **no_match**: satisfied by TR-B2 (shared outcome-class convention) +
   TR-B4 (search_products_by_semantics populates it from day one).
7. **Registry drift**: satisfied by the existing `invalid_arguments`/BLOCKED
   fail-closed pattern every capability already uses (Section 12) -- no new
   mechanism required, TR-B4 simply follows it.

---

## 21. Do-not-touch -- compliance confirmation

This audit read, but did not modify: turn settlement, `crm_inbound_turn_settlements`,
outbox, dispatch, onboarding, voice/channel adapters, R2's `semanticIntentAdapter.ts`
(confirmed unrelated -- Section 4.1), `experiments/deepseek-harness`, and
introduced no persistent semantic memory, workflow state, `currentIntent`,
`activeTopic`, or `nextStep` anywhere in its proposals (Section 16's table).

---

## 22. Documentation

Created: this file. `docs/ACTIVE_RELEASE.md` updated in the same change
(pointer only, per `AGENTS.md`'s mandatory workflow) -- see the
`SALES-AGENT-R3` workstream section.

No production code, prompt, tool, or schema file was changed by this task.

---

## 23. Final output

1. **Current capability architecture**: `CapabilityGatewayDefinition` is a
   working, coherent execution contract (identity/description/schema/
   governance/executor), but its *semantic* meaning (operation class,
   useWhen/doNotUseWhen, evidence relations, downstream authority) lives
   split across `description` prose, dedicated `*_RULE_LINES` prompt
   constants, and hand-duplicated tool-name allowlists in 3 separate files
   (Section 1).
2. **Existing ToolRequest-equivalent path**: `ReadToolRequest` and
   `CommercialActionRequest` already ARE the ToolRequest abstraction,
   deliberately split by governance class, both converging on the single
   `executeGovernedCapability` choke point -- Conclusion B, already largely
   normalized, never a candidate for a third abstraction (Section 2).
3. **Three-capability comparison**: search_products/select_products/
   create_quote span DISCOVERY_READ/FULL_REPLACEMENT_MUTATION/
   CREATE_SNAPSHOT_MUTATION cleanly; create_quote needs zero capability-
   specific prompt architecture today, proving the generalization already
   works for the cleanest case (Sections 3, 6).
4. **Capability-semantics gaps**: `useWhen`/`doNotUseWhen`/
   `operationSemantics`/`evidenceProduced`/`evidenceRequired` as optional
   registry fields, closing three real, confirmed duplication/drift risks
   (Sections 1.2, 10, 17) -- nothing else justified against the "real bug +
   >=2/3 capabilities" bar (`vocabularyProvider`, a ToolRequest `basis`
   field: both explicitly deferred, Sections 9, 13).
5. **Evidence/outcome gaps**: evidence typing already exists as working code,
   needs declaring not inventing (Section 10); one real, confirmed
   observation-projection bug (dropped `search_products` resolution status,
   Section 1.1/12); one real, confirmed observability gap (pre-Gateway
   rejections leave no durable audit row, Section 14).
6. **Harness alignment**: A, definitively -- this is the execution contract
   underneath the model, already the A00-designed, A03/A04-built
   `ReadToolGateway`/`CommercialActionRequest boundary`, never a second
   planner (Section 16).
7. **Minimum generic contract**: 5 additive, optional fields on
   `CapabilityGatewayDefinition`; zero new fields on `ToolRequest` (both
   existing types already sufficient); `outcomeClasses` resolved as a
   projection-layer fix, not new metadata (Section 17).
8. **Implementation readiness**: `READY_WITH_SMALL_STRUCTURAL_GAP` (Section 18).
9. **Implementation slices**: TR-B1 (evidence typing) -> TR-B2 (outcome fix +
   semantics rendering) -> TR-B3 (pre-Gateway observability) -> TR-B4
   (search_products_by_semantics, gated on an unverified upstream
   dependency) -> TR-B5 (live-model acceptance benchmark) (Section 19).
10. **Catalog A00.11 parallelism**: TR-B1/B2/B3 have zero Catalog dependency
    and can start immediately; TR-B4 requires confirming the semantic-
    discovery endpoint's real reachability first, a check this audit could
    not perform from this repository alone (Section 19).

**`READY_WITH_SMALL_STRUCTURAL_GAP`**

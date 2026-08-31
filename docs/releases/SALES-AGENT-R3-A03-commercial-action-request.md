# SALES-AGENT-R3-A03 -- Commercial Action Request Boundary

Status: implemented, real-database verified. No production routing changed,
`SalesAgentHarness` was not made primary (it does not exist yet), no new
Capability Gateway capability was added, and Capability Gateway was never
bypassed. Introduces `CommercialActionRequest` -- the canonical R3 boundary
between agent reasoning and commercial mutation
(`docs/architecture/SALES-AGENT-R3-A00-target-architecture.md`, section D)
-- and wires it into the native Agent Tool Loop as the ATL adapter A00 asked
for, closing R3-A02's own forward-looking recommendation ("R3-A03 can
consume [`evaluateCapabilityIdentityGate`] directly").

## Architectural invariant

The LLM may reason. The LLM may request an action. The LLM may not directly
execute or authorize a mutation. `CommercialActionRequest` is a request,
never proof the action is valid:

```
SalesAgentHarness / ATL / future caller
    v
CommercialActionRequest
    v
validation (Phase 4)
    v
identity gate (R3-A02, reused unmodified)
    v
executeGovernedCapability (unbypassed, unchanged)
    v
domain side effect
```

## Phase 1 -- Audit: how mutating intent is represented today

| Runtime | Mechanism | File |
|---|---|---|
| Agent Tool Loop (ATL) | `AgentStepUseTool{type:"use_tool", tool, arguments}` from the model; `processUseToolStep` dedupes, evidence-checks, then calls `executeGovernedCapability` directly | `agent-loop/runAgentToolLoop.ts` |
| Multi-intent | `PlannedActionStep{capability, arguments, forIntentIndex, dependsOnIntentIndex}`; `executeCommercialActionPlan` calls `executeGovernedCapability` directly, same Gateway, no typed request object | `multi-intent/actionPlanExecutor.ts` |
| R2 CommercialWork | `CommercialObjective` -> `deriveCommercialWorkSteps` -> `commercialWorkExecutor.ts` picks READY steps and calls `executeGovernedCapability` (via an injectable `executeCapability` seam) | `work/commercialWorkExecutor.ts` |
| Onboarding/identity | `runCustomerOnboardingPostPlanStage.ts` calls `executeGovernedCapability("create_customer"/"link_external_identity"/"link_prestashop_identity", ...)` directly from its own deterministic state machine, never from a model tool call | `native-cycle/customer-session/runCustomerOnboardingPostPlanStage.ts` |

**Confirmed**: every runtime already converges on the exact same choke point,
`executeGovernedCapability` (A02's own Phase 1 finding, reconfirmed here) --
but "propose" and "execute" are the same function call in all four, with no
separate typed request object the way R2's own
`AIProposal -> CapabilityEvaluation -> AcceptedCommercialDecision` pipeline
has for its planner path (A00's own stated gap, section D). `crm_agent_actions`
is the legacy dispatch-action ledger (`send_whatsapp_reply`/
`schedule_followup`/`take_over_case`/...,
`action-lifecycle/types.ts#CommercialActionType`) -- a different action
model entirely, for CRM operator-facing dispatch, never Capability Gateway
mutations; `CommercialActionRequest` deliberately never reuses that name (see
Phase 2). `crm_request_facts` is the durable fact store each of the four
target capabilities already writes to (`commercial_line_items`/
`shipping_destination`/`selected_shipping_option`), unchanged by this task.
`crm_capability_executions` is the Gateway's own audit table (A02),
unchanged. `docs/architecture/SALES-AGENT-R3-A00-target-architecture.md`
already named the identity-gate generalization as the one prerequisite
(closed by A02) and the `CommercialActionRequest` boundary as the next
structural gap (closed here).

## Phase 2 -- CommercialActionRequest

New module: `lib/brain/commercial/commercial-action-request/`.

```ts
type CommercialActionRequest = {
  requestId: string;          // deterministic - see Phase 5
  conversationId: number;
  opportunityId: number | null;
  correlationId: string;
  causationId: string | null; // usually the inbound message id
  source: "agent_tool_loop" | "multi_intent" | "commercial_work" | "sales_agent_harness";
  createdAt: string;
  actionType: "SELECT_PRODUCTS" | "SET_SHIPPING_DESTINATION" | "SELECT_SHIPPING_OPTION" | "CREATE_QUOTE";
  input: /* one typed shape per actionType, discriminated on actionType */;
};
```

A real discriminated union (`types.ts`), not a mirror of raw LLM tool-call
JSON -- each `actionType` carries its own concretely-typed `input`
(`SelectProductsActionInput`/`SetShippingDestinationActionInput`/
`SelectShippingOptionActionInput`/`CreateQuoteActionInput`).

**Naming note.** `action-lifecycle/types.ts` already exports an unrelated
`CommercialActionType` (the legacy dispatch vocabulary). This module never
reuses that name -- see `CommercialActionRequestType` instead, documented in
`types.ts`'s own header comment so a future reader hits the warning before
the collision, not after.

Supported actions map only to capabilities already safely executable today
(A02-audited, real Capability Gateway registrations): `select_products`,
`set_shipping_destination`, `select_shipping_option`, `create_quote`. No
order creation, discount, refund, or cancellation action was added.

## Phase 3 -- Canonical action -> capability mapping

`actionCapabilityMapping.ts`: one `Record<CommercialActionRequestType, {capability, inputSchema}>`,
built by importing each capability's own exported `*_INPUT_SCHEMA` constant
directly (`SELECT_PRODUCTS_INPUT_SCHEMA`, `SET_SHIPPING_DESTINATION_INPUT_SCHEMA`,
`SELECT_SHIPPING_OPTION_INPUT_SCHEMA`, `CREATE_QUOTE_INPUT_SCHEMA`) -- never a
second, duplicated schema. The reverse lookup (`getActionTypeForCapability`)
is what makes an unknown/unmapped capability fail closed rather than being
silently allowed: `evaluateCapabilityIdentityGate`-adjacent logic in the
executor (Phase 6) never falls through to a default.

## Phase 4 -- Request validation

`validateCommercialActionRequest.ts` + `schemaValidation.ts`. Deliberately
narrow, matching the task's own instruction not to duplicate capability
validation logic:

- action type must be one of the four registered ones (else `unknown_action_type`)
- `conversationId`/`correlationId` must be present (universal request-level requirements)
- `input` must be schema-valid against the mapped capability's own
  `inputSchema`, interpreted by a ~50-line hand-written subset validator
  (`type`/`required`/`properties`/`additionalProperties`/`minItems`/
  `minimum`/`maximum`/`enum`/`items` -- exactly the subset every
  `CapabilityGatewayDefinition.inputSchema` in this repo already uses; no new
  dependency, matching the repo's existing hand-validation convention, e.g.
  `registry.ts`'s `asQueryText`/`asProductId`/`asBatchItems`)

**What it deliberately does NOT check**, and why that is correct, not a gap:
whether a `productId` was actually observed this conversation (ATL's own
evidence gate, still runs first -- see Phase 9), whether an `optionIndex`
refers to a real prior `calculate_shipping` result (`selectShippingOptionCapability.ts`'s
own evidence gate), whether an opportunity is active (each capability's own
`no_active_opportunity` check). Re-implementing any of those here would be
exactly the "unnecessary duplication" Phase 4 of the task brief warns
against -- proven directly by a test (`commercialActionRequest.test.ts`,
"a syntactically valid but semantically empty value... is NOT re-validated
here") that an empty `destination` string passes this layer's structural
check and is correctly rejected one layer down, by the real capability.

A property explicitly set to `null` on a non-required field is treated as
absent, not a type violation -- matching how every capability's own
hand-written validator already treats it (e.g. `selectProductsCapability.ts`'s
`asLineItems`). This was a real bug caught by the test suite during
development (a `combinationId: null` item was incorrectly rejected before
the fix) -- see `schemaValidation.ts`'s own comment on this exact case.

## Phase 5 -- Request identity / idempotency

`requestIdentity.ts#buildCommercialActionRequestId`: deterministic sha256
over `conversationId | causationId | actionType | canonicalJson(input)`,
mirroring the exact `canonicalJson`+sha256 pattern already established three
times in this codebase (`agent-loop/runAgentToolLoop.ts#buildDedupeKey`,
`agent-session/dedupe.ts`, `events/dedupe.ts`) -- never a random UUID.

**What this actually buys, precisely**: a genuine crash/retry that rebuilds
the identical logical request (same turn, same tool call, same arguments)
recomputes the identical `requestId`. That in turn makes
`AgentSessionStore.appendEvent`'s own dedupeKey-based idempotency (a repeat
call returns `status:"duplicate"`, never a second row -- proven by A01, reused
unmodified here via `buildCommercialActionRequestDedupeKey`) actually mean
something at the request level. No new durable "seen requests" table was
built, because none of it was needed: each of the four target capabilities
is already idempotent at the domain layer --
`select_products`/`set_shipping_destination` replace-with-same-value (a
repeat call reports `changed:false`), `select_shipping_option` checks
evidence freshness before writing, and `create_quote` reuses an existing
quote for an unchanged selection via its own hash-keyed idempotency key
(`createQuoteCapability.ts`, pre-existing, SALES-AGENT-R1-T3). A replayed
`CREATE_QUOTE` request still benefits from exactly that reuse behavior --
this boundary adds a second, request-level idempotency signal on top, it
never replaces the capability's own.

Verified (`commercialActionRequest.test.ts`): same request -> same id;
key-order-independent (canonical JSON); different input -> different id;
replaying the identical request through the full executor twice produces
exactly one `REQUESTED`/`ACCEPTED`/`COMPLETED` event triple, never two.

## Phase 6 -- Commercial Action Executor

`executeCommercialActionRequest.ts`:

1. validate request (Phase 4) -- reject closed, no Gateway call
2. resolve capability mapping (Phase 3) -- reject closed if unmapped (structurally unreachable given the canonical table, kept as defense in depth)
3. apply the R3-A02 shared identity gate (`evaluateCapabilityIdentityGate`, reused unmodified, governance read via `resolveCapabilityGovernance`) -- reject closed if insufficient
4. invoke `executeGovernedCapability` -- **the final, unbypassed execution choke point**; this boundary never calls a capability directly, and `executeGovernedCapability` itself is untouched (it already re-applies A02's own gate internally, a deliberate, cheap, pure defense-in-depth re-check, not relied on as the only check)
5. return a typed `CommercialActionResult`

Steps 1-3 never reach the Gateway on failure -- there is no
`crm_capability_executions` row for a request rejected before execution (an
honest absence, not a gap: nothing was executed). It is still fully
observable via the `AgentSession` `COMMERCIAL_ACTION_REJECTED` event (Phase 8).

## Phase 7 -- Typed result model

```ts
type CommercialActionResultStatus =
  "COMPLETED" | "DENIED" | "BLOCKED" | "FAILED" | "RETRYABLE" | "REQUIRES_CUSTOMER_INPUT" | "REQUIRES_REVIEW";
```

Mapped directly from the existing `CapabilityGatewayExecutionStatus`
vocabulary -- never a second, incompatible taxonomy:

| Gateway status | Result status |
|---|---|
| `completed` | `COMPLETED` |
| `missing_information` | `REQUIRES_CUSTOMER_INPUT` |
| `denied` | `DENIED` |
| `requires_approval` | `REQUIRES_REVIEW` |
| `temporarily_blocked` | `RETRYABLE` |
| `invalid_arguments` | `BLOCKED` |
| `failed` | `FAILED` |

A request rejected before the Gateway (validation, identity) is mapped
through a synthesized `CapabilityGatewayResult` built with the exact same
field shape `executeCapability.ts`'s own denial branches use
(`executionPublicId: null` honestly, since nothing was persisted) -- so
`CommercialActionResult.gatewayResult` is always populated and every
existing consumer of a `CapabilityGatewayResult` (notably
`buildToolObservation`) keeps working with zero special-casing. `data` is
always the capability's own structural `outcome.data` -- never raw model
output, hidden reasoning, or PII (both already guaranteed upstream by every
capability's own output contract, audited in A02 and unchanged here).

## Phase 8 -- Agent Session integration

`sessionEvents.ts`, shadow/additive only (matching `agent-session/shadowRecorder.ts`'s
own discipline exactly): a session-recording failure never blocks or fails a
real commercial action request (each call is wrapped in try/catch, degrading
to nothing rather than throwing). Reuses R3-A01's reserved event vocabulary,
live for the first time:

- `COMMERCIAL_ACTION_REQUESTED` -- on construction
- `COMMERCIAL_ACTION_ACCEPTED` / `COMMERCIAL_ACTION_REJECTED` -- after validation + capability mapping + identity gate (before any side effect)
- `COMMERCIAL_ACTION_COMPLETED` / `COMMERCIAL_ACTION_FAILED` -- after `executeGovernedCapability` returns (Phase 8's own vocabulary has no third option here; every non-`COMPLETED` outcome that reached real execution -- `RETRYABLE`/`BLOCKED`/`REQUIRES_CUSTOMER_INPUT`/`REQUIRES_REVIEW`/a late `DENIED` -- maps to `FAILED`, documented explicitly in `sessionEvents.ts`, never silently collapsed)

Payloads are small, fixed-key, enum-valued records only (`actionType`,
`capability`, `opportunityId`, `resultStatus`, `gatewayStatus`,
`stableErrorCode`, `retryable`, `reason`) -- verified
(`commercialActionRequest.test.ts`, "no PII and no raw model output") with an
exact `Object.keys` assertion on a `REQUESTED` payload and a regex sweep for
phone/wa_id/reasoning/prompt patterns across every emitted event. The
existing `sanitizeAgentSessionPayload` fail-closed layer (A01) still runs
underneath regardless, on every store implementation (in-memory and MariaDB
both call it internally) -- a second, independent guarantee, not the only
one relied on.

**The session observes outcomes; it never becomes business truth.** No
product/price/stock/selection is written here -- only that a request of a
given `actionType` happened and what typed outcome it reached, exactly
mirroring A01's own boundary statement.

## Phase 9 -- ATL adapter

`atlAdapter.ts#buildCommercialActionRequestFromAtlStep`. `runAgentToolLoop.ts`
was **not rewritten** -- one call site changed, everything else (dedupe,
`recommend_catalog_products`/`select_products` evidence gates, budget
accounting, warnings, `buildToolObservation`) is untouched:

```
before: executeGovernedCapability(step.tool, effectiveArguments, gatewayContext)

after:  buildCommercialActionRequestFromAtlStep(...) is null?
          yes -> executeGovernedCapability(step.tool, effectiveArguments, gatewayContext)   // read-only tools, unchanged
          no  -> executeCommercialActionRequest(request, gatewayContext).gatewayResult      // the four mutating tools
```

The adapter returns `null` for any tool this boundary does not cover
(every read-only tool: `search_products`/`get_product_details`/
`search_company_knowledge`/`explore_catalog`/`recommend_catalog_products`/
`calculate_shipping`), so read-only tool calls provably never become a
`CommercialActionRequest` -- both by construction (the reverse capability map
only has four entries) and by test.

One small, additive plumbing change was needed: `RunAgentToolLoopInput`
gained an optional `inboundMessageId?: string | null` field (absent =
`causationId: null`, never a behavior change for an existing caller that
omits it), threaded from `runNativeAgentToolLoopCycle.ts`'s own
already-in-scope `input.inboundMessageId` -- one line at the construction
site. This is what lets the request's `causationId` be the real inbound
message id instead of a proxy value. Since `runNativeAgentToolLoopCycle.ts`
builds the identical `RunAgentToolLoopInput` object for both the legacy ATL
path and the multi-intent path (`shouldRouteToMultiIntentPlanner` picks
which function consumes it), this plumbing is now available to
`multi-intent/actionPlanExecutor.ts` too -- not wired there in this task (see
Phase 10), but ready without a second plumbing change later.

`create_quote`'s adapter branch never trusts the model's raw tool arguments,
even if empty -- it always builds `input: {}`, matching
`CREATE_QUOTE_INPUT_SCHEMA`'s own contract (no properties at all) exactly.

## Phase 10 -- R2 compatibility

R2's `commercialWorkExecutor.ts` was **not** forced through this boundary in
this slice -- per the task's own explicit instruction, and because doing so
would mean re-deriving a `CommercialActionRequest` from a `CommercialObjective`/
step (a real design question: what is `causationId` for a system-scheduled
follow-up retry with no inbound message at all?) that this task's scope does
not need answered yet.

**What is proven instead**: R2 and `CommercialActionRequest` already
converge on the identical `executeGovernedCapability` choke point (Phase 1's
audit table), and both independently apply the identical A02 identity gate
(`decideCommercialIdentityRequirement`, reused unmodified by both --
A02's own parity test already proves this for the *identity* decision
specifically; nothing new was needed for A03, since A03 never introduces a
second gate). The remaining gap is purely structural (a typed request
object, request-level idempotency, session events for R2-originated
mutations), not a policy gap.

**Recommendation for a later task**: adapt `commercialWorkExecutor.ts`'s
step dispatch to build a `CommercialActionRequest` per step
(`source: "commercial_work"`, `causationId` derived from the step's own
`sourceMessageId`/`opportunityId` anchor, already available in
`crm_commercial_events`/the objective's own provenance) the same additive
way the ATL adapter was built here -- never a rewrite of
`commercialWorkExecutor.ts`'s own READY-step selection, projection, or
optimistic-concurrency logic. Prefer this over a broad refactor, matching
this task's own "additive migration over broad refactor" instruction.

## Phase 11 -- Idempotency / retry (verified)

Covered directly by Phase 5's design and its tests: a replayed
`CommercialActionRequest` (same conversation/causation/actionType/input)
recomputes the identical `requestId`, and executing it twice through the
full `executeCommercialActionRequest` pipeline produces exactly one
`REQUESTED`/`ACCEPTED`/`COMPLETED` event triple (the second `appendEvent`
call for each stage returns `status:"duplicate"` from the store, a no-op).
`create_quote` specifically inherits its own pre-existing
selection-hash-keyed reuse (SALES-AGENT-R1-T3) underneath this boundary,
unmodified.

## Phase 12 -- Observability

Traceable via `requestId`/`correlationId`/`causationId`/`conversationId`/
`opportunityId` across: `AgentSession` (the new `COMMERCIAL_ACTION_*`
events, correlated to the originating inbound message via `causationId`),
`crm_capability_executions` (via the identical `correlationId` the real
`executeGovernedCapability` call already carries, for every request that
reached execution). No second observability universe was created --
`crm_agent_actions`/`commercial_event`/outbox are unchanged and not written
by this boundary (see Phase 10: that integration belongs to a future R2/Kernel
adaptation, not to this slice).

## Phase 13 -- Tests

`tests/commercial/commercialActionRequest.test.ts` (new, 29 tests, all green
against real MariaDB):

1. canonical action <-> capability mapping (bidirectional, exhaustive)
2. valid SELECT_PRODUCTS / SET_SHIPPING_DESTINATION / SELECT_SHIPPING_OPTION / CREATE_QUOTE requests pass validation
3. unknown action type fails closed
4. malformed input fails closed (empty items array, wrong type, unexpected property) -- both at the pure validator and through the full executor (`BLOCKED`, no Gateway call, `executionPublicId: null`)
5. a `null` on an optional property is treated as absent, never a type violation (the bug caught during development)
6. read-only tools never become a `CommercialActionRequest`
7. a mutating ATL tool request adapts into a well-formed, schema-valid request; `create_quote` never trusts raw model arguments; a `null` conversationId falls back to no request (caller keeps calling the Gateway directly, unchanged)
8. requestId determinism: same logical request -> same id; key-order-independent; different input -> different id
9. `CREATE_QUOTE` at LEVEL_0 denied by the A02 gate, Quote Service never consulted (proven by errorCode, not by a mock)
10. `CREATE_QUOTE` at LEVEL_2 passes the gate and reaches the real capability's own `checkAvailability` (proven by getting the capability's own `quote_service_not_configured`, not an identity code)
11. `SELECT_PRODUCTS` remains ungated by identity even at LEVEL_0 (NONE requirement, unchanged from A02)
12. missing opportunity is denied by the real capability (`no_active_opportunity`), never fabricated by this boundary
13. a semantically-empty-but-structurally-valid input (empty destination string) reaches the real capability, proving Phase 4's "do not duplicate validation" was actually honored
14. session events: `REQUESTED -> ACCEPTED -> COMPLETED` for an accepted request; `REQUESTED -> REJECTED` only for an identity-denied request and for a structurally malformed one (never `ACCEPTED`); a replayed request never doubles any event; payloads carry no PII/raw output (exact key-set assertion + regex sweep)
15. an accepted, executed request still writes a real `crm_capability_executions` audit row (required seeding a real `crm_opportunities` row -- that table's FK is real, unlike the capabilities' own `crm_request_facts` writes, which anchor by a plain string with no FK; a fabricated opportunityId silently fails only the audit insert, never the capability's own result -- documented as a pre-existing, unrelated repository.ts behavior, not something this task changed)

**Regressions.** Full targeted suite (471 tests across 27 files: ATL,
multi-intent, native cycle configuration, prompt package, mutation-claim
guard, Capability Gateway, A02 identity gate, A06 identity requirement, R2
`CommercialWork` identity gating and executor, `AgentSessionStore` (store,
shadow recorder, summary, sanitizer), `create_quote`/`select_products`/
`set_shipping_destination`/`select_shipping_option` capabilities, deferred
actions, R2 architecture scenarios) -- **471/471 green, zero regressions**.
One environment note for future runs in this sandbox: the local MariaDB
Docker container (`crm-customer-360-mariadb`) had stopped mid-session
(unrelated to this task) and produced misleading `ECONNREFUSED`-driven
"failures" that vanished entirely once restarted -- confirmed by reproducing
the identical failures against the unmodified `develop` baseline and by a
direct `insertCapabilityExecution`/`setCommercialLineItemsForOpportunity`
probe; not a code regression.

`npx tsc --noEmit`: clean for every file this task touched (the same
pre-existing, unrelated `experiments/deepseek-harness/` errors from A02
remain, untouched). `npm run build` fails at the same pre-existing
type-check step for the same reason documented in A02's release doc -- not
fixed here, out of scope.

## Phase 14 -- Files changed

New: `lib/brain/commercial/commercial-action-request/{types,actionCapabilityMapping,schemaValidation,requestIdentity,validateCommercialActionRequest,sessionEvents,executeCommercialActionRequest,atlAdapter,index}.ts`,
`tests/commercial/commercialActionRequest.test.ts`.

Edited: `agent-loop/runAgentToolLoop.ts` (one call site + one additive
optional input field), `agent-loop/runNativeAgentToolLoopCycle.ts` (one line,
threads `inboundMessageId` through), `agent-session/dedupe.ts` (one new
dedupe-key builder, additive), `tests/commercial/identityCapabilityGatewaySummaries.test.ts`
(pre-existing A02 fixture fix, carried over, unrelated to A03 itself).

## Limitations

- Multi-intent's `actionPlanExecutor.ts` and R2's `commercialWorkExecutor.ts`
  do not yet build `CommercialActionRequest` objects (Phase 10) -- both
  already reach the identical `executeGovernedCapability`/A02-gate boundary
  directly, so no identity/policy gap exists, only a request-typing/session-
  event/idempotency-signal gap for those two origins specifically.
- `crm_agent_actions` is not written by this boundary (A00's own target
  design assigns that integration to a future `CommercialTransactionKernel`,
  not to A03 -- see Phase 12).
- The R2 benchmark fault-injection harness
  (`work/benchmark/capabilityGateway.ts`, noted as a pre-existing A02
  limitation too) still bypasses `executeGovernedCapability` for `create_quote`
  specifically -- unaffected by and unrelated to this task.

## Rollback

Revert the new `commercial-action-request/` directory and its test file, and
the three small edits to `runAgentToolLoop.ts`/`runNativeAgentToolLoopCycle.ts`/
`agent-session/dedupe.ts`. No migration, no schema change, no flag. Every
mutating ATL tool call falls back to calling `executeGovernedCapability`
directly (the pre-A03 behavior) the moment the adapter import is removed,
since `buildCommercialActionRequestFromAtlStep` returning `null` is already
the exact same code path a full revert would restore.

## Recommended R3-A04 boundary

Build `SalesAgentHarness`/`CommercialActionRequest`'s producer side (a real
`AgentStep` variant distinct from `use_tool`, per A00 section D) only once a
second real caller genuinely needs it -- until then, the ATL adapter already
proves the consumer side end-to-end. Adapt R2's `commercialWorkExecutor.ts`
to build requests too (Phase 10's recommendation) before or alongside
`CommercialTransactionKernel` work, so `crm_agent_actions` gains a single,
correct writer for Harness-originated actions rather than two independent
ones. Do not build the confirmation/human-approval plumbing A00 flagged as
"the one component with no working implementation today" as a side effect of
this work -- it remains real, pre-existing, tracked debt, not something a
future slice should absorb silently.

## Exit criteria

`R3_A03_COMMERCIAL_ACTION_REQUEST_VALIDATED`:

- Mutating agent intent has one typed request boundary -- confirmed (Phase 2/6).
- The request cannot directly authorize execution -- confirmed: validation,
  the identity gate, and `executeGovernedCapability` all still run; a
  request is never proof of validity (Phase 4/6).
- Every supported request flows through Capability Gateway -- confirmed:
  `executeGovernedCapability` is the only place a side effect can occur,
  never bypassed (Phase 6).
- A02 identity gate still applies -- confirmed, reused unmodified
  (`evaluateCapabilityIdentityGate`, Phase 6/9 tests).
- Request replay is idempotent -- confirmed (Phase 5/11, deterministic
  requestId + dedupe-safe session events + each capability's own domain
  idempotency).
- ATL mutation path can use the boundary -- confirmed, wired (Phase 9).
- Session receives structural request/outcome events -- confirmed (Phase 8,
  R3-A01's reserved vocabulary is live for the first time).
- No business truth is duplicated into session -- confirmed: only
  actionType/capability/status/errorCode/retryable are recorded, never
  product/price/stock/selection.
- No PII/reasoning/raw model data is persisted -- confirmed (Phase 8/13,
  exact-shape and regex-sweep tests, plus A01's own sanitizer still running
  underneath).
- Regressions are clean -- confirmed (471/471, Phase 13).
- No production routing changed -- confirmed: no flag, no route, no runtime
  branch touched; the only behavior change is that `select_products`/
  `set_shipping_destination`/`select_shipping_option`/`create_quote` calls
  from ATL now also produce `AgentSession` events and a request-level
  idempotency key, with identical Gateway-level behavior otherwise.

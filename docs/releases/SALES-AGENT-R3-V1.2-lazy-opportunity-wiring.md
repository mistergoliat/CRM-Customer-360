# SALES-AGENT-R3-V1.2 -- Lazy Opportunity Wiring into Commercial Actions

Status: implemented and tested against real MariaDB. No `SalesAgentRuntime`
work started, no WhatsApp routing changed, no new persistence layer. This is
the wiring task `docs/releases/SALES-AGENT-R3-V1.1-opportunity-wiring.md`'s
own "Recommended next step" pointed to: connecting `resolveRuntimeOpportunity`
to the one real place a mutating tool call needs it.

## Phase 1 -- Audit: how the four actions get `opportunityId` today

Read live code end to end:
`runNativeAutonomousCycle.ts` (ATL branch) ->
`runNativeAgentToolLoopCycle.ts` (computes `opportunityId` once from
`input.snapshot.opportunity?.id`, itself `buildNativeCommercialContext` ->
`loadNativeConversationDetailByPublicId` -> `loadActiveOpportunity`, per
V1.1's own audit) -> `runAgentToolLoop.ts` (builds one `gatewayContext` for
the whole turn, `opportunityId: input.opportunityId`) -> `processUseToolStep`
(reads `gatewayContext.opportunityId` for every tool call) ->
`atlAdapter.ts#buildCommercialActionRequestFromAtlStep` (copies it onto the
`CommercialActionRequest`) -> `executeCommercialActionRequest.ts` (passes the
**same, unmodified `gatewayContext`** straight through to
`executeGovernedCapability` -- the capability reads `context.opportunityId`
from `gatewayContext`, never from `request.opportunityId`) -> the capability
itself.

| Action | Pre-V1.2 `opportunityId` source | Can be null? | Failure when null | Request built at | Insertion point |
|---|---|---|---|---|---|
| `SELECT_PRODUCTS` | `gatewayContext.opportunityId`, fixed once per turn | Yes | `selectProductsCapability.ts`: `denied`/`no_active_opportunity` | `atlAdapter.ts` via `processUseToolStep`'s `COMMERCIAL_ACTION` branch | same branch, before the adapter call |
| `SET_SHIPPING_DESTINATION` | same | Yes | `shippingDestinationCapability.ts`: same code | same | same |
| `SELECT_SHIPPING_OPTION` | same | Yes (also requires `conversationId`) | `selectShippingOptionCapability.ts`: same code | same | same |
| `CREATE_QUOTE` | same | Yes | `createQuoteCapability.ts`: same code | same | same |

All four converge on **one** code path (`processUseToolStep`'s
`exposure === "COMMERCIAL_ACTION"` branch) -- confirming a single shared seam
is sufficient, exactly as the task brief's Phase 2 requires. `runNativeAutonomousCycle.ts`'s
`multi-intent` branch (`runCommercialMultiIntentLoop`) was checked and does
**not** use `CommercialActionRequest`/`atlAdapter.ts` at all -- it calls
`executeGovernedCapability` directly with its own separately-built
`gatewayContext` (per `A00`, this branch is `REFACTOR`-classified future
work, not part of the R3-A03 boundary this task wires into) -- out of scope,
not a gap this task introduces or leaves silently unaddressed.

## Phase 2/4 -- Insertion point and helper

**One seam**, inside `processUseToolStep`
(`lib/brain/commercial/agent-loop/runAgentToolLoop.ts`), in the
`exposure === "COMMERCIAL_ACTION"` branch, immediately before
`buildCommercialActionRequestFromAtlStep` is called. Nothing was added to any
capability, to `executeCommercialActionRequest.ts`, or to the Capability
Gateway itself.

New, small helper -- `ensureCommercialActionOpportunity`
(`lib/brain/commercial/commercial-action-request/ensureCommercialActionOpportunity.ts`),
matching the task brief's illustrative shape:

```ts
export type EnsureCommercialActionOpportunityResult =
  | { ok: true; opportunityId: number; source: "existing" | "resolved" }
  | { ok: false; reason: string };

async function ensureCommercialActionOpportunity(input: {
  conversationId: number | null;
  existingOpportunityId: number | null;
  trustedCustomerSession: NativeCustomerSessionExecutionContext | null | undefined;
  correlationId: string;
  currentTime: string;
}): Promise<EnsureCommercialActionOpportunityResult>
```

It does two things `resolveRuntimeOpportunity` (V1.1) does not do itself, and
nothing else: short-circuits when an opportunity is already known (Phase 5),
and extracts `waId`/`channel`/`customerMasterId` from
`NativeCustomerSessionExecutionContext` (the only shape available at this
call site) into `resolveRuntimeOpportunity`'s plain input. No second
opportunity resolver was created -- confirmed by the file itself importing
and delegating to `resolveRuntimeOpportunity` unchanged.

`customerMasterId` is read from `trustedCustomerSession.masterCustomerIdentity`
(a `{status:"resolved", masterCustomerId: string}` union), never from
`identity.customerId` (a different, unverified identity space -- see
`lib/brain/commercial/identity/master-customer/types.ts`'s own doc comment).
`waId`/`channel` come from `trustedInbound`. A missing session defaults
`channel` to `"whatsapp"` (`TrustedInboundIdentity.channel` is a literal
`"whatsapp"` type -- ATL has no other channel today, not a guess).

## Phase 5/6 -- Existing reuse vs. missing resolution

`ensureCommercialActionOpportunity`'s first check is
`existingOpportunityId !== null` -> return immediately, **zero calls** to
`resolveRuntimeOpportunity`, zero DB round trips. Only a genuinely missing
opportunity reaches the resolver. Proven directly (not just designed): test
`existing opportunityId is reused as-is, no new row created`
(`tests/commercial/ensureCommercialActionOpportunity.test.ts`).

**Why mutating `gatewayContext.opportunityId` in place is required, not just
convenient**: `executeCommercialActionRequest.ts` passes the exact
`gatewayContext` object through to `executeGovernedCapability` unmodified --
the capability reads `context.opportunityId` from *that* object, never from
`request.opportunityId`. Setting only `request.opportunityId` (without also
mutating `gatewayContext.opportunityId`) would build a well-formed request
whose own execution would still see a null opportunity and deny it. The
mutation is therefore load-bearing for the *current* call, and, as a
side effect, also makes a second mutating tool call later in the same turn
reuse the same id without a second resolution (Phase 5's "one resolution per
turn").

## Phase 7 -- Resolution failure semantics

`resolveRuntimeOpportunity` returning `"unavailable"` maps to a distinct
`ToolObservation`: `{status: "failed", errorCode: "opportunity_unavailable"}`
-- built and returned **before** `buildCommercialActionRequestFromAtlStep` is
even called, so `executeCommercialActionRequest`/the Gateway are never
reached (proven by test: zero `crm_opportunities` rows are created for that
conversation either).

`"failed"` (not `"blocked"`) was chosen deliberately, reusing this codebase's
own existing vocabulary split (`buildToolObservation.ts`: `denied`/
`requires_approval`/`invalid_arguments` -> `"blocked"`; anything else,
including a genuine capability failure, -> `"failed"`) -- a resolver-level
infrastructure problem is architecturally the same *kind* of thing as a
capability execution failure, not a policy/business denial, so it gets the
same status bucket. The `errorCode` (`opportunity_unavailable`) is
deliberately distinct from the capability's own `no_active_opportunity`, so a
DB outage can never be misread downstream as "genuinely, permanently no
opportunity for this customer."

`executed: true` (not `false`) was the one non-obvious call. Every other
pre-Gateway block in this function (duplicate, unregistered, not-exposed,
evidence gate) uses `executed: false` because *no resolution attempt was
made at all*. An opportunity-unavailable outcome is different in kind: a
real resolution attempt *was* made and failed, the same budget-accounting
treatment this loop already gives a capability-level `"denied"` (which also
sets `executed: true`). This also happens to be what preserves every
pre-existing budget/sequencing assertion across `runAgentToolLoop.test.ts`'s
~100 pre-existing tests (see Phase 14).

## Phase 8/9 -- CommercialActionRequest boundary and identity order

Unchanged: `executeCommercialActionRequest` is still the only path from a
built request to the Gateway; nothing calls `executeGovernedCapability`
directly for a `COMMERCIAL_ACTION` tool (that branch of the `if/else` in
`processUseToolStep` is untouched). The identity gate
(`evaluateCapabilityIdentityGate`, R3-A02) still runs entirely inside
`executeCommercialActionRequest`, reading `gatewayContext.trustedCustomerSession`
-- it never reads or depends on `opportunityId`, and opportunity resolution
never reads or depends on identity. Order is: resolve opportunity (this
task) -> build request -> validate -> capability mapping -> **identity
gate** -> `executeGovernedCapability`. Proven directly, not just by
inspection: test `CREATE_QUOTE: lazy resolution still creates a durable
opportunity, but the identity gate ... denies the mutation at LEVEL_0` --
`countOpportunitiesForConversation` is 1 (the opportunity really was
created) while the tool observation is `errorCode: "master_identity_required"`,
never `"no_active_opportunity"`.

## Phase 10 -- AgentSession observability

Unchanged, and correct without any new wiring: `commercialActionRequest.opportunityId`
is set to the resolved id before `executeCommercialActionRequest` is called,
so every `COMMERCIAL_ACTION_*` session event it already records
(`recordCommercialActionRequested`/`Accepted`/`Rejected`/`Terminal`) carries
the correct, resolved `opportunityId` automatically -- no change needed to
`sessionEvents.ts`. `AgentSession` itself still has no `opportunityId`
column (confirmed again by reading `agent-session/types.ts`); it stays
conversational memory, never business truth.

**Known, deliberately out-of-scope gap**: the turn-level dispatch/outbox
action row and the `agent_tool_loop_completed` `commercial_event`
(`runNativeAgentToolLoopCycle.ts`'s own `opportunityId` local, computed
*before* the loop runs) are not updated with an opportunity resolved
*during* the same turn -- they still reflect the pre-turn value (`null` on a
turn's first mutation). This never breaks cross-turn continuity (the next
turn re-reads `crm_opportunities` fresh via `loadActiveOpportunity` and finds
the row regardless), and it does not affect any of this task's own
per-action session events (Phase 10 above) or exit criteria. Closing it
would mean threading a resolved id back out through `AgentLoopResult` across
every one of `runAgentToolLoop.ts`'s ~6 terminal return points
(`finalize`/`respondedResult`/two inline `handoff` returns/the
`provider_unavailable` early return) and into `runNativeAgentToolLoopCycle.ts`'s
own two call sites (`dispatchAgentLoopResponse`, the completed-event write) --
real, but wider surface than this slice's "one shared seam" mandate
justifies without separate evidence it causes an actual problem. Documented
here rather than silently patched, per the task brief's own Phase 13
precedent (V1.1 left `loadActiveOpportunity`'s terminal-status gap
undocumented-no-longer, not silently fixed).

## Phase 11 -- Read tools unaffected

`ensureCommercialActionOpportunity` is called from exactly one place: the
`exposure === "COMMERCIAL_ACTION"` branch. The `else` branch
(`exposure === "READ_TOOL"`, covering `search_products`/`get_product_details`/
`explore_catalog`/`search_company_knowledge`/`recommend_catalog_products`/
`calculate_shipping`) was not touched at all. Proven by test: a
`search_products` call with `opportunityId: null` leaves
`crm_opportunities` untouched (row count 0) for that conversation.

## Phase 12 -- Wiring, not a refactor

Diff surface, by file:

- `lib/brain/commercial/commercial-action-request/ensureCommercialActionOpportunity.ts` (new)
- `lib/brain/commercial/commercial-action-request/index.ts` (2 new export lines)
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts`: one new import, one
  new optional field on `RunAgentToolLoopInput` (`ensureOpportunity`, a
  test-only injection point matching this file's own existing convention for
  `provider`/`loadRecentCatalogContext`/`loadPendingCatalogAction`), one new
  parameter on `processUseToolStep` (`currentTime`, `ensureOpportunity`), and
  the new logic block inside the existing `COMMERCIAL_ACTION` branch. Every
  other branch (evidence guards, dedupe, pending catalog action, budgets,
  causation via `inboundMessageId`, identity context via
  `trustedCustomerSession`) is byte-for-byte unchanged.

No change to `native-cycle/`, `buildNativeCommercialContext.ts`,
`runtimeIdentityContext`, `AgentSession`, `ReadToolGateway`/`read-tool-request/`,
`work/` (R2 CommercialWork), `operational-loop/`, or `followup/`.

## Phase 13 -- `loadActiveOpportunity`'s terminal-status gap: still not fixed here

V1.1 documented that `loadActiveOpportunity` (the function that supplies
`opportunityId` into `gatewayContext` in the first place) returns the most
recently updated `crm_opportunities` row for a conversation regardless of
status -- no terminal-status filter. This task's new seam never depends on
that function returning a *correct* answer: `ensureCommercialActionOpportunity`
only trusts a **non-null** `existingOpportunityId` as "already resolved," and
`resolveRuntimeOpportunity` (V1.1) independently re-derives and enforces
terminal exclusion using its own `conversation_case_id` query whenever the
incoming id is null. The one scenario this does **not** cover: a terminal
opportunity that `loadActiveOpportunity` hands in as non-null at the top of
the turn is trusted as "existing" by this seam (never revalidated) -- exactly
matching Phase 5's explicit instruction ("do not perform an unnecessary DB
round trip... this task is wiring, not continuous opportunity revalidation").
`loadActiveOpportunity` itself remains unpatched, exactly as V1.1 left it and
as this task's own Phase 13 instructs.

## Phase 14 -- Tests

**New**, real MariaDB (`crm_test`), `tests/commercial/ensureCommercialActionOpportunity.test.ts`,
7 tests: existing-id reuse (no DB write), create-with-no-session
(channel defaults, ids null), create-with-resolved-`masterCustomerIdentity`
(id propagates), create-with-unresolved-identity (`customerMasterId` stays
null, `waId` still propagates), null-`conversationId` (fails safely, no DB
touch), terminal-prior-opportunity (new one resolved), 4-way concurrent
resolution (converges to one id/one row).

**New**, real MariaDB (`main_management`, matching this file's own existing
convention), `tests/agent-loop/runAgentToolLoop.test.ts`, 6 tests appended:
`READ_TOOL` never creates an opportunity; a `COMMERCIAL_ACTION` with a null
`opportunityId` resolves/creates one and completes; a second turn on the same
conversation reuses it (no duplicate row); `"unavailable"` blocks the request
before the Gateway with a distinct `errorCode` and creates nothing; `CREATE_QUOTE`
at LEVEL_0 still gets denied by the identity gate even though an opportunity
was created; and the full 3-turn browse -> select -> quote E2E scenario
(Phase 15).

Mapping against the brief's 24-item list: 1-15 and 19-24 each have a direct
test above or in the suites listed below; 16-18 (A03/A04/A05 tests remain
green) and 19-21 (Operational Loop/CommercialWork/identity regressions) were
verified by running the existing suites unmodified, not by writing new ones
(nothing in those areas was touched):

- `tests/commercial/commercialActionRequest.test.ts`,
  `tests/commercial/agentCapabilityExposure.test.ts`,
  `tests/commercial/readToolRequest.test.ts` (A03/A04) -- 93/93 (run
  alongside the three `runNativeAgentToolLoopCycle*` suites)
- `tests/commercial/agentRuntimeEvent.test.ts`,
  `tests/commercial/followUpWake.test.ts` (A05) -- included in an 85/85 run
- `tests/commercial/capabilityGatewayIdentityGate.test.ts` (A02 identity) --
  same 85/85 run
- `tests/commercial/opportunityContinuity.test.ts` (operational-loop) --
  same 85/85 run
- `tests/commercial/commercialWorkRepository.test.ts`,
  `tests/commercial/commercialWorkExecutor.test.ts` (CommercialWork) -- same
  85/85 run
- `tests/agent-loop/{buildAgentStepPromptPackage,httpAgentLoopProvider,pendingCatalogAction,recommendCatalogProducts*}.test.ts`,
  `tests/agent-loop/multi-intent/*.test.ts`,
  `tests/commercial/{calculateShippingCapability,catalogRecommendationGatewayAdapter*,createQuoteCapability,selectProductsCapability,selectShippingOptionCapability,shippingDestinationCapability}.test.ts`
  -- 363/363

Total: 108 (`runAgentToolLoop.test.ts`, includes the 6 new + 1 E2E) + 7 (new
`ensureCommercialActionOpportunity.test.ts`) + 93 + 85 + 363 = **656 tests,
0 failures**. `npx tsc --noEmit`: clean.

A real bug was caught and fixed during this work, not shipped: the first
draft of the test-file fake for `ensureOpportunity` ignored
`existingOpportunityId` entirely and always returned `ok:false`, which broke
3 pre-existing tests that pass a real `opportunityId` (`uniqueOpportunityId()`)
expecting a genuinely completed mutation. Fixed by making the fake mirror the
real function's own "existing id short-circuits" behavior -- caught by
running the full suite before considering the task done, not assumed correct
from the design alone.

## Phase 15 -- End-to-end proof

`tests/agent-loop/runAgentToolLoop.test.ts`, test `[R3-V1.2 E2E] one durable
opportunity across a full browse -> select -> quote sequence, no
intent/objective workflow needed`. Three separate `runAgentToolLoop` calls
against the same `conversationId`, real MariaDB throughout:

1. **Turn 1** (`search_products`, pure question) -- `toolExecutionCount === 1`,
   `crm_opportunities` row count for this conversation stays **0**.
2. **Turn 2** (`get_product_details` then `select_products`) --
   `select_products` observation `status === "completed"`, row count becomes
   **1**.
3. **Turn 3** (`create_quote`, LEVEL_0 anonymous session) -- row count stays
   **1** (same `opportunityId` as after turn 2, asserted by identity, not
   just by count), `create_quote` observation is `status: "blocked"`,
   `errorCode: "master_identity_required"` -- never `"no_active_opportunity"`.

No `semanticIntent`/`objectiveType`/`plannedSteps`/`conversationPhase` field
exists anywhere in the code this task added or touched -- confirmed by
`grep` returning zero matches, not by convention alone.

## Limitations (explicit)

- The turn-level dispatch/outbox `opportunityId` propagation gap from Phase
  10 -- real, documented, deliberately not fixed in this slice.
- `loadActiveOpportunity`'s pre-existing terminal-status gap (V1.1) -- still
  unpatched, and this task's own seam does not need it patched to be correct
  (Phase 13).
- `runCommercialMultiIntentLoop` (the multi-intent branch) does not benefit
  from lazy opportunity resolution -- it never used the `CommercialActionRequest`
  boundary in the first place, confirmed by reading it directly; wiring it in
  would mean giving it that boundary first, out of scope here and already
  named as future `REFACTOR` work in `A00`.
- No reopen path for a terminal opportunity (matches V1.1: a terminal prior
  opportunity always yields a brand-new one, never a reopened one).

## Rollback

Purely additive plus one contained change inside one function:

1. Delete `lib/brain/commercial/commercial-action-request/ensureCommercialActionOpportunity.ts`.
2. Remove its two export lines from `commercial-action-request/index.ts`.
3. In `runAgentToolLoop.ts`: remove the `ensureOpportunity` field from
   `RunAgentToolLoopInput`, the `currentTime`/`ensureOpportunity` parameters
   from `processUseToolStep`, and revert the `COMMERCIAL_ACTION` branch to
   read `gatewayContext.opportunityId` directly (the pre-V1.2 3-line form).
4. Delete `tests/commercial/ensureCommercialActionOpportunity.test.ts` and
   the 7 `[R3-V1.2...]`-labeled tests appended to
   `tests/agent-loop/runAgentToolLoop.test.ts` (including the `baseInput`
   `ensureOpportunity` fixture and its supporting helpers).

No migration to revert (no schema change; R3-V1.1's schema is untouched by
this task). No flag to flip (none added).

## Recommended next task

Close the Phase 10 dispatch-propagation gap **only if** a real, observed need
appears (e.g. follow-up scheduling or the Hub's opportunity detail view
needs the turn-of-creation's own outbox row correctly tagged) -- do not
pre-build it speculatively. Otherwise, the natural next step is widening
`commercialCycleConfig.ts`'s ATL routing now that the one structural
prerequisite `A00` flagged (`R3-A06`) is closed -- that is `SalesAgentRuntime`-
adjacent work, explicitly out of scope for this task and the one after it to
scope properly.

---

## Exit criteria

**`R3_V1_2_LAZY_OPPORTUNITY_WIRING_VALIDATED`**

- `READ_TOOL` calls never create an opportunity -- confirmed by test, twice
  (standalone and inside the E2E scenario's turn 1).
- `COMMERCIAL_ACTION` gets a durable opportunity when needed -- confirmed
  (turn 2 of the E2E test; the dedicated lazy-creation test).
- Existing `opportunityId` is reused -- confirmed, and proven to require zero
  DB round trips.
- Missing `opportunityId` is resolved lazily -- confirmed, delegates
  unchanged to R3-V1.1's `resolveRuntimeOpportunity`.
- Terminal prior opportunity is not reused -- confirmed by delegation (V1.1's
  own proof) plus this seam's own terminal-prior-opportunity test.
- Concurrent resolution remains safe -- confirmed, 4-way real concurrency
  test at this seam, on top of V1.1's 5-way proof at the resolver itself.
- `CommercialActionRequest` remains the mutation boundary -- confirmed,
  `executeGovernedCapability` is never called directly for a
  `COMMERCIAL_ACTION` tool.
- Capability Gateway remains the execution choke point -- confirmed, an
  unavailable resolution never reaches it (zero-row-created proof).
- Identity gate behavior is unchanged -- confirmed directly: opportunity
  creation succeeds independently of, and never substitutes for, LEVEL_2
  identity on `CREATE_QUOTE`.
- `AgentSession` remains non-authoritative -- confirmed, no new column, no
  new event type, no canonical state stored there.
- No semantic intent/objective/step machinery introduced -- confirmed by
  `grep`, zero matches.
- Current Operational Loop remains compatible -- confirmed, zero files
  touched, its own suite green.
- `CommercialWork` remains compatible -- confirmed, zero files touched, its
  own suite green.
- `FOLLOWUP_WAKE` remains compatible -- confirmed, zero files touched
  (`followup-wake/`, `followup/`, `events/` untouched), its own suite green.
- No WhatsApp routing changed -- confirmed, `runNativeAutonomousCycle.ts`
  and `commercialCycleConfig.ts` untouched.
- Regressions are clean -- confirmed, 656/656 across every directly and
  indirectly relevant suite, plus `npx tsc --noEmit` clean.

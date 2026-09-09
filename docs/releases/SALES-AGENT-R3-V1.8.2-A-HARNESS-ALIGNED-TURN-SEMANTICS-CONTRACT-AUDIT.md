# SALES-AGENT-R3-V1.8.2-A -- Harness-Aligned Turn Semantics Contract Audit

Status: audit complete, no production code changed. Every claim below is
grounded in the current code on `develop` (HEAD `fa29b09`), not in design
docs or intent. Where design intent or a docs/releases comment disagrees
with what the code actually does, both are stated and the divergence is
called out explicitly. "Harness" in this document means the conceptual
turn/step/quiescence execution-semantics model given in the task brief
(the same reference model `SALES-AGENT-R3-V1.8-B-HARNESS-NATIVE-SESSION-CONTINUITY-AUDIT.md`
established: the DeepSeek Harness *npm package* is not a runtime dependency
of this repository -- zero import under `lib/`/`app/` -- so every "Harness
equivalent" cited below is a semantic comparison, never a claim that R3
calls that package).

## Executive verdict

**`R3_AGENT_LOOP_SEMANTICS_MATERIALLY_DIVERGENT`**

R3 has a real, working execution loop with strong durability guarantees
(claim-once ownership, atomic terminal reconciliation, live mid-turn
steering) but its cognitive loop is **not** turn/step-shaped in the Harness
sense at all: it is two fixed-size counters (`maxDecisions=3`,
`maxToolExecutions=2`) wrapped by a bolt-on "finalization" phase that never
offers tools, with **no concept of "is the work this turn owes actually
done" anywhere in the stack** except one narrow, regex-based guard scoped
to a single tool (`select_products`). `respond` is unconditionally
terminal (`respondedResult()`, [`runAgentToolLoop.ts:842-911`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts)),
`max_steps_exceeded` -- the one terminal reason that should represent
"budget genuinely exhausted while work remained" -- is a dead enum value
the loop never constructs, and a live-assimilation "steering" event
extends the *content* the model must resolve without extending the
*budget* it has to resolve it with. Top 3 causal gaps below.

## Top 3 gaps ranked by causal impact on "bot feels dumb / gets stuck in loops"

1. **Hard 2-tool-call ceiling with no read/mutation distinction, shared by a
   single scarce budget.** `maxToolExecutions=2` is enforced identically
   for the 6 zero-side-effect `READ_TOOL` capabilities and the 4 durable
   `COMMERCIAL_ACTION` capabilities ([`agent-capability-exposure/types.ts:20-70`](../../lib/brain/commercial/agent-capability-exposure/types.ts)).
   A realistic 3-hop read chain (`search_products` -> `get_product_details`
   -> `recommend_catalog_products`, or a retry after `no_match`) cannot fit
   inside 2 calls, ever, in one turn -- regardless of how many
   `maxDecisions` remain. Finalization (the only phase reached once
   `toolExecutionCount` hits 2) never offers tools
   ([`runAgentToolLoop.ts:1171-1185`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts),
   `availableTools: []`). This is the direct, mechanical cause of "Déjame
   buscar..." followed by termination: the model narrates an intention to
   search further because searching further is the only honest description
   of what it still needs, but the runtime has already structurally
   revoked its ability to do so this turn.
2. **`respond` is unconditionally terminal; no general "is work owed"
   checkpoint exists.** The instant a `respond` AgentStep validates and
   passes the (recency-only) live-assimilation gate, `respondedResult()`
   returns immediately ([`runAgentToolLoop.ts:1054-1056`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts),
   [`:1249-1251`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts)).
   The only content-level gate is `checkUnbackedCommercialMutationClaim`
   ([`commercialMutationClaims.ts:71-86`](../../lib/brain/commercial/agent-loop/commercialMutationClaims.ts)),
   a regex match against 6 fixed Spanish phrasings scoped exclusively to
   `select_products` completion claims -- it can swap the message for a
   fallback string, but it can never force another cognitive step. Nothing
   checks whether a `no_match`/`failed`/`blocked` tool observation earlier
   this turn was ever actually resolved before the model terminates on it.
3. **`pendingCatalogAction` authority is 100% prompt-instructed, 0%
   code-enforced, and the model never sees its own turn's live updates to
   it.** `buildAgentStepPromptPackage` is called with
   `pendingCatalogAction: input.pendingCatalogAction ?? null` in both
   phases ([`runAgentToolLoop.ts:967`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts),
   [`:1176`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts)) --
   always the turn-entry snapshot, never the runtime's own mid-turn
   `activeRecommendationPendingAction`, which only reaches the model
   indirectly via raw tool-observation JSON in `priorStepsThisTurn`. Worse:
   the evidence gate that authorizes `get_product_details` against a
   pending candidate ([`runAgentToolLoop.ts:534-557`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts))
   has no concept of "the customer just declined this candidate" -- a
   candidate productId remains structurally authorized purely by having
   appeared in `candidateProductIds`, regardless of what the customer said
   this turn. Recovery from "no quiero el pack" while a `send_product_link`
   offer for that exact product is open depends entirely on the model
   correctly reading `PENDING_CATALOG_ACTION_RULE_LINES`'s free-text
   instruction ([`buildAgentStepPromptPackage.ts:338-345`](../../lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts)).
   This is a direct contributor to "repetitive recommendation of
   previously rejected products" and "returning to the same catalog
   candidate."

---

## Deliverable 1 -- Current R3 execution model (from code)

```
Meta webhook (delay>0) OR runTurnSettleTick.ts poll
  -> claimPendingTurn()                                   [durable, CAS, mutual excl. per conversation]
       repository.ts:137-151
  -> assembleTurnFragments() / checkForNewInbound()        [durable read: conversation_message]
       assembleTurnFragments.ts:23-49
  -> ensureAutonomousSalesTurnContinuity (not audited in depth -- out of primary scope, wires flags)
  -> runSalesAgentRuntimeCycle()                            = ONE TURN, by construction
       runSalesAgentRuntimeCycle.ts:330
       durable read: resolvePersistentSessionCognitionContext (agent_session_event)
       disposable: commercialContextSummary snapshot (buildMinimalCommercialContextSummary)
       |
       -> runSalesAgentRuntime()                            salesAgentRuntime.ts:286
            durable write: recordUserMessageReceivedEvent (agent_session_event, best-effort)
            |
            -> runAgentToolLoop()                            runAgentToolLoop.ts:693  <- THE LOOP
                 |
                 -- Phase 1: GATHERING (bounded: maxDecisions=3 AND maxToolExecutions=2) --
                 while (decisionIndex < maxDecisions && toolExecutionCount < maxToolExecutions):  [:956]
                   deadline check -> terminal "timeout"                                  [:957-960, TERMINAL, no budget cost]
                   buildAgentStepPromptPackage(phase=gathering)                          [:962-976; disposable, rebuilt from scratch]
                   invokeProviderWithDeadline()  -- 1 provider call                      [:981; possible side effect: none (read-only call)]
                   |-- timeout -> terminal "timeout"                                     [:988-992, TERMINAL]
                   |-- error, invalid_response, 1st time -> 1-shot repair, retry SAME slot [:1005-1012, no budget cost, NOT terminal]
                   |-- error, else -> terminal "provider_unavailable"                     [:1013, TERMINAL]
                   validateAgentStep()                                                    [:1018]
                   |-- invalid, 1st time -> 1-shot repair, retry SAME slot                [:1028-1034, no budget cost, NOT terminal]
                   |-- invalid, 2nd time -> break to Phase 2 (NOT terminal itself)         [:1021-1027]
                   tryAssimilate() [Boundary 1, universal pre-action gate]                 [:1049; durable read: conversation_message]
                   |-- found new inbound -> discard candidate, continue (NO budget cost)   [:1049-1052, possible assimilation]
                   step.type === "respond" -> terminal "responded"                         [:1054-1056, TERMINAL, possible side effect via pendingCatalogAction carry]
                   step.type === "handoff" -> terminal "handoff"                           [:1059-1062, TERMINAL]
                   step.type === "use_tool" -> processUseToolStep()                        [:1065; possible side effect: Capability Gateway write]
                     |-- executed:false (dedupe/unregistered/evidence-blocked/invalid_args) -> NO tool-budget cost
                     |-- executed:true  (attempted, completed/failed/denied alike)         -> toolExecutionCount += 1  [:1070]
                   tryAssimilate() [Boundary 2, post-tool]                                  [:1136; return value ignored -- cannot un-execute a mutation]
                   decisionIndex += 1                                                       [:1138]  <- ONLY place this counter advances
                 -- loop exits when EITHER budget exhausted, OR deadline, OR terminal above --
                 |
                 -- Phase 2: FINALIZATION (bounded ONLY by FINALIZATION_MAX_ATTEMPTS=2 format-repair retries + deadline) --
                 while (true):                                                              [:1165]
                   deadline check -> terminal "timeout"                                     [:1166-1169, TERMINAL]
                   buildAgentStepPromptPackage(phase=finalization, availableTools=[])        [:1171-1185; NO tools offered]
                   invokeProviderWithDeadline() -- 1 provider call
                   |-- error/invalid, repair budget remaining -> retry (NOT terminal)        [:1208-1214, :1223-1229]
                   |-- error, repair exhausted -> terminal "provider_unavailable"             [:1215, TERMINAL]
                   |-- invalid, repair exhausted -> terminal "invalid_output"                  [:1230-1231, TERMINAL]
                   tryAssimilate() [Boundary 1, same universal gate as gathering]              [:1242; unbounded except by deadline -- NOT capped by formatRepairAttempt]
                   step.type === "respond" -> terminal "responded"                             [:1249-1251, TERMINAL]
                   step.type === "handoff" -> terminal "handoff"                               [:1252-1254, TERMINAL]
                   (use_tool structurally rejected here by validateAgentStep's allowedTypes)
  <- AgentLoopResult (terminalReason, steps, finalMessage/handoffReason, finalPendingCatalogAction, liveTurnAssimilation fields)
  -> dispatchSalesAgentTerminalOutcome()                     dispatchSalesAgentTerminalOutcome.ts:107
       -> dispatchSalesAgentResponse / dispatchSalesAgentFallback / dispatchSalesAgentHardHandoff
            -> dispatchGovernedSalesAgentMessage()            dispatchGovernedSalesAgentMessage.ts:169
                 SAME TRANSACTION: ownership recheck (FOR UPDATE) -> freshness recheck
                   -> writeCanonicalOutboxMessage (brain_message_outbox insert, durable)
                   -> completeTurn(selfSettlementId)          [durable, PROCESSING->COMPLETED]
                   -> reconcileAssimilatedSiblings()          [durable, sibling PENDING rows -> ASSIMILATED/advanced]
  -> recordAssistantMessageSentEvent / recordAgentToolLoopCompletedCommercialEvent (durable, observability, non-blocking)
```

Key structural fact this diagram makes visible: **there is exactly one
`runAgentToolLoop` invocation per settlement row, and exactly one
settlement row is ever `PROCESSING` per conversation at a time**
(`claimPendingTurn`'s `NOT EXISTS` guard, [`repository.ts:137-151`](../../lib/brain/commercial/turn-settlement/repository.ts)).
Live assimilation folds new *content* into that one invocation; it never
spawns, resumes, or hands off to a second invocation. The "turn" and "the
one bounded loop call" are the same object in code, not two concepts that
happen to align today.

---

## Deliverable 2 -- Turn/Step contract as implemented today

**R3 Turn (current code)** = the union of four things that are not
independently defined, only structurally coincident:
1. one `crm_inbound_turn_settlements` row's `PENDING -> PROCESSING ->
   {COMPLETED|SUPERSEDED|ASSIMILATED}` lifecycle ([`repository.ts`](../../lib/brain/commercial/turn-settlement/repository.ts)),
2. one `runSalesAgentRuntimeCycle()` call ([`runSalesAgentRuntimeCycle.ts:330`](../../lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts)),
3. one `runAgentToolLoop()` invocation ([`runAgentToolLoop.ts:693`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts)),
4. one terminal-dispatch transaction ([`dispatchGovernedSalesAgentMessage.ts:169`](../../lib/brain/commercial/sales-agent-runtime/dispatchGovernedSalesAgentMessage.ts)).

So, answering the task's own question directly: **"turn" today is a
hybrid that collapses to "one `runAgentToolLoop` invocation"** -- not "one
settlement" alone (a settlement can be superseded/reconciled without ever
producing its own loop run, and live assimilation lets ONE loop invocation
answer for MULTIPLE settlement rows' worth of customer content), not "one
provider request" (a turn spans up to 3 gathering + up to 2 finalization
provider requests), and not "one response" (a `respond`/`handoff` step is
the terminal *event* inside a turn, not the turn itself). There is no code
path where a "turn" outlives or is resumed independently of its one
`runAgentToolLoop` call -- CURRENT CODE has no session-resume analog to
Harness's `agent.followup()`/`ctx.agents.resume()` (confirmed absent by
`V1.8-B`'s own exhaustive Harness-package-import grep).

**R3 Step (current code)** = one `decisionIndex` slot in the gathering
phase: exactly one provider call that survives to a *validated* AgentStep,
plus (if `use_tool`) the one governed tool execution associated with it.
Format-repair retries (`gatheringRetryUsed`,
`gatheringStructuredRecoveryUsed`) do **not** advance `decisionIndex` --
they are sub-step retries of the same slot, consumed from their own
one-shot-per-phase flags, not from the step budget
([`runAgentToolLoop.ts:1005-1034`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts)).
This is structurally close to the Harness definition ("one model request
plus tool calls/results associated with that request") **except R3's step
is capped at exactly 0 or 1 tool call, strictly sequential** -- there is no
parallel-tool-call class anywhere in `processUseToolStep`.

Finalization is explicitly **not** organized by step at all:
`AgentLoopInferenceRecord.decisionIndex` is `null` for every finalization
call ([`agentStepTypes.ts:251`](../../lib/brain/commercial/agent-loop/agentStepTypes.ts)),
and its own doc comment says so ("finalization is not organized by
decision"). It is a bolt-on retry loop with its own budget vocabulary
(`formatRepairAttempt`, capped at `FINALIZATION_MAX_ATTEMPTS - 1 = 1`
retry) that happens to also be where every gathering-budget exhaustion
silently lands.

**Does current code have a first-class "work still owed" concept?**
**No.** The closest candidates are all narrower, single-purpose
mechanisms, not a general concept:
- `checkUnbackedCommercialMutationClaim` -- regex-gated, `select_products`
  only ([`commercialMutationClaims.ts`](../../lib/brain/commercial/agent-loop/commercialMutationClaims.ts)).
- The live-assimilation pre-action gate -- answers "is this candidate
  stale," never "is this candidate complete" ([`runAgentToolLoop.ts:1049`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts)).
- `pendingCatalogAction` -- a *cross-turn* continuity hint, explicitly
  documented as observability-only within the turn that produces it
  ([`runAgentToolLoop.ts:824-831`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts): "functional
  continuity comes entirely from what this turn's own terminal respond
  step does or does not carry").

None of these evaluate, at the moment `respond`/`handoff` is about to be
accepted, "does anything this turn observed still need resolving." DESIGN
INTENT (per this turn's own task brief and the V1.8.1b memory) explicitly
frames Live Turn Assimilation as solving *steering* (new customer input),
not *completion* (unresolved model-internal obligation) -- the two are
genuinely different problems, and only the first is solved today.

---

## Deliverable 3 -- Complete termination matrix

| Condition | Where in code | Current behavior | Terminal? | Consumes step? | Consumes tool budget? | Steering can invalidate? | Freshness can block? | Harness equivalent |
|---|---|---|---|---|---|---|---|---|
| model returns `use_tool` | `runAgentToolLoop.ts:1064-1071` (gathering only; rejected in finalization by `validateAgentStep`'s `allowedTypes`) | dispatched to `processUseToolStep` | No | Yes (decisionIndex+=1 at :1138) | Only if `executed:true` | Yes (Boundary 1, before dispatch) | N/A (not a dispatch event) | step w/ tool_use block |
| model returns `respond` | `:1054-1056` (gathering), `:1249-1251` (finalization) | `respondedResult()` -- immediate | **Yes** ("responded") | N/A (terminal) | N/A | Yes (Boundary 1, before acceptance) | Yes, at dispatch layer only (`recheckInboundFreshness`) | turn/end via `stop` |
| model returns `handoff` | `:1059-1062`, `:1252-1254` | `handoffResult()` -- immediate | **Yes** ("handoff") | N/A | N/A | Yes (Boundary 1) | No -- explicitly excluded from `checkInboundFreshness` threading (`dispatchSalesAgentTerminalOutcome.ts:52-63`) | agent error / escalation exit |
| invalid model output (schema) | `validateAgentStep()`, `runAgentToolLoop.ts:1018-1034` (gathering), `:1220-1231` (finalization) | gathering: 1 retry then falls to finalization; finalization: 1 retry then terminal | Gathering: No. Finalization: **Yes** ("invalid_output") | No | No | N/A | N/A | malformed tool-call recovery |
| format repair (`invalid_response`) | `:1005-1012` (gathering), `:1208-1214` (finalization) | 1-shot retry, same slot | Gathering: No; exhausted -> `provider_unavailable`. Finalization: same, capped by `FINALIZATION_MAX_ATTEMPTS` | No | No | N/A | N/A | structured-output repair |
| tool success | `processUseToolStep`, `:672-677` | pushed to `steps`, observation fed forward | No | (already counted above) | Yes | N/A (already durable) | N/A | tool_result success |
| tool failure (capability-level) | `gatewayResult.status` other than `invalid_arguments` | observation status `failed`, budget consumed (`opportunity_unavailable` explicitly documented as budget-costing, `:599-619`) | No | (counted) | **Yes** | N/A | N/A | tool_result error |
| tool blocked (dedupe/unregistered/evidence/not-exposed) | `:460-580` | observation `blocked`, **free** | No | No | **No** | N/A | N/A | no Harness analog -- pre-flight client-side reject |
| `no_match` (e.g. empty `search_products`) | Not a distinct status -- surfaces as `status:"completed"` with an empty result set, or `skipped` for `recommend_catalog_products` (`TOOL_OBSERVATION_STATUSES`, `agentStepTypes.ts:80`) | consumes budget like any executed call | No | (counted) | Yes | N/A | N/A | no Harness analog; R3 has no distinct "empty result" terminal class |
| tool budget exhausted | gathering `while` condition, `:956` | falls through to finalization (silently, no event) | **No terminal reason exists for this** | -- | -- | N/A | N/A | should map to a distinct "budget exhausted" turn-stopping reason; R3 has none |
| step budget exhausted | same `while` condition | same silent fallthrough | **No** | -- | -- | N/A | N/A | same gap |
| timeout/deadline | `Date.now() > deadline`, checked at top of both phase loops (`:957`, `:1166`) | immediate `finalize("timeout")` | **Yes** ("timeout") | No | No | N/A | N/A | deadline/cancellation |
| live assimilation detected | `tryAssimilate()` returns true, Boundary 1 (`:1049`, `:1242`) | current candidate discarded, loop `continue`s, `invalidatedCandidateCount+=1` | No | **No** (free) | **No** (free) | -- (this IS the invalidation) | N/A | steering/inbox interrupt |
| stale candidate (respond/handoff/use_tool built from pre-assimilation state) | same as above -- Boundary 1 is the ONLY staleness gate; there is no separate "stale" classification | discarded before any consequence | No | No | No | -- | N/A | discard-and-rederive on interrupt |
| terminal freshness failure (newer inbound arrived during/after dispatch) | `dispatchGovernedSalesAgentMessage.ts:187-191`, `recheckInboundFreshness` at `:152-162` | `skipped("superseded_by_newer_inbound")`, opt-in via `checkInboundFreshness` | Yes, at dispatch layer (turn-settlement worker path only; delay=0 path never checks this) | N/A (post-loop) | N/A | N/A | **Yes -- this is the actual freshness gate** | idempotent commit guard |
| human owner active | `salesAgentRuntime.ts:289` (pre-loop) AND `dispatchGovernedSalesAgentMessage.ts:172` + `recheckConversationOwnership` (dispatch-time, `FOR UPDATE`) | pre-loop: `blockedResult`, model never invoked. Dispatch-time: `skipped("human_owner_active")` even if the model already ran | Yes (two independent gates) | N/A | N/A | N/A | N/A | no Harness analog -- R3-specific governance |
| provider error (network/auth/rate-limit/etc.) | `invokeProviderWithDeadline`'s `error` branch, classified by `classifyAgentLoopProviderFailure` | non-`invalid_response` reasons fail immediately | **Yes** ("provider_unavailable") | No | No | N/A | N/A | provider-level failure |

Two structural findings this table surfaces that the narrative sections
below build on:
- **"tool budget exhausted" and "step budget exhausted" are not terminal
  reasons at all in the current code** -- they are silent phase
  transitions. `max_steps_exceeded` is declared in
  `AGENT_LOOP_TERMINAL_REASONS` ([`agentStepTypes.ts:142-150`](../../lib/brain/commercial/agent-loop/agentStepTypes.ts))
  and consumed by downstream mapping tables (`TERMINAL_REASON_TO_STATUS`
  in `salesAgentRuntime.ts:277-284`, `FAILURE_REASON_TO_TERMINAL_REASON`
  in `runSalesAgentRuntimeCycle.ts:283-287`, `dispatchSalesAgentFallback.ts`,
  `salesTurnDisposition.ts`) but **`runAgentToolLoop.ts` itself never
  constructs it** -- confirmed by exhaustive grep (zero matches in that
  file). It is dead code from the loop's own perspective: every path that
  could plausibly want to report "ran out of budget with unresolved
  intent" instead silently becomes whatever finalization eventually
  decides (usually `responded`, sometimes `invalid_output`).
- **`no_match`/empty-result is not a distinct observation status** --
  `TOOL_OBSERVATION_STATUSES` is only `completed | failed | blocked |
  skipped` ([`agentStepTypes.ts:80`](../../lib/brain/commercial/agent-loop/agentStepTypes.ts)).
  An empty `search_products` result is `status:"completed"` with `data`
  containing zero items -- structurally indistinguishable, at the
  governance layer, from a successful, informative result. The model has
  to infer "this was a dead end" from the shape of `data`, and the runtime
  has no distinct signal to build a "materially different recovery
  attempt" policy against (relevant to Deliverable 12, test 4).

---

## Deliverable 4 -- Budget audit

`effectiveMaxAgentStepsPerTurn`/`effectiveMaxToolCallsPerTurn` originate in
`SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT = { maxAgentStepsPerTurn: 3,
maxToolCallsPerTurn: 2 }` ([`sales-agent-configuration/defaults.ts:43-46`](../../lib/brain/commercial/sales-agent-configuration/defaults.ts)),
resolvable to an admin-published override via `resolver.ts` (not audited
line-by-line here -- out of primary scope, and the task's own live evidence
confirms 3/2 is what production actually resolves to today). They reach
`runAgentToolLoop` as `maxDecisions`/`maxToolExecutions` through
`runSalesAgentRuntimeCycle.ts:364-365` -> `salesAgentRuntime.ts` ->
`RunAgentToolLoopInput.maxDecisions/maxToolExecutions` -> defaulted again
(redundantly, but consistently) to `DEFAULT_MAX_DECISIONS=3`/
`DEFAULT_MAX_TOOL_EXECUTIONS=2` in `runAgentToolLoop.ts:86-87,694-695` if
ever omitted.

- **What increments `decisionIndex`?** Exactly one line,
  `runAgentToolLoop.ts:1138`, reached only after a `use_tool` step's
  `processUseToolStep` call fully returns. A `respond`/`handoff` step never
  reaches this line (the function returns first) -- moot, since the turn is
  over either way, but it means the counter literally only ever measures
  "how many `use_tool` round-trips have completed," not "how many model
  calls have happened."
- **What increments `toolExecutionCount`?** `runAgentToolLoop.ts:1070`,
  gated on `result.executed`, which `processUseToolStep` sets `true` only
  when a real attempt reached (or was correctly routed toward) the
  Capability Gateway/ensureOpportunity -- see the per-branch trace below.
- **Does stale-candidate invalidation consume decision budget?** **No.**
  `tryAssimilate()` returning `true` triggers `continue` before
  `decisionIndex += 1` is ever reached ([`:1049-1052`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts)).
  Free, by design (comment at `:1044-1048` states this explicitly).
- **Does format repair consume step budget?** **No** -- it consumes its own
  one-shot-per-phase flags (`gatheringRetryUsed`,
  `gatheringStructuredRecoveryUsed`), never `decisionIndex`.
- **Does a blocked tool consume tool budget?** **No**, for every
  before-the-Gateway block: unregistered (`:460-463`), duplicate
  (`:465-468`), recommendation-evidence-blocked (`:477-487`),
  selection-evidence-blocked (`:505-522`), pending-catalog-mismatch
  (`:534-557`), not-exposed (`:571-580`). All return `executed: false`.
- **Does a failed tool consume tool budget?** **Yes.** A capability-level
  `failed`/`invalid_arguments`-that-still-reached-the-Gateway/`denied`
  observation still sets `executed: true` at `:677` (the sole exception,
  `invalid_arguments`, is explicitly `executed: false` at `:674` --
  malformed arguments never reached real work). The `opportunity_unavailable`
  infrastructure-failure branch (`:599-619`) is explicitly documented as
  budget-costing on purpose ("a real resolution attempt was made and
  failed").
- **Does `no_match` consume tool budget?** **Yes** -- an empty result set
  is `status:"completed"`, indistinguishable from a useful result at the
  governance layer (see Deliverable 3's second finding). There is no
  cheaper "that came back empty, try again" path; a retry after `no_match`
  costs exactly as much budget as the original call.
- **Can steering extend the turn without extending budget?** **Yes, and
  this is the single most consequential finding in this section.** Live
  assimilation can fold in arbitrarily many new customer fragments across
  arbitrarily many `tryAssimilate()` cycles (`assimilationCycleCount` is
  unbounded except by the wall-clock `deadline`) while `maxDecisions`/
  `maxToolExecutions` stay fixed at whatever they were resolved to at turn
  start. A customer who sends 3 follow-up messages mid-cognition gives the
  model *more to resolve* with the *same* 3-decision/2-tool ceiling a
  single short message would have received.
- **Can a successful tool leave insufficient budget for reasoning over its
  result?** **Yes, structurally guaranteed in the common case.** With
  `maxToolExecutions=2`, the moment the 2nd tool call executes,
  `toolExecutionCount` becomes 2; on the *very next* loop-condition check
  (`decisionIndex < 3 && toolExecutionCount < 2`) the second clause is
  false regardless of how many decisions remain, so gathering exits
  immediately to finalization -- which offers zero tools. A 3-hop
  read chain (see Top Gap #1) cannot complete in one turn no matter what
  `maxDecisions` is set to; only `maxToolExecutions` matters for that
  class of need, and it is fixed at 2.

---

## Deliverable 5 -- `respond` semantics audit

- **Is `respond` automatically terminal?** **Yes, unconditionally**, in
  both phases, the instant the step validates and clears the live-
  assimilation freshness gate: `runAgentToolLoop.ts:1054-1056` (gathering),
  `:1249-1251` (finalization). No other code path re-enters the loop after
  this point.
- **Is there any semantic completion checkpoint?** Only
  `checkUnbackedCommercialMutationClaim`, invoked inside `respondedResult()`
  ([`:842-857`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts)),
  and it is narrow by explicit design (own doc comment: "Deliberately
  narrow ... never generalized to every capability"). It can only
  *substitute* the outgoing message text (`MUTATION_CLAIM_GUARD_FALLBACK_MESSAGE`,
  `:100-101`) for one specific claim class (`select_products`
  completion phrasing matched against 6 fixed regexes,
  `commercialMutationClaims.ts:38-52`). It never triggers another
  cognitive step.
- **Can the runtime force another step after a valid `respond`?** **No.**
  The only mechanism that ever "un-terminates" a candidate `respond` is
  Boundary 1's freshness check, and it only fires *before* the step is
  accepted as a candidate at all (i.e., discards it and loops) -- once
  `respondedResult()` is called and returns, there is no path back into
  the `while` loop.
- **Can the runtime detect that the response itself promises future
  work?** **No.** No code inspects `finalMessage` for future-tense/
  intention phrasing ("déjame buscar," "voy a revisar," "dame un momento")
  to decide whether to keep going. `checkUnbackedCommercialMutationClaim`
  looks for *completion* claims, the opposite direction.
- **Can a tool result remain cognitively unresolved while `respond`
  terminates?** **Yes**, structurally unguarded. A `blocked`/`failed`/
  empty-result tool observation earlier this turn places no obligation on
  the following `respond` step; nothing in `respondedResult()` inspects
  `steps` for unresolved observations except the one `select_products`-
  scoped check.
- **Can `pendingCatalogAction`/new evidence imply work is still owed?**
  **No, not within the current turn.** `pendingCatalogAction` is a
  *next-turn* continuity artifact (own comment at `:824-831`: "functional
  continuity comes entirely from what this turn's own terminal respond
  step does or does not carry"). It never blocks or extends the *current*
  turn's termination.
- **Is freshness the only barrier before dispatch?** At the loop layer:
  effectively yes (Boundary 1's recency check) plus the one narrow
  mutation-claim substitution. At the dispatch layer
  (`dispatchGovernedSalesAgentMessage.ts`): ownership recheck
  (`human_owner_active`/`ai_blocked`/`conversation_closed`) plus a second,
  independent freshness recheck (`checkInboundFreshness`). **No layer, at
  any point in the stack, asks "was this turn's own work actually
  complete."**

Every place `model says respond -> runtime accepts terminal`:
`runAgentToolLoop.ts:1054-1056`, `:1249-1251` (both unconditional past the
freshness gate).

---

## Deliverable 6 -- Pending-work audit

| Structure | Purpose | Lifetime | Durable? | Created by | Consumed by | Invalidated by | Survives across turns? | Can conflict with latest intent? | Influences prompt authority? |
|---|---|---|---|---|---|---|---|---|---|
| `pendingCatalogAction` (turn-entry) | "assistant's last reply offered a product link, customer may be answering it" | 1 turn latency, by construction | Yes -- reloaded from the most recent `agent_tool_loop_completed` `commercial_event` row per conversation (`pendingCatalogAction.ts:275-300`), **not scoped to a specific turn/settlement id, just "most recent event for this conversationId"** | Model (`respond.pendingCatalogAction`) OR runtime (`buildPendingCatalogActionFromRecommendation`, `pendingCatalogAction.ts:112-134`) | Prompt (frozen snapshot, `PENDING_CATALOG_ACTION_RULE_LINES`); `get_product_details` evidence gate | Implicitly, by the next turn producing its own newer event row (never explicitly expired/marked stale) | **Yes**, exactly one turn | **Yes** -- Top Gap #3 | **Yes**, but only as inert JSON data the model must interpret; zero code-level authority arbitration |
| `activeRecommendationPendingAction` (runtime-local) | Gate `get_product_details` evidence against a `recommend_catalog_products` result **within the same turn** | 1 `runAgentToolLoop` call | No (in-memory only) | Runtime, from a completed `recommend_catalog_products` observation (`runAgentToolLoop.ts:1095-1105`) | `processUseToolStep`'s `get_product_details` gate (`:534-557`); `respondedResult`'s carry-forward fallback | A later `recommend_catalog_products` call this turn (renewal/empty-invalidation, `:1095-1105`) | No (turn-scoped only; may seed `pendingCatalogAction` for next turn via the carry-forward fallback) | Not directly (turn-scoped), but its *absence from the prompt* is itself the Top Gap #3 finding | **No** -- never passed to `buildAgentStepPromptPackage`; the model only sees it indirectly via raw tool-observation JSON |
| `crm_inbound_turn_settlements` PROCESSING row | "this customer input's processing responsibility is durably owed" | 1 claim, until terminal | **Yes**, canonical | Turn-settlement worker (`claimPendingTurn`) | `completeTurn`/`supersedeTurn`/`reconcileAssimilatedSiblings` | Its own terminal transition | N/A (it IS the cross-turn durability primitive) | N/A -- orchestration-only | **No** -- invisible to `buildAgentStepPromptPackage`; purely an ownership/scheduling primitive |
| Sibling PENDING settlement rows | Fragments that arrived while another turn for the same conversation was `PROCESSING` | Until reconciled at terminal dispatch | Yes | `upsertPendingTurn` (webhook, on new inbound) | `reconcileAssimilatedSiblings`, atomically with the outbox write (`dispatchGovernedSalesAgentMessage.ts:234-242`) | Fully covered -> `ASSIMILATED`; partially covered -> range advanced, stays `PENDING` | Yes, until reconciled | No -- reconciliation is purely range-arithmetic against the anchor, not semantic | N/A |
| `recentCatalogContext` | Ephemeral product-identity continuity ("which product does 'the second one' mean") | Cross-turn (DB-correlated), explicitly never price/stock authority | Yes | `recordAgentToolLoopCompletedCommercialEvent` (per-turn write) | Prompt (`RECENT_CATALOG_CONTEXT_RULE_LINES`); evidence gates (`collectAllowedProductIds`) | Not explicitly -- ages out only by whatever load-window the loader applies (not audited in this pass) | Yes | Possible (stale reference), but the prompt rules already require re-verification via `get_product_details` | Yes, structurally, but explicitly downgraded to "identity only, never current fact" by prompt rule |
| `commercialContextSummary`/snapshot fields (opportunity/needProfile/shippingDestination/commercialLineItems) | Durable backend commercial truth | Cross-turn, re-read fresh each turn (and mid-turn via `refreshCommercialContextSummary` when live assimilation triggers a refresh) | Yes | Backend domain writes (outside this audit's primary scope) | Prompt (`commercialContext` field); tool-argument enrichment (`enrichToolArguments`) | Backend mutation | Yes | Not itself -- it's the ground truth other things must agree with | Yes -- highest non-immutable authority tier |
| `formatRepairAttempt` / `gatheringPendingRepairSignal` / `finalizationPendingRepairSignal` | Format-level "the previous provider call was malformed, guide the retry" | 1 call | No | The loop itself, on a validation/provider failure | The very next `buildAgentStepPromptPackage` call only | Consumed immediately, always reset to null (`:979`, `:1187`) | No | No -- format-only, orthogonal to commercial intent | Yes, but scoped to Layer 0 (repair instruction only) |
| Out of primary scope, noted for honesty: `crm_commercial_work` / `CommercialWork` executor (`lib/brain/commercial/work/*`) | A structurally separate, deterministic multi-objective execution model (own prior audit found lineage gaps: a `COMPLETED` work is invisible to `findActiveCommercialWorks`) | N/A | Yes | N/A | N/A | N/A | N/A | Not evaluated here -- it is not on this task's Primary Targets list and is architecturally a different runtime path (multi-intent planner / operational loop), not `SalesAgentRuntime` | N/A |

The load-bearing finding this table produces (already stated as Top Gap
#3, repeated here in its "fragmented pending-work semantics" framing): R3
has **two disjoint representations of the same fact** -- "which product(s)
is the pending link-offer about" -- one frozen at turn entry and visible to
the model (`input.pendingCatalogAction`), one live and updated mid-turn but
invisible to the model (`activeRecommendationPendingAction`). They are
reconciled exactly once, at the very end of the turn
(`respondedResult`'s `recommendationPendingCatalogAction` fallback,
`:890-894`), never mid-turn.

---

## Deliverable 7 -- Context authority audit

`buildAgentStepPromptPackage` assembles messages in a fixed 6-layer order
(own comment, `buildAgentStepPromptPackage.ts:636-654`), never reordered by
data:

| Source | Authority level | Freshness | Lifetime | Invalidation semantics | Can conflict with current intent? | Code-level conflict resolution? |
|---|---|---|---|---|---|---|
| Layer 0: `priorAttemptFailure` repair instruction | Highest, transient | This exact call only | 1 call | Always consumed/reset | No (format-only) | N/A |
| Layer 1: loop contract (phase rules, JSON shape) | Immutable, fixed | Static per phase | Whole turn | Never | No | `IMMUTABLE_CONFIGURATION_BOUNDARY_LINE` asserts it always wins over Layer 3 |
| Layer 2: evidence/tool-usage rules (all the `*_RULE_LINES` blocks) | Immutable, fixed | Static | Whole turn | Never | Partially -- e.g. `PENDING_CATALOG_ACTION_RULE_LINES` explicitly tells the model to prioritize a topic change over the pending offer | **Instruction-only**, no code enforcement (Top Gap #3) |
| Layer 3: identity/configuration (`renderSalesAgentIdentityPrompt`) | Editable (admin-published), subordinate | Static per turn | Whole turn | Admin republish | Cannot -- explicitly forbidden by Layer 4 | `IMMUTABLE_CONFIGURATION_BOUNDARY_LINE` |
| Layer 4: immutable closing boundary line | Fixed | Static | Whole turn | Never | N/A | Is itself the enforcement mechanism for Layers 1-3 |
| `customerMessage` (user payload) | Highest *data* authority (the actual live intent) | Live -- cumulative, mutated by `tryAssimilate()` mid-turn | Whole turn, growing | Overwritten by assimilation | Is the reference point everything else must agree with | No explicit priority statement anywhere that customerMessage > pendingCatalogAction; only the pendingCatalogAction rule block states the resolution, one-directionally |
| `commercialContext` (=`commercialContextSummary`) | High, backend-authoritative | Can be refreshed mid-turn (`refreshCommercialContextSummary`, only when live assimilation actually fires) | Whole turn, may change | Backend re-read | Rarely -- it's ground truth | N/A |
| `recentCatalogContext` | Low, identity-only | **Frozen at turn start** (`input.recentCatalogContext`, never refreshed mid-turn even when `commercialContextSummary` is) | Whole turn, static | Never mid-turn | Yes (stale reference) | Prompt rule requires re-verification via `get_product_details` before treating as current |
| `pendingCatalogAction` (as sent to the model) | Medium, but see Top Gap #3 | **Frozen at turn ENTRY** (`input.pendingCatalogAction`), never updated mid-turn even when the runtime's own `activeRecommendationPendingAction` changes | Whole turn, static, and 1-turn cross-turn latency before that | Never mid-turn; next turn's own event supersedes | **Yes -- the documented collision scenario** | **Instruction-only** (`PENDING_CATALOG_ACTION_RULE_LINES` bullet 5), zero code arbitration |
| `conversationContinuity` | Low, tone-only | Derived once per turn | Whole turn, static | Never mid-turn | No (explicitly scoped to tone/framing, `CONVERSATION_CONTINUITY_RULE_LINES` last line: "never override the evidence and tool-usage rules") | Self-limiting by its own prompt text |
| `priorStepsThisTurn` | High, structural | Live, grows every step | Whole turn | Never (append-only) | No -- it IS this turn's own evidence | N/A |
| `persistentSessionHistoricalMessages` | High, durable cross-turn transcript | Static this turn (loaded once) | Cross-turn | Compaction (D7, out of this task's scope) | Possible (superseded facts) but mitigated by continuity/backend-truth rules | Governed by the same evidence rules as everything else |

**Concrete collision scenario, worked through code (matches the task's own
example):**

```
latest user: "no quiero el pack"
pendingCatalogAction (frozen, turn-entry): send_product_link [415]
RecentCatalogContext (frozen, turn-entry): 415 candidate
```

The **only** governing instruction is `PENDING_CATALOG_ACTION_RULE_LINES`
bullet 5 ([`buildAgentStepPromptPackage.ts:343`](../../lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts)):
*"If the customer's message clearly changes topic or intent instead of
responding to the pending offer, answer the new message normally and omit
pendingCatalogAction from your respond step."* This is prose the model
must correctly classify "no quiero el pack" against -- there is no
structural fallback if it doesn't. And critically: **if the model instead
emitted `get_product_details({productId: "415"})` anyway** (misreading the
rejection as ambiguous), the runtime's own evidence gate would **not**
block it -- `processUseToolStep`'s `get_product_details` branch
(`:534-557`) authorizes any request matching a `candidateProducts` entry,
full stop; it has no concept of "the customer just declined this exact
candidate." The rejection is real to the prompt-reading model's judgment
only, never to the governance code.

---

## Deliverable 8 -- Harness gap map

| Area | Classification | Evidence | User-visible consequence | Architectural risk | Schema change needed? | Safe to change incrementally? |
|---|---|---|---|---|---|---|
| Durable session (claim-once, crash-recoverable turn ownership) | **ALIGNED** | `repository.ts` claim/complete/reclaim CAS mechanics | None negative | Low | No | N/A |
| Turn ownership (mutual exclusion per conversation) | **ALIGNED** | `claimPendingTurn`'s `NOT EXISTS` guard, `:137-151` | None negative | Low | No | N/A |
| Step lifecycle | **PARTIALLY_ALIGNED** | Step = 1 model call + <=1 tool call, matches shape; but finalization is a non-step bolt-on, and no distinct "budget exhausted" terminal exists | "Déjame buscar..." then terminate (Top Gap #1) | Medium | No | Yes -- see Deliverable 11 |
| Inbox/steering | **PARTIALLY_ALIGNED** | Live Turn Assimilation is a real, working, atomically-reconciled steering mechanism (`tryAssimilate`, `reconcileAssimilatedSiblings`) -- but it only handles *new content*, never *re-evaluating whether prior work is complete* | New messages are never lost/ignored (good); but steering never grows the budget to match (Top Gap #1/#4) | Medium | No | Yes |
| Step continuation | **MATERIAL_GAP** | No mechanism increases available steps/tools in response to demonstrated need mid-turn; budgets are static from turn start | Forced early termination on legitimate multi-hop needs | High (direct cause of "loop-prone" complaint) | No | Yes, if bounded by a progress guard (Deliverable 11, B2/B3) |
| Tool continuation | **MATERIAL_GAP** | Same root cause as step continuation, specifically for `maxToolExecutions=2` | Same as above | High | No | Yes |
| Natural stop | **MATERIAL_GAP** | `respond` is unconditionally terminal (Deliverable 5); no general work-owed check | Premature termination with unresolved observations | High | No | Yes (Deliverable 11, B1) |
| Turn-stopping checkpoint | **MATERIAL_GAP** | The only content-level checkpoint is `checkUnbackedCommercialMutationClaim`, one tool, regex-based | Same as above | High | No | Yes, generalize the existing pattern (B1) |
| Cognitive budgets | **MATERIAL_GAP** | Fixed counters (3/2) shared identically across read and mutation tools, not deadline/progress-driven | Root cause of Top Gap #1 | High | No | Yes (B2, B4) |
| Cancellation/deadline | **ALIGNED** | `abortSignal` threading + `deadline = Date.now() + timeoutMs`, checked at top of every loop iteration in both phases | None negative | Low | No | N/A |
| No-progress/runaway protection | **PARTIALLY_ALIGNED** | Exact-duplicate dedupe exists (`buildDedupeKey`/`executedCalls`, blocks byte-identical repeats for free) -- but no protection against *materially similar but not identical* repeated attempts, and live-assimilation `continue`s are entirely unbounded except by wall-clock deadline | Possible (untested) pathological loop under repeated near-duplicate steering | Medium | No | Yes (B3) |
| Tool execution classes | **MATERIAL_GAP** | `READ_TOOL` vs `COMMERCIAL_ACTION` classification exists and is correctly enforced for *authorization/idempotency* purposes, but **not** for budget allocation -- both draw from the identical `maxToolExecutions` pool | Direct cause of Top Gap #1 | High | Possibly (if budgets need independent config knobs; a code-only split is also viable) | Yes (B4) |
| Parallel read tools | **MATERIAL_GAP** (by omission, arguably **INTENTIONAL_DIVERGENCE** given R3's synchronous, single-connection-per-step Gateway calls) | `processUseToolStep` is called once per step, strictly sequential; no `Promise.all` fan-out anywhere in the gathering loop | Slower wall-clock use of a scarce tool budget (2 sequential HTTP round-trips instead of 1 parallel batch) | Medium | Possibly (multi-tool-per-step would change `AgentStepUseTool`'s shape) | Not incrementally -- this is the largest single-shape change on this list; defer past V1.8.2-B |
| Session/event derivation | **ALIGNED** | `deriveMessages()`-equivalent via `resolvePersistentSessionCognitionContext`/`persistentSessionHistoricalMessages`, D3-D7 already closed this per prior memory | None negative | Low | No | N/A |
| Pending obligations | **MATERIAL_GAP** | Deliverable 6's whole table -- fragmented, partially prompt-only, partially code-shadow, never unified | Top Gap #3 | Medium-High | No | Yes (B5) |
| Crash recovery | **ALIGNED** | `reclaimStaleProcessingTurn`, atomic `completeTurn`+`reconcileAssimilatedSiblings` in one transaction | None negative | Low | No | N/A |
| Terminal dispatch | **ALIGNED** | Ownership recheck + freshness recheck + dedupe, all in the same transaction as the durable write | None negative | Low | No | N/A |

---

## Deliverable 9 -- Compensating-structure analysis

**Would `pendingCatalogAction` still be necessary if one turn could
naturally perform 5-10+ steps before returning control?**
**Partially, but its role would shrink.** Today it exists to bridge
*across* turns (the offer is made in turn N, resolved in turn N+1) because
each turn is a tiny, isolated cognitive burst. If turns could run longer
*within* the same customer exchange, a "customer says X, gets offered a
link, immediately confirms" pattern could resolve inside ONE turn via live
assimilation instead of needing the pendingCatalogAction round-trip at
all. But `pendingCatalogAction` would remain necessary for the genuine
cross-turn case (customer reads the offer, thinks about it, replies
minutes/hours later, which live assimilation cannot help with -- that is a
new settlement, not steering within an in-flight one). **Verdict: shrinks
in importance, does not disappear.**

**`recentCatalogContext`:** Same shape of answer. It exists partly to
compensate for a turn that can't re-derive "what we were just discussing"
from a longer in-context transcript within its own bounded budget. With
`persistentSessionHistoricalMessages` already providing cross-turn
transcript continuity (V1.8-D5+), and a longer per-turn budget reducing
how often a *new* turn has to re-establish context from a cold, tiny
window, its load-bearing necessity would likely shrink -- but it would
still serve its stated purpose (fast identity resolution for "the second
one" without a full transcript re-read) even in a longer-turn world.
**Verdict: still useful, not purely compensating.**

**Finalization repair behavior (`formatRepairAttempt`,
`FINALIZATION_MAX_ATTEMPTS`):** **Not** a compensating structure for a
short loop -- this is orthogonal, a format-correctness safety net that
would be needed regardless of turn length (a longer-running turn can still
produce a malformed JSON response on its Nth call). **Verdict: keep
unconditionally.**

**Cross-turn continuation hints in general (the pendingCatalogAction
event-log lookback mechanism, `loadPendingCatalogAction`'s "most recent
event row" query):** This specific *retrieval* mechanism (keyed only by
`conversationId`, not by a specific turn/settlement id) would become more
fragile, not less, if turns got longer and could themselves span multiple
live-assimilated customer messages -- "the most recent
`agent_tool_loop_completed` event" already assumes a tight 1:1 mapping
between "customer sends something" and "one completed AI turn," which live
assimilation has already started to blur (one turn's `agent_tool_loop_completed`
event can now represent several customer messages' worth of content).
**Verdict: this lookback mechanism should be re-examined during Deliverable
11's B5 (context authority cleanup), independent of turn length.**

No structure examined here should be deleted outright; each has a real,
narrower-than-assumed justification once the assumption "the loop is
short" is set aside.

---

## Deliverable 10 -- Target turn semantics contract (proposed, for V1.8.2-B)

CURRENT CODE and PROPOSED TARGET are kept explicit below; nothing here
changes production behavior in this task.

- **Turn** (unchanged from CURRENT CODE): the unit of durable processing
  responsibility created by one claimed `crm_inbound_turn_settlements` row.
  No schema change.
- **Step** (unchanged from CURRENT CODE): one model request plus the <=1
  tool call resolved from it. Parallel tool calls per step are explicitly
  OUT of this contract (Deliverable 8's own `INTENTIONAL_DIVERGENCE` /
  defer note).
- **Natural stop** (PROPOSED TARGET, new): the model emits `respond` or
  `handoff` **and** the turn-stopping checkpoint (below) accepts it as
  representing no further owed work -- not merely the model emitting the
  step.
- **Work owed** (PROPOSED TARGET, new, deliberately bounded and NOT a
  hardcoded workflow): true whenever, at the moment a `respond`/`handoff`
  candidate is evaluated, (a) live assimilation just folded in new content
  this exact evaluation (already exists, generalized), OR (b) this exact
  candidate's own text is caught by a *generalized* version of today's
  `checkUnbackedCommercialMutationClaim` -- i.e. the response claims
  something no observation this turn backs, for ANY capability, not just
  `select_products`. Deliberately does **not** attempt semantic "does this
  reply fully answer the question" judgment -- that would require exactly
  the kind of hardcoded product-search strategy the brief forbids.
- **Quiescence** (PROPOSED TARGET, new): work owed is false, no live
  steering is pending, and no terminal policy (budget/deadline/progress
  guard) forces continuation for an unrelated reason.
- **Terminal checkpoint** (PROPOSED TARGET, generalizes existing Boundary
  1): the single gate every `respond`/`handoff` candidate passes through
  before acceptance, checking staleness (existing) AND work-owed (new).
  Bounded: it can force **at most one** additional step before accepting
  termination regardless of outcome, to guarantee it can never itself
  become an unbounded loop.
- **Cancellation** (unchanged): `abortSignal`, already correct.
- **Deadline** (unchanged mechanism, PROPOSED TARGET role change):
  currently a backstop; proposed to become the *primary* governor of step
  count, with `maxDecisions`/`maxToolExecutions` demoted to a
  runaway-protection ceiling (see B2).
- **Progress** (PROPOSED TARGET, new): a step either executes a tool with
  a dedupe key not already seen this turn (existing `buildDedupeKey`/
  `executedCalls` primitive, reused not reinvented), OR folds in new
  live-assimilated content, OR terminates.
- **No-progress** (PROPOSED TARGET, new): N consecutive steps producing
  none of the above -- forces a stop regardless of remaining budget.
- **Mutation boundary** (unchanged from CURRENT CODE): the existing
  `READ_TOOL`/`COMMERCIAL_ACTION` classification
  (`agent-capability-exposure/types.ts`) remains the authority; it becomes
  the fork point for independent budget pools (B4), not a new concept.

Explicitly **not** introduced, per the brief's own constraint, and
verified against everything read in this audit: no `conversationStage`,
`currentIntent`, or `nextStep` field anywhere in the proposed contract; no
hardcoded commercial workflow (the work-owed check stays a generalization
of an existing evidence-backing pattern, never a state machine); no
deterministic product-search strategy (search/recommend tool selection
stays entirely model-driven, unchanged); no persisted reasoning (the
work-owed check operates on structural evidence -- `steps`, dedupe keys --
never on retained chain-of-thought).

---

## Deliverable 11 -- Minimal change plan (not implemented)

**B1 -- Turn-stopping checkpoint.**
Files: `runAgentToolLoop.ts` (`respondedResult`/`handoffResult` closures,
`:842-928`), new module alongside `commercialMutationClaims.ts`
generalizing its pattern to every `COMMERCIAL_ACTION` capability (not just
`select_products`). Schema: none. Backward compat: additive -- absent flag
means byte-identical behavior (same discipline every prior R3 task in this
file already uses). Feature flag: new, e.g.
`BRAIN_R3_TURN_STOPPING_CHECKPOINT_ENABLED`. Rollback: flag off. Tests:
Deliverable 12 items 1, 5, 6.

**B2 -- Deadline-primary budget policy.**
Files: `runAgentToolLoop.ts` (`while` conditions at `:956`, budget
constants), `sales-agent-configuration/defaults.ts` (documents the
semantic shift from "the real budget" to "runaway ceiling"). Schema: none.
Backward compat: raising the numeric ceilings is safe by construction
(strictly permissive); must ship *after* B3 (progress guard), never before
-- an unguarded larger ceiling reintroduces runaway risk. Feature flag:
reuse the loop configuration's existing DB-published values (already a
knob); no new flag needed, but a new *default* value requires an explicit
admin/deploy decision, not silently changed. Rollback: republish the old
configuration values. Tests: Deliverable 12 items 1, 2, 9, 10.

**B3 -- Progress guard.**
Files: `runAgentToolLoop.ts` (extend `executedCalls`/`buildDedupeKey`
usage into a consecutive-no-progress counter). Schema: none (purely
in-memory, per-turn). Backward compat: additive, only fires past a
threshold that never triggers under today's 3/2 ceiling (the ceiling
itself already bounds this case). Feature flag: none needed if scoped
strictly to guard the *widened* budget from B2; ship together with B2.
Rollback: revert alongside B2. Tests: Deliverable 12 item 3, 4, 9.

**B4 -- Read-vs-mutation tool policy.**
Files: `runAgentToolLoop.ts` (`processUseToolStep`'s budget-consumption
branch, `:1070`), `agent-capability-exposure/types.ts` (already has the
classification, reused not redefined), `sales-agent-configuration/types.ts`
+ `defaults.ts` (new, optional, independently-configurable read-tool
budget). Schema: none (config-only). Backward compat: a caller that never
sets the new read-tool budget falls back to the existing shared pool,
byte-identical. Feature flag:
`BRAIN_R3_INDEPENDENT_READ_TOOL_BUDGET_ENABLED` or a config-presence
check. Rollback: flag off / omit config. Tests: Deliverable 12 items 2, 10.

**B5 -- Context authority cleanup.**
Files: `runAgentToolLoop.ts` (thread `activeRecommendationPendingAction`,
not just `input.pendingCatalogAction`, into `buildAgentStepPromptPackage`
calls), `buildAgentStepPromptPackage.ts` (accept the live variable),
`agent-loop/pendingCatalogAction.ts` (add an explicit
"customer declined candidate X" evidence-gate check, generalizing
`matchesPendingCatalogActionCandidate` to also consult a rejection
signal). Schema: none. Backward compat: when no rejection signal is
present, identical to today. Feature flag:
`BRAIN_R3_LIVE_PENDING_CATALOG_ACTION_ENABLED`. Rollback: flag off.
Tests: Deliverable 12 item 11.

Recommended sequencing: **B1 -> (B2+B3 together) -> B4 -> B5**, each
independently flagged and independently revertible, matching this
codebase's own established discipline (every V1.8.x task in this file was
shipped this way).

---

## Deliverable 12 -- Test plan (design only, not implemented)

1. *>3 reasoning steps can complete successfully*: extend
   `tests/agent-loop/runAgentToolLoop.test.ts` with a fake provider script
   that requires 5 sequential `use_tool`+respond decisions under a raised
   `maxDecisions`; assert `terminalReason:"responded"` and that
   `steps.length` exceeds today's ceiling.
2. *>2 read-only tool calls can complete successfully*: same file, a
   3-hop `search_products -> get_product_details -> recommend_catalog_products`
   fake-provider script under B4's independent read-tool budget; assert no
   forced finalization before the 3rd call.
3. *Repeated identical no-progress tool call is detected*: fake provider
   emits the same `use_tool` (identical dedupe key) 3 times in a row past
   B3's threshold; assert the loop force-terminates (new terminal reason
   or `handoff`) rather than looping to the deadline.
4. *Materially different recovery attempt is allowed*: fake provider
   retries `search_products` with a genuinely different query after a
   `no_match`-shaped empty result; assert the progress guard does NOT
   block it (distinguishes from test 3).
5. *`respond` can be rejected by terminal checkpoint when work remains*:
   fake provider emits `respond` whose text claims a `create_quote`
   completion with no backing observation this turn; assert B1's
   generalized checkpoint forces one more step instead of terminating
   immediately (extends `tests/commercial/dispatchSalesAgentTerminalOutcome.test.ts`-adjacent
   coverage, or a new `turnStoppingCheckpoint.test.ts`).
6. *Genuine completed work terminates immediately*: same shape as test 5
   but the claim IS backed by a completed observation this turn; assert
   zero extra step, byte-identical latency to today's behavior --
   regression guard against over-triggering B1.
7. *Steering during step N causes re-derivation without duplicated side
   effect*: extend `tests/agent-loop/runAgentToolLoopLiveAssimilation.test.ts`
   with a scenario where assimilation fires between two `COMMERCIAL_ACTION`
   tool calls; assert the first tool's effect is not re-executed and
   `executedCalls` dedupe still holds across the assimilation boundary.
8. *Mutation remains exactly-once*: existing coverage
   (`tests/commercial/createQuoteCapability.test.ts`,
   `capabilityGatewayHardening.test.ts`) extended to run under B2's raised
   budget + B3's progress guard simultaneously -- assert idempotency keys
   still dedupe correctly when a turn now runs materially longer.
9. *Deadline terminates runaway loop safely*: `runAgentToolLoop.test.ts`,
   a pathological fake provider that never converges under B2's raised
   ceiling; assert `terminalReason:"timeout"` still fires within
   `timeoutMs`, never an unbounded hang.
10. *Current 3-step happy paths remain compatible*: run the FULL existing
    `tests/agent-loop/*.test.ts` + `tests/commercial/*.test.ts` suite with
    every new flag OFF; assert zero behavior change (this is the
    byte-identical-when-disabled contract every flag above commits to).
11. *`pendingCatalogAction` cannot override incompatible latest user
    instruction*: new test in `tests/agent-loop/pendingCatalogAction.test.ts`
    reproducing the exact Deliverable 7 collision ("no quiero el pack"
    against an open `send_product_link [415]` offer); assert B5's evidence
    gate refuses `get_product_details(415)` once a rejection signal is
    present, independent of the model's own prompt-reading correctness.
12. *Crash recovery still resumes responsibility, not cognition*: extend
    `tests/native/inboundTurnSettling.e2e.test.ts`'s existing crash-boundary
    coverage to run under the new budget/checkpoint machinery; assert a
    reclaimed stale-`PROCESSING` row starts a fresh cognitive run from
    durable truth (unchanged from today), never resumes an in-memory
    partial step sequence (confirms B1-B5 introduce no new in-memory state
    that crash recovery would need to reconstruct).

---

## Non-goals confirmed respected

This audit changed no production code, no schema, no flag default. It did
not design V1.9 catalog search recovery, a semantic product ontology, a
voice tool, conversational style tightening, a no-greeting patch, an
outbox redesign, a new customer-state workflow, or a model upgrade -- all
explicitly out of scope per the task brief.

## Exit checklist

- Files changed: this document only
  (`docs/releases/SALES-AGENT-R3-V1.8.2-A-HARNESS-ALIGNED-TURN-SEMANTICS-CONTRACT-AUDIT.md`).
- Validated: no build/typecheck required (documental task per
  `AGENTS.md`/`CLAUDE.md`); every code claim above was verified by direct
  file read against `develop` HEAD `fa29b09`, not inferred from docs.
- Documental only -- zero functional changes.
- Risks/debt: `max_steps_exceeded` is confirmed dead code inside
  `runAgentToolLoop.ts` (declared in the terminal-reason enum, consumed by
  three downstream mapping tables, never constructed) -- worth a follow-up
  decision (remove the enum member, or make the loop actually construct
  it) independent of the V1.8.2-B implementation work this audit feeds.

# SALES-AGENT-R3-V1.8.2-B -- Open Turn Execution Core

Status: implemented and unit/integration-tested against a local, DB-free
harness; **not yet live-validated** against a real DeepSeek + WhatsApp
turn. Feature-flagged, default OFF
(`BRAIN_R3_OPEN_TURN_EXECUTION_ENABLED=false`), byte-identical to
pre-existing behavior when off. No schema migration. Source-of-truth audit
this task implements against:
[`SALES-AGENT-R3-V1.8.2-A-HARNESS-ALIGNED-TURN-SEMANTICS-CONTRACT-AUDIT.md`](./SALES-AGENT-R3-V1.8.2-A-HARNESS-ALIGNED-TURN-SEMANTICS-CONTRACT-AUDIT.md).
Updated by **V1.8.2-B1 (Evidence Fingerprint Hardening)** -- see Section
7a -- which closed a real weakness in the evidence fingerprint (same-
cardinality, different-entity result sets could collapse to the same
fingerprint); scoped entirely to `openTurnProgress.ts`, no other semantics
touched.

## Final verdict

**`R3_V1_8_2_B_OPEN_TURN_EXECUTION_IMPLEMENTED_NOT_LIVE_VALIDATED`**

All 17 required deterministic tests pass (scripted-provider, local HTTP
mock Catalog Service, zero real LLM/WhatsApp calls), plus 9 new direct
unit tests for the hardened evidence fingerprint (Section 7a). No real
DeepSeek + WhatsApp turn has been run under this flag yet -- see "Live
validation status" below for exactly what remains and why.

---

## 1. CURRENT architecture (before this task, still the flag-OFF path)

```
customer input -> claimed crm_inbound_turn_settlements row (one durable
  processing responsibility)
  -> runAgentToolLoop()
       Phase 1 (gathering): while (decisionIndex < maxDecisions=3 &&
         toolExecutionCount < maxToolExecutions=2) { ... }
         -> respond/handoff: UNCONDITIONALLY terminal the instant it validates
         -> budget exhausted: silently falls through to Phase 2 (no distinct
            terminal reason - "max_steps_exceeded" is declared but never
            constructed)
       Phase 2 (finalization): tools NEVER offered, up to 2 format-repair
         attempts, respond/handoff still unconditionally terminal
  -> governed terminal dispatch -> brain_message_outbox
```

Bounded mini-loop, forced response. This is the architecture the audit
(Deliverable 3/5/8) found MATERIALLY DIVERGENT from Harness-style
turn/step/quiescence semantics, and it is UNCHANGED when the new flag is
off -- every code path this task added is additive and gated.

## 2. NEW architecture (flag ON)

```
customer input -> claimed crm_inbound_turn_settlements row (UNCHANGED)
  -> runAgentToolLoop()
       Phase 1 (gathering): while (
             not cancelled (AbortSignal) &&
             not emergency-ceiling exceeded (24 accepted steps / 20 tool
               executions - catastrophic guard, never the normal budget) &&
             not deadline exceeded (UNCHANGED wall-clock timeoutMs, now the
               PRIMARY governor)
           ) { ... }
         -> respond/handoff: a PROPOSED natural stop, evaluated by the
            terminal checkpoint (turnStoppingCheckpoint.ts) before acceptance
            -> accept_stop: terminal, exactly as before
            -> continue: discarded like a stale candidate, loop re-enters for
               a fresh decision (bounded by the no-progress guard below)
         -> a tool executing consumes NEITHER decisionIndex/toolExecutionCount
            as the primary governor any more (both still tracked, for legacy
            observability/dispatch compatibility) - progress tracking
            (openTurnProgress.ts) is what actually governs continuation
       Phase 2 (finalization): reached ONLY via genuine format-repair
         exhaustion in gathering (never via budget exhaustion any more -
         Section 9's own requirement falls out of the gathering condition
         change with zero extra code) - same checkpoint/progress governance
         applied to its own respond/handoff acceptance, same emergency/
         cancellation guards (it can no longer be an unbounded checkpoint-
         continue loop)
  -> governed terminal dispatch -> brain_message_outbox (UNCHANGED)
```

Open logical turn, `model -> tool -> model -> tool...` for as long as the
turn is making real progress, a natural-stop proposal that is itself
governed, and a small set of catastrophic backstops (never the everyday
ceiling) closing the loop.

---

## 3. Feature flag

`BRAIN_R3_OPEN_TURN_EXECUTION_ENABLED` (default `false`), resolved by
`shouldEnableOpenTurnExecution()` in
[`config/commercialCycleConfig.ts`](../../lib/brain/commercial/config/commercialCycleConfig.ts),
threaded exactly like `shouldEnableLiveTurnAssimilation()` (same
`runNativeAutonomousCycle.ts` call site, same `openTurnExecutionEnabled`
field name end-to-end through `runSalesAgentRuntimeCycle.ts` ->
`salesAgentRuntime.ts` -> `runAgentToolLoop.ts`). No separate allowlist:
pilot scope is whatever already gates `SalesAgentRuntime`
(`shouldRouteToSalesAgentRuntime`'s `BRAIN_SALES_AGENT_RUNTIME_WA_IDS`).

Flag OFF is verified byte-identical by construction (every new code path
in `runAgentToolLoop.ts` is `if (openTurnExecutionEnabled) { ... }`, never
an unconditional rewrite of the existing gathering/finalization bodies) and
by test (#14/#17 below), and by a stash-diff regression run (Section 8).

---

## 4. Turn/Step contract, as implemented

- **Turn** (unchanged): one claimed `crm_inbound_turn_settlements` row's
  durable processing responsibility. May now contain many cognitive steps
  and many tool executions, never just 3/2.
- **Step**: one accepted provider inference and its optional single tool
  execution. Format-repair retries are **not** steps (unchanged, existing
  `gatheringRetryUsed`/`gatheringStructuredRecoveryUsed`/`formatRepairAttempt`
  mechanics untouched). A stale candidate discarded by Live Turn
  Assimilation is **not** an accepted step (unchanged Boundary 1/2
  mechanics, now additionally reset the no-progress streak, since new
  durable input IS progress). A respond/handoff candidate the terminal
  checkpoint declines **is** counted as an accepted step (it was a real,
  accepted provider inference; the TURN continues, the step itself is real)
  -- tracked as `acceptedStepCount`, contributing toward the emergency
  ceiling and the no-progress streak.
- Not introduced, verified against the whole diff: `conversationStage`,
  `currentIntent`, `nextStep`, `workflowState`, persisted reasoning.

---

## 5. Terminal checkpoint semantics

New module:
[`agent-loop/turnStoppingCheckpoint.ts`](../../lib/brain/commercial/agent-loop/turnStoppingCheckpoint.ts).
Pure function `evaluateTurnStoppingCheckpoint(input) -> {decision:
"accept_stop"|"continue", reason}`. Inputs are structural execution facts
only (candidate step type, an evidence-backing boolean, an
unreasoned-observation boolean, cancelled, deadlineExceeded) -- it never
sees message text, never a tool argument, never decides search strategy,
product family, or "ask for budget." Decision table:

| cancelled | deadlineExceeded | hasUnreasonedToolObservation | unbackedExecutionClaim | decision |
|---|---|---|---|---|
| true | - | - | - | accept_stop (`cancelled_overrides_checkpoint`) |
| false | true | - | - | accept_stop (`deadline_overrides_checkpoint`) |
| false | false | true | - | continue (`unreasoned_tool_observation`) |
| false | false | false | true | continue (`unbacked_execution_claim`) |
| false | false | false | false | accept_stop (`quiescent`) |

**Unbacked execution claim** reuses the EXISTING, unchanged
`checkUnbackedCommercialMutationClaim` (`commercialMutationClaims.ts`) --
no new regex was written. Under the flag, instead of silently swapping the
message for `MUTATION_CLAIM_GUARD_FALLBACK_MESSAGE` and terminating (the
flag-off behavior, still exactly what happens when the flag is off -- test
#17), the turn gets one more cognitive cycle to either genuinely complete
the mutation or honestly explain it can't.

**Unreasoned tool observation** is computed for real (never hardcoded)
but is provably always `false` today: this loop's step model is strictly
sequential (at most one tool call per step), and every candidate
respond/handoff is itself produced by a provider call whose own prompt
already included every prior step/observation
(`buildAgentStepPromptPackage`'s `priorSteps`). Test #4 verifies this
invariant directly (the request that produced a respond candidate already
carried the preceding tool's observation in `priorStepsThisTurn`). Kept as
a real, wired input -- not deleted -- so it becomes meaningful the day a
step is ever allowed more than one tool call (explicitly out of this
task's scope, see audit Deliverable 8's "parallel read tools" gap).

---

## 6. Progress semantics

New module:
[`agent-loop/openTurnProgress.ts`](../../lib/brain/commercial/agent-loop/openTurnProgress.ts).
Deterministic, in-memory, turn-scoped -- no schema, no LLM-judged
equivalence.

Tracked: `acceptedStepCount`, `providerCallCount`, `readToolExecutionCount`,
`mutationToolExecutionCount`, `assimilationCycleCount`,
`consecutiveNoProgressSteps` (the live streak the guard compares),
`noProgressCycleCount` (cumulative, observability only),
`terminalCheckpointContinueCount`, `emergencyCeilingReached`.

**Evidence fingerprint** (`buildEvidenceFingerprint`, hardened by
V1.8.2-B1 -- see Section 7a below): a deterministic JSON serialization of
`{tool, status, resultClass, cardinality, relevantIds}`
(`buildEvidenceFingerprintPayload`, exported). For a non-completed
observation, `resultClass` is the block/failure reason (so a different
reason -- or a different tool -- never collides with a repeated one) and
`relevantIds` is always `[]`. For a completed observation, canonical
relevant entity ids are generically extracted (see Section 7a) and, when
present, both drive `cardinality` (the deduplicated id count) and are
listed verbatim in `relevantIds`; when no ids exist, this collapses to the
original `has_results|no_match` + shape-based cardinality behavior. Read
generically from `data.items` / `data.products` / `data.recommendations` /
`data.results` / `data.options` / `data.candidates` (the real field names
this exact tool pool already uses) -- never a tool-name -> field-name
table, never per-tool business logic.

**Progress vs. no-progress**, exactly per the audit's target contract:

| Event | Effect |
|---|---|
| Live Turn Assimilation folds in new input (Boundary 1 or 2) | streak resets to 0 |
| A tool executes with a fingerprint not seen yet this turn | streak resets to 0 |
| A `COMMERCIAL_ACTION` tool actually executes (`executed:true`) | streak resets to 0, unconditionally -- idempotency/evidence gates already prevent a genuine duplicate mutation, this function never second-guesses that |
| A tool executes with an already-seen fingerprint this turn | streak +=1, cumulative +=1 |
| The terminal checkpoint declines a candidate (`continue`) | streak +=1, cumulative +=1 |

A committed mutation, or a genuinely new tool result, always resets the
streak -- test #8 proves a materially different recovery attempt right
after a dead end is never blocked.

---

## 7. Progress guard

`OPEN_TURN_NO_PROGRESS_THRESHOLD = 4` consecutive no-progress cycles ->
new terminal reason `no_progress`. Chosen conservatively per the task's
own "not 1 or 2, around 3-4" guidance: one dead end is always allowed, and
one materially different recovery attempt is always allowed (test #8);
only a genuine, repeated, evidence-free loop trips it (tests #7/#9).
Checked reactively right after every tool execution and every
checkpoint-continue, in both phases (sharing one `progress` object across
gathering and finalization, closing the exact "finalization becomes an
unbounded checkpoint-continue loop" risk this task called out).

---

## 7a. Evidence Fingerprint Hardening (V1.8.2-B1)

**Problem closed**: the original fingerprint (`tool:completed:has_results:cardinality`)
classified purely by cardinality, so two materially different result sets
of the same size collapsed to the same fingerprint -- `search A ->
[31,415,983]` and `search B -> [603,604,605]` both fingerprinted as
`search_products:completed:has_results:3`, meaning a genuinely new,
different-entity recovery attempt could be misclassified as "no progress"
purely because it happened to return the same number of results as the
prior dead end.

**Fix, scoped to `openTurnProgress.ts` only** -- nothing else in this
task's diff touches turn stopping, the deadline, the emergency ceilings,
`pendingCatalogAction`, tool recovery, prompts, or schema:

- New `extractRelevantIds(data)`: generic, per-tool-agnostic extraction
  from the same already-established structural field names
  (`KNOWN_LIST_FIELDS`) plus two id-bearing field names
  (`KNOWN_ID_FIELDS = ["id", "productId"]`) and one flat id-list field
  (`KNOWN_FLAT_ID_LIST_FIELDS = ["candidateProductIds"]`) -- never a
  tool-name -> field-name table, never a per-tool business-logic branch.
  Reads only these fields; price, stock, name, description, and
  timestamp fields are never consulted, by construction (test #6).
- Ids are normalized to trimmed strings (`normalizeId`), deduplicated via
  `Set`, and sorted before ever reaching the fingerprint
  (`dedupeSortIds`) -- order of discovery and incidental duplication in
  the upstream response can never change the result (tests #1/#2).
- `cardinality` is now the deduplicated id count when any ids were found,
  falling back to the original shape-based count (`computeCardinalityFromShape`,
  the unmodified pre-hardening logic) only when none exist -- requirement
  7's fallback, satisfied structurally rather than as a branch (tests #4/#8
  in the new unit file).
- The fingerprint itself changed representation from a hand-built
  colon-joined string to `JSON.stringify(buildEvidenceFingerprintPayload(...))`
  -- deterministic because the payload's key order is fixed by the object
  literal and `relevantIds` is already sorted before serialization. This is
  purely an internal representation change: fingerprints are only ever
  compared to each other within one turn's `Set<string>`, never persisted,
  never compared across turns, so no compatibility concern exists.
- `buildEvidenceFingerprintPayload` is newly exported so tests (and any
  future observability need) can assert on the canonical payload directly
  instead of parsing a string.

**Test evidence**: new file
[`tests/agent-loop/openTurnProgress.test.ts`](../../tests/agent-loop/openTurnProgress.test.ts),
9 direct unit tests against the pure functions (no HTTP, no DB, no
scripted provider -- the first direct unit coverage this module has had;
prior coverage was entirely indirect via the full-loop integration
tests). All 9 pass:

| # | Test | Requirement proven |
|---|---|---|
| 1 | same ids, different order -> same fingerprint | #2 (sorted) |
| 2 | a duplicated id within one response canonicalizes to the deduplicated fingerprint | #2 (deduplicated), including cardinality |
| 3 | same cardinality, different ids -> different fingerprint (the exact search A/B motivating case) | #1/#3 (the bug this task fixes) |
| 4 | repeated zero-result searches still fingerprint identically | #7 (fallback when no ids exist) |
| 5 | a materially different recovery result (different ids, same cardinality) resets the no-progress streak | #8 (integration with the progress guard) |
| 6 | volatile price/stock/name/timestamp changes never affect the fingerprint | #4 (exclusions) |
| 7 | ids are recognized generically across every known list-shaped field name (`products`, `recommendations`, ...) | #6 (generic extraction, no per-tool table) |
| 8 | a payload shape with no recognizable id fields falls back to shape-based cardinality | #7 (fallback) |
| 9 | a non-completed (`blocked`) observation's fingerprint is unaffected by hardening | Scope: ids are never extracted outside `status:"completed"` |

The full `tests/agent-loop/openTurnExecution.test.ts` suite (17 tests,
including #7/#8/#9 which exercise the progress guard end-to-end through
the real loop) was re-run after this change: **17/17 still pass,
unchanged** -- the fixed `productId` values every mock in that file
already used mean the hardened, id-aware fingerprint produces the exact
same equality/inequality decisions those tests were already asserting.

---

## 8. Deadline and cancellation

Wall-clock deadline (`timeoutMs`, unchanged mechanism) is checked
unconditionally at the top of every loop iteration in both modes -- never
removed, and under open-turn mode it is the PRIMARY governor of an
otherwise-productive turn (test #10 proves a never-converging-but-always-
making-fresh-tool-calls turn still terminates safely on deadline, not on
the emergency ceiling). `AbortSignal` cancellation is checked explicitly
under the flag (`terminalReason: "cancelled"`, distinct from `"timeout"`)
at the top of every iteration; flag-off cancellation behavior is
unchanged (still surfaces as `"timeout"` via `invokeProviderWithDeadline`'s
existing abort handling -- deliberately not touched, to keep that shared,
exported function's contract stable for its other caller,
`runCommercialMultiIntentLoop.ts`).

No partial cognition is ever persisted for resume -- open-turn mode adds
zero new durable state. Crash recovery is unchanged: a reclaimed stale
`PROCESSING` settlement row always re-derives from durable truth and starts
a fresh `runAgentToolLoop` invocation, never resumes an in-memory step
sequence (verified by the existing, untouched
`tests/native/inboundTurnSettling.e2e.test.ts` crash-boundary suite --
see Section 11, item 18).

## 9. Emergency limits

`OPEN_TURN_EMERGENCY_MAX_ACCEPTED_STEPS = 24`,
`OPEN_TURN_EMERGENCY_MAX_TOOL_EXECUTIONS = 20` -- catastrophic guards only,
checked at the top of every iteration (both phases) alongside cancellation,
before the deadline check. Deliberately generous relative to the legacy
3/2 ceiling; never behaves like the old normal budget (the progress guard
and the deadline are expected to end a real conversation long before
either number is reached). Never read when the flag is off.

## 10. Tool policy for this task (scope-limited, per Section 10 of the brief)

Mutations remain governed exactly as before: same `COMMERCIAL_ACTION`
classification (`agent-capability-exposure/types.ts`, untouched), same
evidence gates, same idempotency, same authorization -- nothing in this
task weakened any of it (tests #12/#13). READ_TOOL calls are now allowed
past the legacy 2-call ceiling under open-turn/deadline/progress governance
(tests #2/#3/#15), still subject to the shared emergency tool-execution
ceiling. Independent READ vs. MUTATION budget pools are explicitly deferred
to V1.8.2-C, per the brief's own scope guard -- not implemented here.

## 11. Live Turn Assimilation -- preserved first-class

Both safe boundaries (`tryAssimilate()` pre-action and post-tool) are
completely unmodified in their staleness-detection/reconciliation logic.
Open-turn mode only ADDS progress bookkeeping on top of the exact same
calls (`recordAssimilationProgress`) -- it never changes when assimilation
fires, what it folds in, or how `crm_inbound_turn_settlements` sibling
reconciliation works. Test #11 proves assimilation still works correctly
many steps into an already-long turn; tests #12/#13 prove a stale mutation
candidate is still never executed, and a committed mutation followed by
steering stays exactly-once. New durable input never consumes emergency
budget on its own (it resets the no-progress streak instead of
incrementing any ceiling counter).

## 12. Observability

`AgentToolLoopCompletedRecordedPayload` (events/types.ts) gained an
optional `openTurnExecution` object (`acceptedStepCount`,
`providerCallCount`, `readToolExecutionCount`, `mutationToolExecutionCount`,
`noProgressCycleCount`, `terminalCheckpointContinueCount`,
`emergencyCeilingReached`), present only when open-turn mode actually ran
this turn -- same "present only when it actually applied" discipline
`liveTurnAssimilation` already established on the same payload, wired
through `normalizeAgentToolLoopCompletedCommercialEvent`
(events/normalize.ts). Pure JSON-payload additions, **no schema
migration**. Preserved unchanged: `decisionCount`, `toolExecutionCount`,
`assimilationCycleCount`, `invalidatedCandidateCount`,
`finalAssimilatedInboundMessageId`.

## 13. Terminal reasons

`AGENT_LOOP_TERMINAL_REASONS` (agentStepTypes.ts) gained `cancelled`,
`no_progress`, `emergency_limit_exceeded` -- only ever constructed under
the flag. `max_steps_exceeded` is retained (backward compatibility for
every downstream exhaustive mapping) and explicitly documented in code as
legacy/dead from `runAgentToolLoop.ts`'s own perspective, per the audit's
finding -- not restored to a real construction path; open-turn mode's
conceptual equivalent is `emergency_limit_exceeded`. Every exhaustive
mapping over the terminal-reason union was updated (TypeScript enforced
this at compile time for the `Record<AgentLoopTerminalReason, ...>` ones):
`salesAgentRuntime.ts#TERMINAL_REASON_TO_STATUS`,
`runSalesAgentRuntimeCycle.ts#FAILURE_REASON_TO_TERMINAL_REASON`,
`dispatchSalesAgentFallback.ts`/`dispatchAgentLoopResponse.ts`'s own
`mapTerminalReasonToFallbackClass` switches (new reasons map onto the
EXISTING `ContinuityFallbackClass` vocabulary -- `cancelled`/`no_progress`
-> `model_unavailable`/`invalid_model_result`, `emergency_limit_exceeded`
-> `max_steps_exceeded`'s existing customer copy -- no new fallback class
was created), and `events/types.ts#AgentToolLoopTerminalReason` (a
deliberate no-cross-module-import mirror of the same union).

---

## 14. Test evidence

New file:
[`tests/agent-loop/openTurnExecution.test.ts`](../../tests/agent-loop/openTurnExecution.test.ts),
17 deterministic, scripted-provider tests (local HTTP mock Catalog
Service, zero real LLM/DB dependency for 15 of them; #12/#13 use a
controllable `ensureOpportunity` stub instead of a real DB write, so they
stay fully deterministic without MariaDB). **17/17 pass.**

| # | Test | Proves |
|---|---|---|
| 1 | `>3 accepted cognitive steps complete in one turn` | Step ceiling lifted |
| 2 | `>2 READ tool executions complete in one turn` | Tool ceiling lifted for reads |
| 3 | `a 4-hop read-tool chain completes in one logical turn` | Multi-hop read workflows fit in one turn |
| 4 | `the respond candidate's own inference call already saw the preceding tool observation` | The "reasoned over" invariant, structurally |
| 5 | `a quiescent respond ... terminates immediately` | No spurious checkpoint continuation |
| 6 | `an unbacked mutation-completion claim is rejected by the checkpoint and the turn continues` | Checkpoint actually gates |
| 7 | `repeated checkpoint-declined unbacked claims eventually trigger no_progress` | Progress guard catches checkpoint-loop pathology |
| 8 | `a dead-end search followed by a materially different, productive search is never blocked` | No false-positive no-progress |
| 9 | `repeated equivalent (zero-result) tool evidence eventually triggers no_progress` | Progress guard catches tool-loop pathology |
| 10 | `deadline terminates an otherwise-productive, never-converging turn` | Deadline is the primary governor |
| 11 | `live assimilation fires correctly even many steps into an already-long turn` | LTA stays first-class under open-turn |
| 12 | `a mutation candidate invalidated by fresh inbound is never executed` | Stale mutation never reaches the Gateway |
| 13 | `a committed mutation stays exactly-once even when steering arrives right after it` | Exactly-once under steering |
| 14 | `flag off: legacy 3/2 ceiling is preserved byte-for-byte` | Backward compatibility |
| 15 | `a 3-tool-call script is never forced into finalization by the legacy 2-tool ceiling` | Finalization no longer a hidden ceiling |
| 16 | `schema-invalid AgentStep repair still recovers exactly as before` | Format-repair untouched |
| 17 | `flag off: the pre-existing regex-based mutation claim guard still swaps the message` | Legacy guard behavior untouched |

Item 18 of the brief's own list (crash recovery resumes responsibility,
never an in-memory partial loop) is covered by the existing,
**unmodified** `tests/native/inboundTurnSettling.e2e.test.ts` crash-
boundary suite -- open-turn mode introduces no new durable/resumable
state, so no new e2e coverage was needed there; this was a deliberate
scope decision, not an oversight, given that suite requires a live
MariaDB connection unavailable in this validation pass (Section 15).

---

## 15. Validation run

```
npm run typecheck   -> clean, zero errors
npm run lint        -> clean, zero errors (40 pre-existing warnings, none in touched/new files)
npm run build        -> succeeds
tests/agent-loop/openTurnExecution.test.ts (new)                    -> 17/17 pass
tests/agent-loop/runAgentToolLoop.test.ts +
  runAgentToolLoopLiveAssimilation.test.ts +
  buildAgentStepPromptPackage.test.ts + validateAgentStep.test.ts     -> 203 pass / 9 fail
tests/commercial/turnSettlementRepository.test.ts +
  capabilityGatewayHardening.test.ts +
  dispatchGovernedSalesAgentMessageLiveAssimilation.test.ts +
  dispatchSalesAgentTerminalOutcome.test.ts + salesAgentRuntime.test.ts +
  runSalesAgentRuntimeCycle.test.ts +
  salesAgentRuntimeR3NativeDispatchAuthority.test.ts +
  salesAgentR3RuntimeIsolationAuthority.test.ts                       -> 35 pass / 62 fail
```

**Every one of those failures is `ECONNREFUSED 127.0.0.1:3306`** (or a
downstream consequence of the same missing local MariaDB, e.g. an
opportunity-resolution assertion reading a silently-null result) -- this
sandbox has no running local database. **Confirmed pre-existing, not a
regression**, by two independent methods:

1. `git stash` of every file this task modified, re-running the exact same
   suites against unmodified `develop` HEAD (`fa29b09`) -- identical
   failure count (9 and 62 respectively) before restoring the stash.
2. A name-level diff of pass/fail status between the baseline and
   with-changes runs surfaced exactly **one** real difference: `"the
   result exposes only structured, bounded fields - no chain-of-thought"`
   (`tests/commercial/salesAgentRuntime.test.ts`) -- a hardcoded
   `Object.keys(result).sort()` contract test that legitimately needed
   updating for the 8 new `SalesAgentRuntimeResult` observability fields
   this task added (the exact same pattern this test was already updated
   for when Live Turn Assimilation's fields were added). Fixed; re-run
   confirmed exact parity with baseline (35 pass / 62 fail, identical
   failure set).

A spot-check of adjacent files not in the task's own required list
(`commercialMutationClaims.test.ts`, `pendingCatalogAction.test.ts`,
`conversationContinuity.test.ts`, `multi-intent/runCommercialMultiIntentLoop.test.ts`,
`agentToolLoopCompletedEventConfig.test.ts`, `commercial-events.test.ts`)
found zero new failures -- the only failures there are, again, DB round-trip
tests failing on the same missing MariaDB.

**Not run**: a full, unfiltered pass over the entire `tests/` tree (229
files across `commercial`/`agent-loop`/`native` alone). Attempted; abandoned
after ~10 minutes because DB-connection-retry backoff across ~150+
DB-dependent tests in this environment made it impractically slow, with no
additional signal expected beyond what the targeted + spot-check runs
above already established (every failure pattern seen was `ECONNREFUSED`
or a direct consequence of it). This is a validation-scope decision, not a
silently-skipped step -- recorded here as known debt for a future session
with real DB access to close out with one full run.

### 15a. V1.8.2-B1 (Evidence Fingerprint Hardening) validation run

```
npm run typecheck                                    -> clean, zero errors
npm run lint                                         -> clean, zero errors (same 40 pre-existing warnings, none in touched/new files)
npm run build                                        -> succeeds
tests/agent-loop/openTurnProgress.test.ts (new)       -> 9/9 pass
tests/agent-loop/openTurnExecution.test.ts (unchanged) -> 17/17 pass, no regression
```

No DB-dependent suite needed re-running for this change: the hardening is
entirely internal to `openTurnProgress.ts`'s own pure functions (no new
caller wiring, no new flag, no observability shape change), fully covered
by the new direct unit tests plus the existing full-loop integration
suite.

---

## 16. Known debt

- Full unfiltered `tests/` regression not run in this pass (Section 15) --
  do it once real local MariaDB is available.
- `max_steps_exceeded` remains a documented-dead legacy enum value; a
  follow-up decision (remove it, or find it a real construction path) is
  still open, unchanged from the audit's own finding.
- `pendingCatalogAction` authority cleanup (Top Gap #3 of the audit) is
  explicitly out of this task's scope, unresolved.
- Independent READ/MUTATION budget pools (V1.8.2-C) not implemented --
  today's shared emergency tool-execution ceiling is the only limit on
  READ tool volume under open-turn mode.
- No live DeepSeek + WhatsApp evidence yet (Section 17 below).
- ~~Evidence fingerprint collapses distinct same-cardinality result sets~~
  -- **closed by V1.8.2-B1** (Section 7a). Remaining, smaller debt from
  that hardening: id recognition is generic-structural (`id`/`productId`/
  `candidateProductIds` under the same known list-shaped fields), not a
  full per-capability schema audit -- a future tool whose entity identity
  lives under a differently-named field would silently fall back to
  shape-based cardinality (never wrong, just less discriminating) until
  that field name is added to `KNOWN_ID_FIELDS`/`KNOWN_FLAT_ID_LIST_FIELDS`.

## 17. Rollback

`BRAIN_R3_OPEN_TURN_EXECUTION_ENABLED=false` (the default) immediately
reverts every turn to the exact legacy bounded-loop behavior -- no schema
migration to reverse, no data written under the flag that the flag-off
path depends on. Independently revertible from `BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED`
and every other R3 flag (own kill switch, per Section 3).

## 18. Live validation status

**Not yet performed.** A controlled real DeepSeek + WhatsApp benchmark
requires an allowlisted test `wa_id` this session does not have live
access to send through. Prepared plan, ready to execute once that access
is available:

**Canonical scenario**: `"quiero mancuernas de caucho fijas de 10, 15 y 20
kilos por separado"` sent to an allowlisted `BRAIN_SALES_AGENT_RUNTIME_WA_IDS`
number with `BRAIN_R3_OPEN_TURN_EXECUTION_ENABLED=true` (and
`BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED=true`, already-validated,
untouched by this task) for that pilot number only.

**Watch for**: search -> inspect -> a genuine dead end (or ambiguity) ->
a materially different recovery attempt -> inspect -> compare -> one
coherent conclusion, without a forced intermediate response.

**Success criteria** (verbatim from the task brief):
- one logical turn (one settlement row, one `runAgentToolLoop` invocation)
- more than 2 read tools used when the conversation genuinely needs them
- more than 3 steps used when needed
- no repeated identical search loop (no-progress guard silent because
  genuine progress kept happening, or it fired correctly if the model
  truly got stuck)
- no duplicated mutation
- no premature "Déjame buscar..." terminal (a `respond` that promises
  further search work should either not happen, or be followed by the
  checkpoint reasonably identifying unresolved evidence -- note this is
  NOT text-matched, so this criterion is judged by reading the transcript,
  not asserted by the runtime)
- one coherent terminal response
- `terminalReason` in the persisted `agent_tool_loop_completed` event is
  explainable from the transcript
- the new `openTurnExecution` observability block reconstructs the full
  turn (`acceptedStepCount`, `providerCallCount`,
  `readToolExecutionCount`/`mutationToolExecutionCount`,
  `noProgressCycleCount`, `terminalCheckpointContinueCount`,
  `emergencyCeilingReached`)

**Re-run steering**: same scenario, but send a changed requirement
("mejor solo las de 10 y 15, olvida las de 20") after the typing indicator
appears and several steps have already happened server-side -- confirm the
open turn assimilates it (per Section 11) rather than answering the
original, now-superseded request.

Until this runs and the transcript/observability evidence is reviewed,
the verdict stays `R3_V1_8_2_B_OPEN_TURN_EXECUTION_IMPLEMENTED_NOT_LIVE_VALIDATED`.

## Exit checklist

- Files changed (V1.8.2-B): `lib/brain/commercial/agent-loop/runAgentToolLoop.ts`,
  `agentStepTypes.ts`, `dispatchAgentLoopResponse.ts` (new modules:
  `openTurnProgress.ts`, `turnStoppingCheckpoint.ts`);
  `lib/brain/commercial/config/commercialCycleConfig.ts`;
  `lib/brain/commercial/events/{types,normalize}.ts`;
  `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts`;
  `lib/brain/commercial/sales-agent-runtime/{dispatchSalesAgentFallback,runSalesAgentRuntimeCycle,salesAgentRuntime}.ts`;
  new test `tests/agent-loop/openTurnExecution.test.ts`; one existing test
  fixed (`tests/commercial/salesAgentRuntime.test.ts`); this document; plus
  the prerequisite audit document from the prior task.
- Files changed (V1.8.2-B1, Evidence Fingerprint Hardening, this update):
  `lib/brain/commercial/agent-loop/openTurnProgress.ts` only (fingerprint
  logic -- `extractRelevantIds`/`normalizeId`/`dedupeSortIds`/
  `buildEvidenceFingerprintPayload`, new exports); new test
  `tests/agent-loop/openTurnProgress.test.ts` (9 direct unit tests); this
  document (Section 7a, 15a, and this checklist).
- Validated: typecheck, lint, build all clean; new tests 17/17 (B) + 9/9
  (B1); targeted regression suites at confirmed exact parity with
  pre-change baseline (Section 15); B1 introduced zero regressions in the
  full open-turn execution suite (Section 15a).
- Functional, not documental -- real runtime behavior change, entirely
  behind a default-off flag (B1 changes internal fingerprint computation
  only, no new flag, no caller-facing contract change).
- Risks/debt: Section 16. Live WhatsApp+DeepSeek validation is the
  explicit gate before this can be called `VALIDATED` rather than
  `IMPLEMENTED_NOT_LIVE_VALIDATED`.

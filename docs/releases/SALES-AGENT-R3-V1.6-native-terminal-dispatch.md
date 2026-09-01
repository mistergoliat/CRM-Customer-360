# SALES-AGENT-R3-V1.6 -- Native Terminal Dispatch

Status: implemented and tested against real MariaDB (`main_management`).
Every `SalesAgentRuntime` terminal outcome - `responded`, `handoff`,
`timeout`, `provider_unavailable`, `invalid_output`, `max_steps_exceeded` -
now dispatches through a single R3-native terminal boundary. V1.5 left one
R1 dependency in place: every terminal reason other than `responded` still
called `dispatchAgentLoopResponse.ts` (the full R1 stack: action persistence
-> autonomy-sandbox -> execution-gate). `runSalesAgentRuntimeCycle.ts` no
longer imports or calls that function at all.

## Phase 0 -- Architecture decision

R1's `handoff` semantics were not ported blindly. Three concepts, one
invariant:

- **SELF_RECOVERY** - the agent may continue/retry/fallback on its own.
- **SUPERVISOR_CONSULT** - a future capability (human advises, agent keeps
  ownership) - explicitly out of scope, not implemented.
- **HARD_HANDOFF** - an actual, durable ownership transfer from AI to human.
  Reserved only for (1) an explicit customer request for a human/operator, or
  (2) a deterministic policy requirement mandating human intervention.

**Invariant enforced end-to-end: temporary agent incapacity does not imply
ownership transfer.** Timeout, provider failure, invalid model output, and
max-steps-exceeded are SELF_RECOVERY-shaped by construction - none of them
can transfer ownership, ever.

## Phase 1 -- New R3-native dispatch boundary

```
SalesAgentRuntime
  -> dispatchSalesAgentTerminalOutcome.ts   (the one call site, routes by loop.terminalReason)
       responded            -> dispatchSalesAgentResponse.ts        (V1.5, unchanged contract)
       handoff, eligible    -> dispatchSalesAgentHardHandoff.ts     (new)
       handoff, ambiguous   -> dispatchSalesAgentFallback.ts        (new)
       timeout/provider_unavailable/invalid_output/max_steps_exceeded
                            -> dispatchSalesAgentFallback.ts        (new)
  -> brain_message_outbox (canonical, unchanged table/worker)
```

New shared primitive, extracted from `dispatchSalesAgentResponse.ts`
(V1.5) with zero behavior change to that caller:

```
dispatchGovernedSalesAgentMessage.ts
  governance (killswitch/allowlist/waId/non-empty message)
  -> transactional ownership recheck (SELECT ... FOR UPDATE on conversation)
  -> dedupe (INSERT IGNORE on a stable key)
  -> canonical brain_message_outbox (writeCanonicalOutboxMessage)
```

`dispatchSalesAgentResponse.ts` and `dispatchSalesAgentFallback.ts` both call
this one primitive - never a second copy of the governance/recheck/outbox-
write chain. `dispatchSalesAgentHardHandoff.ts` deliberately does NOT reuse
it for its own acknowledgement (see Phase 4 - the ownership polarity is
inverted for that one message).

## Phase 2 -- `responded` (unchanged)

`dispatchSalesAgentResponse.ts` is now a thin wrapper around
`dispatchGovernedSalesAgentMessage.ts` - same public types
(`DispatchSalesAgentResponseInput`/`Result`/`Reason`), same dedupe key
(`sales-agent-r3:{conversationId}:{inboundMessageId}:responded`), same
`sales_agent_runtime_response_dispatched` event, same 12/12 tests
(`dispatchSalesAgentResponse.test.ts`) green with zero changes to that file.

## Phase 3 -- Technical-failure fallback (`dispatchSalesAgentFallback.ts`)

Maps each of the four genuine technical failures to the existing,
semantically neutral `buildContinuityFallbackMessage` vocabulary (a pure
renderer, reused verbatim - never `dispatchFallbackAction`/the action queue/
autonomy sandbox/execution gate/R1 lifecycle):

| terminalReason        | fallback class      |
|------------------------|----------------------|
| `timeout`              | `model_unavailable`  |
| `provider_unavailable` | `model_unavailable`  |
| `invalid_output`       | `invalid_model_result` |
| `max_steps_exceeded`   | `max_steps_exceeded` |
| `handoff` (ambiguous)  | `max_steps_exceeded` |

`handoff` (ambiguous/non-eligible) maps to the same "I need more time /
I'm keeping your context" vocabulary as `max_steps_exceeded` - deliberately
**not** `handoff_acknowledgement` ("voy a conectar tu conversacion con
alguien del equipo"), which would be a lie: ownership never transferred.

Dedupe key: `sales-agent-r3:{conversationId}:{inboundMessageId}:fallback:{terminalReason}`
(for the ambiguous-handoff case, `{terminalReason}` is literally `handoff`).
No ownership mutation anywhere in this file - none of its own logic even has
a path to `takeHumanControlForAiHandoff`.

## Phase 4 -- HARD_HANDOFF (`dispatchSalesAgentHardHandoff.ts`)

### Eligibility gate (the ambiguity the task called out)

`AgentStepHandoff.reason` (`agent-loop/agentStepTypes.ts`) is free text the
model writes itself - `validateAgentStep.ts` accepts any non-empty string,
and the shared prompt (`buildAgentStepPromptPackage.ts`, used by both ATL and
SalesAgentRuntime) only ever says *"hand off to a human if you genuinely
cannot proceed"* - exactly the SELF_RECOVERY-shaped language this task warned
against conflating with HARD_HANDOFF. **There is no structured signal today
distinguishing an explicit customer request for a human from ordinary model
uncertainty.**

Per the task's own instruction not to guess at that distinction from
natural-language free text, and to fail safe toward NON-HANDOFF for
ambiguous reasons, `classifyHardHandoffEligibility()` introduces a minimal
typed evidence contract instead of semantic inference:

```ts
HARD_HANDOFF_ELIGIBLE_REASON_CODES = ["customer_requested_human", "policy_requires_human"]
```

`handoffReason` is eligible only on an exact match (case-insensitive) or a
`"<code>: free text"` prefix against that fixed vocabulary. Every ordinary
sentence the model currently produces (e.g. `"needs_human_pricing_negotiation"`,
`"no puedo ayudar con esto ahora"`) is `ambiguous_handoff_reason` and routes
to `dispatchSalesAgentFallback.ts` instead - **fully backward compatible**:
nothing in ATL, `AgentStepHandoff`, `validateAgentStep.ts`, or the prompt
builder was touched. Closing this gap for real production traffic (having
the model emit a structured category, not just free text) requires extending
that shared contract - explicitly out of scope for V1.6 (Scope Guard: do not
modify ATL behavior).

### Critical ordering

```
1. classifyHardHandoffEligibility(handoffReason)      -- pure, no I/O
2. checkConversationTransferable (not_found/closed guard)
3. takeHumanControlForAiHandoff(...)                  -- COMMITS (own transaction, reused verbatim, unchanged)
4. writeHardHandoffAcknowledgement(...)                -- only after step 3 commits
```

Never the reverse. `takeHumanControlForAiHandoff` (`lib/domains/conversations/control.ts`)
is the same neutral, domain-level primitive an operator's manual "take"
action and R1's own handoff path already use - not rewritten, not
duplicated.

### The acknowledgement-after-transfer problem

Once ownership transfers, `conversation.human_owner_active = 1` and
`ai_enabled = 0`. The generic "human owner active blocks AI outbound" rule
(`dispatchGovernedSalesAgentMessage.ts`'s own recheck) would therefore always
block the acknowledgement, since it demands the opposite polarity. Handled
via the task's second preferred approach: a **narrowly scoped
acknowledgement writer** (`writeHardHandoffAcknowledgement`, private to this
file) that requires the conversation to be human-owned (verifying the
transfer this same call just committed is really visible) rather than
AI-owned, and is reachable only via this one dedupe key
(`sales-agent-r3:{conversationId}:{inboundMessageId}:handoff`). Global
ownership safety is never weakened generically - this exception is scoped to
exactly one message tied to exactly one already-committed handoff. Kill
switch, pilot allowlist, waId validity, non-empty message, `case_closed`
governance, and DB-backed dedupe are all still enforced for that message.

Ownership transfer itself is **unconditional** once eligible - never gated
behind the messaging kill switch or pilot allowlist (proven by `[HH4]`):
those govern whether the AI is allowed to autonomously *message* a customer,
not whether a legitimate ownership-safety transfer may occur. If the ack
gets skipped by messaging governance, `ownershipTransferred: true` still
stands as its own, separate signal.

## Phase 5 -- Handoff routing at the terminal boundary

`dispatchSalesAgentTerminalOutcome.ts` always calls
`dispatchSalesAgentHardHandoff` first for `terminalReason: "handoff"`
(defense in depth: the eligibility check also runs *inside* that dispatcher,
per the task's own "1. validate this is a legitimate hard handoff outcome").
If `eligible: false`, the router redirects to `dispatchSalesAgentFallback`
and surfaces the eligibility rejection reason (`hard_handoff_not_eligible` /
`ambiguous_handoff_reason`) as the terminal outcome's own `reason`, per the
task's explicit event contract - the fallback dispatch's own
dispatched/skip/duplicate outcome is preserved in `warnings` for full
traceability, never discarded.

## Phase 6 -- Governance retained (all terminal outcomes)

Every customer-facing message dispatched by any of the three sub-dispatchers
still enforces, before any DB write: the autonomous-response kill switch,
the WhatsApp pilot allowlist, `waId` validity, a non-empty message,
`humanOwnerActive`/`aiBlocked` (where applicable - inverted for the hard-
handoff acknowledgement, see Phase 4), a transactional ownership recheck
immediately before the outbox insert, `case_closed`/open-state validation,
and DB-backed dedupe (`INSERT IGNORE` on a unique key). Proven by test
`[T5]`: a human takeover committed to the DB after the turn-start snapshot
still blocks a fallback dispatch, exactly the same race guarantee V1.5
established for `responded`.

## Phase 7 -- Canonical outbox reuse

No second queue, no new table. All three sub-dispatchers write through the
same `writeCanonicalOutboxMessage` (`lib/brain/messaging/canonicalOutboxWriter.ts`)
every other R3/R1 writer already uses. Stable dedupe namespaces:

```
sales-agent-r3:{conversationId}:{inboundMessageId}:responded
sales-agent-r3:{conversationId}:{inboundMessageId}:fallback:{terminalReason}
sales-agent-r3:{conversationId}:{inboundMessageId}:handoff
```

Repeated processing is idempotent by construction: `INSERT IGNORE` for the
outbox row (`[F4]`/`[HH5]`), and an idempotent `UPDATE` for the ownership
mutation (`takeHumanControlTx` sets the same values again harmlessly on a
retry - `[HH5]` proves exactly one outbox row AND one stable ownership state
after processing the same eligible handoff twice).

## Phase 8 -- Observability

New `commercial_event` type `sales_agent_runtime_terminal_dispatched`
(`events/types.ts`/`dedupe.ts`/`normalize.ts`/`service.ts`), written for
every terminal outcome (responded/fallback/hard_handoff alike), non-blocking
(try/catch). Payload: `inboundMessageId`, `terminalReason`, `dispatchKind`
(`responded | fallback | hard_handoff`), `outboxWritten`, `outboxId`,
`duplicate`, `reason`, `dispatcherVersion`, `ownershipTransferred`. For an
ambiguous/rejected handoff: `terminalReason: "handoff"`,
`dispatchKind: "fallback"`, `ownershipTransferred: false`,
`reason: "hard_handoff_not_eligible" | "ambiguous_handoff_reason"` - exactly
the task's own spec. V1.5's `sales_agent_runtime_response_dispatched` event
is kept unchanged for `responded` (existing consumers untouched) - this new
event is additive, broader, and covers every terminal reason.

No chain-of-thought, no `reasoning_content`, no secrets in any payload.

## Phase 9 -- False dependency removal (proof)

After this task, a normal R3 turn of ANY terminal reason succeeds with:

```
BRAIN_AGENT_ACTION_QUEUE_ENABLED=false
BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED=false
BRAIN_EXECUTION_GATE_ENABLED=false
BRAIN_OUTBOX_BRIDGE_ENABLED=false
BRAIN_AUTONOMOUS_SANDBOX_ENABLED=false
BRAIN_AUTONOMOUS_REPLY_ENABLED=false
BRAIN_AUTONOMOUS_RESPONSES_ENABLED=true   # unchanged: the one real R3 gate
```

Proven by test: `[F3]`/`[HH6]` (unit-level, all six flags explicitly
`false`) and `[RC9]` (full-cycle level: a technical-failure turn AND an
eligible-handoff turn both dispatch/transfer ownership with all six flags
false).

## Phase 10 -- Static dependency proof

`runSalesAgentRuntimeCycle.ts` no longer imports `dispatchAgentLoopResponse`
- verified by:

1. Grep-confirmed by hand during this task (`dispatchAgentLoopResponse`,
   `DispatchAgentLoopResponseResult` do not appear anywhere in the file).
2. A new static authority test,
   `tests/commercial/salesAgentRuntimeR3NativeDispatchAuthority.test.ts`,
   same shape as `legacySalesConsultativeRuntimeAuthority.test.ts` /
   `followUpRuntimeAuthority.test.ts`: scans the file's own source text for
   `dispatchAgentLoopResponse`/`persistAgentAction`/
   `evaluateAgentActionForSandbox`/`executeActionThroughGate` and fails if
   any appears - both in `runSalesAgentRuntimeCycle.ts` itself and across
   the five new/modified R3 dispatch files.

`SalesAgentRuntimeCycleResult.dispatch` is no longer typed as
`DispatchAgentLoopResponseResult` (an R1 type) - it is now
`SalesAgentRuntimeDispatchResult`, defined locally in
`runSalesAgentRuntimeCycle.ts`, structurally compatible (never imported from
the R1 module) so `ensureAutonomousSalesTurnContinuity.ts`'s existing
`dispatch.action?.opportunityId`/`dispatch.executionGate?.status` reads need
zero changes.

## Phase 11 -- Scope guard (unchanged, per the task's own list)

Not modified: ATL (`runAgentToolLoop.ts`, `agentStepTypes.ts`,
`validateAgentStep.ts`, `buildAgentStepPromptPackage.ts`,
`runNativeAgentToolLoopCycle.ts`), `dispatchAgentLoopResponse.ts` itself,
`action-queue/**`, `autonomy-sandbox/**`, `execution-gate/**`,
`continuity/dispatchFallbackAction.ts`, follow-up, multimodal, Supervisor
Consult, capability contracts, commercial action execution
(`CommercialActionRequest -> Capability Gateway -> domain service`, fully
unaffected). `buildContinuityFallbackMessage`/`ContinuityFallbackContext`/
`ContinuityFallbackClass` are read-only reused (pure functions, no R1
infrastructure) - never modified.

## Phase 12 -- Tests

New: `tests/commercial/dispatchSalesAgentTerminalOutcome.test.ts` (17 tests,
real MariaDB) - `[H1]`/`[H2]` eligibility classifier (pure); `[F1]`-`[F4]`
fallback dispatcher (all four technical-failure classes, governance,
R1-flags-irrelevant, duplicate); `[HH1]`-`[HH6]` hard-handoff dispatcher
(eligible transfer+ack, ambiguous no-op, closed-conversation guard,
transfer-unconditional-on-messaging-governance, duplicate idempotency,
R1-flags-irrelevant); `[T1]`-`[T5]` the terminal router (responded/eligible-
handoff/ambiguous-handoff/technical-failure/takeover-race, including the new
broader event's payload).

New: `tests/commercial/salesAgentRuntimeR3NativeDispatchAuthority.test.ts`
(3 tests) - the static dependency proof (Phase 10).

Modified: `tests/commercial/runSalesAgentRuntimeCycle.test.ts` - `[RC3]`
updated from "handoff via the R1 pipeline" to "ambiguous handoff via the
R3-native fallback, ownership stays AI" (same free-text reason as before -
`"needs_human_pricing_negotiation"` - now correctly classified ambiguous);
new `[RC3b]` (eligible hard handoff end-to-end through the real cycle);
`[RC4]` updated to use `RESPONSE_DISPATCH_ENABLED_ENV` instead of the R1
bridge flags, plus an explicit "ownership stays AI" assertion; new `[RC9]`
(all six R1 bridge flags false, both a technical-failure and an eligible-
handoff turn). `[RC1]`/`[RC2]`/`[RC5]`/`[RC6]`/`[RC7]`/`[RC8]` unchanged.

Regression (unmodified files/behavior, run against real MariaDB):
`dispatchSalesAgentResponse.test.ts` (12/12, zero changes needed after the
`dispatchGovernedSalesAgentMessage.ts` extraction),
`dispatchAgentLoopResponseHandoffControl.test.ts`,
`salesAgentRuntime.test.ts`, `canonicalOutboxWriter.test.ts`,
`autonomousRuntimeGates.test.ts`, `commercialWorkInboundCycle.test.ts`,
`tests/native/outbox-ownership.test.ts`,
`tests/native/outbox-pilot-isolation.test.ts`,
`tests/native/ensureAutonomousSalesTurnContinuity.test.ts`,
`tests/native/native-whatsapp.test.ts`.

**Result: 127/127 passing, 0 failures** (17 new in
`dispatchSalesAgentTerminalOutcome.test.ts` + 3 new in the authority test +
10 in `runSalesAgentRuntimeCycle.test.ts` (2 updated, 2 new) + 12 unchanged
in `dispatchSalesAgentResponse.test.ts` + 85 regression, matching the sum the
targeted run reported).

`npx tsc --noEmit`: clean. `npm run build`: clean. `npm run lint`: 0 errors,
39 pre-existing warnings, none in any file this task touched.

## Files changed

New:
- `lib/brain/commercial/sales-agent-runtime/dispatchGovernedSalesAgentMessage.ts`
- `lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentFallback.ts`
- `lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentHardHandoff.ts`
- `lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentTerminalOutcome.ts`
- `tests/commercial/dispatchSalesAgentTerminalOutcome.test.ts`
- `tests/commercial/salesAgentRuntimeR3NativeDispatchAuthority.test.ts`
- `docs/releases/SALES-AGENT-R3-V1.6-native-terminal-dispatch.md` (this file)

Modified:
- `lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentResponse.ts`
  (refactored onto `dispatchGovernedSalesAgentMessage.ts` - identical public
  contract, identical behavior, 12/12 tests green with zero test changes)
- `lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts`
  (single unified dispatch call site, no R1 import, locally defined
  `SalesAgentRuntimeDispatchResult`)
- `lib/brain/commercial/sales-agent-runtime/index.ts` (barrel exports)
- `lib/brain/commercial/events/types.ts`/`dedupe.ts`/`normalize.ts`/`service.ts`
  (new `sales_agent_runtime_terminal_dispatched` event kind)
- `tests/commercial/runSalesAgentRuntimeCycle.test.ts` (`[RC3]`/`[RC4]`
  updated, `[RC3b]`/`[RC9]` added, per Phase 12)

Untouched, confirmed by grep/test: `dispatchAgentLoopResponse.ts`,
`execution-gate/**`, `autonomy-sandbox/**`, `action-queue/**`,
`runAgentToolLoop.ts`, `agentStepTypes.ts`, `validateAgentStep.ts`,
`buildAgentStepPromptPackage.ts`, `runNativeAgentToolLoopCycle.ts`,
`dispatchCommercialWorkResponse.ts`, `continuity/dispatchFallbackAction.ts`,
`canonicalOutboxWriter.ts`, `autonomousOutboxTick.ts`,
`lib/domains/conversations/control.ts`.

## Remaining R1 dependencies reachable from SalesAgentRuntime

**None.** `runSalesAgentRuntimeCycle.ts` has no import path, direct or
transitive, to `action-queue/**`, `autonomy-sandbox/**`, or
`execution-gate/**`. The only shared infrastructure SalesAgentRuntime still
touches outside its own directory is: `runAgentToolLoop.ts` (ATL, the
reasoning engine itself - unavoidable and unchanged), the pure
`buildContinuityFallbackMessage` renderer, and
`lib/domains/conversations/control.ts`'s neutral ownership primitives
(`takeHumanControlForAiHandoff`, `isConversationClosedStatus`) - none of
which are part of the R1 action-lifecycle stack this task removes.

## Ambiguity discovered in the current handoff reason contract

`AgentLoopResult.handoffReason` / `AgentStepHandoff.reason` is unstructured
free text with no machine-checkable distinction between "the customer
explicitly asked for a human" and "the model is stuck." This is a real,
pre-existing gap in ATL's own contract (not introduced by this task) that
this task deliberately did not close, per its own Scope Guard (ATL behavior
is out of scope) and its own instruction to fail safe rather than guess.
Closing it for real production traffic is a follow-up task: extend
`AgentStepHandoff` with a structured, model-emitted category (or a
deterministic, non-LLM policy signal computed elsewhere in the turn) that
`classifyHardHandoffEligibility()` can consume without touching this file's
own logic - the eligibility gate is already isolated exactly so that swap is
a one-function change.

## Verdict

**`R3_V1_6_NATIVE_TERMINAL_DISPATCH_VALIDATED`**

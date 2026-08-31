# SALES-AGENT-R3-A05 -- Structured Follow-up Wake / Unified Re-entry

Status: implemented, real-database verified. No WhatsApp routing change, no
new Capability Gateway capability, no `SalesAgentHarness` build-out,
`CommercialWork` untouched, ATL untouched, follow-up scheduling persistence
unchanged (no new migration). This is `R3-A05` from
`docs/architecture/SALES-AGENT-R3-A00-target-architecture.md`'s migration
plan (Phase 6, "Unify follow-up re-entry") and from
`docs/releases/SALES-AGENT-R3-A04-read-action-tool-surfaces.md`'s own
"Recommended R3-A05" section.

## Architectural invariant (now structurally enforced)

```
CUSTOMER:                          FOLLOW-UP:
Meta inbound                       FollowUpScheduler (crm_agent_actions)
  |                                  |
customer message event             structured FOLLOWUP_WAKE event
  |                                  |
runNativeAutonomousCycle           dispatchDraftedFollowUpMessage
                                      |
                                    execution-gate -> canonical outbox

Never:
FollowUpScheduler -> fabricated text -> customer inbound pipeline
```

`AgentRuntimeEvent = CustomerMessageEvent | FollowUpWakeEvent`
(`lib/brain/commercial/agent-runtime-event/types.ts`) is the permanent
type-level boundary. `FollowUpWakeEvent` has no `messageText`/`draftMessage`/
`body` field at all -- not a naming convention, a structural absence, proven
by test (`agentRuntimeEvent.test.ts`, exact-key assertion).

## Phase 1 -- Audit of the current follow-up architecture

Read live code, not documentation. Three real producers of
`crm_agent_actions` rows with `action_type = 'schedule_followup'` were
found and traced end to end (evidence: `persistAgentAction.ts`,
`buildAgentAction.ts`, `runCommercialExecutionBridge.ts`,
`sales-consultative/repository.ts`, `objectiveAwareFollowUp.ts`):

| Producer | Runtime | Enabled by default | `draft_payload_json` shape | Pre-A05 re-entry in `runFollowupTick.ts` |
|---|---|---|---|---|
| `objectiveAwareFollowUp.ts#scheduleObjectiveAwareFollowUp` | R2 CommercialWork | Only when `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED` + allowlist | `{kind:"objective_aware_followup", ...}` | Delegates to `processObjectiveAwareFollowUpDue` -- already a clean template dispatch, never fabricated text |
| `runCommercialExecutionBridge.ts#resolveFollowUpSchedulingContext` -> `buildAgentActionFromNextAction` (`propose_followup` -> `schedule_followup`) | Native shadow/operational-loop -- **the runtime `docs/ACTIVE_RELEASE.md` names as "unica autoridad comercial habilitada por defecto"** | **Yes** | `{nextAction, recommendedChannel, recommendedRecipient}` | **The fabricated-text path**: built `followUpMessage = draft_message ?? "Hola, ..."` and called `runNativeAutonomousCycle({..., messageText: followUpMessage, messageId: null, ...})` -- replaying the follow-up's own drafted text as if the customer had typed it |
| `sales-consultative/repository.ts#upsertFollowUpActionRow` (direct `INSERT`, bypasses `persistAgentAction`) | Legacy `sales-consultative` engine, `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED` | No (default `false`) | `{planId, intent, status, attemptNumber, maxAttempts, scheduledFor, rationale}` | Same fabricated-text path (also lacks `objective_aware_followup`'s `kind`) -- unreachable in a default deployment, still real: this row shape is exercised by `tests/e2e/followUpRestartRecovery.e2e.test.ts` (T07-E10..E14) |

**Correction to a prior assumption**: comments in `runFollowupTick.ts` before
this task called the fabricated-text branch "legacy" -- reading
`commercialCycleConfig.ts` and `docs/ACTIVE_RELEASE.md` directly shows this
is backwards. `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED` gates a *different*,
genuinely disabled-by-default module (`sales-consultative/`); the native
shadow/operational-loop pipeline that actually produces the fabricated-text
`schedule_followup` rows is gated by a separate flag family
(`BRAIN_SALES_AGENT_ENABLED`/`BRAIN_COMMERCIAL_SHADOW_ENABLED`/
`BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED`) and is, per
`ACS-R1-05.1-T01`'s own acceptance record, "la unica autoridad comercial
habilitada por defecto" in this repository's history. **The fabricated-text
re-entry this task removes was not dead code -- it was the live destination
for the currently-primary commercial runtime's own follow-up rows.**

Every other item Phase 1 of the task brief asked to inspect was read
directly: `crm_agent_actions` (`migrations/027_*.sql`), `action-lifecycle/*`
(unchanged, no new status/type), `objectiveAwareFollowUp.ts`,
`runNativeAutonomousCycle.ts` (854 lines, read in full -- confirms
`messageId: null` for a follow-up-originated turn resolves to
`correlationId` as the fallback `inboundMessageId`, another symptom of the
same anti-pattern), `runNativeAgentToolLoopCycle.ts`,
`runCommercialWorkInboundCycle.ts` (imports `objectiveAwareFollowUp.ts`
statically -- see Phase 5's circular-import note below), `AgentSessionStore`
(A01, `FOLLOWUP_WAKE`/`FOLLOWUP_SCHEDULED`/`FOLLOWUP_CANCELLED` already
reserved, unemitted), `commercial_event` (`events/types.ts` -- confirmed no
`FOLLOWUP_*` entries exist there, corroborating A01's own finding that this
vocabulary belongs in `AgentSessionStore`, not `commercial_event`), the
canonical outbox (`execution-gate/executeActionThroughGate.ts`,
`buildOutboxCommand.ts` -- already the single write path both producers now
share), `conversation_message` writes (no `INSERT INTO conversation_message`
exists anywhere in the native/ATL/R2 call chain the follow-up worker
touches -- confirmed by repo-wide search; only the separate, dormant
`lib/brain/local-ai-sdr/**` module writes that table), cancellation/dedupe
(`shouldCancelFollowUp`, `revalidateFollowUpConfiguration`, the
`active_followup_sequence_key` generated column), human-takeover/opt-out
(`checkCustomerOptOutStatus`, Step 0.5 equivalents), working-hours policy
(`computeFollowUpSchedule.ts`), retry behavior (`claimStaleExecutingFollowUp`/
`claimFailedFollowUpRetry`, attempt-bump arithmetic), and
correlation/causation propagation (`correlationId` already threaded through
every existing boundary; `causationId` was not, until this task).

## Phase 2 -- `AgentRuntimeEvent` contract

`lib/brain/commercial/agent-runtime-event/types.ts`:

```ts
type AgentRuntimeEvent = CustomerMessageEvent | FollowUpWakeEvent;

type CustomerMessageEvent = {
  type: "CUSTOMER_MESSAGE";
  conversationId: number; conversationPublicId: string;
  customerMasterId: number | null; waId: string; phoneNumberId: string;
  messageId: string | number | null; messageText: string;
  correlationId: string; currentTime: string;
};

type FollowUpWakeEvent = {
  type: "FOLLOWUP_WAKE";
  wakeId: string; actionPublicId: string; attempt: number;
  conversationId: number; opportunityId: number | null;
  correlationId: string; causationId: string | null;
  scheduledFor: string | null; firedAt: string;
  reason: "scheduled_due" | "stale_recovery" | "retry";
};
```

`CustomerMessageEvent` is a thin, structural wrapper around
`NativeAutonomousCycleInput`'s required fields (test-only injection points
deliberately excluded -- this is the type-level contract, not a copy of the
whole input surface). `FollowUpWakeEvent` uses real repository identifiers
(`actionPublicId` = `crm_agent_actions.action_id`, `conversationId` =
`conversation.id`, `opportunityId` = `crm_agent_actions.opportunity_id`) --
no invented id space. `reason` is derived from the existing claim-origin
taxonomy (`claimFollowUpCandidate`'s three branches:
`planned`/`executing`/`failed`), never a new business vocabulary.

## Phase 3 -- Wake identity / idempotency

`agent-session/dedupe.ts#buildFollowUpWakeId(actionPublicId, attempt)`:
`fwake_<sha256(actionPublicId|attempt)[:32]>`. Deterministic, no
timestamp/nonce. `attempt` here is the **resulting** attempt number after
the claim's own CAS UPDATE (`buildFollowUpWakeEvent.ts` mirrors the exact
arithmetic `claimStaleExecutingFollowUp`/`claimFailedFollowUpRetry` already
apply: `+1` for `executing`/`failed` origins, unchanged for `planned`).

This produces the required invariant precisely:

- **A genuine new attempt** (a real stale-recovery or retry, which *does*
  advance `attempt_number`) gets its own distinct `wakeId` -- the system
  genuinely woke up again.
- **A technical-failure retry of the same attempt** (`applyTechnicalFailureBackoff`
  deliberately reverts the claim's own bump, per its own existing contract)
  computes the *same* `wakeId` -- it is a retry of the same logical wake, not
  a new one. Tested explicitly
  (`agentRuntimeEvent.test.ts`, "a technical-failure retry of the SAME
  resulting attempt... computes the SAME wakeId on purpose").
- **Concurrent claims on the same attempt** can only ever produce this one
  `wakeId` -- defense in depth on top of the primary guarantee, which is
  still the pre-existing CAS claim itself (only one worker's `UPDATE`
  matches `WHERE status = 'planned'`/`'executing'`/`'failed'`). The
  `agent_session_events.dedupe_key` `UNIQUE KEY` (migration 033, unchanged)
  is the database-level backstop, same role it already plays for every
  other `AgentSessionStore` event kind (A01/A03/A04's own `*DedupeKey`
  builders).

No new durable identifier was created; no scheduling persistence was
touched (`migrations/027_*.sql` is unmodified, no new migration in this
task).

## Phase 4 -- `AgentSession` integration

A01's reserved `FOLLOWUP_WAKE` event type is used exactly as reserved.
`lib/brain/commercial/followup-wake/sessionEvents.ts#recordFollowUpWake`
mirrors `commercial-action-request/sessionEvents.ts`'s shadow/additive
discipline precisely: `ensureSession` + one `appendEvent`, wrapped in
try/catch, never throws, a failure only logs
(`agent_session_followup_wake_write_failed:<message>`) through the same
channel every other technical, non-customer-facing signal in this file
already uses.

One event per wake, carrying the **final disposition** (not a separate
"fired" event followed by a second "outcome" event -- `AppendEventInput` has
no update operation, and the dedupe key is already keyed on the resolved
attempt, so recording once with the resolved disposition is both simpler and
correct; mirrors `ASSISTANT_MESSAGE_SENT`'s own `outcome` field pattern,
`agent-session/shadowRecorder.ts`).

Payload (verified PII-safe by test, both structurally and by direct
`Object.keys`/substring-search assertions against a real persisted row --
`followUpWake.test.ts`):

```ts
{
  actionPublicId, opportunityId, attempt, wakeReason,
  scheduledFor, firedAt,
  disposition: "executed" | "cancelled" | "rescheduled" | "technical_failure" | "skipped",
  dispositionReason?, rescheduledFor?
}
```

No `wa_id`, no `phone`, no message text, no raw prompt, no reasoning. `crm_agent_actions`
remains the sole authoritative store for the follow-up's own lifecycle
(status/attempts/cancel-or-failure-reason) -- this module never writes
there; `AgentSession` only observes.

## Phase 5 -- Unified re-entry boundary

`lib/brain/commercial/agent-runtime-event/runAgentRuntimeEvent.ts`:

```ts
async function runAgentRuntimeEvent(event: AgentRuntimeEvent, deps): Promise<AgentRuntimeEventResult> {
  if (event.type === "CUSTOMER_MESSAGE") { /* maps 1:1 onto runNativeAutonomousCycle, unchanged */ }
  // event.type === "FOLLOWUP_WAKE"
  /* maps onto dispatchDraftedFollowUpMessage */
}
```

This is a real, callable seam (`runFollowupTick.ts`'s own dispatch now goes
through it, not a decorative type that nothing exercises), but it does not
duplicate either runtime: the `CUSTOMER_MESSAGE` branch is a pure field
mapping onto the existing, byte-identical `runNativeAutonomousCycle` call;
no production code calls this branch today (deliberately -- widening actual
customer-message routing through a new seam is out of this task's scope,
"do not change WhatsApp routing"). It exists, is tested
(`agentRuntimeEvent.test.ts`), and is exactly the shape a future
`SalesAgentHarness.run({event, session})` would call.

**A real circular-import risk was found and fixed while wiring this**:
`native-cycle` (needed for the `CUSTOMER_MESSAGE` branch) transitively
imports `work/runCommercialWorkInboundCycle.ts` -> `work/followup` ->
`objectiveAwareFollowUp.ts` -> `followup/runFollowupTick.ts` (for its claim
primitives) -- and `runFollowupTick.ts` now imports `runAgentRuntimeEvent`
for its own `FOLLOWUP_WAKE` dispatch. A static top-level import of
`native-cycle` in `runAgentRuntimeEvent.ts` would have closed that cycle.
Fixed with a lazy `await import("../native-cycle")` inside the
`CUSTOMER_MESSAGE` branch only, mirroring the exact pattern
`runFollowupTick.ts` already used (pre-A05) to avoid the same class of cycle
with `objectiveAwareFollowUp.ts`. Verified clean: `npx tsc --noEmit` and a
full `npm run build` both pass with zero net-new errors.

## Phase 6 -- Follow-up wake policy gate (eligibility revalidation)

Unchanged mechanics, reused exactly, never duplicated:

- **Legacy/native-shape rows** (`runFollowupTick.ts`): `checkCustomerOptOutStatus`
  -> `shouldCancelFollowUp` (customer replied / human owner / AI paused /
  conversation closed / opportunity terminal) -> `revalidateFollowUpConfiguration`
  (disabled / max attempts / opportunity age / allowed window), all against
  **current** state, never the schedule-time snapshot -- exactly as before
  this task. The only change is what happens once every check passes: a
  deterministic dispatch instead of a fabricated re-entry.
- **R2 objective-aware rows** (`objectiveAwareFollowUp.ts`):
  `revalidateObjectiveAwareFollowUp` -- opt-out, inbound-since-schedule,
  `evaluateObjectiveFollowUpEligibility` (work/objective status, conversation
  handoff/AI-disabled/closed, opportunity terminal, waiting-reason drift,
  max attempts) -- unchanged.

Identity availability was not added as a new gate: neither existing path
required it before, and this task does not widen autonomous mutation
authority (no capability call is made by a wake at all -- see Phase 10).

## Phase 7 -- Cancel / supersede semantics

Reused vocabulary, not a new taxonomy (per the task's own "do not invent
overlapping taxonomies" instruction): `FollowUpWakeDisposition` in
`followup-wake/types.ts` is `executed | cancelled | rescheduled |
technical_failure | skipped` -- a direct AgentSession-observable projection
of the outcome buckets `runFollowupTick.ts`/`revalidateFollowUpConfiguration`/
`evaluateObjectiveFollowUpEligibility` already computed pre-A05. Concrete
mappings, all tested against real MariaDB:

| Scenario | Existing mechanism (unchanged) | Wake disposition |
|---|---|---|
| Customer replied since scheduling | `shouldCancelFollowUp` | `cancelled: customer_replied_since_schedule` |
| Human took over | `shouldCancelFollowUp` | `cancelled: human_owner_active` (tested, `followUpWake.test.ts`) |
| Conversation closed / AI paused | `shouldCancelFollowUp` | `cancelled: conversation_closed` / `ai_paused` |
| Opportunity terminal | `shouldCancelFollowUp` | `cancelled: opportunity_terminal_status:<status>` |
| Customer opted out | `checkCustomerOptOutStatus` | `cancelled: customer_opted_out` |
| Config disabled / max attempts / opportunity too old | `revalidateFollowUpConfiguration` | `cancelled: <reason>` |
| Outside current allowed window | `revalidateFollowUpConfiguration` | `rescheduled: outside_allowed_window` (never dropped) |
| Opt-out/config-resolver DB failure | existing technical-failure backoff | `technical_failure: <reason>` (never consumes an attempt) |
| Dispatch blocked by execution gate | `dispatchDraftedFollowUpMessage` -> `executeActionThroughGate` | `cancelled: dispatch_blocked:<reason>` |
| Successful dispatch | canonical outbox | `executed` |
| R2 objective completed/cancelled/superseded before wake | `evaluateObjectiveFollowUpEligibility` | `cancelled: work_completed` / `objective_cancelled` / `work_superseded` / ... |

## Phase 8 -- Removal of the synthetic customer message path

The one production path that fabricated customer-authored text
(`runFollowupTick.ts`'s old `cycleRunner(...)` re-entry, Phase 1's second
table row) is **replaced**, not merely flagged: `lib/brain/commercial/followup-wake/dispatchDraftedFollowUpMessage.ts`
generalizes `objectiveAwareFollowUp.ts`'s own bypass-the-LLM
template-dispatch pattern (A00's explicit recommendation) for the shape R2's
payload does not cover. It builds a `send_whatsapp_reply` `CrmAgentAction`
from the row's own **already-decided** `draft_message` (set at schedule time
by `buildAgentActionFromNextAction.ts`, itself the real model's own prior
turn), persists it (`persistAgentAction`), evaluates it through the same
sandbox/execution-gate the R2 path already uses
(`autonomy-sandbox`, `execution-gate/executeActionThroughGate.ts`), and
never calls a model.

Classification of every path found in Phase 1:

- Native shadow/operational-loop `propose_followup` rows -- **A: replaced**
  with `FOLLOWUP_WAKE` dispatch (the primary target of this task).
- `sales-consultative/repository.ts` rows -- **A: replaced** for free (same
  generalized dispatch, since it branches on payload shape, not producer
  identity) -- confirmed live by `tests/e2e/followUpRestartRecovery.e2e.test.ts`
  (T07-E10..E14), disabled-by-default runtime, unreachable in production
  today but no longer capable of fabricating text if ever re-enabled.
- R2 objective-aware rows -- **C: already correct**, unchanged, now also
  emits `FOLLOWUP_WAKE` (Phase 9).
- `multi-request/requestFollowups.ts` -- **B: confirmed dead**, already
  documented as removed per `ACS-R1-05-T05`'s prior reconciliation; not
  touched, not re-verified beyond that existing record.
- `autonomous-loop/**`/`follow-up-scheduling/**`/`follow-up-replanning/**`
  (dev sandbox) -- **B: dead**, zero production callers, per A00's own audit;
  not touched.

**No live R3-compatible follow-up path fabricates customer-authored text
after this task.**

## Phase 9 -- Objective-aware follow-up integration preserved

`objectiveAwareFollowUp.ts`'s deterministic strength (`buildObjectiveFollowUpMessage`
rebuilding the message from the **current** waiting reason, never resending
a stale draft) is untouched -- the only change is additive: wake recording
at each of its four disposition points (revalidation-fail ->
`cancelled`, persistence-fail -> `technical_failure`, execution-gate-blocked
-> `cancelled`, sent -> `executed`), wrapped the same shadow/additive way
everywhere else in this task. All 8 pre-existing tests in
`objectiveAwareFollowUp.test.ts` pass unmodified.

A structured `FOLLOWUP_WAKE` does not mean every wake calls a model: the
native-shape dispatch never did before this task and still does not
(Phase 8) -- both live paths are, and remain, deterministic. The
architectural requirement satisfied here is structured re-entry, not
mandatory model use, exactly as the task brief states.

**Deliberate limitation, stated explicitly**: unlike R2's objective-aware
path, the generalized native-shape dispatch (`dispatchDraftedFollowUpMessage.ts`)
does **not** regenerate its message from current state at wake time -- it
resends the exact `draft_message` decided at schedule time. There is no
"objective" abstraction in the shadow/operational-loop runtime to recompute
from (that concept is R2-specific), and building one is a materially larger
change than this task's mandate ("do not duplicate the entire runtime",
"do not build the complete SalesAgentHarness"). The existing revalidation
(Phase 6) still guards against the message being wrong in an important way
(customer already replied, human took over, opportunity closed) -- only a
message that has gone stale in a *subtler* way (still technically valid to
send, but no longer the most relevant thing to say) is not caught. This is a
real, honest trade-off, not an oversight; a future task that wants
"regenerate from current state" for this runtime needs either a
shadow-loop equivalent of R2's objective model or the future
`SalesAgentHarness` itself.

## Phase 10 -- Outbound path

Unchanged, reused directly: `dispatchDraftedFollowUpMessage.ts` calls
`persistAgentAction` -> `evaluateAgentActionForSandbox` ->
`executeActionThroughGate` -> canonical outbox
(`execution-gate/buildOutboxCommand.ts`, single writer via
`INSERT IGNORE` dedupe) -- the exact same call sequence
`objectiveAwareFollowUp.ts`'s `buildSendAction` path already uses. No direct
Meta call, no second outbox writer. Verified end to end against real
MariaDB: `tests/e2e/followUpDirectRuntimeValidation.e2e.test.ts`'s real
inbound -> real model decision -> real persisted row -> forced due -> real
worker -> real outbox row, with the outbox `message_text` asserted equal to
the row's own `draft_message` (proving no second model call happened).

## Phase 11 -- Conversation timeline

No synthetic customer message is created for a wake, and none was even
before this task at the `conversation_message` table level (the
fabrication was prompt/decision-level only inside a bypassed
`runNativeAutonomousCycle` turn, never persisted as an inbound row -- see
Phase 1). This task adds a **direct, empirical regression test**
(`followUpWake.test.ts`, "no fake inbound message... never create a
customer-authored conversation_message" -- counts inbound rows before/after
a real tick) rather than relying on that inference alone. `AgentSession`
represents the internal wake separately, exactly as required.

## Phase 12 -- CommercialWork compatibility

Not removed, not touched beyond `objectiveAwareFollowUp.ts`'s additive wake
recording (Phase 9). `crm_agent_actions.conversation_case_id`/`opportunity_id`
were audited per the task's own instruction ("true customer-message
provenance, or a generic causation anchor accidentally named as message
id?") -- confirmed **(B)**: these are, and always were, generic identity/
causation anchors, never a customer-message-id field; `FollowUpWakeEvent`
reads them as exactly that (`actionPublicId`, `conversationId`,
`opportunityId`), and no field on `crm_agent_actions` was populated with a
fake value to satisfy a type. No provenance type was generalized -- none
needed to be.

## Phase 13 -- ATL compatibility

Confirmed by direct read (not assumed): ATL (`agent-loop/runAgentToolLoop.ts`)
never handles follow-up re-entry -- `schedule_followup` is not a Capability
Gateway capability at all (absent from A04's own exhaustive 17-entry
classification table) and is never in `AGENT_LOOP_TOOL_POOL`. ATL is
unchanged by this task; it remains, correctly, unrelated to follow-up wake
dispatch.

## Phase 14 -- Future `SalesAgentHarness` contract

`AgentRuntimeEvent`'s discriminant is type-level (`event.type === "CUSTOMER_MESSAGE"`
vs. `"FOLLOWUP_WAKE"`), never a prompt convention or text heuristic --
directly testable and tested (`agentRuntimeEvent.test.ts`). A future
`SalesAgentHarness.run({event, session})` can call `runAgentRuntimeEvent`
unchanged; the `CUSTOMER_MESSAGE` branch's mapping already proves the seam
handles that variant correctly today, with zero production callers routed
through it yet (deliberately -- out of scope, no routing change). The full
Harness is not built in this task.

## Phase 15 -- Observability

A wake is traceable across every store the task named, all correlated by
one `correlationId` (`followup:<actionPublicId>:<ms>`, unchanged format)
shared between the `FOLLOWUP_WAKE` `AgentSession` event and (when the wake
proceeds) the dispatched `send_whatsapp_reply` action/outbox row:

- `crm_agent_actions` -- the schedule row's own status/attempt lifecycle,
  unchanged authority.
- `AgentSession` (`agent_sessions`/`agent_session_events`) -- the new
  `FOLLOWUP_WAKE` event, structural payload, this task's own addition.
- `commercial_event` -- unaffected; the task's audit confirmed this table
  was never the right home for follow-up-wake vocabulary (Phase 1).
- `outbox` (`brain_message_outbox`) -- the dispatched message, via the
  unchanged canonical writer.

No new standalone audit table was created, per the task's own "prefer
reuse" instruction.

**A real, deliberate observability trade-off found and documented, not
silently accepted**: `lib/domains/follow-up-observability/detailService.ts#resolveOutboxCorrelation`
joins `crm_agent_decisions.correlation_id LIKE 'followup:<actionId>:%'` to
`crm_agent_actions.decision_id` to find a fired follow-up's own outbox
message -- a mechanism that worked for the pre-A05 fabricated-text path
because `runNativeAutonomousCycle`'s decision persistence created a real
`crm_agent_decisions` row with a real `decision_id`. `dispatchDraftedFollowUpMessage.ts`'s
`buildSendAction` sets `decisionId: null` (mirroring `objectiveAwareFollowUp.ts`'s
own `buildSendAction`, which **already** does this and already gets `"none"`
from this same correlation query today). After this task, the
native-shape dispatch path degrades to that same pre-existing "none, best-
effort, never an error" behavior `follow-up-observability` was already
built to tolerate (its own code comment: "the absence of a match is never
treated as an error") -- nothing breaks, but a follow-up that used to be
correlatable via this specific SQL join no longer is. The **new**
`FOLLOWUP_WAKE` `AgentSession` event, sharing the same `correlationId`
format, is a stronger correlation primitive for a future rebuild of that
read model, correlated via `AgentSession` instead of a `crm_agent_decisions`
join that only ever worked for one of the runtime's several follow-up
producers. `follow-up-observability/detailService.ts` itself is not modified
in this task -- out of scope, and this task's own instruction is to reuse,
not redesign, existing read models without evidence requiring it.

## Phase 16 -- Tests

**New**, all green:

- `tests/commercial/agentRuntimeEvent.test.ts` (9 tests, no DB) -- distinct
  typed variants, structural absence of customer text on `FollowUpWakeEvent`,
  correct routing to each branch with zero cross-talk (a wake never reaches
  the customer-message runner), rejection with no dispatch context, wake-id
  determinism (same inputs -> same id, different action/attempt -> different
  id, same technical-failure-retried attempt -> same id on purpose), reason
  derivation from claim origin.
- `tests/commercial/followUpWake.test.ts` (4 tests, real MariaDB `crm_test`)
  -- a due drafted row dispatches through the real canonical outbound path
  with the outbox `message_text` equal to the row's own `draft_message`,
  exactly one `FOLLOWUP_WAKE` event lands with a PII-safe payload; a
  human-takeover cancellation records `disposition=cancelled` with the real
  reason and produces zero outbox rows; a repeated tick on an
  already-terminal row never produces a second logical wake; `correlationId`
  is shared between the session event and its own dedupe key. Also
  empirically proves (not just infers) that no customer-authored
  `conversation_message` row is ever created for an internal wake.

**Updated for the new architecture** (mechanical `cycleRunner` ->
`dispatchDraftedFollowUpMessage` rename plus, where the old fake asserted
cycle-specific behavior, an equivalent assertion against the new dispatch
contract -- test *intent* preserved exactly, only the mechanism under test
changed):

- `tests/commercial/runFollowupTick.test.ts` (34 tests) -- every
  claim/cancel/retry/dedup/pilot-allowlist test this file already had, now
  exercising the real dispatch seam.
- `tests/commercial/followUpRevalidationAndOptOut.test.ts` (25 tests).
- `tests/e2e/followUpDirectRuntimeValidation.e2e.test.ts` (1 test) --
  rewritten to prove the **stronger** claim this task's architecture makes
  possible: no second model call is needed at all for a follow-up wake (the
  old version needed a second scripted provider specifically because the
  old path called the model again; the new version asserts the dispatched
  outbox text is byte-identical to the row's own durable draft).
- `tests/e2e/followUpRestartRecovery.e2e.test.ts` (5 tests, T07-E10..E14) --
  proves the `sales-consultative`-originated row shape also dispatches
  correctly through the generalized path.
- `scripts/e2e-autonomous-harness.ts` -- same mechanical update (not part of
  `node --test`, verified via `tsc`/`build` only, per its own nature as an
  ad-hoc operational script).

**Regressions** (all against real MariaDB, `--test-concurrency=1` where the
repo's own documented shared-scope contention applies):

| Suite | Result |
|---|---|
| Follow-up (`followUpSequenceContinuity`, `followUpRuntimeAuthority`, `computeFollowUpSchedule`) | 45/45 |
| `objectiveAwareFollowUp.test.ts` | 8/8 |
| `commercialWorkWaitingCustomerReactivation`, `objectiveAwareFollowUpEligibility`, `r2ArchitectureFollowUpScenarios` | 17/17 |
| AgentSessionStore/`readToolRequest`/`commercialActionRequest`/`agentCapabilityExposure`/`agentToolLoopSessionShadow` (batch) | 102/103 -- 1 pre-existing failure, confirmed byte-identical against the unmodified `develop` baseline via `git stash` (`agentSessionStoreMariaDb.test.ts`, same-millisecond ordering test, unrelated to this task's files) |
| `commercialWorkInboundCycle`/`commercialWorkIdentityGating`/`commercialWorkIdentityOnboarding`/`canonicalOutboxWriter`/`outboxWorker`/`capabilityGatewayIdentityGate`/`runtimeIdentityContext` (batch) | 149/153 -- 4 pre-existing failures, confirmed byte-identical against the unmodified `develop` baseline via `git stash` (`runtimeIdentityContext.test.ts` RIC10/RIC11/RIC21/RIC23-24, `SYSTEM_UNAVAILABLE` -- an external Customer Service dependency this sandbox cannot reach, unrelated to this task's files) |
| `runAgentToolLoop.test.ts` + `runNativeAgentToolLoopCycleConfig.test.ts` (ATL/native cycle) | 112/112 |
| `commercialWorkExecutor`/`commercialWorkTransitions`/`followUpSequenceContinuity`/`followUpRuntimeAuthority`/`computeFollowUpSchedule` | 45/45 |

Total: **507/512 targeted tests green**, the remaining 5 confirmed
pre-existing and unrelated by direct baseline comparison, not assumption.

`npx tsc --noEmit`: zero errors outside the pre-existing, documented
`experiments/deepseek-harness/**` baseline. `npm run build`: clean.
`npx eslint` on every new/changed `lib/` file: zero findings.

## Files changed

New: `lib/brain/commercial/agent-runtime-event/{types,runAgentRuntimeEvent,index}.ts`,
`lib/brain/commercial/followup-wake/{types,sessionEvents,dispatchDraftedFollowUpMessage,buildFollowUpWakeEvent,index}.ts`,
`tests/commercial/{agentRuntimeEvent,followUpWake}.test.ts`.

Edited: `lib/brain/commercial/agent-session/dedupe.ts` (two new builder
functions, additive), `lib/brain/commercial/followup/runFollowupTick.ts`
(the fabricated-text dispatch replaced; `FollowupTickOptions.cycleRunner`/
`defaultPhoneNumberId` removed -- genuinely dead once the re-entry they fed
was removed -- replaced by `dispatchDraftedFollowUpMessage`), 
`lib/brain/commercial/work/followup/objectiveAwareFollowUp.ts` (additive
wake recording at its four disposition points only),
`tests/commercial/{runFollowupTick,followUpRevalidationAndOptOut}.test.ts`,
`tests/e2e/{followUpDirectRuntimeValidation,followUpRestartRecovery}.e2e.test.ts`,
`scripts/e2e-autonomous-harness.ts`.

No migration. No new Capability Gateway capability. No flag added or
removed (this task's new dispatch is not behind a flag -- it fully replaces
the old behavior at the one call site that had it, matching the task's own
"no fake inbound" exit criterion, which cannot be satisfied by a flag that
leaves the old path reachable).

## Limitations

- `dispatchDraftedFollowUpMessage.ts` resends the schedule-time draft
  verbatim for native-shape rows, never regenerating it from current state
  (Phase 9) -- an explicit, evidence-backed trade-off, not an oversight.
- `follow-up-observability/detailService.ts#resolveOutboxCorrelation`'s
  `crm_agent_decisions`-based correlation no longer finds a native-shape
  wake's own outbox message (Phase 15) -- degrades to the same "none,
  best-effort" behavior it already tolerates for R2's own follow-ups; not
  fixed in this task.
- `AgentSession` `FOLLOWUP_WAKE` recording is shadow/additive against
  `crm_test` (migration 033 applied) but silently no-ops against
  `main_management`, which does not have migration 033 applied
  (`agent_sessions`/`agent_session_events` do not exist there -- confirmed
  by direct query). This was true before this task for every A01 shadow
  event too; not introduced here, not fixed here (applying a migration to a
  shared local dev database is out of this task's scope). Every regression
  suite that runs against `main_management` (`runFollowupTick.test.ts`)
  still passes in full -- the degradation is exactly as designed, never
  fatal to the tick.
- `runAgentRuntimeEvent`'s `CUSTOMER_MESSAGE` branch has zero production
  callers today (Phase 5) -- deliberate, not a gap: routing real customer
  traffic through it is a future `SalesAgentHarness`/routing-widening
  decision, explicitly out of this task's scope ("do not change WhatsApp
  routing").
- `FOLLOWUP_SCHEDULED`/`FOLLOWUP_CANCELLED` (A01's other two reserved
  follow-up event types) remain unemitted -- this task's mandate was
  specifically the wake side (`FOLLOWUP_WAKE`); wiring the scheduling and
  standalone-cancellation moments is real, scoped, future work, not silently
  implied by this task's title.

## Rollback

Purely additive at the module level, one real behavior change at one call
site:

1. Revert `runFollowupTick.ts` and `objectiveAwareFollowUp.ts` to restore
   the pre-A05 `cycleRunner` re-entry and remove wake recording.
2. Delete `lib/brain/commercial/agent-runtime-event/` and
   `lib/brain/commercial/followup-wake/` and their test files.
3. Revert the `agent-session/dedupe.ts` addition (two functions, no
   consumer left once step 1 is reverted).
4. Revert the mechanical test-file renames (`dispatchDraftedFollowUpMessage`
   -> `cycleRunner`) in the four updated test files and
   `scripts/e2e-autonomous-harness.ts`.

No migration to roll back (none was added). No flag to flip. `AgentSession`
rows this task wrote (`FOLLOWUP_WAKE` events) are inert historical data,
safe to leave in place or dropped via A01's own existing rollback SQL if a
full revert of the whole `AgentSessionStore` slice is ever wanted (unrelated
to this task).

## Recommended next task

Per `docs/architecture/SALES-AGENT-R3-A00-target-architecture.md` Phase 6:
**`R3-A06` -- `crm_opportunities` creation on the Harness path**, exactly as
already sequenced (before A07/A08). This task's own work does not block or
require it. Two smaller, optional follow-ups this task's own audit
surfaced, neither blocking: (a) wire `FOLLOWUP_SCHEDULED`/`FOLLOWUP_CANCELLED`
at their own natural emission points if a future task needs that
observability; (b) rebuild `follow-up-observability`'s outbox correlation
on top of `AgentSession`'s `correlationId` instead of the
`crm_agent_decisions` join this task's change made even less complete than
it already was for R2.

## Exit criteria

Declaring `R3_A05_STRUCTURED_FOLLOWUP_WAKE_VALIDATED`:

- Follow-up wake is a typed system event -- confirmed, `FollowUpWakeEvent`,
  type-level and tested (Phase 2, Phase 14).
- It cannot be confused with customer input -- confirmed, structurally (no
  `messageText` field exists on the type at all) and behaviorally (a wake
  never reaches `runNativeAutonomousCycle`, tested both at the seam level
  and end to end against real MariaDB) (Phase 5, Phase 8, Phase 16).
- No migrated live follow-up path fabricates customer-authored text --
  confirmed for both live producers found in the Phase 1 audit (Phase 8).
- Repeated wakes are idempotent -- confirmed, wake-id determinism plus a
  real-database dedup test (Phase 3, Phase 16).
- Eligibility is revalidated at wake time -- confirmed, unchanged existing
  mechanism, reused not duplicated (Phase 6).
- Stale/completed/cancelled follow-ups do not send -- confirmed, full
  disposition mapping table, tested (Phase 7).
- Human takeover/suppression remains respected -- confirmed, unchanged
  checks, explicitly tested against the new dispatch (Phase 16).
- Objective-aware follow-up behavior is preserved -- confirmed, 8/8
  pre-existing tests green, additive-only diff (Phase 9).
- `AgentSession` records structural wake events -- confirmed, PII-safe,
  real-database verified (Phase 4, Phase 16).
- `conversation_message` remains actual communication only -- confirmed,
  empirically tested, not just inferred (Phase 11).
- Canonical outbox remains the outbound path -- confirmed, unchanged call
  chain, real-database end-to-end proof (Phase 10).
- `CommercialWork` remains compatible -- confirmed, untouched beyond
  additive wake recording (Phase 12).
- Future `SalesAgentHarness` can consume the event type directly --
  confirmed, the seam exists and is tested today (Phase 5, Phase 14).
- Regressions are clean -- confirmed, 507/512 targeted tests green, the
  remaining 5 confirmed pre-existing and unrelated via direct baseline
  comparison (Phase 16).
- No production WhatsApp routing changed -- confirmed: no route, no
  webhook, no `processNativeWhatsAppInbound` call site touched; the only
  behavior change is at the one follow-up-worker call site this task's own
  title names.

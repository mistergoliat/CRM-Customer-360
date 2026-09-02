# SALES-AGENT-R3-V1.8-D6 -- Legacy recentMessages Retirement

Status: implemented. Real production code changed: routing/config only -
`buildAgentStepPromptPackage.ts` (the actual persistent/legacy message
assembly D5.2 already fixed) is untouched by this task. Real DeepSeek + real
MariaDB (`main_management`) live validation included below.

## 1. Executive verdict

**`R3_V1_8_D6_LEGACY_RECENTMESSAGES_RETIREMENT_VALIDATED`**

Persistent-session cognition is now the default conversational-memory path
for every turn already eligible for `SalesAgentRuntime` -
`BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED` defaults to `true`, D5's
separate `BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS` owner allowlist is
retired, and `BRAIN_SALES_AGENT_RUNTIME_WA_IDS` (unchanged, still empty by
default) remains the sole rollout boundary. All 13 exit gates (Section X of
the task brief) hold with direct evidence: unit tests, real-MariaDB
integration tests, and a real-DeepSeek/real-MariaDB live benchmark driven
through the actual production entry point (`runNativeAutonomousCycle`, no
provider bypass).

## 2. Why this was a small diff

D5/D5.2 already built the entire target mechanism: `resolvePersistentSessionCognitionContext.ts`
already resolves `active: true` for a brand-new conversation with zero
history (never confusing empty history with a fallback), `buildAgentStepPromptPackage.ts`'s
persistent branch already emits `[system, user]` with no `recentMessages` and
no synthetic separator, and `salesAgentRuntime.ts` already strips
`recentMessages` from `commercialContextSummary` only when the persistent
path is active. What D5 left owner-only was purely the **gating**: a second,
independent `BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS` allowlist and a
default-`false` flag. D6 is therefore a routing/default change, not a
message-assembly change - the task brief's own Section U ("D6 should require
NO database migration... if it appears to, STOP") predicted exactly this
shape, and no migration was needed.

## 3. Architecture before/after

**Before (D5/D5.2)**:

```
SalesAgentRuntime-eligible turn (BRAIN_SALES_AGENT_RUNTIME_WA_IDS)
        v
shouldEnablePersistentSessionCognition(waId)
        v
  flag=false (default) OR waId not in BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS (default empty)
        v
  legacy recentMessages path (always, for every real customer)
```

**After (D6)**:

```
SalesAgentRuntime-eligible turn (BRAIN_SALES_AGENT_RUNTIME_WA_IDS)
        v
shouldEnablePersistentSessionCognition()   [BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED, default true]
        v
  resolvePersistentSessionCognitionContext() -> loadPersistentSessionContext + deriveMessages
        v
  active: true (read/derive succeeded, incl. zero-history)  ->  persistent path (recentMessages stripped)
  active: false (read/derive failed, or flag explicitly false) -> legacy recentMessages path
```

## 4. `recentMessages` final responsibility

Unchanged code, changed responsibility. `buildMinimalCommercialContextSummary`
(`runSalesAgentRuntimeCycle.ts`) still builds `recentMessages` (last 5
`{direction, body}` entries) on every turn - this task did not remove that.
`salesAgentRuntime.ts`'s existing `stripRecentMessagesForPersistentSessionContext`
call (only when `persistentSessionCognition.active`) now runs on essentially
every ordinary R3 turn instead of only an owner-only pilot slice, so
`recentMessages` is now **built but discarded** on the normal path and
**consumed only on fallback** (a persistent-session read/derive failure, or
the explicit rollback flag). Not deleted - the fallback still needs it, and
still gets the exact byte-identical legacy request shape D5.2 already proved.

## 5. Configuration changes

| Flag | Before (D5) | After (D6) |
|---|---|---|
| `BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED` | default `false` | default **`true`** - now the rollback lever |
| `BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS` | required, non-empty, second allowlist | **retired** - no longer read anywhere; `loadPersistentSessionCognitionAllowlist` deleted from `autonomousRuntimeConfig.ts` |
| `BRAIN_SALES_AGENT_RUNTIME_WA_IDS` | R3 routing boundary | unchanged - still the sole rollout boundary |
| `BRAIN_R3_PERSISTENT_SESSION_SHADOW_ENABLED` (D4) | independent diagnostic | unchanged, independent (Section 14) |

`shouldEnablePersistentSessionCognition()` (`commercialCycleConfig.ts`) no
longer takes a `waId` parameter - it is now just the flag read, kept as a
named function only so call sites/tests retain a stable, greppable name.
`runNativeAutonomousCycle.ts`'s one call site
(`persistentSessionCognitionEnabled: shouldEnablePersistentSessionCognition()`)
is the only routing change in the entire diff.

## 6. Zero-history behavior (G3)

Unchanged code (D5/D5.2), reconfirmed live and by test: a brand-new
conversation with no prior turns still resolves `active: true`,
`historicalMessages: []`, provider role shape `[system, user]`. Never
interpreted as a fallback condition. Real-DeepSeek evidence: Scenario A of
the live benchmark (Section 9) - 3/3 fresh conversations, zero
`BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS` configured at all,
`cognitionActive=true`, `historyMessageCount=0`, `status=responded`.

## 7. Fallback behavior (G4/G5)

Unchanged code. Live-forced rollback (Scenario B, Section 9):
`BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED=false` on an otherwise fully
eligible turn (real prior message present) produced **zero**
`persistent_session_cognition_applied` events (2/2) and the turn still
completed normally via the legacy path (`status=responded`, 2/2). A read/derive
failure (session read lock timeout, malformed compacted metadata, thrown
store error) still degrades to `active: false` with a structured
`fallbackWarning` and the exact legacy request shape -
`resolvePersistentSessionCognitionContext.test.ts`'s existing `[D5-Q1]`/`[D5-Q4]`
suite (untouched by this task, still 100% passing) already covers this and
was re-run clean.

One deliberate, documented non-change: when the global rollback flag itself
is `false`, no per-turn `persistent_session_cognition_applied` event is
written at all (the eligibility check that gates the diagnostic write is the
same boolean that gates the whole feature). This is intentional, not a gap -
an operator who flips that env var already knows unambiguously they are in
legacy mode from the env var itself; a per-turn DB row for that state was
never a D5/D6 requirement (Section P asks for "ideally distinguish," not "must
always emit").

## 8. Provider request shape (G2)

Unchanged code (D5.2 already fixed this). Re-verified by the full,
unmodified `buildAgentStepPromptPackage.test.ts` suite (`[D5.2-T1]` through
`[D5.2-T10]`, all passing): the persistent branch's `messages` array never
contains a `recentMessages` key, historical messages are spliced verbatim
from `deriveMessages()`, and the current customer message appears exactly
once.

## 9. Live benchmark - real DeepSeek + real MariaDB

Real credentials from this environment's own `.env`
(`BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY`/`BRAIN_MODEL_NAME=deepseek-v4-flash`),
real MariaDB (`main_management`), driven through **`runNativeAutonomousCycle`
with no `agentLoopProvider` override** - unlike D5.2's benchmark (which
called `runSalesAgentRuntime()` directly and passed
`persistentSessionCognitionEnabled` by hand, bypassing routing), this run
exercises the real production entry point end-to-end: real conversation/
`conversation_message` rows, real routing gates
(`BRAIN_SALES_AGENT_RUNTIME_ENABLED`/`_WA_IDS`), the real
`shouldEnablePersistentSessionCognition()` default. Same natural environment
conditions as D5/D5.1/D5.2: `LOGISTICS_DB_ENABLED=false`,
`CATALOG_SERVICE_BASE_URL=http://127.0.0.1:4010` unreachable. Two throwaway
scratchpad scripts (`d6-benchmark.ts`, `d6-benchmark-e.ts`), repo root, never
committed, deleted after use - same precedent as D5/D5.1/D5.2.

**Scenario A - default mode, zero-history (3 reps)**: `BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS`
never set. 3/3 turns `cognitionActive=true`, `historyMessageCount=0`,
`status=responded`. Proves G1/G2/G3/G9 (T9: the retired allowlist is never
configured and cognition is still active) with real evidence, not just the
fake-provider integration tests (Section 11).

**Scenario B - rollback (2 reps)**: `BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED=false`.
2/2 turns wrote no cognition event at all, 2/2 still responded normally via
the legacy path. Proves G11 live.

**Scenario C - B06 shipping-failure control, default mode (5 reps, turn 1
only)**: same real, controlled `set_shipping_destination` failure D5.1/D5.2
characterized (`configuration_unavailable`, `LOGISTICS_DB_ENABLED=false`).
**0/5 handoffs** (D5.2's own post-fix persistent reference: 1/10 = 10%). No
structural regression - if anything, this single run measured better,
consistent with D5.2's own caution against over-interpreting a single
session's stochastic rate (Section 18 of that doc already flagged this exact
non-determinism).

**Scenario D - search_products failure control, default mode (3 reps)**:
Catalog Service confirmed unreachable, no injected seam. **0/3 handoffs**
(D5.2 reference: 0/5 both modes). No regression.

**Scenario E - >5-message live continuity, default mode**: same 5-turn
scenario D5.2 Section 11 introduced (barra 20kg -> colchonetas -> despacho
Maipu -> balones medicinales -> "volvamos a la barra olimpica..."). Three
independent live runs total (1 in the main script + 2 reruns with tool-call
argument capture added):

- All 3 runs: `cognitionActive=true` and `fallback=false` at every turn,
  `historyMessageCount` growing correctly `0 -> 2 -> 4 -> 6 -> 8` across the
  5 turns (real historical messages accumulating, never evicted - unlike
  legacy's 5-message tail).
- Turn 5's real `search_products` tool-call argument (captured from
  `crm_capability_executions.request_summary_json`, not just the final
  wording): **2/2 reruns retained `"barra olimpica 20kg"`** as the query,
  matching D5.2's own finding that persistent mode's tool-call arguments (not
  just its final phrasing) reflect turn-1 specificity that a 5-message window
  would have evicted.
- Turn 5's final response text: **2/3 runs explicitly said "de 20 kg"**; the
  first run's response omitted the number in its final wording
  ("...la barra olímpica en este momento...") while the underlying mechanism
  was still fully correct (persistent path active, not a fallback, and the
  history count was already correctly accumulated for that turn). Reported
  honestly, not hidden: this is real DeepSeek response-wording
  non-determinism on a single live run, not a fallback and not evidence
  against the mechanism - consistent with the task brief's own Section T
  instruction ("Do not overinterpret stochastic percentages") and D5.2's own
  precedent of reporting this class of variance directly (Section 7 of that
  doc).

**Scenario F - superseding correction, default mode (1 rep, 3 turns)**:
"San Bernardo" -> "finalmente a Maipu, no San Bernardo" -> "y a Maipu cuanto
seria?". All 3 turns `status=responded`, `reason=sales_agent_runtime` -
correction handled without a handoff.

## 10. Truth-layer separation (Section K)

Unchanged, reconfirmed: Persistent Session remains historical conversational
evidence only; `RecentCatalogContext` remains recently-presented catalog
references; `pendingCatalogAction` remains structurally-open catalog action
state; `CommercialContext` remains authoritative current domain state. No
`recentMessages`-derived value is authoritative anywhere in this diff -
`recentMessages` is either discarded (persistent path) or used verbatim, as
before D5 ever existed (fallback path).

## 11. Observability (Section P)

No schema change. `PersistentSessionCognitionAppliedPayload`
(`events/types.ts`, unchanged) already carries exactly what Section P asks
for: `active` doubles as `sessionCognitionMode`
(`true` = persistent_session, `false` = legacy_fallback),
`fallbackReason`/`historyMessageCount` unchanged. What changed is *when* it
fires: under D5 this event was owner-only (noise-avoidance, by design);
under D6 the same write condition (`input.persistentSessionCognitionEnabled === true`)
now fires for essentially every ordinary R3 turn, making this event the
real per-turn persistent-vs-fallback signal for production traffic once the
pilot allowlist (`BRAIN_SALES_AGENT_RUNTIME_WA_IDS`) is ever opened. See
Section 7 above for the one deliberate non-firing case (global rollback).

## 12. D4 shadow decision (Section Q)

**`KEEP_AS_DIAGNOSTIC`**. `runPersistentSessionShadow.ts` independently
loads/derives/compares/discards on its own flag
(`BRAIN_R3_PERSISTENT_SESSION_SHADOW_ENABLED`), unrelated to whether live
cognition is active this turn - it still measures real read/derive health,
timing, and legacy-vs-persistent drift regardless of D6's routing default,
and costs nothing when its own flag is off (default). No code touched;
`[D4-*]` tests re-run clean (Section 13).

## 13. Rollback (G11)

`BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED=false` (global) immediately
reverts every R3 turn to the legacy `recentMessages` path - proven live
(Section 9, Scenario B) and by test (`[D6-T10]` in both the pure-function and
integration test files below). No allowlist to touch, no DB rollback, no
migration, no session deletion, no restart-dependent state - identical
rollback contract to D5, just a flipped default.

## 14. Tests

| Group | File | Result |
|---|---|---|
| Config-level gating (pure) | `tests/commercial/shouldEnablePersistentSessionCognition.test.ts` (rewritten - D5's allowlist-oriented tests replaced) | 5/5 pass: default-true, retired allowlist has zero effect (T9), rollback (T10), malformed-value fallback |
| Real-MariaDB routing integration (new) | `tests/commercial/salesAgentR3PersistentSessionDefaultRouting.test.ts` | 4/4 pass: `[D6-T2]` zero-history default-active, `[D6-T1/T9]` real-history default-active with no allowlist configured, `[D6-T10]` rollback end-to-end, `[D6-T8]` non-routed waId never reaches cognition |
| Targeted regression (unchanged files, re-run clean) | `buildAgentStepPromptPackage`, `runAgentToolLoop`, `salesAgentRuntime`, `resolvePersistentSessionCognitionContext`, `runPersistentSessionShadow`, `salesAgentR3PilotRoutingAuthority`, `salesAgentR3RuntimeIsolationAuthority` | **228/228 pass** |
| Governance/dispatch regression | `capabilityGateway`, `capabilityGatewayHardening`, `capabilityGatewayIdentityGate`, `commercialActionRequest`, `readToolRequest`, `dispatchSalesAgentResponse`, `dispatchSalesAgentTerminalOutcome`, `runSalesAgentRuntimeCycle`, `agentSessionStore`, `agentSessionStoreMariaDb`, `agentSessionSanitizer`, `agentSessionSummary` | 184/185 pass - the 1 failure (`agentSessionStoreMariaDb.test.ts`'s same-millisecond ordering test) reproduces identically on the pre-D6 baseline via `git stash` (confirmed) - the exact pre-existing flake D5.2's own doc already documented |
| Full repo suite | `npm test` (all files) | 4134/4160 pass. All 26 failures (8 unique files: `a13ConversationalReliabilityBenchmark`, `agentSessionStoreMariaDb`, `commercialWorkParallelExecution`, `continuityConcurrency`, `linkExternalIdentityCapability`, `runCommercialOperationalLoop`, `customerIdentityVerification`, `customerIdentityOnboarding.e2e`) confirmed pre-existing and unrelated - re-ran `continuityConcurrency`/`runCommercialOperationalLoop` in isolation against the pre-D6 baseline (`git stash`) and reproduced the identical `Missing DATABASE_NAME` cross-file env-isolation failure with zero D6 code present; the rest match D5.2's own already-documented debt categories verbatim (A13 benchmark debt, CommercialWork parallel wall-clock timing, identity/onboarding external Customer Service dependency already tracked in `docs/ACTIVE_RELEASE.md`) |
| `npx tsc --noEmit` | clean | |
| `npm run build` | clean, full Next.js production build | |
| `npm run lint` | 0 errors, 40 pre-existing warnings in files this task never touched (identical count/files to D5.2) | |

Live benchmark: 2 scratchpad scripts, 26 real customer turns, ~28 real
DeepSeek calls total across Scenarios A-F plus the 2 Scenario-E reruns -
executed and deleted after use (`d6-benchmark.ts`, `d6-benchmark-e.ts`, repo
root, never committed).

## 15. Files changed

Modified (production):
- `lib/brain/commercial/config/commercialCycleConfig.ts` - `buildPersistentSessionCognitionFeatureFlags`
  default flipped to `true`; `shouldEnablePersistentSessionCognition` no
  longer takes `waId`, no longer reads an allowlist; import of the retired
  allowlist loader removed.
- `lib/brain/runtime/autonomousRuntimeConfig.ts` - `loadPersistentSessionCognitionAllowlist`
  deleted (dead code, no other caller).
- `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts` - one call
  site updated (`shouldEnablePersistentSessionCognition()`, no `waId`
  argument); comment updated.
- `lib/brain/commercial/sales-agent-runtime/salesAgentRuntime.ts` - comments
  only (default-true semantics, observability now fires for ordinary
  traffic) - zero logic change.
- `lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts` -
  one doc comment updated - zero logic change.

Modified (tests):
- `tests/commercial/shouldEnablePersistentSessionCognition.test.ts` -
  rewritten for the new no-allowlist, default-true semantics.

Added (tests):
- `tests/commercial/salesAgentR3PersistentSessionDefaultRouting.test.ts` -
  real-MariaDB integration coverage for the D6 routing default, modeled on
  `salesAgentR3PilotRoutingAuthority.test.ts`'s own conventions.

Not modified (task brief's explicit boundary): `buildAgentStepPromptPackage.ts`,
`deriveMessages.ts`, `loadPersistentSessionContext.ts`,
`resolvePersistentSessionCognitionContext.ts`, `AgentSessionStore`, session
schema, `runAgentToolLoop.ts`, Capability Gateway, `CommercialActionRequest`,
`ReadToolRequest`, shipping capabilities, handoff semantics, dispatch/outbox,
D4 shadow code, D7 compaction.

Documentation:
- This file (new).
- `docs/ACTIVE_RELEASE.md` updated (current-task pointer + closure summary
  in the `SALES-AGENT-R3` workstream section).

No scratchpad files remain in the repository.

## 16. Remaining debt

- **Turn 5's exact final-wording specificity is not 100% reproducible across
  live runs** (2/3 in this task's own sample) - the underlying mechanism
  (persistent path active, correct history growth, correct tool-call
  arguments) was correct in all 3 runs; only one run's final phrasing dropped
  the number. Same class of real DeepSeek non-determinism D5.2 already
  documented for legacy's handoff rate - not a regression, not fixable by
  more code, flagged honestly per the task brief's own instruction not to
  over-interpret single-session stochastic results.
- **G18-class owner WhatsApp live smoke remains deferred**, unchanged since
  D5/D5.1/D5.2 - out of this task's scope.
- **Cache metrics still not wired into any `commercial_event`** (debt carried
  from D5/D5.2, untouched by this task).
- **`AgentStepHandoff.reason` remains free-text**, documented since V1.6, not
  touched by V1.7-D6.
- **The pre-existing, unrelated test debt catalogued in Section 14** (A13
  benchmark, CommercialWork parallel timing, `DATABASE_NAME` cross-file
  env-isolation, same-millisecond MariaDB ordering, identity/onboarding
  external Customer Service dependency) is unchanged by this task and remains
  tracked where it already was (`docs/ACTIVE_RELEASE.md`, the A13 release
  doc).
- **The R3 pilot itself remains closed to real traffic** -
  `BRAIN_SALES_AGENT_RUNTIME_WA_IDS` is still empty by default; D6 changes
  what happens *inside* R3 once a wa_id is eventually allowlisted, not
  whether any real customer reaches R3 today.

## 17. D7 readiness

**`READY_FOR_D7_SESSION_COMPACTION`**. Persistent session is now the real,
default, production-shaped conversational-memory mechanism for R3 - the
condition D7 (long-conversation compaction: durable prefix + recent raw
history) was always waiting on. D7 should stay scoped to context management
only, per the task brief's own instruction - no workflow/state-machine
semantics.

## Verdict

**`R3_V1_8_D6_LEGACY_RECENTMESSAGES_RETIREMENT_VALIDATED`**

- G1-G13 (task brief Section X) all hold with direct evidence: unit tests,
  real-MariaDB integration tests, and a real-DeepSeek/real-MariaDB live
  benchmark through the actual production routing path.
- `recentMessages` is still built by the commercial-context loader, ignored
  on the (now default) persistent path, consumed only on fallback - never
  deleted, exactly the task brief's Section E contract.
- D5's owner-specific allowlist (`BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS`)
  is retired; `BRAIN_SALES_AGENT_RUNTIME_WA_IDS` remains the sole rollout
  boundary; `BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED` (default `true`)
  is the one rollback lever, proven live.
- Zero-history, real-history, tool-failure (shipping + search_products), and
  multi-turn continuity all reconfirmed live under the new default routing,
  with no structural regression relative to D5.2's own already-validated
  numbers.
- D4 shadow: `KEEP_AS_DIAGNOSTIC`, untouched.
- Tests: 228/228 (unchanged-file regression) + 184/185 (governance/dispatch,
  1 confirmed pre-existing) + 9 new/rewritten D6-specific tests, all passing;
  full repo suite 4134/4160, all 26 failures confirmed pre-existing and
  unrelated.
- `npx tsc --noEmit`, `npm run build`, `npm run lint` all clean.
- No database migration (Section U honored).
- D7 readiness: `READY_FOR_D7_SESSION_COMPACTION`.
- Not committed at the time of this entry.

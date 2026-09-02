# SALES-AGENT-R3-V1.8-D4 -- Persistent Session Shadow Integration

Status: implemented. Real production code changed, scoped exactly to a
shadow-only read at the R3-native `SalesAgentRuntime` boundary. For every
eligible turn (flag on, real `inboundMessageId`), the runtime loads and
derives the persistent session (D3's `loadPersistentSessionContext()` +
`deriveMessages()`), compares it against the legacy `recentMessages` tail,
and emits one non-sensitive `commercial_event`. Nothing computed here ever
reaches `loopInput`, `buildAgentStepPromptPackage.ts`, or the provider
request -- proven by a byte-identical-request regression test, not just by
inspection. `BRAIN_R3_PERSISTENT_SESSION_SHADOW_ENABLED` defaults to
`false`. D5 (live session-driven cognition) is not implemented.

## 1. Executive verdict

**`R3_V1_8_D4_PERSISTENT_SESSION_SHADOW_VALIDATED`**

Every G1-G14 gate in the task brief holds, verified by execution (pure unit
tests, real MariaDB integration tests, and a real-provider-request identity
regression), not by inspection alone. 25 new tests, all passing; zero new
regressions in the broader R3-adjacent suite (298 tests) or the full repo
suite (4127 tests: 4105 pass, the same 22 pre-existing failures reproduced
identically on baseline `develop` via `git stash`).

## 2. Runtime shadow wiring

**Exact insertion point**: `lib/brain/commercial/sales-agent-runtime/salesAgentRuntime.ts`,
inside `runSalesAgentRuntime()`, immediately after `loopInput` is fully built
and after the pre-loop `USER_MESSAGE_RECEIVED` write (V1.8-D2), and
immediately before `const loop: AgentLoopResult = await runAgentToolLoop(loopInput)`.

This is the narrowest point where every required ingredient is already in
scope, all sourced from values the function already has -- nothing new is
loaded to reach this point:

- `conversationId` -- `event.conversationId`.
- `inboundMessageId` -- the same local variable already used by
  `recordUserMessageReceivedEvent` two lines above.
- the current inbound customer text -- `event.messageText` (not needed
  directly by the shadow call itself, since deriveMessages excludes by id,
  not by re-matching text).
- the current legacy commercial context -- `input.commercialContextSummary`
  (the exact object `loopInput.commercialContextSummary` also points to --
  read, never mutated, by `extractLegacyRecentMessagesForShadow`).
- `sessionStore`/DB access -- `input.sessionStore` (same DI seam D2 already
  established, defaults to the real MariaDB-backed store).
- existing warning/observability mechanism -- `preLoopWarnings`, the same
  array `recordUserMessageReceivedEvent`'s own failure already pushes into.

```
runSalesAgentRuntime()
  build loopInput
  recordUserMessageReceivedEvent (D2, pre-loop)
  if (persistentSessionShadowEnabled && inboundMessageId):
    runPersistentSessionShadowComparison(...)   <-- D4, this task
      -> loadPersistentSessionContext (D3, unchanged)
      -> deriveMessages (D3, unchanged)
      -> buildPersistentSessionShadowComparison (D4, pure, new)
      -> recordPersistentSessionShadowComparedEvent (D4, new commercial_event)
    (only a warning string can flow back into preLoopWarnings)
  runAgentToolLoop(loopInput)   <-- untouched input, built above
```

`loopInput` is a plain object built once, above the shadow call, and passed
by reference into `runAgentToolLoop` unchanged -- the shadow call has no
assignment target on it at all, structurally (not just by discipline)
guaranteeing it cannot mutate what the provider receives.

**Flag threading, not an env read inside the runtime**: `salesAgentRuntime.ts`
has zero `process.env`/`readEnvFlag` imports before this task and keeps zero
after it -- matching its own existing no-env-read discipline (every other
toggle, `governance`/`maxDecisions`/`timeoutMs`, is threaded in as an
explicit input). `persistentSessionShadowEnabled?: boolean` is a new
optional field on `SalesAgentRuntimeInput` (default `false` when omitted,
same pattern as `governance`), threaded unchanged through
`RunSalesAgentRuntimeCycleInput` (`runSalesAgentRuntimeCycle.ts`), read once
at `runNativeAutonomousCycle.ts` via the new
`buildPersistentSessionShadowFeatureFlags()` (reads
`BRAIN_R3_PERSISTENT_SESSION_SHADOW_ENABLED`, default `false`) inside the
`salesAgentRuntimeEnabled` branch that already exists there. This keeps the
byte-identical-provider-request test trivial: a test can flip the flag as a
plain boolean without touching `process.env` at all.

**No new allowlist**: `runNativeAutonomousCycle.ts`'s existing
`salesAgentRuntimeEnabled = shouldRouteToSalesAgentRuntime(input.waId)` gate
already scopes every real WhatsApp turn that could reach this shadow call to
`BRAIN_SALES_AGENT_RUNTIME_WA_IDS` -- a second allowlist for the shadow
itself would be redundant. A single boolean is enough, exactly as the task
brief's own "if D4 can safely run for all R3 test-mode traffic with
negligible impact, a single boolean may be enough" anticipated.

## 3. Legacy context baseline

Traced directly against `buildMinimalCommercialContextSummary`
(`runSalesAgentRuntimeCycle.ts`), the function that actually builds what
reaches `buildAgentStepPromptPackage.ts` as `commercialContext` in the
`user`-role JSON payload (both the gathering-phase and finalization-phase
call sites in `runAgentToolLoop.ts` reuse the same `input.commercialContextSummary`
unchanged, every iteration):

- **Source**: `snapshot.recentMessages` (`CommercialContextSnapshot`, built by
  `buildNativeCommercialContext.ts`) -- itself already bounded to
  `COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES = 12` (`constants.ts`) via a
  bounded SQL read.
- **Further reduction**: filtered to drop the current turn's own inbound
  message (`message.id === inboundMessageId`, or the last message if it is
  an inbound duplicate of `customerMessage`), then `.slice(-5)` -- so the
  legacy tail the model actually sees is **at most 5 messages**, both
  directions, sourced from an already-12-message window.
- **Ordering**: ascending (oldest first), same as the persistent side.
- **Direction representation**: `{ direction: "inbound" | "outbound", body }`
  -- no explicit `role` field, no provider-message shape; `buildAgentStepPromptPackage.ts`
  passes this object through `JSON.stringify` as-is inside the `user`
  message, never converts it to `system`/`user`/`assistant` roles.
- **Assistant messages present as raw data**: yes, `outbound` rows are
  included in `recentMessages` -- the legacy tail was never
  inbound-customer-only, contrary to what a first read of "recentMessages"
  might suggest. What is missing is history beyond the 5-message window and
  an explicit provider role, not assistant text itself.
- **`RecentCatalogContext` contribution**: none from this comparison --
  travels through its own `recentCatalogContext` field, both today and
  unchanged after this task. The shadow never reads or touches it.
- **`pendingCatalogAction` contribution**: none from this comparison --
  same discipline, its own dedicated field, entirely unrelated to the
  transcript-vs-session comparison this task makes.
- **Authoritative commercial context contribution**: none from this
  comparison -- `opportunityStatus`/`needProfile`/`shippingDestination`/
  `commercialLineItems` are separate keys on `commercialContextSummary`,
  always re-read fresh from SQL every turn (`buildNativeCommercialContext.ts`),
  never touched by `extractLegacyRecentMessagesForShadow` (which reads only
  the `recentMessages` key).

The shadow comparison therefore measures **conversation transcript
coverage** only (5-message legacy tail vs. the persistent bounded window,
default 20, hard cap 100) -- it makes no claim about, and never touches,
structured catalog/action continuity (`RecentCatalogContext`/
`pendingCatalogAction`) or authoritative commercial state.

## 4. Persistent-session shadow shape

New file, `lib/brain/commercial/agent-session/persistentSessionShadowComparison.ts`
-- pure, zero I/O, same discipline as D3's `deriveMessages.ts`:

```ts
type PersistentSessionShadowComparison = {
  legacy: { recentMessageCount; inboundCount; outboundCount };
  persistent: {
    historyMessageCount; userCount; assistantCount; toolActivityCount;
    bootstrapUsed; degraded;
  };
  comparison: {
    currentInboundExcluded;
    duplicateTranscriptMessageCount;
    persistentOlderMessageCount;
    persistentAdditionalAssistantCount;
  };
};
```

No `activeTopic`/`currentIntent`/`conversationStage`/`nextStep`/confidence
score anywhere -- checked directly against the real returned object's own
keys by `[D4-G14]`, not just documented as an intention.

`extractLegacyRecentMessagesForShadow(commercialContextSummary)` reads the
untyped `Record<string, unknown>` defensively (matches D3's own
`DEGRADE_TO_LEGACY_CONTEXT` discipline applied to the legacy side): a
missing or malformed `recentMessages` field degrades to `[]`, never throws.

New I/O orchestrator, `lib/brain/commercial/agent-session/runPersistentSessionShadow.ts`
-- `runPersistentSessionShadowComparison()`: times the read, times the
derive, computes the comparison, emits one `commercial_event`
(`persistent_session_shadow_compared`), and returns `{ warning: string | null }`.
The entire body is one `try`/`catch` -- nothing above this function can
ever see a thrown exception (Section O, see 10 below).

## 5. Real incident characterization

Fixture (`[D4-H1]`, `tests/commercial/runPersistentSessionShadow.test.ts`,
real MariaDB `crm_test`): the exact sequence the task brief names --

1. "necesito una barra olimpica de 20kg para home gym" (inbound)
2. "tenemos la barra olimpica 20kg disponible para home gym" (outbound)
3. "me puedes dar varias opciones para home gym" (inbound, current turn)

Legacy tail was deliberately narrowed for this test to just the assistant's
own reply (`legacyRecentMessages: [{ direction: "outbound", body: "tenemos..." }]`)
-- a legitimate, realistic scenario for a legacy tail that has already
evicted the customer's own opening line under real conversation volume.
Result, read from the real persisted `commercial_event` row:

- `persistentHistoryMessageCount: 2` -- both the customer's original request
  and the assistant's reply are present.
- `currentInboundExcluded: true` -- turn 3's own message never appears in
  history.
- `persistentOlderMessageCount: 1` -- the customer's own "barra olimpica
  20kg" request is evidence the persistent session recovers beyond what the
  narrowed legacy tail carried at all.

This proves the evidence required to reason about "varias opciones" being
about barbells is present in a proper historical sequence -- it does not,
and cannot, assert what the model would infer from it (Section H's own
instruction).

## 6. Continuity benchmark

`tests/commercial/persistentSessionShadowComparison.test.ts` -- pure,
no-DB, built on real `deriveConversationMessages()` output (D3, unchanged)
over synthetic transcripts shaped like each named scenario:

| ID | Scenario | Result |
|---|---|---|
| C01 | carry-forward (barra 20kg -> "varias opciones") | both turns present, in order |
| C02 | topic switch (barra -> colchoneta) | both topics present, nothing dropped |
| C03 | topic return (barra -> colchoneta -> "volvamos a la barra") | original barra exchange survives, no active-topic filtering |
| C04 | ordinal ("la segunda") | full offered-option list stays in history |
| C05 | superseding (20kg -> "mejor 15kg") | both the original and the correction remain, never collapsed |
| C06 | shipping correction (San Bernardo -> "finalmente Maipu") | both destinations remain |
| C07 | stale historical truth | history is opaque content -- comparison type has no price/amount field to compare against (see section 8) |
| C08 | missing session events | real MariaDB (`[D4-C08]`): zero `agent_session_events`, real `conversation_message` transcript -- `bootstrapUsed: true`, 2 real history messages |
| C09 | old conversation, no session events | same as C08's structural shape, pure variant |
| C10 | read failure | real MariaDB (`[D4-F1]`): a throwing `loadSessionForConversation` degrades the event, never throws, real turn unaffected -- see section 10 |
| C11 | correction after several turns (color negro -> mancuernas -> "mejor rojo" -> "y sobre las mancuernas?") | every intervening turn survives |
| C12 | lateral question (comparison -> shipping question -> return) | both threads remain, in real order |

25 tests total across both new test files touch these 12 scenarios plus the
G1-G14 structural gates directly.

## 7. Topic switch/return findings

`[D4-C02]`/`[D4-C03]` prove the invariant directly: `deriveConversationMessages()`
(D3, unchanged) is a pure, order-preserving projection over the bounded
transcript window -- it has no concept of "current topic" to filter by. A
later topic never causes an earlier one to be dropped; a return to an
earlier topic requires no special handling because nothing was ever removed.
`[D4-G14]` additionally asserts, directly against the real returned object's
keys, that no `activeTopic`/`currentTopic`/`selectedConversationTopic`-shaped
field exists anywhere in `PersistentSessionShadowComparison`.

## 8. Stale-truth separation

Verified structurally, not by parsing content (Section J: "do not parse
prices from historical text to compare them automatically"):

- `PersistentSessionShadowComparison.persistent` carries exactly six fields
  -- `historyMessageCount`/`userCount`/`assistantCount`/`toolActivityCount`/
  `bootstrapUsed`/`degraded` (`[D4-C07]` asserts this key set directly,
  `Object.keys(...).sort()`) -- there is no price/stock/shipping-shaped field
  for a fresh catalog value to ever be compared against.
- `runPersistentSessionShadowComparison` never imports the authoritative
  commercial context loader (`buildNativeCommercialContext.ts`), any
  Capability Gateway module, or any catalog/pricing module -- confirmed by
  reading the file's own imports, mirroring D3's own "structurally
  impossible, not just avoided by discipline" claim for `loadPersistentSessionContext.ts`.
  The fresh, authoritative price/stock/shipping context this turn actually
  uses still comes exclusively from `buildNativeCommercialContext.ts` via
  `commercialContextSummary`'s other keys (section 3 above), completely
  outside this task's diff.
- `[D4-C07]` additionally feeds a message containing a literal price string
  (`"cuesta $29.990"`) through the real comparison and confirms it is
  treated as opaque content -- no numeric extraction, no special branch.

## 9. Provider-request identity proof

`[D4-G11]`, `tests/commercial/salesAgentRuntime.test.ts` -- the critical D4
regression (Section P): calls `runSalesAgentRuntime()` twice for the same
deterministic turn (same `conversationId`, same script, same customer
message), once with `persistentSessionShadowEnabled: false` and once with
`true`, through a recording provider wrapper that captures the exact
`AgentLoopProviderRequest` the real provider receives. `assert.deepEqual`
(deep structural equality, not merely `===`) confirms
`sinkOn[0].messages` equals `sinkOff[0].messages` byte-for-byte in
structure. This is possible only because the shadow call has no assignment
path into `loopInput` at all -- proven by the wiring itself (section 2), and
now proven by execution too.

## 10. Failure-isolation proof

Three independent failure classes, all verified against real MariaDB or a
real injected failure, never simulated by mocking the assertion itself:

- **Session-store read failure** (`[D4-F1]`, `runPersistentSessionShadow.test.ts`):
  a store whose `loadSessionForConversation` throws. `loadPersistentSessionContext`
  (D3, unchanged) already degrades this internally to a typed
  `{ ok: false, degraded: true }` result -- it never reaches
  `runPersistentSessionShadowComparison`'s own outer `catch`. The shadow
  event is still emitted, with `degraded: true` and zero history counts --
  observability preserved even on failure, per Section R's "emit
  non-sensitive diagnostics" even in the degraded case.
- **Missing dedupe key** (`[D4-F2]`): an empty/whitespace `inboundMessageId`
  makes `normalizePersistentSessionShadowComparedEvent` throw
  (`commercial_event_missing_dedupe_key`, the same guard every other event
  normalizer in this file already has) -- caught by the orchestrator's outer
  `try`/`catch`, surfaced as a `persistent_session_shadow_failed:` warning,
  never propagated.
- **End-to-end at the runtime boundary** (`[D4-G10]`, `salesAgentRuntime.test.ts`):
  a shadow-read-failing session store (only `loadSessionForConversation`
  throws; `ensureSession`/`appendEvent` still succeed via a real in-memory
  backing, isolating this from D2's own write-side warnings) is passed with
  the shadow enabled. The turn's `status`/`responseText` are identical to a
  non-shadow baseline run, and the provider request is still byte-identical
  (reuses the same recording-provider technique as `[D4-G11]`).

No shadow exception reaches the customer path in any of the three cases --
verified by execution, not by code review alone.

## 11. Latency characterization

`[D4-L1]`/`[D4-L2]`, real MariaDB `crm_test`. `runPersistentSessionShadowComparison`
times the read (`loadPersistentSessionContext`) and derive
(`deriveMessages`) phases separately with `Date.now()`, persisting
`readMs`/`deriveMs`/`shadowTotalMs` (`= readMs + deriveMs`, asserted
directly) on the emitted `commercial_event`.

`[D4-L2]` ran 20 controlled iterations against a warmed connection pool and
a real 6-message seeded transcript, reading the persisted timings back from
`commercial_event` for each iteration (never in-process timers alone):

```
median readMs=7   median deriveMs=0   median shadowTotalMs=7   (n=20)
```

No arbitrary SLA is asserted (no existing R3 latency budget exists to
compare against, per the task brief's own instruction) -- the only real
assertions are `medianTotal < 500ms` (an order-of-magnitude margin, not a
tight bound) and `medianDerive <= medianRead + 5` (derive is pure/in-memory
and must never dominate the DB read). At a measured ~7ms median, the shadow
read is roughly three orders of magnitude below a real DeepSeek call
(multi-second, per every prior R3 doc's own live-call evidence) -- not a
material fraction of total turn latency. This is a real, executed
measurement from this task, not an estimate.

## 12. Prefix-stability characterization

Not separately re-measured in D4: `deriveConversationMessages()`'s own
byte-stable-prefix property (`[D3-R]`, `tests/commercial/deriveMessages.test.ts`)
is D3's proven, unchanged responsibility -- this task's shadow never calls
`deriveMessages()` differently across turns (same bounded window, same
exclusion rule), so nothing in D4's diff could have altered that property.
Re-asserting it here would duplicate D3's own test, not add new evidence.
No claim of infinite append-only stability is made (D7 compaction does not
exist yet) -- the same honest scope D3 already documented.

## 13. Tests

| Group | File | Result |
|---|---|---|
| Pure comparison logic + continuity benchmark (C01-C07, C09, C11, C12 + G3/G4/G14) | `tests/commercial/persistentSessionShadowComparison.test.ts` (new) | **16/16 pass** |
| Real-MariaDB orchestrator: real incident (C08), failure isolation (C10), latency (x2) | `tests/commercial/runPersistentSessionShadow.test.ts` (new) | **6/6 pass** |
| Provider-request identity (G11) + failure isolation at the runtime boundary (G10) + flag-off no-op | `tests/commercial/salesAgentRuntime.test.ts` (+3 new tests) | **19/19 pass** (16 pre-existing + 3 new) |
| D3 regression (read side unchanged) | `deriveMessages.test.ts`, `loadPersistentSessionContext.test.ts`, `agentSessionStoreMariaDb.test.ts` | **32/32 pass** |
| Broader R3-adjacent regression (runSalesAgentRuntimeCycle, agent-session sanitizer/summary/write-wiring, commercial-events, agentToolLoopCompletedEventConfig, legacySalesConsultativeConfig, runNativeAutonomousCycle pilot isolation/Customer360/OptOut, conversationControl, runAgentToolLoop, httpAgentLoopProvider, buildAgentStepPromptPackage) | 14 files | **298/298 pass** |
| Full repo suite | `npm test` (all files) | **4127 tests, 4105 pass, 22 fail** -- all 22 confirmed pre-existing (see below) |

**New tests this task: 25 (16 + 6 + 3), all passing.**

**Pre-existing-failure confirmation**: the full-suite run's 22 failures span
identity/onboarding capabilities (`createCustomerCapability`,
`linkExternalIdentityCapability`, `customerSession`/`customerSessionPrivacy`,
`customerOnboardingPostPlanStage`), the A13 conversational-reliability
benchmark (already documented with known P1/P2 issues, see
`sales-agent-r2-a13-status` memory), `CommercialWork` parallel-execution
wall-clock timing (`CWPAR01/19`), and the same-millisecond MariaDB ordering
flake already independently confirmed by `V1.7`/`V1.8-A`/`V1.8-B`/`V1.8-D1`/
`V1.8-D2`/`V1.8-D3`. None touch any file this task changed. Verified by
`git stash`-ing this task's entire diff and re-running the 7 failing files
in isolation against baseline `develop`: the identical failures reproduced
(same assertion messages, same line numbers) with zero D4 code present.

Also run: `npx tsc --noEmit` (clean, zero errors), `npm run build` (clean,
full Next.js production build), `npm run lint` (ESLint CLI, 0 errors, 39
pre-existing warnings in files this task never touched).

**Local environment note** (not a code change, not committed): the local
dev/test MariaDB had 9 pending migrations (026-034, including 033/034 --
`agent_sessions`/compaction columns -- that D3/D4 depend on) blocked by
pre-existing `schema_migrations` checksum drift on migrations 001-025 (same
category already documented in `docs/operations/local-migration-checksum-drift-009-010.md`
for 009/010) and two migrations (027/028) whose DDL was already applied
out-of-band without a bookkeeping row. Both were local-only, non-destructive
fixes (checksum rebaseline to current file content; bookkeeping backfill for
already-applied DDL, no DDL re-run), explicitly approved by the user before
execution, matching the documented precedent's own "existing local
databases with old metadata: rebaseline outside the runtime path" guidance.
No migration file or product code was touched.

## 14. Files changed

New (production):
- `lib/brain/commercial/agent-session/persistentSessionShadowComparison.ts`
  -- pure comparison type + `buildPersistentSessionShadowComparison()` +
  `extractLegacyRecentMessagesForShadow()` (sections 4/6/7/8).
- `lib/brain/commercial/agent-session/runPersistentSessionShadow.ts` -- the
  one I/O orchestrator, `runPersistentSessionShadowComparison()` (sections
  4/10).

New (tests):
- `tests/commercial/persistentSessionShadowComparison.test.ts` (16 tests).
- `tests/commercial/runPersistentSessionShadow.test.ts` (6 tests).

Modified (production):
- `lib/brain/commercial/agent-session/index.ts` -- barrel exports for the
  two new modules.
- `lib/brain/commercial/config/commercialCycleConfig.ts` --
  `buildPersistentSessionShadowFeatureFlags()` (section 2).
- `lib/brain/commercial/events/types.ts` --
  `"persistent_session_shadow_compared"` added to `CommercialEventType`;
  `PersistentSessionShadowComparedPayload` type.
- `lib/brain/commercial/events/dedupe.ts` --
  `buildPersistentSessionShadowComparedDedupeKey()`.
- `lib/brain/commercial/events/normalize.ts` --
  `normalizePersistentSessionShadowComparedEvent()`.
- `lib/brain/commercial/events/service.ts` --
  `recordPersistentSessionShadowComparedEvent()`.
- `lib/brain/commercial/sales-agent-runtime/salesAgentRuntime.ts` -- the
  shadow call site (section 2) + `persistentSessionShadowEnabled` input
  field.
- `lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts` --
  threads `persistentSessionShadowEnabled` unchanged into `runSalesAgentRuntime`.
- `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts` -- reads
  the flag once via `buildPersistentSessionShadowFeatureFlags()`, passes it
  into the existing `runSalesAgentRuntimeCycle` call.

Modified (tests):
- `tests/commercial/salesAgentRuntime.test.ts` -- 3 new tests (`[D4-G11]`,
  `[D4-G10]`, `[D4-flag]`), zero existing tests changed.

New (docs):
- `docs/releases/SALES-AGENT-R3-V1.8-D4-PERSISTENT-SESSION-SHADOW-INTEGRATION.md`
  (this file).

Modified (docs):
- `docs/ACTIVE_RELEASE.md` -- this task's entry under the `SALES-AGENT-R3`
  workstream.

**Not modified**: `buildAgentStepPromptPackage.ts`, `runAgentToolLoop.ts`'s
own message-construction/tool-loop logic, `deriveMessages.ts`,
`loadPersistentSessionContext.ts`, `conversationTranscriptReader.ts`,
`shadowRecorder.ts`, `appendWithRetry.ts`, `defaultStore.ts`,
`dispatchSalesAgentResponse.ts`/`dispatchSalesAgentFallback.ts`/
`dispatchSalesAgentHardHandoff.ts`, Capability Gateway (any file), any
migration, `recentMessages` (`buildNativeCommercialContext.ts`),
`control.ts`, `httpAgentLoopProvider.ts`, `agentLoopProviderTypes.ts`.

## 15. D5 readiness

**`READY_FOR_D5_OWNER_ONLY`**

D4's own gates (G1-G14) are all satisfied with real evidence, and D5's
prerequisites are now in place: a proven-safe shadow read/derive/compare
pipeline, a real incident replay proving evidence recovery, a continuity
benchmark proving no information loss across every named scenario, a proven
byte-identical-request guarantee to build the flag-gated cutover from, and
real latency numbers (~7ms median) showing the read/derive cost is
negligible next to a real model call.

D5 is restricted to exactly what the task brief's own Section U specifies,
nothing broader:

- Full provider-message assembly (`assembleAgentProviderMessages()` or
  equivalent) that actually decides how `deriveMessages()`'s output composes
  with `buildAgentStepPromptPackage.ts`'s existing system-instruction/
  identity/fresh-context/current-turn slots -- not built by D4, deliberately
  (would duplicate system-prompt logic to satisfy this task's own shadow-only
  scope).
- A dedicated feature flag + owner/WA allowlist for live routing (distinct
  from D4's shadow flag -- D5 changes what the model sees, D4 never did).
- The actual session-derived context reaching the DeepSeek request.
- A fallback-to-legacy path on a read failure at the point session context
  actually feeds the request (D4's own failure isolation only had to prove
  the shadow never leaks into the real turn -- it never needed a fallback,
  since it never fed anything real to begin with).
- A real continuity benchmark run against the real provider (D4's C01-C12
  are structural/derive-level evidence; D5 needs the equivalent run through
  an actual model to observe real behavior).
- Real cache metrics (`cacheReadTokens`/`cacheMissTokens`, already available
  on `AgentLoopProviderResponse` since D1) once the persistent-session prefix
  is genuinely sent to the provider -- D4 explicitly does not claim any
  cache-hit improvement (section 12), only structural prefix stability
  inherited unchanged from D3.

D5 is explicitly **not** authorized to touch: `AgentSessionStore`'s schema,
`deriveMessages()`'s projection logic, `loadPersistentSessionContext()`'s
read/lock contract, or any of D1-D3's foundation -- all of that is proven
correct by this task and D3's own evidence, not something D5 needs to
redesign.

## 16. Remaining debt

- **No formal per-turn cutover design**: D4 deliberately does not decide
  *how* `deriveMessages()`'s historical prefix would replace or augment
  `commercialContextSummary.recentMessages` inside
  `buildAgentStepPromptPackage.ts` -- that is D5's own first job, per
  Section U, not pre-empted here.
- **`outboundMessagePublicId` still permanently `null`** -- D2's own
  documented, unrelated deferred item; D3 never depended on it, and neither
  does D4 (the shadow comparison never reads it).
- **D7 compaction** still unimplemented -- `compactedPrefix` continues to be
  read-only and always `null` in every real session today, exactly as D3
  left it.
- **`"tool"` provider role** still not added -- no new evidence from this
  task changes D3's own "revisit only if a real need emerges" conclusion.
- **Latency characterization is a single-environment sample** (local
  MariaDB, warm pool, 20 iterations) -- real production-scale numbers
  (concurrent turns, network latency to a real deployed DB) are not
  measured here; the ~7ms median is a strong signal the overhead is
  negligible, not a formal SLO.

## Verdict

**`R3_V1_8_D4_PERSISTENT_SESSION_SHADOW_VALIDATED`**

- Shadow wiring: `salesAgentRuntime.ts`, immediately before
  `runAgentToolLoop(loopInput)`, gated by `persistentSessionShadowEnabled`
  (threaded, never an env read inside the runtime), fail-closed default
  `false`, no separate allowlist needed.
- Legacy baseline: `commercialContextSummary.recentMessages`, a 5-message
  tail derived from a 12-message bounded snapshot -- documented exactly,
  including what it does and does not carry (assistant text: yes; more than
  5 turns: no; catalog/action continuity: never, lives elsewhere).
- Real incident (barra 20kg): both prior turns recovered by the persistent
  session, proven against real MariaDB, `currentInboundExcluded: true`.
- Continuity benchmark: all 12 named scenarios (C01-C12) hold, proven with
  real `deriveConversationMessages()` output plus one real-DB fixture (C08)
  and one real-DB failure fixture (C10).
- Stale-truth separation: structural, not content-parsing -- the comparison
  type has no price/amount field, and the module has zero import of any
  authoritative commercial context/catalog/pricing code.
- Provider-request identity: byte-for-byte deep-equal with the shadow off
  vs. on, for the same deterministic turn, proven by execution.
- Failure isolation: three independent failure classes (store read failure,
  missing dedupe key, end-to-end at the runtime boundary), all degrade to a
  warning or a silently-degraded event, never a thrown exception, never an
  altered outcome.
- Latency: ~7ms median read+derive overhead over 20 real-MariaDB
  iterations, three orders of magnitude below a real LLM call.
- Tests: 25 new (all passing), 32/32 D3 regression, 298/298 broader R3
  regression, 4105/4127 full repo suite (22 pre-existing failures confirmed
  unrelated via `git stash` baseline comparison). `npx tsc --noEmit`,
  `npm run build`, `npm run lint` all clean.
- Zero customer-visible behavior change; zero production call site feeds
  session-derived context into the real provider request yet. Next
  actionable item is `D5`.

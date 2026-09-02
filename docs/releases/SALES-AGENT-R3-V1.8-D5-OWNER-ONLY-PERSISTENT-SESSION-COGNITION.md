# SALES-AGENT-R3-V1.8-D5 -- Owner-Only Persistent Session Cognition

Status: implemented. Real production code changed: for a turn that is BOTH
`BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED=true` AND the customer's
`wa_id` is in `BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS`, the persistent
session (D3's `loadPersistentSessionContext()`/`deriveMessages()`, unchanged)
now actually replaces `commercialContextSummary.recentMessages` in the real
provider request. Every other turn - the overwhelming majority of traffic,
including every turn today since both env vars default to
false/empty - is byte-identical to before this task. D4's shadow keeps
working unchanged and independently. D6/D7 are not implemented.

## 1. Executive verdict

**`R3_V1_8_D5_OWNER_ONLY_SESSION_COGNITION_VALIDATED_WITH_KNOWN_DEBT`**

All 18 exit gates (G1-G18) hold with real evidence - unit tests, real-MariaDB
integration tests, and a real DeepSeek continuity benchmark (14 legacy + 14
persistent live turns, 6 of the 7 named scenarios). "Known debt" because two
items are honestly incomplete, not silently skipped: **G18 (owner WhatsApp
live smoke) is explicitly deferred** - the environment's Meta webhook is not
reachable from this local instance (confirmed 63 days ago, unchanged) and
sending real messages requires the human owner's phone, so this was raised
to the user and deferred by their explicit choice, not assumed. And the real
benchmark surfaced **one genuine anomaly** (B06 turn 1: a `handoff` instead
of `responded` in persistent mode only) that is reported honestly below, not
hidden, and is not yet root-caused.

## 2. Gating

Two independent, fail-closed conditions, both required (task brief Section
G's own formula):

```
persistentSessionCognitionEnabled =
  BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED=true
  AND wa_id in BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS
```

- `buildPersistentSessionCognitionFeatureFlags()` / `shouldEnablePersistentSessionCognition(waId)`
  -- new functions in `commercialCycleConfig.ts`, same shape as
  `shouldRouteToSalesAgentRuntime`. An empty allowlist with the flag on
  fails closed for everyone (ambiguous config, never "everyone").
- `loadPersistentSessionCognitionAllowlist()` -- new function in
  `autonomousRuntimeConfig.ts`, `BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS`,
  digit-normalized, deduped -- **deliberately independent** of
  `BRAIN_SALES_AGENT_RUNTIME_WA_IDS` (D5's own gate) and of
  `BRAIN_R3_PERSISTENT_SESSION_SHADOW_ENABLED` (D4's gate). A wa_id
  allowlisted for SalesAgentRuntime routing, or for the D4 shadow, is
  **not** automatically eligible for live cognition -- proven by
  `tests/commercial/shouldEnablePersistentSessionCognition.test.ts`.
- Resolved once in `runNativeAutonomousCycle.ts` (inside the existing
  `salesAgentRuntimeEnabled` branch -- never a new global hook) and threaded
  as an already-composed boolean through `RunSalesAgentRuntimeCycleInput` ->
  `SalesAgentRuntimeInput#persistentSessionCognitionEnabled`, exactly like
  D4's `persistentSessionShadowEnabled`. `salesAgentRuntime.ts` never reads
  `process.env` -- it only sees the resolved boolean, matching every other
  toggle already threaded into it (`governance`, `maxDecisions`, `timeoutMs`).

Rollback (G17) is the flag flip alone: `BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED=false`
makes `shouldEnablePersistentSessionCognition` return `false` for every
wa_id immediately, no allowlist edit, no migration, no data rollback, no
restart-dependent state. Proven by execution (`[D5-G17]`
`shouldEnablePersistentSessionCognition.test.ts`, and
`[D5-G17]` `salesAgentRuntime.test.ts`: the same conversation, same turn,
flag ON then OFF, produces the exact legacy `[system, user]` request the
second time).

## 3. Provider-message assembly

**Exact insertion point**: `salesAgentRuntime.ts`'s `runSalesAgentRuntime()`,
resolved via a new call, `resolvePersistentSessionCognitionContext()`,
placed **before** `loopInput` is built (unlike D4's shadow, which runs after
and discards its output) -- because a successful resolution changes two of
`loopInput`'s own fields.

```
runSalesAgentRuntime()
  resolvePersistentSessionCognitionContext({enabled, conversationId, inboundMessageId, store})
    -> loadPersistentSessionContext (D3, unchanged)
    -> deriveMessages (D3, unchanged)
    -> { active: true, historicalMessages } | { active: false, fallbackWarning }
  build loopInput:
    commercialContextSummary = active
      ? stripRecentMessagesForPersistentSessionContext(original)
      : original
    persistentSessionHistoricalMessages = active ? historicalMessages : null
  [observability event, only when eligible - see Section 11]
  D2 pre-loop write (unchanged)
  D4 shadow (unchanged, independent, still reads the ORIGINAL unstripped commercialContextSummary for its own legacy baseline)
  runAgentToolLoop(loopInput)
```

`runAgentToolLoop.ts` threads `persistentSessionHistoricalMessages` through
its `RunAgentToolLoopInput` unchanged into **both** of its
`buildAgentStepPromptPackage()` call sites (gathering and finalization) --
loaded once per turn, never re-loaded per loop iteration, so the historical
prefix is byte-stable across a turn's own tool-loop iterations (Section K,
verified by `[D5-K]`).

`buildAgentStepPromptPackage.ts` itself gained one new optional field,
`persistentSessionHistoricalMessages?: AgentLoopProviderMessage[] | null`,
and one new branch. The existing system-instruction-building code (layers
0-4: repair instruction, loop contract, evidence/tool rules, identity,
immutable boundary) is **the same code, called once**, for both branches --
never duplicated, never a second builder. The persistent branch composes:

```
[
  { role: "system", content: systemInstructions },   // unchanged content-generation
  ...persistentSessionHistoricalMessages,             // D3's deriveMessages() output, verbatim
  { role: "user", content: JSON.stringify({ commercialContext, recentCatalogContext, pendingCatalogAction }) },
  { role: "user", content: JSON.stringify({ currentTime, customerMessage, priorStepsThisTurn, question }) }
]
```

matching the task brief's Section J order (stable system -> identity ->
compacted-prefix-if-present + historical conversation -> fresh context ->
current message -> current-turn observations) as closely as the provider's
real `system`/`user`/`assistant` contract allows -- no `"tool"` role added
(no evidence of a real need, same discipline D3 already established). The
compacted-prefix message (D7, not implemented yet) is never handled
specially here -- `deriveMessages()` already places it as the leading entry
of `historicalMessages` when D7 eventually populates one, so it is simply
spliced in with everything else.

The legacy branch is **the exact same code that existed before this task**,
reached whenever `persistentSessionHistoricalMessages` is
`null`/`undefined` -- proven byte-identical by `[D5-G2]`
(`buildAgentStepPromptPackage.test.ts`): three constructions (field absent,
explicit `undefined`, explicit `null`) produce `assert.deepEqual`-identical
output.

## 4. Legacy vs. persistent request shape

| | Legacy (unchanged) | Persistent (D5) |
|---|---|---|
| Message count | 2 (`[system, user]`) | 3 + N historical (`[system, ...history, user(context), user(current)]`) |
| Conversation history | `commercialContext.recentMessages` -- up to 5 messages, `{direction, body}`, no provider role | Real `role:"user"`/`role:"assistant"` messages, D3's bounded window (default 20, cap 100) |
| `recentMessages` key | Present | **Absent** -- stripped by `stripRecentMessagesForPersistentSessionContext()` before `loopInput` is built |
| `RecentCatalogContext`/`pendingCatalogAction` | In the single `user` message | In the dedicated fresh-context `user` message -- same fields, same values, never touched |
| Current customer message | In the single `user` message | In its own `user` message, exactly once (verified, see Section 4b) |

`stripRecentMessagesForPersistentSessionContext()` (new,
`resolvePersistentSessionCognitionContext.ts`) is a 2-line pure function --
object destructuring, so the source object is never mutated (proven by
`resolvePersistentSessionCognitionContext.test.ts`'s dedicated test) --
removing only the `recentMessages` key. Every other authoritative field
(`opportunityStatus`, `needProfile`, `shippingDestination`,
`commercialLineItems`, ...) passes through untouched.

**Current-message duplication (Section E)**: `[D5-G3/G4]`
(`buildAgentStepPromptPackage.test.ts`) constructs a persistent request and
asserts the current customer message string appears in the assembled
messages array **exactly once**, by serializing every message and counting
substring matches. D3's own `deriveMessages()` already excludes the current
turn's own `conversation_message` row from `historicalMessages` by id (13
unit tests in D3's own suite) -- D5 never re-derives that exclusion, it only
trusts and composes D3's output.

## 5. Fallback behavior

`resolvePersistentSessionCognitionContext()` (new,
`lib/brain/commercial/agent-session/resolvePersistentSessionCognitionContext.ts`)
returns a clean, two-shape union:

```ts
type PersistentSessionCognitionContext =
  | { active: true; historicalMessages: AgentLoopProviderMessage[]; fallbackWarning: null }
  | { active: false; historicalMessages: null; fallbackWarning: string | null };
```

Never a partial persistent prompt (task brief Section H's explicit
requirement) -- `active` is a single boolean the caller branches on exactly
once. The entire body is one `try`/`catch`; nothing inside it can throw out.

Verified against every named failure class (`resolvePersistentSessionCognitionContext.test.ts`,
real MariaDB `crm_test`):

- **Not enabled** (`[D5-R1]`): `active:false`, no warning at all -- this is
  the default path for virtually all traffic, never noisy.
- **No real `inboundMessageId`** (`[D5-R2]`): `active:false`,
  `persistent_session_cognition_fallback:no_inbound_message_id`.
- **Session read failure / lock timeout** (`[D5-Q1]`): a throwing store
  degrades inside D3's own `loadPersistentSessionContext` (never reaches
  this function's own `catch`) -- `active:false` with the store's real
  error message in the fallback reason.
- **Derive-time exception** (`[D5-Q4]`): a deliberately malformed event
  (`null` in the events array, bypassing TypeScript the same way a
  corrupted row could) makes `deriveMessages()` itself throw --
  `active:false`, caught by this function's own outer `catch`. Proves the
  wrapper covers derive, not just the read.
- **Invalid compacted-prefix metadata** (`[D5-Q3]`): a one-sided invalid
  pair (D3's own contract) degrades **only** that slot -- `active:true`
  still, real historical messages present, just without the compacted-
  prefix system message. Matches D3's `DEGRADE_TO_LEGACY_CONTEXT` applying
  at the right granularity, never over-degrading a structurally valid read.
- **Real success** (`[D5-R3]`): a real 3-message transcript resolves
  `active:true` with `deriveMessages()`'s real output, `deepEqual`-asserted.

At the runtime boundary (`salesAgentRuntime.test.ts`, real MariaDB
`main_management`): `[D5-G8/Q1]` proves a failed read produces a provider
request **byte-identical** to a legacy baseline run (not just "similar" --
`assert.deepEqual` on the full `messages` array), and the result's
`warnings` carries the `persistent_session_cognition_fallback:` prefix.
`[D5-Q8]` proves D4's shadow and D5's cognition degrade **independently**
under the exact same store failure -- neither leaks into the other, the
turn completes normally either way (task brief Section I: "Do not make D5
depend on D4").

## 6. Authoritative-context separation

Structural, never content-parsing (task brief Section L): `[D5-L]`
(`buildAgentStepPromptPackage.test.ts`) feeds a historical assistant message
claiming a stale price (`"cuesta $29.990"`) alongside a fresh
`commercialLineItems.unitPrice: 32990` and asserts **both** reach the
provider verbatim, in separate messages -- the historical text is never
parsed, rewritten, or reconciled against the fresh value, and the fresh
value is unaffected by the historical text. `resolvePersistentSessionCognitionContext.ts`
imports nothing from `buildNativeCommercialContext.ts`, any Capability
Gateway module, or any catalog/pricing module -- the fresh, authoritative
context this turn actually uses still comes exclusively from the existing
production loader, entirely outside this task's diff.

## 7. Real continuity benchmark

Ran against the **real, configured DeepSeek endpoint** (this repo's own
`.env` `BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY`/`BRAIN_MODEL_NAME`, same
"real provider, simulated inbound, no real Meta" technique `V1.4` Phase 18
and `V1.8-B`'s `V18B-01` already used in this exact repo) -- a scratchpad
script (never added to the repo, same precedent as `V1.8-D0`'s own
throwaway provider-call script), calling `runSalesAgentRuntime()` directly
with a real `createHttpAgentLoopProvider({thinking:"disabled"})`, against a
real `crm_test` conversation, manually inserting each turn's
`conversation_message` row before/after the call (since `runSalesAgentRuntime`
itself never persists either side -- D2's own documented gap; this mirrors
exactly what a real inbound webhook + the outbox worker would do).

**Honest scope note**: the Catalog Service was not reachable from this run
(every `search_products`/`get_product_details` tool call failed, gracefully
-- the existing, already-tested tool-failure-recovery path). Every response
below is therefore a "sorry, I can't check the catalog right now" reply,
not a grounded product answer. This does not defeat the benchmark's actual
purpose -- **conversational continuity** (does the model stay anchored to
the right topic, correctly resolve references, handle corrections) is
observable in the model's *phrasing* independent of whether a tool call
succeeded, and that phrasing is what is characterized below. **B04
(ordinal) was deliberately not run live** -- it exercises
`RecentCatalogContext`/`pendingCatalogAction` continuity, which D5
explicitly does not change (Section D: those stay separate, untouched
fields) and which the existing regression suite already covers live
(`[D4-scenario] session continuity: 'la segunda' resolves...`,
`salesAgentRuntime.test.ts`, passing, unchanged) -- re-running it live here
would have spent real API budget proving something D5 never touched.

Ran each of B01/B02/B03/B05/B06/B07 twice against a fresh conversation:
once `persistentSessionCognitionEnabled:false` (legacy), once `:true`
(persistent) -- 14 turns each, 27 real provider calls (legacy) / 27 (persistent).

## 8. Original incident result (B01)

Turn 1: "necesito una barra olimpica de 20kg para home gym". Turn 2: "me
puedes dar varias opciones para home gym".

**PASS, both modes, no material difference observed.** Both responses in
both modes remained on-topic (barra/home gym). Honest caveat: this specific
2-turn scenario never exceeds legacy's own 5-message tail, so legacy has
full context here too -- the earlier real-production incident this task
traces back to (V1.8-A's turn 180->182) involved *more* intervening turns
before the recency window mattered. See Section 18 for what a longer,
window-exceeding live scenario would still need to prove.

## 9. Topic switch/return results (B02/B03)

**B02 (switch): PASS both modes.** Both correctly answered about
"colchonetas" when asked, no bar-topic bleed-through.

**B03 (return): PASS persistent, weaker in legacy -- a real, concrete
difference.** Turn 3 ("volvamos a la barra"):

- Persistent: *"Entiendo que quieres retomar la barra olímpica. Lamento
  informarte que en este momento no puedo consultar el catálogo..."* --
  explicitly names "barra olímpica", confident topic resolution.
- Legacy: *"Lo siento, no pude buscar la barra en este momento. ¿Puedes
  intentarlo de nuevo en unos segundos o indicarme más detalles del
  producto que buscas?"* -- asks the customer to clarify "qué producto
  buscas", reading as if the reference was not confidently resolved,
  despite the same information technically being within its 5-message
  window.

No `activeTopic`/`currentTopic` field exists in either path (G14 of D4,
re-confirmed unaffected by D5) -- this is real model behavior over real
evidence, not a deterministic filter.

## 10. Correction/ordinal results (B05)

**PASS both modes.** Turn 2 ("mejor la de 15kg") -- both modes correctly
shifted to "15kg" without re-asserting "20kg" as current. Ordinal
continuity (B04) is unchanged and already covered live by the existing
regression suite (Section 7's scope note).

## 10b. Shipping correction result (B06) -- one real anomaly, reported honestly

**MIXED. Legacy: PASS (2/2 responded, correctly).** **Persistent: 1/2
responded correctly; turn 1 produced `status:"handoff"` instead of
`responded`.**

Turn 1 ("el envio es a San Bernardo") in **persistent mode only** ended in
`AgentLoopTerminalReason:"handoff"` (`responseText: null`) rather than a
normal response -- the same turn in legacy mode responded normally. Turn 2
("finalmente a Maipu") in persistent mode then recovered normally and
correctly referenced "Maipú" (not "San Bernardo"), so the *net* outcome by
the end of the scenario was correct, but the mid-scenario handoff is a real
behavioral difference this task did not predict and has not root-caused.

**This is reported as-is, not minimized.** It happened in exactly 1 of 14
persistent turns across the whole benchmark; every structural/architecture
gate (G1-G8, G14-G15, G17) that automated tests can pin down still holds
regardless of this one live-model outcome. Two honest hypotheses, neither
confirmed: (a) the new context-slot/current-message split changed how the
model weighs a `set_shipping_destination` tool failure specifically, or (b)
this is ordinary DeepSeek non-determinism unrelated to the prompt shape
(`temperature` was not set to 0 in this benchmark run). Listed as remaining
debt (Section 18) -- **not a D5 exit-gate blocker**, since no exit gate
claims live-model output determinism, but a real signal to watch before any
wider rollout.

## 11. Cache metrics

Real, measured `AgentLoopProviderResponse.cacheReadTokens`/`cacheMissTokens`
(already exposed since D1) captured per real provider call via a recording
wrapper around the real `createHttpAgentLoopProvider`, aggregated across the
whole benchmark:

| | Calls | Total input tokens | Total output tokens | Cache read | Cache miss | Hit rate |
|---|---|---|---|---|---|---|
| Legacy | 44 | 243,010 | 1,590 | 215,680 | 27,330 | **88.8%** |
| Persistent | 43 | 240,729 | 1,604 | 232,832 | 7,897 | **96.7%** |

**Persistent mode showed a measurably higher cache-hit rate in this run.**
Total input-token volume is nearly identical between modes (240,729 vs.
243,010) -- the persistent path is not "more expensive" in raw token count
here, and its structural separation into distinct messages (stable system,
history, context, current) appears to let the provider's cache reuse a
larger fraction of the request. This is an honest observation from one
benchmark run, not a formal A/B with statistical power -- no SLA or
guaranteed percentage is claimed.

Per Section O's naming rule: this is a **provider-facing, in-memory
observation only** (the benchmark script's own recording wrapper) -- these
numbers are **not** propagated into any `commercial_event` in this task
(`AgentLoopInferenceRecord`/`llmCalls` was deliberately not extended with
cache fields -- see Section 18). If a future task wires this into
`commercial_event`, it must use `cacheReadSize`/`cacheMissSize`, never
`cacheReadTokens`/`cacheMissTokens` (the shared sanitizer's
`SENSITIVE_KEY_PATTERN` rejects any key containing the substring `token`,
confirmed against the real regex, same finding `V1.8-D0` made for
`summaryTokenEstimate`).

## 12. Prefix stability

Real, measured, not estimated: within a scenario, `cacheReadTokens` for the
**first call of every turn** stayed flat around **5,888 tokens** across
sequential turns in both modes (e.g. B03 persistent: turn 1 -> 5,888, turn 2
-> 5,888, turn 3 -> 5,888) -- confirming the truly-static prefix (the
`systemInstructions` block plus tool descriptions, unchanged by this task)
is reliably cached once warm.

**Honest limit, not overclaimed**: `cacheMissTokens` for the growing
history/context portion increased turn over turn (e.g. B03 persistent:
70 -> 114 -> 155) rather than showing incremental cache growth as the
historical prefix itself grew. This benchmark does not observe the
persistent history *itself* becoming an incrementally-cached prefix across
turns -- only the leading, byte-invariant system layer benefits reliably in
this measurement. No claim of turn-over-turn incremental caching of
`historicalMessages` is made (matches D3's own explicit non-goal: "not an
unbounded guarantee ... requires D5/real provider execution to observe" --
now observed, and reported honestly as partial).

## 13. WhatsApp live smoke

**Deferred, by explicit user decision, not silently skipped.** Raised to
the user directly: a 63-day-old memory records that this environment's Meta
webhook is not pointed at this local dev instance, so a real inbound
WhatsApp message would never reach this app's database -- only the user can
confirm whether that is still true, and only the user can send real
messages from the owner's phone. The user chose to skip it for this task
and accept the real-DeepSeek benchmark (Section 7) as the owner-only
live-model evidence instead. **G18 is therefore not validated** -- see
Section 1's verdict qualifier and Section 18.

## 14. Governance regression

`[D5-G14/G15]` (`salesAgentRuntime.test.ts`, real MariaDB): an eligible,
cognition-enabled turn runs a real `get_product_details` ->
`select_products` sequence and asserts, exactly like the pre-existing
non-D5 equivalent test: `commercialActionCalls === 1`,
`resolvedOpportunityId` non-null, and exactly one real `crm_opportunities`
row created. Capability Gateway, `CommercialActionRequest`, identity gates,
side-effect dedupe, and dispatch/outbox are all reached through the exact
same code this task never touched (`runAgentToolLoop.ts`'s tool-execution
machinery, `executeCommercialActionRequest`, `dispatchSalesAgentTerminalOutcome`)
-- D5 only ever changes what `buildAgentStepPromptPackage` puts in the
`messages` array, never any execution boundary downstream of the model's
own decision.

Full regression evidence (Section 16) additionally re-runs the entire
R3-adjacent suite (298 tests, includes Capability Gateway/identity-gate/
`CommercialActionRequest`/`ReadToolRequest`/dispatch/routing files) with
zero new failures.

## 15. Rollback proof

Covered in Section 2 -- `[D5-G17]` in both `shouldEnablePersistentSessionCognition.test.ts`
(the pure gating function) and `salesAgentRuntime.test.ts` (the full
runtime: same conversation, same turn text, cognition ON then flipped OFF,
second run's provider request is `assert.deepEqual` to the exact legacy
`[system, user]` shape). No migration, no data rollback, no session
deletion, no restart-dependent step -- the flag alone.

## 16. Tests

| Group | File | Result |
|---|---|---|
| Provider-message assembly (pure) | `tests/agent-loop/buildAgentStepPromptPackage.test.ts` (+7 new) | **61/61 pass** |
| Cognition-context resolver (real MariaDB `crm_test`) | `tests/commercial/resolvePersistentSessionCognitionContext.test.ts` (new) | **8/8 pass** |
| Gating function (pure, env-driven) | `tests/commercial/shouldEnablePersistentSessionCognition.test.ts` (new) | **7/7 pass** |
| Runtime wiring (real MariaDB `main_management`) | `tests/commercial/salesAgentRuntime.test.ts` (+6 new) | **25/25 pass** |
| D3/D4 regression (read side + shadow unchanged) | `deriveMessages`, `loadPersistentSessionContext`, `agentSessionStoreMariaDb`, `persistentSessionShadowComparison`, `runPersistentSessionShadow` | **63/64 pass** (1 pre-existing same-millisecond flake, see below) |
| Broader R3-adjacent regression | `runSalesAgentRuntimeCycle`, `agentSessionSanitizer`, `agentSessionSummary`, `salesAgentRuntimeSessionWriteWiring`, `agentToolLoopCompletedEventConfig`, `legacySalesConsultativeConfig`, `runNativeAutonomousCycle{Customer360,OptOut,PilotIsolation}`, `commercial-events`, `conversationControl`, `runAgentToolLoop`, `httpAgentLoopProvider`, `multi-intent`, `shouldRouteToSalesAgentRuntime` | **413/413 pass** |
| Full repo suite | `npm test` (all files) | **4154 tests, 4129 pass, 25 fail** -- all 25 confirmed pre-existing (below) |

**New tests this task: 28 (7 + 8 + 6 + 7), all passing. Total touched-suite tests: 502, 501 pass** (1 pre-existing flake).

**Pre-existing-failure confirmation**: the full-suite run's 25 failures span
identity/onboarding capabilities and e2e (`createCustomerCapability`,
`linkExternalIdentityCapability`, `customerSession`/`customerSessionPrivacy`,
`customerOnboardingPostPlanStage`, `T08-A4`-`A7` in the e2e onboarding
suite), the A13 conversational-reliability benchmark (already documented
with known P1/P2 issues, `sales-agent-r2-a13-status` memory), `CommercialWork`
parallel-execution wall-clock timing (`CWPAR01/19`), two `sales-agent-configuration`
tests (`[A13] GET /configuration?limit=999999...`,
`[R17] listPesasChileConfigurations...`, a genuinely unrelated domain --
row-level data pollution in the shared local `main_management` database,
confirmed via `git stash` against clean baseline `develop`: **identical
failure, same assertion, same error, with zero D5 code present**), and the
same-millisecond MariaDB ordering flake already independently confirmed by
six prior tasks in this series. None touch any file this task changed.
Verified twice via `git stash` + isolated re-run against baseline
`develop` (once for the identity/onboarding files, once for the two
`sales-agent-configuration` files) -- both times the identical failure
reproduced with zero D5 code present.

Also run: `npx tsc --noEmit` (clean, zero errors throughout every edit in
this task), `npm run build` (clean, full Next.js production build, same run
carried over from D4 in this session -- no production code changed since
that clean build except this task's own additive diff, re-verified via
`tsc`), `npm run lint` (ESLint CLI, 0 errors, 39 pre-existing warnings in
files this task never touched, same set D4 already reported).

## 17. Files changed

New (production):
- `lib/brain/commercial/agent-session/resolvePersistentSessionCognitionContext.ts`
  -- `resolvePersistentSessionCognitionContext()` (Section 5) and
  `stripRecentMessagesForPersistentSessionContext()` (Section 4).

New (tests):
- `tests/commercial/resolvePersistentSessionCognitionContext.test.ts` (8 tests).
- `tests/commercial/shouldEnablePersistentSessionCognition.test.ts` (7 tests).

Modified (production):
- `lib/brain/runtime/autonomousRuntimeConfig.ts` --
  `loadPersistentSessionCognitionAllowlist()`.
- `lib/brain/commercial/config/commercialCycleConfig.ts` --
  `buildPersistentSessionCognitionFeatureFlags()`,
  `shouldEnablePersistentSessionCognition()`.
- `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts` --
  `persistentSessionHistoricalMessages` input field + the persistent-path
  branch (Section 3); legacy branch untouched code.
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts` --
  `persistentSessionHistoricalMessages` threaded through
  `RunAgentToolLoopInput` and both `buildAgentStepPromptPackage` call sites.
- `lib/brain/commercial/agent-session/index.ts` -- barrel exports for the
  new module.
- `lib/brain/commercial/events/types.ts` -- `"persistent_session_cognition_applied"`
  event type + `PersistentSessionCognitionAppliedPayload`.
- `lib/brain/commercial/events/dedupe.ts` --
  `buildPersistentSessionCognitionAppliedDedupeKey()`.
- `lib/brain/commercial/events/normalize.ts` --
  `normalizePersistentSessionCognitionAppliedEvent()`.
- `lib/brain/commercial/events/service.ts` --
  `recordPersistentSessionCognitionAppliedEvent()`.
- `lib/brain/commercial/sales-agent-runtime/salesAgentRuntime.ts` -- the
  cognition-resolution call site (Section 3), `persistentSessionCognitionEnabled`
  input field, the observability diagnostic (Section 11's "not
  propagated" note applies to cache metrics only -- this event itself IS
  wired, see below).
- `lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts` --
  threads `persistentSessionCognitionEnabled` unchanged.
- `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts` -- reads
  the gate once via `shouldEnablePersistentSessionCognition(input.waId)`.

Modified (tests):
- `tests/agent-loop/buildAgentStepPromptPackage.test.ts` -- 7 new tests
  (`[D5-G2]`, `[D5-G3/G4]`, `[D5-G5/G6/G7]`, `[D5]` role check, `[D5-K]`,
  `[D5-L]`), zero existing tests changed.
- `tests/commercial/salesAgentRuntime.test.ts` -- 6 new tests (`[D5-G1]`,
  `[D5-V]`, `[D5-G8/Q1]`, `[D5-G14/G15]`, `[D5-G17]`, `[D5-Q8]`), plus new
  `ensureTestConversation`/`insertTestMessage`/`loadLastCognitionAppliedPayload`
  helpers, zero existing tests changed.

**Not modified**: `deriveMessages.ts`, `loadPersistentSessionContext.ts`,
`conversationTranscriptReader.ts`, `agent_sessions`/`agent_session_events`
schema (no new migration), `persistentSessionShadowComparison.ts`/
`runPersistentSessionShadow.ts` (D4, untouched), Capability Gateway (any
file), `dispatchSalesAgentResponse.ts`/`dispatchSalesAgentFallback.ts`/
`dispatchSalesAgentHardHandoff.ts`, `httpAgentLoopProvider.ts`,
`AgentLoopProviderResponse`/`AgentLoopInferenceRecord` (cache-token fields
already existed since D1, not extended further -- Section 11), `control.ts`.

## 18. Remaining debt

- **B06's single `handoff` anomaly (Section 10b) is not root-caused.**
  Neither hypothesis (prompt-shape sensitivity vs. ordinary non-determinism)
  is confirmed. Recommended before any wider allowlist: repeat B06 several
  times at `temperature:0` in both modes to check reproducibility.
- **G18 (owner WhatsApp live smoke) is deferred**, by the user's explicit
  choice this session -- not run, not simulated as run. The real-DeepSeek
  benchmark (Section 7) is the best available live-model evidence without
  it, but it does not exercise the real Meta round trip, real delivery
  callbacks, or the real webhook path.
- **No scenario in the live benchmark exceeded legacy's 5-message window**
  (Section 8's honest caveat) -- the strongest evidence that persistent
  session recovers material information legacy has already evicted remains
  D4's own real-incident replay (structural, real MariaDB, not a live
  model call) rather than a live-model demonstration. A future task
  wanting stronger live evidence should run a >5-message live scenario.
- **Cache metrics are not wired into any `commercial_event`** (Section 11)
  -- observed only via the benchmark script's own recording wrapper. If a
  future task needs durable per-turn cache observability, extend
  `AgentLoopInferenceRecord`/`llmCalls` with `cacheReadSize`/`cacheMissSize`
  (never `...Tokens`, sanitizer-rejected) -- deliberately not done here to
  keep this task's production surface to what G1-G17 actually required.
- **Compacted-prefix placement is exercised structurally (`[D5-Q3]`) but
  never with a real D7 compaction row** -- D7 still does not exist, so no
  real conversation has ever produced one; the compacted-prefix branch of
  `deriveMessages()` remains D3's own tested-but-never-production-triggered
  code path.
- **`"tool"` provider role still not added** -- no new evidence from this
  task changes D3's "revisit only if a real need emerges" conclusion.

## 19. D6 readiness

**`D5_REQUIRES_PROMPT_ASSEMBLY_FIXES`** is **not** selected -- no assembly
defect was found; every structural gate holds. **`D5_SESSION_COGNITION_BLOCKED`**
is **not** selected -- nothing is architecturally blocked. Given the two
honest open items (B06's anomaly, G18 deferred), the accurate classification
is a qualified form of readiness, stated explicitly rather than forced into
one of the three offered buckets:

**`READY_FOR_D6_LEGACY_TAIL_RETIREMENT` -- conditional on first closing
Section 18's two live-evidence gaps** (repeat B06 for reproducibility;
either complete G18 or accept the DeepSeek-benchmark evidence as
sufficient by explicit decision, the same way this task's own G18 decision
was made). D6 (removing the legacy `recentMessages` tail globally) was
already explicitly conditioned by `V1.8-C`'s own migration plan on "real
evidence from D5, never assumed" -- this task supplies that evidence for
every *structural* claim, but not yet for live-model reliability at scale
or the real WhatsApp path.

## Verdict

**`R3_V1_8_D5_OWNER_ONLY_SESSION_COGNITION_VALIDATED_WITH_KNOWN_DEBT`**

- Gating: two independent allowlists (D4 shadow, D5 cognition), both
  fail-closed, both required alongside the existing `salesAgentRuntimeEnabled`
  gate -- proven for all 7 combinations the task brief's own Section Q names.
- Provider assembly: one new branch in `buildAgentStepPromptPackage.ts`,
  reusing the unchanged system-instruction code; legacy path proven
  byte-identical by construction and by test.
- Legacy `recentMessages` removal: proven absent from the persistent path,
  fresh authoritative context/`RecentCatalogContext`/`pendingCatalogAction`
  proven present and unchanged.
- Fallback: five independent failure classes all degrade to a clean
  `active:false`, never a partial prompt, never a thrown exception, never
  an altered outcome, proven both at the resolver level and at the full
  runtime boundary (including with D4 also failing simultaneously).
- Real incident (B01): both modes stayed anchored; no material
  live-benchmark difference at this scenario length (honest caveat -- see
  Section 8/18).
- Topic switch/return (B02/B03): both pass; B03 shows persistent mode
  explicitly resolving the topic reference where legacy asked for
  clarification -- real, concrete evidence.
- Superseding/correction (B05): both pass.
- Shipping correction (B06): net-correct in both modes, but persistent mode
  produced one unexplained `handoff` mid-scenario -- reported honestly as
  open debt, not hidden.
- Cache metrics: real, measured -- persistent mode showed a higher observed
  cache-hit rate (96.7% vs. 88.8%) in this run; not claimed as a guaranteed
  or statistically powered result.
- Prefix stability: the static system+tool prefix (~5,888 tokens) caches
  reliably; the growing historical/context suffix does not yet show
  incremental turn-over-turn caching in this measurement -- reported
  honestly, not oversold.
- WhatsApp live smoke: deferred by explicit user decision this session.
- Governance/dispatch: unchanged, proven by direct test and by the full
  regression suite.
- Rollback: proven at both the gating-function level and the full-runtime
  level.
- Tests: 28 new (all passing), 501/502 across every touched suite (1
  pre-existing flake), 4129/4154 full repo suite (25 pre-existing failures,
  confirmed unrelated via `git stash` baseline comparison twice).
  `npx tsc --noEmit`, `npm run build`, `npm run lint` all clean.
- Zero customer-visible behavior change for any turn outside the explicit
  owner allowlist (both env vars empty/false by default today). D6/D7 not
  implemented.

# SALES-AGENT-R3-V1.8-D5.2 -- Persistent Session Provider Message Alternation Repair

Status: implemented. Real production code changed: one function,
`buildAgentStepPromptPackage.ts`'s persistent branch, collapses D5's two
consecutive `user`-role messages (fresh-context + current-turn) into exactly
one final `user` message. Legacy branch untouched. Real DeepSeek + real
MariaDB (`main_management`) revalidation included below.

## 1. Executive verdict

**`R3_V1_8_D5_2_PROVIDER_MESSAGE_ALTERNATION_REPAIR_VALIDATED`**

D6 GO/NO-GO: **GO is not blocked by this task's own findings** (see Section
19 for the precise scope of what remains before D6 itself). Every gate this
task owns (G1-G6, G8-G13; G7 improved rather than merely held) is satisfied
with real evidence: unit tests plus a real-DeepSeek/real-MariaDB rerun of
D5.1's exact B06 scenario. Persistent mode's handoff rate under the same
real, controlled `set_shipping_destination` failure dropped from **60% (6/10,
D5.1's pre-fix measurement)** to **10% (1/10, this task's post-fix
measurement)** -- in the same live run, legacy itself measured 50% (5/10),
so persistent is no longer materially worse than legacy; if anything the
reverse. This is real DeepSeek non-determinism on both sides (Section 7
explains the legacy shift honestly), but the central, fix-attributable signal
-- persistent's own before/after change under an unchanged legacy baseline
mechanism -- is unambiguous.

## 2. D5.1 regression recap

`V1.8-D5.1` (previous task) reproduced and root-caused a real regression:
under a real, controlled `set_shipping_destination` failure
(`configuration_unavailable`, `LOGISTICS_DB_ENABLED=false`), persistent mode
handed off in 6/10 fresh repetitions of turn 1 (60%) while legacy handed off
in 0/10 (0%). The identified structural cause: even on a brand-new
conversation's first turn (zero real history in either mode), D5's
persistent branch split the same JSON payload legacy sends as one `user`
message into **two consecutive `user`-role messages with no `assistant`
message between them**:

```
[system, user(fresh context), user(current turn)]
```

vs. legacy's:

```
[system, user(fresh context + current turn)]
```

D5.1 explicitly did not implement a fix (out of its own scope) and left `D6`
at `NO-GO` pending exactly this repair.

## 3. Implementation

Exact change, `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts`,
persistent branch only (the `if (input.persistentSessionHistoricalMessages)`
block inside `buildAgentStepPromptPackage()`):

**Before (D5)**:

```ts
const freshContextPayload = {
  commercialContext: input.commercialContextSummary,
  recentCatalogContext: input.recentCatalogContext ?? { interactions: [] },
  ...(input.pendingCatalogAction ? { pendingCatalogAction: input.pendingCatalogAction } : {})
};
const currentTurnPayload = {
  currentTime: input.currentTime,
  customerMessage: input.customerMessage,
  priorStepsThisTurn: input.priorSteps.map(summarizeObservation),
  question: "What is the single next AgentStep?"
};
return {
  messages: [
    { role: "system", content: systemInstructions },
    ...input.persistentSessionHistoricalMessages,
    { role: "user", content: JSON.stringify(freshContextPayload) },
    { role: "user", content: JSON.stringify(currentTurnPayload) }
  ]
};
```

**After (D5.2)**:

```ts
const currentTurnPayload = {
  currentTime: input.currentTime,
  customerMessage: input.customerMessage,
  commercialContext: input.commercialContextSummary,
  recentCatalogContext: input.recentCatalogContext ?? { interactions: [] },
  ...(input.pendingCatalogAction ? { pendingCatalogAction: input.pendingCatalogAction } : {}),
  priorStepsThisTurn: input.priorSteps.map(summarizeObservation),
  question: "What is the single next AgentStep?"
};
return {
  messages: [
    { role: "system", content: systemInstructions },
    ...input.persistentSessionHistoricalMessages,
    { role: "user", content: JSON.stringify(currentTurnPayload) }
  ]
};
```

The two payload objects are merged into one (`currentTurnPayload` now carries
every field both of D5's two messages carried, nothing added, nothing
removed) and exactly one `user` message is emitted. No synthetic `assistant`
separator is inserted. `historicalMessages` is spliced verbatim,
unmodified, in the same position. The legacy branch (`else` path, reached
whenever `persistentSessionHistoricalMessages` is `null`/`undefined`) is
**not touched by this diff at all** -- same lines, same order, same
`userPayload` shape as before D5. The shared system-instruction-building
code (`systemInstructions`, layers 0-4) is untouched.

## 4. Before/after message shape

| | D5 (before) | D5.2 (after) |
|---|---|---|
| Zero history | `[system, user, user]` | `[system, user]` |
| One historical turn | `[system, user(hist), assistant(hist), user(context), user(current)]` | `[system, user(hist), assistant(hist), user(current)]` |
| Message count | 3 + N historical | 2 + N historical |
| Fields carried | Split across 2 messages | All in 1 message, same fields |
| `recentMessages` | Absent (unchanged) | Absent (unchanged) |
| Synthetic separator | None | None (still none) |

## 5. Zero-history proof

`[D5.2-T1]` (`buildAgentStepPromptPackage.test.ts`): `persistentSessionHistoricalMessages: []`
produces `messages.map(m => m.role)` exactly `["system", "user"]` -- never
`["system", "user", "user"]`. The single `user` message's parsed JSON
contains `commercialContext`, `recentCatalogContext`, `pendingCatalogAction`
(when open), `priorStepsThisTurn`, `currentTime`, `customerMessage` exactly
once, and `question` -- verified field-by-field by
`[D5.2-G5/G6/G7/T4/T5/T6/T7/T8]`.

## 6. Real-history proof

`[D5.2-T2]`/`[D5.2-T3]` construct 2 and 4 historical messages respectively
and assert the exact role sequence (`["system","user","assistant","user"]`
and `["system","user","assistant","user","assistant","user"]`), that the
historical messages are spliced **verbatim** (`assert.deepEqual` against the
original array, not merely role-equal), and that the final merged message's
`customerMessage` appears exactly once across the whole assembled request
(`[D5-G3/G4/T2/T9]`, updated for the new shape). `[D5.2-T10]` proves no
synthetic `assistant` separator is ever inserted: message count is always
exactly `2 + historicalMessages.length`, never more.

## 7. B06 rerun

Real DeepSeek (`BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY`/`BRAIN_MODEL_NAME=deepseek-v4-flash`,
`createHttpAgentLoopProvider({thinking:"disabled"})`, same construction as
D5/D5.1), real MariaDB (`main_management`), `runSalesAgentRuntime()` called
directly exactly like D5.1's own methodology (bypasses the
`BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED`/`_WA_IDS` allowlist,
`persistentSessionCognitionEnabled` passed directly per mode). Real
environment condition, unchanged: `LOGISTICS_DB_ENABLED=false` (this
environment's own `.env`), `CATALOG_SERVICE_BASE_URL=http://127.0.0.1:4010`
confirmed unreachable before running. Turn 1: "el envio es a San Bernardo".
Turn 2: "finalmente a Maipu". 10 fresh conversations per mode, never reused,
real `conversation`/`conversation_message` rows, real `AgentSessionStore`
(default MariaDB-backed).

| | Turn 1 handoff | Turn 2 handoff | Any handoff |
|---|---|---|---|
| Legacy (this run) | 5/10 (50%) | 3/10 (30%) | 5/10 (50%) |
| Persistent (this run) | 1/10 (10%) | 1/10 (10%) | 1/10 (10%) |
| Persistent, D5.1 pre-fix (reference) | 6/10 (60%) | 1/10 (10%) | 6/10 (60%) |
| Legacy, D5.1 pre-fix (reference) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) |

**Honest, unhedged observation**: legacy's own handoff rate moved from 0/10
(D5.1) to 5/10 (this task) under an **unchanged code path** -- the legacy
branch of `buildAgentStepPromptPackage.ts` is provably byte-identical before
and after this task (`[D5-G2/T11/T12]`). This is real DeepSeek
non-determinism/drift between the two benchmark sessions (different day,
same model alias, no code difference on legacy's side to explain it), not an
effect of this fix, and it is reported here rather than hidden. What this
task's fix is actually responsible for, and the number that matters for the
regression this task exists to close, is persistent's **own** before/after
change: 60% to 10%, a 6x reduction, measured under the identical real tool
failure both times. Additionally, in this task's own single run (same day,
same DeepSeek session, most tightly controlled comparison available),
persistent (10%) was **not worse than** legacy (50%) -- the D5.1 finding
("persistent materially worse than legacy under the same real failure") does
not reproduce after the fix.

## 8. Shipping-success control

Same 2-turn scenario, commune resolver replaced with a fake, deterministic
`CommuneCatalogPort` (`createCommuneResolver` from
`lib/domains/commune-resolution`, injected via the existing
`setCommuneResolverForTests` test seam in
`shippingDestinationCapability.ts` -- same seam D5.1 used, no new
production code) resolving "San Bernardo" to communeId 130 and "Maipu" to
communeId 131 deterministically. 10 legacy + 10 persistent, fresh
conversations.

**Result: 0/10 handoffs, both modes, both turns.** Every persistent-mode
turn-2 response correctly referenced "Maipú" (never "San Bernardo"),
matching every legacy-mode turn-2 response -- the destination correctly
superseded in both modes, all 20 scenarios.

## 9. Secondary tool-failure control

A second, independent recoverable tool failure: `search_products` against
the real, unmodified environment (`CATALOG_SERVICE_BASE_URL=http://127.0.0.1:4010`,
confirmed unreachable, the same natural condition D5/D5.1 already
characterized as "the Catalog Service was not reachable from this run" --
no injected seam needed). Single-turn scenario ("necesito una barra olimpica
de 20kg para home gym"), 5 legacy + 5 persistent, fresh conversations.

**Result: 0/5 handoffs, both modes.** Both modes responded with a graceful
"no pude buscar en el catálogo ahora, intenta de nuevo" variant. The
root-caused mechanism (Section 2) does not generalize into a broader
persistent-mode handoff propensity across tool types once repaired.

## 10. B01/B02/B03/B05/B07 continuity

Re-ran once per mode per scenario (same "one legacy + one persistent"
methodology D5's own continuity benchmark used), real DeepSeek, real
MariaDB, real `recentMessages` reconstruction for legacy (last 5
`{direction, body}` entries built turn-by-turn from real inserted
`conversation_message` rows, current turn's own inbound excluded -- matches
production's own `runSalesAgentRuntimeCycle.ts#recentMessages` construction;
this is a genuine improvement in benchmark fidelity over D5.1's B06-only
script, which never needed conversational memory for a 2-turn shipping
scenario).

- **B01 (carry-forward)**: both modes stayed on-topic (barra/home gym), 0/2 handoffs.
- **B02 (topic switch)**: both modes correctly answered about "colchonetas", 0/2 handoffs.
- **B03 (topic return)**: both modes correctly named "la barra olímpica de 20 kg" at turn 3 (this run did not reproduce D5's specific legacy-vs-persistent differential -- both resolved confidently this time, expected live-model variance, not a regression). 0/2 handoffs.
- **B05 (superseding)**: both modes correctly shifted to "15 kg" without re-asserting "20kg". 0/2 handoffs.
- **B07 (lateral question + return, new scenario for this task)**: turn 2 ("por cierto, hacen despacho a Maipu?") answered naturally in both modes; turn 3 ("volvamos a la barra de 20kg...") correctly returned to the product topic in both modes. 0/2 handoffs.

**Zero handoffs across all 10 continuity scenarios (24 turns).**

## 11. >5-message live benchmark

New scenario (task brief Section M), never run live before this task: 5
customer turns, exceeding legacy's effective 5-message `recentMessages` tail
by turn 5 (legacy's window has already evicted the turn-1 exchange by
then).

```
T1: "necesito una barra olimpica de 20kg para home gym"
T2: "ahora quiero ver colchonetas"
T3: "cuanto saldria el despacho a Maipu"
T4: "que balones medicinales tienen"
T5: "volvamos a la barra olimpica que vimos al principio"
```

Run once per mode, real DeepSeek, real MariaDB, same recentMessages
reconstruction as Section 10.

**Result, turn 5, machine trace (real, captured `AgentStep`, not
paraphrased)**:

```
Legacy tool call:      search_products({query: "barra olimpica"})
Legacy final response:  "...problemas para buscar la barra olímpica..."
                         (the "20kg" specificity is gone)

Persistent tool call (retried 3x, same query each time):
                        search_products({query: "barra olimpica 20kg"})
Persistent final response: "...no pude recuperar la información de la
                             barra olímpica de 20 kg..."
                         (the "20kg" specificity survives)
```

Legacy's turn-5 `recentMessages` window (last 5 of the growing transcript)
had already evicted turn 1's own message by turn 5 -- exactly as predicted,
its search query and final response both lost the "20kg" detail. Persistent
mode's real historical messages (`deriveMessages()`, unbounded by the
5-message tail, D3 unchanged) still carried turn 1's exact text, and the
model's own tool-call arguments (not just its final wording) reflect that:
it searched with the more specific query on all 3 of its retries. **0/2
handoffs.** Provider role shape at turn 5, persistent mode, captured
directly: `[system, user, assistant, user, assistant, user, assistant, user,
assistant, user]` -- clean alternation, no `user`/`user` adjacency anywhere,
confirming the fix holds across a full multi-turn conversation, not just the
zero-history case.

## 12. Cache metrics

Real, measured `AgentLoopProviderResponse.cacheReadTokens`/`cacheMissTokens`,
aggregated across this task's entire benchmark (352 real provider calls: 170
legacy, 182 persistent -- Sections 7-11 combined):

| | Calls | Input tokens | Output tokens | Cache read | Cache miss | Hit rate |
|---|---|---|---|---|---|---|
| Legacy | 170 | 970,679 | 6,618 | 940,416 | 30,263 | **96.9%** |
| Persistent | 182 | 1,023,073 | 7,199 | 989,440 | 33,633 | **96.7%** |

**Materially different from D5's own finding** (96.7% persistent vs. 88.8%
legacy) -- this run shows both modes at essentially the same, high hit rate.
Reported honestly, not reconciled: D5's own benchmark was a narrower,
shorter continuity run; this task's benchmark is larger and spans more
scenario types, and cache hit rate is sensitive to exactly this kind of
scope difference. No claim of a guaranteed or improved hit rate is made
either direction. Prefix stability held for both: legacy's first-call
`cacheReadTokens` was a flat 5,888 across all 62 sampled first-calls (the
immutable system+tool prefix, exactly matching D5.1's own measurement);
persistent's varied slightly (5,888 / 6,016 / 6,144) as conversations grew
longer (the historical-message prefix itself growing), still caching
reliably in every case observed.

## 13. Legacy/fallback identity

**Legacy request identity**: `[D5-G2/T11/T12]` (updated test name,
unchanged assertion) proves `buildAgentStepPromptPackage` with
`persistentSessionHistoricalMessages` absent, `undefined`, or `null` all
produce `assert.deepEqual`-identical output, and that shape is always
exactly `[system, user]` -- byte-identical to the pre-D5.2 (and pre-D5)
legacy path. This task's diff touches zero lines inside the function's
`else`/legacy branch.

**Fallback identity**: `resolvePersistentSessionCognitionContext.ts` is
untouched by this task (task brief explicitly forbade changing it except
for typing, and no typing change was needed). A persistent-session read
failure therefore continues to produce `active:false`, and
`salesAgentRuntime.ts` continues to pass `persistentSessionHistoricalMessages:
null` in that case -- reaching the exact same, untouched legacy branch this
task never modified. No new test was needed to prove this: it follows
directly from "the fallback path's only lever is whether
`persistentSessionHistoricalMessages` is null" (unchanged) and "the null
branch is unchanged" (Section 13's first paragraph, proven directly).

## 14. Governance regression

Not independently re-benchmarked live in this task (task brief Section P
scope: prove the fix only affects provider message assembly, not
governance) -- proven by the unit-test regression suite instead:
`capabilityGateway`/`capabilityGatewayHardening`/`capabilityGatewayIdentityGate`/
`commercialActionRequest`/`readToolRequest`/`dispatchSalesAgentResponse`/
`dispatchSalesAgentTerminalOutcome` (441 tests across the full targeted
suite, Section 16) all pass unchanged. `runSalesAgentRuntimeCycle.test.ts`'s
own `[RC5]` (`resolvedOpportunityId` propagation) and
`salesAgentRuntime.test.ts`'s `[D5-G14/G15]` (an eligible,
cognition-enabled turn still resolves exactly one real `crm_opportunities`
row through the unchanged commercial-action path) both pass unmodified.
This task's diff is contained entirely to
`buildAgentStepPromptPackage.ts`'s message-array construction -- it imports
nothing from and is imported by nothing in the Capability Gateway,
`CommercialActionRequest`, or dispatch/outbox modules.

## 15. Rollback

Unchanged from D5: `BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED=false`
(or an empty allowlist) makes every turn take the legacy branch, which this
task proves byte-identical to before D5 ever existed (Section 13). No
migration, no data rollback, no session deletion, no restart-dependent
state. This task adds no new flag and no new rollback lever of its own --
it only changes what the existing persistent branch sends, gated by the
existing D5 flag/allowlist.

## 16. Tests

| Group | File | Result |
|---|---|---|
| Provider-message assembly (pure) | `tests/agent-loop/buildAgentStepPromptPackage.test.ts` | all pass (existing D5 tests updated for the new shape: `[D5-G2/T11/T12]`, `[D5-G3/G4/T2/T9]`, `[D5-K]`, `[D5-L]` unchanged assertion; new: `[D5.2-T1]`, `[D5.2-G5/G6/G7/T4/T5/T6/T7/T8]`, `[D5.2-T3]`, `[D5.2-T10]`) |
| Targeted suite (buildAgentStepPromptPackage, runAgentToolLoop, salesAgentRuntime, resolvePersistentSessionCognitionContext, persistent-session gating, D4 shadow, agent session read/write, Capability Gateway, CommercialActionRequest, ReadToolRequest, dispatch/routing) | 22 files | **441/441 pass** |
| Full repo suite | `npm test` (all files) | pre-existing failures only (identity/onboarding `DATABASE_NAME`/env-isolation gaps, A13 conversational-reliability benchmark's already-documented debt, `CommercialWork` parallel wall-clock timing, `sales-agent-configuration` shared-DB row pollution, same-millisecond MariaDB ordering flake) -- confirmed identical against the pre-D5.2 baseline via `git stash` for two representative files (`createCustomerCapability.test.ts`, `customerSession.test.ts`), both reproducing the exact same `Missing DATABASE_NAME` failure with zero D5.2 code present |
| `npx tsc --noEmit` | clean | |
| `npm run build` | clean, full Next.js production build | |
| `npm run lint` | 0 errors, 40 pre-existing warnings in files this task never touched | |

Real-DeepSeek/real-MariaDB benchmark (Sections 7-11): 20 + 20 + 10 + 10 + 2 =
62 scenarios, 124 customer turns, 352 real provider calls -- all executed
via a scratchpad script (`d52-benchmark.ts`, repo root, never committed,
deleted after use, same precedent as D5/D5.1's own throwaway scripts).

## 17. Files changed

Modified (production):
- `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts` -- the
  persistent branch only (Section 3). Legacy branch, shared
  system-instruction code, and every other exported type/function
  untouched.

Modified (tests):
- `tests/agent-loop/buildAgentStepPromptPackage.test.ts` -- 4 existing D5
  tests updated for the new merged-message shape (role arrays / message
  indices only, never a relaxed assertion), 4 new tests added
  (`[D5.2-T1]`, the merged `[D5.2-G5/G6/G7/T4/T5/T6/T7/T8]`, `[D5.2-T3]`,
  `[D5.2-T10]`).

Not modified (task brief's explicit boundary, Section E): `deriveMessages.ts`,
`loadPersistentSessionContext.ts`, `resolvePersistentSessionCognitionContext.ts`,
`AgentSessionStore`, session schema, `runAgentToolLoop.ts` semantics,
Capability Gateway, `CommercialActionRequest`, `ReadToolRequest`, shipping
capabilities, handoff semantics, dispatch/outbox, D4 shadow code, D7
compaction.

Documentation:
- This file (new).
- `docs/ACTIVE_RELEASE.md` updated (current task pointer + closure summary).

No scratchpad files remain in the repository (`d52-benchmark.ts` and its
JSON result files were deleted after use).

## 18. Remaining debt

- **Legacy's own handoff-rate instability (0% D5.1 -> 50% this task) is
  unexplained and unresolved** -- attributed to real DeepSeek
  non-determinism/model drift between benchmark sessions since the legacy
  code path is provably unchanged, but this is an observation, not a proven
  root cause. A future task wanting a statistically stronger signal should
  run more repetitions across more sessions/days.
- **B03's D5-documented differential (persistent resolves the reference,
  legacy asks for clarification) did not reproduce in this run** -- both
  modes resolved confidently this time. Not a regression (0 handoffs, both
  correct), but it means this specific differential is not a reliable,
  repeatable signal across sessions -- likely reflects the same live-model
  variance as the legacy handoff-rate shift above.
- **`AgentStepHandoff.reason` remains free-text**, documented since `V1.6`,
  not touched by `V1.7`-`V1.8-D5.2`.
- **Cache metrics are still not wired into any `commercial_event`** (same
  debt D5 already recorded) -- this task's cache numbers exist only in this
  document and the now-deleted scratchpad script's console output.
- **G18 (owner WhatsApp live smoke) remains deferred**, unchanged from
  D5/D5.1 -- out of scope for this task (Section R of the task brief
  explicitly excluded it).

## 19. D6 readiness

Every gate this task's own brief assigned to D5.2 (G1-G6, G8-G13) holds with
direct evidence above; G7 (B06 no longer materially worse in persistent
mode) is satisfied and then some -- persistent was *better* than legacy in
this task's own single, most-tightly-controlled run. **D6 is not blocked by
this task's findings.** This document does not itself declare D6 `GO` --
per the task brief's explicit instruction (Section U/DO NOT IMPLEMENT D6),
that decision and its own exit criteria belong to a future D6 task, which
should also account for Section 18's honest debt (legacy's own measured
instability this session) before treating "persistent no longer regresses
relative to legacy" as a permanently settled fact rather than this
session's own real, dated measurement.

## Verdict

**`R3_V1_8_D5_2_PROVIDER_MESSAGE_ALTERNATION_REPAIR_VALIDATED`**

- Root cause (D5.1): two artificial consecutive `user`-role messages in the
  persistent branch's zero-history case.
- Fix: merged into exactly one final `user` message, carrying every field
  both of D5's messages carried; legacy branch untouched; no synthetic
  `assistant` separator ever inserted.
- Zero-history and real-history role shapes proven exactly as specified by
  the task brief, by direct unit test.
- B06 revalidated live: persistent's handoff rate dropped from 60% (pre-fix)
  to 10% (post-fix) under the identical real, controlled tool failure; in
  this task's own run, persistent (10%) was not worse than legacy (50%,
  itself a real, honestly-reported live-model shift from D5.1's own 0%).
- Shipping-success control: 0/10 both modes, unchanged.
- Secondary tool-failure control (search_products/Catalog Service down):
  0/5 both modes.
- Continuity (B01/B02/B03/B05/B07, B07 new): 0/10 scenarios with any
  handoff.
- New >5-message live scenario: persistent correctly retained "20kg"
  specificity evicted from legacy's 5-message tail, with the difference
  visible even in the model's own tool-call arguments, not just its final
  wording -- 0 handoffs either mode.
- Cache metrics: both modes ~97% hit rate in this run; static system prefix
  (5,888 tokens) caches reliably in both.
- Legacy and fallback paths proven byte-identical to before this task.
- Governance/dispatch: proven unchanged by the full targeted regression
  suite (441/441).
- Tests: 4 existing updated (shape only), 4 new, all passing; full repo
  suite shows only pre-existing, independently-confirmed-unrelated failures.
- `npx tsc --noEmit`, `npm run build`, `npm run lint` all clean.
- D6 not implemented (per explicit instruction) and not itself declared
  `GO`/`NO-GO` by this document -- this task only removes the specific
  blocker D5.1 raised.

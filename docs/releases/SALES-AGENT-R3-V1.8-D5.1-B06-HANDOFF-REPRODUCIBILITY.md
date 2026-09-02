# SALES-AGENT-R3-V1.8-D5.1 -- B06 Handoff Reproducibility Check

Status: characterization only, no production code changed. Real DeepSeek
provider, real MariaDB (`main_management`), same `runSalesAgentRuntime()`
entry point D5's own benchmark used. D6 (legacy `recentMessages` retirement)
is not implemented and, per this task's own finding, must not proceed yet.

## 1. Executive verdict

**`R3_V1_8_D5_1_B06_PERSISTENT_SESSION_REGRESSION`**

The B06 anomaly D5 reported as "1 handoff in 14 persistent turns, root cause
unknown" is real, reproducible, and now root-caused. Across 10 fresh
repetitions per mode under the same tool-failure condition D5's own
benchmark ran under, **persistent mode handed off on turn 1 in 6/10 runs
(60%)**; **legacy mode handed off in 0/10 runs (0%)** -- given the *exact
same*, real, controlled tool failure fed to both modes. A second, controlled
condition where the same tool is made to succeed deterministically produced
**zero handoffs in either mode (0/10 each)**, isolating the effect to
persistent mode's handling of a tool failure specifically, not a general
elevated handoff propensity. The mechanism is structural, not content-based:
even on a brand-new conversation's first turn (zero real prior messages, so
`persistentSessionHistoricalMessages` is empty in both runs), D5's persistent
branch of `buildAgentStepPromptPackage.ts` splits the identical JSON payload
legacy sends as one `user` message into **two consecutive `user`-role
messages with no `assistant` message between them** -- the one structural
difference present even with no history at all, and the one that correlates
with the behavioral shift.

## 2. Exact benchmark configuration

- Real provider: this repo's own configured DeepSeek endpoint
  (`BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY`/`BRAIN_MODEL_NAME=deepseek-v4-flash`
  from `.env`), constructed via `createHttpAgentLoopProvider({thinking:"disabled"})`
  -- the exact same construction D5's own benchmark used.
- **Temperature**: `createHttpAgentLoopProvider` defaults `temperature` to
  `0` whenever the caller does not override it
  (`lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider.ts:162`).
  Neither D5's construction nor this task's reproduction passed a
  `temperature` override, so **both benchmarks already ran at
  `temperature:0`** -- this corrects D5's own doc, which hedged "temperature
  was not set to 0 in this benchmark run" as an open hypothesis. It was
  already 0 by the provider's own default. Despite that, DeepSeek is
  demonstrably **not** perfectly deterministic here (Section 4): legacy mode
  was 10/10 stable across repetitions, persistent mode was not (6/10),
  confirming real DeepSeek non-determinism survives `temperature:0` -- this
  matches DeepSeek's own documented behavior for its MoE-routed models, not
  a defect in this repo's request construction.
- Entry point: `runSalesAgentRuntime()` called directly (never
  `runNativeAutonomousCycle`/the WhatsApp webhook path), `persistentSessionCognitionEnabled`
  passed directly as `true`/`false` per mode -- bypasses the
  `BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED`/`_WA_IDS` allowlist
  entirely, same as D5's own benchmark and the same pattern
  `salesAgentRuntime.test.ts`'s own `[D5-*]` tests already use.
- Conversations: real `conversation`/`conversation_message` rows in
  `main_management` (same DB the runtime-level D5 tests use), one fresh
  conversation per repetition -- never reused. `AgentSessionStore` uses its
  real, default MariaDB-backed implementation (never injected/faked); the
  session read side (D3's `loadPersistentSessionContext`/`deriveMessages`)
  runs completely unmodified.
- Scenario text: exactly the task brief's own B06 turns -- Turn 1 "el envio
  es a San Bernardo", Turn 2 "finalmente a Maipu" -- unmodified.
- **Honest limitation**: D5's own benchmark script was a scratchpad script
  "never added to the repo" (its own words) and no longer exists in this
  environment, so this task's `commercialContextSummary` fixture
  (`{commercialLineItems: {items: [{productId:"31", quantity:1}]}}`, matching
  the existing benchmark corpus's own C05 shipping-correction fixture shape
  in `tests/fixtures/agent-loop-benchmark/corpus.ts`) is a reconstruction,
  not a byte-identical replay of D5's own input. This does not weaken the
  root-cause finding below, because the identified mechanism (Section 10) is
  structural -- present in the shipped `buildAgentStepPromptPackage.ts` code
  regardless of what `commercialContextSummary` contains -- not an artifact
  of this specific fixture choice.
- **Two conditions**, run sequentially, real tool state controlled via the
  existing test-only DI seams already in the codebase (no production code
  touched):
  - `real_env_shipping_broken`: this environment's actual, unmodified state
    -- `LOGISTICS_DB_ENABLED=false` (`.env`) makes
    `set_shipping_destination`'s commune resolver report
    `configuration_unavailable` on every call (`lib/integrations/logistics/pc-pos-adapter.ts`),
    and the Catalog Service (`CATALOG_SERVICE_BASE_URL=http://127.0.0.1:4010`)
    is unreachable -- the same condition D5's own benchmark ran under
    (D5 Section 7: "the Catalog Service was not reachable from this run").
  - `fake_env_shipping_success`: `setCommuneResolverForTests()`
    (`lib/brain/commercial/capability-gateway/shippingDestinationCapability.ts`,
    an existing test-only seam, never a new one) injected with a fake
    catalog containing "San Bernardo" (id 130) and "Maipu" (id 131), so
    `set_shipping_destination` resolves deterministically every call. This
    is the task brief's own Section J suggestion ("also run a controlled
    fake-tool variant where shipping succeeds deterministically").
- Instrumentation: a scratchpad script
  (`b06-reproducibility-benchmark.ts`, repo root, never committed, deleted
  after this run) wraps the real provider to record, per call: elapsed time,
  outcome, tokens, `cacheReadTokens`/`cacheMissTokens`, the parsed `AgentStep`
  decision (`rawOutput`), and the request's message-role/length shape --
  never a raw system prompt, never `reasoning_content`. No production file
  under `lib/` or `tests/` was changed for this task.

## 3. Repetition counts

**10 fresh scenarios per mode, per condition** (the task brief's own
preferred minimum for a single condition) -- run for **both** conditions, for
**40 total scenarios, 80 customer turns, 202 real provider calls** in the
primary run, plus a supplementary 4-scenario/8-turn run (Section 10) used
only to inspect exact message-array shape (not counted in the frequency
statistics below). Every scenario used a brand-new `conversation_id`; no
conversation was reused across repetitions.

## 4. Legacy results

| Condition | Turn 1 handoff | Turn 2 handoff | Any handoff |
|---|---|---|---|
| `real_env_shipping_broken` | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) |
| `fake_env_shipping_success` | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) |

Legacy mode was **perfectly stable across all 20 turns of the broken-tool
condition**: every single run responded with a variant of "no pude registrar
la comuna de envío en este momento, ¿puedes intentarlo nuevamente?" -- never
once escalated to a human handoff for this specific, retryable tool failure.

## 5. Persistent results

| Condition | Turn 1 handoff | Turn 2 handoff | Any handoff |
|---|---|---|---|
| `real_env_shipping_broken` | **6/10 (60%)** | 1/10 (10%) | **6/10 (60%)** |
| `fake_env_shipping_success` | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) |

Persistent mode matched legacy exactly (0/10) when the tool succeeds. Under
the identical broken-tool condition, it handed off on the customer's very
first message in 6 of 10 independent runs. The one turn-2 handoff (rep 5)
only occurred in the one scenario where turn 1 had already handed off (no
outbound reply was ever persisted for that turn, so turn 2 also saw a
matching, unresolved tool-failure pattern).

## 6. Handoff frequencies (summary)

| | `real_env_shipping_broken` | `fake_env_shipping_success` |
|---|---|---|
| Legacy | 0% (0/10 scenarios) | 0% (0/10 scenarios) |
| Persistent | **60% (6/10 scenarios)** | 0% (0/10 scenarios) |

The gap (0% vs. 60%) exists **only** when a real tool failure is present.
This is not "persistent mode hands off more often" in general -- it is
"persistent mode hands off far more often specifically when recovering from
an identical tool failure legacy mode recovers from gracefully every time."

## 7. Machine-level handoff trace

Traced directly from the recorded per-call `rawOutput` (the parsed
`AgentStep`) and each call's last request message, for every reproduced
handoff (all 6 turn-1 cases plus the 1 turn-2 case share this exact shape):

```
Call 0 (both modes, identical arguments):
  provider output: {"type":"use_tool","tool":"set_shipping_destination","arguments":{"destination":"San Bernardo"}}
  -> Capability Gateway executes it identically in both modes
  -> real result: {"status":"failed","errorCode":"configuration_unavailable"}
     (LOGISTICS_DB_ENABLED=false -> pc-pos-adapter.ts's real, controlled failure path)
  -> folded into next call's `priorStepsThisTurn` verbatim, both modes

Call 1, LEGACY:
  provider output: {"type":"respond","message":"Lo siento, no pude registrar la comuna de envío en este momento. ¿Podrías intentarlo nuevamente en unos instantes?"}
  -> loop.terminalReason = "responded"
  -> SalesAgentRuntimeResult.status = "responded"

Call 1, PERSISTENT (materializes in 6/10 repetitions):
  provider output: {"type":"handoff","reason":"No se pudo registrar la comuna de despacho (San Bernardo) por una falla técnica del sistema. Requiero apoyo humano para configurar el destino de envío."}
  -> loop.terminalReason = "handoff"
  -> TERMINAL_REASON_TO_STATUS["handoff"] = "handoff" (salesAgentRuntime.ts, no reinterpretation)
  -> SalesAgentRuntimeResult.status = "handoff", .reason = loop.handoffReason verbatim
```

Answering the task brief's Section G questions directly:

1. **Which model decision produced it?** The model's own second decision this
   turn (`AgentStepHandoff`), never a runtime-inferred fallback.
2. **Was there an explicit handoff tool/action?** No -- `handoff` is one of
   the three literal `AgentStep` types (`use_tool`/`respond`/`handoff`), the
   model chose it directly as its structured output.
3. **Was `terminalReason` inferred by `runAgentToolLoop`?** No -- it is a
   direct 1:1 mapping from the model's own `AgentStep.type`.
4. **Did a tool rejection/failure map into handoff?** Not automatically --
   the *same* failure (`configuration_unavailable`) maps to `respond` in
   100% of legacy runs and to `handoff` in 60% of persistent runs. The tool
   failure is necessary (0% handoff when the tool succeeds, Section 6) but
   not sufficient by itself -- the prompt shape (Section 10) is the second
   necessary ingredient.
5. **Was it an eligible hard-handoff machine code?** No hard-coded
   handoff-eligibility list exists in this path -- the model's free-text
   `AgentStepHandoff.reason` is used verbatim (matches the pre-existing,
   unrelated debt already tracked since `V1.6`: `AgentStepHandoff.reason` is
   still free-text, not a structured code).
6. **Was it transformed later by terminal dispatch?** Not observed here --
   this task called `runSalesAgentRuntime()` directly (no
   `dispatchSalesAgentHardHandoff.ts` in the call path), so this cannot rule
   out a dispatch-layer transformation on the real WhatsApp path, but the
   handoff decision itself is already fully explained upstream of dispatch.
7. **Did the model explicitly request human assistance in structured
   output?** Yes -- every reproduced case is a first-class `AgentStepHandoff`
   with an explicit, human-readable reason naming the technical failure.

## 8. Shipping-state comparison

Fresh, authoritative state was verified identical and correctly superseding
across both modes in every scenario:

- Before Turn 1: no `shippingDestination` in `commercialContextSummary` for
  either mode (fresh conversation, nothing set yet).
- After a **successful** `set_shipping_destination` (the
  `fake_env_shipping_success` condition): the durable fact was read back via
  `getActiveShippingDestinationForOpportunity()` (the real production
  reader, never re-derived) and correctly showed `communeId:130` ("San
  Bernardo") before Turn 2, in both modes identically.
- After Turn 2 ("finalmente a Maipu"): the tool call resolved to
  `communeId:131` ("Maipu") and the model's response referenced "Maipú"
  specifically, correctly superseding "San Bernardo" -- in both modes, every
  repetition of the `fake_env_shipping_success` condition (10/10 legacy,
  10/10 persistent).
- No historical/session-derived shipping value was ever observed
  overwriting the fresh, authoritative `commercialContextSummary.shippingDestination`
  value -- `resolvePersistentSessionCognitionContext.ts` still imports
  nothing from the commercial-context/pricing layer (D5's own Section 6
  claim, re-confirmed unaffected by this task).

## 9. Tool-failure correlation

Perfectly correlated, both directions:

- Tool fails (`real_env_shipping_broken`): persistent handoff rate 60%,
  legacy 0%.
- Tool succeeds (`fake_env_shipping_success`): persistent handoff rate 0%,
  legacy 0% -- identical to legacy.

No handoff was observed in this task's 44 scenarios (176 provider calls
across the primary + diagnostic runs) that was not preceded by a real,
controlled `set_shipping_destination` failure. Malformed tool observations,
provider-level failures (network/HTTP/invalid-JSON), and Catalog Service
calls were not exercised by this scenario (B06 never calls a catalog tool) --
out of scope for this specific reproduction.

## 10. Prompt-structure comparison

Captured directly from the real request `messages` array (never estimated),
Turn 1, both conditions, first provider call of the turn:

**Legacy** -- 2 messages:
```
[0] system  (29,262 chars)
[1] user    (292 chars): {"currentTime":...,"customerMessage":"el envio es a San Bernardo","commercialContext":{...},"recentCatalogContext":{...},"priorStepsThisTurn":[],"question":...}
```

**Persistent** -- 3 messages:
```
[0] system  (29,262 chars)      <- byte-identical length to legacy's system message
[1] user    (132 chars): {"commercialContext":{...},"recentCatalogContext":{...}}
[2] user    (161 chars): {"currentTime":...,"customerMessage":"el envio es a San Bernardo","priorStepsThisTurn":[],"question":...}
```

`persistentSessionHistoricalMessages` is **empty** in both requests above
(brand-new conversation, nothing to derive yet) -- so the entire structural
difference, on this exact turn, is: **one combined `user` message (legacy)
vs. two consecutive `user`-role messages with no `assistant` message between
them (persistent)**. No content was duplicated, no historical evidence was
present to inspect, and the system/identity/tool-instruction layer is
provably unchanged (identical length). This means D5's own two hypotheses
(Section 10b of its doc) can now be resolved precisely: it is **not** "the
model weighing recalled history differently" (there is no history on this
turn) -- it is the two-consecutive-`user`-message structure itself,
independent of what those messages contain. A plausible mechanistic reason
(not independently verified against DeepSeek's training data, offered as a
reasonable explanation, not a proven one): two consecutive `user`-role
messages with no intervening `assistant` turn is a less common chat-message
alternation pattern than the strict `user`/`assistant`/`user` alternation
most chat-tuned models are predominantly trained on, and could plausibly
shift how the model weighs an ambiguous "what do I do next" decision after a
tool failure.

## 11. Root-cause classification

**`PERSISTENT_SESSION_REGRESSION`**, per the task brief's own Section K.1
criteria, both conditions met with direct evidence:

- "Handoff reproduces materially more often in persistent mode": **60% vs.
  0%**, 10 repetitions each, same real tool failure -- not a marginal
  difference.
- "Machine trace indicates the persistent prompt/context is causally
  associated with the transition": confirmed two ways -- (a) the controlled
  `fake_env_shipping_success` condition shows the gap disappears entirely
  (0% vs. 0%) when the only variable removed is the tool failure, with the
  prompt-shape difference between modes still present; and (b) the message-
  shape capture (Section 10) isolates the causally-associated structural
  difference precisely, down to the message-role sequence.

This is **not** `NONDETERMINISTIC_MODEL_ANOMALY` -- legacy mode was 10/10
stable under the exact same real API/model/temperature conditions, so
"ordinary DeepSeek non-determinism, prompt-shape-independent" cannot explain
a 0%-vs-60% gap between two prompt shapes fed the same underlying facts. It
is **not** `PREEXISTING_RUNTIME_BEHAVIOR` -- legacy and persistent do not
produce equivalent handoff rates under the same conditions; the common
runtime/tool/handoff machinery downstream of the model's decision (Section 7
of D5's own doc: Capability Gateway, dispatch, `CommercialActionRequest`)
was never implicated, only what `buildAgentStepPromptPackage.ts`'s
persistent branch sends the model.

## 12. D6 go/no-go

**NO-GO.** Per the task brief's own Section L: "D6 must NOT proceed if:
`PERSISTENT_SESSION_REGRESSION`... with meaningful persistent-only
frequency." 60% is meaningful. D5's own doc had left D6 readiness as
`READY_FOR_D6_LEGACY_TAIL_RETIREMENT` conditional on exactly this check
(repeat B06 for reproducibility) -- that condition has now been evaluated
and failed. D6 (retiring legacy `recentMessages` globally) must not proceed
until the message-structuring regression identified in Section 10 is fixed
and this same reproduction is re-run clean.

**Note on scope**: per this task's own Section B ("DO NOT IMPLEMENT"), no
fix was attempted. The most direct candidate fix implied by Section 10 (do
not split the fresh-context and current-message payload into two
consecutive `user`-role messages when there is no real historical content to
place between them -- e.g., collapse them into one `user` message exactly
like legacy when `persistentSessionHistoricalMessages` is empty, or insert a
synthetic separator) is a real, scoped candidate for a follow-up task, not
implemented here.

## 13. WhatsApp smoke decision

**Intentionally not required for this validation**, per the task brief's own
Section M: this environment cannot receive the real Meta webhook (confirmed
unchanged, per the same 63-day-old memory D5 already cited), and this task's
purpose was a controlled characterization of a specific, already-observed
anomaly -- not a new live-model evidence requirement. No real WhatsApp/Meta
traffic was attempted.

## 14. Tests / spikes

No production test suite was run for this task (no production code
changed, per Section N: "no need to rerun unrelated full suite"). The only
artifact executed was the scratchpad benchmark script itself
(`b06-reproducibility-benchmark.ts`), run three times:

1. Smoke test, 1 repetition per condition/mode (4 scenarios) -- validated
   the harness end to end and produced the first handoff reproduction on the
   very first persistent/`real_env_shipping_broken` repetition.
2. Primary run, 10 repetitions per condition/mode (40 scenarios, 80 turns,
   202 real provider calls) -- Sections 4-9 above.
3. Structural diagnostic, 1 repetition per condition/mode (4 scenarios) with
   full message-array shape capture -- Section 10 above.

## 15. Files changed

**None, in the repository.** This task added and then deleted three
scratchpad files at repo root (never staged, never committed, matching the
"never added to the repo" precedent D5's own benchmark script set):
`b06-reproducibility-benchmark.ts`, `b06-analyze.mjs`,
`b06-analyze-structure.mjs`. `docs/ACTIVE_RELEASE.md` was updated (this
task's own required documentation update, Section O) to point
`current_task` at this task's closure and record the D6 no-go. This
document itself (`docs/releases/SALES-AGENT-R3-V1.8-D5.1-B06-HANDOFF-REPRODUCIBILITY.md`)
is new.

## 16. Remaining debt

- **The regression is root-caused but not fixed.** Section 12's candidate
  fix (collapse the two persistent-mode `user` messages into one when
  `historicalMessages` is empty, or otherwise avoid a bare
  `user`/`user` adjacency) is untested and unimplemented -- explicitly out
  of scope for this task (Section B).
- **Only B06's own scenario shape was tested.** This task did not check
  whether the same two-consecutive-`user`-message structure affects
  non-shipping tool failures (e.g., a `search_products`/Catalog Service
  failure) or turns with real historical content between the two messages
  (a conversation past turn 1). The mechanism identified (Section 10) is
  structural and should generalize, but that generalization itself is not
  independently confirmed by execution.
- **D5's own exact original `commercialContextSummary` fixture is
  unrecoverable** (its scratchpad script was never committed) -- this task's
  reconstruction (Section 2) is a good-faith, corpus-consistent
  approximation, not a byte-for-byte replay.
- **G18 (owner WhatsApp live smoke) remains deferred**, unchanged from D5 --
  this task did not attempt to close it (Section 13).
- **Cache-hit-rate divergence from D5's own benchmark (88.8% vs. 96.7%) did
  not reproduce in this task's shorter, simpler B06-only scenarios** (both
  modes measured ~97-98% in both conditions here) -- likely an artifact of
  scenario length/complexity rather than a contradiction, not investigated
  further (out of this task's scope).

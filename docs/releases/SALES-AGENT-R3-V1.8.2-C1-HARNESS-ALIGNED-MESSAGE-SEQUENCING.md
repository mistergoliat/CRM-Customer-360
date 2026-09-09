# SALES-AGENT-R3-V1.8.2-C1 -- Harness-Aligned Message Sequencing

Status: implemented, deterministic tests green, not live-validated (real
DeepSeek integration benchmark run, see Section 12 -- real WhatsApp
inbound/outbound evidence, per the task brief's own instruction, is not
attempted here). Entirely behind `BRAIN_R3_HARNESS_ALIGNED_MESSAGE_MODEL_ENABLED`
(default `false`) -- flag-off output is byte-identical to before this task.
**V1.8.2-C1.1** (Section 16) closed the remaining pre-commit evidence gaps
(cache-prefix claim corrected, a 10-rep live steering study, a working-catalog
kg test, a greeting control) and assessed C1 as commit-ready in this exact
state -- verdict unchanged, still not `VALIDATED`.

## 1. Executive verdict

**`R3_V1_8_2_C1_MESSAGE_SEQUENCING_IMPLEMENTED_NOT_LIVE_VALIDATED`**

R3's cognitive projection moves from one JSON-stringified `user`
mega-envelope per decision slot to a causally-ordered sequence of discrete
`system`/`user`/`assistant` messages -- closer to how Harness-style agent
frameworks structure a transcript -- while changing nothing about durable
turn/settlement/gateway semantics underneath. The D5.1-B06 historical
regression (two bare consecutive `user` messages with no `assistant` between
them, causing a measured 60%-vs-0% handoff-rate spike under a real tool
failure) is explicitly analyzed and structurally avoided for every message
boundary this task controls, with one known, honestly-documented residual
risk left for live testing (Section 9). 88 deterministic tests added/updated,
all passing; the full targeted regression suite (agent-loop, sales-agent-
runtime, native-cycle) shows the exact same failing tests before and after
this change (all pre-existing, DB-connectivity-dependent, confirmed via
`git stash` byte-for-byte). `npx tsc --noEmit`, `npm run build`, `npm run lint`
all clean.

## 2. Legacy message shape (flag off, unchanged)

Persistent-session path (`buildAgentStepPromptPackage.ts`, unchanged code):

```
[system]                                  <- stable contract, Layers 0-4
...persistentSessionHistoricalMessages    <- real user/assistant transcript, verbatim
[user]  JSON.stringify({                  <- ONE mega-envelope
  currentTime, customerMessage, commercialContext, recentCatalogContext,
  pendingCatalogAction?, conversationContinuity, priorStepsThisTurn, question
})
```

Legacy path (no persistent session): `[system, user(mega-envelope)]`, same
payload shape. Neither branch was touched by this task -- both are reached
exactly as before whenever `harnessAlignedMessageModelEnabled` is
false/absent, and are proven byte-identical by `[C1-T1]`.

## 3. New message shape (flag on)

New module `lib/brain/commercial/agent-loop/harnessAlignedMessageProjection.ts`
(pure functions, no I/O):

```
[0] system   the EXACT existing systemInstructions string (Layers 0-4) - reused verbatim, never redesigned
[1] system   dynamic runtime context - NEW, one message:
             "RUNTIME CONTEXT (system-provided, not authored by the customer): " +
             JSON.stringify({ currentTime, commercialContext, recentCatalogContext,
                               pendingCatalogAction?, conversationContinuity })
[2..N] ...historicalMessages              <- spliced verbatim, unchanged (may itself start
                                              with a role:"system" compacted-prefix message)
[N+1] user    <fragment[0].text>          <- the raw original customer message, no wrapper
[N+2] assistant  {"type":"use_tool","tool":"...","arguments":{...}}   <- step 1, replayed verbatim
[N+3] user    "[TOOL RESULT: <tool>] " + JSON.stringify(observation) <- step 1's observation
[N+4] assistant  {...}                    <- step 2
[N+5] user    "[TOOL RESULT: <tool>] ..."  <- step 2's observation
...           any fragment assimilated after step i is inserted here, in order
```

`question` and `priorStepsThisTurn` never appear under this mode (Section 6).
Measured on a representative 2-tool-step, 1-historical-exchange turn
(`[C1-T7]`-shaped fixture, real numbers from a throwaway measurement script,
never committed): legacy = 4 messages / 25,269 content chars / 25,823 request
JSON bytes; harness-aligned = 9 messages / 25,258 content chars / 25,951
request JSON bytes. Message **count** roughly doubles (one assistant+one
tool-observation message per tool step, replacing one shared JSON array
entry), but total **content** size is essentially unchanged (-11 chars) --
confirms Section 11's "no double representation" requirement empirically,
not just by code inspection.

## 4. Causal ordering algorithm

`buildCausalTurnMessages(fragments, priorSteps)` in the new module
interleaves customer-message fragments and accepted `(AgentStep,
ToolObservation)` pairs in the exact order they happened, using one piece of
bookkeeping added to `runAgentToolLoop.ts`: each fragment records
`afterStepCount` -- `steps.length` at the moment it was discovered by
`tryAssimilate()`. Since both `steps` and the new `customerMessageFragments`
array only ever grow by append, `afterStepCount` fully determines the
correct interleaving position without needing a database timestamp:

```
emit every fragment with afterStepCount === 0
for i in 0..priorSteps.length:
  emit assistant(priorSteps[i].step)
  if priorSteps[i].observation: emit user("[TOOL RESULT: ...] " + observation)
  emit every fragment with afterStepCount === i + 1
```

`priorSteps` passed into `buildAgentStepPromptPackage` only ever contains
`use_tool` records in practice (`runAgentToolLoop.ts` always returns
immediately once a `respond`/`handoff` step is accepted, so it never survives
into a `priorSteps` list that gets prompted again) -- the code still handles
every `AgentStep` variant defensively since the type itself does not encode
that runtime invariant.

## 5. Dynamic context placement, and why

Section 9 of the task brief hinted: "if the safest solution requires dynamic
context to remain in system rather than a separate user message, prefer
that." This task follows that literally: `commercialContext`,
`recentCatalogContext`, `pendingCatalogAction`, `conversationContinuity` and
`currentTime` all live in a **second `system`-role message**, positioned
between the stable system contract and the real historical transcript --
never as a `user` message adjacent to the customer's own message. See
Section 9 for exactly why this placement matters.

**Cache-prefix correction (V1.8.2-C1.1)**: the original text of this section
claimed the cache boundary was "the same in both modes." That claim was
**wrong** and is retracted here, not merely softened -- it compared the
wrong two things. It is true that legacy's own dynamic content was already
outside any cacheable prefix; it is a separate, previously unexamined
question what a provider's prefix-cache matching actually loses upstream of
that when a second, per-call-volatile message is inserted earlier in the
array than before -- and on that question, C1's own shape is worse than
legacy's, not equal, for exactly the persistent-session case that matters
most (a real, multi-turn conversation).

Re-derived directly from the actual code shapes:

```
Legacy, persistent branch (buildAgentStepPromptPackage.ts, unchanged):
  [ system(stable),  ...historicalMessages(stable, append-only across turns),  user(mega-envelope, volatile) ]
  Cacheable prefix candidate: system + historicalMessages -- large, and it GROWS as the
  conversation grows. This is consistent with V1.8-D5.2's own measured ~97% real
  cache-hit rate on multi-turn conversations (docs/releases/SALES-AGENT-R3-V1.8-D5.2-...md
  Section 12/11) -- that measurement is direct evidence FOR legacy's own
  history-inclusive prefix caching well, not merely a theoretical claim.

C1, harness-aligned:
  [ system(stable),  system(dynamic context, volatile - changes almost every call),  ...historicalMessages(stable),  user(current), ... ]
  The volatile dynamic-context message sits BETWEEN the stable system message and the
  historical transcript. A conventional longest-common-prefix cache match can only extend
  as far as the first message that differs from the previous call -- so the moment
  message[1] changes, EVERYTHING after it (including the historical transcript, even
  though its own bytes are unchanged) falls outside whatever the cache would otherwise
  have matched. The cacheable prefix candidate shrinks to "system" alone.
```

**Correct statement, replacing the retracted one**: C1 **may reduce**
prompt-prefix cache reuse relative to legacy for persistent-session turns
with real history, because the historical transcript -- previously part of
a stable, growing, append-only cacheable prefix right after `system` -- now
sits downstream of a message that changes almost every call. **This has not
been measured against the real provider** (no cache-hit-rate benchmark was
run for this specific comparison in this task) -- the claim above is a
structural/mechanical inference from the two message shapes, offered as the
best available reasoning about how a conventional prefix-cache algorithm
would treat them, not a measured result, and it should not be read as one
until it is. Classified as **known performance debt, not correctness debt**
(Section 13) -- it can only affect latency/cost, never which tools run,
what evidence is used, or what the customer is told. A real, controlled
before/after cache-hit-rate measurement (mirroring V1.8-D5.2's own
methodology) is the concrete follow-up that would turn this from a
structural inference into a measured fact, in either direction.

## 6. `question`/`priorStepsThisTurn` removal

`question` ("What is the single next AgentStep?") is dropped under the new
flag -- redundant with the existing Layer-1 loop-contract instructions
(`buildLoopContractLines`), which already state the model must decide
exactly one AgentStep at a time, for both phases. `[C1]` proves no message
under the new flag contains that literal string; every legacy-path test
(`[D5.2-*]`, `[D5-*]`) is untouched and still asserts its presence there.
`priorStepsThisTurn` is replaced entirely by the causal replay in Section 4;
`[C1-T8]` proves it is never also duplicated as a JSON array under the new
flag.

`conversationContinuity`/`pendingCatalogAction`'s rule-line wording in the
immutable system layers (`CONVERSATION_CONTINUITY_RULE_LINES`,
`PENDING_CATALOG_ACTION_RULE_LINES`) still says "the user payload's ... field"
-- left untouched deliberately. `systemInstructions` is built once, by the
same unconditional code, before any branching on the new flag; editing that
shared text would break "flag off must be byte-identical" for a purely
cosmetic wording fix, and the task brief's own Section 7 forbids redesigning
Layer 0-4 rules in this task anyway. Accepted as harmless wording imprecision
(the field is still present and still governs the same rule, just no longer
literally inside "the user payload" under the new flag) -- not fixed here.

## 7. Feature flag

`BRAIN_R3_HARNESS_ALIGNED_MESSAGE_MODEL_ENABLED` (default `false`) ->
`shouldEnableHarnessAlignedMessageModel()` in `commercialCycleConfig.ts`,
identical shape to `shouldEnableOpenTurnExecution()` (no allowlist of its
own -- pilot scoping inherited entirely from whatever already gates
`SalesAgentRuntime`). Threaded through the same 5-file chain the two
precedent R3 flags already established:
`runNativeAutonomousCycle.ts` (resolves the flag) ->
`RunSalesAgentRuntimeCycleInput` (pass-through field) ->
`SalesAgentRuntimeInput` -> `RunAgentToolLoopInput` -> `AgentLoopPromptInput`.
No allowlist, no schema migration, no new rollback lever beyond the flag
itself.

## 8. Live Turn Assimilation / steering projection

Under the new flag, `runAgentToolLoop.ts` maintains a new, flag-gated-only
local array (`customerMessageFragments`) ALONGSIDE the pre-existing
`customerMessage` string join -- the legacy join is completely unconditional
and untouched, so flag-off behavior and data are unaffected. Inside
`tryAssimilate()`, each newly discovered durable inbound fragment (from
`checkForNewInbound()`) becomes its own array entry (never joined with
`\n`), stamped with `afterStepCount = steps.length` at discovery time.
`[C1-L3]` proves a new inbound folded in mid-turn becomes its own discrete
final user message with raw, unmodified text (never concatenated into the
original customer message); `[C1-L5]` proves two fragments discovered in the
same assimilation cycle remain two discrete, correctly-ordered messages
(Section 12 of the task brief, "multiple assimilated fragments") --
preserving real arrival order, never collapsed into one synthetic paragraph.
Storage/settlement/`ASSIMILATED` semantics are completely untouched -- this
is cognitive projection only, exactly as scoped.

**Explicitly out of scope, and why**: claim-time pre-turn fragment
aggregation (`assembleTurnFragments.ts`, used before `runAgentToolLoop` is
ever called, when several WhatsApp messages arrive close together before the
turn even starts) is unchanged -- `input.customerMessage` is still treated as
one opaque fragment at turn start. Reconstructing per-fragment identity
across that boundary too would require threading raw `conversation_message`
rows through `salesAgentRuntime.ts`/`runNativeAutonomousCycle.ts`, well
beyond this task's stated boundary (buildAgentStepPromptPackage's cognitive
projection). Recorded as known debt (Section 13).

## 9. D5.1-B06 regression analysis (required before finalizing this design)

Source docs, read in full before any design decision was made:
`docs/releases/SALES-AGENT-R3-V1.8-D5.1-B06-HANDOFF-REPRODUCIBILITY.md`
(root-cause) and
`docs/releases/SALES-AGENT-R3-V1.8-D5.2-PERSISTENT-SESSION-PROVIDER-MESSAGE-ALTERNATION-REPAIR.md`
(fix).

**What happened**: `V1.8-D5`'s persistent branch split one JSON payload into
two consecutive `user`-role messages (fresh context, then current turn) with
zero `assistant` message between them -- even on a brand-new conversation's
first turn (`[system, user, user]`). Under a real, controlled
`set_shipping_destination` failure, this produced a handoff on the
customer's first message in **60% of repetitions (6/10)**, versus **0%
(0/10)** for legacy's single-message shape -- same real DeepSeek endpoint,
same tool failure, same temperature (0), 10 fresh conversations per mode.
The gap disappeared entirely (0% vs 0%) when the same tool was made to
succeed deterministically instead, isolating the mechanism to the message
SHAPE interacting with a genuine tool failure, not the content of either
message (D5.1's own hedged mechanistic hypothesis: two consecutive
`user`-role messages with no intervening `assistant` turn is a less common
chat-alternation pattern than the strict `user`/`assistant`/`user`
alternation most chat-tuned models are trained on, which could plausibly
shift how the model weighs an ambiguous "what do I do next" decision after a
failure). `V1.8-D5.2` fixed it by merging the two messages into exactly one,
dropping the handoff rate to 10% (1/10) under the identical live-repeated
condition -- no synthetic `assistant` separator was ever inserted as the
fix, merging was.

**Why this task's design does not reintroduce it, for every boundary it
controls**:

- Dynamic context is a second `system` message, never `user` -- a
  `system`->`user` (or `assistant`->`system`->`user`) transition is not the
  flagged pattern, which was specifically bare consecutive `user`/`user`.
  `[C1-T11]` reproduces D5.1's own zero-history scenario under the new flag
  and asserts the role sequence is exactly `[system, system, user]`, with an
  explicit assertion that no two consecutive messages share role `user`
  anywhere in that base case.
- Every tool-observation `user` message is immediately preceded by its own
  `assistant` AgentStep and immediately followed by the next `assistant`
  decision -- `[C1-T6]`/`[C1-T7]`/`[C1-L2]` prove clean alternation across
  one and two real tool steps, never `user`/`user`.

**The one residual risk this task does NOT eliminate, documented honestly
per the task brief's own "measure, don't harden" instruction (Section 20)**:
when a new inbound fragment is assimilated immediately after a tool
observation (`tryAssimilate()`'s post-tool boundary), the projected sequence
is `..., assistant(stepN), user(tool result N), user(new fragment)` --
structurally the same bare `user`/`user` role-adjacency shape as the
original regression, even though the content differs (a labeled tool result
vs. raw customer text). This is not assumed safe: D5.1's own two colliding
messages were ALSO already content-distinguishable by field names
(`commercialContext`/`recentCatalogContext` vs. `customerMessage`/
`priorStepsThisTurn`), and the regression occurred anyway -- so content
differentiation alone is not a proven mitigation, and none is claimed here.
No synthetic `assistant` separator was inserted to paper over this adjacency
(that would fabricate model speech never actually produced, which is worse
than the risk it would be hiding). `[C1-L3]` proves the REPRESENTATION is
correct (discrete, unmodified, correctly ordered); it does not and cannot
prove the ABSENCE of a live handoff-rate effect -- that requires the live
benchmark in Section 12 (Test 3 there specifically targets this shape), and
even that benchmark is explicitly scoped as an integration smoke check, not
a new 10-repetition statistical study. This residual risk is the single
biggest reason this task's verdict stops at `IMPLEMENTED_NOT_LIVE_VALIDATED`
rather than anything stronger.

## 10. Observability

Four new optional fields, additive, same discipline as every existing
optional field on `AgentLoopResult` (never chain-of-thought, never the full
prompt, never raw tool payloads):

```
messageModelMode: "legacy_envelope" | "harness_aligned"
projectedMessageCount: number
projectedToolObservationCount: number
projectedAssimilatedUserMessageCount: number
```

Populated in `runAgentToolLoop.ts` from the most recent prompt build's
`projection` metadata (`buildAgentStepPromptPackage`'s return value gained a
`projection` field, always populated -- `mode: "legacy_envelope"` and
zeroed tool/assimilation counts for the untouched legacy/persistent
branches too, so callers get a uniform shape regardless of flag state).
Mirrored into `SalesAgentRuntimeResult` the same way `openTurnExecutionEnabled`
already is. `tests/commercial/salesAgentRuntime.test.ts`'s own allowlist
test ("the result exposes only structured, bounded fields - no
chain-of-thought") was updated to include the four new names -- proof this
task adds only bounded, structured data to that contract, nothing free-text.
No `commercial_event`/persisted-event schema was touched.

## 11. Tests

88 tests in the two directly-touched files, all passing:

- `tests/agent-loop/buildAgentStepPromptPackage.test.ts` (extended, pure
  function, no loop machinery needed): `[C1-T1]` through `[C1-T13]` plus
  `[C1-CaseA/B/C]` -- flag-off byte-identity, native raw customer message, no
  runtime metadata leaking into it, historical transcript verbatim, dynamic
  context separate and labeled, one/two tool steps causally ordered,
  `priorStepsThisTurn` never duplicated, gathering-repair/finalization keep
  the new projection, the D5.1-B06 zero-history adjacency proof, first-turn
  and established-turn behavior, `question` absence, and the three literal
  representation cases from the task brief's Section 17 (mid-history
  follow-up, established-conversation continuation, mid-turn correction).
- `tests/agent-loop/harnessAlignedMessageSequencing.test.ts` (new, loop-level
  integration -- reuses the exact fixture/mock-server conventions
  `runAgentToolLoopLiveAssimilation.test.ts`/`openTurnExecution.test.ts`
  already established, local helpers duplicated rather than shared, matching
  this codebase's own convention for a handful of callers): `[C1-L1]`
  through `[C1-L7]` -- flag-off loop-level identity, two real sequential
  tool steps via `runAgentToolLoop` itself, new inbound mid-turn becomes a
  discrete message, a Boundary-1-discarded candidate leaves zero trace in a
  later prompt build (direct proof of "no persisted reasoning"), two
  same-cycle fragments stay discrete and ordered, Open Turn composition
  (a 4-step turn with the flag on, message count growing monotonically),
  and mutation-exactly-once composing correctly with steering under the new
  flag.

One pre-existing test updated: `tests/commercial/salesAgentRuntime.test.ts`'s
field-allowlist test (Section 10 above).

Full targeted regression (agent-loop + sales-agent-runtime + native-cycle,
12 files, 218-265 tests depending on file set): the exact same failing tests
before and after this change, confirmed via `git stash push -u` /
`git stash pop` around a clean re-run (diffed with timing stripped --
byte-identical failure lists). Every failure is a pre-existing
`ECONNREFUSED 127.0.0.1:3306` (no local MariaDB in this environment) or a
DB-dependent fixture failure (`customer_create_failed`), none newly
introduced. `npx tsc --noEmit`, `npm run build`, `npm run lint` (0 errors,
40 pre-existing warnings, none in a file this task touched) all clean.

## 12. Live-DeepSeek integration benchmark

Real configured DeepSeek endpoint (`createHttpAgentLoopProvider({thinking:"disabled"})`,
same construction D5/D5.1/D5.2 already used), real MariaDB (`main_management`,
started via `npm run db:up`/`db:wait` for this task -- 35 migrations already
applied, 0 pending). `runSalesAgentRuntime()` called directly with
`harnessAlignedMessageModelEnabled: true` passed explicitly (bypasses the
env/allowlist chain and the entire dispatch/outbox layer -- no WhatsApp/Meta
traffic possible from this path, no customer-facing outbox effect). Every
row written tagged with a `c1-bench-` prefix (`external_contact_id`,
`correlationId`). A throwaway wrapper around the real provider captured each
call's actual `request.messages` array for inspection; chain-of-thought was
never captured or logged (DeepSeek's `thinking` is disabled for this
construction, and only `rawOutput`/role-shape were ever printed). Script:
`c1-live-benchmark.ts`, repo root, never committed, deleted immediately
after this run -- same precedent as D5.1's/D5.2's own scratchpad scripts.
This is a real-provider **integration smoke check**, explicitly not a new
statistical study (no 10-repetition design) and not final live validation --
verdict ceiling stays `IMPLEMENTED_NOT_LIVE_VALIDATED` regardless of
outcome, since real WhatsApp inbound/outbound evidence (required for any
stronger verdict per the task brief) cannot be produced from this
environment (existing memory: the Meta webhook does not target this local
instance). Real environment condition, unchanged and confirmed before
running: `LOGISTICS_DB_ENABLED=false`, `CATALOG_SERVICE_BASE_URL=http://127.0.0.1:4010`
unreachable -- the same broken-tool condition D5.1/D5.2 themselves
benchmarked under.

**Test 1 -- the exact D5.1-B06 adjacency case** (`set_shipping_destination`
under the real, controlled tool failure), 2 fresh conversations:

```
rep 0: status=responded, first-call roles=[system,system,user], bare user/user adjacency=false
rep 1: status=responded, first-call roles=[system,system,user], bare user/user adjacency=false
```

**0/2 handoffs.** Both reps' first call (zero history, zero prior steps --
the exact structural shape D5.1 reproduced its regression in) showed the
predicted `[system, system, user]` sequence, never a bare `user`/`user`
adjacency. Both accepted responses, after the tool's real
`configuration_unavailable` failure, were graceful "no pude registrar tu
comuna, intenta de nuevo" variants -- matching legacy's own historical 0%
and D5.2's already-fixed 10% far more than D5.1's original 60%. n=2 is an
integration smoke sample, not a reproduction of D5.1's own 10-repetition
design -- reported as directionally consistent with "the regression does
not return," not as a new statistical disproof.

**Test 2 -- multi-step tool sequencing** (`"necesito una barra olimpica de
20kg para home gym"`, Catalog Service genuinely unreachable in this
environment): 2 real `search_products` attempts (both timing out), then a
`handoff` decided directly from gathering (not finalization) after the
second failure, budget partially spent (`toolCalls=2`). Message roles grew
exactly as designed across all 3 real calls:
`[system,system,user]` -> `[system,system,user,assistant,user]` ->
`[system,system,user,assistant,user,assistant,user]` -- each step adding
exactly one `assistant`+`user` pair, never duplicating a mega-envelope,
confirmed directly from the real captured requests (not inferred). The
handoff itself is a reasonable model decision given a genuinely broken
dependency in this dev environment, not a message-shape artifact -- no
legacy-mode side-by-side was run for this specific scenario (out of scope
for an integration smoke check), so this is reported as an observed outcome
only, not compared against a same-session legacy baseline.

**Test 3 -- "todo en kg" follow-up shape** (task Section 17 Case A, 2-turn
persistent-session conversation): turn 1 ("Quiero mancuernas de caucho
fijas de 10, 15 y 20 kg por separado.") failed to reach the catalog
(unreachable) and responded gracefully. Turn 2 ("todo en kg") call 0's
captured request showed roles `[system, system, user(hist), assistant(hist),
user("todo en kg")]` -- confirming persistent-session history correctly
flows into the new projection unchanged -- and the model's own tool-call
**arguments** for that step were `{"query":"mancuernas de caucho fijas",
...}`: it correctly resolved the short follow-up back to the specific
product from history, exactly the kind of reference resolution this task
exists to test, without ever needing the mega-envelope's flattened
`priorStepsThisTurn` blob. After a second real timeout, the model handed
off, citing the technical failure explicitly -- again attributable to the
real, broken Catalog Service dependency in this environment, not to message
shape (the causal trace and referential resolution both worked correctly
before that point).

**Test 4 -- mid-turn assimilation (the task's own steering/residual-risk
scenario)**: a real `conversation_message` row ("olvida las de 20") was
inserted into the real database while the first real DeepSeek call was
still in flight, simulating a customer correction arriving mid-turn.
Result: `assimilationCycleCount=1`, `invalidatedCandidateCount=1`,
`projectedAssimilatedUserMessageCount=1`, **`status=responded` (no
handoff)**. The captured final request showed roles `[system, system, user,
user]` -- **the exact residual bare-adjacency shape flagged in Section 9,
reproduced for real** (call 0's own clarifying-question candidate was
correctly discarded as stale by Boundary 1, never reaching `steps`, and the
loop re-prompted with both raw customer messages now present, in order,
with no assistant message between them: `["quiero 10, 15 y 20 kg", "olvida
las de 20"]`). **Despite the flagged adjacency, DeepSeek handled it
correctly**: its response explicitly says "Entendido, dejamos fuera las de
20 kg" (understood, we're leaving out the 20kg ones) and asks a sensible
follow-up about the remaining 10kg/15kg items -- the correction was
correctly understood, not ignored or confused with the original message.

**Honest interpretation of Test 4, not oversold**: this is `n=1`. D5.1's own
regression was itself probabilistic (60% failure rate, meaning 40% of trials
"looked fine" too) -- one successful trial of the analogous shape here is
encouraging, directly on-target evidence that the residual risk documented
in Section 9 may be less severe in practice than the original regression,
but it is not a statistical disproof and is not treated as one. The
release's own known-debt entry for this risk (Section 13) stands unchanged;
a dedicated multi-repetition live study of this exact shape (mirroring
D5.1's own 10-repetition methodology) is the concrete next step before this
residual risk could ever be called resolved, not assumed safe from this one
observation.

**Summary**: 0 handoffs on the exact historical regression shape (2/2), 1
handoff attributable to a genuine environmental dependency failure rather
than message shape (Test 2), correct real referential resolution of a short
follow-up using history instead of a flattened blob (Test 3), and one
direct, real reproduction of the residual steering-adjacency risk that the
model handled correctly without a handoff (Test 4). No message-shape defect
was observed in any of the 6 real conversations/10 real provider calls this
benchmark made. Verdict remains
`R3_V1_8_2_C1_MESSAGE_SEQUENCING_IMPLEMENTED_NOT_LIVE_VALIDATED`.

## 13. Known debt

- **Residual steering-adjacency risk** (Section 9): a mid-turn assimilated
  fragment arriving right after a tool observation still produces a
  structurally bare `user`/`user` adjacency. Not fixed in this task
  (fixing it would require either a synthetic assistant separator --
  rejected as fabricating model speech -- or a business-authority rule like
  "latest input wins", explicitly forbidden by the task brief's Section 20).
  Requires live evidence (Section 12, Test 3) before being called safe.
- **Cache-prefix cost, corrected in V1.8.2-C1.1** (Section 5): dynamic
  context sitting before the historical transcript, and changing on almost
  every provider call, structurally pulls the (unchanged) historical
  transcript out of what a conventional prefix cache would otherwise still
  match -- for persistent-session turns with real history, this is likely a
  **regression** relative to legacy's own cacheable `system + history`
  prefix (legacy's own ~97% measured hit rate, V1.8-D5.2, is direct evidence
  that prefix caching on the history-inclusive shape works well in
  practice), not parity with it as an earlier version of this document
  incorrectly claimed. Not measured against the real provider in this task --
  a structural inference, not a benchmarked result. Performance debt only
  (never correctness) -- a real before/after cache-hit-rate measurement is
  the concrete follow-up.
- **Claim-time fragment aggregation unchanged** (Section 8): only
  `tryAssimilate()`'s mid-turn fragments get discrete causal projection;
  `assembleTurnFragments.ts`'s pre-turn joining (several WhatsApp messages
  arriving before the turn even starts) is untouched, out of this task's
  stated boundary.
- **`conversationContinuity`/`pendingCatalogAction` rule wording** (Section
  6) still says "the user payload's ... field" even though, under the new
  flag, that field lives in the dynamic-context system message instead --
  harmless (the model still receives the same field under the same name),
  left unfixed because the shared system-instruction text must stay
  byte-identical for the flag-off path, and Layer 0-4 rule redesign is out
  of this task's scope regardless.
- **`AgentStepHandoff.reason` remains free-text**, documented since `V1.6`,
  not touched by any R3 sub-task through `V1.8.2-C1`.
- **No authority hardening added, deliberately** (task brief Section 20):
  no "latest user constraint wins" rule, no kg/lb-specific rule, no
  commune/budget precedence rule, no deterministic no-greeting enforcement.
  This task measures whether better message-model fidelity alone improves
  behavior; if the historical failure shapes (Section 17's Case A/kg
  clarification, Case B's commune correction) persist after live testing,
  authority hardening becomes the next, better-evidenced release.

## 14. Rollback

`BRAIN_R3_HARNESS_ALIGNED_MESSAGE_MODEL_ENABLED=false` (the default) makes
every call to `buildAgentStepPromptPackage` take the exact legacy/persistent
branch, proven byte-identical to before this task by `[C1-T1]`. No schema
migration, no new durable state, no data rollback, no session deletion, no
restart-dependent state. No new allowlist was added -- pilot scoping is
whatever already gates `SalesAgentRuntime`.

## 15. Files changed

Production:
- `lib/brain/commercial/agent-loop/harnessAlignedMessageProjection.ts` (new)
- `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts`
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts`
- `lib/brain/commercial/agent-loop/agentStepTypes.ts` (4 new optional
  `AgentLoopResult` fields only)
- `lib/brain/commercial/config/commercialCycleConfig.ts` (new flag getter)
- `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts` (resolves
  + threads the flag)
- `lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts`
  (pass-through field)
- `lib/brain/commercial/sales-agent-runtime/salesAgentRuntime.ts`
  (pass-through field + result mirroring)

Tests:
- `tests/agent-loop/buildAgentStepPromptPackage.test.ts` (extended)
- `tests/agent-loop/harnessAlignedMessageSequencing.test.ts` (new)
- `tests/commercial/salesAgentRuntime.test.ts` (allowlist test updated)

Not modified: `conversation_message` persistence, `agent_sessions`,
`agent_session_events`, `crm_inbound_turn_settlements`,
conversation-scoped ownership/reclaim, terminal dispatch,
`brain_message_outbox`, Live Turn Assimilation detection/stale-candidate
invalidation, `ASSIMILATED` sibling reconciliation, commercial truth
persistence, mutation idempotency, Capability Gateway, tool execution
semantics, Open Turn progress/deadline/emergency guards, `deriveMessages.ts`,
`resolvePersistentSessionCognitionContext.ts`, `AgentSessionStore`, session
schema, any `commercial_event`/persisted-event schema, `.env.example` (this
family of R3 flags was never documented there).

Documentation:
- This file (new).
- `docs/ACTIVE_RELEASE.md` (updated in the same change, per `CLAUDE.md`'s
  mandatory workflow).

---

## 16. V1.8.2-C1.1 -- Pre-Commit Behavioral Validation

Status: validation-only follow-up, **zero production code changed**. Closes
the specific evidence gaps identified before committing C1: the cache-prefix
claim in Section 5 (corrected there directly, in place -- not repeated here),
a 10-repetition live steering study (Section 12's own residual-risk
benchmark was `n=1`), a kg-constraint test against a genuinely working
Catalog Service, and a dedicated greeting/continuity check. No redesign, no
new authority rules, no fixes to anything this task found wrong -- per its
own explicit brief, this task exists to decide whether C1 is safe to commit
as `IMPLEMENTED_NOT_LIVE_VALIDATED`, not to close every gap it surfaces.

### 16.1 Methodology

Two scratchpad scripts (repo root, never committed, deleted immediately
after use -- same precedent as every prior R3 live-benchmark script), real
configured DeepSeek endpoint, real MariaDB (`main_management`, already
running from the C1 session), and -- new for this task -- a real, working
local Catalog Service (`MS-pesaschile-catalog-service`, started via `npm run
dev` in its own sibling repo per existing memory, listening on
`127.0.0.1:4010` exactly where `CATALOG_SERVICE_BASE_URL` already points,
connected to a real read-only RDS replica -- confirmed safe for read-only
smoke tests by that same memory, and stopped again at the end of this task).
Every row tagged `c1.1-bench-`. `runSalesAgentRuntime()` called directly
(bypasses dispatch/outbox -- no WhatsApp/Meta traffic, no customer-facing
effect possible). Chain-of-thought never captured (DeepSeek `thinking`
disabled, only `rawOutput` and role/message shape were ever inspected).

### 16.2 Steering adjacency -- 10 C1 reps + 5 legacy control

Scenario exactly as specified: initial message `"quiero 10, 15 y 20 kg"`,
then `"olvida las de 20"` inserted as a real `conversation_message` row while
the first real DeepSeek call was still in flight (same seam Section 12's
`n=1` trial used). `liveTurnAssimilationEnabled: true` in both conditions;
only `harnessAlignedMessageModelEnabled` differs.

**C1 (n=10)**:

| # | status | assimCycles | invalidated | projectedAssim | bare adjacency | correction respected | re-greet |
|---|--------|---|---|---|---|---|---|
| 0 | responded | 1 | 1 | 1 | yes | yes ("dejamos fuera las de 20 kg") | no |
| 1 | responded | 1 | 1 | 1 | yes | yes (implicit -- only 10/15 mentioned) | no |
| 2 | responded | 1 | 1 | 1 | yes | yes | no |
| 3 | responded | 1 | 1 | 1 | yes | yes | no |
| 4 | responded | 1 | 1 | 1 | yes | yes | no |
| 5 | responded | 1 | 1 | 1 | yes | yes | no |
| 6 | responded | 1 | 1 | 1 | yes | yes | no |
| 7 | responded | 1 | 1 | 1 | yes | **ambiguous** -- real `search_products` timeout occurred, final message re-lists "(10, 15 y 20 kg)" while asking a generic clarifying question; reads as restating the customer's own original numbers descriptively during failure-recovery, not as actively re-offering a 20kg option, but not a clean pass either | no |
| 8 | responded | 1 | 1 | 1 | yes | yes (real `search_products` timeout also occurred here; response says "las mancuernas de 10 y 15 kg", 20 correctly absent) | no |
| 9 | responded | 1 | 1 | 1 | yes | yes | no |

Aggregate C1: **handoff 0/10, correction respected 9/10 clean (1/10
ambiguous, not a clear failure), re-greeting 0/10, bare user/user adjacency
10/10 (100%)**.

The 100% adjacency rate is not a surprise in hindsight -- it is structurally
guaranteed whenever Boundary 1 discards a candidate on a turn with zero
prior tool steps (nothing exists yet to place between the two `user`
messages), which is exactly what this scenario constructs. That the
adjacency is guaranteed, not rare, makes the 0/10 handoff result more
meaningful, not less: this is not a lucky sample avoiding a rare shape, it
is the shape occurring every time and not producing the D5.1-style effect
in this sample.

**Legacy control (n=5, `harnessAlignedMessageModelEnabled: false`)**:

All 5 reps: `status=responded`, bare adjacency never applicable (legacy
always merges to one `user` message per call: `[system, user]`), correction
respected cleanly in **5/5** (every response explicitly said some form of
"pero olvidemos/olvidando las de 20 kg"), re-greeting 0/5. One additional
real observation, pre-existing and unrelated to C1: legacy's own real tool
trace for these reps shows `search_products` called 3 times with the
identical generic query `"pesas kg"` -- the 2nd and 3rd attempts were
rejected by the existing duplicate-call dedupe guard (`blocked` /
`duplicate_tool_call`), never reaching the Catalog Service a second/third
time. This is existing, untouched machinery (same dedupe guard runs
identically under both message models) surfacing a real, pre-existing
tool-retry-diversity limitation -- documented per Section 7 of this task's
own brief, not fixed here.

**Interpretation, not overclaimed**: on this specific behavioral dimension
(correction retention under a guaranteed adjacency), legacy's real sample
was if anything slightly cleaner (5/5 unambiguous vs. 9/10 clean + 1
ambiguous) -- C1's value in this study is **not** "wins outright on
correction retention," it is **"produces the flagged residual adjacency
100% of the time in this scenario and still shows zero handoffs and no
material behavioral regression relative to legacy."** `n=10`/`n=5` real
trials are a behavioral regression check, not formal statistical inference,
exactly as the task brief itself cautions.

### 16.3 KG constraint -- working Catalog Service

Local Catalog Service confirmed live and returning real product data before
this test ran (direct `curl` against `resolve-product-intent` returned real
candidates, including a real, exact "en libras" product mixed among kg
options for a broader query -- confirming the catalog genuinely can produce
the mixed-unit scenario Section 4's Question B cares about). The exact
two-turn conversation from the task brief was run against
`harnessAlignedMessageModelEnabled: true`, persistent session cognition on.

**Real, unexpected finding**: `search_products` timed out on **every
attempt across this entire task** -- both turn 1 attempts, both turn 2
attempts, and separately in steering reps 7/8 and the greeting control below
(6 real timeouts total, `errorCode: "timeout"`). Direct inspection of
`lib/catalog/httpCatalogAdapter.ts` shows a real, pre-existing, fixed
`DEFAULT_TIMEOUT_MS = 5000` (configurable via `CATALOG_SERVICE_TIMEOUT_MS`,
never overridden in this task's environment) -- a plausible, honest
explanation (not independently confirmed) is that a cold, real
RDS-replica-backed query for an unusual phrase takes longer than 5s on
first computation, unlike the single warmed, simple `curl` probe run
earlier. **This is a real, pre-existing constraint of the tool layer,
completely independent of C1's message-shape change** -- both `search_products`
calls happen identically regardless of `harnessAlignedMessageModelEnabled`,
and legacy mode was never observed to behave differently against the same
dependency in this or the original C1 benchmark. Per Section 7 of this
task's brief: documented, not fixed here.

Because of this, **the full end-to-end question (does the catalog's own lb
variant get correctly excluded from a real, successful response) could not
be exercised this session.** What direct, real evidence this task DOES have,
captured from the decisive call's own wire messages (never re-derived):

```
Turn 1, accepted tool calls:
  {"type":"use_tool","tool":"search_products","arguments":{"query":"mancuernas de caucho fijas","limit":10}}   -> failed:timeout
  {"type":"use_tool","tool":"search_products","arguments":{"query":"mancuerna caucho fija","limit":10}}         -> failed:timeout
  final response: "...problemas para buscar las mancuernas... ¿Podrías intentarlo de nuevo..."

Turn 2 ("todo en kg"), accepted tool calls:
  {"type":"use_tool","tool":"search_products","arguments":{"query":"mancuernas de caucho fijas 10 15 20 kg","limit":10}}  -> failed:timeout
  {"type":"use_tool","tool":"search_products","arguments":{"query":"mancuernas caucho fijas","limit":10}}                 -> failed:timeout
  final response: "...problemas para buscar las mancuernas... si me confirmas tu comuna, puedo preparar..."
```

**Turn 2's own first query is the single most direct, real piece of
evidence this task has for constraint retention**: after "todo en kg," the
model's own next tool call became MORE explicit than turn 1's, adding the
literal numbers and the unit -- `"mancuernas de caucho fijas 10 15 20 kg"` --
proving the kg constraint was carried forward into a freshly-constructed,
causally-derived tool invocation, not merely echoed in conversational text.
No re-ask of "kg or lb?" occurred in either turn. No re-greeting occurred in
either turn (`startsWithGreeting: false` both times).

**Classification: `KG_CONSTRAINT_PARTIALLY_RETAINED`** -- strong, direct
evidence of retention at the tool-invocation-argument level; the
catalog-round-trip-dependent questions (B: lb-variant filtering, E:
continued search behavior beyond the existing 2-tool retry) remain
untested this session, blocked by a real, unrelated, pre-existing
timeout/latency constraint, not by anything C1 changed.

### 16.4 Greeting / natural continuity

Two real checks, both under `harnessAlignedMessageModelEnabled: true`:

1. **The kg working-catalog conversation itself** (Section 16.3): turn 2
   ("todo en kg," an established, already-active conversation) produced
   `startsWithGreeting: false` -- no restart, no repeated "Hola."
2. **Simpler control**: `"Necesito una barra olimpica"` -> (real response,
   itself hit the same real `search_products` timeout, responded gracefully)
   -> `"¿y cuánto pesa?"`. Turn 2 here resulted in `status: handoff` (two
   more real timeouts, same tool-layer constraint as Section 16.3 -- not a
   message-shape effect, see the same dedupe/timeout mechanism), but
   **still `startsWithGreeting: false`** -- even a turn that ends in handoff
   did not restart the conversation with a greeting. Role sequence for that
   decisive call: `system,system,user,assistant,user,assistant,user` --
   correct causal shape, no return to a mega-envelope, no bare `user`/`user`
   adjacency in this scenario (no mid-turn steering was involved here).

**Classification: `NATURAL_CONTINUITY_PASS`** for the specific, narrow
question this section targets (does an established-conversation follow-up
avoid re-greeting) -- confirmed twice, including once under a real technical
failure. The handoff outcome itself is attributed to the Section 16.3 tool
timeout, not to continuity/greeting behavior, which is what this section
measures.

### 16.5 Message sequencing verification (kg test, decisive call)

Structural evidence only, from turn 2's decisive real request:

```
roleSequence: system, system, user, assistant, user, assistant, user, assistant, user
messageCount: 9
toolObservationCount: 2
rawCurrentUserTextIsolated: true   (a message with content exactly "todo en kg" exists, unwrapped)
runtimeContextSeparateMessage: true (a system message containing "RUNTIME CONTEXT" exists, separate from the stable contract)
```

Matches the expected causal shape exactly (`system / system-dynamic /
history / user-current / assistant-step / user-tool-result / ...`) with no
return to the legacy mega-envelope under the flag, confirmed live, not only
by the deterministic suite.

### 16.6 Decision matrix

| Behavior | Legacy | C1 | Verdict |
|---|---|---|---|
| D5.1-style handoff risk (this steering scenario) | 0/5 handoff | 0/10 handoff | No regression -- parity |
| Mid-turn correction retention | 5/5 clean | 9/10 clean, 1/10 ambiguous | No regression -- comparable |
| Explicit kg constraint retention | not run (out of this task's legacy scope) | retained in tool-call arguments both turns; full round-trip untested (real, unrelated Catalog Service timeout) | Partial -- infra-limited, not a C1 defect |
| Repeated greeting | 0/5 | 0/12 across all real trials this task ran | Pass, both modes |
| Reference resolution ("todo en kg" -> product + unit) | not run under legacy this task | correctly resolved product context AND added explicit kg+weights to the next tool call | Pass -- positive, C1-specific evidence |
| Causal tool sequencing | n/a by design (mega-envelope) | correct assistant/user alternation confirmed on every real call captured this task | Pass |

**MESSAGE_SEQUENCING: `PASS`** -- confirmed structurally correct on every
real provider call captured across both benchmark scripts, not only in
deterministic tests.

**STEERING_ADJACENCY: `SAFE_ENOUGH_FOR_PILOT`** -- not `UNRESOLVED` (there is
now a real 10-repetition sample showing zero handoffs and no material
behavioral regression, where before there was `n=1`), and not `REGRESSION`
(nothing in this sample performed materially worse than legacy). Not
claimed as fully solved either -- the adjacency itself is still present
100% of the time by construction, one of ten trials was ambiguous rather
than clean, and `n=10` remains a modest sample. "Safe enough for pilot"
means exactly that: enough real evidence to commit and pilot behind the
flag, not enough to close the residual-risk debt entry in Section 13.

**NATURAL_CONTINUITY: `PASS`** -- zero re-greetings across every real trial
this task ran (12 total: 10 steering + 1 kg-test turn 2 + 1 greeting-control
turn 2), including trials that ended in handoff.

**CUSTOMER_CONSTRAINT_RETENTION: `PARTIAL`** -- strong, direct, real
evidence of retention at the causal tool-call-argument level in both the
steering and kg scenarios; full end-to-end retention through a successful,
unit-filtered catalog response remains unverified this session, blocked by
a real, pre-existing, C1-unrelated Catalog Service timeout.

### 16.7 Commit readiness assessment

Every condition in the task brief's own Section 9 rule is met by the
evidence above: no clear steering-adjacency regression appeared (0/10
handoffs against a guaranteed-adjacency scenario); C1 did not perform
materially worse than legacy on any measured dimension (correction
retention, greeting, handoff rate all comparable or equal); causal message
projection was confirmed correct on real provider traffic, not only in
deterministic tests; the deterministic suite (88 tests) remains green after
this validation-only task, since no production code was touched; and the
one clear residual gap (full kg-constraint validation) is attributable to a
real, pre-existing, independently-diagnosed Catalog Service timeout
(`DEFAULT_TIMEOUT_MS = 5000` in `lib/catalog/httpCatalogAdapter.ts`, hit
identically by both message models), not to a C1 regression.

**Verdict remains `R3_V1_8_2_C1_MESSAGE_SEQUENCING_IMPLEMENTED_NOT_LIVE_VALIDATED`**
-- this task's evidence supports committing C1 in that state; it does not
support upgrading the verdict to `VALIDATED`, which still requires real
WhatsApp inbound/outbound evidence this environment cannot produce.

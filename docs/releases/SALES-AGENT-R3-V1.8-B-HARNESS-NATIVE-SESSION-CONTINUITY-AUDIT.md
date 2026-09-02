# SALES-AGENT-R3-V1.8-B -- Harness Native Session Continuity Audit

Status: audit complete, no production code changed. One new, isolated,
already-executed characterization scenario added under
`experiments/deepseek-harness/` (a pre-existing, git-hygiene-isolated
sandbox from `SALES-AGENT-R2-A13-H0`, excluded from the main `tsconfig.json`
and never imported by `lib/`/`app/`). No schema, flag, or prompt in
production changed.

## 1. Executive verdict

**`HARNESS_SESSION_CONTINUITY_NATIVE_FULL`** (for the Harness package's own
native capability, proven by source inspection of the exact installed
version) -- **with a load-bearing separate finding that reframes the whole
question**:

**R3 does not use the Harness at all today - not correctly, not
incorrectly. There is zero runtime import of `@deepseek-ai/*` anywhere
under `lib/` or `app/`, and zero entry in the main repo's
`package.json`/`package-lock.json`** (verified by exhaustive grep, section
12). The Harness exists in this repository only inside
`experiments/deepseek-harness/`, a self-contained sandbox with its own
`package.json`/`node_modules`, built for a one-time architecture bake-off
(`SALES-AGENT-R2-A13-H0`, `docs/architecture/A13-H0-deepseek-harness-bakeoff.md`)
whose own Phase 5 verdict was `HYBRIDIZE_WITH_HARNESS`: adopt the
**pattern** (iterative tool-calling loop + persistent session + prompt
caching), not the **package** - explicitly because
`lib/brain/commercial/agent-loop/runAgentToolLoop.ts` already existed as
"its own sibling runtime built on the identical pattern"
(A13-H0 doc, Phase 5, "What becomes the conversational authority").

So the central question this audit was asked to resolve --
"R3 needs memory" vs. "R3 already has a Harness with memory it's misusing"
-- has a third, more precise answer:

**R3 adopted half of the Harness's validated pattern (the iterative
tool-calling loop) and never adopted the other half (the persistent,
incrementally-extended session that the model reads directly from, with
native compaction/checkpointing/token metering).** `runAgentToolLoop.ts`
rebuilds its entire request from scratch on every provider call
(`docs/releases/SALES-AGENT-R3-V1.8-A-CONVERSATIONAL-CONTEXT-INPUT-AUDIT.md`,
section 4) instead of appending to a growing session object the way the
real Harness's `agent.followup()` does. This is not a bug introduced by
misusing the Harness - R3 never touched the Harness's session API at all.
It is a design gap in R3's own custom loop, now newly informed by concrete,
live evidence of what the validated alternative pattern actually does
(section 6 below).

## 2. Installed Harness/package/version

- Package family: `@deepseek-ai/dsh-*` ("DeepSeek Harness"), a real,
  separate open-source project (`github.com/deepseek-ai/deepseek-harness`),
  MIT-licensed, published to npm 2026-08-13.
- Installed version (verified directly from `node_modules`, not assumed):
  **`0.1.1-rc.2`**, consistently across all ~140 `@deepseek-ai/dsh-*`
  packages plus `@deepseek-ai/cordis@4.0.2` (the underlying
  dependency-injection/effect framework). Explicitly labeled "developer
  preview" by the vendor as of A13-H0's own investigation two days before
  this audit.
- Location: `experiments/deepseek-harness/node_modules/@deepseek-ai/` -
  **not** in the main repo's `node_modules`, `package.json`, or
  `package-lock.json` (zero matches, section 12).
- Exact declared dependency set: `experiments/deepseek-harness/package.json`
  (`@deepseek-ai/cordis@^4.0.2`, `@deepseek-ai/dsh-app-boot@^0.1.1-rc.2`,
  `@deepseek-ai/dsh-base@^0.1.1-rc.2`, plus five smaller cordis-plugin
  packages and `dsh-home-paths`/`dsh-invariants`/`dsh-launch-environment`/
  `dsh-llm`/`dsh-system-prompt`).
- Exact imports actually used by this repo's own harness sandbox code:
  - `import type { Context } from "@deepseek-ai/cordis";` [`harness/bakeoffRunnerPlugin.ts:12`]
  - `import { createUserMessage } from "@deepseek-ai/dsh-llm";` [`harness/bakeoffRunnerPlugin.ts:13`]
  - `import { boot, loadOverlayPatches } from "@deepseek-ai/dsh-app-boot";` [`harness/bootBakeoff.mts:8`]
- Public API surface actually exercised (all from `ctx.agents`, the
  documented extension point, per `dsh-agent/lib/types/index.d.ts`):
  `ctx.agents.create({sessionId, agentOptions})`, `agent.followup(message)`,
  `agent.whenIdle()`, `agent.session.events`, `agent.session.deriveMessages()`,
  `handle.dispose()` [`harness/bakeoffRunnerPlugin.ts:60-89`].
- Public API surface that exists in the installed package but was **not**
  exercised by this repo's prior bake-off or by this audit's new scenario:
  `ctx.agents.resume({resumeSessionId, ...})` and `CreateAgentOptions.seed`
  (fork/clone lineage) - both fully documented in
  `dsh-agent/lib/types/index.d.ts` (quoted verbatim in section 4 below).

## 3. Native Agent lifecycle

Traced from `dsh-agent/lib/types/index.d.ts` and this repo's own
`harness/bakeoffRunnerPlugin.ts:41-104` (the only place in this repository
that drives a real Harness Agent through multiple turns):

1. **Is an Agent created per inbound?** No. One `AgentRegistry.create()`
   call per **conversation** (`sessionId: \`bakeoff-${scenario.id}\``,
   `bakeoffRunnerPlugin.ts:60`), reused for every subsequent turn.
2. **Per conversation?** Yes - exactly one `handle.agent` object is created
   before the turn loop starts and held in a local variable for its entire
   lifetime (`bakeoffRunnerPlugin.ts:61-71`).
3. **Conserved in memory between requests?** Yes, within one process: the
   same `agent` variable is reused across the `for (const [turnIndex,
   turnText] of scenario.turns.entries())` loop - `agent.followup(message)`
   is called repeatedly on the identical object.
4. **Registry/cache of agents?** Yes - `AgentRegistry` (`ctx.agents`)
   tracks every live agent by `SessionId`, exposes `.get(id)`, `.list()`,
   `.roots()` [`dsh-agent/lib/types/index.d.ts`, `AgentRegistry` class].
5. **Stable Agent/session identifier?** Yes - `sessionId` is caller-supplied
   at creation (a branded `SessionId` type with no public constructor) and
   is the same value used to key both the live registry entry and (when
   enabled - see section 7) the persisted session store.
6. **What destroys/finalizes the Agent?** `handle.dispose()`
   [`bakeoffRunnerPlugin.ts:89`, called once, after all turns] - per its own
   doc comment: "stops the loop, awaits its exit, unregisters the agent,
   removes its session from the store, and finally unwinds its scoped
   world" [`dsh-agent/lib/types/index.d.ts`, `AgentHandle` doc comment].
   Nothing disposes the Agent between turns.
7. **What happens after one turn ends?** `await agent.whenIdle()` resolves;
   the Agent object, its `session.events` array, and its internal inbox
   state all remain live and unchanged in memory, ready for the next
   `agent.followup()` call - proven directly by the raw event log (section
   6): turn 2's only inbox mutation is inserting the new user message, not
   rebuilding anything.

**Graph, with same/different-object marking:**

```
WhatsApp-analogue inbound (turn 1)
  -> ctx.agents.create({sessionId})     <- Agent object A created ONCE
  -> agent.followup(turn1Message)        )
  -> agent.whenIdle()                    ) same object A, same process
  -> response read from agent.session    )
next inbound (turn 2)
  -> agent.followup(turn2Message)        )  <- SAME object A, not recreated
  -> agent.whenIdle()                    )
  -> response read from agent.session    )
... (turns 3, 4 identical - same object A)
end of conversation
  -> handle.dispose()                    <- object A torn down
```

**The Agent object of turn N is the same object as turn N+1**, for every
turn within one process lifetime. This is the single most important
structural fact this audit found, and it is the opposite of R3's own
`runAgentToolLoop()`, which is a plain async function invoked fresh per
turn with no persistent object at all (`salesAgentRuntime.ts:208`, a new
`await runAgentToolLoop(loopInput)` call every turn, nothing held between
calls).

## 4. Native Session lifecycle

`agent.session` is a live object, not a snapshot. Evidence, both from the
type contract and from a real executed transcript (section 6):

- **How it's created**: implicitly, by `AgentRegistry.create()` alongside
  the Agent, under the same `sessionId`. `CreateAgentOptions.seed?:
  readonly SessionEvent[]` optionally supplies "Initial replay/fork
  history. A fork supplies a balanced completed-turn prefix of the parent's
  log" [`dsh-agent/lib/types/index.d.ts`] - this **is** the clone/fork API
  the task asked about.
- **Where it lives**: in-process, as `agent.session`, for the Agent's
  lifetime; additionally durably on disk when `session-persistence-jsonl`
  is mounted (default in `dsh-base`, see section 7).
- **What it contains / what events it persists**: a raw, append-only event
  log (`agent.session.events`), proven by a real run (`V18B-01.harness.json`,
  section 6) to include `user/message`, `assistant/message` (full content
  blocks: text, `reasoning`, `tool-call`), `tool/call`, `tool/result`,
  `agent/inbox/spliced` (the actual queue-mutation primitive),
  `turn/start`/`turn/end`, `step/start`/`step/end`, `request/header`,
  `request/context`, `session/title`, and `assistant/chunk` (streaming
  deltas). **This includes customer messages, assistant messages (including
  the model's own chain-of-thought `reasoning` blocks), tool calls, and
  tool results** - a strictly richer content set than R3's
  `AgentSessionStore`, which by explicit design never persists message text
  or reasoning at all
  (`docs/releases/SALES-AGENT-R3-V1.8-A-CONVERSATIONAL-CONTEXT-INPUT-AUDIT.md`,
  section 3, `shadowRecorder.ts:9-13`).
- **Is `session.events` a full transcript or just an event log?** It is a
  **raw event log**, not a ready-made chat-role transcript. The actual
  role-based message list is produced on demand by a separate method,
  `agent.session.deriveMessages()` [called at `bakeoffRunnerPlugin.ts:76`],
  which transforms the raw event stream into `{role, content}` messages.
  This answers the task's own explicit question precisely: events and
  transcript are two different, related artifacts, and the harness exposes
  a documented function to go from one to the other rather than requiring
  the integrator to reconstruct it.
- **Summary/compaction internal to the session?** Yes - see section 7
  (`dsh-compaction-basic`, `dsh-compaction-tool-result-pruner`, both
  mounted by default in `dsh-base`).
- **Token trimming?** Yes, native (`dsh-token-meter`, mounted by default,
  section 7) - feeds the compaction threshold decision.
- **Own short-term memory beyond the session?** None found beyond the
  session/compaction/checkpoint stack itself - no separate "working memory"
  construct exists in the installed package's type surface.

**Serialize / load / resume / clone-fork / restore-from-events / export-import**,
searched exhaustively across `dsh-agent`, `dsh-session`,
`dsh-session-persistence`, `dsh-session-persistence-jsonl`,
`dsh-agent-loop` type declarations:

| Capability | Exists? | Evidence |
|---|---|---|
| Serialize session | Yes | `dsh-session-persistence-jsonl` writes the event log to disk in JSONL form (one durable file per session, section 7). |
| Load / resume session | Yes | `AgentRegistry.resume(options: ResumeAgentOptions)` - `resumeSessionId: SessionId`. Doc comment: "Load a persisted session and resume an agent on it through the registered factory. Rejects if no factory is registered; the factory rejects if session persistence is not configured or persistence/setup fails." [`dsh-agent/lib/types/index.d.ts`, `AgentRegistry.resume` + `AgentFactory.resume`]. |
| Clone/fork session | Yes | `CreateAgentOptions.seed`/`meta.parentSession` - "A fork supplies a balanced completed-turn prefix of the parent's log" [same file, `CreateAgentOptions` doc comment]. |
| Restore from events | Yes | This is exactly what `seed`/`resume` do - both take/load `SessionEvent[]` and replay them to reconstruct live state. |
| Export/import state | Yes, as a byproduct | The persisted JSONL file (section 7) is a plain, inspectable export format; `deriveMessages()` is the documented import-to-messages path. |

## 5. Native multi-turn mechanism (`followup`/`whenIdle`)

Exact code, `harness/bakeoffRunnerPlugin.ts:60-89` (this repo's own,
already-existing driver, unmodified by this audit except for adding one new
scenario entry, section 9):

```ts
const handle = await ctx.agents.create({ sessionId, agentOptions });
const agent = handle.agent;
for (const turnText of scenario.turns) {
  const message = createUserMessage({ content: [{ type: "text", text: turnText }], source: { kind: "user" } });
  agent.followup(message);
  await agent.whenIdle();
  const messages = agent.session.deriveMessages();
  // ...
}
await handle.dispose();
```

Answers:

1. **Does the next message enter the same logical context?** Yes - it is
   spliced directly into the SAME agent's inbox (`agent/inbox/spliced`,
   proven in section 6).
2. **Does the Harness automatically incorporate prior history?** Yes,
   structurally - there is nothing to "incorporate" because the history was
   never removed. `followup()` does not resend anything; it appends one new
   message to a state that already contains everything before it.
3. **What history exactly?** Everything in `agent.session.events` that has
   not been compacted away yet (section 7) - customer messages, assistant
   messages (including reasoning), and every tool call/result, per section
   4.
4. **Does it need the same Agent object to stay alive?** Yes, for the
   in-process `followup()`/`whenIdle()` path. For a **new** process, the
   equivalent is `resume()` (section 4), not `followup()`.
5. **Can it rehydrate a session after a process restart?** Yes, natively,
   via `resume()` + `dsh-session-persistence-jsonl` (section 4/7) - not
   independently re-executed in this audit (see section 15).
6. **Can a new Agent operate on an existing Session?** Yes - that is
   precisely what `resume()` is: a **new** `Agent` object, in a possibly
   **new** process, bound to a **pre-existing**, persisted `Session`.

## 6. Exact context behavior between turns - live evidence

Rather than reason abstractly, this audit ran a new, isolated, four-turn
characterization scenario through the real installed Harness (no
production code, no database, no Meta, no mutating tool - only the four
pre-existing read-only bake-off tools), using the exact turns specified by
this task:

```
Turn 1: "Estoy buscando una barra olimpica de 20 kg para home gym"
Turn 2: "Muestrame varias opciones"
Turn 3: "Ahora dime que colchonetas tienen"
Turn 4: "Volvamos a la barra anterior"
```

Added as scenario `V18B-01` in
`experiments/deepseek-harness/scenarios/bakeoff-scenarios.json` (additive
only - none of the existing 20 `H0-*` scenarios were touched). Executed
with the real DeepSeek API (`deepseek-v4-flash`, the same account/model
family production uses) via `harness/bootBakeoff.mts`, Node 24.14.0
(required - `@deepseek-ai/dsh-agent-loop` needs `Promise.withResolvers`,
absent on this repo's ambient Node 20.19.0; invoked directly from the
already-installed `nvm4w` cache, never changing the shell's default
Node). Result saved to `experiments/deepseek-harness/results/V18B-01.harness.json`
(gitignored, like every other bake-off result).

**Result, turn by turn:**

| Turn | Customer message | Tool calls made | Assistant response (summarized) |
|---|---|---|---|
| 1 | "...barra olimpica de 20 kg para home gym" | `search_products("barra olimpica 20 kg")`, `get_customer_context()` | Grounded a single product: Barra Olimpica 20kg, $129.990, in stock. |
| 2 | "Muestrame varias opciones" | `search_products("barra olimpica")`, `search_products("barra")`, `search_products("barra 20kg")` | Presented **both barbell options** (15kg and 20kg) with a comparison - stayed anchored to the barbell topic, never broadened to generic home-gym equipment (racks/benches/dumbbells). |
| 3 | "Ahora dime que colchonetas tienen" | `search_products("colchoneta")`, `search_products("mat")`, `search_products("tapete")`, `search_products("yoga")` | Honestly reported zero matches across four query variants - no hallucinated product, explicit real topic switch. |
| 4 | "Volvamos a la barra anterior" | **none** | Correctly recalled **both** barbell options from turns 1-2 without re-searching, explicitly noted "(la que mencionaste primero)" for the 20kg one. |

**This turn-1/turn-2 pair is the direct analogue of the real production
incident this whole V1.8 audit series investigates**
(`docs/releases/SALES-AGENT-R3-V1.8-A-CONVERSATIONAL-CONTEXT-INPUT-AUDIT.md`,
section 6: turn 178 "que barras olimpicas tienen?" -> turn 180 "...barra
olimpica de 20kg para home gym" -> turn 182 "me puedes dar varias opciones
para home gym", where R3 broadened to generic home-gym products). Here,
under the same shape of ambiguous, broadening customer phrasing ("muestrame
varias opciones" with no explicit product noun), the Harness's session-native
architecture stayed anchored to the specific, already-established topic
(barbells) instead of broadening to the literal, wider "home gym" phrase
used one turn earlier. Turn 4 then demonstrates full survival of that
context across an intervening, genuinely unrelated, tool-calling topic
detour (mats) with **zero** re-search - the answer came entirely from
already-accumulated session state.

**Raw event evidence for "how":** the raw event log
(`agent/inbox/spliced`) shows each subsequent turn's only mutation is
inserting the single new user message - never a rebuild, never a resend of
prior turns:

```json
{ "type": "agent/inbox/spliced", "data": { "target": "next-turn", "start": 0,
    "inserted": [ { "content": [{"type":"text","text":"Quiero una barra olimpica"}],
      "role": "user", "id": "..." } ] } }
```

**Token/cache evidence** (from `assistant/message.data.usage` across the 8
real model calls this scenario made):

| Metric | Value |
|---|---:|
| Total fresh input tokens (`inputTokens`, non-cached) | 2,065 |
| Total cached-prefix tokens reused (`cacheReadTokens`) | 15,232 |
| Total output tokens | 1,530 |
| Total reasoning tokens | 586 |
| `request/header`/`request/context` events for the whole 4-turn run | **1 each** (established once, never rebuilt) |

`cacheReadTokens` grows monotonically call over call (640 -> 768 -> 1,152 ->
1,408 -> 2,560 -> 2,560 -> 2,816 -> 3,328) while `inputTokens` per call
stays small (20-906) - direct proof that the growing session is served to
the provider as a cache-friendly, incrementally-extended prefix, never
rebuilt byte-for-byte each call the way R3's `buildAgentStepPromptPackage`
does (V1.8-A, section 4: a fresh two-message JSON payload constructed from
scratch on every single provider invocation, with no cache-friendly prefix
reuse across turns because `commercialContextSummary` itself changes shape
turn to turn).

## 7. Context management / compaction behavior

Classified from `experiments/deepseek-harness/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml`
(the package's own default bundle configuration, not a guess from naming)
and cross-checked against `experiments/deepseek-harness/harness/bakeoff.cordis.patch.yml`
(this repo's own override layer for the prior bake-off):

| Capability | Classification | Evidence |
|---|---|---|
| Token counting | `NATIVE_AND_ACTIVE` | `dsh-token-meter` mounted unconditionally in `dsh-base`'s own patch [`cordis.patch.yml:281-282`]; not disabled by this repo's bake-off patch. |
| Automatic conversation compaction | `NATIVE_AND_ACTIVE` | `dsh-compaction-basic` mounted unconditionally [`cordis.patch.yml:284-285`]; not disabled by this repo's bake-off patch. Never observed firing in any of the 21 real scenario runs (20 original + `V18B-01`) - all stayed short enough to avoid its threshold, consistent with the model's very large declared `contextWindow: 1000000` (section 6's `request/context` event). |
| Tool-result pruning (oversized results only) | `NATIVE_AND_ACTIVE` | `dsh-compaction-tool-result-pruner`, `thresholdChars:8192, headChars:4096, tailChars:1024` [`cordis.patch.yml:358-365`]; not disabled by this repo's bake-off patch. |
| Manual `/compact` command | `NATIVE_BUT_OPTIONAL` (present by default, explicitly **disabled** in this repo's own sandbox patch) | `dsh-command-compact` mounted in `dsh-base` [`cordis.patch.yml:289-290`]; `bakeoff.cordis.patch.yml`: `id: command-compact / disabled: true` - a deliberate choice for a non-interactive, scripted bake-off with no human present to type `/compact`. |
| Durability checkpointing before each model request | `NATIVE_BUT_OPTIONAL` (present by default, explicitly **disabled** in this repo's own sandbox patch) | `dsh-session-checkpoint-policy`, doc comment "Durability checkpoints before each model request and top-level dispatch" [`cordis.patch.yml:354-356`]; disabled in `bakeoff.cordis.patch.yml`. |
| Cross-process session persistence (JSONL to disk) | `NATIVE_BUT_OPTIONAL` (present by default, explicitly **disabled** in this repo's own sandbox patch) | `dsh-session-persistence-jsonl`, `root: dshHomePath('sessions')` [`cordis.patch.yml:98-100`]; disabled in `bakeoff.cordis.patch.yml`. |
| Context window limits | `NATIVE_AND_ACTIVE` | `request/context` event declares `contextWindow: 1000000` per session (section 6) - read and enforced by the same compaction/token-meter stack above, not by application code. |
| Session full-text search (SQLite) | `NATIVE_BUT_OPTIONAL` | `dsh-session-query-sqlite` mounted but `openAt: never` by default even in `dsh-base` itself [`cordis.patch.yml:117-127`] - "exact reads, titles, and lineage traces... stay available" regardless; search itself is opt-in. |
| Memory blocks (a separate named "working memory" construct) | `NOT_PRESENT` | No such construct found in any inspected type declaration; the session log + compaction + checkpoint stack is the only memory mechanism. |

**Why the bake-off's own results (section 6) don't show checkpointing/persistence
in action**: this repo's own prior sandbox patch (`bakeoff.cordis.patch.yml`,
written for `A13-H0`) explicitly disables `session-persistence-jsonl`,
`session-checkpoint-policy`, and `command-compact` - a deliberate hygiene
choice for a scripted, reproducible, disk-hygienic bake-off, not a
limitation of the package. `V18B-01` (this audit's new scenario) reused
that same patch unmodified, so it inherited the same three disablements.
**Compaction-basic and the tool-result-pruner were left active** in both
the original bake-off and this audit's new run (not in the disabled list),
which is why section 6 can already show real, live, active
compaction-adjacent infrastructure (token metering, pruning) even though
persistence/checkpointing were not exercised.

## 8. Durability level

**Maximum level supported by the installed package, by source evidence:
LEVEL 4 (external persisted session with exact resume semantics).**

- `dsh-session-persistence-jsonl` is a **default** dependency and a
  **default-mounted row** in `dsh-base`'s own `cordis.patch.yml`
  (`root: dshHomePath('sessions')`, section 7) - not an opt-in add-on a
  consumer has to assemble.
- `dsh-session-checkpoint-policy` is likewise default-mounted, explicitly
  checkpointing "before each model request and top-level dispatch" -
  meaning a crash mid-turn loses at most the in-flight step, not the
  conversation.
- `AgentRegistry.resume({resumeSessionId})` is a first-class, documented
  method on the same public service (`ctx.agents`) used for `create()` -
  not an internal or undocumented API (section 4).

**Caveat, stated with the same rigor V1.8-A used (PROVEN vs. NOT PROVEN):**
this level is **PROVEN by source** (the shipped package's own default
configuration and documented public type contract) but **NOT independently
re-executed** in this audit or in the prior `A13-H0` bake-off - both
explicitly disabled persistence/checkpointing for their own runs (section
7), and neither this audit nor `A13-H0` called `AgentRegistry.resume()`
even once. A live cross-process resume test (create -> kill process ->
resume in a fresh process -> confirm full history intact) was not run here;
it is a cheap, low-risk follow-up if the team wants direct execution proof
rather than source-level proof (see section 15).

**This defines how much PesasChile needs to build, given the actual
architecture decision already on record (A13-H0: do not adopt the external
package into production):** since production R3 does not run on this
package at all, this durability level describes what the **pattern** is
capable of, to use as a design target for R3's own equivalent -
not a capability PesasChile gets for free today.

## 9. Comparison with R3's `AgentSessionStore`

| Capability | Harness native session | `AgentSessionStore` | Duplicated? | Gap? | Recommended owner |
|---|---|---|---|---|---|
| Session identity | Stable `SessionId`, caller-supplied at creation | Stable session id per `conversationId` (`ensureSession`) | No - same shape, different scope | None | Either; conceptually equivalent |
| Event append | `agent.session.events`, full-fidelity (text, reasoning, tool calls/results) | `appendEvent`, textless metadata only (`shadowRecorder.ts:9-13`) | No - fundamentally different content | Real gap in `AgentSessionStore`'s content, but **by original design**, not an oversight (`agent-session/types.ts:1-11`: "never a second source of truth... never records message text") | `AgentSessionStore` deliberately narrower - not a defect |
| Recent events | `agent.session.events.slice(lastSeq)` | `loadRecentEvents` exists, zero production callers (V1.8-A, section 3) | No | Yes - dead code path, unrelated to the Harness comparison | `AgentSessionStore` (already scoped, just needs wiring - V1.8-A recommendation 3) |
| Full transcript | `deriveMessages()` derives one on demand from the event log | Does not exist - `conversation_message` is the real transcript store (V1.8-A) | No | R3's transcript lives in a different table entirely, by design | `conversation_message` (already the canonical source, per `shadowRecorder.ts`'s own comment) |
| Summary/compaction | Native (`dsh-compaction-basic`, section 7) | `AgentSessionSummary`/`rebuildSummary` exist, zero production callers (V1.8-A) | No - Harness's is automatic and threshold-driven; R3's would be a manual, structured projection | Yes, in R3, but independent of the Harness question | New: R3's own loop, if/when adopted (section 12) |
| Resume | `AgentRegistry.resume()`, native, LEVEL 4 | No concept of resume at all - not designed to reconstruct model-visible context | No | This is the real, load-bearing gap: R3 has no equivalent mechanism anywhere | R3's own loop (new capability, section 12) - **not** `AgentSessionStore`, which was never scoped for this job |
| Serialization | JSONL, native | No | No | Same as above | Same as above |
| Compaction | Native, automatic | None | No | Same as above | Same as above |
| Tool history | Full call+result content, native | Tool **name**+status only, no arguments/results (`read-tool-request/sessionEvents.ts`) | No | By design (never intended to duplicate `crm_capability_executions`) | `crm_capability_executions` (already the real tool-call record) |
| Assistant history (text) | Native, in `session.events` | Explicitly never stored (`shadowRecorder.ts:9-13`) | No | None - `conversation_message` already owns this | `conversation_message` |
| Customer history (text) | Native, in `session.events` | Explicitly never stored | No | None - same as above | `conversation_message` |
| Cross-process durability | Native (JSONL to disk), LEVEL 4 | Durable (MariaDB), but never captures message content/model-visible state - durable audit trail only | No | Different durability of different content | Both, for their own scopes |

**Is `AgentSessionStore` A/B/C/D/E?**

**D - useful only as a persistence adapter/audit trail**, and this is its
own original, explicit design intent, not a downgrade this audit is
proposing: its own module doc comment
(`agent-session/types.ts:1-11`) already states "this module is
conversational memory only... it never becomes a second source of truth...
A session may record that something was discussed or that an action
occurred; it never records the current authoritative value." **It does not
duplicate the Harness's session** (which is a full-content, model-context-reconstructing
mechanism) - the two solve genuinely different problems. The real,
independent finding (already surfaced in V1.8-A, reconfirmed here) is that
`AgentSessionStore` is not even fully realizing its own narrow, audit-trail
job today (`summary_json` never populated, `loadRecentEvents`/`loadSummary`
never called) - a pre-existing gap unrelated to whether R3 ever adopts a
Harness-like session pattern.

## 10. Duplication/gap matrix

| Question | Answer |
|---|---|
| Does `AgentSessionStore` duplicate the Harness's session? | **No** - different content (textless vs. full-fidelity), different purpose (audit trail vs. model-context source), different consumer (nothing reads `AgentSessionStore` back into a prompt; `session.events`/`deriveMessages()` is exactly what the Harness's own model calls read from). |
| Does R3's `runAgentToolLoop.ts` duplicate the Harness's reasoning loop? | Partially, by design and by the project's own prior decision (A13-H0): both are iterative tool-calling loops over a provider; R3's was built as the "already-integrated, already-tested" native alternative specifically so the external package would not need to be adopted. |
| Is there a real, unfilled gap? | **Yes, exactly one**: nothing in R3 plays the role of the Harness's persistent, incrementally-extended session object that model calls read directly from. This is not currently anyone's job - not `AgentSessionStore`'s (never scoped for it), not `conversation_message`'s (a business record, not a model-context cache), not `runAgentToolLoop.ts`'s (rebuilds from scratch every call). |

## 11. Recommended ownership boundary

Unchanged from this task's own stated invariants, restated with this
audit's evidence attached:

- **Harness (or R3's own equivalent pattern) owns**: cognition, the agent
  loop, and - if adopted - conversational session semantics (the
  growing, appendable, cache-friendly message/event list a model call reads
  from).
- **PesasChile owns, unchanged**: identity, business truth, catalog,
  pricing, stock, shipping, quote, opportunity, authorization, side
  effects, outbox, Meta delivery, customer long-term commercial
  intelligence. Nothing in this audit's findings moves any of this -
  `capability-gateway/**` remains the sole execution/governance boundary
  regardless of which reasoning-loop implementation calls it (V1.8-A,
  section 2; A13-H0 Phase 5, "What remains deterministic").

## 12. Recommended V1.8-C direction

Two independent axes, not to be conflated:

**Axis 1 - package adoption (re-affirm, do not re-litigate without new
evidence).** A13-H0's `HYBRIDIZE_WITH_HARNESS` verdict (adopt the pattern,
not the package) still holds: `@deepseek-ai/dsh@0.1.1-rc.2` remains, as of
this audit (two days after A13-H0, an insufficient window for a
"developer preview" to mature), unpinned-`latest`-broken, Node-22+-only
(this repo's ambient Node is 20.19.0), telemetry-phones-home-by-default,
and with no official multi-turn entry point besides a self-built ~60-line
plugin. None of these were re-verified as fixed in this audit (out of
scope - re-verifying package maturity is not a code-reading exercise).
**Recommendation: do not adopt the external package into production in
V1.8-C.**

**Axis 2 - pattern adoption inside R3's own stack (the actionable part).**
Mirror the one validated shape this audit newly confirmed with live
evidence (section 6): a session-scoped object that accumulates across
turns and that the model reads incrementally from, instead of a payload
rebuilt from scratch every call. Concretely, for a future V1.8-C to design
(not implement here):

1. Give `runAgentToolLoop`/`salesAgentRuntime` a real, appendable,
   cross-turn message/event structure (in-process during a turn already
   exists as `steps`; the gap is specifically **cross-turn**, per V1.8-A
   section 3) instead of reconstructing `commercialContextSummary` fresh
   every turn from SQL. This is additive to the existing durable-state
   reads (opportunity/need/shipping/line-items stay authoritative and
   SQL-backed, unchanged) - it only changes how the *conversational* slice
   of the prompt is assembled.
2. Only once real production conversations are long enough to need it, add
   a bounded compaction/pruning step - not before, matching the Harness's
   own observed behavior of never triggering compaction in any of 21 short
   real scenarios (section 7).
3. Treat `AgentSessionStore`'s existing, narrower audit-trail job (V1.8-A
   recommendation 3: wire up `rebuildSummary`) as a separate, smaller,
   already-documented item - independent of whether the loop-level pattern
   above is ever built.

## 13. Explicit things NOT to build because the Harness's proven pattern already covers them

- A second, bespoke design for "how do you turn an event log into a
  provider-ready message list" - the Harness's `deriveMessages()` proves
  this is a solved, well-scoped transform; if/when R3 builds its own
  cross-turn session object (section 12), design its read side the same
  way (a derive-on-read function over an append-only log), not a novel
  scheme.
- A second, bespoke compaction heuristic invented from first principles -
  the Harness's threshold-plus-tool-result-pruner split (section 7) is a
  reasonable, already-validated shape to imitate rather than redesign.
- A `currentTopic`/`currentIntent` field or any deterministic
  intent/workflow machinery - **not** something the Harness itself uses
  either. Its own topic continuity (section 6) comes entirely from raw
  session content plus the model's own reasoning, never a separate,
  extracted "intent" object. This audit's own task instructions already
  forbid building one, and the Harness's real behavior gives no evidence
  it would help beyond what richer raw context already provides.
- A second summary/session-store system parallel to `AgentSessionStore` -
  if session-level summarization is ever wanted, extend
  `AgentSessionStore`'s already-existing, already-scoped `AgentSessionSummary`
  contract (V1.8-A, section 3) rather than inventing a new one.

## 14. Tests/scripts executed

- `npx tsc --noEmit` (main repo): clean, zero errors. (`experiments/deepseek-harness/**`
  is explicitly excluded from the main `tsconfig.json`'s `exclude` list, so
  this audit's one scenario-file addition does not touch the compiled
  surface at all.)
- **New characterization scenario `V18B-01`**, added to
  `experiments/deepseek-harness/scenarios/bakeoff-scenarios.json` (additive
  only - the existing 20 `H0-*` scenarios are untouched), executed for
  real against the installed `@deepseek-ai/dsh@0.1.1-rc.2` and the real
  DeepSeek API (`deepseek-v4-flash`), via
  `experiments/deepseek-harness/harness/bootBakeoff.mts`, run with Node
  24.14.0 (already present via this machine's `nvm4w` cache, invoked
  directly - no change to the shell's default Node, no new install). No
  database, no Meta, no mutating tool - only the four pre-existing
  read-only bake-off tools (`search_products`, `get_customer_context`,
  `get_purchase_history`, `get_shipping_options`). Output:
  `experiments/deepseek-harness/results/V18B-01.harness.json`
  (gitignored, consistent with every other bake-off result per that
  directory's own `README.md`/`.gitignore`).
- Re-inspected three already-executed bake-off results from `A13-H0`
  (`H0-10.harness.json`, `H0-13.harness.json` referenced via the
  architecture doc, `H0-19.harness.json` read in full) for corroborating,
  zero-additional-cost evidence of same-session continuity across an
  intervening off-topic turn.
- No R3 production test suite was re-run: this audit changed zero
  production code, and V1.8-A already validated the R3-side context-building
  suites directly relevant to this comparison.

## 15. Risks / unknowns

- **Durability level 4 (section 8) is proven by source, not by this
  audit's own execution.** `resume()` was never called, here or in
  `A13-H0`. If V1.8-C ever seriously reconsiders external package adoption,
  a real create -> kill -> resume test should run first - cheap (same
  sandbox, one more scenario file), not done here because Axis 1's
  recommendation (section 12) is to not adopt the package regardless.
- **Package maturity is a two-day-old snapshot.** `0.1.1-rc.2`'s five
  operational issues documented in `A13-H0` were not re-checked here; a
  "developer preview" moves fast, and re-verifying before any future
  package-adoption decision is cheap and should not be skipped.
- **This audit's new live scenario (`V18B-01`) is one run, not a
  statistically robust sample.** The Harness handling the turn-2/analogue
  correctly here is strong, directly relevant evidence for what the
  session-native *pattern* can do, not a guarantee that adopting the
  pattern in R3 will reproduce this exact outcome on every phrasing -
  model behavior remains probabilistic regardless of architecture.
- **No compaction was ever observed firing** (section 7) - every real
  conversation run against this Harness across two audits (37 + 4 turns)
  stayed well under whatever `dsh-compaction-basic`'s real threshold is.
  The actual trigger point and its effect on long PesasChile-scale
  conversations (a real pilot conversation can run 180+ turns per the
  V1.8-A incident) remain unverified by direct observation.

## 16. Final verdict

**`HARNESS_SESSION_CONTINUITY_NATIVE_FULL`** for the installed package's
own native capability (LEVEL 4 durability, proven by source: default-mounted
`dsh-session-persistence-jsonl` + `dsh-session-checkpoint-policy` +
documented `AgentRegistry.resume()`).

**R3 currently preserves none of it** - zero runtime coupling to the
Harness package exists anywhere in `lib/`/`app/` (exhaustive grep, zero
matches). This is not misuse; it is the direct, unchanged consequence of
`A13-H0`'s own prior, still-apparently-valid decision to build R3's
reasoning loop natively instead of adopting the external package.

**`AgentSessionStore` does not duplicate the Harness's session** - it was
never scoped to do that job (own docstring, `agent-session/types.ts:1-11`)
and is correctly classified **D: useful only as a persistence
adapter/audit trail**, with its own narrower job currently under-realized
(V1.8-A, unrelated to this comparison).

**Recommended `V1.8-C` direction**: do not adopt `@deepseek-ai/dsh` into
production (Axis 1, unchanged from A13-H0); do design R3's own
cross-turn session object modeled on the Harness's proven append-only,
derive-on-read, threshold-compacted pattern (Axis 2, new and actionable) -
this is additive to R3's existing durable-state/capability-gateway
boundary, introduces no workflow engine, no intent state machine, and no
duplicated memory system, per this task's own invariants.

Verdict: **`R3_V1_8_B_HARNESS_AUDIT_COMPLETE`**. Does not advance to
V1.8-C.

## Files inspected

`experiments/deepseek-harness/harness/bakeoffRunnerPlugin.ts`,
`experiments/deepseek-harness/harness/bootBakeoff.mts`,
`experiments/deepseek-harness/harness/bakeoff.cordis.patch.yml`,
`experiments/deepseek-harness/package.json`,
`experiments/deepseek-harness/README.md`,
`experiments/deepseek-harness/scenarios/bakeoff-scenarios.json`,
`experiments/deepseek-harness/results/H0-10.harness.json`,
`experiments/deepseek-harness/results/H0-19.harness.json`,
`experiments/deepseek-harness/results/V18B-01.harness.json` (new, this
audit), `experiments/deepseek-harness/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml`,
`experiments/deepseek-harness/node_modules/@deepseek-ai/dsh-agent/lib/types/index.d.ts`,
`experiments/deepseek-harness/node_modules/@deepseek-ai/dsh-base/package.json`,
`docs/architecture/A13-H0-deepseek-harness-bakeoff.md`,
`docs/releases/SALES-AGENT-R3-V1.8-A-CONVERSATIONAL-CONTEXT-INPUT-AUDIT.md`,
plus the main repo's `package.json`/`package-lock.json` and `tsconfig.json`
(to confirm zero production coupling and build isolation).

## Files changed

New:
- `docs/releases/SALES-AGENT-R3-V1.8-B-HARNESS-NATIVE-SESSION-CONTINUITY-AUDIT.md` (this file)
- `experiments/deepseek-harness/results/V18B-01.harness.json` (gitignored, not committed)

Modified:
- `experiments/deepseek-harness/scenarios/bakeoff-scenarios.json` (one new,
  additive scenario entry, `V18B-01` - the 20 pre-existing `H0-*` scenarios
  are unchanged)
- `docs/ACTIVE_RELEASE.md` (this task's entry under the `SALES-AGENT-R3`
  workstream)

No production/runtime code (`lib/`, `app/`) was created, modified, or
deleted in this task.

# SALES-AGENT-R3-V1.8-A -- Conversational Context Input Audit

Status: audit complete, no production code changed. Documentation-only
artifact (this file), plus `docs/ACTIVE_RELEASE.md` updated in the same
change. Every claim below is sourced to an exact file/line; no claim is
inferred from naming or from the task's own hypothesis.

## 1. Executive verdict

**`R3_CONTEXT_CONTINUITY_PARTIAL`**

R3 does not reconstruct a conversation. It reconstructs, fresh every turn:
(a) a durable commercial-state snapshot (opportunity/need-profile/shipping/line-items,
rehydrated from SQL every turn), (b) a short, count-bounded tail of raw
message text (last 5 messages, direction+body only, no roles, no
timestamps in the prompt), (c) a structured product-identity continuity
object (`RecentCatalogContext`) and (d) a single structured "offer still
open" continuity object (`pendingCatalogAction`). All four are genuinely
read back into the model's prompt every turn - this is real continuity, not
zero. But there is no session-level semantic memory: `AgentSessionStore`
(the one component whose name and schema promise exactly that) is written
every turn and never read by anything that builds a prompt. `summary_json`
is never populated in production code (confirmed by an exhaustive caller
search, not just by the DB row already showing `NULL`). There is no
explicit "current topic"/intent-anchor object; topic continuity across an
ambiguous, broadening customer message depends entirely on the raw last-5-message
tail being salient enough inside a large JSON payload, which the evidence
below shows is a real, structural weak point.

## 2. Canonical runtime graph

Reconstructed by reading the real call/import graph, reusing V1.7's own
already-tested canonical path (`docs/releases/SALES-AGENT-R3-V1.7-runtime-dependency-legacy-isolation-audit.md`,
section "Canonical R3 productive path") and drilling one level deeper, into
the exact context-construction boundary this task asked for:

```
Meta inbound
  -> app/api/integrations/whatsapp/webhook/route.ts
  -> processNativeWhatsAppInbound            (lib/brain/native-whatsapp/service.ts)
       - persists conversation_message (inbound), same transaction
       -> ensureAutonomousSalesTurnContinuity
            -> runNativeAutonomousCycle       (native-cycle/runNativeAutonomousCycle.ts)
                 - buildNativeCommercialContext(conversationPublicId, currentTime)
                     -> loadNativeConversationDetailByPublicId            [native-whatsapp/service.ts:1406-1413]
                          SELECT * FROM conversation_message
                          WHERE conversation_id = ?
                          ORDER BY created_at ASC, id ASC        (NO LIMIT - full history read)
                     -> .slice(-12)   [COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES, constants.ts:2]
                                       [buildNativeCommercialContext.ts:330-338]
                     -> CommercialContextSnapshot.recentMessages (<=12 rows, {id,direction,body,status,occurredAt})
                 - loadRecentCatalogContext(conversationId, currentTime)   [runNativeAutonomousCycle.ts:641-653]
                     -> reads crm_capability_executions/commercial_event   [recentCatalogContext.ts:178-200]
                     -> RecentCatalogContext { interactions: last 5, <=12 products, 24h window }
                 - loadPendingCatalogAction(conversationId)                [runNativeAutonomousCycle.ts:655-664]
                     -> SELECT payload_json FROM commercial_event
                        WHERE conversation_id=? AND event_type='agent_tool_loop_completed'
                        ORDER BY created_at DESC, id DESC LIMIT 1          [pendingCatalogAction.ts:275-282]
                 -> runSalesAgentRuntimeCycle(snapshot, recentCatalogContext,
                                               pendingCatalogAction, ...)  [runNativeAutonomousCycle.ts:724-750]
                      -> buildMinimalCommercialContextSummary(snapshot, inboundMessageId, customerMessage)
                                                                            [runSalesAgentRuntimeCycle.ts:105-133]
                           - filters out the current inbound message
                           - recentMessages.slice(-5).map({direction, body})   <- ONLY 5 messages, text-only
                      -> runSalesAgentRuntime(commercialContextSummary, recentCatalogContext,
                                               pendingCatalogAction, provider, ...) [salesAgentRuntime.ts:150-207]
                           -> runAgentToolLoop(loopInput)                  [salesAgentRuntime.ts:188-208]
                                loop over up to maxDecisions model calls:
                                  buildAgentStepPromptPackage({             [runAgentToolLoop.ts:799-811, 968-980]
                                    customerMessage,             <- CURRENT TURN TEXT ONLY
                                    commercialContextSummary,    <- includes the 5-message tail
                                    recentCatalogContext,
                                    pendingCatalogAction,
                                    priorSteps: steps             <- THIS TURN'S OWN STEPS ONLY, reset every call
                                  })
                                  -> { messages: [ {role:"system",...}, {role:"user", JSON} ] }
                                  -> provider.invoke({messages})           [httpAgentLoopProvider.ts:240-259]
                                       body: { model, temperature, response_format, messages }  <- sent verbatim
                           -> recordAgentToolLoopSessionShadowEvents(...)  [salesAgentRuntime.ts:240-254]
                                -> AgentSessionStore.appendEvent(...)      WRITE-ONLY, no text, see section 4/D
                      -> dispatchSalesAgentTerminalOutcome -> canonicalOutboxWriter -> brain_message_outbox
                      -> recordAgentToolLoopCompletedCommercialEvent       [runSalesAgentRuntimeCycle.ts:307-335]
                                -> commercial_event (event_type='agent_tool_loop_completed',
                                     payload includes pendingCatalogAction - this is what
                                     loadPendingCatalogAction reads back NEXT turn)
-> autonomous outbox worker -> Meta
```

Every arrow above was read from source, not inferred; file:line references
are given for the ones this task specifically asked to trace (context
construction, not routing - V1.7 already proved routing/isolation).

## 3. Input inventory table

| Source | Reader | Persisted? | Loaded next turn? | Model-visible? | Authority | Notes |
|---|---|---|---|---|---|---|
| Current inbound message (this turn's text) | `runAgentToolLoop.ts` via `customerMessage` | Yes, in `conversation_message` (upstream, same transaction as inbound processing) | Yes, indirectly - becomes one row of next turn's 12/5-message tail | Yes, verbatim, every provider call this turn | Conversational | The only full-fidelity, unambiguous text guaranteed present. |
| `conversation_message` history | `loadNativeConversationDetailByPublicId` [native-whatsapp/service.ts:1406-1413] -> `buildNativeCommercialContext.ts:330-338` | Yes, canonical timeline | Yes - unbounded SQL read, then `.slice(-12)` in JS, then `.slice(-5)` again in `runSalesAgentRuntimeCycle.ts:110-131` | Yes, but reduced to `{direction, body}` only, last 5 messages, current inbound filtered out | Conversational | No token budget anywhere in this path - two fixed count cutoffs (12, then 5), no summarization. |
| Assistant outputs (prior turns' `finalMessage`) | Same as above - assistant replies are `direction:"outbound"` rows in `conversation_message`, written by the dispatch/outbox path | Yes, in `conversation_message` (and `brain_message_outbox`) | Yes, indirectly, as part of the same last-5-message tail | Yes, raw body text, no explicit "assistant" role label (only `direction:"outbound"`) | Conversational | `ASSISTANT_MESSAGE_SENT` in `agent_session_events` is a separate, textless marker - see next two rows. Real assistant text lives only in `conversation_message`. |
| `AgentSession` summary (`agent_sessions.summary_json`) | Nobody, in production. `loadSummary`/`rebuildSummary` exist [`mariaDbAgentSessionStore.ts:214-263`] but have zero callers outside test files (verified by exhaustive grep of `lib/`, `app/`, `scripts/`) | No - `rebuildSummary` (the only function that would ever write `summary_json`) is never invoked in production | No | No | None (dead runtime path) | Matches the task's own DB evidence exactly: `summary_version=0`, `summary_json=NULL` is not an anomaly for conversation_id=83 - it is the permanent state of every conversation, because nothing ever calls the function that would change it. |
| `AgentSession` events (`agent_session_events`) | Nobody reads them back into a prompt. Three independent write-only call sites: `shadowRecorder.ts` (turn-level `USER_MESSAGE_RECEIVED`/`ASSISTANT_MESSAGE_SENT`/per-tool summary, called once per turn from `salesAgentRuntime.ts:241-250`), `read-tool-request/sessionEvents.ts` (per-call, from inside `executeReadTool`), `commercial-action-request/sessionEvents.ts` (same pattern for mutating tools) | Yes, per turn and per tool call | No | No | Audit trail only | Explicitly designed this way - `shadowRecorder.ts:9-13`'s own comment: "neither USER_MESSAGE_RECEIVED nor ASSISTANT_MESSAGE_SENT carries message text... this module only records that a turn happened." |
| Tool observations, prior turn (raw `ToolObservation` objects) | N/A - never rehydrated in raw form | Durably, but only via `crm_capability_executions`/`commercial_event`, never as a replayable `ToolObservation[]` | No, in raw form. Reconstructed only as the reduced `RecentCatalogContext` projection (product id/name/position, catalog tools only) | No, not in raw form | Conversational (product-identity resolution only) | `runAgentToolLoop.ts:660` (`const steps: AgentLoopStepRecord[] = []`) is a fresh local array every call - there is no code path that seeds it from a previous turn. |
| Tool observations, current turn | `buildAgentStepPromptPackage.ts` via `priorSteps` [type comment at :63-64: "This turn's own prior steps/observations only - never cross-turn state"] | Yes, permanently, via the Capability Gateway into `crm_capability_executions` | No (see row above) | Yes, in full, for the remainder of the CURRENT turn only | Conversational, turn-scoped | Resets to `[]` at the top of every `runAgentToolLoop` call - i.e. every turn, not every provider call within a turn. |
| `RecentCatalogContext` | `loadRecentCatalogContext` [`recentCatalogContext.ts:206+`], called from `runNativeAutonomousCycle.ts:641-653` | Derived live from `crm_capability_executions`/`commercial_event` - not a separate durable object | Yes, recomputed fresh every turn (last 5 interactions / up to 12 products / 24h window - `recentCatalogContext.ts:4-7`) | Yes, `recentCatalogContext` field, `buildAgentStepPromptPackage.ts:629` | Conversational (identity-resolution only - its own prompt rule explicitly forbids using it as price/stock/availability evidence, `RECENT_CATALOG_CONTEXT_RULE_LINES`) | The real mechanism behind "quiero la segunda" - `position` per product, per interaction. |
| `pendingCatalogAction` | `loadPendingCatalogAction` [`pendingCatalogAction.ts:275-282`], called from `runNativeAutonomousCycle.ts:655-664` | Yes, via `recordAgentToolLoopCompletedCommercialEvent` [`runSalesAgentRuntimeCycle.ts:307-335`] into `commercial_event` | Yes - exactly the single most recent row | Yes, `pendingCatalogAction` field, `buildAgentStepPromptPackage.ts:630`, with a dedicated prompt rule block (`PENDING_CATALOG_ACTION_RULE_LINES`) | Conversational, but structurally enforced (evidence-gated in `processUseToolStep`, `runAgentToolLoop.ts:480-503`) | The one true structured, actively-enforced cross-turn continuity primitive in this system. |
| Commercial/durable state (`opportunity`, `needProfile`, `shippingDestination`, `commercialLineItems`) | `buildNativeCommercialContext.ts`, fresh every turn from `crm_sales_need_profiles`/`crm_request_facts`/`crm_opportunities` | Yes, durable domain tables | Yes, always rehydrated fresh (never inferred from `recentMessages` - explicit comment, `buildNativeCommercialContext.ts:343-345, 350-352`) | Yes, via `commercialContextSummary`, `runSalesAgentRuntimeCycle.ts:117-132` | **Authoritative commercial state** (never conversational memory) | This is what actually anchors most cross-turn behavior that works well (destination, shipping, line items). |
| Customer identity | `native-cycle/customer-session` | Yes | Yes | **Not in the text prompt at all.** `buildMinimalCommercialContextSummary` (`runSalesAgentRuntimeCycle.ts:117-132`) includes no `customer` field; identity only reaches `gatewayContext.trustedCustomerSession` for tool-execution governance | Authoritative, execution-only | Worth flagging even though not explicitly one of the 10 audit questions: the model never sees the customer's name/identity as text. |
| `identityConfiguration` (agent persona/config) | `resolveSalesAgentConfiguration()`, resolved once per turn | Yes | Yes | Yes, via the system prompt (`renderSalesAgentIdentityPrompt`) | Configuration, not conversation | Static per turn; not a conversational-continuity mechanism. |

## 4. Exact model-visible context

Every provider call in this system (there can be several per turn: up to
`maxDecisions` gathering calls plus up to 2 finalization calls) sends
exactly two messages, built fresh by `buildAgentStepPromptPackage`
(`buildAgentStepPromptPackage.ts:614-641`) and passed to
`invokeProviderWithDeadline` -> `provider.invoke({messages})` ->
`httpAgentLoopProvider.ts:240-259`, which forwards `messages` **verbatim**
into the DeepSeek request body (`{model, temperature, response_format,
messages}`, `httpAgentLoopProvider.ts:247-258`). There is no accumulation
of a running chat history across calls - each call's `messages` array is
built from scratch:

```
messages = [
  { role: "system", content: <six-layer instruction text: repair signal (if any),
      loop contract, evidence/tool rules, identity, immutable boundary> },
  { role: "user", content: JSON.stringify({
      currentTime,
      customerMessage,              // THIS TURN'S TEXT ONLY
      commercialContext: {
        opportunityStatus, opportunityStage,
        needProfile: {...} | null,
        shippingDestination: {...} | null,
        commercialLineItems: {...} | null,
        recentMessages: [            // <= 5 entries, oldest-first
          { direction: "inbound"|"outbound", body: "..." }, ...
        ]
      },
      recentCatalogContext: { interactions: [...] },
      pendingCatalogAction: {...},   // present only when one is open
      priorStepsThisTurn: [ ... ],   // THIS TURN'S tool calls/observations only
      question: "What is the single next AgentStep?"
  }) }
]
```

There is no `role: "assistant"` message anywhere in this array, ever - no
turn is represented as an actual chat exchange. The only place a prior
assistant reply's text reaches the model is buried, as plain data, inside
`commercialContext.recentMessages[].body` where `direction === "outbound"`.

## 5. Turn-boundary analysis (what survives N -> N+1)

| Carries over turn N -> N+1? | Mechanism |
|---|---|
| Raw message text (last 5, both directions) | Yes - via `conversation_message` + the two-stage slice (12 then 5) |
| `pendingCatalogAction` | Yes - durable, DB round-trip via `commercial_event` |
| `RecentCatalogContext` (product identity/position) | Yes - durable, DB round-trip via `crm_capability_executions`/`commercial_event`, recomputed fresh |
| Commercial durable state (opportunity/need/shipping/line items) | Yes - durable domain tables, rehydrated fresh |
| Raw `ToolObservation`s from N | **No** - `priorSteps`/`steps` is local to one `runAgentToolLoop` call, reset every turn |
| `AgentSession` summary/events | **No functional effect** - written, never read |
| Any explicit "current topic"/intent anchor | **Does not exist** as a first-class field anywhere in this path |

## 6. Root-cause analysis: turn 180 -> 182

Claims below are labeled by evidence strength, per the task's own
methodology.

**PROVEN (source-verified):**
- Turn 182's model input included `commercialContext.recentMessages`, a
  last-5-message tail built exactly as described in sections 2-4, and
  `customerMessage` set to the turn-182 text alone. No other conversational
  text reaches the model.
- `RecentCatalogContext` for turn 182 would carry whatever
  `search_products`/`explore_catalog` interactions ran in turns 178/180 (up
  to the last 5 interactions, 24h window) - product identities and
  positions only, explicitly *not* usable as topic/intent evidence per its
  own prompt rule (`RECENT_CATALOG_CONTEXT_RULE_LINES`, "only for
  identifying which product the customer is referring to").
- There is no field anywhere in `commercialContextSummary` or the prompt
  that represents "the customer's current product-search topic" as an
  explicit, reinforced fact. `needProfile` (the one durable field that
  could carry this) is populated by a separate domain process
  (`crm_sales_need_profiles`) and is not automatically derived from an
  in-flight search query.
- `AgentSessionStore`'s summary is provably inert (section 3): its absence
  contributed exactly zero information either way to this incident,
  because nothing reads it regardless of whether it is populated.

**LIKELY (plausible given the prompt's own structure, not independently
provable from static source alone):**
- Whether turns 178/180's exact messages were still inside the last-5-message
  window by turn 182 depends on the real row spacing of
  `conversation_message` for conversation_id=83, which this audit did not
  query directly (out of scope; no production DB access was used - see
  "Non-goals"). If each turn produced one inbound + one outbound row, turns
  178 and 180 (and their replies) would plausibly still be within a 5-row
  window at turn 182 - meaning the raw text was **likely present**, and the
  failure is a salience/weighting problem (the text is there but
  unlabeled, unreinforced, and outranked by the customer's own broadening
  phrase), not a hard truncation loss. This is the more likely mechanism
  given `ADAPTIVE_PRODUCT_PRESENTATION_RULE_LINES`'s own instruction to
  broaden to 3-5 products "if the customer is exploring broadly or
  explicitly asks for options" (`buildAgentStepPromptPackage.ts:174`) - a
  rule this system deliberately wants active, that has no topic-scoping
  guard next to it.

**NOT PROVEN:**
- The literal DeepSeek reasoning/token-level cause of the specific
  misclassification (whether the model "read" `recentMessages` at all
  before broadening). This requires the actual provider request/response
  logs for that turn, which are outside this audit's scope (no schema/data
  changes, no runtime execution against production).

**Conclusion:** the architecture has a real, demonstrable topic-continuity
gap (no semantic/topic memory of any kind exists between raw last-N-message
text and durable structured facts), and this gap is a plausible,
well-supported explanation for the observed behavior. It cannot be
proven to be *the* cause of this one incident without provider-level logs,
but it is not a hypothetical concern - it is a structural absence, verified
in code.

## 7. Gap matrix

| Signal | Present? |
|---|---|
| Recent customer history | YES (last 5 messages, `direction:"inbound"`, raw text) |
| Recent assistant history | YES (mixed into the same last-5 window, `direction:"outbound"`, raw text) |
| Session summary (`AgentSessionStore.summary_json`) | NO (never written by production code, never read by anything) |
| Prior tool observations (cross-turn, raw form) | NO (`priorSteps` resets every turn) |
| Prior tool observations (cross-turn, reduced form) | PARTIAL (`RecentCatalogContext`: product identity/position only, `pendingCatalogAction`: one structured offer only) |
| Commercial durable state | YES (opportunity/need/shipping/line items, rehydrated fresh every turn) |
| Token-aware trimming | NO (fixed message/interaction counts only - 12 then 5 messages, 5 interactions/12 products - no token estimation anywhere in this path) |
| Semantic conversational state (explicit topic/intent anchor) | NO |

## 8. Section H: budget/context management, explicit answer

No token budget, no token estimation, and no summarization exist anywhere
in this path. The only "budget" mechanisms are fixed count cutoffs:
`COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES = 12` (`constants.ts:2`), then a
second `.slice(-5)` in `buildMinimalCommercialContextSummary`
(`runSalesAgentRuntimeCycle.ts:131`), and `RECENT_CATALOG_CONTEXT_MAX_INTERACTIONS
= 5` / `RECENT_CATALOG_CONTEXT_MAX_PRODUCTS = 12` / a 24h window
(`recentCatalogContext.ts:5-7`). `maxAgentStepsPerTurn`/`maxToolCallsPerTurn`
bound *this turn's own* reasoning loop (a different concept entirely -
tool-call budget, not context-size budget). Input/output token counts are
recorded for observability (`LLM-R1-T02`) but never fed back into a
trimming decision.

## 9. Section I: observability side finding, explicit answer

`agent_tool_loop_completed` shows `toolsUsed=[]`/`stepsSummary=[]` for R3
turns by deliberate, documented design, not a bug: `runSalesAgentRuntimeCycle.ts:316-323`
hardcodes both fields empty, with the comment "Individual tool names are
not exposed by SalesAgentRuntimeResult by design (V1.3 Phase 15: counts
only)." `SalesAgentRuntimeResult` (`salesAgentRuntime.ts:66-84`) only ever
returns aggregate counts (`toolCalls`/`readToolCalls`/`commercialActionCalls`),
never the underlying `AgentLoopStepRecord[]` - so the one event type that
*would* want per-tool names structurally cannot have them without a
`SalesAgentRuntimeResult` contract change (out of scope here). Meanwhile
`agent_session_events` shows real tool names because it is written by two
*different*, independent code paths that run closer to actual tool
execution and do have the name in scope: `read-tool-request/sessionEvents.ts`
and `commercial-action-request/sessionEvents.ts` (per-call, inside
`executeReadTool`/`executeCommercialActionRequest`), plus `shadowRecorder.ts`'s
own turn-level summary (which reads `AgentLoopStepRecord[]` before it gets
reduced away). Not corrected here per the task's own instruction (out of
scope unless needed to understand context - it was needed only to explain
the discrepancy, which is now fully explained).

## 10. Minimal V1.8 recommendations (not implemented)

All four keep memory advisory, never prescriptive - no workflow engine, no
intent state machine, no mandatory constraints.

1. **Give the last-N-message tail a clearer role/recency signal in the
   payload** (e.g. include a turn-relative label or `occurredAt` instead of
   direction-only, so a model is less likely to under-weight a
   two-turns-ago message against the current one).
   - Gap resolved: weak salience of `recentMessages` (sections 4, 6, 7).
   - Layer: `buildMinimalCommercialContextSummary` (`runSalesAgentRuntimeCycle.ts`).
   - Additive: yes - shape change to an existing field, no new gate.
   - Determinism risk: low (advisory text only, no branching logic added).
   - Regression risk: low - purely more information, same field name/shape family.
   - Priority: high.

2. **Add one small, explicitly advisory "current topic hint" derived from
   already-durable data** (e.g. the most recent `search_products`/`explore_catalog`
   query terms already captured in `RecentCatalogContext`'s own source
   data, or `needProfile.useCase`), rendered as a single line the model may
   use or override - never a constraint, never gating tool selection.
   - Gap resolved: absence of any topic/intent anchor (section 7).
   - Layer: `buildMinimalCommercialContextSummary` or a new field alongside
     `recentCatalogContext` in `buildAgentStepPromptPackage.ts`'s user
     payload.
   - Additive: yes.
   - Determinism risk: low-medium - must be worded as a hint, not an
     instruction, to avoid the model treating it as a hard filter (the R3
     invariant: memory informs reasoning, never prescribes it).
   - Regression risk: low if scoped to prompt text only.
   - Priority: medium-high (directly targets the demonstrated gap).

3. **Wire `AgentSessionStore.rebuildSummary` to actually run** (e.g. once
   per turn, after the shadow events are appended) so `summary_json` stops
   being permanently `NULL`, and consider surfacing a bounded slice of it
   (e.g. `recentToolActivity`, already schema'd in `AgentSessionSummary`)
   into the prompt as additional advisory context.
   - Gap resolved: dead AgentSession summary path (sections 3, 5).
   - Layer: `salesAgentRuntime.ts` (write side) + `buildMinimalCommercialContextSummary`
     or a new prompt field (read side).
   - Additive: yes for the write side; the read side is new prompt surface.
   - Determinism risk: low - `AgentSessionSummary` already excludes
     free-text/chain-of-thought by schema (`currentGoals`/`recentToolActivity`/etc.
     are structured, bounded fields).
   - Regression risk: low-medium - `rebuildSummary` already exists and is
     tested; the main risk is latency (one more DB round trip per turn),
     not correctness.
   - Priority: medium (fixes a real dead code path, but section 6's root
     cause does not depend on this one).

4. **None of the above should touch `pendingCatalogAction` or `RecentCatalogContext`** -
   both already work as designed and are not implicated by this audit's
   root-cause finding; V1.8-B (if pursued) should treat them as a stable
   baseline to build alongside, not a target for change.

## 11. Explicit non-goals

Confirmed: nothing above proposes a workflow engine, a deterministic intent
state machine, a next-step machine, mandatory conversational constraints,
or hard-coded active-intent transitions. Every recommendation is additive
prompt/data surface that the model may use or ignore; none introduces a
new gate, a new blocking check, or a new required field on `AgentStep`.
`reasoning` stays flexible, `memory` stays advisory, `actions` stay typed,
`business truth` stays durable, `side effects` stay governed - unchanged by
this audit.

## 12. Files inspected

`lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts`,
`lib/brain/commercial/sales-agent-runtime/salesAgentRuntime.ts`,
`lib/brain/commercial/agent-loop/runAgentToolLoop.ts`,
`lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts`,
`lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider.ts`,
`lib/brain/commercial/agent-loop/recentCatalogContext.ts`,
`lib/brain/commercial/agent-loop/pendingCatalogAction.ts`,
`lib/brain/commercial/context/buildNativeCommercialContext.ts`,
`lib/brain/commercial/constants.ts`,
`lib/brain/native-whatsapp/service.ts` (`loadNativeConversationDetailByPublicId`),
`lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts`,
`lib/brain/commercial/agent-session/store.ts`,
`lib/brain/commercial/agent-session/types.ts`,
`lib/brain/commercial/agent-session/shadowRecorder.ts`,
`lib/brain/commercial/agent-session/mariaDbAgentSessionStore.ts`,
`lib/brain/commercial/read-tool-request/sessionEvents.ts`,
`docs/releases/SALES-AGENT-R3-V1.7-runtime-dependency-legacy-isolation-audit.md`,
`docs/ACTIVE_RELEASE.md`. Exhaustive grep passes confirmed zero production
(`lib/`, `app/`, `scripts/`) callers of `loadRecentEvents`/`loadSummary`/`rebuildSummary`.

## 13. Tests executed (characterization only, no new tests added)

The existing suites already exercise every code path this audit traced -
no new characterization tests were needed to demonstrate current behavior
with confidence, per this task's own "if necessary" clause.

- `npx tsc --noEmit`: clean, zero errors.
- `tests/commercial/salesAgentRuntime.test.ts` + `tests/commercial/runSalesAgentRuntimeCycle.test.ts`: **26/26 pass** (real MariaDB `crm_test`). Includes `[scenario] session continuity: 'la segunda' resolves against turn 1's own finalPendingCatalogAction` - direct proof of the `pendingCatalogAction` mechanism described in sections 3/6.
- `tests/agent-loop/runAgentToolLoop.test.ts`: **108/108 pass**.
- `tests/commercial/agentSessionStore.test.ts` + `tests/commercial/agentSessionStoreMariaDb.test.ts` + `tests/commercial/agentToolLoopSessionShadow.test.ts`: **57/58 pass**. The one failure (`agentSessionStoreMariaDb.test.ts`, "loadRecentEvents ORDER BY occurred_at, seq returns true insertion order for same-millisecond events") is the exact same pre-existing, unrelated MariaDB-clock flake V1.7 already documented ("Remaining technical debt") - not caused by, and not related to, this audit. Not fixed, per this task's own instruction not to fix unrelated failures.

No production/runtime code, database schema, feature flag, or prompt was
changed by this task.

## 14. Risks / open items

- Root cause in section 6 is architecturally proven but incident-level
  causation is LIKELY, not PROVEN, without real provider request/response
  logs for conversation_id=83 - out of this audit's scope (no production
  data access).
- `AgentSessionStore`'s dead summary path (section 3/10.3) is a real,
  free-standing gap independent of the turn-180-182 incident; worth fixing
  regardless of whether V1.8-B pursues recommendation 2.
- The pre-existing `agentSessionStoreMariaDb.test.ts` flake (section 13)
  remains open, tracked since V1.7, not touched here.

## 15. Verdict

**`R3_V1_8_A_CONTEXT_AUDIT_COMPLETE`**

- Binary question answered: R3 does not reconstruct a conversation; it
  reconstructs durable operational state plus a small, count-bounded,
  low-salience raw-text tail and two structured product-continuity
  primitives. `R3_CONTEXT_CONTINUITY_PARTIAL` confirmed by source, not by
  inference.
- Every one of the task's 10 investigative questions (section headers A-J
  of the task) is answered above with file:line evidence.
- No production code, schema, flag, or prompt changed.
- Targeted regression green (191/192 across the three suite groups above;
  the one failure is a pre-existing, previously-documented, unrelated
  flake) plus clean typecheck.
- Does not advance to V1.8-B.

## Files changed

New:
- `docs/releases/SALES-AGENT-R3-V1.8-A-CONVERSATIONAL-CONTEXT-INPUT-AUDIT.md` (this file)

Modified:
- `docs/ACTIVE_RELEASE.md` (this task's entry under the `SALES-AGENT-R3` workstream)

No production/runtime code was created, modified, or deleted in this task.

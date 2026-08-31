# SALES-AGENT-R3-V1.4 -- Flagged Runtime Routing + Canonical Response Dispatch

Status: implemented and tested against real MariaDB, including one real
DeepSeek call through the new route. `SalesAgentRuntime` (R3-V1.3) is now
reachable from the real WhatsApp inbound path, strictly behind a flag +
allowlist that defaults to off. No general-traffic rollout occurred; no
existing runtime was removed or changed for any wa_id outside the new
allowlist.

## Phase 1 -- Audit: live routing before any change

Traced end to end, not assumed. The real chain:

```
Meta webhook
  -> processNativeWhatsAppInbound (lib/brain/native-whatsapp/service.ts)
     - digit-normalizes sender, dedupes on provider_message_id (returns
       early with `duplicate: true` before any further work if seen before)
     - persists conversation + conversation_message + a
       `meta:whatsapp:inbound` commercial_event, all in one transaction
     - THEN, only for a non-duplicate message:
  -> ensureAutonomousSalesTurnContinuity (lib/brain/commercial/continuity)
     - calls runNativeAutonomousCycle DIRECTLY (not through
       runAgentRuntimeEvent.ts - see the correction below)
     - captures the cycle result and guarantees a terminal disposition
       (never silence) via its own fallback/handoff machinery
  -> runNativeAutonomousCycle (lib/brain/commercial/native-cycle)
     - Steps -1/-0.5/0/0.5: access gate, autonomy killswitch, pilot
       allowlist, opt-out gate (all fail-closed, all pre-existing)
     - Step 1: computes which runtime flags are on (no branching yet)
     - Step 3: resolveNativeCustomerSession + Customer 360 (once, shared
       by every runtime below)
     - Step 4/5: exactly one mutually-exclusive branch runs -
       commercialWorkEnabled -> multiRequestEnabled -> agentToolLoopEnabled
       -> legacy shadow/loop/bridge fallback
```

**Correction to V1.3's own "exact next task" note.** V1.3's release doc
suggested wiring `SalesAgentRuntime` into `runAgentRuntimeEvent.ts` as the
next step. Tracing the real call graph in this audit shows that would not
have worked: `runAgentRuntimeEvent.ts`'s `CUSTOMER_MESSAGE` branch calls
`runNativeAutonomousCycle` itself (grep confirms its only production caller
is `runFollowupTick.ts`, and only for `FOLLOWUP_WAKE`). No real WhatsApp
inbound message reaches `runAgentRuntimeEvent.ts` today -
`ensureAutonomousSalesTurnContinuity.ts` calls `runNativeAutonomousCycle`
directly. Wiring R3 into `runAgentRuntimeEvent.ts`'s `CUSTOMER_MESSAGE`
branch would therefore have been dead code from the real inbound path's
point of view. The only insertion point that is actually reachable from a
real Meta message is inside `runNativeAutonomousCycle.ts` itself, at the
same seam every other runtime (CommercialWork/multi-request/ATL) already
uses.

### Routing matrix (as found, before this task)

| Runtime | Feature flag | Allowlist? | Default-enabled? | Invocation point | Dispatch path | Rollback |
|---|---|---|---|---|---|---|
| CommercialWork (R2) | `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED` | `BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS` | No | `runNativeAutonomousCycle` Step 4/5, checked first | `runCommercialWorkInboundCycle` -> its own dispatch | flag off |
| Multi-request | `BRAIN_MULTI_REQUEST_RUNTIME_ENABLED` (via `isMultiRequestRuntimeEnabled`) | none (global) | No | Step 4/5, checked second | `runMultiRequestAutonomousCycle` -> its own dispatch | flag off |
| Agent Tool Loop (ATL) | `BRAIN_AGENT_TOOL_LOOP_ENABLED` | none (global; multi-intent sub-route has its own) | No | Step 4/5, checked third | `runNativeAgentToolLoopCycle` -> `dispatchAgentLoopResponse` -> canonical outbox | flag off |
| Legacy (shadow/loop/bridge) | `BRAIN_SALES_AGENT_ENABLED` / `BRAIN_COMMERCIAL_SHADOW_ENABLED` / `BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED` | none | No (all default false in this dev env) | fallback when nothing else matched | `runCommercialExecutionBridge` -> canonical outbox | flags off |

This task adds one new row (below), inserted **last** among the
runtime-selection branches - see Phase 3 for why.

## Phase 2 -- Routing policy

Reused the exact `shouldRouteToCommercialWork` shape
(`commercialCycleConfig.ts`), not invented:

```ts
export function buildSalesAgentRuntimeRoutingFeatureFlags(overrides?) {
  return { salesAgentRuntimeEnabled: readEnvFlag("BRAIN_SALES_AGENT_RUNTIME_ENABLED", false), ...overrides };
}

export function shouldRouteToSalesAgentRuntime(waId, env = process.env): boolean {
  if (!buildSalesAgentRuntimeRoutingFeatureFlags().salesAgentRuntimeEnabled) return false;
  const allowlist = loadSalesAgentRuntimeAllowlist(env); // BRAIN_SALES_AGENT_RUNTIME_WA_IDS
  if (allowlist.length === 0) return false;
  return isWaIdAuthorizedForPilot(waId, allowlist);
}
```

`loadSalesAgentRuntimeAllowlist` (new, `autonomousRuntimeConfig.ts`) is the
same digit-normalized, deduped CSV reader every other pilot allowlist in
that file already uses - `BRAIN_SALES_AGENT_RUNTIME_WA_IDS`, independent of
`BRAIN_AUTONOMOUS_TEST_WA_IDS` and `BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS`
(proven by test `[R3-Route-7]`). Both the flag and the allowlist must be
non-empty/true; an ambiguous configuration (flag on, empty allowlist) fails
closed for everyone, same as every sibling routing function. No
percentages, cohorts, or random assignment were added.

Illustrative names from the task (`BRAIN_R3_RUNTIME_*`) were **not** used
verbatim - `BRAIN_SALES_AGENT_RUNTIME_*` matches this repo's real naming
convention (the module is `sales-agent-runtime/`, not `r3-runtime/`) per
the task's own instruction to prefer repository conventions.

## Phase 3 -- Insertion point

`runNativeAutonomousCycle.ts`, Step 4/5: a new `if (salesAgentRuntimeEnabled)`
branch, inserted **after** the existing `agentToolLoopEnabled` branch and
**before** the legacy fallback - i.e. **last priority** among the four
runtime-selection branches, not first.

This is a deliberate divergence from this codebase's own precedent (each
newer runtime was historically given top priority - see
`shouldRouteToCommercialWork`'s own comment, "checked first ... top
priority"). Reasoning: R3 is a brand-new pilot with its own independent
allowlist. If an operator ever allowlists the same wa_id for both an
existing pilot (CommercialWork/multi-intent) and R3 by mistake, giving R3
top priority would silently steal that wa_id away from a route already in
active use. Bottom priority means R3 can only ever activate for a wa_id
that is *not* already claimed by a more mature, already-validated route -
strictly additive risk, never a silent takeover.

Why this point is safe:

- Step 3 (identity/session resolution, `resolveNativeCustomerSession`) and
  Step 3 continued (Customer 360 load) have already run **once**, shared by
  every branch - the R3 branch reads `session.execution`/`customer360`, it
  never re-resolves them.
- No old-runtime side effect has occurred yet: the branches are
  `if/else if` with early `return`s, and the R3 check happens before the
  legacy shadow/loop/bridge code (the only branch with side effects that
  isn't already gated by its own early return) ever executes.
- The same `buildNativeCommercialContext` snapshot every other branch reads
  is built fresh inside the R3 branch, from the same source, so no
  first-branch side effect could have gone stale by the time R3 reads it
  (there is no such side effect to go stale, per the point above).

## Phase 4 -- AgentRuntimeEvent construction

Built directly inside the new dispatch adapter (`runSalesAgentRuntimeCycle.ts`,
Phase 5 below) from real, already-normalized fields already available at
this seam - never a second event type, never fabricated:

```ts
const event: AgentRuntimeEvent = {
  type: "CUSTOMER_MESSAGE",
  conversationId: input.conversationId,       // real, from processNativeWhatsAppInbound's transaction
  conversationPublicId: input.conversationPublicId,
  customerMasterId: input.customerMasterId,   // real, from identity resolution (Step 3), often null
  waId: input.waId,
  phoneNumberId: input.phoneNumberId,
  messageId: input.messageId,                 // real inbound message id
  messageText: input.customerMessage,
  correlationId: input.correlationId,         // same correlationId as the whole turn
  currentTime: input.currentTime
};
```

`opportunityId`/`intent`/`objective`/`stage`/planner state are never set -
`opportunityId` is passed separately (`null` unless CommercialContextSnapshot
already carries one), and V1.1/V1.2's lazy resolution owns creating one, as
before.

## Phase 5/6 -- SalesAgentRuntime invocation + provider wiring

New file: `lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts`
(`runSalesAgentRuntimeCycle`) - the channel-adapter/dispatch seam around
`runSalesAgentRuntime` (V1.3), deliberately **not** part of that module
(preserves its "SalesAgentRuntime reasons, the channel adapter routes"
boundary - Scope Guard: no Meta/WhatsApp/outbox logic was added inside
`salesAgentRuntime.ts`, confirmed unmodified by this task).

The routing branch in `runNativeAutonomousCycle.ts` resolves
`ResolvedSalesAgentConfiguration` via the real `resolveSalesAgentConfiguration()`
(same call, same config-failure handoff fallback -
`runNativeAgentToolLoopCycleConfigurationFailure`, reused verbatim - as the
`agentToolLoopEnabled` branch immediately above it) and constructs the
provider via `createHttpAgentLoopProvider(...)` from that resolved
configuration's `effectiveModelConfiguration` - byte-identical construction
to ATL's own, unless a test overrides it via the pre-existing
`input.agentLoopProvider` DI seam. No second DeepSeek provider, no
dependency on `experiments/deepseek-harness`.

`runSalesAgentRuntimeCycle` passes through: `event`, `opportunityId` (from
the snapshot, never re-derived), `provider`, `trustedCustomerSession`,
`recentCatalogContext`/`pendingCatalogAction` (loaded the same way as ATL's
branch - same loaders, same DI seams), `identityConfiguration` (the
resolved configuration's prompt personality), budgets (`maxDecisions`/
`maxToolExecutions`/`timeoutMs` from the resolved loop/model configuration),
and `governance: { humanOwnerActive, aiBlocked }` from
`snapshot.signals` - the one real invariant this boundary must enforce
before ever calling the model.

## Phase 7 -- Canonical response dispatch

`runSalesAgentRuntimeCycle` maps `SalesAgentRuntimeResult` onto the three
fields `dispatchAgentLoopResponse` (ATL's own canonical dispatcher,
**reused verbatim, unmodified**) actually reads
(`terminalReason`/`finalMessage`/`handoffReason`) via a small local adapter
object - never a second outbox writer, never raw SQL, never a direct Meta
call:

```ts
const loop: AgentLoopResult = {
  ran: true,
  terminalReason: mapToAgentLoopTerminalReason(runtime), // inverse of V1.3's own status table
  steps: [],                 // honestly empty - see Known limitations
  toolExecutionCount: runtime.toolCalls,
  finalMessage: runtime.responseText,
  handoffReason: runtime.status === "handoff" ? runtime.reason : null,
  warnings: runtime.warnings,
  finalPendingCatalogAction: runtime.finalPendingCatalogAction,
  llmCalls: []
};
await dispatchAgentLoopResponse({ ...., loop, opportunityId: runtime.resolvedOpportunityId, ... });
```

`dispatchAgentLoopResponse.ts` itself was **not modified** - only a full,
honestly-populated `AgentLoopResult`-shaped value is passed to it, built
entirely from real `SalesAgentRuntimeResult` fields (never a fabricated
placeholder for a field the function actually reads).

Proven by test (`tests/commercial/runSalesAgentRuntimeCycle.test.ts`,
`[RC1]`): a `responded` turn produces exactly one `send_whatsapp_reply`
`crm_agent_actions` row and one canonical outbox write, and the recorded
`agent_tool_loop_completed` event carries the real (not fabricated)
resolved configuration.

## Phase 8 -- Non-responded semantics

Reused, not reinvented:

- **handoff** -> `dispatchAgentLoopResponse` builds the same
  `buildContinuityFallbackMessage("handoff_acknowledgement", ...)`
  acknowledgement ATL's handoff already uses, and (via the existing
  `takeHumanControlForAiHandoff` call inside `dispatchAgentLoopResponse`)
  durably hands the conversation to a human before the acknowledgement is
  even built. Proven by `[RC3]`.
- **blocked** (governance) -> `runSalesAgentRuntime` itself already refuses
  to call the model (V1.3 Phase 14); `runSalesAgentRuntimeCycle` detects
  `status === "blocked"` and returns a skipped-shape result with **zero**
  dispatch attempt and **zero** `agent_tool_loop_completed` event - mirrors
  `runNativeAgentToolLoopCycle.ts`'s own `skippedResult` exactly. Proven by
  `[RC2]`.
- **failed** (provider timeout / invalid output / provider unavailable) ->
  `dispatchAgentLoopResponse` maps the terminal reason onto the same
  `buildContinuityFallbackMessage` vocabulary ATL already uses (never a
  business claim). Proven by `[RC4]` (a throwing provider dispatches a
  neutral fallback, `runtime.responseText` stays `null`).

`ensureAutonomousSalesTurnContinuity.ts` gained one new branch
(`if (cycle.salesAgentRuntime)`), mirroring its existing `cycle.agentLoop`
branch field-for-field (adapted to `status`/`responseText`/`reason`
instead of `terminalReason`/`finalMessage`/`handoffReason`) so the
completion/correlation/disposition audit trail (`autonomous_turn_disposition`
/ `autonomous_turn_continuity_failed` commercial_events) is recorded
correctly for R3 turns too, and so R3 never falls through into the
legacy/`cycle.loop`/`cycle.bridge` disposition logic (which would have
misclassified every R3 turn as `no_response_required`, since `cycle.loop`
and `cycle.bridge` are both `null` for the R3 branch, same as they already
are for `cycle.agentLoop`/`cycle.commercialWork`/`cycle.multiRequest`).

## Phase 9 -- Cross-turn RecentCatalogContext continuity (V1.3's documented gap)

**Closed, via Phase 9's own Option A** (reuse an existing pure
event-recording primitive after `SalesAgentRuntime` completes) - not B
(extracting a helper from `runNativeAgentToolLoopCycle.ts`, unnecessary
once A works) and not C (changing what `loadRecentCatalogContext`
correlates against, unnecessary and riskier).

The audit confirmed the exact chain V1.3 described:
`crm_capability_executions` row -> (direct `commercial_event_id` FK, or
fallback: same `correlation_id`) -> a `commercial_event` row with
`event_type = 'agent_tool_loop_completed'` -> its `payload_json.inboundMessageId`.
`runSalesAgentRuntimeCycle` calls the exact same
`recordAgentToolLoopCompletedCommercialEvent` (`events/service.ts`)
`runNativeAgentToolLoopCycle.ts` already calls, **after** the loop and
dispatch complete, using the **same `correlationId`** that flowed through
to every tool call this turn (`event.correlationId === input.correlationId`)
- so the fallback correlation path `loadRecentCatalogContext`'s own SQL
already implements picks up the match automatically, with zero SQL changes.

Critically, this is done with **real, resolved configuration data**, never
fabricated: because Phase 6 already resolves
`ResolvedSalesAgentConfiguration` via the real resolver at this seam (the
routing branch, not inside `SalesAgentRuntime` itself),
`configurationSource`/`configurationRecordId`/`configurationVersion`/
`configurationHash`/`effectiveModel`/`effectiveTemperature`/etc. are all
genuine values, not placeholders - resolving V1.3's own stated blocker
("writing it from here would mean fabricating configuration fields ... a
correctness violation") without pulling ATL's full production dependency
graph into `SalesAgentRuntime` itself. `toolsUsed`/`stepsSummary` are left
honestly empty (`[]`) - `SalesAgentRuntimeResult` does not expose per-tool
names or step-level detail by design (V1.3 Phase 15: counts only), and
this task did not widen that contract to get them. Full per-tool detail
remains available via `crm_capability_executions`/`AgentSession`, exactly
as V1.3 already noted.

**Proven by test, not just by code inspection**
(`[RC6]`, `tests/commercial/runSalesAgentRuntimeCycle.test.ts`): a real
`search_products` tool call inside one `runSalesAgentRuntimeCycle` turn is
durably visible to a fresh `loadRecentCatalogContext({conversationId, ...})`
call afterward - the exact scenario V1.3 documented as broken standalone.

## Phase 10 -- pendingCatalogAction continuity

Unchanged from V1.3: `runSalesAgentRuntime` already returns
`finalPendingCatalogAction` as a structured, runtime-managed value.
`runSalesAgentRuntimeCycle` persists it onto the SAME
`agent_tool_loop_completed` event (Phase 9's event, one write, not a
second one) **only when dispatch actually wrote the outbox** - identical
"never persist a pending action nobody was told about" discipline ATL's
own `runNativeAgentToolLoopCycle.ts` already enforces, including the same
`pending_catalog_action_dropped_no_outbox` warning when it can't be kept.
`loadPendingCatalogAction` (unchanged) already reads this same event table
by `conversation_id`, so a second turn's "la segunda" reference resolves
correctly with zero new storage. Proven by `[RC7]` (both branches: no
outbox -> not persisted; outbox written -> persisted and reloadable).

## Phase 11 -- Opportunity propagation

`SalesAgentRuntimeResult.resolvedOpportunityId` (V1.3's own addition) now
flows to both places the task asks for, using only existing schema/paths:

- `dispatchAgentLoopResponse`'s `opportunityId` parameter (already existed
  for ATL) - the dispatched `crm_agent_actions` row's `opportunity_id`
  column is the turn's real, resolved id, not the pre-turn one.
- `recordAgentToolLoopCompletedCommercialEvent`'s `opportunityId` (already
  existed) - the recorded `commercial_event.opportunity_id` matches too.

Proven by `[RC5]`: a `select_products` mutation resolves/creates an
opportunity, and both the `crm_agent_actions.opportunity_id` and the
`commercial_event.opportunity_id` equal
`SalesAgentRuntimeResult.resolvedOpportunityId` exactly. No second
opportunity lookup was added - the routing branch never re-queries
`crm_opportunities`; it only reads the id the runtime already resolved.

## Phase 12 -- Exact inbound idempotency

Audited, not newly built. `processNativeWhatsAppInbound` (unchanged by
this task) already dedupes on `provider_message_id` **before**
`ensureAutonomousSalesTurnContinuity` (and therefore
`runNativeAutonomousCycle` and this task's new branch) is ever called - a
redelivered Meta message returns `{ duplicate: true, ... }` and never
reaches the routing decision at all. This invariant already has direct
regression coverage (`tests/native/native-whatsapp.test.ts`, "duplicate
delivery status does not duplicate CommercialEvent", run as part of this
task's own regression pass, still green). No second, R3-only dedupe
mechanism was built - the task's own preference ("do NOT build a second
R3-only dedupe mechanism unless unavoidable") is satisfied by reusing the
existing upstream guarantee.

## Phase 13 -- AgentSession

Unchanged, and reconfirmed non-blocking: `runSalesAgentRuntime` already
degrades an `AgentSession` write failure to a warning (V1.3), never a
thrown error. This task's own local dev database still does not have
migration 033 applied (same gap V1.3 documented) - every test run and the
Phase 18 smoke below produced the warning
`agent_session_shadow_event_write_failed:Table 'main_management.agent_sessions'
doesn't exist` and the turn completed normally regardless, proving the
non-blocking contract holds at this new boundary too.

## Phase 14 -- Observability

Every R3-routed turn is correlatable end to end via the single
`correlationId` that flows through: `processNativeWhatsAppInbound`'s
`correlationId` -> `runNativeAutonomousCycle` -> `AgentRuntimeEvent.correlationId`
-> every `crm_capability_executions.correlation_id` this turn -> the
`agent_tool_loop_completed` `commercial_event.correlation_id` -> the
dispatched `crm_agent_actions`/outbox row (via the shared
`inboundMessageId`-keyed idempotency key). `runtime = r3` vs `runtime =
legacy/agentLoop/commercialWork/multiRequest` is distinguishable by which
field on `NativeAutonomousCycleResult` is populated
(`result.salesAgentRuntime` vs `result.agentLoop`/`result.commercialWork`/
`result.multiRequest`/`result.loop`) and by `result.reason` (`"sales_agent_runtime"`
for the new route). No dashboard was built; no chain-of-thought is
persisted anywhere in this chain (confirmed by V1.3's own exact-key-set
test, unmodified, still green).

## Phase 15 -- Fallback/failure policy

R3 is a terminal branch in the `if/else if` chain in
`runNativeAutonomousCycle.ts`, exactly like every sibling runtime branch -
once `salesAgentRuntimeEnabled` is true for a turn, it `return`s directly;
nothing after it in the function ever runs for that turn. A terminal R3
failure (`status: "failed"`) dispatches its own neutral fallback (Phase 8)
and returns - it never falls through to the legacy shadow/loop/bridge code
for the same inbound message. "Fallback" for this task means exactly what
the task specifies: **flag off / wa_id not allowlisted routes to the
existing runtime** (a routing-time decision, made once, before the model
is ever called) - never a runtime-time replay of the same message through
a second runtime after R3 already ran.

## Phase 16 -- Kill switch

`BRAIN_SALES_AGENT_RUNTIME_ENABLED` defaults to `false`
(`readEnvFlag(..., false)`). With it off (or unset), `shouldRouteToSalesAgentRuntime`
returns `false` unconditionally regardless of the allowlist, and
`runNativeAutonomousCycle` never evaluates the R3 branch at all - routing
falls through exactly to whatever branch would have run before this task
(proven by every regression test in this task's own run: none of them set
`BRAIN_SALES_AGENT_RUNTIME_ENABLED`, and all pass identically to their
pre-existing behavior). Tested directly by `[R3-Route-5]`. No deploy or
code change is needed to stop the pilot - flipping the env var is the
entire rollback.

## Phase 17 -- Controlled integration test

Covered across two new test files
(`tests/commercial/shouldRouteToSalesAgentRuntime.test.ts`,
`tests/commercial/runSalesAgentRuntimeCycle.test.ts`), mapped against the
task's own scenario list:

| Scenario | Test |
|---|---|
| 1. R3 disabled -> current runtime, SalesAgentRuntime never invoked | `[R3-Route-5]` |
| 2. R3 enabled, wa_id not allowlisted -> current runtime | `[R3-Route-2]`/`[R3-Route-3]` |
| 3. R3 enabled, wa_id allowlisted -> SalesAgentRuntime invoked exactly once | `[R3-Route-1]`, `[RC1]` |
| 4. R3 responded -> canonical outbound exactly once | `[RC1]` |
| 5. R3 provider failure -> current runtime NOT run afterward, no duplicate outbound | `[RC4]` (structural: R3 is a terminal branch - Phase 15) |
| 6. duplicate inbound -> no duplicate execution/outbound | Phase 12 (upstream dedupe, existing coverage) |
| 7. READ-only turn -> no opportunity created | `[scenario] pure product lookup` (`salesAgentRuntime.test.ts`, unmodified, reused) |
| 8. mutation turn -> opportunity created/reused lazily | `[RC5]` |
| 9. second turn "la segunda" -> durable catalog continuity | `[RC6]` (RecentCatalogContext) + V1.3's own `[scenario] session continuity` (finalPendingCatalogAction, unmodified) |
| 10. same-turn resolved opportunity -> completion/outbound metadata | `[RC5]` |

Routing-level scenarios (2/3) at the config layer only need the pure
`shouldRouteToSalesAgentRuntime` function - no DB, no HTTP, matching this
repo's own precedent for the sibling `shouldRouteToMultiIntentPlanner`.

## Phase 18 -- Real provider smoke, no Meta send

Run in this environment (DeepSeek credentials are configured in `.env`;
the real Catalog Service at `CATALOG_SERVICE_BASE_URL=http://127.0.0.1:4010`
is **not** reachable here - confirmed via a direct `curl` before writing
the smoke script, so a local HTTP mock stood in for the Catalog Service
only, never for the model call itself).

Real query: `"que barras olimpicas tienen?"` (read-only). Result:

```json
{
  "runtime": {
    "status": "responded",
    "responseText": "Tenemos la Barra Olímpica de 20kg. Quedan 6 unidades disponibles. ¿Quieres que te envíe el link para revisarlo?",
    "modelSteps": 2,
    "toolCalls": 1,
    "readToolCalls": 1,
    "resolvedOpportunityId": null,
    "finalPendingCatalogAction": { "actionType": "send_product_link", "candidateProductIds": ["701"] },
    "durationMs": 6517,
    "inputTokens": 12227,
    "outputTokens": 521
  },
  "dispatchOutboxWritten": true,
  "dispatchOutboxId": 6542
}
```

Confirms real normalized event -> R3 route -> real DeepSeek (`deepseek-v4-flash`,
resolved via the real `resolveSalesAgentConfiguration()` -> `BRAIN_MODEL_NAME`,
6.5s round trip, real token counts) -> real `ReadToolGateway`/Capability
Gateway `search_products` call -> a grounded response (the 20kg/6-units
figures match the mock Catalog fixture exactly, never invented) -> a real
canonical outbox row written (`brain_message_outbox` id 6542). `BRAIN_META_SEND_ENABLED`
and `BRAIN_OUTBOX_WORKER_ENABLED` were never set and the outbox worker
process was never started - no customer received anything. Only local dev
database rows were written (same blast radius as every other DB-backed
test in this task).

An earlier attempt using the safe-default configuration fixture instead of
the real resolver failed with a real HTTP 400 from the provider (the fixture's
placeholder model name, `"brain-agent-loop"`, is not a real DeepSeek model
id) - left as a useful negative data point for why Phase 6's "reuse the real
resolver at the routing seam" matters, not just as a convenience.

## Phase 19 -- Tests

New files:

- `tests/commercial/shouldRouteToSalesAgentRuntime.test.ts` (7 tests,
  config-level, no DB) - flag off/on, allowlist hit/miss/empty/malformed,
  missing waId, independence from every other pilot allowlist.
- `tests/commercial/runSalesAgentRuntimeCycle.test.ts` (7 tests, real
  MariaDB `main_management`, local HTTP Catalog mock) - responded dispatch
  + real configuration in the recorded event (`[RC1]`), governance-blocked
  zero-dispatch (`[RC2]`), handoff acknowledgement pipeline (`[RC3]`),
  provider-failure structured fallback (`[RC4]`), resolvedOpportunityId
  propagation (`[RC5]`), RecentCatalogContext continuity (`[RC6]`),
  pendingCatalogAction persistence gated on outbox write (`[RC7]`).

**Regression suites** (Phase 19's own list plus every file this task's own
dependency graph touches), run against real MariaDB, all green -
**242/242 passing, 0 failures, 0 new**:

`tests/commercial/salesAgentRuntime.test.ts` (16, V1.3, unmodified),
`tests/commercial/resolveRuntimeOpportunity.test.ts`,
`tests/commercial/ensureCommercialActionOpportunity.test.ts`,
`tests/commercial/agentRuntimeEvent.test.ts`,
`tests/commercial/followUpWake.test.ts`,
`tests/native/ensureAutonomousSalesTurnContinuity.test.ts`,
`tests/commercial/runNativeAutonomousCyclePilotIsolation.test.ts`,
`tests/commercial/runNativeAutonomousCycleOptOut.test.ts`,
`tests/commercial/runNativeAutonomousCycleCustomer360.test.ts`,
`tests/agent-loop/runNativeAgentToolLoopCycleConfig.test.ts`,
`tests/commercial/capabilityGatewayIdentityGate.test.ts` (97 total),
`tests/agent-loop/runAgentToolLoop.test.ts`,
`tests/commercial/multiRequestRuntime.test.ts`,
`tests/agent-loop/multi-intent/shouldRouteToMultiIntentPlanner.test.ts`,
`tests/agent-loop/multi-intent/routingIntegration.test.ts`,
`tests/native/native-whatsapp.test.ts` (135 total),
`tests/commercial/commercialWorkInboundCycle.test.ts` (10, `crm_test` DB -
proves CommercialWork's own routing/allowlist behavior is untouched by
R3's new branch being inserted after it).

`npx tsc --noEmit`: clean, both before writing tests and after this task's
full diff.

The full-repo suite (`npm test`, thousands of files) was not re-run in
full for this task - the 242-test targeted regression run above covers
every file this task's own changes import, are imported by, or share a
routing decision with; V1.3's own full-repo run already established the
53 pre-existing, unrelated failures in this local dev environment (identity
evidence, onboarding, schema-integrity checks) that this task did not
touch.

## Phase 20 -- This document.

## Files changed

New:
- `lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts`
- `tests/commercial/shouldRouteToSalesAgentRuntime.test.ts`
- `tests/commercial/runSalesAgentRuntimeCycle.test.ts`
- `docs/releases/SALES-AGENT-R3-V1.4-flagged-runtime-routing.md` (this file)

Modified:
- `lib/brain/commercial/sales-agent-runtime/index.ts` (barrel export for the new module)
- `lib/brain/runtime/autonomousRuntimeConfig.ts` (`loadSalesAgentRuntimeAllowlist`)
- `lib/brain/commercial/config/commercialCycleConfig.ts`
  (`buildSalesAgentRuntimeRoutingFeatureFlags`, `shouldRouteToSalesAgentRuntime`)
- `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts`
  (routing branch, `salesAgentRuntime` result field)
- `lib/brain/commercial/continuity/ensureAutonomousSalesTurnContinuity.ts`
  (`cycle.salesAgentRuntime` disposition branch)

Untouched, confirmed by grep/test: `dispatchAgentLoopResponse.ts`,
`runAgentToolLoop.ts`, `runNativeAgentToolLoopCycle.ts`,
`runAgentRuntimeEvent.ts`, `salesAgentRuntime.ts`, the outbox worker, the
Meta transport client, and every other runtime's own routing function.

## Limitations (explicit)

- **`toolsUsed`/`stepsSummary` are always empty (`[]`) on the R3
  `agent_tool_loop_completed` event.** `SalesAgentRuntimeResult` does not
  expose per-tool names or step-level detail by design (V1.3 Phase 15).
  Widening that contract was out of scope for this task. Full per-tool
  detail for an R3 turn remains available via `crm_capability_executions`
  and `AgentSession` (both already recorded, per-tool, with zero new
  wiring), same as V1.3 already documented.
- **The real Catalog Service was not reachable in this environment** for
  the Phase 18 smoke - a local HTTP mock stood in for it. The DeepSeek call
  itself, the prompt/tool-decision loop, the Capability Gateway path, and
  the canonical dispatch were all real.
- **`AgentSession`/`agent_session_event` tables still do not exist in this
  local dev `main_management` database** (migration 033 present in the
  repo, not applied here) - every shadow session write degrades to a
  warning, never blocks a turn (V1.3's own finding, reconfirmed here).
- Only local, low-volume regression + one smoke turn were run against real
  MariaDB in this environment - no load/concurrency testing of the new
  branch was performed beyond what V1.1/V1.2's own concurrency tests
  already cover for lazy opportunity resolution (reused unmodified).

## Exact next-task pilot procedure

1. Confirm `BRAIN_SALES_AGENT_RUNTIME_ENABLED` is unset/false in every
   deployed environment (default - no action needed unless already
   overridden).
2. To open the pilot for a specific WhatsApp number: set
   `BRAIN_SALES_AGENT_RUNTIME_ENABLED=true` and
   `BRAIN_SALES_AGENT_RUNTIME_WA_IDS=<digit-normalized wa_id(s)>` in the
   real deployment environment (never `.env` in this repo).
3. Confirm the existing WhatsApp access gate
   (`BRAIN_WHATSAPP_TEST_MODE_ENABLED`/`BRAIN_WHATSAPP_TEST_WA_IDS`) and
   autonomy killswitch (`BRAIN_AUTONOMOUS_RESPONSES_ENABLED`) already admit
   that same wa_id - R3's own allowlist is layered on top of those, not a
   replacement for them.
4. Send one real, low-stakes read-only message from the allowlisted number
   and confirm: `commercial_event` shows an `agent_tool_loop_completed` row
   with `configurationSource` matching the real deployment configuration; a
   `brain_message_outbox` row was written; the outbox worker (a separate
   process, its own `BRAIN_META_SEND_ENABLED` flag) actually delivers it.
5. To roll back at any point: unset/flip `BRAIN_SALES_AGENT_RUNTIME_ENABLED`
   to `false`. No deploy, no code change, no migration to revert.

---

## Exit criteria

**`R3_V1_4_FLAGGED_RUNTIME_ROUTING_VALIDATED`**

- Real inbound routing can select SalesAgentRuntime -- confirmed, traced
  end to end from `processNativeWhatsAppInbound` through
  `runNativeAutonomousCycle`'s new branch.
- Selection is flag + allowlist controlled -- confirmed
  (`shouldRouteToSalesAgentRuntime`, 7 tests).
- Default/current traffic remains unchanged -- confirmed: flag defaults
  false, 242 regression tests (none setting the new flag) pass identically.
- SalesAgentRuntime receives a real `CustomerMessageEvent` -- confirmed,
  built from real normalized fields, no fabrication.
- Existing `AgentLoopProvider`/HTTP path is reused -- confirmed, same
  `createHttpAgentLoopProvider`/`resolveSalesAgentConfiguration` call as
  ATL, proven with one real DeepSeek call.
- R3 final response uses the canonical outbound path -- confirmed,
  `dispatchAgentLoopResponse` reused unmodified.
- No direct Meta send exists in SalesAgentRuntime -- confirmed, unmodified,
  zero Meta/WhatsApp imports in `sales-agent-runtime/`.
- No duplicate outbox writer exists -- confirmed, one shared dispatcher.
- Cross-turn product continuity is safe enough for a WhatsApp pilot --
  confirmed, RecentCatalogContext gap closed and proven by test (`[RC6]`);
  pendingCatalogAction continuity proven by test (`[RC7]`).
- Same-turn resolved opportunity is correlated downstream -- confirmed
  (`[RC5]`).
- Duplicate inbound cannot produce duplicate execution/outbound --
  confirmed, upstream dedupe in `processNativeWhatsAppInbound`, unchanged.
- R3 failure does not replay the message through another runtime --
  confirmed structurally (terminal branch, Phase 15).
- Kill switch is deterministic -- confirmed (`[R3-Route-5]`).
- AgentSession remains non-authoritative and non-blocking -- confirmed,
  reconfirmed via the real smoke's own warning.
- No intent/objective/workflow machinery was added -- confirmed, grep of
  the new files shows zero matches.
- No chain-of-thought is persisted -- confirmed, V1.3's own exact-key-set
  test still passes unmodified.
- Existing runtimes remain compatible -- confirmed, 242/242 regression.
- No general-traffic rollout occurred -- confirmed, flag off by default,
  no allowlist entries added anywhere in this repo.
- Regressions are clean -- confirmed for every suite this task's
  dependency graph touches.

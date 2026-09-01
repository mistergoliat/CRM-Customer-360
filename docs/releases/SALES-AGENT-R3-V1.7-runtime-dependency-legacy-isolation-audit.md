# SALES-AGENT-R3-V1.7 -- Runtime Dependency & Legacy Isolation Audit

Status: audit complete, static/runtime authority tests added and green
against real MariaDB (`crm_test`). Not a feature release, not a broad
refactor - no production behavior changed. One documentation-only artifact
(this file) plus two new test files. `docs/ACTIVE_RELEASE.md` updated in the
same change.

## Executive summary

The productive R3 path is isolated from the R1 action-lifecycle stack
(`action-queue`/`autonomy-sandbox`/`execution-gate`/`dispatchAgentLoopResponse`)
and from every other commercial runtime (CommercialWork, multi-request,
multi-intent, legacy `sales-consultative`) at both the direct-import level
and the runtime-branch level, with one narrow, deliberate, now-explicitly-
tested exception: two R3 dispatch files import a single pure digit-
normalization helper (`normalizeWaIdDigits`) from the `autonomy-sandbox`
barrel. That helper performs no persistence, owns no routing, has no legacy
feature gate, and executes no side effect - it is classified `KEEP_SHARED`,
not legacy contamination, per this task's own carve-out for neutral shared
helpers (section 4). Its exact shape is now guarded by a dedicated test
([ISO3]) so it can never silently widen into a real dependency on the R1
sandbox-evaluation logic.

No routing defect was found that prevents the intended R3 branch from being
authoritative. No corrections to production code were made. The one thing
this audit's own literal test-writing surfaced - a stray *comment* in three
files that merely *names* a forbidden identifier for documentation purposes
(not a real import/call) - required a test-authoring fix, not a code fix
(see "Authority tests added").

Verdict: **`R3_V1_7_RUNTIME_ISOLATION_VALIDATED`**

## Canonical R3 productive path

Reconstructed by reading the actual call/import graph (not inferred from
file names), starting at the real Meta entrypoint:

```
Meta inbound
  -> app/api/integrations/whatsapp/webhook/route.ts
       (Meta signature verify, BRAIN_WHATSAPP_ALLOWED_WA_IDS /
        BRAIN_AUTONOMOUS_TEST_WA_IDS allowlist gate at the HTTP layer)
  -> processNativeWhatsAppInbound            (lib/brain/native-whatsapp/service.ts)
       - identity resolution (resolveOrPersistNativeExternalIdentity)
       - persists conversation + conversation_message + commercial_event
         (inbound), inside one transaction
       -> ensureAutonomousSalesTurnContinuity  (continuity/ensureAutonomousSalesTurnContinuity.ts)
            -> runNativeAutonomousCycle        (native-cycle/runNativeAutonomousCycle.ts)
                 Step -1..0.5: WhatsApp access gate, autonomy killswitch,
                   pilot allowlist, opt-out gate (all fail-closed, all
                   checked before any DB session resolution or LLM call)
                 Step 1: runtime-branch selection (see routing table below)
                 Step 3: resolveNativeCustomerSession (Identity/Session -
                   shared by every branch, including R3)
                 -> [salesAgentRuntimeEnabled branch]
                    runSalesAgentRuntimeCycle    (sales-agent-runtime/runSalesAgentRuntimeCycle.ts)
                      -> runSalesAgentRuntime    (sales-agent-runtime/salesAgentRuntime.ts)
                           -> runAgentToolLoop    (agent-loop/runAgentToolLoop.ts - ATL, the
                                                    shared reasoning engine, KEEP_SHARED)
                                -> ReadToolGateway        (read-tool-request/executeReadTool.ts)
                                     -> Capability Gateway (capability-gateway/executeCapability.ts,
                                                             registry.ts)
                                -> CommercialActionRequest (commercial-action-request/executeCommercialActionRequest.ts)
                                     -> Capability Gateway
                           -> ensureCommercialActionOpportunity (lazy opportunity wiring,
                                commercial-action-request/ensureCommercialActionOpportunity.ts)
                           -> AgentSessionStore shadow recording (agent-session/shadowRecorder.ts,
                                non-blocking, degrades to a warning)
                      -> dispatchSalesAgentTerminalOutcome (sales-agent-runtime/dispatchSalesAgentTerminalOutcome.ts)
                           -> dispatchSalesAgentResponse.ts | dispatchSalesAgentFallback.ts |
                              dispatchSalesAgentHardHandoff.ts
                                -> dispatchGovernedSalesAgentMessage.ts (governance, transactional
                                     ownership recheck, DB-backed dedupe)
                                     -> canonicalOutboxWriter.ts (writeCanonicalOutboxMessage)
                                          -> brain_message_outbox
                                     -> lib/domains/conversations/control.ts (takeHumanControlForAiHandoff,
                                          isConversationClosedStatus - hard-handoff only)
            -> (ensureAutonomousSalesTurnContinuity's cycle.salesAgentRuntime
                branch only DERIVES the disposition/audit record from the
                already-dispatched result above - it never dispatches again)
-> autonomous outbox worker (scripts/autonomous-outbox-worker.ts, a separate
     process) polls brain_message_outbox -> Meta
```

This is the same architecture V1.6 established; V1.7 adds nothing to it and
verifies it end-to-end against the real, current source tree.

## `runNativeAutonomousCycle` routing table

Branch-selection flags are computed once (Step 1), then checked **in this
exact order** - first true wins, and reaching a branch always returns before
any later branch's code runs for the same turn:

| Order | Branch | Trigger condition | Feature flag(s) | Reachable under intended R3 pilot flags? | Can it preempt R3? |
|---|---|---|---|---|---|
| pre-1 | WhatsApp access gate | `isWaIdAllowedByAccessGate` | `BRAIN_WHATSAPP_TEST_MODE_ENABLED` (default `true`), `BRAIN_WHATSAPP_TEST_WA_IDS` | Gate, not a runtime - must pass for any branch, R3 included | N/A (shared gate) |
| pre-2 | Autonomy killswitch | `loadAutonomousResponsesEnabled` | `BRAIN_AUTONOMOUS_RESPONSES_ENABLED` (default `false`) | Must be `true` for R3 to dispatch anything | N/A (shared gate) |
| pre-3 | Pilot allowlist | `isWaIdAuthorizedForPilot` | `BRAIN_AUTONOMOUS_TEST_WA_IDS` | Empty allowlist = unrestricted; a non-empty one must include the pilot's waId | N/A (shared gate) |
| pre-4 | Opt-out gate | `checkCustomerOptOutStatus` / explicit opt-in/opt-out commands | (data-driven, no flag) | Always active | No - blocks every branch equally |
| 1 | **CommercialWork (R2)** | `shouldRouteToCommercialWork(waId)` | `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED` + non-empty `BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS` containing this waId | No, under the recommended pilot flag set (section "Recommended EC2 pilot flag set") | **Yes** if misconfigured with the same waId in both allowlists - highest priority, checked first |
| 2 | **Multi-request runtime** | `isMultiRequestRuntimeEnabled()` | `BRAIN_MULTI_REQUEST_RUNTIME_ENABLED` (global, no allowlist) | No | **Yes** if left `true` - global flag, no per-waId scoping, would preempt every R3 turn |
| 3 | **Agent Tool Loop (ATL)** | `buildAgentToolLoopFeatureFlags().agentToolLoopEnabled` | `BRAIN_AGENT_TOOL_LOOP_ENABLED` (global, no allowlist) | No | **Yes** if left `true` - global flag, would preempt every R3 turn |
| 3a | Multi-intent planner (sub-branch of ATL, not a top-level branch) | `shouldRouteToMultiIntentPlanner(waId)`, checked *inside* `runNativeAgentToolLoopCycle.ts` | `BRAIN_MULTI_INTENT_PLANNER_ENABLED` + non-empty `BRAIN_AUTONOMOUS_TEST_WA_IDS` | Not reachable from R3 at all (only reachable when branch 3 itself is selected) | No - it cannot even be evaluated unless ATL (branch 3) already won |
| 4 | **SalesAgentRuntime (R3)** | `shouldRouteToSalesAgentRuntime(waId)` | `BRAIN_SALES_AGENT_RUNTIME_ENABLED` + non-empty `BRAIN_SALES_AGENT_RUNTIME_WA_IDS` containing this waId | **Yes** - this is the intended branch | Deliberately lowest priority among the four pilot branches (by design, so a new pilot can never silently steal a waId already owned by a more mature one) |
| 5 (fallthrough) | Legacy shadow / operational-loop / execution-bridge pipeline | none of branches 1-4 enabled for this turn, and `isAutonomyCycleEnabled()` or `commercialShadowEnabled` is true | `BRAIN_SALES_AGENT_ENABLED`, `BRAIN_COMMERCIAL_SHADOW_ENABLED`, `BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED`, `BRAIN_AGENT_ACTION_QUEUE_ENABLED`, ... | No, if any of branches 1-4 matched first for this waId; otherwise yes | N/A - it is itself the lowest-priority fallthrough |

Proven by test, not just by reading the source:
- **[ISO4]** (`tests/commercial/salesAgentR3RuntimeIsolationAuthority.test.ts`) asserts the four `if (...Enabled) {` guards appear in this exact order in the source.
- **[PR1]/[PR2]** (`tests/commercial/salesAgentR3PilotRoutingAuthority.test.ts`) run the real function against real MariaDB with CommercialWork/multi-request/ATL/multi-intent/legacy all disabled and R3 enabled+allowlisted, and assert `result.salesAgentRuntime` is the only non-null runtime result field (`commercialWork`/`multiRequest`/`agentLoop`/`loop`/`shadow`/`bridge` are all null).
- **[PR1b]** proves the R3-specific allowlist (`BRAIN_SALES_AGENT_RUNTIME_WA_IDS`) is independently enforced - a waId outside it never reaches SalesAgentRuntime even with the flag on, even when the *other*, unrelated pilot allowlist (`BRAIN_AUTONOMOUS_TEST_WA_IDS`) does include it.

The multi-request and Agent Tool Loop branches (2 and 3) are **global**
flags with no per-waId allowlist of their own - they are not scoped like
CommercialWork/R3. This is pre-existing behavior (not introduced by this
task) and is the one real risk this table surfaces: leaving either flag
`true` in production would preempt R3 for every conversation, not just a
misconfigured allowlist entry. This is not a routing bug (both flags default
`false` and no evidence was found of either being enabled outside test
files) - it is a configuration risk to call out explicitly in the pilot flag
set below.

## Dependency classification

| Module / path | Classification | Notes |
|---|---|---|
| `sales-agent-runtime/**` | `R3_NATIVE` | Implemented specifically for R3; the entire productive dispatch boundary. |
| `agent-loop/runAgentToolLoop.ts` | `KEEP_SHARED` | Explicitly authorized by the task: SalesAgentRuntime legitimately uses it as the reasoning engine. Verified it has zero import into action-queue/execution-gate/autonomy-sandbox/dispatchAgentLoopResponse/CommercialWork/multi-request itself. |
| `agent-loop/dispatchAgentLoopResponse.ts` | `LEGACY_ONLY` | Still the terminal dispatcher for the ATL-only cycle (`runNativeAgentToolLoopCycle.ts`, branch 3) and for the legacy shadow/loop/bridge pipeline's `escalate_to_operator` path. Zero references from R3. Imports the full R1 stack (`action-queue`, `autonomy-sandbox`, `execution-gate`). |
| `agent-loop/runNativeAgentToolLoopCycle.ts` | `LEGACY_ONLY` (relative to R3) | The ATL-only cycle wrapper (branch 3) - a real, still-productive runtime, just not R3's. Not imported by any R3 file. |
| `agent-capability-exposure/**` | `KEEP_SHARED` | Pure capability-exposure resolution, used by ATL, ReadToolGateway and CommercialActionRequest alike. No persistence, no runtime routing, no legacy gate. |
| `read-tool-request/**` | `R3_NATIVE` (as used by R3) / `KEEP_SHARED` (as infrastructure) | ReadToolGateway itself is generic infrastructure ATL uses regardless of which higher-level runtime (ATL-only cycle or SalesAgentRuntime) called it; zero legacy imports. |
| `commercial-action-request/**` | `R3_NATIVE` (as used by R3) / `KEEP_SHARED` (as infrastructure) | Same shape as `read-tool-request/**`. `executeCommercialActionRequest.ts`/`ensureCommercialActionOpportunity.ts` verified clean of action-queue/execution-gate/autonomy-sandbox imports. |
| `capability-gateway/**` | `KEEP_SHARED` | The single execution/governance boundary for every read/action tool, used by ATL (and transitively by both ATL-only and R3 cycles) and by the legacy `runCapabilityExecutionStage.ts`. No import into action-queue/execution-gate/autonomy-sandbox/CommercialWork found anywhere in this directory. |
| `agent-session/**` (`AgentSessionStore`, `shadowRecorder.ts`, `mariaDbAgentSessionStore.ts`) | `KEEP_SHARED` | Domain interface + MariaDB implementation with zero import into any other runtime's modules. Currently only wired from R3 (`salesAgentRuntime.ts`'s shadow recording), but the interface itself is runtime-agnostic infrastructure, not R3-specific business logic. |
| `agent-runtime-event/**` | `KEEP_SHARED` | `AgentRuntimeEvent`/`FOLLOWUP_WAKE` type contract; its only production caller is `runFollowupTick.ts`. Not on the real WhatsApp inbound path for either ATL or R3 (documented already in V1.4 - the file's own docstring corrects an earlier assumption that it would be). |
| `sales-agent-configuration/**` | `KEEP_SHARED` | Resolved once per turn by both the ATL-only branch and the R3 branch (`resolveSalesAgentConfiguration()`), plus CommercialWork. No dependency in the other direction. |
| `native-cycle/customer-session/**` | `KEEP_SHARED` | Identity/session resolution (`resolveNativeCustomerSession`), Step 3 of `runNativeAutonomousCycle.ts`, shared unconditionally by every branch including R3. |
| `context/buildNativeCommercialContext.ts` | `KEEP_SHARED` | The one commercial-context snapshot builder every branch (CommercialWork, multi-request, ATL, R3, legacy) reads from. Read-only, no branch-specific logic. |
| `messaging/canonicalOutboxWriter.ts` | `KEEP_SHARED` | The single writer of `brain_message_outbox`, used by R3's three dispatchers, the legacy execution-gate's outbox bridge, and CommercialWork's own dispatcher alike. No legacy feature gate inside it. |
| `lib/domains/conversations/control.ts` | `KEEP_SHARED` | `takeHumanControlForAiHandoff`/`isConversationClosedStatus` - the same neutral, domain-level ownership primitives an operator's manual "take" action, R1's handoff path, and R3's hard-handoff dispatcher all reuse verbatim. No action-queue/execution-gate/autonomy-sandbox import. |
| `runtime/autonomousRuntimeConfig.ts` | `KEEP_SHARED` | Pure env-flag reader (allowlists, killswitches, access gate). Used by R3, ATL, CommercialWork, the outbox worker and the follow-up worker alike. No persistence, no routing decision of its own. |
| `action-queue/**` | `LEGACY_ONLY` (relative to R3) | Still genuinely used by `dispatchAgentLoopResponse.ts` (ATL-only cycle + legacy escalate path) and `continuity/dispatchFallbackAction.ts` (legacy pipeline's own fallback). Zero R3 callers - proven by [ISO1]/[ISO2] and by V1.6's own authority test. |
| `execution-gate/**` | `LEGACY_ONLY` (relative to R3) | Same shape as `action-queue/**` - same two callers, same zero-R3-callers proof. |
| `autonomy-sandbox/**` (evaluation logic: `evaluateSandboxAutonomy.ts`, `validateAutonomousReplyCandidate.ts`, `buildSandboxAutonomyConfig`) | `LEGACY_ONLY` (relative to R3) | Same two callers as `action-queue`/`execution-gate`. See "Transitive-dependency findings" below for the one narrow exception (a pure helper function physically defined in this directory's `types.ts`). |
| `autonomy-sandbox/types.ts#normalizeWaIdDigits` (+ `maskWaId`, `normalizeDigits`) | `KEEP_SHARED` | Pure regex-based digit stripping, zero imports of its own besides the type import described below. Reused by R3's two dispatch files that need to compare a recipient waId against the pilot allowlist. Classified `KEEP_SHARED` per the task's own neutral-helper carve-out (section 4), not `LEGACY_ONLY`, despite living inside the `autonomy-sandbox/` directory. |
| `work/**` (CommercialWork, R2) | `LEGACY_ONLY` (relative to R3) | A real, still-productive, independently-piloted runtime (branch 1) - not legacy in the sense of being deprecated, but definitively not part of R3's dependency graph. Zero references from any `sales-agent-runtime/**` file. |
| `multi-request/**` | `LEGACY_ONLY` (relative to R3) | Branch 2. Zero references from R3. |
| `multi-intent/**` | `LEGACY_ONLY` (relative to R3) | Sub-branch of ATL's own cycle (3a), never reachable except through branch 3 - which R3 never calls. |
| `sales-consultative/**` (legacy consultative engine) | `DEAD_CANDIDATE` (relative to real traffic) / `LEGACY_ONLY` (relative to the codebase) | `runSalesConsultativeService`'s only production callers are `processSalesInbound` (native-whatsapp/service.ts, itself with **zero** production callers - confirmed by the pre-existing `legacySalesConsultativeRuntimeAuthority.test.ts`) and `processInbound.ts`'s legacy HTTP endpoint, both fail-closed behind `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED` (default `false`). Zero references from R3 - reverified by [ISO1] against the whole `sales-agent-runtime/**` directory, not just the 5 files V1.6 checked. |
| `continuity/dispatchFallbackAction.ts` | `LEGACY_ONLY` (relative to R3) | Imports `action-queue`/`autonomy-sandbox`/`execution-gate` directly. Statically imported at the top of `continuity/ensureAutonomousSalesTurnContinuity.ts` (the file that directly wraps `runNativeAutonomousCycle` for every branch, R3 included) but never called from that file's `cycle.salesAgentRuntime` branch at runtime - see "Transitive-dependency findings" for the precise file-level-vs-runtime-level distinction and the [ISO5] test that guards it. |
| `continuity/buildContinuityFallbackMessage.ts` | `KEEP_SHARED` | Pure message-rendering function (`ContinuityFallbackClass -> string`), no persistence, no I/O, no legacy gate. Reused verbatim by R3's `dispatchSalesAgentFallback.ts`/`dispatchSalesAgentHardHandoff.ts` and by the legacy pipeline's own `dispatchFallbackAction.ts` caller. |
| `events/**` (`commercial_event` service) | `KEEP_SHARED` | Append-only event log written by every runtime (R3's `sales_agent_runtime_terminal_dispatched`/`sales_agent_runtime_response_dispatched`, ATL's `agent_tool_loop_completed`, CommercialWork's own event kinds, continuity's disposition events). No runtime-routing logic lives here. |
| `optOutStore.ts` | `KEEP_SHARED` | Step 0.5 of `runNativeAutonomousCycle.ts`, ahead of branch selection - applies identically to every branch. |

`UNKNOWN` was not needed: every module the task asked to audit had a
verifiable, unambiguous classification from source inspection.

## Transitive-dependency findings

**Primary finding (no defect, a documented narrow exception):**
`dispatchGovernedSalesAgentMessage.ts` and `dispatchSalesAgentHardHandoff.ts`
(both R3-native, both used by every terminal outcome) import
`normalizeWaIdDigits` from `../autonomy-sandbox` (the barrel `index.ts`,
which itself does `export * from "./evaluateSandboxAutonomy"` and
`export * from "./validateAutonomousReplyCandidate"` - the real R1
sandbox-evaluation logic). At the **module-graph level**, this is a real
static import edge from R3 into the `autonomy-sandbox` directory. At the
**call level**, R3 never invokes anything from that directory except the one
pure function - confirmed by grepping both files for every other exported
symbol (`evaluateAgentActionForSandbox`, `buildSandboxAutonomyConfig`,
`SandboxAutonomyAgentActionContext`, `SandboxAutonomyEvaluationResult`):
zero matches.

`autonomy-sandbox/types.ts` (the file `normalizeWaIdDigits` is physically
defined in) itself carries `import type { CrmAgentAction } from
"../action-queue";` at its own top - a **type-only** import, erased
entirely by TypeScript at compile time (zero runtime/bundle footprint), used
elsewhere in that same file to type `evaluateAgentActionForSandbox`'s input
- not by `normalizeWaIdDigits` itself. So the deepest a strict
module-graph traversal from an R3 dispatch file can reach is: R3 file ->
`autonomy-sandbox` barrel -> `autonomy-sandbox/types.ts` -> (type-only,
compile-time-only) `action-queue` type. No runtime code from `action-queue`
is ever loaded or executed via this path.

Per the task's own instruction (section 4): *"A shared pure
renderer/helper does not count as legacy contamination if it performs no
persistence, owns no runtime routing, has no legacy feature gates, executes
no side effect."* `normalizeWaIdDigits` meets all four criteria. It is
retained as-is (not extracted to a new location) - the task explicitly
prioritizes documenting such helpers over refactoring them, and moving a
3-line pure function for the sake of import-path purity would be exactly the
kind of unrequested, out-of-scope surgery `AGENTS.md`/`CLAUDE.md` (and this
task's own section 9) rule out for an audit release. New test **[ISO3]**
locks the exact shape of this exception: it fails if either file ever
imports anything from `autonomy-sandbox` other than `{ normalizeWaIdDigits
}`, or if a third file joins the set.

**Secondary finding (no defect, a file-level vs. runtime-level distinction
worth being precise about):** `continuity/ensureAutonomousSalesTurnContinuity.ts`
- the file that sits directly between `processNativeWhatsAppInbound` and
`runNativeAutonomousCycle` in the real call graph, for every branch
including R3 - has a static top-level import of
`continuity/dispatchFallbackAction.ts`, which imports `action-queue`,
`autonomy-sandbox` (the full evaluation logic, not just the pure helper) and
`execution-gate`. A naive "does file A import file B" graph walk starting at
`processNativeWhatsAppInbound` would therefore report `action-queue`/
`autonomy-sandbox`/`execution-gate` as reachable. They are - but only
through the **legacy fallback branch inside that same shared orchestrator
file** (the code after `const loop = cycle.loop;`, used only when the
turn fell through to the legacy shadow/loop/bridge pipeline), never through
the `if (cycle.salesAgentRuntime)` branch a few lines above it. Verified
precisely by test **[ISO5]**: it slices the file's own source text from the
start of the `cycle.salesAgentRuntime` branch to the start of the legacy
disposition logic that follows it, and asserts `dispatchFallbackAction`
never appears inside that slice - while a sanity assertion in the same test
confirms the identifier is still genuinely called later in the file (so the
absence proven above is structural, not an artifact of the identifier
having been renamed or removed).

No other transitive path from any R3-owned file (`sales-agent-runtime/**`)
into `action-queue/**`, `execution-gate/**`, or the `autonomy-sandbox`
evaluation logic was found. `runAgentToolLoop.ts`, `capability-gateway/**`,
`read-tool-request/**`, `commercial-action-request/**`, `agent-session/**`,
`agent-capability-exposure/**`, `sales-agent-configuration/**`,
`native-cycle/customer-session/**`, `context/buildNativeCommercialContext.ts`,
`messaging/canonicalOutboxWriter.ts`, and `lib/domains/conversations/control.ts`
were each individually checked and carry zero import into any of the three
banned directories or into `dispatchAgentLoopResponse`/CommercialWork/
multi-request/multi-intent/legacy-consultative.

## Flag matrix

| Flag | Owner / module | R3 required? | Legacy required? | Recommended EC2 pilot value | Risk if enabled | Deprecation candidate? |
|---|---|---|---|---|---|---|
| `BRAIN_SALES_AGENT_RUNTIME_ENABLED` | `commercialCycleConfig.ts` | Yes (the R3 pilot switch) | No | `true` | Low - inert without a matching allowlist entry | No |
| `BRAIN_SALES_AGENT_RUNTIME_WA_IDS` | `runtime/autonomousRuntimeConfig.ts` | Yes | No | The exact pilot waId(s) only | Low if kept narrow; widening it is the actual production-exposure control | No |
| `BRAIN_AUTONOMOUS_RESPONSES_ENABLED` | `runtime/autonomousRuntimeConfig.ts` | Yes (the one real R3 send gate, per V1.5/V1.6) | Yes (shared killswitch) | `true` | Medium - the master "may the bot respond at all" switch; must be paired with narrow allowlists | No |
| `BRAIN_WHATSAPP_TEST_MODE_ENABLED` | `runtime/autonomousRuntimeConfig.ts` | Indirect (must pass before any branch) | Indirect | `true` during pilot | Low with `true`; **high if left `false` without an explicit allowlist decision**, since `false` means "public, any wa_id" | No |
| `BRAIN_WHATSAPP_TEST_WA_IDS` | `runtime/autonomousRuntimeConfig.ts` | Indirect | Indirect | The exact pilot waId(s) (superset of, or equal to, `BRAIN_SALES_AGENT_RUNTIME_WA_IDS`) | Low if narrow | No |
| `BRAIN_AUTONOMOUS_TEST_WA_IDS` | `runtime/autonomousRuntimeConfig.ts` | No (R3 has its own allowlist) | Yes (legacy pilot allowlist, outbox worker real-send net, multi-intent) | Same pilot waId(s), or leave unset if nothing else needs it | Low | No |
| `BRAIN_OUTBOX_WORKER_ENABLED` | `messaging/outboxWorker.ts` | Yes (R3's dispatched messages still need the worker to reach Meta) | Yes (shared worker) | `true` | Medium - governs whether anything ever leaves `brain_message_outbox` | No |
| `BRAIN_META_SEND_ENABLED` | `messaging/metaClient.ts` | Yes | Yes | `true` (only once real WhatsApp E2E is authorized) | High - the actual "send to Meta for real" switch | No |
| `BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND` | `runtime/autonomousRuntimeConfig.ts` | Yes | Yes | `true`, only paired with a non-empty `BRAIN_AUTONOMOUS_TEST_WA_IDS` (the worker refuses to start otherwise - `assertOutboxWorkerRuntimeConfigIsSafe`) | High if the allowlist is ever left empty while this is `true` - already fail-closed by construction | No |
| **Legacy flags** | | | | | | |
| `BRAIN_AGENT_ACTION_QUEUE_ENABLED` | `commercialCycleConfig.ts` | **No** (V1.5/V1.6 removed this dependency for every R3 terminal reason) | Yes | `false` | None for R3; would only re-enable R1's own action persistence for ATL/legacy/CommercialWork | Candidate for R3-only deployments once V1.8 disconnects legacy branches |
| `BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED` | `commercialCycleConfig.ts` | No | Yes | `false` | None for R3 | Same as above |
| `BRAIN_EXECUTION_GATE_ENABLED` | `commercialCycleConfig.ts` | No | Yes | `false` | None for R3 | Same as above |
| `BRAIN_OUTBOX_BRIDGE_ENABLED` | `commercialCycleConfig.ts` | No | Yes | `false` | None for R3 | Same as above |
| `BRAIN_AUTONOMOUS_SANDBOX_ENABLED` | `commercialCycleConfig.ts` | No | Yes | `false` | None for R3 | Same as above |
| `BRAIN_AUTONOMOUS_REPLY_ENABLED` | `commercialCycleConfig.ts` | No | Yes | `false` | None for R3 | Same as above |
| `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED` | `commercialCycleConfig.ts` | No | Yes (R2's own switch) | `false` (unless R2 is independently piloted too) | **High if enabled with the R3 pilot's own waId also in `BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS`** - branch 1 preempts branch 4 unconditionally | No - R2 is its own active workstream |
| `BRAIN_MULTI_REQUEST_RUNTIME_ENABLED` | `multi-request/constants.ts` | No | Yes | `false` | **High if left `true`** - global flag, no allowlist, would preempt R3 for every conversation | Yes, once multi-request is formally retired |
| `BRAIN_MULTI_INTENT_PLANNER_ENABLED` | `commercialCycleConfig.ts` | No | Yes (sub-branch of ATL only) | `false` | None for R3 (unreachable unless ATL/branch 3 already won) | No |
| `BRAIN_AGENT_TOOL_LOOP_ENABLED` | `commercialCycleConfig.ts` | No | Yes | `false` | **High if left `true`** - global flag, no allowlist, would preempt R3 for every conversation | No - ATL itself remains the shared reasoning engine R3 depends on; only the ATL-*cycle* branch (3) needs to stay off for the R3 pilot |
| `BRAIN_SALES_AGENT_ENABLED` | `commercialCycleConfig.ts` | No | Yes (legacy shadow gate + `isAutonomyCycleEnabled`) | `false` | None for R3 | Candidate once the legacy pipeline is disconnected |
| `BRAIN_COMMERCIAL_SHADOW_ENABLED` | `commercialCycleConfig.ts` | No | Yes | `false` | None for R3 | Same as above |
| `BRAIN_COMMERCIAL_RUNTIME_ENABLED` | `commercialCycleConfig.ts` | No | Yes | `false` | None for R3 | Same as above |
| `BRAIN_COMMERCIAL_POLICY_ENABLED` | `commercialCycleConfig.ts` | No | Yes | `false` | None for R3 | Same as above |
| `BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED` | `commercialCycleConfig.ts` | No | Yes | `false` | None for R3 | Same as above |
| `BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED` | `commercialCycleConfig.ts` | No | Yes | `false` | None for R3 | Same as above |
| `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED` | `commercialCycleConfig.ts` | No | Yes (its own explicit kill switch, default `false`) | `false` | None for R3 - `processSalesInbound` has zero production callers regardless | Yes - the whole `sales-consultative` module is a `DEAD_CANDIDATE` relative to real traffic |
| `BRAIN_COMMERCIAL_WORK_WORKER_ENABLED` | `runtime/autonomousRuntimeConfig.ts` | No | Yes (R2 worker) | `false` unless R2 is independently piloted | Low for R3 (a separate worker process, never in the inbound request path) | No |
| `BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED` | `runtime/autonomousRuntimeConfig.ts` | No | Yes | `false` unless R2 is independently piloted | Low for R3 | No |

## Legacy reachability report

| Module / path | Classification | Current callers | R3 reachable? | Flag-gated? | Safe to disconnect later? | Notes |
|---|---|---|---|---|---|---|
| `action-queue/**` | `LEGACY_ONLY` | `dispatchAgentLoopResponse.ts`, `continuity/dispatchFallbackAction.ts` | No | Yes (`BRAIN_AGENT_ACTION_QUEUE_ENABLED` et al.) | Only once ATL-only cycle (branch 3) and the legacy pipeline (branch 5) are both retired | Real, still-used tables/repositories for two active-but-non-R3 branches |
| `execution-gate/**` | `LEGACY_ONLY` | Same two callers | No | Yes | Same condition | Same |
| `autonomy-sandbox/**` (evaluation logic) | `LEGACY_ONLY` | Same two callers | No | Yes | Same condition | The pure `normalizeWaIdDigits` helper physically lives here but is `KEEP_SHARED` - see transitive findings |
| `dispatchAgentLoopResponse.ts` | `LEGACY_ONLY` | `runNativeAgentToolLoopCycle.ts` (branch 3), legacy pipeline's `escalate_to_operator` path | No | Indirectly, via the branches that call it | Only once branch 3 and branch 5 are retired | Genuinely still productive today (ATL-only pilot) |
| `work/**` (CommercialWork) | `LEGACY_ONLY` (relative to R3) | `runNativeAutonomousCycle.ts` branch 1 | No | Yes (`BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED` + allowlist) | No - R2 is an independently active workstream, not legacy in the deprecation sense | Do not disconnect; out of this audit's scope |
| `multi-request/**` | `LEGACY_ONLY` (relative to R3) | `runNativeAutonomousCycle.ts` branch 2 | No | Yes (global flag) | Yes, once formally retired - currently unused in production (flag not found enabled outside tests) | Global, unscoped flag is itself a latent risk (see flag matrix) |
| `multi-intent/**` | `LEGACY_ONLY` (relative to R3) | `runNativeAgentToolLoopCycle.ts` (sub-branch of branch 3) | No | Yes | Only once branch 3 is retired | |
| `sales-consultative/**` | `DEAD_CANDIDATE` | `processSalesInbound` (itself zero production callers), `processInbound.ts` legacy endpoint | No | Yes, default `false` | Yes - already effectively disconnected; `processSalesInbound` is guarded, verified-unreferenced dead code kept only because it is still exported | Confirmed unreachable by the pre-existing `legacySalesConsultativeRuntimeAuthority.test.ts`, reverified in this audit |
| `continuity/dispatchFallbackAction.ts` | `LEGACY_ONLY` (relative to R3) | Legacy pipeline's own fallback branch inside `ensureAutonomousSalesTurnContinuity.ts` (branch 5's disposition logic) and its `escalate_to_operator` path | No (proven by [ISO5]) | Yes (its own internal `actionQueueEnabled` check) | Only once branch 5 is retired | Statically imported by the shared orchestrator file, never called from the R3 branch - see transitive findings |
| `agent-runtime-event/**` | `KEEP_SHARED` | `runFollowupTick.ts` only | Type-only import from R3 (`AgentRuntimeEvent` type) | N/A | N/A - genuinely shared contract, not legacy | Not on the real WhatsApp inbound path for ATL or R3 either (pre-existing, documented since V1.4) |

Highlighted per the task's own ask:
- **Legacy code still physically present but unreachable under pilot flags**: `sales-consultative/**` (both entry points fail-closed by default), `action-queue`/`execution-gate`/`autonomy-sandbox` evaluation logic (unreachable from R3 specifically, though still reachable from branches 3/5 if those are enabled).
- **Legacy code reachable through non-R3 routes**: `work/**` (branch 1, an active parallel pilot, not legacy-deprecated), `multi-request/**` (branch 2, currently disabled in practice), `multi-intent/**` (branch 3a).
- **Genuine shared infrastructure**: `runAgentToolLoop.ts`, `capability-gateway/**`, `read-tool-request/**`, `commercial-action-request/**`, `agent-session/**`, `canonicalOutboxWriter.ts`, `lib/domains/conversations/control.ts`, `runtime/autonomousRuntimeConfig.ts`, `sales-agent-configuration/**`, `context/buildNativeCommercialContext.ts`, `native-cycle/customer-session/**`, `events/**`, `optOutStore.ts`.
- **Code with no verified runtime callers**: `processSalesInbound` (native-whatsapp/service.ts) - zero production callers, confirmed by existing authority test, unaffected by this audit.

## Authority tests added

New files (both pass against real MariaDB `crm_test`; the first needs no
database access at all):

**`tests/commercial/salesAgentR3RuntimeIsolationAuthority.test.ts`** (static,
no runtime behavior exercised - same shape as
`salesAgentRuntimeR3NativeDispatchAuthority.test.ts` and
`legacySalesConsultativeRuntimeAuthority.test.ts`):

- **[ISO1]** every file under `lib/brain/commercial/sales-agent-runtime/`
  (not just the 5 files V1.6 checked) has zero *code* reference (comments
  stripped first, both `//` and `/* */`) to `dispatchAgentLoopResponse`,
  `persistAgentAction`, `evaluateAgentActionForSandbox`,
  `executeActionThroughGate`, `buildSandboxAutonomyConfig`,
  `SqlExecutionUnitOfWork`, `runCommercialWorkInboundCycle`,
  `dispatchCommercialWorkResponse`, `runMultiRequestAutonomousCycle`,
  `runCommercialMultiIntentLoop`, `runSalesConsultativeService`,
  `dispatchFallbackAction`, or `runNativeAgentToolLoopCycle`.
- **[ISO2]** the same directory never imports `action-queue` or
  `execution-gate` at all - zero exception.
- **[ISO3]** the *only* `autonomy-sandbox` import anywhere in that directory
  is exactly `{ normalizeWaIdDigits }`, in exactly the two known files - see
  "Transitive-dependency findings" above.
- **[ISO4]** `runNativeAutonomousCycle.ts` checks CommercialWork, then
  multi-request, then the Agent Tool Loop, then SalesAgentRuntime, in that
  literal source order.
- **[ISO5]** `ensureAutonomousSalesTurnContinuity.ts`'s own
  `cycle.salesAgentRuntime` branch never reaches `dispatchFallbackAction`
  (with a sanity check that the identifier is still genuinely called
  elsewhere in the same file, so the assertion is not vacuous).

**`tests/commercial/salesAgentR3PilotRoutingAuthority.test.ts`** (real
MariaDB, a plain "respond" fake-provider script throughout - no catalog HTTP
stub, no network of any kind):

- **[PR1]** (sections 6C/6D) R3 on + allowlisted, CommercialWork/
  multi-request/ATL/multi-intent/legacy all off -> `result.salesAgentRuntime`
  is the only populated runtime-result field; the turn dispatches through
  the canonical outbox.
- **[PR1b]** a waId outside `BRAIN_SALES_AGENT_RUNTIME_WA_IDS` never reaches
  SalesAgentRuntime even with the flag on and even when a *different*,
  unrelated allowlist (`BRAIN_AUTONOMOUS_TEST_WA_IDS`) does include it -
  proves the R3-specific allowlist is independently enforced, not merely
  inherited from the generic pilot gate.
- **[PR2]** (section 7, the productive pilot routing proof) the full
  recommended EC2 pilot flag set - R3 on, every legacy runtime off, and the
  *entire* R1 dispatch/action-lifecycle stack off - still routes to
  SalesAgentRuntime, the R3 cycle runs, dispatches through the canonical
  outbox, and creates **zero** `crm_agent_actions` rows.

Section 6E ("legacy branches remain independently testable and unchanged")
is satisfied by omission: no existing test file was modified by this task
(`git status` before/after this audit shows only the two new files above as
additions), and the full targeted regression pass below re-ran every
pre-existing legacy-relevant suite unchanged and green.

## Discovered defects

None. No routing bug was found that prevents the intended R3 branch from
being authoritative under its own pilot flags. The one real, non-hypothetical
finding (the `autonomy-sandbox` import edge for `normalizeWaIdDigits`) is a
**documented, tested, narrow exception**, not a defect - see "Transitive-
dependency findings." No production code was modified in this task.

## Remaining technical debt (carried forward, not touched by V1.7)

- **Handoff reason contract** (task section 10, unchanged): `AgentStepHandoff.reason`/`AgentLoopResult.handoffReason` is still free text. R3 V1.6 safely transfers ownership only for the exact reason codes `customer_requested_human`/`policy_requires_human`; ordinary ambiguous handoff text falls back without ownership transfer. `SUPERVISOR_CONSULT` remains future work. Not touched here.
- **Model/runtime budget** (task section 11, documented, not enforced as a prerequisite of this audit): intended post-deploy budget is `thinking=disabled`, `maxOutputTokens=4096`, `maxAgentStepsPerTurn=8`, `maxToolCallsPerTurn=8`, `timeoutMs=30000`, `maxModelRetries=1`. The currently published configuration may still differ; that update happens after V1.7, as a deployment/config step, not a code change.
- **Global, unscoped runtime flags** (new observation from this audit's routing table): `BRAIN_MULTI_REQUEST_RUNTIME_ENABLED` and `BRAIN_AGENT_TOOL_LOOP_ENABLED` have no per-waId allowlist of their own (unlike CommercialWork's and R3's own allowlisted flags) - leaving either `true` in production would preempt R3 for every conversation, not just a misconfigured pilot waId. No evidence either is enabled outside test files today; flagged here as an operational risk to watch during the EC2 rollout, not a code defect to fix in this release.
- **`agentSessionStoreMariaDb.test.ts` same-millisecond ordering test**: `loadRecentEvents ORDER BY occurred_at, seq returns true insertion order for same-millisecond events` fails intermittently against the real MariaDB clock. Confirmed pre-existing and unrelated to this task: reproduces in complete isolation with a clean `git status` (no local changes to `agent-session/**`). Not investigated further - out of this audit's scope (agent-session's own ordering guarantee, not a dependency-isolation question).
- **`sales-agent-runtime/**` retains the one `autonomy-sandbox` import edge** documented above. A future cleanup (extracting `normalizeWaIdDigits` to a dependency-free shared module) would make the isolation invariant hold with zero exceptions instead of one documented+tested one - explicitly not done in V1.7 per its own scope discipline (tiny corrections only for actual routing bugs, not import-path aesthetics), and not required for the VALIDATED verdict since the exception is narrow, pure, and now guarded by [ISO3].

## Recommended EC2 pilot flag set

R3 on:
```
BRAIN_SALES_AGENT_RUNTIME_ENABLED=true
BRAIN_SALES_AGENT_RUNTIME_WA_IDS=<the exact pilot wa_id(s)>
BRAIN_AUTONOMOUS_RESPONSES_ENABLED=true
BRAIN_WHATSAPP_TEST_MODE_ENABLED=true
BRAIN_WHATSAPP_TEST_WA_IDS=<the exact pilot wa_id(s)>
BRAIN_OUTBOX_WORKER_ENABLED=true
BRAIN_META_SEND_ENABLED=true
BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND=true
BRAIN_AUTONOMOUS_TEST_WA_IDS=<the exact pilot wa_id(s)>
```

Legacy runtime off:
```
BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED=false
BRAIN_MULTI_REQUEST_RUNTIME_ENABLED=false
BRAIN_AGENT_TOOL_LOOP_ENABLED=false
BRAIN_MULTI_INTENT_PLANNER_ENABLED=false
BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED=false
BRAIN_SALES_AGENT_ENABLED=false
BRAIN_COMMERCIAL_SHADOW_ENABLED=false
BRAIN_COMMERCIAL_RUNTIME_ENABLED=false
BRAIN_COMMERCIAL_POLICY_ENABLED=false
BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED=false
BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED=false
BRAIN_COMMERCIAL_WORK_WORKER_ENABLED=false
BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED=false
```

R1 dispatch stack off:
```
BRAIN_AGENT_ACTION_QUEUE_ENABLED=false
BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED=false
BRAIN_EXECUTION_GATE_ENABLED=false
BRAIN_OUTBOX_BRIDGE_ENABLED=false
BRAIN_AUTONOMOUS_SANDBOX_ENABLED=false
BRAIN_AUTONOMOUS_REPLY_ENABLED=false
```

This exact combination is what `[PR2]` exercises against real MariaDB.
Deployment/`.env` changes to actually apply this set happen after V1.7, as
this task's own instructions require (section 5: "this release audits
intended values; deployment configuration happens after V1.7").

## Modules that must remain untouched until after WhatsApp E2E

Per the task's explicit "do not delete yet" list, none of the following were
modified, and none should be until real WhatsApp E2E validation informs a
V1.8 disconnection task: `work/**` (CommercialWork), `multi-intent/**`,
`multi-request/**`, `action-queue/**`, `execution-gate/**`,
`autonomy-sandbox/**`, `sales-consultative/**`, every flag listed as
"legacy" above, any database table or migration, and every worker
(`worker:outbox`, `worker:followup`, `worker:commercial-work`).

## Validation

Focused tests (new files, run first, in isolation):
- `tests/commercial/salesAgentR3RuntimeIsolationAuthority.test.ts`: 5/5 pass (no DB required).
- `tests/commercial/salesAgentR3PilotRoutingAuthority.test.ts`: 3/3 pass (real MariaDB `crm_test`).

Targeted regression (real MariaDB, unmodified files, run after the new
tests):
- Native WhatsApp / native cycle: `native-whatsapp.test.ts`, `runNativeAutonomousCyclePilotIsolation.test.ts`, `runNativeAutonomousCycleOptOut.test.ts`, `runNativeAutonomousCycleCustomer360.test.ts` - all pass.
- SalesAgentRuntime / R3 dispatch: `salesAgentRuntime.test.ts`, `runSalesAgentRuntimeCycle.test.ts`, `dispatchSalesAgentResponse.test.ts`, `dispatchSalesAgentTerminalOutcome.test.ts`, `salesAgentRuntimeR3NativeDispatchAuthority.test.ts` - all pass.
- AgentSessionStore: `agentSessionStore.test.ts`, `agentSessionSanitizer.test.ts`, `agentSessionSummary.test.ts`, `agentToolLoopSessionShadow.test.ts` pass; `agentSessionStoreMariaDb.test.ts` - 1 pre-existing, unrelated same-millisecond ordering flake (see "Remaining technical debt"), reproduced in isolation against a clean tree.
- ReadToolGateway / CommercialActionRequest / Capability Gateway: `readToolRequest.test.ts`, `commercialActionRequest.test.ts`, `capabilityGateway.test.ts`, `capabilityGatewayHardening.test.ts`, `capabilityGatewayIdentityGate.test.ts` - all pass.
- Canonical outbox / outbox ownership: `canonicalOutboxWriter.test.ts`, `outbox-ownership.test.ts`, `outbox-pilot-isolation.test.ts` - all pass.
- CommercialWork: `commercialWorkInboundCycle.test.ts` - passes.
- ATL: `runAgentToolLoop.test.ts` - all pass (16 scenarios).
- Legacy routing authority: `legacySalesConsultativeAuthority.test.ts`, `legacySalesConsultativeConfig.test.ts`, `legacySalesConsultativeRuntimeAuthority.test.ts` - all pass.

Combined totals across all runs above: 297 targeted-regression tests, 296
pass / 1 pre-existing unrelated flake; 8 new tests in this task's own two
files, 8/8 pass.

`npx tsc --noEmit`: clean, zero errors.

`npm run build`: clean, production build succeeds.

`npm run lint`: 0 errors, 39 pre-existing warnings (identical count to the
one V1.5/V1.6 already documented), none in any file this task touched
(this task touched only two new test files, outside lint's scanned paths).

No external Meta calls were made. No EC2 changes were made. No webhook
changes were made. No migrations were required or made.

## Verdict

**`R3_V1_7_RUNTIME_ISOLATION_VALIDATED`**

- Productive R3 branch explicitly reconstructed from real source, not inferred from file names.
- No R1 dispatch/action-lifecycle dependency reachable from `SalesAgentRuntime`/`runSalesAgentRuntimeCycle.ts`/the R3 terminal dispatch boundary, with one narrow, documented, tested neutral-helper exception.
- No legacy branch can preempt R3 under the recommended pilot flags - proven by source-order test and by a real-MariaDB runtime test.
- Authority tests exist (5 static + 3 runtime, all green).
- Legacy modules classified (`R3_NATIVE`/`KEEP_SHARED`/`LEGACY_ONLY`/`DEAD_CANDIDATE`; `UNKNOWN` not needed).
- Pilot flag state documented (full recommended EC2 set above).
- Targeted regressions green (296/297, the one failure pre-existing and unrelated).
- Typecheck/build/lint green.

## Files changed

New:
- `tests/commercial/salesAgentR3RuntimeIsolationAuthority.test.ts`
- `tests/commercial/salesAgentR3PilotRoutingAuthority.test.ts`
- `docs/releases/SALES-AGENT-R3-V1.7-runtime-dependency-legacy-isolation-audit.md` (this file)

Modified:
- `docs/ACTIVE_RELEASE.md` (this task's entry under the `SALES-AGENT-R3` workstream)

No production/runtime code was created, modified, or deleted in this task.

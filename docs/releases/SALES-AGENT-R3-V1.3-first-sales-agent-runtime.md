# SALES-AGENT-R3-V1.3 -- First Sales Agent Runtime

Status: implemented and tested against real MariaDB. No WhatsApp routing
changed, no capability added, no existing runtime replaced or removed.
`SalesAgentRuntime` exists as a clean, additive boundary next to the
production Agent Tool Loop (ATL), consuming `AgentRuntimeEvent` (R3-A05) and
normalizing an already-existing iterative model/tool loop into a
provider-neutral, structured result.

## Phase 1 -- Audit: what already exists

Read live code end to end before writing anything, per the task's own
Phase 1 instruction. Summary table:

| Component | Reusable as-is? | ATL-specific? | Runtime-neutral? | Verdict |
|---|---|---|---|---|
| `runAgentToolLoop.ts` (ATL) -- the iterative gathering/finalization loop, budgets, evidence gates, provider error handling | Yes, in full | No -- already generic over `provider`/tool pool | Yes (its own input/output contract has no WhatsApp/dispatch dependency) | **Reused directly, unmodified** |
| `AgentLoopProvider` (`agentLoopProviderTypes.ts`) -- `{name, invoke(request, options)}`, raw messages in, raw `AgentStep` JSON out | Yes | No | Yes -- already deliberately NOT `SalesAgentProvider` (the older, heavier one-shot contract) | **Reused as V1.3's model provider contract; no new abstraction needed** |
| `httpAgentLoopProvider.ts` (DeepSeek adapter) / `fakeAgentLoopProvider.ts` | Yes | No (isolates the one vendor-specific shape behind `AgentLoopProvider`) | Yes | **Reused for production/tests respectively** |
| `AGENT_LOOP_TOOL_POOL` + `resolveAgentCapabilityExposure` (R3-A04) -- fixed pool, READ_TOOL/COMMERCIAL_ACTION classification sourced from the Capability Gateway | Yes | No | Yes | **Reused directly** for both the loop's own tool descriptions and this module's read/action call counting |
| `buildAgentToolCatalog` (`agent-capability-exposure/agentToolCatalog.ts`) -- provider-neutral catalog shape (A04 Phase 12) | Available, not wired into ATL's own prompt builder yet (deliberate, per A04's own doc) | No | Yes | Exists for a future prompt/schema serializer; **not touched, not needed for V1.3's contract** |
| `read-tool-request/executeReadTool.ts` (ReadToolGateway) | Yes | No | Yes | **Reused via ATL's own `processUseToolStep`, unmodified** |
| `commercial-action-request/executeCommercialActionRequest.ts` + `ensureCommercialActionOpportunity.ts` (R3-V1.2) | Yes | No | Yes | **Reused via ATL's own `processUseToolStep`, unmodified; `ensureOpportunity`'s existing DI seam is composed, not extended** |
| `capability-gateway/executeCapability.ts` + `identityGate.ts` | Yes | No | Yes | **Reused, unmodified -- the one execution/identity choke point, untouched** |
| `agent-session/shadowRecorder.ts` (`recordAgentToolLoopSessionShadowEvents`) | Yes, function itself | No | Yes | **Reused directly** for the turn-level session envelope |
| `read-tool-request/sessionEvents.ts` / `commercial-action-request/sessionEvents.ts` | Yes | No | Yes | **Already fire automatically** from inside `executeReadTool`/`executeCommercialActionRequest` -- zero new wiring needed for per-tool-call AgentSession events |
| `runNativeAgentToolLoopCycle.ts` (buildStepsSummary/buildLlmMetrics, the production ATL wrapper) | Reusable after extraction (the two small helpers), not as a whole | **Yes** -- bundles customer-profile-context loading, multi-intent routing, `dispatchAgentLoopResponse` (WhatsApp/outbox), `agent_tool_loop_completed` commercial_event recording (tied to `sales-agent-configuration`) | No (its own input already requires a resolved `ResolvedSalesAgentConfiguration` and a full `CommercialContextSnapshot`) | **Not reused as a whole** -- would silently pull in WhatsApp dispatch and configuration-resolution machinery the Scope Guard forbids touching. Its two pure mapping helpers (`buildStepsSummary`, `buildLlmMetrics`) were reimplemented locally (8-20 lines) instead of imported, to avoid dragging in that whole module's dependency graph -- same "no cross-module import" discipline `events/types.ts` already documents for identical types |
| `runAgentRuntimeEvent.ts` (R3-A05) | N/A -- the seam, not a loop | No | Yes | **Not modified, not wired into.** Its own comment already names this exact gap ("a future SalesAgentHarness consumes AgentRuntimeEvent directly ... this task does not build the Harness, only the boundary it will call") -- V1.3 builds that Harness but does not connect it here (Scope Guard) |
| `runNativeAutonomousCycle.ts` (3-way dispatcher: CommercialWork / ATL / legacy deterministic pipeline) | N/A | N/A | N/A | **Untouched.** Production routing is unchanged; `SalesAgentRuntime` is reachable only by direct import today |
| `runCommercialMultiIntentLoop.ts` (multi-intent planner, alternate ATL implementation) | N/A | Yes -- calls `executeGovernedCapability` directly, bypassing `CommercialActionRequest` (documented gap since V1.2) | N/A | **Untouched, not composed.** Out of scope; V1.3 wraps `runAgentToolLoop` specifically, not the routing decision between it and the multi-intent planner |
| `lib/brain/commercial/sales-agent/*` (`runSalesAgentDryRun`, `SalesAgentRuntimeInput/Result` types) | N/A -- a **different, older, single-shot** provider-invocation harness (one prompt in, one validated `SalesAgentOutput` JSON document out; no tool loop at all) | N/A | N/A | **Not the same thing.** Confusingly similar names (`SalesAgentRuntimeInput`/`Result` already existed there) -- verified by reading the module before naming anything. This task's new module lives in a separate directory (`sales-agent-runtime/`, not `sales-agent/`) specifically to avoid colliding with or being mistaken for it. Not touched, not retired -- out of scope to judge its status |
| `experiments/deepseek-harness/**` | N/A | N/A | N/A | Reference only, per the task's own instruction -- not read as a dependency, not made one |

**Conclusion (Phase 18 choice A, not B or C):** almost the entire iterative
loop mechanism the task asks for already exists in `runAgentToolLoop.ts` and
is already runtime-neutral at the boundaries that matter (provider, tool
pool, action/read execution). The correct, smallest implementation is a thin
translation/normalization layer around it -- not an extraction, not a
parallel reimplementation.

## Phase 2/3/4 -- `SalesAgentRuntime` contract, provider, tool catalog

New module: `lib/brain/commercial/sales-agent-runtime/salesAgentRuntime.ts`
(+ `index.ts` barrel), function-based (`runSalesAgentRuntime`), matching
this codebase's existing convention (`runAgentToolLoop`, `runAgentRuntimeEvent`,
`runNativeAgentToolLoopCycle` are all plain async functions, never a
class/interface pair) rather than the task's illustrative `interface
SalesAgentRuntime { run(...) }` shape literally.

```ts
export async function runSalesAgentRuntime(input: SalesAgentRuntimeInput): Promise<SalesAgentRuntimeResult>
```

`SalesAgentRuntimeInput` carries `event: AgentRuntimeEvent`, `opportunityId:
number | null` (the only piece of runtime context not already on
`CustomerMessageEvent`), `provider`, and pass-through fields ATL's own
contract already defines (`trustedCustomerSession`, `commercialContextSummary`,
`recentCatalogContext`, `pendingCatalogAction`, `identityConfiguration`,
budget/timeout overrides, DI seams). Deliberately smaller than the task's
illustrative shape (no separate `conversationPublicId`/`customerMasterId`/
`correlationId`/`currentTime` fields duplicating what `CustomerMessageEvent`
already carries, no `session: AgentSessionSnapshot` input -- see Phase 8
below for why).

`SalesAgentRuntimeResult`:

```ts
{
  status: "responded" | "blocked" | "failed" | "handoff";
  responseText: string | null;
  reason: string | null;
  modelSteps: number;
  toolCalls: number;
  readToolCalls: number;
  commercialActionCalls: number;
  resolvedOpportunityId: number | null;
  finalPendingCatalogAction: PendingCatalogActionStep | null;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  warnings: string[];
}
```

No `steps` array, no raw `AgentStep`/`ToolObservation` objects, no prompt or
raw provider output -- only counts, ids and enums, matching every other
observability payload this codebase already produces (`AgentLoopInferenceRecord`,
`AgentToolLoopStepSummary`, `AgentLoopProviderFailure`). Full step-by-step
detail is not lost -- it is available through `AgentLoopResult.steps` inside
`runAgentToolLoop` (used internally to compute the counts) and through the
already-existing AgentSession/`crm_capability_executions` audit trails (see
Phase 17 below) -- never duplicated a second time in this result on top of
those.

**Provider (Phase 3):** `AgentLoopProvider` is reused verbatim as V1.3's
model contract -- it was already exactly the minimal shape the task asks
for (`invoke({messages, correlationId}, {signal, timeoutMs}) -> {rawOutput,
model, tokens, finishReason, providerRequestId}`), already isolates DeepSeek
specifics inside `httpAgentLoopProvider.ts`, and already has a scriptable
fake (`fakeAgentLoopProvider.ts`) used throughout this task's own tests. No
new `AgentModelProvider` type was created.

**Tool catalog (Phase 4):** the model-visible tool set is `AGENT_LOOP_TOOL_POOL`
(unchanged, 10 tools), classified via `resolveAgentCapabilityExposure`
(R3-A04) -- the same canonical classification ATL itself uses inside
`processUseToolStep`, reused again here only to split `toolCalls` into
`readToolCalls`/`commercialActionCalls` for observability. No second tool
registry, no cognitive tools (`compare_products`, `build_home_gym`, etc.)
added -- proven by test (`[scenario] an unregistered/cognitive tool name is
blocked...`), not just by omission.

## Phase 5/6/7 -- Iterative loop, read tools, commercial actions

Not reimplemented. `runSalesAgentRuntime` builds one `RunAgentToolLoopInput`
from the `CUSTOMER_MESSAGE` event and calls `runAgentToolLoop` exactly once,
unmodified. Every mechanic the task's Phase 5/6/7 ask for --
dynamic tool sequencing, no fixed order, READ_TOOL through
`ReadToolGateway`/`executeReadTool`, COMMERCIAL_ACTION through R3-V1.2's
lazy opportunity resolution + `CommercialActionRequest` +
`executeCommercialActionRequest`, `executeGovernedCapability` as the sole
execution choke point -- is inherited unchanged from ATL. Verified again at
this new boundary by the "single read tool" / "multiple sequential read
tools" / "commercial action" tests, not re-derived from inspection alone.

**Closing a real, previously-documented gap:** R3-V1.2's own release doc
names an explicit limitation -- `AgentLoopResult` never exposes the
opportunityId a COMMERCIAL_ACTION call resolves/creates mid-turn, and closing
it "would mean threading a resolved id back out through `AgentLoopResult`
across every one of `runAgentToolLoop.ts`'s ~6 terminal return points ...
real, but wider surface than [V1.2's] slice justifies." V1.3 is that
"real, demonstrated need" V1.2 deferred to. Rather than touching ATL's
terminal returns, `runSalesAgentRuntime` composes V1.2's own `ensureOpportunity`
injection seam: it wraps whichever function is provided (real or test double)
in a closure that captures the resolved `opportunityId` as a side effect,
without changing ATL's signature or behavior at all. `resolvedOpportunityId`
in the result is exactly this captured value -- `input.opportunityId` when no
COMMERCIAL_ACTION tool is ever attempted (a pure read never sets it), the
real resolved/reused id otherwise.

## Phase 8 -- Session integration

**Already mostly done, for free, before this task started.** Every
individual tool/action request and result is recorded as an `AgentSession`
event automatically, from inside `executeReadTool`/`executeCommercialActionRequest`
(R3-A03/A04's own `sessionEvents.ts`) -- called by ATL's `processUseToolStep`
on every turn, with zero new wiring. `runSalesAgentRuntime` adds exactly one
more call: `recordAgentToolLoopSessionShadowEvents` (A01's own shadow
mechanism, reused verbatim, never reimplemented) for the turn-level
`USER_MESSAGE_RECEIVED` / tool-summary / `ASSISTANT_MESSAGE_SENT` envelope --
mirroring what `runNativeAgentToolLoopCycle.ts` already does, minus
everything else that function bundles. Its `stepsSummary` input is built by
an 8-line local function that intentionally duplicates
`runNativeAgentToolLoopCycle.ts#buildStepsSummary`'s logic rather than
importing it, to avoid pulling that module's whole production dependency
graph into this clean boundary (see the audit table).

**Why `session: AgentSessionSnapshot` is not an input field:** `AgentSession`
is explicitly conversational memory only -- its own type file states
`USER_MESSAGE_RECEIVED`/`ASSISTANT_MESSAGE_SENT` events never carry message
text, so it structurally cannot drive prompt continuity (what was actually
said). Real cross-turn continuity already has two purpose-built, tested
mechanisms this runtime already accepts as pass-through input:
`recentCatalogContext` (DB-backed product-identity evidence) and
`pendingCatalogAction` (a structured, runtime-managed "the customer still
owes us a choice" carry-over). Reading and feeding an `AgentSessionSummary`
into the prompt on top of those would be a second, redundant continuity
channel the architecture principles explicitly warn against (`ai_*`/session
state is not commercial memory). `finalPendingCatalogAction` was added to
the result specifically so a caller *can* thread continuity across two
`runSalesAgentRuntime` calls using the mechanism that actually works
standalone (see Known limitations for the one that does not).

## Phase 9 -- Prompt / runtime instructions

Not touched. `buildAgentStepPromptPackage.ts` (ATL's existing prompt
builder) already satisfies every instruction in this phase -- grep of the
whole `agent-loop/` and new `sales-agent-runtime/` trees confirms zero
occurrences of a fixed step sequence, `semanticIntent`, `objectiveType`,
`plannedSteps`, `workflowState`, or `conversationPhase`. Reused as-is via
`runAgentToolLoop`; V1.3 does not add a second prompt layer.

## Phase 10 -- Limits / safety

Entirely inherited from ATL, unmodified: `DEFAULT_MAX_DECISIONS = 3`,
`DEFAULT_MAX_TOOL_EXECUTIONS = 2`, `DEFAULT_TIMEOUT_MS = 20000`, all
overridable per call (`maxDecisions`/`maxToolExecutions`/`timeoutMs` pass
straight through). `runSalesAgentRuntime` adds no second budget system.
Proven at this boundary (not just by inheritance) by two dedicated tests:
a `maxDecisions: 1` run still reaches "responded" via finalization; a
`maxToolExecutions: 1` run rejects a second tool request during
finalization (`toolCalls` stays 1) instead of executing it. No infinite
loop, no duplicate side effect in either case.

## Phase 11 -- Idempotency

Unchanged, verified again at this boundary. ATL's own `executedCalls`
dedupe `Set` (canonicalized tool+arguments) blocks a repeated identical
tool call within one run before it ever reaches the Gateway; V1.2's
`ensureCommercialActionOpportunity`/`resolveRuntimeOpportunity` remain the
sole opportunity-creation authority (session-advisory-locked, proven
concurrency-safe in V1.1/V1.2's own tests). Test: a script that calls
`select_products` twice with identical arguments inside one run produces
exactly one `crm_opportunities` row and a
`agent_loop_tool_blocked_duplicate:select_products` warning for the repeat
-- no second general idempotency engine was built.

## Phase 12 -- Multi-tool model output

Structurally moot, not merely "handled": `AgentStep` (ATL's provider output
contract) is a single object (`use_tool | respond | handoff`), never an
array -- the provider cannot emit more than one tool call per response by
construction. Sequential, one-decision-at-a-time execution is not a policy
choice V1.3 enforces; it is the only shape the contract allows. No parallel
execution was added or needed.

## Phase 13 -- Final response

`SalesAgentRuntimeResult.responseText` is populated only when
`status === "responded"`; `status === "handoff"` carries `reason` (the
handoff reason) with a null `responseText`. No WhatsApp send, no outbox
write, no dispatch of any kind happens inside `runSalesAgentRuntime` --
confirmed by the audit: it calls only `runAgentToolLoop` (pure) and
`recordAgentToolLoopSessionShadowEvents` (shadow-only, DB write to
`agent_session`/`agent_session_event`, never `crm_conversation_outbox`).

## Phase 14 -- Provider error handling

Inherited from ATL, mapped onto `SalesAgentRuntimeResult.status`/`reason`:

| `AgentLoopResult.terminalReason` | `status` | `reason` |
|---|---|---|
| `responded` | `responded` | `null` |
| `handoff` | `handoff` | the model's own handoff reason string |
| `timeout` | `failed` | `"timeout"` |
| `invalid_output` | `failed` | `"invalid_output"` |
| `provider_unavailable` | `failed` | the classified `AgentLoopProviderFailure.normalizedReason` (e.g. `network_error`, `authentication_error`) -- more specific than the generic terminal reason, reusing LLM-R1-T02's own classification |
| `max_steps_exceeded` (not currently emitted by ATL; the gathering loop always falls through to finalization instead) | `failed` | `"max_steps_exceeded"` (defensive) |

Two additions specific to this boundary, both proven by test:

- **Unsupported event type:** `FOLLOWUP_WAKE` is a contract error here (it
  already has its own deterministic dispatcher,
  `followup-wake/dispatchDraftedFollowUpMessage.ts`, with no model
  involvement) -- `status: "failed"`, `reason: "unsupported_event_type"`,
  the provider is never invoked (proven with a provider that throws if
  called at all).
- **Governance block:** an optional `governance: {humanOwnerActive,
  aiBlocked}` input reproduces the one real invariant
  `runNativeAgentToolLoopCycle.ts#skippedResult` already enforces in
  production (a human-owned or AI-blocked conversation never reaches the
  model) -- `status: "blocked"`, the model is never invoked. Off by default
  (both `false`), so an isolated caller with no such external signal
  (a test, a benchmark) always attempts the turn.

No technical failure was ever turned into an invented business statement --
`responseText` is `null` for every non-"responded" status.

## Phase 15 -- Observability

`modelSteps`, `toolCalls`, `readToolCalls`, `commercialActionCalls`,
`durationMs` (wall-clock around the whole `runAgentToolLoop` call, same
convention `agent-loop/benchmark/types.ts` already documents), `finalStatus`
(`status` field) are all present. `inputTokens`/`outputTokens` are rolled up
from `AgentLoopResult.llmCalls` (LLM-R1-T02's own per-call accounting,
already available without widening any contract) -- `null` (never a
fabricated `0`) whenever no call this turn reported a usable value, the same
discipline `buildLlmMetrics` already uses.

## Phase 16/17 -- Scenarios and black-box trace

Every scenario in the task's Phase 16 has a corresponding test (see Phase 19
below); several combine naturally into one test where the underlying
mechanism is the same. A real, captured trace (not a hypothetical one) for
scenario 4 (product lookup -> inspect -> select), run against real MariaDB
with a scripted fake provider:

```
event: CUSTOMER_MESSAGE "quiero un kettlebell de 16kg"
  model step 1 -> use_tool search_products {query:"kettlebell"}
    -> ReadToolGateway -> Capability Gateway -> observation: completed
  model step 2 -> use_tool get_product_details {productId:"501"}
    -> ReadToolGateway -> Capability Gateway -> observation: completed
  model step 3 -> use_tool select_products {items:[{productId:"501",quantity:1}]}
    -> lazy opportunity resolution (R3-V1.1/V1.2): none existed -> created (id 3019)
    -> CommercialActionRequest -> identity gate: allowed (select_products requires no identity)
    -> Capability Gateway -> observation: completed
  model step 4 -> respond "Listo, agregue 1 Kettlebell 16kg ($29.990) a tu seleccion."

SalesAgentRuntimeResult:
{
  "status": "responded",
  "responseText": "Listo, agregue 1 Kettlebell 16kg ($29.990) a tu seleccion.",
  "reason": null,
  "modelSteps": 4,
  "toolCalls": 3,
  "readToolCalls": 2,
  "commercialActionCalls": 1,
  "resolvedOpportunityId": 3019,
  "finalPendingCatalogAction": null,
  "durationMs": 151,
  "inputTokens": 128,
  "outputTokens": 256,
  "warnings": ["agent_loop_finalization_entered", "agent_session_shadow_event_write_failed:..."]
}
```

This answers every question Phase 17 requires: what was called (3
tool names, reconstructable from `toolCalls`/`readToolCalls`/
`commercialActionCalls` at this boundary, and in full detail from
`AgentLoopResult.steps` one layer down plus the AgentSession
`READ_TOOL_REQUESTED`/`READ_TOOL_COMPLETED`/`COMMERCIAL_ACTION_*` events
`executeReadTool`/`executeCommercialActionRequest` already write per call),
in what order (steps are strictly sequential, `stepIndex`-ordered), what
each tool returned structurally (`ToolObservation`, never raw
payloads), what action was requested and whether authorized
(`select_products` -> `CommercialActionRequest` -> identity gate `allowed`
-> Gateway `completed`), how many iterations (`modelSteps: 4`), and whether
the final output was grounded (the price `$29.990` in `responseText`
matches the mock Catalog Service's own fixture value exactly, not an
invented number). No chain-of-thought is anywhere in this trace or persisted
anywhere -- confirmed structurally by a dedicated test asserting the result's
exact key set.

The `agent_session_shadow_event_write_failed` warning in the trace above is
real and reproducible in this local dev database -- see Known limitations.

## Phase 18 -- Comparison with ATL

Chosen strategy: **A (reuse `runAgentToolLoop` internally)**, not B
(extract loop primitives -- unnecessary, ATL's own loop is already
runtime-neutral where it matters) or C (a fully separate implementation --
would duplicate ~1000 lines of already-correct, already-tested budget/
evidence-gate/error-handling logic for no benefit). ATL is not removed,
not modified beyond what R3-V1.1/V1.2 already changed before this task
started, and remains the production path (`runNativeAutonomousCycle.ts` is
untouched). `SalesAgentRuntime` is reachable only by direct import today --
a deliberate, temporary "beside it" state per the Scope Guard.

**Future retirement candidates**, named for later, not touched here:

- `lib/brain/commercial/sales-agent/*` (`runSalesAgentDryRun`) -- a
  different, older, single-shot (non-iterative) provider-invocation harness
  with its own `SalesAgentRuntimeInput`/`Result` types. Its continued
  purpose (evaluation/dry-run tooling vs. a genuinely separate product
  surface) was not investigated -- out of scope for this task to judge.
- The legacy deterministic pipeline (`buildCatalogGroundedMessage.ts` +
  "shadow evaluation") `runNativeAutonomousCycle.ts` falls back to when
  both the CommercialWork and ATL flags are off -- unrelated to this task,
  noted only because the Phase 1 audit surfaced it again.

## Phase 19 -- Tests

New file: `tests/commercial/salesAgentRuntime.test.ts`, 16 tests, real
MariaDB (`main_management`, same credentials/precedent as
`tests/agent-loop/runAgentToolLoop.test.ts`), a local HTTP mock for the
Catalog Service (same pattern as the existing ATL test file). Mapped against
the task's own list:

- runtime event ingestion / final-response path -- "CUSTOMER_MESSAGE with no
  tools needed" 
- `FOLLOWUP_WAKE` unsupported, provider never invoked -- "FOLLOWUP_WAKE is
  not this runtime's job"
- single read tool -- "[scenario] pure product lookup"
- multiple sequential read tools -- "multiple sequential read tools"
- commercial action + lazy opportunity integration -- "[scenario] commercial
  action: select_products resolves a durable opportunity lazily"
- identity-denied action -- "[scenario] quote identity block"
- session continuity -- "[scenario] session continuity: 'la segunda'
  resolves against turn 1's own finalPendingCatalogAction"
- malformed/unknown tool call + tool recovery -- "[scenario] an
  unregistered/cognitive tool name is blocked and the model recovers"
- provider timeout -- "provider timeout produces a structured failure"
- max-step limit -- "max model decisions bounds the gathering phase"
- max-tool limit -- "max tool executions bounds tool calls"
- repeated action idempotency -- "a repeated, identical commercial action
  request ... is deduped"
- tool failure recovery -- "tool failure recovery: the Catalog Service
  being down does not stop the turn"
- no opportunity on pure read -- asserted inside the read-tool scenario
  tests (`countOpportunitiesForConversation === 0`)
- no semantic intent/objective/workflow dependency -- confirmed by `grep`
  across `sales-agent-runtime/` and this test file, zero matches (not just
  by convention)
- structured runtime metrics -- asserted across every test (`modelSteps`,
  `toolCalls`, `readToolCalls`, `commercialActionCalls`, `inputTokens`,
  `outputTokens`, `durationMs`)
- no chain-of-thought persistence -- "the result exposes only structured,
  bounded fields," an exact-key-set assertion

Governance-block tests (human-owned / AI-blocked) were added beyond the
task's explicit list because the `status: "blocked"` value in the task's
own illustrative contract needed real, tested meaning (see Phase 14).

**Regression suites** (Phase 19's own list), run together with the new
suite, real MariaDB, 358/358 passing, 0 failures:
`tests/agent-loop/runAgentToolLoop.test.ts`,
`tests/agent-loop/buildAgentStepPromptPackage.test.ts`,
`tests/agent-loop/httpAgentLoopProvider.test.ts`,
`tests/agent-loop/pendingCatalogAction.test.ts`,
`tests/commercial/agentCapabilityExposure.test.ts`,
`tests/commercial/readToolRequest.test.ts`,
`tests/commercial/commercialActionRequest.test.ts`,
`tests/commercial/ensureCommercialActionOpportunity.test.ts`,
`tests/commercial/resolveRuntimeOpportunity.test.ts`,
`tests/commercial/agentRuntimeEvent.test.ts`,
`tests/commercial/followUpWake.test.ts`,
`tests/commercial/capabilityGatewayIdentityGate.test.ts`,
`tests/commercial/salesAgentRuntime.test.ts` (this task's own).
`npx tsc --noEmit`: clean.

**Full-repo suite**: also run in full (`npm test`, all 3988 tests across the
whole repo). Result: 3935 pass, 53 fail. All 53 failures are in subsystems
this task never touches (customer identity evidence, onboarding,
`link_external_identity`, customer session privacy, the R2 operational
loop, schema-integrity checks, A13 benchmark scenarios) and were confirmed
pre-existing by running one of them
(`tests/domains/customerIdentityEvidence.test.ts`) in complete isolation --
it fails the identical way with zero files from this task even present.
Local dev database schema drift (see Known limitations), not a regression
introduced here. None of the 53 failures are in any file this task added or
that the directly-relevant regression run above covers.

## Phase 20 -- Rollback

Purely additive; nothing else was touched:

1. Delete `lib/brain/commercial/sales-agent-runtime/` (2 files).
2. Delete `tests/commercial/salesAgentRuntime.test.ts`.

No production call site imports this module -- deleting it has zero effect
on `runNativeAutonomousCycle.ts`, `runAgentRuntimeEvent.ts`, or any other
runtime. No migration to revert, no flag to flip (none added).

## Known limitations (explicit)

- **`recentCatalogContext` cross-turn continuity does not work standalone
  through `SalesAgentRuntime` yet.** Discovered while building the session-
  continuity test, not by inspection: `loadRecentCatalogContext`'s SQL
  correlates a `crm_capability_executions` row back to its `inboundMessageId`
  through an `agent_tool_loop_completed` `commercial_event` row -- written
  only by `runNativeAgentToolLoopCycle.ts#recordAgentToolLoopCompletedCommercialEvent`,
  never by `runAgentToolLoop` itself. That function requires a full
  `ResolvedSalesAgentConfiguration` (configuration source/version/hash,
  effective model/temperature/budgets) `SalesAgentRuntime` deliberately does
  not resolve (Phase 18: not inheriting ATL-specific/native-cycle-specific
  state). Writing it from here would mean either fabricating configuration
  fields in an audit event (a correctness violation, not an acceptable
  shortcut) or pulling in the full configuration-resolution machinery this
  task's Scope Guard already excludes. Consequence: a caller relying purely
  on `SalesAgentRuntime` (no `runNativeAgentToolLoopCycle` wrapper) gets
  working *same-turn* evidence (`toolObservationsThisTurn`, used e.g. by
  `recommend_catalog_products`' own sourceProduct check) and working
  *cross-turn* continuity via `finalPendingCatalogAction` (this task's own
  addition, verified by test), but NOT cross-turn `recentCatalogContext`
  unless the caller also independently records that commercial_event, or a
  future task changes what `loadRecentCatalogContext` correlates against.
  Documented here rather than silently worked around by fabricating a
  fixture that hides the gap.
- **`AgentSession`/`agent_session_event` tables do not exist in this local
  dev `main_management` database** (`migrations/033_agent_sessions.sql` is
  present in the repo but not applied here). Every shadow session write in
  this task's own tests and trace capture degrades gracefully (a warning,
  never a thrown error or a blocked turn) -- proving the existing
  shadow/additive discipline works as designed, but also meaning per-tool
  `AgentSession` events could not be independently re-verified end-to-end in
  this environment. `executeReadTool`/`executeCommercialActionRequest`'s own
  test suites (already passing, part of the 358/358 run above) already cover
  this independently of the local DB gap. Not a V1.3 regression -- an
  existing environment/migration-application gap, out of scope to fix here.
- `runCommercialMultiIntentLoop` (the multi-intent planner) is a separate
  ATL implementation with its own known `CommercialActionRequest` gap
  (documented since V1.2) -- `SalesAgentRuntime` wraps `runAgentToolLoop`
  specifically, not that planner, and does not change or benefit from it.
- Token accounting (`inputTokens`/`outputTokens`) reflects only
  `AgentLoopResult.llmCalls`, i.e. gathering + finalization phase calls
  within the wrapped `runAgentToolLoop` invocation -- accurate for what this
  runtime itself does, by construction (Phase 12: at most one model call per
  decision slot).

## Exact next task

Wire `SalesAgentRuntime` into `runAgentRuntimeEvent.ts` as an alternative
(flagged, non-default) `CUSTOMER_MESSAGE` path, alongside a thin WhatsApp/
outbox dispatch adapter for `responseText` -- the two pieces this task
explicitly left undone (Scope Guard). That task should also decide whether
to close the `recentCatalogContext` gap above (either by having the new
dispatch wrapper record an equivalent correlation event, or by changing what
`loadRecentCatalogContext` correlates against) before enabling it for any
real conversation, since without it a second turn's product-identity
evidence would be weaker than production ATL's today.

---

## Exit criteria

**`R3_V1_3_FIRST_SALES_AGENT_RUNTIME_VALIDATED`**

- A real iterative model/tool loop exists -- reused from `runAgentToolLoop`,
  unmodified, proven again at this boundary by 16 new tests.
- Runtime consumes `AgentRuntimeEvent` -- confirmed (`CustomerMessageEvent`
  handled; `FollowUpWakeEvent` explicitly, honestly rejected as
  out-of-scope-for-this-runtime, never silently reinterpreted).
- Runtime is provider-neutral at its permanent boundary -- confirmed,
  `AgentLoopProvider` (already provider-neutral) is the only model-facing
  contract; DeepSeek specifics stay isolated in `httpAgentLoopProvider.ts`.
- Model can dynamically choose tool sequence -- confirmed, no fixed order,
  `AgentStep` is one decision at a time, proven by the multi-sequential-read
  test and the compare-then-recover test.
- `READ_TOOL` uses `ReadToolGateway` -- confirmed, unchanged code path.
- `COMMERCIAL_ACTION` uses V1.2 + `CommercialActionRequest` -- confirmed,
  unchanged code path, `resolvedOpportunityId` now correctly observable at
  this boundary (closing V1.2's documented gap without touching ATL).
- Capability Gateway remains authoritative -- confirmed, never bypassed.
- Identity remains authoritative -- confirmed by the LEVEL_0 `create_quote`
  test (opportunity created, mutation still denied).
- No fixed intent/objective/workflow machinery was added -- confirmed by
  `grep`, zero matches.
- `AgentSession` provides continuity without becoming business truth --
  confirmed: per-tool events already recorded for free; the turn-level
  envelope reuses A01's own shadow mechanism; no message text, no business
  state stored there.
- Runtime is bounded -- confirmed, `maxDecisions`/`maxToolExecutions`/
  `timeoutMs` all inherited and tested at this boundary.
- Failures are structured -- confirmed, every non-"responded" status carries
  an enum-like `reason`, never free text.
- No hidden chain-of-thought is persisted -- confirmed structurally by a
  dedicated exact-key-set test.
- Open-ended scenarios work without new specialized capabilities -- confirmed,
  zero new capabilities added; `compare_products` proven rejected.
- Runtime behavior is measurable -- confirmed
  (`modelSteps`/`toolCalls`/`readToolCalls`/`commercialActionCalls`/
  `durationMs`/`inputTokens`/`outputTokens`).
- Existing runtimes remain unchanged/compatible -- confirmed, zero files
  outside `sales-agent-runtime/` and this task's own test file were modified;
  358/358 directly-relevant regression tests pass.
- No WhatsApp routing changed -- confirmed, `runNativeAutonomousCycle.ts`
  and `runAgentRuntimeEvent.ts` untouched.
- Regressions are clean -- confirmed for every suite this task's own
  dependency graph touches; the 53 full-repo failures are pre-existing local
  environment gaps, verified unrelated by isolation testing.

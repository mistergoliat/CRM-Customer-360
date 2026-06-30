# Commercial Agent Runtime (MVP-02)

Implements the genuine, multi-turn, tool-using commercial agent loop. Lives entirely under `lib/brain/commercial/agent-runtime/`.

## Why a new module instead of extending `lib/brain/agents`/`lib/brain/tools`/`lib/brain/models`

That existing foundation (P1G/P1H) was inspected before writing anything new. It is a **single-shot classifier**, not a loop: `BrainToolRequest` is a static `{status: "planned"|"blocked"|"noop"}` marker the model fills in as part of one JSON response -- nothing ever actually calls the tool and feeds the result back for the model to observe and replan on. It is also wired to the legacy `BrainResolvedContext`/`BrainContextPacks` shape (`processInbound.ts`), not the native `CommercialContext`/`conversation`/`crm_opportunities` stack this session's prior work (PR-03/PR-03A) built. Bolting a real observe-act-observe loop onto a contract whose terminal artifact is "did the model say it wants a tool" rather than "what did the tool actually return" would have meant rewriting it anyway. The one genuinely reusable piece -- the OpenAI-compatible HTTP call shape in `runKnowledgeAgent.ts` -- is reused **by convention**: the new provider reads the exact same `BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY`/`BRAIN_MODEL_NAME`/`BRAIN_MODEL_TIMEOUT_MS` env vars rather than inventing a second model configuration for the same underlying concept.

## Components

```text
1. Commercial Agent Runtime  -> loop.ts, state.ts, prompt.ts, types.ts
2. Tool and Capability Layer -> tools/*, provider/*
3. Policy and Action Validator -> policy.ts
4. Execution and Outcome Layer -> the tools themselves (durable_write tools persist directly), state.ts (crm_agent_turn)
```

No fifth agent, no orchestrator-of-orchestrators. One runtime, one loop, a toolset selected per conversation (`AgentToolset`: `sales | orders | maintenance | post_sales | customer_service` -- only `sales` has real tools wired in this MVP; the others are typed and ready for the next vertical, not invented).

### 1. Commercial Agent Runtime (`loop.ts`, `state.ts`, `types.ts`)

`AgentConversationState` is the durable representation required: `customerGoal`, `conversationState`, `knownFacts`, `missingInformation`, `activeHypotheses`, `constraints`, `recommendedNextStep`, `pendingActions`, `completedActions`, `unresolvedQuestions`, `confidence`, plus `toolset`/`humanOwnerActive`/`handoffMode`/`turnCount` for handoff and continuity bookkeeping. Persisted in `crm_agent_conversation_state` (migration `012_commercial_agent_runtime.sql`) -- commercial truth, not an `ai_*` trace (ADR-001/ADR-002). Per-turn observability (tool calls, iterations, final decision, model name) is recorded separately in `crm_agent_turn`, also `crm_*` since it is the durable record of what the agent actually did, not a deliberation trace.

`runCommercialAgentTurn` is the real loop:

```text
load/init durable state
-> system prompt embeds the durable state (goal, known facts, missing info, pending/completed actions)
-> provider.complete({messages, tools}) -> one of: tool_call | respond | handoff | malformed
-> tool_call: policy.evaluateProposedAction -> denied/missing_information short-circuits with a message
              fed back to the model (it must adapt, not retry blindly) -> ok: execute, observe, continue
-> malformed: corrective message pushed back, bounded retry
-> respond: finalize (respond | respond_and_act depending on whether a non-read tool actually ran)
-> handoff: sets state.humanOwnerActive/handoffMode unconditionally (this is the agent's own
            durable signal, not contingent on whether an opportunity exists to sync it onto),
            best-effort syncs to crm_opportunities via the request_human_handoff tool
-> bounded by maxIterations (default 6): hitting the bound is a safe, honest exit
   (finalDecision: "blocked_no_progress"), never a silent loop or a crash
```

### 2. Tool and Capability Layer (`tools/*`, `provider/*`)

Each `AgentToolDefinition` carries every field the spec requires: `name`, `version`, `description`, `inputSchema`, `outputSchema`, `authorizationLevel`, `sideEffectLevel` (`read | durable_write | external_effect`), `idempotent`, `timeoutMs`, `sourceOfTruth`, `errorContract`. Real tools in this MVP, all wrapping already-integrated, already-tested repositories rather than direct SQL:

| Tool | Wraps | Side effect |
|---|---|---|
| `get_customer_context` | `buildNativeCommercialContext` (PR-03/PR-03A) | read |
| `search_products`, `get_product_detail`, `get_related_products` | `SalesConsultativeProductRepository` (`lib/brain/commercial/sales-consultative/catalogRepository.ts`) | read |
| `create_or_update_opportunity` | `SalesConsultativeOperationsRepository.createOrUpdateOpportunity` -> `crm_opportunities` | durable_write |
| `create_follow_up_action` | `...createFollowUpAction` -> `crm_agent_actions` | durable_write |
| `request_human_handoff` | `...requestHumanHandoff` -> `crm_opportunities` | durable_write |

`lib/catalog` (the `CatalogService`/`PrestashopCatalogAdapter`/`SnapshotCatalogAdapter` boundary from ADR-005) is **not** used here: AC-CATALOG was reviewed this session and is `changes_requested`, not merged into `develop`/`ADRclaude`. `search_products`/`get_product_detail`/`get_related_products` wrap `SalesConsultativeProductRepository` instead, which is what is actually integrated on this branch. When AC-CATALOG lands, only `tools/catalog.ts`'s repository implementation needs to change (`createPrestashopProductRepository()` -> a `CatalogService`-backed implementation) -- the tool contracts and the rest of the runtime are unaffected.

**Provider** (`provider/types.ts`, `httpProvider.ts`, `fakeProvider.ts`): a small, provider-agnostic structured-JSON protocol (`tool_call | respond | handoff`) rather than a specific vendor's native function-calling API, so it works against any OpenAI-compatible chat-completions endpoint. `createHttpAgentProvider` is the real implementation; `createFakeAgentProvider`/`createScriptedAgentProvider` are deterministic (same input -> same output, no wall-clock dependency) and are what every test and the offline/no-API-key path uses.

### 3. Policy and Action Validator (`policy.ts`)

`evaluateProposedAction({toolName, args, state, registry})` validates one proposed action -- it does not pick the commercial strategy. Output: `allowed | allowed_with_constraints | requires_approval | denied | missing_information | capability_unavailable`, each with a structured reason. Tools are leveled by `sideEffectLevel` (`read` -> 0, `durable_write` -> 2; `request_human_handoff` is pinned to level 1 communication/registration). Level-3 high-impact actions (discounts out of range, refunds, irreversible cancellation, compensation, warranty exceptions) are **not registered as tools at all** in this MVP -- there is no capability to request, so they fail closed as `capability_unavailable` rather than as a policy decision on an action that does not exist yet. An active `exclusive_handoff` denies further `durable_write` tool calls but never denies `read` tools, matching "handoff does not have to turn off all automation."

### 4. Execution and Outcome Layer

No separate execution queue was built for this MVP: `durable_write` tools execute synchronously inside the loop and persist directly (reusing the already-accepted `crm_agent_actions`/`crm_opportunities` persistence paths from the `sales-consultative` engine, including their existing idempotency keys). The outcome is the tool's own `AgentToolResult` (`ok`, `output`, `warnings`, `error`), observed by the loop and folded into `state.completedActions`/`state.pendingActions`. This is a deliberate simplification (see Limitations) rather than the full `AcceptedCommercialDecision -> CommercialAction -> ActionExecution -> ActionOutcome` pipeline `lib/brain/commercial/action-lifecycle`/`action-queue` implement for the older engine -- wiring through that pipeline instead of direct persistence is the natural next step once this runtime needs Level-3 actions or operator review queues.

## WhatsApp wiring (`wireToNativeInbound.ts`)

`maybeRunCommercialAgentForInboundTurn` is called from the end of `processNativeWhatsAppInbound` (`lib/brain/native-whatsapp/service.ts`), gated by `BRAIN_COMMERCIAL_AGENT_ENABLED` (default `false`/unset) -- the same disabled-by-default pattern as every other capability in this codebase (`BRAIN_META_SEND_ENABLED`, `BRAIN_AUTONOMOUS_REPLY_ENABLED`, etc.). With the flag off, behavior is byte-identical to before this change; the pre-existing regression test `"native inbound path does not invoke consultative engine or outbox writers"` still passes unmodified. With the flag on but no `BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY` configured, the trigger returns `model_not_configured` and the inbound message still persists normally -- it never throws, by design (a failure here must never undo already-committed inbound persistence, ADR-007). When the model is configured, the agent's response is staged as a `planned` row in `brain_message_outbox` (existing dedupe/idempotency), never sent directly -- actual sending still goes through the existing, separately-gated outbox worker and `BRAIN_META_SEND_ENABLED`.

## HUB visibility (`operationalSummary.ts`, `app/api/conversations/[id]/agent/route.ts`)

`GET /api/conversations/:id/agent` (operator-authenticated via the existing `requireOperator`) returns the durable state plus a short, factual per-turn narration built **only from the recorded tool calls** (`"Consultó catálogo (\"...\")."`, `"Creó o actualizó una oportunidad comercial."`) -- never the model's raw "thought" text, which is explicitly excluded from the narration and never persisted into the operator-facing view. Proven in `tests/commercial-agent/operationalSummary.test.ts`.

## Metrics (`metrics.ts`)

`computeAgentRuntimeMetrics(since?)` computes `autonomousResolutionRate`, `humanTransferRate`, `toolSuccessRate`, `actionSuccessRate`, `groundingFailureRate`, `averageIterationsPerTurn` from `crm_agent_turn` -- the durable record, not `ai_*`. `positive_csat_rate`, `recontact_rate`, and `conversation_abandonment_rate` are listed in the product brief but require operator/CSAT or longitudinal data this MVP does not yet collect; they are intentionally left out rather than computed from a proxy that would misrepresent them.

## Data model

```text
crm_agent_conversation_state  -- one row per conversation, commercial truth
crm_agent_turn                -- one row per turn, durable execution record
crm_opportunities             -- existing, written by create_or_update_opportunity / request_human_handoff
crm_agent_actions             -- existing, written by create_follow_up_action
brain_message_outbox          -- existing, written (planned only) by the WhatsApp wiring
```

## Limitations (real, not hedging)

- Only the `sales` toolset has real tools. `orders`/`maintenance`/`post_sales`/`customer_service` are typed in `AgentToolset` but have no tools registered -- claims, in this MVP, are handled through the same `create_or_update_opportunity`/`create_follow_up_action` tools (stage `"handoff"`, a free-text summary), not a dedicated claims/warranty data model, because no such backing table exists in this repository yet (ADR-006: "no inventes fuentes de verdad inexistentes").
- No Level-3 (high-impact) tool exists yet, so the policy validator's `requires_approval` path for level 3 is implemented but structurally unreachable in this MVP -- intentional, not an oversight.
- Durable-write tools persist directly rather than through the full proposed -> approved -> executed `CommercialAction` lifecycle (`action-lifecycle`/`action-queue`); see "Execution and Outcome Layer" above.
- No real LLM call has been exercised in this environment: `BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY` are unset (confirmed before implementation started). The HTTP provider is real and complete; every test and the evaluation suite run against the deterministic scripted provider instead. This is an external credential blocker, not a runtime limitation.
- The catalog tools wrap the pre-AC-CATALOG `SalesConsultativeProductRepository`, not the ADR-005 `CatalogService` boundary, because AC-CATALOG is not merged (see "Tool and Capability Layer").

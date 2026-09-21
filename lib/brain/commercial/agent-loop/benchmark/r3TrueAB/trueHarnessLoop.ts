import { createHash } from "node:crypto";
import { executeGovernedCapability } from "../../../capability-gateway/executeCapability";
import type { CapabilityGatewayContext, CapabilityGatewayResult } from "../../../capability-gateway/types";
import { buildToolObservation } from "../../buildToolObservation";
import { resolveObservedRecommendationSourceProduct } from "../../resolveObservedRecommendationSourceProduct";
import type { RecentCatalogContext } from "../../recentCatalogContext";
import type { NativeChatMessage, NativeModelCaller, NativeModelCallResult } from "./nativeToolClient";
import type { ToolSurface } from "./toolSurface";

/**
 * SALES-AGENT-R3-P7.8-R. The TRUE autonomous loop (variants B and C1). It
 * deliberately shares nothing with runAgentToolLoop: no AgentStep, no
 * use_tool/respond/handoff protocol, no gathering/finalization split, no
 * "steps remaining", no open-turn checkpoint, no prompt package. The whole
 * cognitive protocol is the provider's native function calling:
 *
 *   while within limits:
 *     model(messages, tools)
 *     tool calls -> execute each through the EXISTING Capability Gateway
 *                   (executeGovernedCapability), append the structured result
 *                   AND a freshly rebuilt commercial state, continue
 *     plain text -> that is the final response, stop
 *
 * Retained as harness-level EXECUTION_GOVERNANCE/SAFETY (not cognition), all
 * of it by calling the same pure functions the R3 loop uses:
 *  - the tool must exist on the model-facing surface (else capability_not_registered);
 *  - select_products items must reference a product this conversation observed
 *    (resolveObservedRecommendationSourceProduct - the evidence gate);
 *  - the Gateway itself applies identity, availability, argument validation
 *    and audit (never bypassed, never re-implemented here);
 *  - hard bounds: turn deadline, max model calls, max tool calls.
 * Dropped on purpose (they are R3 orchestration): duplicate-call guard,
 * unbacked-claim checkpoint, no-progress guard, guided JSON repair.
 */

export type TrueHarnessTerminalReason = "responded" | "timeout" | "provider_unavailable" | "invalid_output" | "emergency_limit_exceeded";

export type TrueHarnessToolCallRecord = {
  stepIndex: number;
  toolName: string;
  gatewayCapability: string | null;
  argumentsParsed: boolean;
  /** Set when the call never reached the Gateway (unknown tool, unparseable arguments, evidence gate). */
  rejectedBeforeGateway: string | null;
  gatewayStatus: string | null;
  gatewayErrorCode: string | null;
  gatewayRetryable: boolean;
  observationStatus: string;
  observationErrorCode: string | null;
  observationRetryable: boolean | null;
  /** sha256 prefix of tool+arguments: lets duplicates be counted without persisting raw arguments. */
  fingerprint: string;
};

export type TrueHarnessModelCallRecord = { callIndex: number; outcome: "success" | "timeout" | "http_error" | "network_error" | "invalid_response"; elapsedMs: number; inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; finishReason: string | null };

export type TrueHarnessLimits = { maxModelCalls: number; maxToolCalls: number };
export const TRUE_HARNESS_DEFAULT_LIMITS: TrueHarnessLimits = { maxModelCalls: 24, maxToolCalls: 20 };

export type TrueHarnessDependencies = {
  callModel: NativeModelCaller;
  /** Default: the real Capability Gateway. Injected only by loop-mechanics unit tests. */
  executeCapability?: (capability: string, input: Record<string, unknown>, context: CapabilityGatewayContext) => Promise<CapabilityGatewayResult>;
  /** Rebuilds the canonical commercial state (DRM-backed, read-only). Its return value is appended verbatim to the next model iteration. */
  refreshState: () => Promise<unknown>;
};

export type TrueHarnessResult = {
  terminalReason: TrueHarnessTerminalReason;
  finalMessage: string | null;
  toolCalls: TrueHarnessToolCallRecord[];
  modelCalls: TrueHarnessModelCallRecord[];
  stateRefreshCount: number;
  warnings: string[];
  /** Every message appended during this turn (assistant tool calls, tool results). Used by tests/observability only. */
  appendedMessages: NativeChatMessage[];
};

const fingerprintOf = (tool: string, args: unknown): string => createHash("sha256").update(`${tool}:${JSON.stringify(args)}`).digest("hex").slice(0, 12);

function toModelCallRecord(callIndex: number, result: NativeModelCallResult): TrueHarnessModelCallRecord {
  if (result.kind === "ok") return { callIndex, outcome: "success", elapsedMs: result.elapsedMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens, reasoningTokens: result.reasoningTokens, finishReason: result.finishReason };
  return { callIndex, outcome: result.kind === "timeout" ? "timeout" : result.reason, elapsedMs: result.elapsedMs, inputTokens: null, outputTokens: null, reasoningTokens: null, finishReason: null };
}

export async function runTrueHarnessTurn(input: {
  messages: NativeChatMessage[];
  surface: ToolSurface;
  gatewayContext: CapabilityGatewayContext;
  recentCatalogContext: RecentCatalogContext | null;
  deadlineMs: number;
  deps: TrueHarnessDependencies;
  limits?: TrueHarnessLimits;
}): Promise<TrueHarnessResult> {
  const limits = input.limits ?? TRUE_HARNESS_DEFAULT_LIMITS;
  const execute = input.deps.executeCapability ?? executeGovernedCapability;
  const messages = [...input.messages];
  const appendedMessages: NativeChatMessage[] = [];
  const toolCalls: TrueHarnessToolCallRecord[] = [];
  const modelCalls: TrueHarnessModelCallRecord[] = [];
  const warnings: string[] = [];
  const observationsThisTurn: ReturnType<typeof buildToolObservation>[] = [];
  let stateRefreshCount = 0;
  let emptyRetryUsed = false;

  const finish = (terminalReason: TrueHarnessTerminalReason, finalMessage: string | null): TrueHarnessResult => ({ terminalReason, finalMessage, toolCalls, modelCalls, stateRefreshCount, warnings, appendedMessages });
  const push = (message: NativeChatMessage) => {
    messages.push(message);
    appendedMessages.push(message);
  };

  while (true) {
    if (Date.now() > input.deadlineMs) return finish("timeout", null);
    if (modelCalls.length >= limits.maxModelCalls || toolCalls.length >= limits.maxToolCalls) {
      warnings.push("true_harness_emergency_limit");
      return finish("emergency_limit_exceeded", null);
    }

    const result = await input.deps.callModel({ messages, tools: input.surface.tools, deadlineMs: input.deadlineMs });
    modelCalls.push(toModelCallRecord(modelCalls.length, result));
    if (result.kind === "timeout") return finish("timeout", null);
    if (result.kind === "error") {
      warnings.push(`true_harness_provider_error:${result.reason}`);
      return finish("provider_unavailable", null);
    }

    if (result.toolCalls.length === 0) {
      const text = result.content?.trim() ?? "";
      if (text.length > 0) return finish("responded", text);
      if (emptyRetryUsed) {
        warnings.push("true_harness_empty_response");
        return finish("invalid_output", null);
      }
      emptyRetryUsed = true; // one plain re-ask of the same context, same as any transport-level retry
      continue;
    }

    push({ role: "assistant", content: result.content, tool_calls: result.toolCalls.map((call) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: call.arguments } })) });

    for (const call of result.toolCalls) {
      let parsedArguments: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(call.arguments || "{}");
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) parsedArguments = parsed as Record<string, unknown>;
      } catch {
        parsedArguments = null;
      }

      const record: TrueHarnessToolCallRecord = {
        stepIndex: toolCalls.length,
        toolName: call.name,
        gatewayCapability: null,
        argumentsParsed: parsedArguments !== null,
        rejectedBeforeGateway: null,
        gatewayStatus: null,
        gatewayErrorCode: null,
        gatewayRetryable: false,
        observationStatus: "blocked",
        observationErrorCode: null,
        observationRetryable: null,
        fingerprint: fingerprintOf(call.name, parsedArguments ?? call.arguments)
      };
      let observation: ReturnType<typeof buildToolObservation>;

      const adapted = parsedArguments === null ? null : input.surface.adapt(call.name, parsedArguments);
      if (parsedArguments === null) {
        record.rejectedBeforeGateway = "invalid_arguments_json";
        observation = { tool: call.name, status: "blocked", errorCode: "invalid_arguments_json" };
      } else if (adapted && !adapted.ok) {
        record.rejectedBeforeGateway = adapted.errorCode;
        observation = { tool: call.name, status: "blocked", errorCode: adapted.errorCode };
      } else {
        const adaptedOk = adapted as { ok: true; capability: string; input: Record<string, unknown> };
        record.gatewayCapability = adaptedOk.capability;

        let evidenceBlock: string | null = null;
        if (adaptedOk.capability === "select_products") {
          const items = Array.isArray(adaptedOk.input.items) ? adaptedOk.input.items : [];
          for (const item of items) {
            const requested = item as { productId?: unknown; combinationId?: unknown };
            const evidence = resolveObservedRecommendationSourceProduct({
              requestedSourceProduct: {
                productId: typeof requested.productId === "string" ? Number(requested.productId) : requested.productId,
                combinationId: typeof requested.combinationId === "string" ? Number(requested.combinationId) : requested.combinationId
              },
              recentCatalogContext: input.recentCatalogContext,
              toolObservations: observationsThisTurn
            });
            if (evidence.status === "blocked") {
              evidenceBlock = evidence.reason;
              break;
            }
          }
        }

        if (evidenceBlock) {
          record.rejectedBeforeGateway = evidenceBlock;
          observation = { tool: call.name, status: "blocked", errorCode: evidenceBlock };
        } else {
          const gatewayResult = await execute(adaptedOk.capability, adaptedOk.input, input.gatewayContext);
          record.gatewayStatus = gatewayResult.status;
          record.gatewayErrorCode = gatewayResult.errorCode ?? null;
          record.gatewayRetryable = gatewayResult.retryable;
          observation = buildToolObservation(call.name, gatewayResult);
        }
      }

      record.observationStatus = observation.status;
      record.observationErrorCode = observation.errorCode ?? null;
      record.observationRetryable = observation.retryable ?? null;
      toolCalls.push(record);
      observationsThisTurn.push(observation);

      // The refreshed canonical state travels with every tool result: the next model iteration always sees what is durably saved NOW.
      const commercialState = await input.deps.refreshState();
      stateRefreshCount += 1;
      push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ result: observation, commercialState }) });
    }
  }
}

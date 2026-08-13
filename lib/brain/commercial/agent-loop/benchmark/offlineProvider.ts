import type { AgentLoopProvider, AgentLoopProviderResponse } from "../agentLoopProviderTypes";
import { markAgentLoopProviderFailure } from "../providers/providerFailureClassification";
import type { BenchmarkOfflineStep } from "./types";

/**
 * LLM-R1-T05. Interprets a fixture's offlineScript into a deterministic
 * AgentLoopProvider - never a claim about how the real model would behave,
 * only a fixed, reproducible input for validating the harness itself (Part C
 * of the task: "validar harness; validar expected results; demostrar que el
 * benchmark no introduce side effects"). The last script entry repeats if
 * runAgentToolLoop calls more times than scripted, same convention as
 * fakeAgentLoopProvider.ts.
 *
 * "invalid_response"/"invalid_json_shape" entries let a case exercise
 * T01's structured recovery and T04's guided repair exactly as production
 * does - this function throws/returns real, correctly-classified failures
 * (via the same markAgentLoopProviderFailure T01 already uses), it never
 * bypasses or reimplements that logic.
 */
export function createOfflineScriptedProvider(script: BenchmarkOfflineStep[]): AgentLoopProvider {
  let callIndex = 0;

  return {
    name: "benchmark-offline-scripted-provider",
    version: "offline.v1",
    async invoke(): Promise<AgentLoopProviderResponse> {
      const step = script[Math.min(callIndex, script.length - 1)];
      callIndex += 1;
      const providerRequestId = `offline-${callIndex}`;

      if (step.kind === "invalid_response") {
        const errorMessage =
          step.errorCode === "empty_response"
            ? "Benchmark offline provider simulated an empty response."
            : step.errorCode === "invalid_model_json"
              ? "Benchmark offline provider simulated invalid response JSON."
              : "Benchmark offline provider simulated an invalid JSON envelope.";
        throw markAgentLoopProviderFailure(new Error(errorMessage), {
          model: "benchmark-offline-model",
          attemptCount: 1,
          maxAttempts: 1,
          httpStatus: 200,
          errorCode: step.errorCode,
          errorClass: "InvalidProviderResponseError",
          normalizedReason: "invalid_response",
          retryable: false
        });
      }

      let rawOutput: unknown;
      if (step.kind === "invalid_json_shape") {
        rawOutput = step.rawOutput;
      } else if (step.kind === "use_tool") {
        rawOutput = { type: "use_tool", tool: step.tool, arguments: step.arguments };
      } else if (step.kind === "respond") {
        rawOutput = { type: "respond", message: step.message, ...(step.pendingCatalogAction ? { pendingCatalogAction: step.pendingCatalogAction } : {}) };
      } else {
        rawOutput = { type: "handoff", reason: step.reason };
      }

      return {
        rawOutput,
        model: "benchmark-offline-model",
        // T02 discipline preserved even in the fake: no real inference
        // happened, so token usage is genuinely unknown/not-applicable here -
        // never an invented 0 that would misleadingly read as "near-zero
        // real usage" in the aggregated metrics.
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        providerRequestId,
        finishReason: "stop"
      };
    }
  };
}

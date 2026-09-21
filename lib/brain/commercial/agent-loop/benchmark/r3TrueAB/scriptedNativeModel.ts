import type { BenchmarkOfflineStep } from "../types";
import type { NativeModelCaller } from "./nativeToolClient";

/**
 * SALES-AGENT-R3-P7.8-R. Offline/test model for the true harness: replays the
 * same per-turn scripts the corpus already defines for the scripted provider,
 * but as native function calls (use_tool -> tool_calls, respond/handoff ->
 * plain text). The whole case shares one caller, consumed in order; the last
 * entry repeats - the same convention as the offline scripted provider.
 * Ignores the prompt and the tool surface by construction: it proves wiring,
 * never model behavior.
 */
export function createScriptedNativeModel(script: readonly BenchmarkOfflineStep[]): NativeModelCaller {
  let index = 0;
  return async () => {
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    const base = { finishReason: "stop", inputTokens: 1, outputTokens: 1, reasoningTokens: 0, elapsedMs: 1 } as const;
    if (!step) return { kind: "ok", content: "Listo.", toolCalls: [], ...base };
    if (step.kind === "use_tool") return { kind: "ok", content: null, toolCalls: [{ id: `scripted_${index}`, name: step.tool, arguments: JSON.stringify(step.arguments) }], ...base };
    if (step.kind === "respond") return { kind: "ok", content: step.message, toolCalls: [], ...base };
    if (step.kind === "handoff") return { kind: "ok", content: step.reason, toolCalls: [], ...base };
    return { kind: "error", reason: "invalid_response", httpStatus: 200, elapsedMs: 1 };
  };
}

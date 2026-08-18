import type { AgentLoopProvider, AgentLoopProviderResponse } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import type { CommercialIntentPlan } from "@/lib/brain/commercial/multi-intent/types";

/**
 * SALES-AGENT-R2-A07.5. The legacy agent-loop benchmark's offline provider
 * (lib/brain/commercial/agent-loop/benchmark/offlineProvider.ts) scripts
 * AgentStep unions (use_tool/respond/handoff) - the wrong shape for the R2
 * planner, whose raw output is a CommercialIntentPlan ({"intents":[...]}).
 * Small enough to not force-fit the legacy one: scripts a plan (or a thrown
 * provider failure) directly, deterministic and reproducible, for the
 * deterministic/integration stage of the corpus (R2-01..R2-09/R2-12) - the
 * live provider is reserved for the C09 legacy-vs-R2 comparison.
 */
export type OfflinePlannerScriptStep = { kind: "plan"; plan: CommercialIntentPlan } | { kind: "invalid_response" } | { kind: "invalid_plan_shape"; rawOutput: unknown };

export function createOfflinePlannerProvider(script: OfflinePlannerScriptStep[]): AgentLoopProvider {
  let callIndex = 0;

  return {
    name: "r2-benchmark-offline-planner-provider",
    version: "offline.v1",
    async invoke(): Promise<AgentLoopProviderResponse> {
      const step = script[Math.min(callIndex, script.length - 1)];
      callIndex += 1;
      const providerRequestId = `r2-offline-${callIndex}`;

      if (step.kind === "invalid_response") {
        throw new Error("R2 benchmark offline planner provider simulated a provider-level failure.");
      }

      const rawOutput = step.kind === "invalid_plan_shape" ? step.rawOutput : step.plan;
      return {
        rawOutput,
        model: "r2-benchmark-offline-model",
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        providerRequestId,
        finishReason: "stop"
      };
    }
  };
}

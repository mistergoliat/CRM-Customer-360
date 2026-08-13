import type { AgentLoopProvider, AgentLoopProviderRequest, AgentLoopProviderResponse } from "../agentLoopProviderTypes";
import { classifyAgentLoopProviderFailure } from "../providers/providerFailureClassification";
import type { BenchmarkProviderCallRecord } from "./types";

/**
 * LLM-R1-T05. Wraps any AgentLoopProvider (offline scripted or live) to
 * record one BenchmarkProviderCallRecord per real invocation, independent of
 * AgentLoopResult.llmCalls (T02) - this harness never edits T01-T04 shipped
 * code, so it classifies a thrown error itself, via the exact same exported
 * classifyAgentLoopProviderFailure T01/T02 already use (never a duplicated
 * or reimplemented classifier). Errors are re-thrown completely unchanged -
 * this wrapper only observes, it never alters what runAgentToolLoop sees,
 * so T01's recovery and T04's guided repair run exactly as in production.
 *
 * The finer-grained `errorCode` this captures (empty_response vs
 * invalid_model_json vs invalid_json_response vs a transport code) is what
 * lets Part B's metrics distinguish those rates separately - T02's own
 * `outcome` field on AgentLoopInferenceRecord only carries the coarser
 * normalizedReason.
 */
export function createInstrumentedProvider(inner: AgentLoopProvider, caseId: string, runIndex: number, calls: BenchmarkProviderCallRecord[]): AgentLoopProvider {
  let callIndex = 0;

  return {
    name: inner.name,
    version: inner.version,
    async invoke(request: AgentLoopProviderRequest, options): Promise<AgentLoopProviderResponse> {
      const startedAt = Date.now();
      const currentCallIndex = callIndex;
      callIndex += 1;

      try {
        const response = await inner.invoke(request, options);
        calls.push({
          caseId,
          runIndex,
          callIndex: currentCallIndex,
          elapsedMs: Date.now() - startedAt,
          outcome: "success",
          errorCode: null,
          finishReason: response.finishReason ?? null,
          inputTokens: response.inputTokens ?? null,
          outputTokens: response.outputTokens ?? null,
          reasoningTokens: response.reasoningTokens ?? null,
          providerRequestId: response.providerRequestId ?? null,
          model: response.model ?? null
        });
        return response;
      } catch (error) {
        const cause = classifyAgentLoopProviderFailure(error);
        calls.push({
          caseId,
          runIndex,
          callIndex: currentCallIndex,
          elapsedMs: Date.now() - startedAt,
          outcome: cause.normalizedReason,
          errorCode: cause.errorCode,
          finishReason: cause.finishReason ?? null,
          inputTokens: cause.inputTokens ?? null,
          outputTokens: cause.outputTokens ?? null,
          reasoningTokens: cause.reasoningTokens ?? null,
          providerRequestId: cause.providerRequestId ?? null,
          model: cause.model
        });
        throw error;
      }
    }
  };
}

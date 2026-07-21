import type {
  AgentLoopProvider,
  AgentLoopProviderInvokeOptions,
  AgentLoopProviderRequest,
  AgentLoopProviderResponse
} from "../agentLoopProviderTypes";

export type FakeAgentLoopProviderConfig = {
  /** One raw output per invocation, consumed in order; the last entry repeats if the loop calls more times than scripted. */
  script: unknown[];
  version?: string;
};

/**
 * Deterministic, scriptable provider for tests: returns one entry of
 * `script` per call, in order. Lets a test drive a full multi-step
 * conversation (use_tool -> observation -> respond) without a real LLM.
 */
export function createFakeAgentLoopProvider(config: FakeAgentLoopProviderConfig): AgentLoopProvider {
  let callIndex = 0;

  return {
    name: "fake-agent-loop-provider",
    version: config.version ?? "fake-provider.v1",
    async invoke(_request: AgentLoopProviderRequest, options: AgentLoopProviderInvokeOptions): Promise<AgentLoopProviderResponse> {
      if (options.signal?.aborted) {
        const error = new Error("Provider invocation aborted.");
        error.name = "AbortError";
        throw error;
      }

      const rawOutput = config.script[Math.min(callIndex, config.script.length - 1)];
      callIndex += 1;
      return {
        rawOutput,
        model: "fake-agent-loop-model",
        inputTokens: 32,
        outputTokens: 64,
        providerRequestId: `fake-agent-loop-${callIndex}`,
        finishReason: "stop"
      };
    }
  };
}

import type { AgentProvider, AgentProviderDecision, AgentProviderRequest, AgentProviderResult } from "./types";

/**
 * Deterministic provider: same input always produces the same decision, no
 * network call, no wall-clock dependency. Used by tests/evaluation so the
 * agent loop itself (tool selection, replanning, continuity) can be proven
 * without BRAIN_MODEL_API_URL/BRAIN_MODEL_API_KEY being configured.
 *
 * `decide` receives the exact same provider-facing view the HTTP provider
 * would (messages + available tools) and must return a decision synchronously
 * or via a resolved promise -- it is the caller's responsibility to encode
 * whatever scripted or heuristic behavior a scenario needs.
 */
export function createFakeAgentProvider(decide: (request: AgentProviderRequest) => AgentProviderDecision | Promise<AgentProviderDecision>): AgentProvider {
  return {
    name: "fake",
    async complete(request: AgentProviderRequest): Promise<AgentProviderResult> {
      const startedAt = Date.now();
      const decision = await decide(request);
      return {
        decision,
        modelName: "fake-deterministic",
        latencyMs: Date.now() - startedAt,
        rawTokensIn: null,
        rawTokensOut: null
      };
    }
  };
}

/**
 * A queue-scripted provider: each call to `complete` consumes the next
 * decision from the queue. Throws if the queue is exhausted, which makes
 * test scenarios fail loudly instead of silently looping.
 */
export function createScriptedAgentProvider(decisions: AgentProviderDecision[]): AgentProvider {
  const queue = [...decisions];
  return createFakeAgentProvider(() => {
    const next = queue.shift();
    if (!next) {
      throw new Error("scripted_agent_provider_exhausted");
    }
    return next;
  });
}

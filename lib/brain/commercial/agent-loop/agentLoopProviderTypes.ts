/**
 * ACS-R1-05.1-T02.1. Deliberately not SalesAgentProvider/SalesAgentProviderRequest:
 * this loop must not require a full SalesAgentInput to invoke the model - one
 * message list in, one raw AgentStep out. See docs/product/sales-agent-contract.md
 * for why the older, heavier contract is not extended for this loop.
 */

export type AgentLoopProviderMessage = {
  role: "system" | "user";
  content: string;
};

export type AgentLoopProviderRequest = {
  messages: AgentLoopProviderMessage[];
  correlationId?: string | null;
};

export type AgentLoopProviderInvokeOptions = {
  signal?: AbortSignal | null;
  timeoutMs: number;
};

export type AgentLoopProviderResponse = {
  rawOutput: unknown;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /**
   * LLM-R1-T08B. A numeric count only - a provider that supports "thinking"/
   * reasoning models (e.g. usage.completion_tokens_details.reasoning_tokens)
   * may report how many of outputTokens were spent on hidden reasoning
   * before the final content. Never the reasoning text itself - no field
   * anywhere in this contract carries raw reasoning_content, and none should
   * ever be added. Absent/null for a provider that does not report it.
   */
  reasoningTokens?: number | null;
  providerRequestId?: string | null;
  finishReason?: string | null;
};

export type AgentLoopProvider = {
  name: string;
  version?: string | null;
  invoke(request: AgentLoopProviderRequest, options: AgentLoopProviderInvokeOptions): Promise<AgentLoopProviderResponse>;
};

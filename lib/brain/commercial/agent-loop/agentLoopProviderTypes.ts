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
  providerRequestId?: string | null;
  finishReason?: string | null;
};

export type AgentLoopProvider = {
  name: string;
  version?: string | null;
  invoke(request: AgentLoopProviderRequest, options: AgentLoopProviderInvokeOptions): Promise<AgentLoopProviderResponse>;
};

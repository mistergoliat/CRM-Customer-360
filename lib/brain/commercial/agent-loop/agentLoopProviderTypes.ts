/**
 * ACS-R1-05.1-T02.1. Deliberately not SalesAgentProvider/SalesAgentProviderRequest:
 * this loop must not require a full SalesAgentInput to invoke the model - one
 * message list in, one raw AgentStep out. See docs/product/sales-agent-contract.md
 * for why the older, heavier contract is not extended for this loop.
 */

export type AgentLoopProviderMessage = {
  /**
   * SALES-AGENT-R3-V1.8-D3. "assistant" added so deriveMessages.ts (agent-session/
   * deriveMessages.ts) can represent real historical assistant turns from
   * conversation_message - the OpenAI-compatible endpoint this repo's HTTP
   * provider already calls (httpAgentLoopProvider.ts) natively supports it,
   * same request shape, no server-side change needed. "tool" deliberately NOT
   * added: nothing in this loop's real request/response cycle uses OpenAI's
   * multi-turn tool-call role today (Capability Gateway results are folded
   * into the next user-role payload, not sent back as a `tool` message), so
   * adding it now would be speculative, not evidence-based. Purely additive -
   * buildAgentStepPromptPackage.ts's only two construction sites still emit
   * "system"/"user" literals, byte-identical, and D3 does not wire this new
   * role into that request path (Section W: shadow-only).
   */
  role: "system" | "user" | "assistant";
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
  /**
   * SALES-AGENT-R3-V1.8-D1. DeepSeek-specific cache accounting, confirmed
   * real via a live provider call against this repo's own configured
   * endpoint (docs/releases/SALES-AGENT-R3-V1.8-D0-PERSISTENT-SESSION-IMPLEMENTATION-PREFLIGHT.md
   * section 9): usage.prompt_cache_hit_tokens / usage.prompt_cache_miss_tokens.
   * Not the OpenAI-standard nested usage.prompt_tokens_details.cached_tokens
   * shape (same information, one fewer level of null-safe traversal) and
   * not the DeepSeek Harness's own field names (this repo does not use that
   * package - V1.8-C0). null when the provider does not report it, same
   * discipline as reasoningTokens above. This field lives on the provider
   * response only - it must never be propagated into AgentToolLoopLlmCallSummary/
   * llmMetrics (lib/brain/commercial/events/types.ts) under this name: that
   * module's own sanitizer rejects any key containing "token"
   * (events/types.ts's own documented reason inputSize/outputSize are named
   * that way, not ...Tokens) - a future slice that wires this into the
   * commercial_event-bound rollup must use cacheReadSize/cacheMissSize
   * there instead.
   */
  cacheReadTokens?: number | null;
  cacheMissTokens?: number | null;
  providerRequestId?: string | null;
  finishReason?: string | null;
};

export type AgentLoopProvider = {
  name: string;
  version?: string | null;
  invoke(request: AgentLoopProviderRequest, options: AgentLoopProviderInvokeOptions): Promise<AgentLoopProviderResponse>;
};

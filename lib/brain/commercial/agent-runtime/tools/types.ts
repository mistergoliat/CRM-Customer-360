import type { AgentConversationState } from "../types";

export type AgentToolAuthorizationLevel = "none" | "operator_review" | "policy_gate";
export type AgentToolSideEffectLevel = "read" | "durable_write" | "external_effect";

export type AgentToolContext = {
  conversationId: number;
  conversationPublicId: string;
  customerMasterId: number | null;
  waId: string | null;
  currentTime: string;
  correlationId: string;
  state: AgentConversationState;
};

export type AgentToolResult<TOutput = unknown> = {
  ok: boolean;
  output: TOutput | null;
  warnings: string[];
  error: string | null;
  sourceOfTruth: string;
};

export type AgentToolDefinition<TInput = Record<string, unknown>, TOutput = unknown> = {
  name: string;
  version: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  authorizationLevel: AgentToolAuthorizationLevel;
  sideEffectLevel: AgentToolSideEffectLevel;
  idempotent: boolean;
  timeoutMs: number;
  sourceOfTruth: string;
  errorContract: string[];
  execute: (input: TInput, context: AgentToolContext) => Promise<AgentToolResult<TOutput>>;
};

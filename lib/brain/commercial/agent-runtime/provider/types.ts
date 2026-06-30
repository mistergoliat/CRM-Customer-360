export type AgentProviderToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type AgentProviderMessageRole = "system" | "user" | "assistant" | "tool";

export type AgentProviderMessage = {
  role: AgentProviderMessageRole;
  content: string;
  toolName?: string;
};

export type AgentProviderRequest = {
  messages: AgentProviderMessage[];
  tools: AgentProviderToolSpec[];
  temperature?: number;
};

export type AgentProviderDecision =
  | { type: "tool_call"; toolName: string; input: Record<string, unknown>; thought: string }
  | { type: "respond"; message: string; thought: string; finalize: boolean }
  | { type: "handoff"; reason: string; message: string | null; mode: "exclusive_handoff" | "approval_request" | "internal_consultation" }
  | { type: "malformed"; raw: string; error: string };

export type AgentProviderResult = {
  decision: AgentProviderDecision;
  modelName: string;
  latencyMs: number;
  rawTokensIn: number | null;
  rawTokensOut: number | null;
};

export type AgentProvider = {
  readonly name: string;
  complete(request: AgentProviderRequest): Promise<AgentProviderResult>;
};

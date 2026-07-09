export const BRAIN_TOOL_NAMES = [
  "searchKnowledge",
  "getStaticBusinessInfo",
  "getKnowledgePolicy",
  "getConversationHistory",
  "getActiveCase",
  "searchProducts",
  "getProductStock",
  "getOrderByInvoice",
  "explainAgentDecision",
  "lookupCustomerByEmail",
  "createCustomer",
  "linkCustomerToConversation",
  "getCustomerContext",
  "linkExternalIdentity"
] as const;

export type BrainToolName = (typeof BRAIN_TOOL_NAMES)[number];

export type BrainToolRiskLevel = "low" | "medium" | "high";
export type BrainToolMode = "noop" | "read_only";

export type BrainToolDefinition = {
  name: BrainToolName;
  description: string;
  readOnly: boolean;
  enabled: boolean;
  riskLevel: BrainToolRiskLevel;
  defaultMode: BrainToolMode;
  inputSchema: string;
};

export type BrainToolRequest = {
  toolName: BrainToolName;
  status: "planned" | "blocked" | "noop";
  reason: string;
  blockedReasons: string[];
  input?: Record<string, unknown>;
};

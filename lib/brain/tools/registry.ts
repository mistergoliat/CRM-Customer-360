import type { BrainToolDefinition, BrainToolName } from "./types";

export const BRAIN_TOOL_REGISTRY: Record<BrainToolName, BrainToolDefinition> = {
  searchKnowledge: {
    name: "searchKnowledge",
    description: "Search the internal knowledge base.",
    readOnly: true,
    enabled: true,
    riskLevel: "low",
    defaultMode: "read_only",
    inputSchema: "brain.tool.searchKnowledge.v1"
  },
  getStaticBusinessInfo: {
    name: "getStaticBusinessInfo",
    description: "Return safe static business information only.",
    readOnly: true,
    enabled: true,
    riskLevel: "low",
    defaultMode: "read_only",
    inputSchema: "brain.tool.getStaticBusinessInfo.v1"
  },
  getKnowledgePolicy: {
    name: "getKnowledgePolicy",
    description: "Return the knowledge agent policy and safe answer rules.",
    readOnly: true,
    enabled: true,
    riskLevel: "low",
    defaultMode: "read_only",
    inputSchema: "brain.tool.getKnowledgePolicy.v1"
  },
  getConversationHistory: {
    name: "getConversationHistory",
    description: "Return recent conversation history for context only.",
    readOnly: true,
    enabled: true,
    riskLevel: "low",
    defaultMode: "read_only",
    inputSchema: "brain.tool.getConversationHistory.v1"
  },
  getActiveCase: {
    name: "getActiveCase",
    description: "Read the active case state without mutating it.",
    readOnly: true,
    enabled: true,
    riskLevel: "low",
    defaultMode: "read_only",
    inputSchema: "brain.tool.getActiveCase.v1"
  },
  searchProducts: {
    name: "searchProducts",
    description: "Search the product catalog in read-only mode.",
    readOnly: true,
    enabled: true,
    riskLevel: "low",
    defaultMode: "read_only",
    inputSchema: "brain.tool.searchProducts.v1"
  },
  getProductStock: {
    name: "getProductStock",
    description: "Check product stock in read-only mode.",
    readOnly: true,
    enabled: true,
    riskLevel: "low",
    defaultMode: "read_only",
    inputSchema: "brain.tool.getProductStock.v1"
  },
  getOrderByInvoice: {
    name: "getOrderByInvoice",
    description: "Lookup an order by invoice number in read-only mode.",
    readOnly: true,
    enabled: true,
    riskLevel: "low",
    defaultMode: "read_only",
    inputSchema: "brain.tool.getOrderByInvoice.v1"
  },
  explainAgentDecision: {
    name: "explainAgentDecision",
    description: "Explain the decision path for observability and auditing.",
    readOnly: true,
    enabled: true,
    riskLevel: "low",
    defaultMode: "noop",
    inputSchema: "brain.tool.explainAgentDecision.v1"
  },
  lookupCustomerByEmail: {
    name: "lookupCustomerByEmail",
    description: "Lookup a canonical customer by exact email match.",
    readOnly: true,
    enabled: true,
    riskLevel: "low",
    defaultMode: "read_only",
    inputSchema: "brain.tool.lookupCustomerByEmail.v1"
  },
  createCustomer: {
    name: "createCustomer",
    description: "Create a canonical customer record after explicit confirmation.",
    readOnly: false,
    enabled: true,
    riskLevel: "medium",
    defaultMode: "noop",
    inputSchema: "brain.tool.createCustomer.v1"
  },
  linkCustomerToConversation: {
    name: "linkCustomerToConversation",
    description: "Persist an explicit customer to conversation link.",
    readOnly: false,
    enabled: true,
    riskLevel: "low",
    defaultMode: "noop",
    inputSchema: "brain.tool.linkCustomerToConversation.v1"
  },
  getCustomerContext: {
    name: "getCustomerContext",
    description: "Read customer context for operational onboarding.",
    readOnly: true,
    enabled: true,
    riskLevel: "low",
    defaultMode: "read_only",
    inputSchema: "brain.tool.getCustomerContext.v1"
  }
};

export function getBrainToolDefinition(toolName: BrainToolName) {
  return BRAIN_TOOL_REGISTRY[toolName];
}

export function listBrainToolDefinitions() {
  return Object.values(BRAIN_TOOL_REGISTRY);
}

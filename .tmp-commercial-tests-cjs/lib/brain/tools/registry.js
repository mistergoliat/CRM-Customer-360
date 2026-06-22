"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRAIN_TOOL_REGISTRY = void 0;
exports.getBrainToolDefinition = getBrainToolDefinition;
exports.listBrainToolDefinitions = listBrainToolDefinitions;
exports.BRAIN_TOOL_REGISTRY = {
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
    }
};
function getBrainToolDefinition(toolName) {
    return exports.BRAIN_TOOL_REGISTRY[toolName];
}
function listBrainToolDefinitions() {
    return Object.values(exports.BRAIN_TOOL_REGISTRY);
}

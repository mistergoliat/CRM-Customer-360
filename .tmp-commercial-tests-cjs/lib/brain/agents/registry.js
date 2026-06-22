"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRAIN_AGENT_REGISTRY = void 0;
exports.getBrainAgentDefinition = getBrainAgentDefinition;
exports.listBrainAgentDefinitions = listBrainAgentDefinitions;
exports.isBrainAgentRunnable = isBrainAgentRunnable;
exports.BRAIN_AGENT_REGISTRY = {
    knowledge: {
        name: "knowledge",
        version: "brain.agent.knowledge.v2",
        purpose: "Answer safe knowledge questions without side effects.",
        allowedContextPacks: ["knowledge"],
        allowedTools: ["searchKnowledge", "getStaticBusinessInfo", "getKnowledgePolicy"],
        outputSchema: "brain.agent.output.v1",
        riskLevel: "low",
        defaultMode: "mock",
        enabled: true
    },
    sales: {
        name: "sales",
        version: "brain.agent.sales.v1",
        purpose: "Support commercial follow-up and conversion-oriented replies.",
        allowedContextPacks: ["sales", "knowledge", "campaign"],
        allowedTools: [
            "searchKnowledge",
            "searchProducts",
            "getProductStock",
            "getConversationHistory",
            "getActiveCase",
            "getOrderByInvoice",
            "explainAgentDecision"
        ],
        outputSchema: "brain.agent.output.v1",
        riskLevel: "medium",
        defaultMode: "disabled",
        enabled: false
    },
    sac: {
        name: "sac",
        version: "brain.agent.sac.v1",
        purpose: "Handle support and customer service requests.",
        allowedContextPacks: ["sac", "knowledge"],
        allowedTools: ["searchKnowledge", "getConversationHistory", "getActiveCase", "explainAgentDecision"],
        outputSchema: "brain.agent.output.v1",
        riskLevel: "medium",
        defaultMode: "disabled",
        enabled: false
    },
    postventa: {
        name: "postventa",
        version: "brain.agent.postventa.v1",
        purpose: "Assist with post-sale issues and follow-up.",
        allowedContextPacks: ["postventa", "knowledge"],
        allowedTools: ["searchKnowledge", "getConversationHistory", "getActiveCase", "getOrderByInvoice", "explainAgentDecision"],
        outputSchema: "brain.agent.output.v1",
        riskLevel: "medium",
        defaultMode: "disabled",
        enabled: false
    },
    campaign: {
        name: "campaign",
        version: "brain.agent.campaign.v1",
        purpose: "Support campaign and lifecycle messaging decisions.",
        allowedContextPacks: ["campaign", "knowledge"],
        allowedTools: ["searchKnowledge", "getConversationHistory", "explainAgentDecision"],
        outputSchema: "brain.agent.output.v1",
        riskLevel: "medium",
        defaultMode: "disabled",
        enabled: false
    },
    supervisor: {
        name: "supervisor",
        version: "brain.agent.supervisor.v1",
        purpose: "Aggregate agent routing and supervision decisions.",
        allowedContextPacks: ["sales", "sac", "postventa", "knowledge", "campaign"],
        allowedTools: [
            "searchKnowledge",
            "getConversationHistory",
            "getActiveCase",
            "searchProducts",
            "getProductStock",
            "getOrderByInvoice",
            "explainAgentDecision"
        ],
        outputSchema: "brain.agent.output.v1",
        riskLevel: "high",
        defaultMode: "disabled",
        enabled: false
    }
};
function getBrainAgentDefinition(agentName) {
    return exports.BRAIN_AGENT_REGISTRY[agentName];
}
function listBrainAgentDefinitions() {
    return Object.values(exports.BRAIN_AGENT_REGISTRY);
}
function isBrainAgentRunnable(agentName) {
    const definition = getBrainAgentDefinition(agentName);
    return Boolean(definition?.enabled && definition.defaultMode === "mock");
}

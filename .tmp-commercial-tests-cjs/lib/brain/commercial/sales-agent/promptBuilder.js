"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSalesAgentPromptPackage = buildSalesAgentPromptPackage;
const sanitizeSalesAgentOutput_1 = require("./sanitizeSalesAgentOutput");
const runtimeTypes_1 = require("./runtimeTypes");
function toIsoTimestamp(value) {
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}
function buildCommercialContext(input, requestedMode, runtimeMode, currentTime, allowedCapabilities) {
    const context = {
        currentTime,
        runtimeMode,
        requestedMode,
        timezone: input.timezone,
        channel: input.channel,
        platform: input.platform,
        department: input.department,
        identity: {
            conversationCaseId: input.identity.conversationCaseId,
            waId: input.identity.waId,
            phoneNumberId: input.identity.phoneNumberId,
            email: input.identity.email,
            phone: input.identity.phone,
            idCustomer: input.identity.idCustomer,
            idOrder: input.identity.idOrder,
            invoiceNumber: input.identity.invoiceNumber,
            contactId: input.identity.contactId,
            customerCandidate: input.identity.customerCandidate ?? null
        },
        messages: input.messages,
        caseContext: input.caseContext,
        commercial: {
            commercialIntentLegacy: input.commercial.commercialIntentLegacy,
            orderContext: input.commercial.orderContext,
            productServiceContext: input.commercial.productServiceContext,
            lead: input.commercial.lead ?? undefined,
            opportunity: input.commercial.opportunity ?? undefined
        },
        structuralSignals: [...input.structuralSignals],
        allowedCapabilities: [...allowedCapabilities]
    };
    const sanitized = (0, sanitizeSalesAgentOutput_1.sanitizeSalesAgentOutput)({ commercialContext: context });
    if (sanitized.value && typeof sanitized.value.commercialContext === "object" && sanitized.value.commercialContext !== null && !Array.isArray(sanitized.value.commercialContext)) {
        return sanitized.value.commercialContext;
    }
    return context;
}
function buildPromptText(sections) {
    return [
        "SYSTEM",
        ...sections.systemInstructions,
        "",
        "CONTRACT",
        ...sections.contractInstructions,
        "",
        "SAFETY",
        ...sections.safetyConstraints,
        "",
        "CONTEXT",
        JSON.stringify(sections.commercialContext),
        "",
        "RESPONSE_SCHEMA",
        ...sections.responseSchemaSummary
    ].join("\n");
}
function buildSalesAgentPromptPackage(input) {
    const currentTime = toIsoTimestamp(input.currentTime);
    const requestedMode = input.salesAgentInput.requestedMode;
    const commercialContext = buildCommercialContext(input.salesAgentInput, requestedMode, input.runtimeMode, currentTime, input.allowedCapabilities);
    const systemInstructions = [
        "You are the Sales Agent runtime for PesasChile AI Hub.",
        "Return only a JSON-compatible structure that matches SalesAgentResult.",
        "Do not execute tools, send messages, or mutate Lead or Opportunity.",
        "Do not invent price, stock, delivery, dispatch, or order status.",
        "Do not reveal chain-of-thought.",
        "Produce a short operational rationale only."
    ];
    const contractInstructions = [
        `Contract version: ${input.contractVersion}.`,
        `Prompt version: ${input.promptVersion}.`,
        `Runtime mode: ${input.runtimeMode}.`,
        `Requested mode: ${requestedMode}.`,
        `Allowed capabilities: ${input.allowedCapabilities.length > 0 ? input.allowedCapabilities.join(", ") : "none"}.`,
        "Respect hard blocks and keep actions as proposals only.",
        "Ask for tool requests or human review when evidence is missing."
    ];
    const safetyConstraints = [
        "No credentials, headers, raw webhook payloads, or arbitrary metadata.",
        "No claim of executed actions.",
        "No direct tool execution.",
        "Keep output structured and JSON serializable."
    ];
    const responseSchemaSummary = [
        "SalesAgentResult fields: runId, contractVersion, outcome, analysis, decision, proposedActions, toolRequests, entityProposals, responseProposal, evidence, policyAssessment, warnings, rationale, metadata.",
        "Outcome must remain inside the SalesAgentResult contract.",
        "failed_safe is allowed and must remain non-executing."
    ];
    const messages = [
        {
            role: "system",
            content: [...systemInstructions, "", ...contractInstructions, "", ...safetyConstraints].join("\n")
        },
        {
            role: "user",
            content: buildPromptText({
                systemInstructions,
                contractInstructions,
                safetyConstraints,
                responseSchemaSummary,
                commercialContext
            })
        }
    ];
    return {
        promptVersion: input.promptVersion ?? runtimeTypes_1.SALES_AGENT_PROMPT_VERSION,
        contractVersion: input.contractVersion,
        runtimeMode: input.runtimeMode,
        requestedMode,
        systemInstructions,
        contractInstructions,
        commercialContext,
        responseSchemaSummary,
        safetyConstraints,
        messages,
        promptText: messages.map((message) => `${message.role.toUpperCase()}\n${message.content}`).join("\n\n")
    };
}

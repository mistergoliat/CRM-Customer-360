import type { SalesAgentInput } from "../salesAgentTypes";
import {
  CUSTOMER_READINESS_LEVELS,
  PRODUCT_FIT_ASSESSMENTS,
  QUALIFICATION_STATES,
  SALES_AGENT_ACTION_TYPES,
  SALES_AGENT_APPROVAL_REQUIREMENTS,
  SALES_AGENT_CLAIM_TYPES,
  SALES_AGENT_CONFIDENCE_LEVELS,
  SALES_AGENT_DECISION_TYPES,
  SALES_AGENT_ERROR_CODES,
  SALES_AGENT_EVIDENCE_SOURCES,
  SALES_AGENT_MESSAGE_INTENTS,
  SALES_AGENT_OUTCOMES,
  SALES_AGENT_RISK_LEVELS
} from "../salesAgentConstants";
import { sanitizeSalesAgentOutput } from "./sanitizeSalesAgentOutput";
import {
  SALES_AGENT_PROMPT_VERSION,
  type SalesAgentPromptBuilderInput,
  type SalesAgentPromptMessage,
  type SalesAgentPromptPackage,
  type SalesAgentRuntimeJsonRecord
} from "./runtimeTypes";

function toIsoTimestamp(value: string | Date) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

function buildCommercialContext(input: SalesAgentInput, requestedMode: SalesAgentPromptBuilderInput["salesAgentInput"]["requestedMode"], runtimeMode: SalesAgentPromptBuilderInput["runtimeMode"], currentTime: string, allowedCapabilities: readonly string[]): SalesAgentRuntimeJsonRecord {
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

  const sanitized = sanitizeSalesAgentOutput({ commercialContext: context });
  if (sanitized.value && typeof sanitized.value.commercialContext === "object" && sanitized.value.commercialContext !== null && !Array.isArray(sanitized.value.commercialContext)) {
    return sanitized.value.commercialContext as SalesAgentRuntimeJsonRecord;
  }

  return context as SalesAgentRuntimeJsonRecord;
}

function buildPromptText(sections: {
  systemInstructions: string[];
  contractInstructions: string[];
  safetyConstraints: string[];
  responseSchemaSummary: string[];
  commercialContext: SalesAgentRuntimeJsonRecord;
}) {
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

function enumLine(name: string, values: readonly string[]) {
  return `${name}: ${values.join(" | ")}`;
}

export function buildSalesAgentPromptPackage(input: SalesAgentPromptBuilderInput): SalesAgentPromptPackage {
  const currentTime = toIsoTimestamp(input.currentTime);
  const requestedMode = input.salesAgentInput.requestedMode;
  const expectedRunId = input.expectedRunId?.trim() || "unknown";
  const commercialContext = buildCommercialContext(
    input.salesAgentInput,
    requestedMode,
    input.runtimeMode,
    currentTime,
    input.allowedCapabilities
  );

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
    `runId MUST equal exactly: ${expectedRunId}.`,
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

  const responseTemplate = {
    runId: expectedRunId,
    contractVersion: input.contractVersion,
    outcome: "response_proposed",
    analysis: {
      summary: "Brief commercial analysis.",
      qualificationState: "pending",
      customerReadiness: "developing",
      productFit: "unknown",
      confidence: "medium",
      riskLevel: "low",
      reasonCodes: ["customer_message_present"]
    },
    decision: {
      type: "respond_now",
      reason: "Safe response can be proposed from available context.",
      confidence: "medium",
      riskLevel: "low",
      requiresApproval: "none",
      errorCode: "none",
      reasonCodes: ["customer_message_present"],
      policyTags: ["commercial_reply"]
    },
    shouldRespondNow: true,
    shouldRequestTool: false,
    shouldRequestHuman: false,
    shouldEvaluateFollowUp: false,
    proposedActions: [],
    toolRequests: [],
    entityProposals: [],
    responseProposal: {
      messageIntent: "answer",
      draftText: "Hola, te ayudo. Para recomendarte bien, cuentame tu objetivo principal y presupuesto aproximado.",
      language: "es",
      tone: "friendly",
      questions: ["Cual es tu presupuesto aproximado?", "Que espacio tienes disponible?"],
      claims: [],
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "medium"
    },
    evidence: [
      {
        source: "customer_message",
        summary: "Customer sent a commercial question.",
        verified: true,
        confidence: "high",
        reference: "latest_inbound_message",
        capturedAt: currentTime,
        expiresAt: null
      }
    ],
    policyAssessment: {
      status: "allowed",
      blocked: false,
      reason: "No policy blocker detected in the available context.",
      confidence: "medium",
      riskLevel: "low",
      approvalRequirement: "none",
      errorCode: "none",
      reasonCodes: [],
      policyTags: ["commercial_reply"]
    },
    warnings: [],
    rationale: {
      summary: "Operational rationale only.",
      evidence: ["latest inbound customer message"],
      counterEvidence: [],
      assumptions: [],
      riskFlags: [],
      missingInformation: [],
      policyRulesApplied: []
    },
    metadata: {}
  };

  const responseSchemaSummary = [
    "Return one JSON object only. Do not wrap it in markdown.",
    "Required root fields: runId, contractVersion, outcome, analysis, decision, shouldRespondNow, shouldRequestTool, shouldRequestHuman, shouldEvaluateFollowUp, proposedActions, toolRequests, entityProposals, responseProposal, evidence, policyAssessment, warnings, rationale, metadata.",
    `runId must be exactly ${expectedRunId}. contractVersion must be exactly ${input.contractVersion}.`,
    enumLine("outcome", SALES_AGENT_OUTCOMES),
    enumLine("decision.type", SALES_AGENT_DECISION_TYPES),
    enumLine("decision.riskLevel / analysis.riskLevel / policyAssessment.riskLevel", SALES_AGENT_RISK_LEVELS),
    enumLine("confidence fields", SALES_AGENT_CONFIDENCE_LEVELS),
    enumLine("requiresApproval / approvalRequirement", SALES_AGENT_APPROVAL_REQUIREMENTS),
    enumLine("messageIntent", SALES_AGENT_MESSAGE_INTENTS),
    enumLine("proposedActions[].type", SALES_AGENT_ACTION_TYPES),
    enumLine("claims[].type / blockedClaims[]", SALES_AGENT_CLAIM_TYPES),
    enumLine("evidence[].source", SALES_AGENT_EVIDENCE_SOURCES),
    enumLine("analysis.qualificationState", QUALIFICATION_STATES),
    enumLine("analysis.customerReadiness", CUSTOMER_READINESS_LEVELS),
    enumLine("analysis.productFit", PRODUCT_FIT_ASSESSMENTS),
    enumLine("errorCode", SALES_AGENT_ERROR_CODES),
    "If evidence for price, stock, delivery, dispatch, order status, promotion, or service availability is missing, do not claim it; request a tool or ask a clarifying question.",
    "If responding now, set outcome=response_proposed, decision.type=respond_now, shouldRespondNow=true, responseProposal to a valid object, and proposedActions may stay empty.",
    "If information is missing, use outcome=insufficient_context or response_proposed with messageIntent=clarify and safe questions.",
    "If no safe commercial action exists, use outcome=no_commercial_action, decision.type=no_commercial_action, shouldRespondNow=false, responseProposal=null.",
    "Never use enum values outside the lists above.",
    "Use this exact JSON shape and replace only values that are supported by the context:",
    JSON.stringify(responseTemplate)
  ];

  const messages: SalesAgentPromptMessage[] = [
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
    promptVersion: input.promptVersion ?? SALES_AGENT_PROMPT_VERSION,
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

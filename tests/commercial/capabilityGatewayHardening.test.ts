import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMERCIAL_POLICY_CONTRACT_VERSION,
  COMMERCIAL_POLICY_DEFAULT_FLAGS,
  COMMERCIAL_POLICY_VERSION,
  evaluateCommercialPolicy
} from "../../lib/brain/commercial/policy";
import type { CommercialPolicyInput } from "../../lib/brain/commercial/policy";
import { SALES_AGENT_OUTPUT_CONTRACT_VERSION } from "../../lib/brain/commercial/sales-agent/validationTypes";
import type { SalesAgentResult, SalesAgentToolRequest } from "../../lib/brain/commercial/sales-agent/validationTypes";
import { CAPABILITY_GATEWAY_REGISTRY, resolveCapabilityGovernance } from "../../lib/brain/commercial/capability-gateway/registry";
import { resolveCapabilityNameForSalesAgentTool, resolveSalesAgentToolForCapabilityName } from "../../lib/brain/commercial/capability-gateway/toolAliases";
import { rankCatalogSearchResults, selectBestCatalogMatch } from "../../lib/brain/commercial/native-cycle/rankCatalogSearchResults";
import type { CatalogSearchResultItem } from "../../lib/catalog/types";

const FIXED_TIME = "2026-06-17T12:00:00.000Z";

function makeToolRequest(overrides: Partial<SalesAgentToolRequest> = {}): SalesAgentToolRequest {
  return {
    tool: "searchProducts",
    purpose: "Buscar productos.",
    status: "planned",
    requiredInputs: { query: "jaula" },
    optionalInputs: null,
    urgency: "medium",
    blocking: true,
    reason: "El cliente pidio recomendaciones.",
    expectedEvidence: ["product_tool"],
    fallbackDecision: "respond_now",
    confidence: "high",
    riskLevel: "low",
    ...overrides
  };
}

function makeBaseResult(toolRequests: SalesAgentToolRequest[]): SalesAgentResult {
  return {
    runId: "run-001",
    contractVersion: SALES_AGENT_OUTPUT_CONTRACT_VERSION,
    outcome: "response_proposed",
    analysis: {
      summary: "Consulta comercial segura.",
      qualificationState: "qualified",
      customerReadiness: "ready",
      productFit: "good",
      confidence: "high",
      riskLevel: "low",
      reasonCodes: ["customer_message_present"]
    },
    decision: {
      type: "respond_now",
      reason: "El caso puede responderse.",
      confidence: "high",
      riskLevel: "low",
      requiresApproval: "none",
      errorCode: "none",
      reasonCodes: ["customer_message_present"],
      policyTags: ["commercial_reply"]
    },
    shouldRespondNow: true,
    shouldRequestTool: toolRequests.length > 0,
    shouldRequestHuman: false,
    shouldEvaluateFollowUp: false,
    proposedActions: [],
    toolRequests,
    entityProposals: [],
    responseProposal: {
      messageIntent: "answer",
      draftText: "Dejame revisar el catalogo.",
      language: "es",
      tone: "friendly",
      questions: [],
      claims: [],
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "high"
    },
    evidence: [
      { source: "customer_message", summary: "Mensaje base.", verified: true, confidence: "high", reference: "msg-001", capturedAt: FIXED_TIME, expiresAt: null }
    ],
    policyAssessment: {
      status: "allowed",
      blocked: false,
      reason: "Sin bloqueo.",
      confidence: "high",
      riskLevel: "low",
      approvalRequirement: "none",
      errorCode: "none",
      reasonCodes: [],
      policyTags: ["commercial_reply"]
    },
    warnings: [],
    rationale: {
      summary: "Resumen operacional.",
      evidence: ["Mensaje inbound."],
      counterEvidence: [],
      assumptions: [],
      riskFlags: [],
      missingInformation: [],
      policyRulesApplied: []
    },
    metadata: {}
  };
}

function makePolicyInput(salesAgentResult: SalesAgentResult, overrides: Partial<CommercialPolicyInput> = {}): CommercialPolicyInput {
  return {
    salesAgentResult,
    currentTime: FIXED_TIME,
    contractVersion: COMMERCIAL_POLICY_CONTRACT_VERSION,
    policyVersion: COMMERCIAL_POLICY_VERSION,
    allowedCapabilities: ["searchKnowledge", "searchProducts"],
    commercialContext: { sourceShape: "sales_agent_input", supportedContextShape: true },
    customerContext: null,
    opportunityContext: null,
    followUpContext: null,
    channelContext: {
      channel: "whatsapp",
      available: true,
      outboundAllowed: true,
      manualApprovalRequired: false,
      optOut: false,
      quietHoursActive: false,
      humanOwnerActive: false,
      aiBlocked: false,
      identityConflict: false,
      recentCustomerReply: false,
      recentHumanContact: false
    },
    operatorContext: null,
    featureFlags: {
      ...COMMERCIAL_POLICY_DEFAULT_FLAGS,
      commercialPolicyEnabled: true,
      allowDraftReplies: true,
      allowToolRequests: true,
      allowEntityProposals: true,
      allowFollowUpEvaluation: true,
      allowInternalTasks: true,
      allowQuoteDraftRequests: true,
      allowOperatorReviewRequests: true,
      allowSensitiveClaims: false,
      allowOutboundProposals: true
    },
    metadata: {},
    ...overrides
  };
}

// --- Objective 3: policy derives approval from capability governance, not LLM blocking ---

test("search_products with blocking:true is NOT escalated to operator review - governance says autonomous, read_only", () => {
  const salesAgentResult = makeBaseResult([makeToolRequest({ tool: "searchProducts", blocking: true, status: "planned" })]);
  const result = evaluateCommercialPolicy(makePolicyInput(salesAgentResult));

  assert.equal(result.toolRequestAssessments[0]?.status, "allowed");
  assert.equal(result.toolRequestAssessments[0]?.approvalRequirement, "none");
  assert.equal(result.status, "allowed");
});

test("a tool outside the Capability Gateway still trusts its own blocking flag (legacy behavior preserved)", () => {
  const salesAgentResult = makeBaseResult([makeToolRequest({ tool: "searchKnowledge", blocking: true, status: "planned" })]);
  const result = evaluateCommercialPolicy(makePolicyInput(salesAgentResult));

  assert.equal(result.toolRequestAssessments[0]?.status, "review");
  assert.equal(result.toolRequestAssessments[0]?.approvalRequirement, "operator_review");
  assert.equal(result.status, "requires_review");
});

test("search_products with blocking:false behaves identically to blocking:true - the flag is ignored entirely for governed capabilities", () => {
  const salesAgentResult = makeBaseResult([makeToolRequest({ tool: "searchProducts", blocking: false, status: "planned" })]);
  const result = evaluateCommercialPolicy(makePolicyInput(salesAgentResult));

  assert.equal(result.toolRequestAssessments[0]?.status, "allowed");
  assert.equal(result.toolRequestAssessments[0]?.approvalRequirement, "none");
});

// --- Objective 3: registry metadata ---

test("every registered capability declares sideEffect, authority and riskClass, and both v1 capabilities are read_only/autonomous/low", () => {
  for (const definition of CAPABILITY_GATEWAY_REGISTRY) {
    assert.ok(definition.governance, `${definition.capability} is missing governance metadata`);
    assert.ok(["read_only", "mutating"].includes(definition.governance.sideEffect));
    assert.ok(["autonomous", "requires_approval"].includes(definition.governance.authority));
    assert.ok(["low", "medium", "high"].includes(definition.governance.riskClass));
  }

  assert.deepEqual(resolveCapabilityGovernance("search_products"), { sideEffect: "read_only", authority: "autonomous", riskClass: "low" });
  assert.deepEqual(resolveCapabilityGovernance("get_product_details"), { sideEffect: "read_only", authority: "autonomous", riskClass: "low" });
  assert.equal(resolveCapabilityGovernance("unknown_capability"), null);
});

// --- Objective 4: centralized alias table, no scattered mappings ---

test("the alias table is the single translation point between LLM tool vocabulary and capability names", () => {
  assert.equal(resolveCapabilityNameForSalesAgentTool("searchProducts"), "search_products");
  assert.equal(resolveCapabilityNameForSalesAgentTool("searchKnowledge"), null);
  assert.equal(resolveSalesAgentToolForCapabilityName("search_products"), "searchProducts");
  assert.equal(resolveSalesAgentToolForCapabilityName("get_product_details"), null);
});

// --- Objective 6: deterministic, audited product ranking ---

function item(overrides: Partial<CatalogSearchResultItem>): CatalogSearchResultItem {
  return {
    productId: "1",
    combinationId: "0",
    sku: null,
    name: "Producto",
    variantLabel: null,
    shortDescription: null,
    stockQuantity: null,
    availability: "unknown",
    matchType: "description",
    ...overrides
  };
}

test("ranker prefers exact_sku over exact_name over partial_name over description", () => {
  const items = [
    item({ productId: "1", matchType: "description" }),
    item({ productId: "2", matchType: "exact_sku" }),
    item({ productId: "3", matchType: "partial_name" }),
    item({ productId: "4", matchType: "exact_name" })
  ];
  const { ranked } = rankCatalogSearchResults(items);
  assert.deepEqual(ranked.map((entry) => entry.productId), ["2", "4", "3", "1"]);
});

test("ranker prefers in_stock over unknown over out_of_stock when match quality ties", () => {
  const items = [
    item({ productId: "1", matchType: "exact_name", availability: "out_of_stock" }),
    item({ productId: "2", matchType: "exact_name", availability: "in_stock" }),
    item({ productId: "3", matchType: "exact_name", availability: "unknown" })
  ];
  const { ranked } = rankCatalogSearchResults(items);
  assert.deepEqual(ranked.map((entry) => entry.productId), ["2", "3", "1"]);
});

test("ranker is stable: equal rank keeps the search API's own original order", () => {
  const items = [item({ productId: "a" }), item({ productId: "b" }), item({ productId: "c" })];
  const { ranked } = rankCatalogSearchResults(items);
  assert.deepEqual(ranked.map((entry) => entry.productId), ["a", "b", "c"]);
});

test("selectBestCatalogMatch returns null for an empty result set and an audited reason otherwise", () => {
  assert.equal(selectBestCatalogMatch([]), null);
  const best = selectBestCatalogMatch([item({ productId: "9", matchType: "exact_sku", availability: "in_stock" })]);
  assert.equal(best?.item.productId, "9");
  assert.equal(best?.reason.rule, "catalog-ranker.v1");
  assert.equal(best?.reason.matchType, "exact_sku");
});

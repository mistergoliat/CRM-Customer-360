import assert from "node:assert/strict";
import test from "node:test";
import { deriveCustomerHistoryNeeds } from "@/lib/brain/commercial/customer-profile-context";
import type { CommercialContextSnapshot } from "@/lib/brain/commercial/context/buildNativeCommercialContext";

function buildSnapshot(): CommercialContextSnapshot {
  return {
    contractName: "CommercialContext",
    schemaVersion: "1.0",
    status: "success",
    completeness: "minimal",
    customer: null,
    conversation: null,
    recentMessages: [],
    opportunity: null,
    needProfile: null,
    actions: [],
    signals: {
      hasCustomer: false,
      hasOpportunity: false,
      hasNeedProfile: false,
      hasRecentMessages: false,
      humanOwnerActive: false,
      aiBlocked: false,
      staleContext: false,
      identityConflict: false
    },
    identityConflict: null,
    availableCapabilities: [],
    warnings: [],
    customer360: null,
    customer360State: "not_requested",
    customerSession: null,
    metadata: {
      source: "native_mariadb",
      conversationPublicId: "conv-1",
      currentTime: "2026-08-05T12:00:00.000Z"
    }
  };
}

test("policy derives catalog history needs from pendingCatalogAction and recent catalog context", () => {
  const snapshot = buildSnapshot();
  const needs = deriveCustomerHistoryNeeds({
    snapshot,
    customerMessage: "si",
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "msg-1",
          completedAt: "2026-08-05T12:00:00.000Z",
          sourceTool: "search_products",
          products: [{ position: 1, productId: "501", name: "Kettlebell" }]
        }
      ]
    },
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] }
  });

  assert.ok(needs.includes("CATALOG_RESULT_REQUIRES_HISTORY_CHECK"));
});

test("policy derives product search/recommendation needs from opportunity and need profile signals", () => {
  const snapshot = buildSnapshot();
  snapshot.opportunity = {
    id: 1,
    opportunityKey: "opp-1",
    status: "open",
    stage: "recommendation",
    primaryIntent: "product_recommendation",
    currentSummary: null,
    nextActionType: "offer_bundle",
    nextActionDueAt: null,
    waitingFor: null,
    humanOwnerActive: false,
    aiBlocked: false,
    customerCandidateId: null,
    customerMasterId: null,
    leadId: null,
    conversationCaseId: null,
    waId: null,
    requirements: [],
    missingRequirements: [],
    productInterests: [],
    objections: [],
    signals: ["product_search_active"],
    version: 1,
    lastActivityAt: "2026-08-05T12:00:00.000Z",
    closedAt: null
  };
  snapshot.needProfile = {
    useCase: "home gym",
    customerType: null,
    goals: [],
    requiredFeatures: ["compacto"],
    preferredFeatures: [],
    budgetMin: null,
    budgetMax: 500000,
    availableSpace: null,
    location: null,
    deliveryDeadline: null,
    experienceLevel: null,
    purchaseUrgency: null,
    decisionReadiness: null,
    missingInformation: [],
    lastUpdatedAt: "2026-08-05T12:00:00.000Z"
  };

  const needs = deriveCustomerHistoryNeeds({
    snapshot,
    customerMessage: "busco opciones",
    recentCatalogContext: null,
    pendingCatalogAction: null
  });

  assert.ok(needs.includes("PRODUCT_RECOMMENDATION"));
  assert.ok(needs.includes("PRODUCT_SEARCH"));
  assert.ok(needs.includes("CROSS_SELL"));
});

test("policy stays conservative when no product-oriented runtime signal exists", () => {
  const needs = deriveCustomerHistoryNeeds({
    snapshot: buildSnapshot(),
    customerMessage: "hola",
    recentCatalogContext: null,
    pendingCatalogAction: null
  });

  assert.deepEqual(needs, []);
});

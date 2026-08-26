import assert from "node:assert/strict";
import test from "node:test";
import {
  recommendCatalogProductsCapability,
  getSharedCatalogRecommendationCapability,
  resetCatalogRecommendationCapabilityForTests,
  CAPABILITY_GATEWAY_REGISTRY,
  resolveCapabilityGatewayDefinition
} from "@/lib/brain/commercial/capability-gateway";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";
import { MASTER_CUSTOMER_IDENTITY_UNRESOLVED_REASONS } from "@/lib/brain/commercial/identity/master-customer";
import type { MasterCustomerIdentityResolution } from "@/lib/brain/commercial/identity/master-customer";
import type { CatalogRecommendationCapability, CatalogRecommendationCapabilityInput, CatalogRecommendationCapabilityResult } from "@/lib/brain/commercial/capabilities/catalog-recommendation";
import { SEARCH_PRODUCTS_V2_CLIENT_ERROR_CODES } from "@/lib/catalog/search-products-v2/types";
import type { SearchProductsV2ClientErrorCode } from "@/lib/catalog/search-products-v2/types";
import { AGENT_LOOP_TOOL_POOL, buildToolDescriptions } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";

// CP-R1-T10B8B: unit tests for the Capability Gateway adapter that wires
// CatalogRecommendationCapability (T10B7) behind recommend_catalog_products.
// A fake CatalogRecommendationCapability is injected via the same DI pattern
// as searchProductsCapability(getPort) - no HTTP, no DB.

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function session(overrides: Partial<NativeCustomerSessionExecutionContext> = {}): NativeCustomerSessionExecutionContext {
  return {
    conversationId: "conv-1",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56911112222", normalizedPhone: "56911112222", messageId: "wamid.1", receivedAt: "2026-07-09T12:00:00.000Z" },
    identity: { status: "identification_required", customerId: null, source: "none", localResolutionOutcome: "identification_required", externalResolutionOutcome: "no_match" },
    masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_not_verified" },
    runtimeIdentity: { status: "ANONYMOUS", identityLevel: "LEVEL_0_ANONYMOUS", masterCustomerId: null, prestashopCustomerId: null, verificationRequired: false, requiredEvidence: [], readyToLink: false, conflictCode: null, policyCode: "NO_CHANNEL_EVIDENCE", evidenceRefs: [] },
    onboarding: null,
    contextAccess: "none",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null },
    freshExternalResolutionEvidence: null,
    ...overrides
  };
}

function gatewayContext(overrides: Partial<CapabilityGatewayContext> = {}): CapabilityGatewayContext {
  return { correlationId: "corr-1", ...overrides };
}

function recommendationResponse(overrides: Record<string, unknown> = {}) {
  return {
    customerMode: "generic" as const,
    recommendations: [
      {
        product: { productId: "200", name: "Mancuernas 5kg", active: true, price: { amount: 19990, currency: "CLP" }, stock: { status: "in_stock", available: true } },
        rank: 1,
        score: 0.8,
        commercialScore: 0.8,
        affinityScore: 0.4,
        affinityConfidence: "low",
        ranking: { rank: 1, score: 0.8 },
        relationship: { type: "frequently_bought_together", reliability: 0.6, evidence: { jointCount: 4, support: 0.1, confidence: 0.5, lift: 1.2 } },
        commercialReason: { code: "FREQUENTLY_BOUGHT_TOGETHER", label: "Comprado frecuentemente junto al producto consultado" },
        reasons: [{ code: "STRONG_COMMERCIAL_RELEVANCE", source: "commercial" }],
        warnings: []
      }
    ],
    excluded: [],
    warnings: [],
    personalization: { applied: false, reason: "customer_not_provided" },
    execution: { correlationId: "corr", degraded: false, degradationReasons: [], stages: { commercialRecommendation: "completed", customerAffinity: "skipped", personalization: "completed" } },
    statistics: { commercialCandidates: 1, affinityCandidates: 0, personalizedRecommendations: 0, excludedRecommendations: 0, customerAffinityCalls: 0, personalizationCalls: 0, degradedStages: 0, warningsGenerated: 0 },
    snapshot: { id: "snap-1", modelVersion: "v1" },
    metadata: { explicitRepurchaseApplied: false, excludedProductCount: 0, recommendationCount: 1, degraded: false },
    ...overrides
  };
}

type RecordedCall = CatalogRecommendationCapabilityInput;

/**
 * `next`'s return type is deliberately loose (`Record<string, unknown>`
 * cast to the real result type once, here) - these fixtures only need to
 * exercise the adapter's passthrough/mapping logic, not satisfy T10B5's own
 * full discriminated-union response typing (affinityConfidence, relationship
 * kind, etc.), which is already covered by T10B5/T10B7's own test suites.
 */
function fakeCapability(next: (call: RecordedCall) => Record<string, unknown> | Promise<Record<string, unknown>>) {
  const calls: RecordedCall[] = [];
  const capability: CatalogRecommendationCapability = {
    async execute(input) {
      calls.push(input);
      return (await next(input)) as CatalogRecommendationCapabilityResult;
    }
  };
  return { capability, calls };
}

function definitionWith(capability: CatalogRecommendationCapability) {
  return recommendCatalogProductsCapability(() => capability);
}

// ---------------------------------------------------------------------------
// Input validation - structural, Gateway-level, before T10B7 is ever called
// ---------------------------------------------------------------------------

test("input: valid sourceProduct reaches the capability", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(result.status, "completed");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].sourceProduct, { productId: 100 });
});

test("input: missing sourceProduct is invalid_arguments, capability never called", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const result = await definitionWith(capability).execute({}, gatewayContext());
  assert.equal(result.status, "invalid_arguments");
  assert.equal(result.errorCode, "source_product_required");
  assert.equal(calls.length, 0);
});

test("input: non-numeric productId is invalid_arguments, capability never called", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: "abc" } }, gatewayContext());
  assert.equal(result.status, "invalid_arguments");
  assert.equal(calls.length, 0);
});

test("input: combinationId=0 is accepted and forwarded as-is (T10B6 owns base-product normalization)", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100, combinationId: 0 } }, gatewayContext());
  assert.equal(result.status, "completed");
  assert.deepEqual(calls[0].sourceProduct, { productId: 100, combinationId: 0 });
});

test("input: non-numeric combinationId is invalid_arguments, capability never called", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100, combinationId: "x" } }, gatewayContext());
  assert.equal(result.status, "invalid_arguments");
  assert.equal(calls.length, 0);
});

test("input: optional query is forwarded", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, query: "banca ajustable" }, gatewayContext());
  assert.equal(calls[0].query, "banca ajustable");
});

test("input: wrong-typed query is invalid_arguments, capability never called", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, query: 42 }, gatewayContext());
  assert.equal(result.status, "invalid_arguments");
  assert.equal(calls.length, 0);
});

test("input: excludedProducts is forwarded as explicitExcludedProducts", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  await definitionWith(capability).execute(
    { sourceProduct: { productId: 100 }, excludedProducts: [{ productId: 20 }, { productId: 20, combinationId: 3 }] },
    gatewayContext()
  );
  assert.deepEqual(calls[0].explicitExcludedProducts, [{ productId: 20 }, { productId: 20, combinationId: 3 }]);
});

test("input: a malformed excludedProducts entry is invalid_arguments, capability never called", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const result = await definitionWith(capability).execute(
    { sourceProduct: { productId: 100 }, excludedProducts: [{ productId: 20 }, { productId: "bad" }] },
    gatewayContext()
  );
  assert.equal(result.status, "invalid_arguments");
  assert.equal(calls.length, 0);
});

test("input: excludedProducts must be an array, capability never called", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, excludedProducts: "nope" }, gatewayContext());
  assert.equal(result.status, "invalid_arguments");
  assert.equal(calls.length, 0);
});

test("input: explicitRepurchaseRequested=true is forwarded to T10B7 verbatim (correction: T10B6 now has a top-level channel for it)", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, explicitRepurchaseRequested: true }, gatewayContext());
  assert.equal(result.status, "completed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].explicitRepurchaseRequested, true);
  assert.equal(calls[0].recommendationContext, undefined, "T10B8B never builds a recommendationContext of its own");
});

test("input: explicitRepurchaseRequested=false is forwarded verbatim, never omitted or coerced", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, explicitRepurchaseRequested: false }, gatewayContext());
  assert.equal(calls[0].explicitRepurchaseRequested, false);
});

test("input: explicitRepurchaseRequested omitted by the caller is never sent to T10B7 (no inference, no default true/false injected)", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal("explicitRepurchaseRequested" in calls[0], false);
});

test("input: wrong-typed explicitRepurchaseRequested is invalid_arguments, capability never called", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, explicitRepurchaseRequested: "yes" }, gatewayContext());
  assert.equal(result.status, "invalid_arguments");
  assert.equal(calls.length, 0);
});

test("input: optional limit is forwarded", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, limit: 5 }, gatewayContext());
  assert.equal(calls[0].limit, 5);
});

test("input: wrong-typed limit is invalid_arguments, capability never called", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, limit: "5" }, gatewayContext());
  assert.equal(result.status, "invalid_arguments");
  assert.equal(calls.length, 0);
});

test("input: optional inStockOnly is forwarded", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, inStockOnly: true }, gatewayContext());
  assert.equal(calls[0].inStockOnly, true);
});

test("input: wrong-typed inStockOnly is invalid_arguments, capability never called", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, inStockOnly: "true" }, gatewayContext());
  assert.equal(result.status, "invalid_arguments");
  assert.equal(calls.length, 0);
});

for (const field of ["masterCustomerId", "customerId", "customerMode", "recommendationContext", "correlationId", "signal", "ownership", "purchasedProducts", "apiKey"]) {
  test(`input: caller-supplied "${field}" is rejected as an unsupported field, capability never called`, async () => {
    const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
    const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, [field]: "x" }, gatewayContext());
    assert.equal(result.status, "invalid_arguments");
    assert.equal(result.errorCode, "unsupported_field");
    assert.equal(calls.length, 0);
  });
}

// ---------------------------------------------------------------------------
// Identity - resolved
// ---------------------------------------------------------------------------

test("identity resolved: masterCustomerId is forwarded exactly as resolution.masterCustomerId", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse({ customerMode: "identified" }) }));
  const ctx = gatewayContext({ trustedCustomerSession: session({ masterCustomerIdentity: { status: "resolved", masterCustomerId: "987", source: "native_session_verified_projection" } }) });
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, ctx);
  assert.equal(result.status, "completed");
  assert.equal(calls[0].masterCustomerId, "987");
});

test("identity resolved: identity.customerId is never used as a fallback for masterCustomerId", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const ctx = gatewayContext({
    trustedCustomerSession: session({
      identity: { status: "identified", customerId: "local-999", source: "customer_service", localResolutionOutcome: "identified", externalResolutionOutcome: "match" },
      masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_not_verified" }
    })
  });
  await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, ctx);
  assert.equal(calls[0].masterCustomerId, undefined);
});

// ---------------------------------------------------------------------------
// Identity - unresolved (every reason), session absent
// ---------------------------------------------------------------------------

for (const reason of MASTER_CUSTOMER_IDENTITY_UNRESOLVED_REASONS) {
  test(`identity unresolved (${reason}): masterCustomerId omitted, capability invoked, no blocked/handoff`, async () => {
    const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
    const resolution: MasterCustomerIdentityResolution = { status: "identity_unresolved", reason };
    const ctx = gatewayContext({ trustedCustomerSession: session({ masterCustomerIdentity: resolution }) });
    const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, ctx);
    assert.equal(result.status, "completed");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].masterCustomerId, undefined);
  });
}

test("session absent (undefined): runs generic, no throw, never unavailable", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(result.status, "completed");
  assert.equal(calls[0].masterCustomerId, undefined);
});

test("session explicitly null: runs generic, no throw, never unavailable", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, gatewayContext({ trustedCustomerSession: null }));
  assert.equal(result.status, "completed");
  assert.equal(calls[0].masterCustomerId, undefined);
});

// ---------------------------------------------------------------------------
// Explicit repurchase - preserved in both identified and generic mode
// (CP-R1-T10B8B correction: forwarded via T10B6's new top-level field)
// ---------------------------------------------------------------------------

test("explicit repurchase + identity resolved: masterCustomerId sent, explicitRepurchaseRequested preserved, customerMode identified", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse({ customerMode: "identified", metadata: { explicitRepurchaseApplied: true, excludedProductCount: 0, recommendationCount: 1, degraded: false } }) }));
  const ctx = gatewayContext({ trustedCustomerSession: session({ masterCustomerIdentity: { status: "resolved", masterCustomerId: "555", source: "native_session_verified_projection" } }) });
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, explicitRepurchaseRequested: true }, ctx);
  assert.equal(result.status, "completed");
  assert.equal(calls[0].masterCustomerId, "555");
  assert.equal(calls[0].explicitRepurchaseRequested, true);
  const data = result.data as Record<string, unknown>;
  assert.equal(data.customerMode, "identified");
  assert.equal((data.metadata as Record<string, unknown>).explicitRepurchaseApplied, true);
});

for (const reason of MASTER_CUSTOMER_IDENTITY_UNRESOLVED_REASONS) {
  test(`explicit repurchase + identity unresolved (${reason}): masterCustomerId omitted, explicitRepurchaseRequested preserved, customerMode generic, no bloqueo`, async () => {
    const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse({ metadata: { explicitRepurchaseApplied: true, excludedProductCount: 0, recommendationCount: 1, degraded: false } }) }));
    const ctx = gatewayContext({ trustedCustomerSession: session({ masterCustomerIdentity: { status: "identity_unresolved", reason } }) });
    const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, explicitRepurchaseRequested: true }, ctx);
    assert.equal(result.status, "completed");
    assert.equal(calls[0].masterCustomerId, undefined);
    assert.equal(calls[0].explicitRepurchaseRequested, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.customerMode, "generic");
  });
}

test("explicit repurchase + trustedCustomerSession absent (undefined): runs generic, signal preserved", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse({ metadata: { explicitRepurchaseApplied: true, excludedProductCount: 0, recommendationCount: 1, degraded: false } }) }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, explicitRepurchaseRequested: true }, gatewayContext());
  assert.equal(result.status, "completed");
  assert.equal(calls[0].masterCustomerId, undefined);
  assert.equal(calls[0].explicitRepurchaseRequested, true);
});

test("explicit repurchase + trustedCustomerSession explicitly null: runs generic, signal preserved", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse({ metadata: { explicitRepurchaseApplied: true, excludedProductCount: 0, recommendationCount: 1, degraded: false } }) }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 }, explicitRepurchaseRequested: true }, gatewayContext({ trustedCustomerSession: null }));
  assert.equal(result.status, "completed");
  assert.equal(calls[0].masterCustomerId, undefined);
  assert.equal(calls[0].explicitRepurchaseRequested, true);
});

test("explicit repurchase: sourceProduct is forwarded exactly once, never duplicated alongside the repurchase signal", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  await definitionWith(capability).execute({ sourceProduct: { productId: 100, combinationId: 7 }, explicitRepurchaseRequested: true }, gatewayContext());
  assert.deepEqual(calls[0].sourceProduct, { productId: 100, combinationId: 7 });
  assert.equal(Object.keys(calls[0]).filter((key) => key === "sourceProduct").length, 1);
});

test("explicit repurchase: contradiction inputs (sourceProduct also excluded) are forwarded to T10B7 unchanged - the adapter never pre-empts T10B6's own contradiction check", async () => {
  // Unit-level: proves the adapter plumbs both fields through untouched (no
  // stripping, no silent drop, no reordering) - the actual contradiction ->
  // "skipped: contradictory_product_context" behavior is T10B6's own logic,
  // verified end-to-end with the real capability in the integration suite.
  const { capability, calls } = fakeCapability(() => ({ status: "skipped", reason: "contradictory_product_context" }));
  const result = await definitionWith(capability).execute(
    { sourceProduct: { productId: 100 }, excludedProducts: [{ productId: 100 }], explicitRepurchaseRequested: true },
    gatewayContext()
  );
  assert.deepEqual(calls[0].sourceProduct, { productId: 100 });
  assert.deepEqual(calls[0].explicitExcludedProducts, [{ productId: 100 }]);
  assert.equal(calls[0].explicitRepurchaseRequested, true);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.data, { status: "skipped", reason: "contradictory_product_context" });
});

test("ownership: a previously-purchased product reported by T10B7 never activates explicitRepurchaseApplied when the caller never requested repurchase", async () => {
  const { capability, calls } = fakeCapability(() => ({
    status: "completed",
    ...recommendationResponse({
      recommendations: [
        {
          product: { productId: "200", name: "Mancuernas 5kg", active: true, price: { amount: 19990, currency: "CLP" }, stock: { status: "in_stock", available: true } },
          ownership: { previouslyPurchased: true, exactVariantPreviouslyPurchased: true },
          rank: 1,
          score: 0.8,
          commercialScore: 0.8,
          affinityScore: 0.4,
          affinityConfidence: "low",
          ranking: { rank: 1, score: 0.8 },
          relationship: { type: "frequently_bought_together", reliability: 0.6, evidence: { jointCount: 4, support: 0.1, confidence: 0.5, lift: 1.2 } },
          commercialReason: { code: "FREQUENTLY_BOUGHT_TOGETHER", label: "Comprado frecuentemente junto al producto consultado" },
          reasons: [{ code: "STRONG_COMMERCIAL_RELEVANCE", source: "commercial" }],
          warnings: []
        }
      ],
      metadata: { explicitRepurchaseApplied: false, excludedProductCount: 0, recommendationCount: 1, degraded: false }
    })
  }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal("explicitRepurchaseRequested" in calls[0], false, "the adapter never infers repurchase intent from anything in the response");
  const data = result.data as Record<string, unknown>;
  assert.equal((data.metadata as Record<string, unknown>).explicitRepurchaseApplied, false);
  const recommendations = data.recommendations as Array<Record<string, unknown>>;
  assert.deepEqual(recommendations[0].ownership, { previouslyPurchased: true, exactVariantPreviouslyPurchased: true });
});

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

test("correlation: context.correlationId is forwarded, never accepted from input", async () => {
  const { capability, calls } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, gatewayContext({ correlationId: "corr-xyz" }));
  assert.equal(calls[0].correlationId, "corr-xyz");
});

// ---------------------------------------------------------------------------
// Completed / empty / degraded
// ---------------------------------------------------------------------------

test("completed: recommendations/excluded/warnings/personalization/execution/statistics/snapshot/metadata preserved verbatim", async () => {
  const response = recommendationResponse();
  const { capability } = fakeCapability(() => ({ status: "completed", ...response }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(result.status, "completed");
  const data = result.data as Record<string, unknown>;
  assert.equal(data.status, "completed");
  assert.deepEqual(data.recommendations, response.recommendations);
  assert.deepEqual(data.excluded, response.excluded);
  assert.deepEqual(data.warnings, response.warnings);
  assert.deepEqual(data.personalization, response.personalization);
  assert.deepEqual(data.execution, response.execution);
  assert.deepEqual(data.statistics, response.statistics);
  assert.deepEqual(data.snapshot, response.snapshot);
  assert.deepEqual(data.metadata, response.metadata);
  assert.equal(result.retryable, false);
  assert.equal(result.errorCode, null);
});

test("empty: recommendations=[] stays completed, never an error", async () => {
  const { capability } = fakeCapability(() => ({ status: "completed", ...recommendationResponse({ recommendations: [], metadata: { explicitRepurchaseApplied: false, excludedProductCount: 0, recommendationCount: 0, degraded: false } }) }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(result.status, "completed");
  const data = result.data as Record<string, unknown>;
  assert.deepEqual(data.recommendations, []);
});

test("degraded: execution.degraded=true stays completed, degradationReasons preserved", async () => {
  const { capability } = fakeCapability(() => ({
    status: "completed",
    ...recommendationResponse({
      execution: { correlationId: "corr", degraded: true, degradationReasons: ["CUSTOMER_AFFINITY_RETRYABLE_FAILURE"], stages: { commercialRecommendation: "completed", customerAffinity: "degraded", personalization: "skipped" } },
      metadata: { explicitRepurchaseApplied: false, excludedProductCount: 0, recommendationCount: 1, degraded: true }
    })
  }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(result.status, "completed");
  const data = result.data as Record<string, unknown>;
  assert.equal((data.metadata as Record<string, unknown>).degraded, true);
  assert.deepEqual((data.execution as Record<string, unknown>).degradationReasons, ["CUSTOMER_AFFINITY_RETRYABLE_FAILURE"]);
});

// ---------------------------------------------------------------------------
// Skipped
// ---------------------------------------------------------------------------

const SKIP_REASONS = [
  "source_product_missing",
  "source_product_invalid",
  "source_product_mismatch",
  "invalid_customer_identity",
  "customer_identity_mismatch",
  "contradictory_product_context",
  "invalid_excluded_product",
  "invalid_query",
  "invalid_correlation_id",
  "invalid_limit"
] as const;

for (const reason of SKIP_REASONS) {
  test(`skipped (${reason}): maps to completed with a {status:"skipped", reason} payload, never retryable, never technical`, async () => {
    const { capability } = fakeCapability(() => ({ status: "skipped", reason }));
    const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, gatewayContext());
    assert.equal(result.status, "completed");
    assert.deepEqual(result.data, { status: "skipped", reason });
    assert.equal(result.retryable, false);
    assert.equal(result.errorCode, null);
    assert.deepEqual(result.evidence, []);
  });
}

// ---------------------------------------------------------------------------
// Failed - all T10B5 error codes
// ---------------------------------------------------------------------------

for (const code of SEARCH_PRODUCTS_V2_CLIENT_ERROR_CODES) {
  test(`failed (${code}): maps to failed, preserving code/retryable/httpStatus/providerErrorCode/message`, async () => {
    const retryable = code === "timeout" || code === "network_error" || code === "rate_limited" || code === "catalog_service_error";
    const { capability } = fakeCapability(() => ({
      status: "failed",
      error: { code: code as SearchProductsV2ClientErrorCode, message: `safe message for ${code}`, retryable, httpStatus: code === "catalog_service_error" ? 404 : undefined, providerErrorCode: code === "catalog_service_error" ? "SOURCE_PRODUCT_NOT_FOUND" : undefined }
    }));
    const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, gatewayContext());
    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, code);
    assert.equal(result.retryable, retryable);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.message, `safe message for ${code}`);
    if (code === "catalog_service_error") {
      assert.equal(data.httpStatus, 404);
      assert.equal(data.providerErrorCode, "SOURCE_PRODUCT_NOT_FOUND");
    }
  });
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

test("security: a resolved masterCustomerId never leaks into the outcome (data/errorCode/evidence)", async () => {
  const { capability } = fakeCapability(() => ({ status: "completed", ...recommendationResponse({ customerMode: "identified" }) }));
  const ctx = gatewayContext({ trustedCustomerSession: session({ masterCustomerIdentity: { status: "resolved", masterCustomerId: "SECRET-987", source: "native_session_verified_projection" } }) });
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 100 } }, ctx);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /SECRET-987/);
});

test("security: a failed outcome never includes sourceProduct, query, or excludedProducts", async () => {
  const { capability } = fakeCapability(() => ({ status: "failed", error: { code: "catalog_service_error", message: "safe", retryable: true, httpStatus: 503 } }));
  const result = await definitionWith(capability).execute({ sourceProduct: { productId: 4242 }, query: "unusual-query-marker" }, gatewayContext());
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /4242/);
  assert.doesNotMatch(serialized, /unusual-query-marker/);
});

// ---------------------------------------------------------------------------
// Factory - lazy singleton
// ---------------------------------------------------------------------------

test("factory: getSharedCatalogRecommendationCapability returns the same instance across calls", () => {
  resetCatalogRecommendationCapabilityForTests();
  const a = getSharedCatalogRecommendationCapability();
  const b = getSharedCatalogRecommendationCapability();
  assert.equal(a, b);
  resetCatalogRecommendationCapabilityForTests();
});

test("factory: resetCatalogRecommendationCapabilityForTests forces a new instance", () => {
  resetCatalogRecommendationCapabilityForTests();
  const a = getSharedCatalogRecommendationCapability();
  resetCatalogRecommendationCapabilityForTests();
  const b = getSharedCatalogRecommendationCapability();
  assert.notEqual(a, b);
  resetCatalogRecommendationCapabilityForTests();
});

test("factory: two 'concurrent' initializations (two microtask-deferred calls racing for the first construction) resolve to the same instance", async () => {
  resetCatalogRecommendationCapabilityForTests();
  const [a, b] = await Promise.all([
    Promise.resolve().then(() => getSharedCatalogRecommendationCapability()),
    Promise.resolve().then(() => getSharedCatalogRecommendationCapability())
  ]);
  assert.equal(a, b, "getSharedCatalogRecommendationCapability has no await inside it, so JS's single-threaded model already guarantees no interleaving - this test guards that invariant against a future async refactor");
  resetCatalogRecommendationCapabilityForTests();
});

test("factory: unconfigured production capability is fail-closed (configuration_error), never throws, never a network call", async () => {
  const savedBaseUrl = process.env.CATALOG_SERVICE_BASE_URL;
  const savedApiKey = process.env.CATALOG_SERVICE_API_KEY;
  delete process.env.CATALOG_SERVICE_BASE_URL;
  delete process.env.CATALOG_SERVICE_API_KEY;
  resetCatalogRecommendationCapabilityForTests();
  const capability = getSharedCatalogRecommendationCapability();
  const result = await capability.execute({ sourceProduct: { productId: 100 } });
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.error.code, "configuration_error");
  resetCatalogRecommendationCapabilityForTests();
  if (savedBaseUrl !== undefined) process.env.CATALOG_SERVICE_BASE_URL = savedBaseUrl;
  if (savedApiKey !== undefined) process.env.CATALOG_SERVICE_API_KEY = savedApiKey;
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

test("concurrency: identified and generic calls in parallel never cross-contaminate identity or correlation", async () => {
  const { capability, calls } = fakeCapability(async (input) => {
    if (input.correlationId === "corr-a") await new Promise((resolve) => setTimeout(resolve, 20));
    return { status: "completed", ...recommendationResponse({ customerMode: input.masterCustomerId !== undefined ? "identified" : "generic" }) };
  });
  const def = definitionWith(capability);
  const [resultA, resultB] = await Promise.all([
    def.execute({ sourceProduct: { productId: 1 } }, gatewayContext({ correlationId: "corr-a", trustedCustomerSession: session({ masterCustomerIdentity: { status: "resolved", masterCustomerId: "111", source: "native_session_verified_projection" } }) })),
    def.execute({ sourceProduct: { productId: 2 } }, gatewayContext({ correlationId: "corr-b" }))
  ]);
  assert.equal(resultA.status, "completed");
  assert.equal(resultB.status, "completed");
  assert.equal(calls.length, 2);
  const callA = calls.find((c) => c.correlationId === "corr-a");
  const callB = calls.find((c) => c.correlationId === "corr-b");
  assert.equal(callA?.masterCustomerId, "111");
  assert.deepEqual(callA?.sourceProduct, { productId: 1 });
  assert.equal(callB?.masterCustomerId, undefined);
  assert.deepEqual(callB?.sourceProduct, { productId: 2 });
});

// ---------------------------------------------------------------------------
// Governance / retries
// ---------------------------------------------------------------------------

test("governance: maxRetries is 0 and sideEffect/authority/riskClass match the read-only catalog capability precedent", () => {
  const { capability } = fakeCapability(() => ({ status: "completed", ...recommendationResponse() }));
  const definition = definitionWith(capability);
  assert.equal(definition.maxRetries, 0);
  assert.deepEqual(definition.governance, { sideEffect: "read_only", authority: "autonomous", riskClass: "low" });
});

// ---------------------------------------------------------------------------
// Registry / Agent Loop visibility
// ---------------------------------------------------------------------------

test("registry: recommend_catalog_products is registered in the Capability Gateway", () => {
  const names = CAPABILITY_GATEWAY_REGISTRY.map((d) => d.capability);
  assert.ok(names.includes("recommend_catalog_products"));
  assert.ok(resolveCapabilityGatewayDefinition("recommend_catalog_products"));
});

test("Agent Loop visibility (CP-R1-T10B8C): recommend_catalog_products is now in AGENT_LOOP_TOOL_POOL", () => {
  assert.equal((AGENT_LOOP_TOOL_POOL as readonly string[]).includes("recommend_catalog_products"), true);
});

test("registry: recommend_catalog_products carries a real inputSchema (strict, sourceProduct required) for agent-facing use", () => {
  const definition = resolveCapabilityGatewayDefinition("recommend_catalog_products");
  assert.ok(definition?.inputSchema);
  assert.equal((definition!.inputSchema as Record<string, unknown>).additionalProperties, false);
  assert.deepEqual((definition!.inputSchema as Record<string, unknown>).required, ["sourceProduct"]);
});

test("Agent Loop visibility (CP-R1-T10B8C): buildToolDescriptions() now includes recommend_catalog_products with its real inputSchema", () => {
  const descriptions = buildToolDescriptions();
  const description = descriptions.find((d) => d.name === "recommend_catalog_products");
  assert.ok(description, "recommend_catalog_products must be exposed to the Agent Tool Loop as of CP-R1-T10B8C");
  assert.equal(description!.inputSchema, resolveCapabilityGatewayDefinition("recommend_catalog_products")!.inputSchema);
});

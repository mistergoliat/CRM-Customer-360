import assert from "node:assert/strict";
import test from "node:test";
import { buildCommercialWorkFinalizerMessage } from "@/lib/brain/commercial/work/buildCommercialWorkFinalizerMessage";
import { buildCommercialWorkProjection, type CommercialCapabilityExecutionProjection, type CommercialObjectiveSeed, type CommercialWorkProjectionInput } from "@/lib/brain/commercial/work";
import type { PersistedCommercialWork } from "@/lib/brain/commercial/work/persistenceTypes";

const NOW = "2026-08-24T12:00:00.000Z";

/**
 * SALES-AGENT-R2-A11.2-C, CATC07. buildCommercialWorkFinalizerMessage only
 * reads work.status/objectives/steps - the extra persistence-only fields
 * below are never read by it, filled with fixed placeholders so this stays
 * a PersistedCommercialWork without depending on real persistence.
 */
function persisted(overrides: Partial<CommercialWorkProjectionInput> = {}): PersistedCommercialWork {
  const work = buildCommercialWorkProjection({
    trigger: { type: "CUSTOMER_MESSAGE", conversationId: 1, opportunityId: 10, sourceMessageId: 100 },
    conversation: { id: 1, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: 10 },
    now: NOW,
    ...overrides
  });
  return { ...work, publicId: "work-1", correlationKey: "corr-1", version: 1, createdAt: NOW, updatedAt: NOW, completedAt: null, cancelledAt: null, cancelReason: null };
}

function objectiveSeed(type: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["type"], inputs: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["inputs"] = {}): CommercialObjectiveSeed {
  return { type, origin: "customer_requested", inputs };
}

function searchProductsExecution(items: Array<{ productId: string; name: string; price?: { amount: number; currency: string } | null }>): CommercialCapabilityExecutionProjection {
  const candidates = items.map((item, index) => ({
    product: { productId: item.productId, name: item.name, price: item.price ?? null, stock: { status: "unknown", available: true } },
    match: { rank: index + 1, score: 0.8, reasons: ["NAME_TOKEN_MATCH"] }
  }));
  return {
    publicId: "search-exec-1",
    capabilityName: "search_products",
    executionStatus: "completed",
    retryable: false,
    errorCode: null,
    completedAt: NOW,
    requestSummaryJson: { query: "disco olimpico 20kg", limit: 5 },
    responseSummaryJson: {
      query: "disco olimpico 20kg",
      items: candidates.map((c) => ({ productId: c.product.productId, combinationId: "0", name: c.product.name })),
      productIntent: {
        query: { original: "disco olimpico 20kg", normalized: "disco olimpico 20kg" },
        resolution: { status: "clarification_required", confidence: 0.5 },
        candidates,
        clarification: { dimension: "brand", options: [] },
        statistics: { retrieved: items.length, eligible: items.length, returned: items.length },
        warnings: []
      }
    }
  };
}

// CATC07
test("CATC07 (A11.2-C) clarification with 3 real T12 candidates: finalizer lists them with real price, invents nothing", () => {
  const work = persisted({
    objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { productReference: "disco olimpico 20kg", quantity: 1 })],
    recentCapabilityExecutions: [
      searchProductsExecution([
        { productId: "40", name: "Disco Olimpico Bumper 20kg", price: { amount: 39990, currency: "CLP" } },
        { productId: "41", name: "Disco Olimpico Fundido 20kg", price: { amount: 24990, currency: "CLP" } },
        { productId: "42", name: "Disco Olimpico Grip 20kg", price: null }
      ])
    ]
  });

  const result = buildCommercialWorkFinalizerMessage(work);
  assert.equal(result.disposition, "BLOCKED");
  assert.match(result.message, /Disco Olimpico Bumper 20kg - \$39990/);
  assert.match(result.message, /Disco Olimpico Fundido 20kg - \$24990/);
  // The third candidate has no price (T12 could not resolve one) - never invented.
  assert.match(result.message, /Disco Olimpico Grip 20kg/);
  assert.doesNotMatch(result.message.split("Disco Olimpico Grip 20kg")[1] ?? "", /^\s*-\s*\$/);
});

test("PRODUCT_AMBIGUOUS with no candidates falls back to the generic clarification question, never invents names", () => {
  const work = persisted({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { productReference: "algo raro", quantity: 1 })] });
  // Force PRODUCT_AMBIGUOUS with an empty candidate list directly, bypassing
  // the projection (there is no code path that produces this combination
  // today) purely to verify the fallback branch itself.
  const objective = work.objectives.find((item) => item.type === "SELECT_PRODUCTS")!;
  objective.status = "WAITING_CUSTOMER";
  objective.missingRequirements = ["PRODUCT_AMBIGUOUS"];
  const result = buildCommercialWorkFinalizerMessage(work);
  assert.match(result.message, /más detalle/);
});

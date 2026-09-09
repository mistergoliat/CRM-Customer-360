// SALES-AGENT-R3-V1.8.2-B1 (Evidence Fingerprint Hardening). Direct,
// fast, pure-function unit tests for openTurnProgress.ts - no HTTP mock,
// no DB, no scripted provider. tests/agent-loop/openTurnExecution.test.ts
// keeps the full-loop integration coverage; this file is the first direct
// unit coverage for this module's own exported functions.

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvidenceFingerprint,
  buildEvidenceFingerprintPayload,
  createOpenTurnProgressState,
  recordToolExecution,
  isNoProgressGuardTriggered
} from "@/lib/brain/commercial/agent-loop/openTurnProgress";
import type { ToolObservation } from "@/lib/brain/commercial/agent-loop/agentStepTypes";

function completedWithItems(ids: Array<string | number>): ToolObservation {
  return { tool: "search_products", status: "completed", data: { items: ids.map((id) => ({ productId: id, name: "irrelevant", price: 999, stockQuantity: 5 })) } };
}

function completedZeroResults(): ToolObservation {
  return { tool: "search_products", status: "completed", data: { items: [] } };
}

// ---- 1. same IDs different order => same fingerprint ----
test("1 - same relevant ids in a different order produce the same fingerprint", () => {
  const a = buildEvidenceFingerprint("search_products", completedWithItems([31, 415, 983]));
  const b = buildEvidenceFingerprint("search_products", completedWithItems([983, 31, 415]));
  assert.equal(a, b);
});

// ---- 2. duplicate IDs => same canonical fingerprint ----
test("2 - a duplicated id within one response canonicalizes to the same fingerprint as the deduplicated list", () => {
  const withDuplicate = buildEvidenceFingerprint("search_products", completedWithItems([501, 502, 501]));
  const withoutDuplicate = buildEvidenceFingerprint("search_products", completedWithItems([501, 502]));
  assert.equal(withDuplicate, withoutDuplicate);
});

// ---- 3. same cardinality but different IDs => different fingerprint ----
test("3 - two result sets of equal cardinality but different entities fingerprint differently (the search A/B motivating case)", () => {
  const searchA = buildEvidenceFingerprint("search_products", completedWithItems([31, 415, 983]));
  const searchB = buildEvidenceFingerprint("search_products", completedWithItems([603, 604, 605]));
  assert.notEqual(searchA, searchB);
});

// ---- 4. repeated zero-result search => same fingerprint ----
test("4 - repeated zero-result searches (no ids exist) still fingerprint identically", () => {
  const first = buildEvidenceFingerprint("search_products", completedZeroResults());
  const second = buildEvidenceFingerprint("search_products", completedZeroResults());
  assert.equal(first, second);
  const payload = buildEvidenceFingerprintPayload("search_products", completedZeroResults());
  assert.deepEqual(payload, { tool: "search_products", status: "completed", resultClass: "no_match", cardinality: 0, relevantIds: [] });
});

// ---- 5. materially different recovery result resets no-progress ----
test("5 - a materially different recovery result (different ids, same cardinality) resets the no-progress streak", () => {
  const progress = createOpenTurnProgressState();
  const deadEnd = { tool: "search_products", toolClass: "read" as const, observation: completedWithItems([31, 415, 983]), executed: true };
  recordToolExecution(progress, deadEnd);
  recordToolExecution(progress, deadEnd);
  recordToolExecution(progress, deadEnd);
  assert.equal(progress.consecutiveNoProgressSteps, 2);
  assert.equal(isNoProgressGuardTriggered(progress, 4), false);

  // A materially different recovery attempt (different entities, same cardinality=3) must reset the streak, not just fail to increment it.
  const recovery = { tool: "search_products", toolClass: "read" as const, observation: completedWithItems([603, 604, 605]), executed: true };
  recordToolExecution(progress, recovery);
  assert.equal(progress.consecutiveNoProgressSteps, 0);
  assert.equal(isNoProgressGuardTriggered(progress, 4), false);
});

// ---- 6. volatile fields (price/stock/name/timestamps) never affect the fingerprint ----
test("6 - volatile text/price/timestamp/name changes never affect the fingerprint", () => {
  const observationA: ToolObservation = {
    tool: "get_product_details",
    status: "completed",
    data: { productId: "501", name: "Mancuerna 10kg", price: { amount: 20000, currency: "CLP" }, stockQuantity: 4, retrievedAt: "2026-09-09T15:00:00.000Z" }
  };
  const observationB: ToolObservation = {
    tool: "get_product_details",
    status: "completed",
    data: { productId: "501", name: "Mancuerna 10kg (oferta)", price: { amount: 17990, currency: "CLP" }, stockQuantity: 47171, retrievedAt: "2026-09-09T15:03:22.981Z" }
  };
  assert.equal(buildEvidenceFingerprint("get_product_details", observationA), buildEvidenceFingerprint("get_product_details", observationB));
});

// ---- Additional coverage: the same underlying entities via list-shaped fields other than "items" ----
test("7 - relevant ids are recognized generically across every known list-shaped field name", () => {
  const products = buildEvidenceFingerprint("explore_catalog", { tool: "explore_catalog", status: "completed", data: { products: [{ productId: "701" }, { productId: "702" }] } });
  const recommendations = buildEvidenceFingerprint("recommend_catalog_products", { tool: "recommend_catalog_products", status: "completed", data: { recommendations: [{ productId: "701" }, { productId: "702" }] } });
  // Different tools with the same entity set are still distinguished by `tool` in the payload - only the id-extraction mechanism is shared/generic.
  assert.notEqual(products, recommendations);
  const productsPayload = buildEvidenceFingerprintPayload("explore_catalog", { tool: "explore_catalog", status: "completed", data: { products: [{ productId: "701" }, { productId: "702" }] } });
  assert.deepEqual(productsPayload.relevantIds, ["701", "702"]);
});

// ---- Additional coverage: no recognizable ids falls back to the original resultClass+cardinality behavior ----
test("8 - a tool payload shape with no recognizable id fields falls back to shape-based cardinality", () => {
  const observation: ToolObservation = { tool: "calculate_shipping", status: "completed", data: { options: [{ carrier: "A", totalCost: 1000 }, { carrier: "B", totalCost: 2000 }] } };
  const payload = buildEvidenceFingerprintPayload("calculate_shipping", observation);
  assert.deepEqual(payload, { tool: "calculate_shipping", status: "completed", resultClass: "has_results", cardinality: 2, relevantIds: [] });
});

// ---- Additional coverage: a non-completed observation never extracts ids, unaffected by this hardening ----
test("9 - a blocked observation's fingerprint is unaffected by hardening (no ids ever extracted)", () => {
  const blocked: ToolObservation = { tool: "search_products", status: "blocked", errorCode: "duplicate_tool_call" };
  const payload = buildEvidenceFingerprintPayload("search_products", blocked);
  assert.deepEqual(payload, { tool: "search_products", status: "blocked", resultClass: "duplicate_tool_call", cardinality: 0, relevantIds: [] });
});

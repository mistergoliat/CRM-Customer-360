import assert from "node:assert/strict";
import test from "node:test";
import { lookupCapabilityEligibility } from "@/lib/brain/commercial/capability-eligibility/lookupCapabilityEligibility";
import type { CapabilityEligibilitySnapshot } from "@/lib/brain/commercial/capability-eligibility/types";

// SALES-AGENT-R3-P7.2. Pure unit tests for lookupCapabilityEligibility - no
// DB, no HTTP, no LLM. Its only input is a CapabilityEligibilitySnapshot
// already computed elsewhere (P6.3's own preCognitionCapabilityEligibility),
// so every case here is deterministic and instant.

const SNAPSHOT: CapabilityEligibilitySnapshot = {
  schemaVersion: "1",
  workId: "cw-1",
  workVersion: 3,
  objectiveId: "obj-1",
  objectiveType: "QUOTE",
  evaluatedAt: "2026-09-17T00:00:00.000Z",
  eligible: [{ capability: "calculate_shipping", status: "ELIGIBLE", reasonCodes: [], executionClass: "read_only" }],
  blocked: [{ capability: "create_quote", status: "BLOCKED", reasonCodes: ["MISSING_SELECTION"], executionClass: "mutating" }],
  metadataVersion: "p6.2-a.1"
};

test("P7.2: an eligible capability resolves to ELIGIBLE with empty reason codes", () => {
  const result = lookupCapabilityEligibility(SNAPSHOT, "calculate_shipping");
  assert.deepEqual(result, { status: "ELIGIBLE", reasonCodes: [], metadataVersion: "p6.2-a.1" });
});

test("P7.2: a blocked capability resolves to BLOCKED with its real reason codes", () => {
  const result = lookupCapabilityEligibility(SNAPSHOT, "create_quote");
  assert.deepEqual(result, { status: "BLOCKED", reasonCodes: ["MISSING_SELECTION"], metadataVersion: "p6.2-a.1" });
});

test("P7.2-E: a capability absent from both lists returns null - never a fabricated ELIGIBLE/BLOCKED guess", () => {
  assert.equal(lookupCapabilityEligibility(SNAPSHOT, "search_products"), null);
});

test("P7.2-E: a null snapshot (no eligibility this turn) returns null", () => {
  assert.equal(lookupCapabilityEligibility(null, "create_quote"), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";
import {
  CAPABILITY_ELIGIBILITY_DEFINITIONS,
  evaluateCapabilityEligibility,
  runCapabilityEligibilityShadow
} from "@/lib/brain/commercial/capability-eligibility";
import { buildCapabilityEligibilityShadowFeatureFlags } from "@/lib/brain/commercial/config/commercialCycleConfig";
import type { CommercialDomainReadModel } from "@/lib/brain/commercial/domain-read-model";
import { makeCommercialFreshness } from "@/lib/brain/commercial/domain-read-model";
import { normalizeCommercialCapabilityEligibilityEvaluatedEvent } from "@/lib/brain/commercial/events/normalize";

type FreshnessState = "CURRENT" | "STALE" | "SUPERSEDED" | "HISTORICAL" | "UNKNOWN";

function freshness(state: FreshnessState) {
  return makeCommercialFreshness({ state, source: "test" });
}

function buildReadModel(input: {
  objectiveType?: "SELECT_PRODUCTS" | "QUOTE" | null;
  selection?: "missing" | FreshnessState;
  destination?: "missing" | FreshnessState;
} = {}): CommercialDomainReadModel {
  const objectiveType = input.objectiveType ?? null;
  const selection = input.selection ?? "CURRENT";
  const destination = input.destination ?? "CURRENT";
  return {
    case: {
      caseId: "case-1",
      conversationId: 1,
      opportunityId: 1,
      workId: "cw-1",
      workVersion: 7,
      status: "ACTIVE",
      blockers: [],
      freshness: freshness("CURRENT")
    },
    objective: objectiveType
      ? { objectiveId: "cwo-1", type: objectiveType, status: "PENDING", missingRequirements: [], blockers: [], freshness: freshness("CURRENT") }
      : null,
    cart: {
      factId: selection === "missing" ? null : "fact-selection-1",
      updatedAt: selection === "missing" ? null : "2026-09-16T00:00:00.000Z",
      items: selection === "missing" ? [] : [{ productId: "product-1", combinationId: null, quantity: 1, product: null, freshness: freshness(selection) }],
      freshness: freshness(selection === "missing" ? "CURRENT" : selection)
    },
    destination:
      destination === "missing"
        ? null
        : { factId: "fact-destination-1", communeId: 1, canonicalName: "Santiago", updatedAt: "2026-09-16T00:00:00.000Z", freshness: freshness(destination) },
    shipping: {
      state: "MISSING",
      selection: null,
      calculation: null,
      freshness: freshness("CURRENT")
    },
    quote: null,
    customer: { status: "unknown", identityLevel: null, hasResolvedCustomer: false, verificationRequired: false, profile: null },
    conversation: { conversationId: 1, sessionVersion: null },
    evidence: []
  };
}

function entry(snapshot: ReturnType<typeof evaluateCapabilityEligibility>, capability: string) {
  return [...snapshot.eligible, ...snapshot.blocked].find((candidate) => candidate.capability === capability);
}

function evaluate(domainReadModel: CommercialDomainReadModel) {
  return evaluateCapabilityEligibility({ domainReadModel, evaluatedAt: "2026-09-16T00:00:00.000Z" });
}

test("P6-A1/A2: no objective blocks structural actions while context-free catalog reads remain eligible", () => {
  const snapshot = evaluate(buildReadModel({ objectiveType: null }));
  assert.deepEqual(entry(snapshot, "select_products")?.reasonCodes, ["OBJECTIVE_REQUIRED"]);
  assert.deepEqual(entry(snapshot, "set_shipping_destination")?.reasonCodes, ["OBJECTIVE_REQUIRED"]);
  assert.deepEqual(entry(snapshot, "calculate_shipping")?.reasonCodes, ["OBJECTIVE_REQUIRED"]);
  assert.equal(entry(snapshot, "search_products")?.status, "ELIGIBLE");
  assert.equal(entry(snapshot, "search_products_by_semantics")?.status, "ELIGIBLE");
  assert.equal(entry(snapshot, "explore_catalog")?.status, "ELIGIBLE");
  assert.equal(entry(snapshot, "get_product_details")?.status, "ELIGIBLE");
  assert.equal(entry(snapshot, "recommend_catalog_products")?.status, "ELIGIBLE");
});

test("P6-A3/A4/A5: SELECT_PRODUCTS keeps catalog discovery and selection, but blocks quote preparation", () => {
  const snapshot = evaluate(buildReadModel({ objectiveType: "SELECT_PRODUCTS" }));
  assert.equal(entry(snapshot, "search_products")?.status, "ELIGIBLE");
  assert.equal(entry(snapshot, "select_products")?.status, "ELIGIBLE");
  assert.deepEqual(entry(snapshot, "set_shipping_destination")?.reasonCodes, ["OBJECTIVE_INCOMPATIBLE"]);
  assert.deepEqual(entry(snapshot, "calculate_shipping")?.reasonCodes, ["OBJECTIVE_INCOMPATIBLE"]);
});

test("P6-A6: QUOTE with current selection and destination makes calculate_shipping structurally eligible", () => {
  const snapshot = evaluate(buildReadModel({ objectiveType: "QUOTE" }));
  assert.equal(entry(snapshot, "calculate_shipping")?.status, "ELIGIBLE");
  assert.equal(entry(snapshot, "set_shipping_destination")?.status, "ELIGIBLE");
  assert.equal(entry(snapshot, "search_products")?.status, "ELIGIBLE");
});

test("P6 structural shadow uses same-turn CommercialWork objective without rebuilding or mutating the DRM", () => {
  const readModel = buildReadModel({ objectiveType: "SELECT_PRODUCTS" });
  const before = structuredClone(readModel);
  const work = {
    publicId: "cw-current",
    version: 8,
    objectives: [{ objectiveId: "cwo-current", type: "QUOTE", status: "PENDING" }]
  } as never;
  const workBefore = structuredClone(work);
  const snapshot = evaluateCapabilityEligibility({ domainReadModel: readModel, work, evaluatedAt: "2026-09-16T00:00:00.000Z" });
  assert.equal(snapshot.workId, "cw-current");
  assert.equal(snapshot.workVersion, 8);
  assert.equal(snapshot.objectiveType, "QUOTE");
  assert.equal(entry(snapshot, "calculate_shipping")?.status, "ELIGIBLE");
  assert.deepEqual(readModel, before);
  assert.deepEqual(work, workBefore);
});

test("P6-A7/A8: missing selection or destination blocks shipping with stable codes", () => {
  assert.deepEqual(entry(evaluate(buildReadModel({ objectiveType: "QUOTE", selection: "missing" })), "calculate_shipping")?.reasonCodes, ["MISSING_SELECTION"]);
  assert.deepEqual(entry(evaluate(buildReadModel({ objectiveType: "QUOTE", destination: "missing" })), "calculate_shipping")?.reasonCodes, ["MISSING_DESTINATION"]);
});

test("P6-A9/A10/A11: stale, superseded and unknown prerequisites fail closed", () => {
  assert.deepEqual(entry(evaluate(buildReadModel({ objectiveType: "QUOTE", selection: "STALE" })), "calculate_shipping")?.reasonCodes, ["SELECTION_NOT_CURRENT"]);
  assert.deepEqual(entry(evaluate(buildReadModel({ objectiveType: "QUOTE", destination: "STALE" })), "calculate_shipping")?.reasonCodes, ["DESTINATION_NOT_CURRENT"]);
  assert.deepEqual(entry(evaluate(buildReadModel({ objectiveType: "QUOTE", selection: "SUPERSEDED" })), "calculate_shipping")?.reasonCodes, ["SELECTION_NOT_CURRENT"]);
  assert.deepEqual(entry(evaluate(buildReadModel({ objectiveType: "QUOTE", destination: "UNKNOWN" })), "calculate_shipping")?.reasonCodes, ["DESTINATION_NOT_CURRENT"]);
});

test("P6-A12/A13/A14: evaluator is synchronous, leaves its read model untouched and has no execution dependency", () => {
  const readModel = buildReadModel({ objectiveType: "QUOTE" });
  const before = structuredClone(readModel);
  const snapshot = evaluate(readModel);
  assert.deepEqual(readModel, before);
  assert.equal(snapshot.metadataVersion, "p6.2-a.1");
  const source = readFileSync(new URL("../../lib/brain/commercial/capability-eligibility/evaluateCapabilityEligibility.ts", import.meta.url), "utf8");
  assert.ok(!source.includes("executeGovernedCapability"));
  assert.ok(!source.includes(".execute("));
  assert.ok(!source.includes("await "));
});

test("P6-A15/A16: flag-off shadow is inert and flag-on emits exactly one bounded snapshot", async () => {
  const readModel = buildReadModel({ objectiveType: "QUOTE" });
  let recordings = 0;
  const off = await runCapabilityEligibilityShadow({
    enabled: false,
    domainReadModel: readModel,
    evaluatedAt: "2026-09-16T00:00:00.000Z",
    record: async () => { recordings += 1; }
  });
  assert.equal(off, null);
  assert.equal(recordings, 0);

  const on = await runCapabilityEligibilityShadow({
    enabled: true,
    domainReadModel: readModel,
    evaluatedAt: "2026-09-16T00:00:00.000Z",
    record: async (snapshot) => {
      recordings += 1;
      assert.deepEqual(Object.keys(snapshot).sort(), ["blocked", "eligible", "evaluatedAt", "metadataVersion", "objectiveId", "objectiveType", "schemaVersion", "workId", "workVersion"]);
    }
  });
  assert.ok(on);
  assert.equal(recordings, 1);
});

test("P6-A15: feature flag is fail-closed by default and has no dependency on tool routing", () => {
  const previous = process.env.BRAIN_R3_CAPABILITY_ELIGIBILITY_SHADOW_ENABLED;
  try {
    delete process.env.BRAIN_R3_CAPABILITY_ELIGIBILITY_SHADOW_ENABLED;
    assert.equal(buildCapabilityEligibilityShadowFeatureFlags().capabilityEligibilityShadowEnabled, false);
    process.env.BRAIN_R3_CAPABILITY_ELIGIBILITY_SHADOW_ENABLED = "true";
    assert.equal(buildCapabilityEligibilityShadowFeatureFlags().capabilityEligibilityShadowEnabled, true);
  } finally {
    if (previous === undefined) delete process.env.BRAIN_R3_CAPABILITY_ELIGIBILITY_SHADOW_ENABLED;
    else process.env.BRAIN_R3_CAPABILITY_ELIGIBILITY_SHADOW_ENABLED = previous;
  }
});

test("P6 telemetry normalizes a PII-safe bounded shadow payload", () => {
  const event = normalizeCommercialCapabilityEligibilityEvaluatedEvent({
    inboundMessageId: "inbound-1",
    correlationId: "corr-1",
    conversationId: 1,
    opportunityId: 1,
    payload: {
      schemaVersion: "1",
      workId: "cw-1",
      workVersion: 7,
      objectiveType: "QUOTE",
      eligibleCapabilityNames: ["calculate_shipping"],
      blockedCapabilities: [{ capability: "select_products", reasonCodes: ["OBJECTIVE_INCOMPATIBLE"] }],
      metadataVersion: "p6.2-a.1"
    }
  });
  assert.equal(event.eventType, "commercial_capability_eligibility_evaluated");
  assert.equal(event.customerId, null);
  assert.deepEqual(event.payload, {
    schemaVersion: "1",
    workId: "cw-1",
    workVersion: 7,
    objectiveType: "QUOTE",
    eligibleCapabilityNames: ["calculate_shipping"],
    blockedCapabilities: [{ capability: "select_products", reasonCodes: ["OBJECTIVE_INCOMPATIBLE"] }],
    metadataVersion: "p6.2-a.1"
  });
});

test("P6-A17/A18: execution class comes from Gateway governance and never asserts runtime availability", () => {
  const snapshot = evaluate(buildReadModel({ objectiveType: "QUOTE" }));
  for (const definition of CAPABILITY_ELIGIBILITY_DEFINITIONS) {
    const gateway = resolveCapabilityGatewayDefinition(definition.capability);
    assert.ok(gateway);
    assert.equal(entry(snapshot, definition.capability)?.executionClass, gateway?.governance.sideEffect);
  }
  assert.equal("runtimeAvailability" in snapshot, false);
});

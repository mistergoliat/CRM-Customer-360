import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";
import {
  CAPABILITY_ELIGIBILITY_DEFINITIONS,
  evaluateCapabilityEligibility,
  runCapabilityEligibilityShadow,
  toAgentCapabilityEligibilityView
} from "@/lib/brain/commercial/capability-eligibility";
import { buildCapabilityEligibilityInputFeatureFlags, buildCapabilityEligibilityShadowFeatureFlags } from "@/lib/brain/commercial/config/commercialCycleConfig";
import { buildAgentTurnInput } from "@/lib/brain/commercial/agent-turn-input";
import type { CommercialDomainReadModel } from "@/lib/brain/commercial/domain-read-model";
import type { PersistedCommercialWork } from "@/lib/brain/commercial/work/persistenceTypes";
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
  identityLevel?: CommercialDomainReadModel["customer"]["identityLevel"];
  quote?: "missing" | FreshnessState;
} = {}): CommercialDomainReadModel {
  const objectiveType = input.objectiveType ?? null;
  const selection = input.selection ?? "CURRENT";
  const destination = input.destination ?? "CURRENT";
  const identityLevel = input.identityLevel ?? null;
  const quote = input.quote ?? "missing";
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
    quote:
      quote === "missing"
        ? null
        : {
            quoteId: "quote-1",
            quoteNumber: "Q-1",
            status: "draft",
            currency: "CLP",
            total: "10000",
            validUntil: "2026-10-16T00:00:00.000Z",
            version: 1,
            selectionFactId: "fact-selection-1",
            freshness: freshness(quote),
            grounding: quote === "CURRENT" ? "CURRENT_FOR_KNOWN_ANCHORS" : quote === "STALE" ? "STALE" : "UNKNOWN"
          },
    customer: { status: identityLevel === null ? "unknown" : "identified", identityLevel, hasResolvedCustomer: identityLevel !== null, verificationRequired: false, profile: null },
    conversation: { conversationId: 1, sessionVersion: null },
    evidence: []
  };
}

function workAtObjective(type: "SELECT_PRODUCTS" | "QUOTE"): Pick<PersistedCommercialWork, "publicId" | "version" | "objectives"> {
  return {
    publicId: `cw-${type.toLowerCase()}`,
    version: type === "SELECT_PRODUCTS" ? 1 : 2,
    objectives: [{
      objectiveId: `objective-${type.toLowerCase()}`,
      type,
      status: "PENDING",
      origin: "customer_requested",
      inputs: {},
      resolvedInputs: {},
      missingRequirements: [],
      supersedesObjectiveIds: [],
      evidence: [],
      blockers: []
    }]
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
  assert.equal(snapshot.metadataVersion, "p6.2-b.1");
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

test("P6.3: cognition input flag is independently fail-closed from shadow telemetry", () => {
  const previous = process.env.BRAIN_R3_CAPABILITY_ELIGIBILITY_INPUT_ENABLED;
  try {
    delete process.env.BRAIN_R3_CAPABILITY_ELIGIBILITY_INPUT_ENABLED;
    assert.equal(buildCapabilityEligibilityInputFeatureFlags().capabilityEligibilityInputEnabled, false);
    process.env.BRAIN_R3_CAPABILITY_ELIGIBILITY_INPUT_ENABLED = "true";
    assert.equal(buildCapabilityEligibilityInputFeatureFlags().capabilityEligibilityInputEnabled, true);
  } finally {
    if (previous === undefined) delete process.env.BRAIN_R3_CAPABILITY_ELIGIBILITY_INPUT_ENABLED;
    else process.env.BRAIN_R3_CAPABILITY_ELIGIBILITY_INPUT_ENABLED = previous;
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

test("P6-B1/B5/B14: QUOTE with current selection and canonical LEVEL_2 identity makes create_quote eligible without shipping", () => {
  const snapshot = evaluate(buildReadModel({ objectiveType: "QUOTE", identityLevel: "LEVEL_2_MASTER_RESOLVED" }));
  assert.equal(entry(snapshot, "create_quote")?.status, "ELIGIBLE");
  assert.equal(entry(snapshot, "create_quote")?.reasonCodes.length, 0);
});

test("P6-B2/B3: create_quote fails closed for missing or non-current selection", () => {
  assert.deepEqual(entry(evaluate(buildReadModel({ objectiveType: "QUOTE", selection: "missing", identityLevel: "LEVEL_2_MASTER_RESOLVED" })), "create_quote")?.reasonCodes, ["MISSING_SELECTION"]);
  assert.deepEqual(entry(evaluate(buildReadModel({ objectiveType: "QUOTE", selection: "STALE", identityLevel: "LEVEL_2_MASTER_RESOLVED" })), "create_quote")?.reasonCodes, ["SELECTION_NOT_CURRENT"]);
});

test("P6-B4: create_quote blocks below the canonical LEVEL_2 policy", () => {
  assert.deepEqual(entry(evaluate(buildReadModel({ objectiveType: "QUOTE", identityLevel: "LEVEL_1_CHANNEL_OBSERVED" })), "create_quote")?.reasonCodes, ["IDENTITY_LEVEL_INSUFFICIENT"]);
});

test("P6-B6: create_quote is incompatible with SELECT_PRODUCTS", () => {
  assert.deepEqual(entry(evaluate(buildReadModel({ objectiveType: "SELECT_PRODUCTS", identityLevel: "LEVEL_2_MASTER_RESOLVED" })), "create_quote")?.reasonCodes, ["OBJECTIVE_INCOMPATIBLE"]);
});

test("P6-B7/B10: get_quote needs a current quote fact but no identity", () => {
  const snapshot = evaluate(buildReadModel({ objectiveType: "QUOTE", quote: "CURRENT", identityLevel: "LEVEL_0_ANONYMOUS" }));
  assert.equal(entry(snapshot, "get_quote")?.status, "ELIGIBLE");
});

test("P6-B8/B9: get_quote blocks for absent, stale, or unknown quote facts", () => {
  assert.deepEqual(entry(evaluate(buildReadModel({ objectiveType: "SELECT_PRODUCTS", quote: "CURRENT" })), "get_quote")?.reasonCodes, ["OBJECTIVE_INCOMPATIBLE"]);
  assert.deepEqual(entry(evaluate(buildReadModel({ objectiveType: "QUOTE", quote: "missing" })), "get_quote")?.reasonCodes, ["MISSING_QUOTE"]);
  assert.deepEqual(entry(evaluate(buildReadModel({ objectiveType: "QUOTE", quote: "STALE" })), "get_quote")?.reasonCodes, ["QUOTE_NOT_CURRENT"]);
  assert.deepEqual(entry(evaluate(buildReadModel({ objectiveType: "QUOTE", quote: "UNKNOWN" })), "get_quote")?.reasonCodes, ["QUOTE_NOT_CURRENT"]);
});

test("P6.3-A: cognitive eligibility view is compact, deterministic, and excludes snapshot internals", () => {
  const snapshot = evaluate(buildReadModel({ objectiveType: "QUOTE", quote: "missing", identityLevel: "LEVEL_2_MASTER_RESOLVED" }));
  const view = toAgentCapabilityEligibilityView(snapshot);

  assert.deepEqual(view.eligible, snapshot.eligible.map((entry) => entry.capability));
  assert.deepEqual(view.blocked, snapshot.blocked.map((entry) => ({ capability: entry.capability, reasonCodes: [...entry.reasonCodes] })));
  assert.equal(view.schemaVersion, "1");
  assert.equal(view.metadataVersion, snapshot.metadataVersion);
  assert.ok(!("workId" in view));
  assert.ok(!("workVersion" in view));
  assert.ok(!("objectiveId" in view));
  assert.ok(!("evaluatedAt" in view));
  assert.deepEqual(view.blocked.find((entry) => entry.capability === "get_quote")?.reasonCodes, ["MISSING_QUOTE"]);
  assert.ok(view.eligible.includes("create_quote"), "shipping is not a create_quote prerequisite");
});

test("P6.3-A: AgentTurnInput defaults eligibility to null and preserves a supplied compact view", () => {
  const readModel = buildReadModel({ objectiveType: "QUOTE", quote: "missing", identityLevel: "LEVEL_2_MASTER_RESOLVED" });
  const base = {
    domainReadModel: readModel,
    currentTurn: { inboundMessageId: "inbound-1", channel: "whatsapp" as const, text: "cotiza", occurredAt: "2026-09-17T00:00:00.000Z", correlationId: "corr-1" },
    conversationContext: { compactSummary: null, recentMessages: [], sessionVersion: null, continuity: { isFirstConversationalTurn: false, hasPriorAssistantMessages: true, hasPriorCustomerMessages: true } },
    executionPolicy: { identityLevel: "LEVEL_2_MASTER_RESOLVED", humanOwner: false, aiBlocked: false, allowedSensitiveActions: [], handoff: { allowedReasons: [] } }
  };
  assert.equal(buildAgentTurnInput(base).capabilityEligibility, null);
  const view = toAgentCapabilityEligibilityView(evaluate(readModel));
  assert.deepEqual(buildAgentTurnInput({ ...base, capabilityEligibility: view }).capabilityEligibility, view);
});

test("P6.3-C: pre-cognition and post-reconciliation snapshots are distinct moments over one DRM", () => {
  const drm = buildReadModel({ objectiveType: "SELECT_PRODUCTS", identityLevel: "LEVEL_2_MASTER_RESOLVED", quote: "missing" });
  const pre = evaluateCapabilityEligibility({ domainReadModel: drm, work: workAtObjective("SELECT_PRODUCTS"), evaluatedAt: "2026-09-17T00:00:00.000Z" });
  const post = evaluateCapabilityEligibility({ domainReadModel: drm, work: workAtObjective("QUOTE"), evaluatedAt: "2026-09-17T00:00:01.000Z" });

  assert.deepEqual(entry(pre, "create_quote")?.reasonCodes, ["OBJECTIVE_INCOMPATIBLE"]);
  assert.equal(entry(post, "create_quote")?.status, "ELIGIBLE", "QUOTE plus current selection and LEVEL_2 remains eligible without shipping");
  assert.deepEqual(entry(post, "get_quote")?.reasonCodes, ["MISSING_QUOTE"]);
  assert.equal(drm.objective?.type, "SELECT_PRODUCTS", "the evaluator never mutates/rebuilds the original DRM");
});

test("P6-B11/B12: quote execution classes remain derived from Gateway governance", () => {
  const snapshot = evaluate(buildReadModel({ objectiveType: "QUOTE", quote: "CURRENT", identityLevel: "LEVEL_2_MASTER_RESOLVED" }));
  for (const capability of ["create_quote", "get_quote"]) {
    assert.equal(entry(snapshot, capability)?.executionClass, resolveCapabilityGatewayDefinition(capability)?.governance.sideEffect);
  }
});

test("P6-B13: quote eligibility remains a pure evaluator with no execution, ports, or asynchronous work", () => {
  const source = readFileSync(new URL("../../lib/brain/commercial/capability-eligibility/evaluateCapabilityEligibility.ts", import.meta.url), "utf8");
  assert.ok(!source.includes("executeGovernedCapability"));
  assert.ok(!source.includes("createQuoteServicePort"));
  assert.ok(!source.includes("getQuoteServicePort"));
  assert.ok(!source.includes("queryRows"));
  assert.ok(!source.includes("fetch("));
  assert.ok(!source.includes("await "));
});

test("P6-B15/B16: unchanged shadow adapter emits the expanded snapshot only when enabled", async () => {
  const readModel = buildReadModel({ objectiveType: "QUOTE", quote: "CURRENT", identityLevel: "LEVEL_2_MASTER_RESOLVED" });
  let recorded: ReturnType<typeof evaluateCapabilityEligibility> | null = null;
  await runCapabilityEligibilityShadow({
    enabled: true,
    domainReadModel: readModel,
    evaluatedAt: "2026-09-16T00:00:00.000Z",
    record: async (snapshot) => { recorded = snapshot; }
  });
  assert.equal(entry(recorded!, "create_quote")?.status, "ELIGIBLE");
  assert.equal(entry(recorded!, "get_quote")?.status, "ELIGIBLE");
  const event = normalizeCommercialCapabilityEligibilityEvaluatedEvent({
    inboundMessageId: "inbound-p6-b16",
    payload: {
      schemaVersion: "1",
      workId: recorded!.workId,
      workVersion: recorded!.workVersion,
      objectiveType: recorded!.objectiveType,
      eligibleCapabilityNames: recorded!.eligible.map((candidate) => candidate.capability),
      blockedCapabilities: recorded!.blocked.map((candidate) => ({ capability: candidate.capability, reasonCodes: [...candidate.reasonCodes] })),
      metadataVersion: recorded!.metadataVersion
    }
  });
  assert.ok((event.payload.eligibleCapabilityNames as string[]).includes("create_quote"));
  assert.ok((event.payload.eligibleCapabilityNames as string[]).includes("get_quote"));
});

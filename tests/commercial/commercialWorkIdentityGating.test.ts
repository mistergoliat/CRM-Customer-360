import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildCommercialWorkProjection,
  COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION,
  COMMERCIAL_OBJECTIVE_TYPES,
  IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS,
  IDENTITY_DECISION_STATUS_TO_MISSING_REQUIREMENT,
  findIdentityOnboardingTrigger,
  buildCommercialWorkFinalizerMessage,
  type CommercialObjective,
  type CommercialObjectiveSeed,
  type CommercialWorkProjectionInput,
  type CommercialWork
} from "@/lib/brain/commercial/work";
import type { PersistedCommercialWork } from "@/lib/brain/commercial/work/persistenceTypes";
import type { CommercialIdentityRequirementDecision } from "@/lib/brain/commercial/identity/commercial-identity-requirement";
import type { RuntimeIdentityContext, RuntimeIdentityStatus } from "@/lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";
import type { IdentityLevel } from "@/lib/domains/customer-identity-verification";

// SALES-AGENT-R2-ID-R2-A07. Test matrix CIW01-CIW32 from the task spec (the
// projection-layer, pure subset - see commercialWorkIdentityOnboarding.test.ts
// for the DB-backed onboarding-activation/resume subset). Pure: no DB, no
// LLM, mirrors the CIR test file's own discipline for A06.

const NOW = "2026-08-25T12:00:00.000Z";

function runtimeIdentity(overrides: Partial<RuntimeIdentityContext> = {}): RuntimeIdentityContext {
  return {
    status: "ANONYMOUS",
    identityLevel: "LEVEL_0_ANONYMOUS",
    masterCustomerId: null,
    prestashopCustomerId: null,
    verificationRequired: false,
    requiredEvidence: [],
    readyToLink: false,
    conflictCode: null,
    policyCode: "NO_CHANNEL_EVIDENCE",
    evidenceRefs: [],
    ...overrides
  };
}

function atLevel(level: IdentityLevel, status: RuntimeIdentityStatus, overrides: Partial<RuntimeIdentityContext> = {}): RuntimeIdentityContext {
  return runtimeIdentity({ identityLevel: level, status, ...overrides });
}

function objectiveSeed(type: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["type"], inputs: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["inputs"] = {}): CommercialObjectiveSeed {
  return { type, origin: "customer_requested", inputs };
}

function project(overrides: Partial<CommercialWorkProjectionInput> = {}): CommercialWork {
  return buildCommercialWorkProjection({
    trigger: { type: "CUSTOMER_MESSAGE", conversationId: 1, opportunityId: 10, sourceMessageId: 100 },
    conversation: { id: 1, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: 10 },
    now: NOW,
    ...overrides
  });
}

function persisted(work: CommercialWork): PersistedCommercialWork {
  return { ...work, publicId: "work-1", correlationKey: "corr-1", version: 1, createdAt: NOW, updatedAt: NOW, completedAt: null, cancelledAt: null, cancelReason: null };
}

const READY_TO_QUOTE_LINE_ITEMS = { factId: "line-items-1", updatedAt: NOW, items: [{ productId: "31", combinationId: null, quantity: 2 }] };

function identityBlocker(work: CommercialWork, objectiveType: string) {
  const objective = work.objectives.find((item) => item.type === objectiveType);
  return { objective, blocker: objective?.blockers.find((item) => item.code === "IDENTITY_REQUIREMENT") };
}

// ---------------------------------------------------------------------------
// CIW01-03: public/catalog operation never gated, regardless of identity state.
// ---------------------------------------------------------------------------

test("CIW01: DISCOVER_PRODUCTS + LEVEL_0 stays READY", () => {
  const work = project({ objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "disco olimpico" })], runtimeIdentity: atLevel("LEVEL_0_ANONYMOUS", "ANONYMOUS") });
  const objective = work.objectives.find((item) => item.type === "DISCOVER_PRODUCTS");
  assert.equal(objective?.status, "READY");
  assert.equal(work.steps.find((step) => step.type === "SEARCH_PRODUCTS")?.status, "READY");
});

test("CIW02: DISCOVER_PRODUCTS + identity CONFLICT stays READY/executable", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "disco olimpico" })],
    runtimeIdentity: atLevel("LEVEL_2_MASTER_RESOLVED", "CONFLICT", { masterCustomerId: null, conflictCode: "CHANNEL_MASTER_CONFLICT" })
  });
  assert.equal(work.objectives.find((item) => item.type === "DISCOVER_PRODUCTS")?.status, "READY");
});

test("CIW03: DISCOVER_PRODUCTS + identity SYSTEM_UNAVAILABLE stays READY/executable", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "disco olimpico" })],
    runtimeIdentity: atLevel("LEVEL_0_ANONYMOUS", "SYSTEM_UNAVAILABLE")
  });
  assert.equal(work.objectives.find((item) => item.type === "DISCOVER_PRODUCTS")?.status, "READY");
});

// ---------------------------------------------------------------------------
// CIW04/05: identity-sensitive step (CREATE_QUOTE) gated by level.
// ---------------------------------------------------------------------------

test("CIW04: CREATE_QUOTE + insufficient level -> WAITING_CUSTOMER (BLOCKED_BY_IDENTITY), never reaches the executor as READY", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED")
  });
  const { objective, blocker } = identityBlocker(work, "CREATE_QUOTE");
  assert.equal(objective?.status, "WAITING_CUSTOMER");
  assert.ok(objective?.missingRequirements.includes("IDENTITY_EVIDENCE"));
  assert.equal(blocker?.identityDecision?.status, "ONBOARDING_REQUIRED");
  const step = work.steps.find((item) => item.type === "CREATE_QUOTE");
  assert.equal(step?.status, "WAITING_CUSTOMER", "the step must never fall through to READY despite the objective being identity-blocked");
});

test("CIW05: CREATE_QUOTE + sufficient level -> normal readiness, no identity blocker", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED", { masterCustomerId: "42" })
  });
  const { objective, blocker } = identityBlocker(work, "CREATE_QUOTE");
  assert.equal(objective?.status, "READY");
  assert.equal(blocker, undefined);
  assert.equal(work.steps.find((item) => item.type === "CREATE_QUOTE")?.status, "READY");
});

test("CREATE_QUOTE without a runtimeIdentity at all preserves current (pre-A07) behavior exactly - the gate is a no-op", () => {
  const work = project({ objectiveSeeds: [objectiveSeed("CREATE_QUOTE")], commercialLineItems: READY_TO_QUOTE_LINE_ITEMS });
  assert.equal(work.objectives.find((item) => item.type === "CREATE_QUOTE")?.status, "READY");
});

// ---------------------------------------------------------------------------
// CIW09/10: READY_TO_LINK never re-asks for information already in hand.
//
// create_quote's requirement is LEVEL_2, and A06 only ever emits
// READY_TO_LINK for a LEVEL_3 requirement (evaluate.ts step 6) - no
// CommercialWork objective type maps to a LEVEL_3 operation today (section 1
// of the A06 doc: customer_profile_history, the one real LEVEL_3 operation,
// is Agent Tool Loop-only). READY_TO_LINK is therefore tested at the mapping
// level directly (the actual logic that decides objective status/
// missingRequirement from a decision status), plus end-to-end through
// findIdentityOnboardingTrigger below using a hand-built objective - both
// exercise the real production code, neither depends on an unreachable
// real-world scenario.
// ---------------------------------------------------------------------------

test("PARTE 3/4/9: the decision-status -> objective-status/missingRequirement mapping distinguishes every non-SUFFICIENT status (exhaustive by construction - TypeScript's Record type fails to compile if a status is left unhandled)", () => {
  assert.equal(IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS.ONBOARDING_REQUIRED, "WAITING_CUSTOMER");
  assert.equal(IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS.AMBIGUITY_RESOLUTION_REQUIRED, "WAITING_CUSTOMER");
  assert.equal(IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS.READY_TO_LINK, "BLOCKED");
  assert.equal(IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS.IDENTITY_CONFLICT, "BLOCKED");
  assert.equal(IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS.ENTITY_VERIFICATION_REQUIRED, "BLOCKED");
  assert.equal(IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS.SYSTEM_WAIT, "WAITING_SYSTEM");

  // CIW09: READY_TO_LINK is never treated as a plain information gap.
  assert.equal(IDENTITY_DECISION_STATUS_TO_MISSING_REQUIREMENT.READY_TO_LINK, "IDENTITY_LINK_PENDING");
  assert.notEqual(IDENTITY_DECISION_STATUS_TO_MISSING_REQUIREMENT.READY_TO_LINK, "IDENTITY_EVIDENCE");
  // A system-owned wait is never phrased as something the customer is missing.
  assert.equal(IDENTITY_DECISION_STATUS_TO_MISSING_REQUIREMENT.SYSTEM_WAIT, undefined);
});

// ---------------------------------------------------------------------------
// CIW17-19: conflict vs. ambiguity vs. a public step, kept structurally distinct.
// ---------------------------------------------------------------------------

test("CIW17: identity CONFLICT blocks the identity-sensitive step (CREATE_QUOTE)", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_2_MASTER_RESOLVED", "CONFLICT", { masterCustomerId: null, conflictCode: "CHANNEL_MASTER_CONFLICT" })
  });
  const { objective, blocker } = identityBlocker(work, "CREATE_QUOTE");
  assert.equal(objective?.status, "BLOCKED");
  assert.equal(blocker?.identityDecision?.status, "IDENTITY_CONFLICT");
});

test("CIW18: identity CONFLICT never blocks a public/catalog step", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "disco" }), objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_2_MASTER_RESOLVED", "CONFLICT", { masterCustomerId: null, conflictCode: "CHANNEL_MASTER_CONFLICT" })
  });
  assert.equal(work.objectives.find((item) => item.type === "DISCOVER_PRODUCTS")?.status, "READY");
  assert.equal(work.objectives.find((item) => item.type === "CREATE_QUOTE")?.status, "BLOCKED");
});

test("CIW19: ambiguity is distinct from conflict - AMBIGUITY_RESOLUTION_REQUIRED, not IDENTITY_CONFLICT", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_1_CHANNEL_OBSERVED", "AMBIGUOUS")
  });
  const { objective, blocker } = identityBlocker(work, "CREATE_QUOTE");
  assert.equal(objective?.status, "WAITING_CUSTOMER");
  assert.ok(objective?.missingRequirements.includes("IDENTITY_AMBIGUOUS"));
  assert.equal(blocker?.identityDecision?.status, "AMBIGUITY_RESOLUTION_REQUIRED");
});

test("SYSTEM_WAIT is system-owned: WAITING_SYSTEM, never WAITING_CUSTOMER", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_0_ANONYMOUS", "SYSTEM_UNAVAILABLE")
  });
  const { objective, blocker } = identityBlocker(work, "CREATE_QUOTE");
  assert.equal(objective?.status, "WAITING_SYSTEM");
  assert.equal(blocker?.identityDecision?.status, "SYSTEM_WAIT");
  assert.ok(!objective?.missingRequirements.some((item) => item.startsWith("IDENTITY_")), "a system-owned wait is never phrased as something the customer is missing");
});

// ---------------------------------------------------------------------------
// CIW20/21: assisted sale never requires onboarding.
// ---------------------------------------------------------------------------

test("CIW20/21: HANDOFF (assisted_sale_handoff) completes regardless of identity level - LEVEL_0 and LEVEL_1 both", () => {
  for (const [level, status] of [
    ["LEVEL_0_ANONYMOUS", "ANONYMOUS"],
    ["LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED"]
  ] as const) {
    const work = project({ objectiveSeeds: [objectiveSeed("HANDOFF")], runtimeIdentity: atLevel(level, status) });
    const objective = work.objectives.find((item) => item.type === "HANDOFF");
    assert.equal(objective?.status, "COMPLETED", `assisted sale must never be gated at ${level}`);
    assert.equal(objective?.blockers.some((item) => item.code === "IDENTITY_REQUIREMENT"), false);
  }
});

// ---------------------------------------------------------------------------
// CIW24: public step behavior identical with/without a RuntimeIdentityContext present.
// ---------------------------------------------------------------------------

test("CIW24: DISCOVER_PRODUCTS objective is byte-identical whether or not runtimeIdentity is present", () => {
  const withIdentity = project({ objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "disco" })], runtimeIdentity: atLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED", { masterCustomerId: "42" }) });
  const withoutIdentity = project({ objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "disco" })] });
  const a = withIdentity.objectives.find((item) => item.type === "DISCOVER_PRODUCTS");
  const b = withoutIdentity.objectives.find((item) => item.type === "DISCOVER_PRODUCTS");
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// CIW25/26/27: privacy and checkout neutrality.
// ---------------------------------------------------------------------------

test("CIW25/26: no raw PII and no candidate arrays reach the CommercialWork blocker - only enums/levels/policy codes", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED", { requiredEvidence: ["email"], evidenceRefs: ["evidence-row-1"] })
  });
  const serialized = JSON.stringify(work);
  assert.ok(!serialized.includes("@"), "no email-shaped value should ever appear");
  assert.ok(!/\bcandidates\b/.test(serialized), "no identity candidate list should ever be attached to the blocker");
  const { blocker } = identityBlocker(work, "CREATE_QUOTE");
  assert.deepEqual(Object.keys(blocker?.identityDecision ?? {}).sort(), ["currentLevel", "policyCode", "requiredEvidence", "requiredLevel", "status"]);
});

test("CIW27: checkout availability is never imported or read by the gate - structural, source-level check", () => {
  const source = readFileSync(join(__dirname, "..", "..", "lib", "brain", "commercial", "work", "commercialIdentityGate.ts"), "utf8");
  const importRegex = /(?:import|export)\s+[^;]*?from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    assert.ok(!/checkout/i.test(match[1]), `must never import a checkout module (found "${match[1]}")`);
  }
  assert.ok(!source.includes("process.env"));
});

// ---------------------------------------------------------------------------
// CIW30: restart re-derives the identical blocker (DERIVED, not persisted, state).
// ---------------------------------------------------------------------------

test("CIW30: re-running the same pure projection twice (simulating a restart) re-derives the identical identity blocker", () => {
  const input: CommercialWorkProjectionInput = {
    trigger: { type: "CUSTOMER_MESSAGE", conversationId: 1, opportunityId: 10, sourceMessageId: 100 },
    conversation: { id: 1, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: 10 },
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED"),
    now: NOW
  };
  const first = identityBlocker(buildCommercialWorkProjection(input), "CREATE_QUOTE");
  const second = identityBlocker(buildCommercialWorkProjection(input), "CREATE_QUOTE");
  assert.deepEqual(first.blocker?.identityDecision, second.blocker?.identityDecision);
});

// ---------------------------------------------------------------------------
// PARTE 2: mapping completeness/integrity.
// ---------------------------------------------------------------------------

test("PARTE 2: every objective type that produces a real deriveCommercialWorkSteps.ts case is represented in the operation mapping (or deliberately absent - no capability exists for it)", () => {
  const deliberatelyUnmapped = new Set(["WAIT_FOR_QUOTE_APPROVAL"]);
  for (const type of COMMERCIAL_OBJECTIVE_TYPES) {
    if (deliberatelyUnmapped.has(type)) {
      assert.equal(COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION[type], undefined, `${type} must stay unmapped`);
      continue;
    }
    assert.ok(COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION[type], `${type} is missing from COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION`);
  }
});

// ---------------------------------------------------------------------------
// findIdentityOnboardingTrigger - CIW06/07/09/10 (the wiring, not the onboarding subsystem itself).
// ---------------------------------------------------------------------------

test("findIdentityOnboardingTrigger: finds an ONBOARDING_REQUIRED objective and maps it to the create_quote operation", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED")
  });
  const trigger = findIdentityOnboardingTrigger(work.objectives);
  assert.equal(trigger?.operation, "create_quote");
});

function objectiveWithIdentityDecision(type: CommercialObjective["type"], decision: CommercialIdentityRequirementDecision): CommercialObjective {
  return {
    objectiveId: "obj-1",
    type,
    status: IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS[decision.status as Exclude<CommercialIdentityRequirementDecision["status"], "SUFFICIENT">] ?? "BLOCKED",
    origin: "customer_requested",
    inputs: {},
    resolvedInputs: {},
    missingRequirements: [],
    supersedesObjectiveIds: [],
    evidence: [],
    blockers: [{ code: "IDENTITY_REQUIREMENT", source: "objective", objectiveId: "obj-1", identityDecision: decision }]
  };
}

test("findIdentityOnboardingTrigger: also finds a READY_TO_LINK objective (link workflow, not onboarding activation - runCustomerOnboardingPostPlanStage decides which internally)", () => {
  const objective = objectiveWithIdentityDecision("CREATE_QUOTE", { status: "READY_TO_LINK", currentLevel: "LEVEL_2_MASTER_RESOLVED", policyCode: "IDENTITY_READY_TO_LINK" });
  const trigger = findIdentityOnboardingTrigger([objective]);
  assert.equal(trigger?.operation, "create_quote");
});

test("findIdentityOnboardingTrigger: never fires for AMBIGUITY/CONFLICT/SYSTEM_WAIT/ENTITY_VERIFICATION - none of those is advanceable by a bare field capture", () => {
  for (const identity of [
    atLevel("LEVEL_1_CHANNEL_OBSERVED", "AMBIGUOUS"),
    atLevel("LEVEL_2_MASTER_RESOLVED", "CONFLICT", { masterCustomerId: null, conflictCode: "X" }),
    atLevel("LEVEL_0_ANONYMOUS", "SYSTEM_UNAVAILABLE")
  ]) {
    const work = project({ objectiveSeeds: [objectiveSeed("CREATE_QUOTE")], commercialLineItems: READY_TO_QUOTE_LINE_ITEMS, runtimeIdentity: identity });
    assert.equal(findIdentityOnboardingTrigger(work.objectives), null, `must not trigger for status=${identity.status}`);
  }
});

test("findIdentityOnboardingTrigger: no identity blocker at all -> null", () => {
  const work = project({ objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "disco" })] });
  assert.equal(findIdentityOnboardingTrigger(work.objectives), null);
});

// ---------------------------------------------------------------------------
// PARTE 20: finalizer surfaces structured facts, never the generic catch-all.
// ---------------------------------------------------------------------------

test("PARTE 20: an ONBOARDING_REQUIRED(email) block produces a specific question, never the generic catch-all", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED", { requiredEvidence: ["email"] })
  });
  const result = buildCommercialWorkFinalizerMessage(persisted(work));
  assert.equal(result.disposition, "BLOCKED");
  assert.match(result.message, /correo electrónico/);
  assert.ok(!result.message.includes("Necesito un momento más"), "must not fall through to the generic catch-all when requiredEvidence is known");
});

// SALES-AGENT-R2-ID-R2-A08. Superseded (release doc PARTE 1): A06's
// requiredEvidence is never the source this finalizer asks from anymore -
// create_quote's onboarding purpose ("quote") only ever requires
// firstName+email (onboardingPurposeMapping.ts), so a fabricated
// requiredEvidence: ["order_reference"] must NOT surface an order-number
// question for this objective - the purpose's own required fields win
// (identityCollectionRequest.ts). See the new
// commercialWorkIdentityConversation.test.ts for order_reference wording
// exercised against a purpose that actually requires it.
test("PARTE 20 (A08): CREATE_QUOTE's ONBOARDING_REQUIRED block asks for the quote purpose's real fields (name+email), never order_reference, even if requiredEvidence suggests it", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED", { requiredEvidence: ["order_reference"] })
  });
  const result = buildCommercialWorkFinalizerMessage(persisted(work));
  assert.match(result.message, /correo electrónico/);
  assert.doesNotMatch(result.message, /número de tu pedido/);
});

test("PARTE 20: ambiguity produces a disambiguation question distinct from the plain evidence question", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_1_CHANNEL_OBSERVED", "AMBIGUOUS")
  });
  const result = buildCommercialWorkFinalizerMessage(persisted(work));
  assert.match(result.message, /más de una coincidencia/);
});

// ---------------------------------------------------------------------------
// CIW23: entity verification is never satisfied by LEVEL_3 alone (inherited
// guarantee from A06 - order_status_entity_verification has no
// CommercialObjectiveType consumer yet, so this is re-asserted at the
// boundary CommercialWork actually imports from, not re-derived here).
// ---------------------------------------------------------------------------

test("CIW23: applyCommercialIdentityGate never produces ENTITY_VERIFICATION_REQUIRED for a MINIMUM_LEVEL operation (create_quote) even at LEVEL_3", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_3_PRESTASHOP_LINKED", "PRESTASHOP_LINKED", { masterCustomerId: "42", prestashopCustomerId: "99" })
  });
  const { blocker } = identityBlocker(work, "CREATE_QUOTE");
  assert.equal(blocker, undefined, "LEVEL_3 satisfies create_quote's LEVEL_2 requirement - SUFFICIENT, no blocker at all");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildCommercialWorkProjection,
  buildCommercialWorkFinalizerMessage,
  deriveIdentityCollectionRequest,
  deriveCommercialWorkStatus,
  IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS,
  IDENTITY_DECISION_STATUS_TO_MISSING_REQUIREMENT,
  type CommercialObjective,
  type CommercialObjectiveSeed,
  type CommercialWorkProjectionInput,
  type CommercialWork,
  type OnboardingCollectionSnapshot
} from "@/lib/brain/commercial/work";
import type { PersistedCommercialWork } from "@/lib/brain/commercial/work/persistenceTypes";
import type { CommercialIdentityRequirementDecision } from "@/lib/brain/commercial/identity/commercial-identity-requirement";
import type { RuntimeIdentityContext, RuntimeIdentityStatus } from "@/lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";
import type { IdentityLevel } from "@/lib/domains/customer-identity-verification";

// SALES-AGENT-R2-ID-R2-A08. Test matrix CIC01-CIC32 from the task spec - the
// pure, no-DB subset (see the release doc for which IDs are covered by
// existing suites - extractCustomerOnboardingFields.test.ts,
// customerOnboardingPostPlanStage.test.ts, commercialWorkIdentityGating.test.ts,
// commercialWorkIdentityOnboarding.test.ts - and which remain explicit debt).

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

function onboarding(overrides: Partial<OnboardingCollectionSnapshot>): OnboardingCollectionSnapshot {
  return { status: "collecting", purpose: "quote", pendingFields: [], ...overrides };
}

function objectiveWithIdentityDecision(type: CommercialObjective["type"], decision: CommercialIdentityRequirementDecision): CommercialObjective {
  // Mirrors applyCommercialIdentityGate.ts's own two writes (status +
  // missingRequirements) for a non-SUFFICIENT decision - never just one of
  // the two, or a synthetic fixture here could pass a status the real gate
  // would never actually produce alone.
  const missingRequirement = IDENTITY_DECISION_STATUS_TO_MISSING_REQUIREMENT[decision.status];
  return {
    objectiveId: "obj-1",
    type,
    status: IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS[decision.status as Exclude<CommercialIdentityRequirementDecision["status"], "SUFFICIENT">] ?? "BLOCKED",
    origin: "customer_requested",
    inputs: {},
    resolvedInputs: {},
    missingRequirements: missingRequirement ? [missingRequirement] : [],
    supersedesObjectiveIds: [],
    evidence: [],
    blockers: [{ code: "IDENTITY_REQUIREMENT", source: "objective", objectiveId: "obj-1", identityDecision: decision }]
  };
}

function workFromObjectives(objectives: CommercialObjective[]): PersistedCommercialWork {
  const base = project({ objectiveSeeds: [] });
  // project({objectiveSeeds: []}) derives work.status from an EMPTY
  // objectives array (-> "COMPLETED", deriveCommercialWorkStatus's first
  // fallback) - re-derive it for real once the synthetic objectives below
  // are swapped in, or buildCommercialWorkFinalizerMessage's own
  // work.status === "COMPLETED" short-circuit would misfire regardless of
  // what those objectives actually contain.
  const status = deriveCommercialWorkStatus({ objectives, steps: [], blockers: [] });
  return persisted({ ...base, objectives, steps: [], status });
}

// ---------------------------------------------------------------------------
// CIC01/02: email-first, duplicate question prevention.
// ---------------------------------------------------------------------------

test("CIC01: create_quote with no onboarding row yet asks for the quote purpose's real fields, including email, on the very first turn (requiredEvidence empty)", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    // A brand-new conversation: A04 has no weak candidate evidence yet, so
    // requiredEvidence is empty (release doc PARTE 1) - the fix must not
    // depend on it.
    runtimeIdentity: atLevel("LEVEL_0_ANONYMOUS", "ANONYMOUS", { requiredEvidence: [] })
  });
  const result = buildCommercialWorkFinalizerMessage(persisted(work), null);
  assert.equal(result.disposition, "BLOCKED");
  assert.match(result.message, /correo electrónico/);
  assert.ok(!result.message.includes("Necesito un momento más"));
});

test("CIC02: email already collected (only orderReference-shaped purpose still pending some other field) is never re-asked", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED")
  });
  // Email already in hand this turn - only firstName still pending.
  const result = buildCommercialWorkFinalizerMessage(persisted(work), onboarding({ pendingFields: ["firstName"] }));
  assert.match(result.message, /tu nombre/);
  assert.doesNotMatch(result.message, /correo electrónico/);
});

// ---------------------------------------------------------------------------
// CIC07/08/23: order reference collection + multi-field same-turn ask.
// ---------------------------------------------------------------------------

test("CIC07: a purpose whose required fields include orderReference asks for it specifically", () => {
  const objective = objectiveWithIdentityDecision("CREATE_QUOTE", {
    status: "ONBOARDING_REQUIRED",
    currentLevel: "LEVEL_0_ANONYMOUS",
    requiredLevel: "LEVEL_2_MASTER_RESOLVED",
    requiredEvidence: [],
    policyCode: "CHANNEL_IDENTITY_REQUIRED"
  });
  objective.status = "WAITING_CUSTOMER";
  objective.missingRequirements = ["IDENTITY_EVIDENCE"];
  const work = workFromObjectives([objective]);
  const result = buildCommercialWorkFinalizerMessage(work, onboarding({ purpose: "order_inquiry", pendingFields: ["orderReference"] }));
  assert.match(result.message, /número de tu pedido/);
});

test("CIC08: orderReference already collected is never repeated", () => {
  const objective = objectiveWithIdentityDecision("CREATE_QUOTE", {
    status: "ONBOARDING_REQUIRED",
    currentLevel: "LEVEL_0_ANONYMOUS",
    requiredLevel: "LEVEL_2_MASTER_RESOLVED",
    requiredEvidence: [],
    policyCode: "CHANNEL_IDENTITY_REQUIRED"
  });
  objective.status = "WAITING_CUSTOMER";
  objective.missingRequirements = ["IDENTITY_EVIDENCE"];
  const work = workFromObjectives([objective]);
  // pendingFields empty (orderReference already given, purpose fully
  // satisfied) -> the request must move on to a create-consent ask, never
  // repeat the order-reference question.
  const result = buildCommercialWorkFinalizerMessage(work, onboarding({ purpose: "order_inquiry", pendingFields: [] }));
  assert.doesNotMatch(result.message, /número de tu pedido/);
});

test("CIC23: two missing fields (name + email) are asked together in the same turn, not one-by-one", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_0_ANONYMOUS", "ANONYMOUS")
  });
  const result = buildCommercialWorkFinalizerMessage(persisted(work), onboarding({ pendingFields: ["firstName", "email"] }));
  assert.match(result.message, /tu nombre/);
  assert.match(result.message, /correo electrónico/);
});

// ---------------------------------------------------------------------------
// PARTE 11: create_customer consent ask, once minimum data is in hand.
// ---------------------------------------------------------------------------

test("once every required field is collected but no consent was given yet, the finalizer asks to authorize account creation - not a field question", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED")
  });
  const result = buildCommercialWorkFinalizerMessage(persisted(work), onboarding({ pendingFields: [] }));
  assert.match(result.message, /autorizas que creemos tu cuenta/);
  assert.doesNotMatch(result.message, /correo electrónico/);
});

test("a terminal onboarding status (e.g. temporarily_unavailable) never triggers a create-consent ask - falls back to the purpose's fields instead", () => {
  const request = deriveIdentityCollectionRequest(
    objectiveWithIdentityDecision("CREATE_QUOTE", {
      status: "ONBOARDING_REQUIRED",
      currentLevel: "LEVEL_0_ANONYMOUS",
      requiredLevel: "LEVEL_2_MASTER_RESOLVED",
      requiredEvidence: [],
      policyCode: "CHANNEL_IDENTITY_REQUIRED"
    }),
    onboarding({ status: "temporarily_unavailable", pendingFields: [] })
  );
  assert.equal(request.kind, "ASK_FIELDS");
});

// ---------------------------------------------------------------------------
// CIC12/13: READY_TO_LINK asks for consent, never re-asks for fields.
// ---------------------------------------------------------------------------

test("CIC12: READY_TO_LINK asks for link consent, never a field question", () => {
  const objective = objectiveWithIdentityDecision("CREATE_QUOTE", { status: "READY_TO_LINK", currentLevel: "LEVEL_2_MASTER_RESOLVED", policyCode: "IDENTITY_READY_TO_LINK" });
  const work = workFromObjectives([objective]);
  const result = buildCommercialWorkFinalizerMessage(work, onboarding({ pendingFields: ["email"] }));
  assert.equal(result.disposition, "BLOCKED");
  // SALES-AGENT-R2-ID-R2-A09: corrected wording - READY_TO_LINK is about the
  // PrestaShop bridge (master <-> ps_customer), never the WhatsApp channel.
  assert.match(result.message, /vinculemos a tu perfil/);
  assert.doesNotMatch(result.message, /whatsapp/i);
  assert.doesNotMatch(result.message, /correo electrónico/);
});

// ---------------------------------------------------------------------------
// CIC10/11: conflict is always the safe, generic message - never reveals a
// candidate, never claims a customer-resolvable path (release doc PARTE 9:
// CommercialWork's own IDENTITY_CONFLICT decision carries no conflictCode).
// ---------------------------------------------------------------------------

test("CIC10/11: IDENTITY_CONFLICT always produces the same safe, generic handoff-style message - never a candidate detail", () => {
  const objective = objectiveWithIdentityDecision("CREATE_QUOTE", { status: "IDENTITY_CONFLICT", policyCode: "IDENTITY_CONFLICT" });
  const work = workFromObjectives([objective]);
  const result = buildCommercialWorkFinalizerMessage(work, null);
  assert.equal(result.disposition, "BLOCKED");
  assert.match(result.message, /alguien del equipo/);
  assert.doesNotMatch(result.message, /LEVEL_|policyCode|conflictCode/);
});

test("ENTITY_VERIFICATION_REQUIRED (no real CommercialWork consumer today - kept exhaustive) produces a generic verification message, never falls through to the empty catch-all", () => {
  const objective = objectiveWithIdentityDecision("CREATE_QUOTE", { status: "ENTITY_VERIFICATION_REQUIRED", currentLevel: "LEVEL_2_MASTER_RESOLVED", entityType: "order", policyCode: "ENTITY_VERIFICATION_REQUIRED" });
  const work = workFromObjectives([objective]);
  const result = buildCommercialWorkFinalizerMessage(work, null);
  assert.equal(result.disposition, "BLOCKED");
  assert.match(result.message, /verificar/);
});

// ---------------------------------------------------------------------------
// CIC18/19/32: optional assisted-sale enrichment, never a blocker.
// ---------------------------------------------------------------------------

test("CIC18/32: a completed HANDOFF objective (assisted_sale_handoff) is FINAL even with no email on file, and optionally asks for one - never blocks", () => {
  const work = project({ objectiveSeeds: [objectiveSeed("HANDOFF")] });
  const result = buildCommercialWorkFinalizerMessage(persisted(work), null);
  assert.equal(result.disposition, "FINAL");
  assert.match(result.message, /conectar tu conversación/);
  assert.match(result.message, /correo electrónico \(es opcional\)/);
});

test("CIC19: a customer already known (no pending email) sees the handoff completion with no enrichment ask - it never insists", () => {
  const work = project({ objectiveSeeds: [objectiveSeed("HANDOFF")] });
  const result = buildCommercialWorkFinalizerMessage(persisted(work), onboarding({ pendingFields: ["firstName"] }));
  assert.equal(result.disposition, "FINAL");
  assert.doesNotMatch(result.message, /correo electrónico/);
});

// ---------------------------------------------------------------------------
// CIC20/21: public/catalog operations never ask for identity.
// ---------------------------------------------------------------------------

test("CIC20/21: DISCOVER_PRODUCTS and shipping objectives never surface an identity question, regardless of identity state", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "disco olimpico" }), objectiveSeed("SET_DESTINATION", { destinationText: "Providencia" })],
    runtimeIdentity: atLevel("LEVEL_0_ANONYMOUS", "ANONYMOUS")
  });
  const result = buildCommercialWorkFinalizerMessage(persisted(work), null);
  assert.doesNotMatch(result.message, /correo electrónico/);
  assert.doesNotMatch(result.message, /vinculemos a tu perfil/);
});

// ---------------------------------------------------------------------------
// CIC22: system failure is never surfaced as a customer question.
// ---------------------------------------------------------------------------

test("CIC22: SYSTEM_WAIT never reaches a customer-facing identity question - the objective is WAITING_SYSTEM, not WAITING_CUSTOMER/BLOCKED", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CREATE_QUOTE")],
    commercialLineItems: READY_TO_QUOTE_LINE_ITEMS,
    runtimeIdentity: atLevel("LEVEL_0_ANONYMOUS", "SYSTEM_UNAVAILABLE")
  });
  const objective = work.objectives.find((item) => item.type === "CREATE_QUOTE");
  assert.equal(objective?.status, "WAITING_SYSTEM");
  const result = buildCommercialWorkFinalizerMessage(persisted(work), null);
  assert.doesNotMatch(result.message, /correo electrónico|pedido|vincule/);
});

// ---------------------------------------------------------------------------
// CIC27/28/29: privacy + LLM-authority boundary (structural).
// ---------------------------------------------------------------------------

test("CIC27/28: identityCollectionRequest.ts never imports an LLM/provider module and never reads/returns a master or prestashop id", () => {
  const source = readFileSync(join(__dirname, "..", "..", "lib", "brain", "commercial", "work", "identityCollectionRequest.ts"), "utf8");
  assert.doesNotMatch(source, /provider|deepseek|openai|masterCustomerId|prestashopCustomerId/i);
});

test("CIC29: there is no LLM wording path to fail - buildCommercialWorkFinalizerMessage is a pure, synchronous, deterministic function (same input -> same output)", () => {
  const objective = objectiveWithIdentityDecision("CREATE_QUOTE", { status: "READY_TO_LINK", currentLevel: "LEVEL_2_MASTER_RESOLVED", policyCode: "IDENTITY_READY_TO_LINK" });
  const work = workFromObjectives([objective]);
  const first = buildCommercialWorkFinalizerMessage(work, onboarding({ pendingFields: [] }));
  const second = buildCommercialWorkFinalizerMessage(work, onboarding({ pendingFields: [] }));
  assert.deepEqual(first, second);
});

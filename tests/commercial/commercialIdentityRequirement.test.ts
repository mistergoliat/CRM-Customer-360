import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  COMMERCIAL_OPERATIONS,
  IDENTITY_LEVELS_IN_COMPARISON_ORDER,
  evaluateCommercialIdentityRequirement,
  getCommercialIdentityRequirement,
  isIdentityLevelAtLeast
} from "@/lib/brain/commercial/identity/commercial-identity-requirement";
import type { RuntimeIdentityContext, RuntimeIdentityStatus } from "@/lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";
import type { IdentityLevel } from "@/lib/domains/customer-identity-verification";
import { CAPABILITY_GATEWAY_REGISTRY } from "@/lib/brain/commercial/capability-gateway/registry";
import { COMMERCIAL_WORK_STEP_CAPABILITIES } from "@/lib/brain/commercial/work/stepTypes";

// SALES-AGENT-R2-ID-R2-A06. Test matrix CIR01-CIR24 from the task spec. The
// whole module is pure (no I/O) - every test here runs without a DB.

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

// ---------------------------------------------------------------------------
// CIR01-CIR03: public/anonymous operation never gated by identity state.
// ---------------------------------------------------------------------------

test("CIR01: SEARCH_PRODUCTS + L0 -> SUFFICIENT", () => {
  const decision = evaluateCommercialIdentityRequirement("search_products", atLevel("LEVEL_0_ANONYMOUS", "ANONYMOUS"));
  assert.equal(decision.status, "SUFFICIENT");
  if (decision.status === "SUFFICIENT") {
    assert.equal(decision.requiredLevel, null);
    assert.equal(decision.policyCode, "IDENTITY_NOT_REQUIRED");
  }
});

test("CIR02: SEARCH_PRODUCTS + CONFLICT -> SUFFICIENT, identity not required", () => {
  const decision = evaluateCommercialIdentityRequirement(
    "search_products",
    atLevel("LEVEL_2_MASTER_RESOLVED", "CONFLICT", { masterCustomerId: null, conflictCode: "CHANNEL_MASTER_CONFLICT" })
  );
  assert.equal(decision.status, "SUFFICIENT");
});

test("CIR03: SEARCH_PRODUCTS + SYSTEM_UNAVAILABLE -> SUFFICIENT", () => {
  const decision = evaluateCommercialIdentityRequirement("search_products", atLevel("LEVEL_0_ANONYMOUS", "SYSTEM_UNAVAILABLE"));
  assert.equal(decision.status, "SUFFICIENT");
});

// ---------------------------------------------------------------------------
// CIR04: shipping data is never identity.
// ---------------------------------------------------------------------------

test("CIR04: shipping estimate + L0/L1 never triggers onboarding", () => {
  for (const level of ["LEVEL_0_ANONYMOUS", "LEVEL_1_CHANNEL_OBSERVED"] as const) {
    const decision = evaluateCommercialIdentityRequirement("calculate_shipping", atLevel(level, level === "LEVEL_0_ANONYMOUS" ? "ANONYMOUS" : "CHANNEL_OBSERVED"));
    assert.equal(decision.status, "SUFFICIENT", `calculate_shipping must never require onboarding at ${level}`);
  }
});

// ---------------------------------------------------------------------------
// CIR05/CIR06: a formal customer-specific operation (create_quote, LEVEL_2).
// ---------------------------------------------------------------------------

test("CIR05: create_quote + L1 -> ONBOARDING_REQUIRED", () => {
  const decision = evaluateCommercialIdentityRequirement("create_quote", atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED"));
  assert.equal(decision.status, "ONBOARDING_REQUIRED");
  if (decision.status === "ONBOARDING_REQUIRED") {
    assert.equal(decision.requiredLevel, "LEVEL_2_MASTER_RESOLVED");
    assert.equal(decision.policyCode, "MASTER_IDENTITY_REQUIRED");
    assert.deepEqual(decision.requiredEvidence, []);
  }
});

test("CIR06: create_quote + L2 -> SUFFICIENT", () => {
  const decision = evaluateCommercialIdentityRequirement("create_quote", atLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED", { masterCustomerId: "700" }));
  assert.equal(decision.status, "SUFFICIENT");
  if (decision.status === "SUFFICIENT") assert.equal(decision.policyCode, "MASTER_IDENTITY_SUFFICIENT");
});

// ---------------------------------------------------------------------------
// CIR07/CIR08: purchase history requires LEVEL_3.
// ---------------------------------------------------------------------------

test("CIR07: customer_profile_history + L2 -> ONBOARDING_REQUIRED for L3", () => {
  const decision = evaluateCommercialIdentityRequirement("customer_profile_history", atLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED", { masterCustomerId: "700" }));
  assert.equal(decision.status, "ONBOARDING_REQUIRED");
  if (decision.status === "ONBOARDING_REQUIRED") {
    assert.equal(decision.requiredLevel, "LEVEL_3_PRESTASHOP_LINKED");
    assert.equal(decision.policyCode, "PRESTASHOP_IDENTITY_REQUIRED");
  }
});

test("CIR08: customer_profile_history + L3 -> SUFFICIENT", () => {
  const decision = evaluateCommercialIdentityRequirement(
    "customer_profile_history",
    atLevel("LEVEL_3_PRESTASHOP_LINKED", "PRESTASHOP_LINKED", { masterCustomerId: "700", prestashopCustomerId: "PS-1" })
  );
  assert.equal(decision.status, "SUFFICIENT");
  if (decision.status === "SUFFICIENT") assert.equal(decision.policyCode, "PRESTASHOP_IDENTITY_SUFFICIENT");
});

// ---------------------------------------------------------------------------
// CIR09/CIR10: READY_TO_LINK vs. NEEDS_VERIFICATION at the LEVEL_3 gap.
// ---------------------------------------------------------------------------

test("CIR09: requires L3 + READY_TO_LINK -> READY_TO_LINK, never a generic ONBOARDING_REQUIRED", () => {
  const decision = evaluateCommercialIdentityRequirement(
    "customer_profile_history",
    atLevel("LEVEL_2_MASTER_RESOLVED", "READY_TO_LINK", { masterCustomerId: "700", prestashopCustomerId: "PS-1", readyToLink: true })
  );
  assert.equal(decision.status, "READY_TO_LINK");
  if (decision.status === "READY_TO_LINK") assert.equal(decision.policyCode, "IDENTITY_READY_TO_LINK");
});

test("CIR10: requires L3 + NEEDS_VERIFICATION -> ONBOARDING_REQUIRED, requiredEvidence propagated as-is", () => {
  const decision = evaluateCommercialIdentityRequirement(
    "customer_profile_history",
    atLevel("LEVEL_1_CHANNEL_OBSERVED", "NEEDS_VERIFICATION", { verificationRequired: true, requiredEvidence: ["email"] })
  );
  assert.equal(decision.status, "ONBOARDING_REQUIRED");
  if (decision.status === "ONBOARDING_REQUIRED") {
    assert.deepEqual(decision.requiredEvidence, ["email"]);
    assert.equal(decision.policyCode, "IDENTITY_INFORMATION_MISSING");
  }
});

// ---------------------------------------------------------------------------
// CIR11/CIR12: conflict/system failure block only identity-dependent ops.
// ---------------------------------------------------------------------------

test("CIR11: create_quote + CONFLICT -> IDENTITY_CONFLICT", () => {
  const decision = evaluateCommercialIdentityRequirement(
    "create_quote",
    atLevel("LEVEL_2_MASTER_RESOLVED", "CONFLICT", { masterCustomerId: null, conflictCode: "PRESTASHOP_MASTER_CONFLICT" })
  );
  assert.equal(decision.status, "IDENTITY_CONFLICT");
  if (decision.status === "IDENTITY_CONFLICT") assert.equal(decision.policyCode, "IDENTITY_CONFLICT");
});

test("CIR12: create_quote + SYSTEM_UNAVAILABLE -> SYSTEM_WAIT", () => {
  const decision = evaluateCommercialIdentityRequirement("create_quote", atLevel("LEVEL_0_ANONYMOUS", "SYSTEM_UNAVAILABLE"));
  assert.equal(decision.status, "SYSTEM_WAIT");
  if (decision.status === "SYSTEM_WAIT") {
    assert.equal(decision.retryable, true);
    assert.equal(decision.policyCode, "IDENTITY_SYSTEM_UNAVAILABLE");
  }
});

// ---------------------------------------------------------------------------
// CIR13/CIR14: ambiguity is distinct from conflict, and only matters when identity is actually needed.
// ---------------------------------------------------------------------------

test("CIR13: search_products + AMBIGUOUS -> SUFFICIENT", () => {
  const decision = evaluateCommercialIdentityRequirement("search_products", atLevel("LEVEL_1_CHANNEL_OBSERVED", "AMBIGUOUS"));
  assert.equal(decision.status, "SUFFICIENT");
});

test("CIR14: create_quote + AMBIGUOUS -> AMBIGUITY_RESOLUTION_REQUIRED, never CONFLICT or a plain ONBOARDING_REQUIRED", () => {
  const decision = evaluateCommercialIdentityRequirement("create_quote", atLevel("LEVEL_1_CHANNEL_OBSERVED", "AMBIGUOUS"));
  assert.equal(decision.status, "AMBIGUITY_RESOLUTION_REQUIRED");
  assert.notEqual(decision.status, "IDENTITY_CONFLICT");
  assert.notEqual(decision.status, "ONBOARDING_REQUIRED");
  if (decision.status === "AMBIGUITY_RESOLUTION_REQUIRED") assert.equal(decision.policyCode, "IDENTITY_AMBIGUOUS");
});

// ---------------------------------------------------------------------------
// CIR15: LEVEL_4 is always its own requirement kind, never a standing level.
// ---------------------------------------------------------------------------

test("CIR15: order-specific operation + L3 -> ENTITY_VERIFICATION_REQUIRED, unconditionally", () => {
  const decision = evaluateCommercialIdentityRequirement(
    "order_status_entity_verification",
    atLevel("LEVEL_3_PRESTASHOP_LINKED", "PRESTASHOP_LINKED", { masterCustomerId: "700", prestashopCustomerId: "PS-1" })
  );
  assert.equal(decision.status, "ENTITY_VERIFICATION_REQUIRED");
  if (decision.status === "ENTITY_VERIFICATION_REQUIRED") assert.equal(decision.entityType, "order");
});

// ---------------------------------------------------------------------------
// CIR16/CIR17: the level comparator itself.
// ---------------------------------------------------------------------------

test("CIR16: L0 < L1 < L2 < L3, exact numeric ordering, never lexicographic", () => {
  const order: IdentityLevel[] = ["LEVEL_0_ANONYMOUS", "LEVEL_1_CHANNEL_OBSERVED", "LEVEL_2_MASTER_RESOLVED", "LEVEL_3_PRESTASHOP_LINKED"];
  for (let i = 0; i < order.length; i += 1) {
    for (let j = 0; j < order.length; j += 1) {
      assert.equal(isIdentityLevelAtLeast(order[i], order[j]), i >= j, `${order[i]} at least ${order[j]}`);
    }
  }
});

test("CIR17: LEVEL_4 is structurally absent from the minimum-level comparator", () => {
  assert.deepEqual(
    [...IDENTITY_LEVELS_IN_COMPARISON_ORDER].sort(),
    ["LEVEL_0_ANONYMOUS", "LEVEL_1_CHANNEL_OBSERVED", "LEVEL_2_MASTER_RESOLVED", "LEVEL_3_PRESTASHOP_LINKED"].sort()
  );
  assert.equal(IDENTITY_LEVELS_IN_COMPARISON_ORDER.length, 4);
});

// ---------------------------------------------------------------------------
// CIR18: assisted-sale handoff needs only the channel to be observed.
// ---------------------------------------------------------------------------

test("CIR18: assisted_sale_handoff requires only LEVEL_1 - sufficient at L1, never needs L2/L3", () => {
  const atL0 = evaluateCommercialIdentityRequirement("assisted_sale_handoff", atLevel("LEVEL_0_ANONYMOUS", "ANONYMOUS"));
  assert.equal(atL0.status, "ONBOARDING_REQUIRED");
  if (atL0.status === "ONBOARDING_REQUIRED") assert.equal(atL0.requiredLevel, "LEVEL_1_CHANNEL_OBSERVED");

  const atL1 = evaluateCommercialIdentityRequirement("assisted_sale_handoff", atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED"));
  assert.equal(atL1.status, "SUFFICIENT");

  const atL2 = evaluateCommercialIdentityRequirement("assisted_sale_handoff", atLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED", { masterCustomerId: "700" }));
  assert.equal(atL2.status, "SUFFICIENT", "already-resolved identity is still sufficient, never demoted");
});

// ---------------------------------------------------------------------------
// CIR19-CIR23: structural neutrality/purity.
// ---------------------------------------------------------------------------

const MODULE_FILES = ["types.ts", "operations.ts", "evaluate.ts", "index.ts"];
const MODULE_DIR = join(__dirname, "../../lib/brain/commercial/identity/commercial-identity-requirement");

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importRegex = /(?:import|export)\s+[^;]*?from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) specifiers.push(match[1]);
  return specifiers;
}

test("CIR19: checkout availability/config is never imported or read", () => {
  for (const file of MODULE_FILES) {
    const source = readFileSync(join(MODULE_DIR, file), "utf8");
    for (const specifier of importSpecifiers(source)) {
      assert.ok(!/checkout/i.test(specifier), `${file} must never import a checkout module (found "${specifier}")`);
    }
    assert.ok(!/process\.env/.test(source), `${file} must never read process.env`);
  }
});

test("CIR20: provider/channel is never read - RuntimeIdentityContext carries no such field and this policy never adds one", () => {
  const runtimeIdentityContextSource = readFileSync(
    join(__dirname, "../../lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext.ts"),
    "utf8"
  );
  // RuntimeIdentityContext's own type block (defensive - re-proves A05's own guarantee, the input this module reads).
  const typeBlockMatch = runtimeIdentityContextSource.match(/export type RuntimeIdentityContext = \{[\s\S]*?\n\};/);
  assert.ok(typeBlockMatch, "RuntimeIdentityContext type block must be found");
  assert.ok(!/\bprovider\b|\bchannel\b/i.test(typeBlockMatch![0]), "RuntimeIdentityContext must never carry a provider/channel field");

  for (const file of MODULE_FILES) {
    const source = readFileSync(join(MODULE_DIR, file), "utf8");
    assert.ok(!/\.provider\b|\.channel\b/.test(source), `${file} must never read a .provider/.channel property`);
  }
});

test("CIR21: policy never imports an LLM/agent-loop/planner module", () => {
  for (const file of MODULE_FILES) {
    const source = readFileSync(join(MODULE_DIR, file), "utf8");
    for (const specifier of importSpecifiers(source)) {
      assert.ok(!/agent-loop|planner|multi-request|\/llm\b/i.test(specifier), `${file} must never import an LLM/planner module (found "${specifier}")`);
    }
  }
});

test("CIR22: policy never imports the Capability Gateway or calls create_customer/link_external_identity", () => {
  for (const file of MODULE_FILES) {
    const source = readFileSync(join(MODULE_DIR, file), "utf8");
    for (const specifier of importSpecifiers(source)) {
      assert.ok(!/capability-gateway/i.test(specifier), `${file} must never import the Capability Gateway (found "${specifier}")`);
    }
    assert.ok(!/executeGovernedCapability\s*\(/.test(source), `${file} must never call executeGovernedCapability`);
  }
});

test("CIR23: policy never imports or writes CommercialWork", () => {
  for (const file of MODULE_FILES) {
    const source = readFileSync(join(MODULE_DIR, file), "utf8");
    for (const specifier of importSpecifiers(source)) {
      assert.ok(!/commercial\/work\b|\.\.\/work\b/i.test(specifier), `${file} must never import lib/brain/commercial/work (found "${specifier}")`);
    }
    assert.ok(!/crm_commercial_work/i.test(source), `${file} must never reference the crm_commercial_work table`);
  }
});

// ---------------------------------------------------------------------------
// CIR24: determinism.
// ---------------------------------------------------------------------------

test("CIR24: same operation + same RuntimeIdentityContext -> deterministic identical decision", () => {
  const identity = atLevel("LEVEL_1_CHANNEL_OBSERVED", "NEEDS_VERIFICATION", { verificationRequired: true, requiredEvidence: ["order_reference"] });
  const first = evaluateCommercialIdentityRequirement("customer_profile_history", identity);
  const second = evaluateCommercialIdentityRequirement("customer_profile_history", JSON.parse(JSON.stringify(identity)));
  assert.deepEqual(first, second);
});

// ---------------------------------------------------------------------------
// PARTE 1 catalog integrity: every capability-shaped operation name in this
// module's catalog must correspond to a real, currently-registered
// capability - never a stale or invented one. Imported here only (never in
// the production module itself, see CIR22).
// ---------------------------------------------------------------------------

test("catalog integrity: every capability-shaped CommercialOperation matches a real registered capability or a real non-capability module (never invented)", () => {
  const registeredCapabilities = new Set(CAPABILITY_GATEWAY_REGISTRY.map((definition) => definition.capability));
  const nonCapabilityOperations = new Set(["assisted_sale_handoff", "customer_profile_history", "order_status_entity_verification"]);
  for (const operation of COMMERCIAL_OPERATIONS) {
    if (nonCapabilityOperations.has(operation)) continue;
    assert.ok(registeredCapabilities.has(operation), `"${operation}" must be a real registered Capability Gateway capability`);
  }
  // Every CommercialWork-executable capability (the ones actually driving a
  // step) must also be represented in this catalog - never a silent gap.
  for (const capability of COMMERCIAL_WORK_STEP_CAPABILITIES) {
    assert.ok((COMMERCIAL_OPERATIONS as readonly string[]).includes(capability), `CommercialWork capability "${capability}" is missing from the identity requirement catalog`);
  }
});

test("catalog: getCommercialIdentityRequirement is defined for every declared operation", () => {
  for (const operation of COMMERCIAL_OPERATIONS) {
    assert.ok(getCommercialIdentityRequirement(operation), `missing requirement mapping for "${operation}"`);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { AGENT_LOOP_TOOL_POOL, buildToolDescriptions } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { buildAgentStepPromptPackage } from "@/lib/brain/commercial/agent-loop/buildAgentStepPromptPackage";
import { listObservedCatalogEvidenceTools } from "@/lib/brain/commercial/agent-loop/resolveObservedRecommendationSourceProduct";
import { resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT } from "@/lib/brain/commercial/sales-agent-configuration";
import type { CapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/types";

/**
 * SALES-AGENT-R3-CAPABILITY-SEMANTICS-COMMERCIAL-POLICY-V1. The task's own
 * gate (sections A-F). Complements tests/commercial/capabilityEvidenceSemantics.test.ts
 * (evidence classification, TR-B1-B2) and tests/agent-loop/buildAgentStepPromptPackage.test.ts
 * (per-rule prompt rendering) - neither is duplicated here.
 */

function definitionOf(capability: string): CapabilityGatewayDefinition {
  const definition = resolveCapabilityGatewayDefinition(capability);
  assert.ok(definition, `${capability} must resolve a Capability Gateway definition`);
  return definition;
}

const GATHERING_PROMPT_INPUT = {
  currentTime: "2026-01-01T00:00:00.000Z",
  customerMessage: "hola",
  commercialContextSummary: {},
  priorSteps: [],
  stepsRemaining: 3,
  identityConfiguration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT
};

function gatheringSystemPrompt(): string {
  return buildAgentStepPromptPackage({ ...GATHERING_PROMPT_INPUT, phase: "gathering", availableTools: buildToolDescriptions() }).messages[0].content;
}

function finalizationSystemPrompt(): string {
  return buildAgentStepPromptPackage({ ...GATHERING_PROMPT_INPUT, phase: "finalization", stepsRemaining: 0, availableTools: [] }).messages[0].content;
}

// ---------------------------------------------------------------------------
// A. Inventory
// ---------------------------------------------------------------------------

test("[A] every one of the 11 AGENT_LOOP_TOOL_POOL capabilities resolves a Capability Gateway definition", () => {
  assert.equal(AGENT_LOOP_TOOL_POOL.length, 11);
  for (const capability of AGENT_LOOP_TOOL_POOL) {
    assert.equal(definitionOf(capability).capability, capability);
  }
});

// ---------------------------------------------------------------------------
// B. Semantics - every model-facing capability states its boundary
// ---------------------------------------------------------------------------

test("[B] every pool capability declares a non-trivial description, useWhen and doNotUseWhen", () => {
  for (const capability of AGENT_LOOP_TOOL_POOL) {
    const definition = definitionOf(capability);
    assert.ok((definition.description ?? "").trim().length > 80, `${capability}.description must state purpose and what it produces`);
    assert.ok((definition.useWhen ?? "").trim().length > 40, `${capability}.useWhen must state the class of unresolved problem it solves`);
    assert.ok((definition.doNotUseWhen ?? "").trim().length > 40, `${capability}.doNotUseWhen must state which problems belong to another capability`);
  }
});

test("[B] useWhen/doNotUseWhen are bare clauses - renderToolLine supplies the connector and the period itself", () => {
  // A string that repeated the connector rendered as "Use when: Use when ... ."
  // - the real defect this convention exists to prevent (it shipped in
  // search_products_by_semantics' first version).
  for (const capability of AGENT_LOOP_TOOL_POOL) {
    const definition = definitionOf(capability);
    for (const [field, value] of [
      ["useWhen", definition.useWhen!],
      ["doNotUseWhen", definition.doNotUseWhen!]
    ] as const) {
      assert.doesNotMatch(value, /^(Use when|Do not use|Only use)/i, `${capability}.${field} must not repeat the connector renderToolLine adds`);
      assert.doesNotMatch(value, /\.$/, `${capability}.${field} must not end with a period - renderToolLine adds it`);
      assert.equal(value, value.trim(), `${capability}.${field} must not be padded`);
    }
  }
});

test("[B] no capability's boundary prose is a customer-phrasing trigger", () => {
  // The prohibited shape is "if the customer says <words> -> use this tool".
  // Describing the customer's SITUATION is the whole point of useWhen and is
  // not what this forbids - quoted phrasings and literal keyword lists are.
  for (const capability of AGENT_LOOP_TOOL_POOL) {
    const definition = definitionOf(capability);
    for (const value of [definition.useWhen!, definition.doNotUseWhen!]) {
      // Straight apostrophes are ordinary English possessives here - only a
      // QUOTED phrase would be a wording trigger.
      assert.doesNotMatch(value, /["“”«»]/, `${capability} boundary prose must never quote a customer phrase`);
      assert.doesNotMatch(value, /\bkeyword|\bsays\b|\bphrase\b/i, `${capability} boundary prose must never route from wording`);
    }
  }
});

// ---------------------------------------------------------------------------
// C. Projection
// ---------------------------------------------------------------------------

test("[C] buildToolDescriptions projects every pool capability's useWhen/doNotUseWhen straight from its definition", () => {
  const descriptions = buildToolDescriptions();
  assert.deepEqual(
    descriptions.map((tool) => tool.name),
    [...AGENT_LOOP_TOOL_POOL],
    "the projection is the pool itself, in pool order - never a filtered or re-ranked subset"
  );
  for (const tool of descriptions) {
    const definition = definitionOf(tool.name);
    assert.equal(tool.description, definition.description);
    assert.equal(tool.useWhen, definition.useWhen);
    assert.equal(tool.doNotUseWhen, definition.doNotUseWhen);
    assert.equal(tool.operationSemantics, definition.operationSemantics);
    assert.equal(tool.inputSchema, definition.inputSchema);
  }
});

test("[C] the rendered gathering prompt carries one 'Use when'/'Do not use when' clause per pool capability", () => {
  const system = gatheringSystemPrompt();
  for (const capability of AGENT_LOOP_TOOL_POOL) {
    const definition = definitionOf(capability);
    assert.ok(system.includes(`Use when: ${definition.useWhen}.`), `${capability} useWhen must render exactly once, with the connector and period supplied by the renderer`);
    assert.ok(system.includes(`Do not use when: ${definition.doNotUseWhen}.`), `${capability} doNotUseWhen must render the same way`);
  }
  assert.doesNotMatch(system, /Use when: Use when/);
  assert.doesNotMatch(system, /Do not use when: Do not use/);
});

test("[C] finalization never renders the tool catalog or any capability boundary prose", () => {
  const system = finalizationSystemPrompt();
  assert.doesNotMatch(system, /Use when:/);
  assert.doesNotMatch(system, /Do not use when:/);
});

// ---------------------------------------------------------------------------
// D. Architecture - semantics, never routing
// ---------------------------------------------------------------------------

const ROUTING_SURFACE_FILES = [
  "lib/brain/commercial/agent-loop/runAgentToolLoop.ts",
  "lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts",
  "lib/brain/commercial/capability-gateway/registry.ts",
  "lib/brain/commercial/capability-gateway/searchProductsBySemanticsCapability.ts",
  "lib/brain/commercial/capability-gateway/catalogRecommendationGatewayAdapter.ts",
  "lib/brain/commercial/capability-gateway/companyKnowledgeCapability.ts",
  "lib/brain/commercial/capability-gateway/shippingDestinationCapability.ts",
  "lib/brain/commercial/capability-gateway/selectProductsCapability.ts",
  "lib/brain/commercial/capability-gateway/calculateShippingCapability.ts",
  "lib/brain/commercial/capability-gateway/selectShippingOptionCapability.ts",
  "lib/brain/commercial/capability-gateway/createQuoteCapability.ts"
];

/**
 * Identifiers that only ever exist to route a message to a capability
 * deterministically - the second planner/router this task forbids.
 * `keyword` is deliberately absent: companyKnowledgeCapability owns a real
 * lexical fixture search INSIDE one capability, which is retrieval, not
 * capability selection.
 */
const FORBIDDEN_ROUTING_IDENTIFIERS = [/currentIntent/, /conversationStage/, /workflowGraph/, /INTENT_TO_/, /_BY_INTENT/, /TOOL_FOR_/, /intentRouter/i];

test("[D] no capability-selection surface introduces an intent router, an intent->tool map, or a workflow graph", () => {
  for (const relativePath of ROUTING_SURFACE_FILES) {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8");
    // Strip block comments: the prose that DESCRIBES what is forbidden (and
    // conversationContinuity's own "this is exactly what it is NOT" note)
    // must not trip the guard - only real code does.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const pattern of FORBIDDEN_ROUTING_IDENTIFIERS) {
      assert.doesNotMatch(code, pattern, `${relativePath} must not contain ${pattern} - capability choice belongs to the model, not the runtime`);
    }
  }
});

test("[D] buildToolDescriptions has no selection branch - the same 11 tools are offered on every call", () => {
  const first = buildToolDescriptions().map((tool) => tool.name);
  const second = buildToolDescriptions().map((tool) => tool.name);
  assert.deepEqual(first, second);
  assert.deepEqual(first, [...AGENT_LOOP_TOOL_POOL]);
});

// ---------------------------------------------------------------------------
// E. Contracts unchanged - this task only added prose
// ---------------------------------------------------------------------------

type ContractRow = {
  sideEffect: "read_only" | "mutating";
  riskClass: "low" | "medium" | "high";
  evidenceProduced: string[] | null;
  evidenceRequired: string[] | null;
  operationSemantics: string | null;
  schemaRequired: string[];
  schemaProperties: string[];
};

/** Frozen before this task's prose edits, from the live registry. */
const EXPECTED_CONTRACTS: Record<string, ContractRow> = {
  search_products: {
    sideEffect: "read_only",
    riskClass: "low",
    evidenceProduced: ["PRODUCT_IDENTITY"],
    evidenceRequired: null,
    operationSemantics: null,
    schemaRequired: ["query"],
    schemaProperties: ["limit", "query"]
  },
  get_product_details: {
    sideEffect: "read_only",
    riskClass: "low",
    evidenceProduced: ["PRODUCT_IDENTITY", "CURRENT_PRODUCT_DETAILS"],
    evidenceRequired: null,
    operationSemantics: null,
    schemaRequired: ["productId"],
    schemaProperties: ["combinationId", "productId"]
  },
  search_company_knowledge: {
    sideEffect: "read_only",
    riskClass: "low",
    evidenceProduced: null,
    evidenceRequired: null,
    operationSemantics: null,
    schemaRequired: ["query"],
    schemaProperties: ["query"]
  },
  explore_catalog: {
    sideEffect: "read_only",
    riskClass: "low",
    evidenceProduced: ["PRODUCT_IDENTITY"],
    evidenceRequired: null,
    operationSemantics: null,
    schemaRequired: ["sort", "limit"],
    schemaProperties: ["availability", "categoryId", "categorySlug", "limit", "price", "productType", "query", "sort"]
  },
  search_products_by_semantics: {
    sideEffect: "read_only",
    riskClass: "low",
    evidenceProduced: ["PRODUCT_IDENTITY", "SEMANTIC_ELIGIBILITY"],
    evidenceRequired: null,
    operationSemantics: null,
    schemaRequired: ["requirements"],
    schemaProperties: ["expectedSnapshots", "limit", "requirements", "schemaVersion"]
  },
  recommend_catalog_products: {
    sideEffect: "read_only",
    riskClass: "low",
    evidenceProduced: ["PRODUCT_IDENTITY"],
    evidenceRequired: null,
    operationSemantics: null,
    schemaRequired: ["sourceProduct"],
    schemaProperties: ["excludedProducts", "explicitRepurchaseRequested", "inStockOnly", "limit", "query", "sourceProduct"]
  },
  set_shipping_destination: {
    sideEffect: "mutating",
    riskClass: "low",
    evidenceProduced: null,
    evidenceRequired: null,
    operationSemantics: null,
    schemaRequired: ["destination"],
    schemaProperties: ["destination"]
  },
  select_products: {
    sideEffect: "mutating",
    riskClass: "low",
    evidenceProduced: ["COMMERCIAL_SELECTION_STATE"],
    evidenceRequired: ["PRODUCT_IDENTITY"],
    operationSemantics: "FULL_REPLACEMENT",
    schemaRequired: ["items"],
    schemaProperties: ["items"]
  },
  calculate_shipping: {
    sideEffect: "read_only",
    riskClass: "low",
    evidenceProduced: null,
    evidenceRequired: null,
    operationSemantics: null,
    schemaRequired: [],
    schemaProperties: []
  },
  select_shipping_option: {
    sideEffect: "mutating",
    riskClass: "low",
    evidenceProduced: null,
    evidenceRequired: null,
    operationSemantics: null,
    schemaRequired: ["optionIndex"],
    schemaProperties: ["optionIndex"]
  },
  create_quote: {
    sideEffect: "mutating",
    riskClass: "medium",
    evidenceProduced: ["QUOTE_CREATED"],
    evidenceRequired: null,
    operationSemantics: "CREATE_SNAPSHOT",
    schemaRequired: [],
    schemaProperties: []
  }
};

test("[E] governance, evidence semantics, operationSemantics and inputSchema are unchanged for all 11 pool capabilities", () => {
  for (const capability of AGENT_LOOP_TOOL_POOL) {
    const definition = definitionOf(capability);
    const schema = definition.inputSchema as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    const actual: ContractRow = {
      sideEffect: definition.governance.sideEffect,
      riskClass: definition.governance.riskClass,
      evidenceProduced: definition.evidenceProduced ?? null,
      evidenceRequired: definition.evidenceRequired ?? null,
      operationSemantics: definition.operationSemantics ?? null,
      schemaRequired: schema?.required ?? [],
      schemaProperties: Object.keys(schema?.properties ?? {}).sort()
    };
    assert.deepEqual(actual, EXPECTED_CONTRACTS[capability], `${capability}'s contract must not change - this task only adds model-facing prose`);
    assert.equal(definition.governance.authority, "autonomous", `${capability} authority must be unchanged`);
  }
});

// ---------------------------------------------------------------------------
// F. Prompt - the two transversal policies are immutable and wired
// ---------------------------------------------------------------------------

test("[F] the capability-selection policy is in the immutable gathering prompt and never in finalization", () => {
  const gathering = gatheringSystemPrompt();
  assert.match(gathering, /Choose capabilities according to the unresolved problem they solve, the evidence and state they require, and the effect they produce\./);
  assert.match(gathering, /Do not choose a capability merely because words in the customer's message resemble its name or description\./);
  assert.match(gathering, /never repeat equivalent retrieval through a neighboring capability without a distinct purpose/);
  // Choosing a capability is impossible once the tool budget is spent.
  assert.doesNotMatch(finalizationSystemPrompt(), /Choose capabilities according to the unresolved problem/);
});

test("[F] the Commercial Behavior Policy is in the immutable prompt: all of it while gathering, its response-governing suffix in finalization", () => {
  const gathering = gatheringSystemPrompt();
  const finalization = finalizationSystemPrompt();

  const gatheringOnly = [
    /Actively move a qualified commercial conversation toward concrete purchase progress/,
    /proactively obtain its verified canonical product URL with get_product_details/,
    /do not routinely ask whether the customer wants the link/,
    /use recommend_catalog_products when a relevant relationship adds real commercial value/,
    /prefer progressing toward a real quote over keeping the conversation in unnecessary exploratory dialogue/
  ];
  const bothPhases = [
    /Never recommend additional products merely to force an upsell/,
    /favor the lowest-cost one when presenting or recommending them/,
    /Recommending the lowest-cost shipping alternative is not the same as selecting it/,
    /Never state or promise a quote from hypothetical interest/
  ];

  for (const pattern of gatheringOnly) {
    assert.match(gathering, pattern);
    assert.doesNotMatch(finalization, pattern, "capability-execution policy must never reach the phase that cannot call a capability");
  }
  for (const pattern of bothPhases) {
    assert.match(gathering, pattern);
    assert.match(finalization, pattern);
  }
});

test("[F] the prompt states the observed-product-evidence allowlist the runtime actually enforces, never a drifted copy", () => {
  const tools = listObservedCatalogEvidenceTools();
  assert.deepEqual(tools, ["explore_catalog", "get_product_details", "search_products", "search_products_by_semantics"]);
  const expected = tools.join(", ");
  const gathering = gatheringSystemPrompt();
  assert.ok(gathering.includes(`recommend_catalog_products requires sourceProduct.productId (and sourceProduct.combinationId, only when you mean one specific variant) to be a product already observed this conversation via ${expected}`));
  assert.ok(gathering.includes(`must be one already observed this conversation via ${expected}`));
});

test("[F] only get_product_details is declared sufficient evidence for a product link, in both phases", () => {
  for (const system of [gatheringSystemPrompt(), finalizationSystemPrompt()]) {
    assert.match(system, /get_product_details is the only sufficient evidence for a product link/);
    assert.match(system, /search_products, search_products_by_semantics, explore_catalog, recommend_catalog_products\) ever is/);
    assert.match(system, /Never share a product link that did not come from a get_product_details observation/);
  }
});

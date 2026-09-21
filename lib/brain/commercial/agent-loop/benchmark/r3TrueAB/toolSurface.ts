import { resolveCapabilityGatewayDefinition } from "../../../capability-gateway/registry";
import type { NativeToolDefinition } from "./nativeToolClient";

/**
 * SALES-AGENT-R3-P7.8-R. The MODEL-FACING tool contract for the true
 * autonomous harness. Two surfaces, both routed to the SAME Capability
 * Gateway capabilities (the adapter only maps a model-facing name/arguments
 * to a Gateway capability name/input - it never executes anything itself,
 * never touches a repository/DB/HTTP service, never relaxes a domain
 * requirement):
 *
 *  - CURRENT (variant B): every tool exactly as the R3 loop shows it to the
 *    model today: registry description + inputSchema + useWhen + doNotUseWhen
 *    + operationSemantics sentence. Verified against renderToolLine in tests.
 *  - THIN (variant C1): for the 7 capabilities the corpus exercises, a one
 *    sentence business description and the minimal input schema the real
 *    execution requires (quantity stays REQUIRED - C1 isolates contract
 *    complexity, not quantity semantics). The remaining tools keep their
 *    current contract so the tool SET is identical in A, B and C1.
 */

/** Mirror of AGENT_LOOP_TOOL_POOL (runAgentToolLoop.ts). Duplicated here on purpose: the true harness must not import the R3 loop module; a test asserts the two lists are equal. */
export const TRUE_HARNESS_TOOL_NAMES = [
  "search_products",
  "get_product_details",
  "search_company_knowledge",
  "explore_catalog",
  "search_products_by_semantics",
  "recommend_catalog_products",
  "set_shipping_destination",
  "select_products",
  "calculate_shipping",
  "select_shipping_option",
  "create_quote",
  "get_quote",
  "issue_quote",
  "send_quote_email"
] as const;

/** The seven capabilities the corpus exercises - the ones C1 thins. */
export const THIN_RELEVANT_TOOL_NAMES = ["search_products", "get_product_details", "select_products", "set_shipping_destination", "calculate_shipping", "create_quote", "get_quote"] as const;

// Same two sentences buildAgentStepPromptPackage.ts appends for these semantics classes (verified by test against renderToolLine).
const OPERATION_SEMANTICS_SENTENCES: Record<string, string> = {
  FULL_REPLACEMENT: "This call's arguments must represent the complete desired state after the operation, never only what changed - it replaces the entire previous state, it is not a delta or merge.",
  CREATE_SNAPSHOT: "This call creates a new snapshot from current backend state; it is not a delta or merge operation."
};

export type ToolSurfaceId = "current" | "thin";

export type ToolAdaptResult = { ok: true; capability: string; input: Record<string, unknown> } | { ok: false; errorCode: string };

export type ToolSurfaceStats = {
  toolCount: number;
  totalChars: number;
  descriptionChars: number;
  schemaChars: number;
  relevantToolChars: number;
  relevantDescriptionChars: number;
  relevantSchemaChars: number;
};

export type ToolSurface = {
  id: ToolSurfaceId;
  tools: NativeToolDefinition[];
  /** Deterministic model-facing name/arguments -> Gateway capability/input. Never executes. */
  adapt(name: string, args: Record<string, unknown>): ToolAdaptResult;
  stats: ToolSurfaceStats;
};

function currentDefinition(name: string): NativeToolDefinition {
  const definition = resolveCapabilityGatewayDefinition(name);
  const useWhen = definition?.useWhen ? ` Use when: ${definition.useWhen}.` : "";
  const doNotUseWhen = definition?.doNotUseWhen ? ` Do not use when: ${definition.doNotUseWhen}.` : "";
  const semantics = definition?.operationSemantics && OPERATION_SEMANTICS_SENTENCES[definition.operationSemantics] ? ` ${OPERATION_SEMANTICS_SENTENCES[definition.operationSemantics]}` : "";
  return {
    name,
    description: `${definition?.description ?? name}${useWhen}${doNotUseWhen}${semantics}`,
    parameters: (definition?.inputSchema as Record<string, unknown> | undefined) ?? { type: "object", properties: {} }
  };
}

const NO_ARGUMENTS = { type: "object", properties: {}, additionalProperties: false } as const;

/**
 * Thin model-facing contract (variant C1). Each entry states what the tool
 * does for the business in one sentence and lists only the arguments the real
 * execution requires. FROZEN before the smoke run.
 */
export const THIN_TOOL_DEFINITIONS: Readonly<Record<(typeof THIN_RELEVANT_TOOL_NAMES)[number], NativeToolDefinition>> = {
  search_products: {
    name: "search_products",
    description: "Find products in the catalog by name, model, brand or reference.",
    parameters: { type: "object", required: ["query"], properties: { query: { type: "string" } }, additionalProperties: false }
  },
  get_product_details: {
    name: "get_product_details",
    description: "Get a product's current price, stock, availability and public link.",
    parameters: { type: "object", required: ["productId"], properties: { productId: { type: "string" } }, additionalProperties: false }
  },
  select_products: {
    name: "select_products",
    description: "Save the products and quantities the customer has chosen (replaces the whole saved selection).",
    parameters: {
      type: "object",
      required: ["items"],
      properties: { items: { type: "array", items: { type: "object", required: ["productId", "quantity"], properties: { productId: { type: "string" }, quantity: { type: "integer" } }, additionalProperties: false } } },
      additionalProperties: false
    }
  },
  set_shipping_destination: {
    name: "set_shipping_destination",
    description: "Save the commune the customer wants the order delivered to.",
    parameters: { type: "object", required: ["destination"], properties: { destination: { type: "string" } }, additionalProperties: false }
  },
  calculate_shipping: { name: "calculate_shipping", description: "Calculate shipping options for the saved destination and saved products.", parameters: { ...NO_ARGUMENTS } },
  create_quote: { name: "create_quote", description: "Create a quote for the saved products.", parameters: { ...NO_ARGUMENTS } },
  get_quote: { name: "get_quote", description: "Get the current status of the customer's quote.", parameters: { ...NO_ARGUMENTS } }
};

function computeStats(tools: readonly NativeToolDefinition[]): ToolSurfaceStats {
  const relevant = new Set<string>(THIN_RELEVANT_TOOL_NAMES);
  const schemaChars = (tool: NativeToolDefinition) => JSON.stringify(tool.parameters).length;
  const relevantTools = tools.filter((tool) => relevant.has(tool.name));
  return {
    toolCount: tools.length,
    totalChars: tools.reduce((total, tool) => total + tool.name.length + tool.description.length + schemaChars(tool), 0),
    descriptionChars: tools.reduce((total, tool) => total + tool.description.length, 0),
    schemaChars: tools.reduce((total, tool) => total + schemaChars(tool), 0),
    relevantToolChars: relevantTools.reduce((total, tool) => total + tool.name.length + tool.description.length + schemaChars(tool), 0),
    relevantDescriptionChars: relevantTools.reduce((total, tool) => total + tool.description.length, 0),
    relevantSchemaChars: relevantTools.reduce((total, tool) => total + schemaChars(tool), 0)
  };
}

function buildSurface(id: ToolSurfaceId, tools: NativeToolDefinition[]): ToolSurface {
  const names = new Set(tools.map((tool) => tool.name));
  return {
    id,
    tools,
    // Both surfaces name their tools exactly like the Gateway capability they route to (identity mapping): the adapter is a pure pass-through of a validated name.
    adapt: (name, args) => (names.has(name) ? { ok: true, capability: name, input: args } : { ok: false, errorCode: "capability_not_registered" }),
    stats: computeStats(tools)
  };
}

export function buildCurrentToolSurface(): ToolSurface {
  return buildSurface("current", TRUE_HARNESS_TOOL_NAMES.map(currentDefinition));
}

export function buildThinToolSurface(): ToolSurface {
  const thinNames = new Set<string>(THIN_RELEVANT_TOOL_NAMES);
  return buildSurface(
    "thin",
    TRUE_HARNESS_TOOL_NAMES.map((name) => (thinNames.has(name) ? THIN_TOOL_DEFINITIONS[name as (typeof THIN_RELEVANT_TOOL_NAMES)[number]] : currentDefinition(name)))
  );
}

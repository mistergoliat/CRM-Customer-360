import type { SalesAgentToolName } from "../salesAgentTypes";

/**
 * Single, centralized map from the sales agent's LLM-facing tool vocabulary
 * (camelCase, fixed by BRAIN_TOOL_NAMES) to canonical snake_case Capability
 * Gateway names. This is the only place that translation may happen -
 * nothing else in the runtime may compare a tool name to a capability name
 * directly (ACS-R1-01.1 objective 4).
 */
const CAPABILITY_TOOL_ALIASES: Partial<Record<SalesAgentToolName, string>> = {
  searchProducts: "search_products"
};

/** The reverse map, built once so lookups by capability name are O(1) too. */
const SALES_AGENT_TOOL_BY_CAPABILITY = new Map<string, SalesAgentToolName>(
  (Object.entries(CAPABILITY_TOOL_ALIASES) as [SalesAgentToolName, string][]).map(([tool, capability]) => [capability, tool])
);

export function resolveCapabilityNameForSalesAgentTool(tool: SalesAgentToolName): string | null {
  return CAPABILITY_TOOL_ALIASES[tool] ?? null;
}

export function resolveSalesAgentToolForCapabilityName(capability: string): SalesAgentToolName | null {
  return SALES_AGENT_TOOL_BY_CAPABILITY.get(capability) ?? null;
}

/** Every LLM tool name that is backed by a registered Capability Gateway alias. */
export function listAliasedSalesAgentToolNames(): SalesAgentToolName[] {
  return Object.keys(CAPABILITY_TOOL_ALIASES) as SalesAgentToolName[];
}

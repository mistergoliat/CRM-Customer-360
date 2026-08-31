import { AGENT_LOOP_TOOL_POOL } from "../agent-loop/runAgentToolLoop";
import { resolveCapabilityGatewayDefinition } from "../capability-gateway/registry";
import { COMMERCIAL_ACTION_REQUEST_TYPES, type CommercialActionRequestType } from "../commercial-action-request/types";
import { getCapabilityMappingForActionType } from "../commercial-action-request/actionCapabilityMapping";
import { resolveAgentCapabilityExposure } from "./types";

// SALES-AGENT-R3-A04, Phase 6/12. A provider-neutral description of what the
// model may do, split into the two structurally disjoint surfaces (Phase 6
// forbids flattening them into one undifferentiated list). This is a NEW
// domain type, not a second registry: every field is read straight from the
// Capability Gateway (description/inputSchema) and the R3-A03 action mapping
// (actionType/capability) - never redefined here.
//
// Deliberately not wired into runAgentToolLoop.ts's own buildToolDescriptions()
// in this slice: that function's output feeds the LIVE prompt today, and
// Phase 7 requires preserving existing customer-visible semantics unchanged.
// This catalog exists as the intermediate, provider-neutral shape a future
// SalesAgentHarness's own prompt/tool-schema builder can render differently
// (e.g. attaching surfaceNote) without depending on DeepSeek-specific JSON -
// see Phase 12's "do not implement several serializers now" instruction.

export type AgentReadToolDescriptor = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  /** Fixed framing text a future Harness prompt/tool-schema builder may attach - never mixed into `description` (that stays the capability's own, unmodified). */
  surfaceNote: string;
};

export type AgentCommercialActionDescriptor = {
  actionType: CommercialActionRequestType;
  capability: string;
  description: string;
  inputSchema: Record<string, unknown>;
  surfaceNote: string;
};

export type AgentToolCatalog = {
  readTools: AgentReadToolDescriptor[];
  commercialActions: AgentCommercialActionDescriptor[];
};

export const READ_TOOL_SURFACE_NOTE = "Invoke this tool to retrieve information. It has no business side effect.";
export const COMMERCIAL_ACTION_SURFACE_NOTE =
  "Request this commercial action. The request may be denied, blocked, require identity, or fail. Requesting it does not authorize execution.";

/**
 * Derived from AGENT_LOOP_TOOL_POOL filtered to READ_TOOL, never a second
 * hardcoded tool list - a pool entry missing its READ_TOOL/COMMERCIAL_ACTION
 * classification is a test failure (agentCapabilityExposure.test.ts), not a
 * silent gap here.
 */
export function buildAgentToolCatalog(): AgentToolCatalog {
  const readTools: AgentReadToolDescriptor[] = AGENT_LOOP_TOOL_POOL.filter((tool) => resolveAgentCapabilityExposure(tool) === "READ_TOOL").map((tool) => {
    const definition = resolveCapabilityGatewayDefinition(tool);
    return { name: tool, description: definition?.description ?? tool, inputSchema: definition?.inputSchema, surfaceNote: READ_TOOL_SURFACE_NOTE };
  });

  const commercialActions: AgentCommercialActionDescriptor[] = COMMERCIAL_ACTION_REQUEST_TYPES.map((actionType) => {
    const mapping = getCapabilityMappingForActionType(actionType);
    const definition = resolveCapabilityGatewayDefinition(mapping.capability);
    return {
      actionType,
      capability: mapping.capability,
      description: definition?.description ?? mapping.capability,
      inputSchema: mapping.inputSchema,
      surfaceNote: COMMERCIAL_ACTION_SURFACE_NOTE
    };
  });

  return { readTools, commercialActions };
}

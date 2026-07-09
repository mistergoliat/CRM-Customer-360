import { executeGovernedCapability } from "../capability-gateway/executeCapability";
import { resolveCapabilityGatewayDefinition } from "../capability-gateway/registry";
import { resolveCapabilityNameForSalesAgentTool } from "../capability-gateway/toolAliases";
import type { CapabilityGatewayContext, CapabilityGatewayResult } from "../capability-gateway/types";
import type { SalesAgentToolRequest } from "../sales-agent/validationTypes";
import type { CommercialShadowResult } from "../shadow";

export type CapabilityExecutionStageInput = {
  shadow: CommercialShadowResult | null;
  conversationId: number;
  opportunityId: number | string | null;
  correlationId: string;
};

export type CapabilityExecutionStageExecution = {
  toolRequest: SalesAgentToolRequest;
  capability: string;
  result: CapabilityGatewayResult;
};

export type CapabilityExecutionStageResult = {
  executions: CapabilityExecutionStageExecution[];
};

function buildCapabilityInput(toolRequest: SalesAgentToolRequest): Record<string, unknown> {
  return { ...(toolRequest.optionalInputs ?? {}), ...(toolRequest.requiredInputs ?? {}) };
}

/**
 * Generic capability-execution stage (ACS-R1-01.1 objective 5). Runs after
 * the operational loop, before any projection. For every kept tool request
 * that resolves - via the single centralized alias table - to a capability
 * registered in the Capability Gateway, executes it once through
 * executeGovernedCapability. Adding a new governed capability only requires
 * a registry entry and an alias; this loop never changes.
 *
 * Tool-specific interpretation of a result (e.g. grounding a customer
 * message in catalog data) is intentionally not done here - see
 * buildCatalogGroundedMessage for that projector.
 */
export async function runCapabilityExecutionStage(input: CapabilityExecutionStageInput): Promise<CapabilityExecutionStageResult> {
  const toolRequests = input.shadow?.context?.policyResult?.governedResult.toolRequests ?? [];
  const gatewayContext: CapabilityGatewayContext = {
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    opportunityId: typeof input.opportunityId === "number" ? input.opportunityId : null
  };

  const executions: CapabilityExecutionStageExecution[] = [];
  for (const toolRequest of toolRequests) {
    const capability = resolveCapabilityNameForSalesAgentTool(toolRequest.tool);
    if (!capability || !resolveCapabilityGatewayDefinition(capability)) continue;
    const result = await executeGovernedCapability(capability, buildCapabilityInput(toolRequest), gatewayContext);
    executions.push({ toolRequest, capability, result });
  }

  return { executions };
}

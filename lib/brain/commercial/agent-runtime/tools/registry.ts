import type { SalesConsultativeOperationsRepository, SalesConsultativeProductRepository } from "../../sales-consultative/types";
import type { AgentProviderToolSpec } from "../provider/types";
import { createCatalogTools } from "./catalog";
import { createCustomerContextTool } from "./customer";
import { createFollowUpTool } from "./followup";
import { createHandoffTool } from "./handoff";
import { createOpportunityTool } from "./opportunity";
import type { AgentToolDefinition } from "./types";

export function buildAgentToolRegistry(input: {
  productRepository: SalesConsultativeProductRepository;
  operationsRepository: SalesConsultativeOperationsRepository;
}): Map<string, AgentToolDefinition> {
  const tools: AgentToolDefinition[] = [
    createCustomerContextTool(),
    ...createCatalogTools(input.productRepository),
    createOpportunityTool(input.operationsRepository),
    createFollowUpTool(input.operationsRepository),
    createHandoffTool(input.operationsRepository)
  ];
  return new Map(tools.map((tool) => [tool.name, tool]));
}

export function toProviderToolSpecs(registry: Map<string, AgentToolDefinition>): AgentProviderToolSpec[] {
  return [...registry.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
}

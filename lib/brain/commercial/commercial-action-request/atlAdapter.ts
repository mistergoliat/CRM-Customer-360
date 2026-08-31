import type { AgentStepUseTool } from "../agent-loop/agentStepTypes";
import { getActionTypeForCapability } from "./actionCapabilityMapping";
import { buildCommercialActionRequestId } from "./requestIdentity";
import type {
  CommercialActionRequest,
  CreateQuoteActionInput,
  SelectProductsActionInput,
  SelectShippingOptionActionInput,
  SetShippingDestinationActionInput
} from "./types";

// SALES-AGENT-R3-A03, Phase 9. Adapts an already-authorized ATL use_tool step
// into a CommercialActionRequest - never a rewrite of runAgentToolLoop.ts
// itself. Returns null for a tool this boundary does not cover (every
// read-only tool, and any future mutating tool not yet mapped in
// actionCapabilityMapping.ts) - the caller keeps calling
// executeGovernedCapability directly for those, byte-for-byte unchanged.
//
// Runs strictly AFTER processUseToolStep's own dedupe/evidence checks
// (recommend_catalog_products' sourceProduct, select_products' item
// evidence) - this adapter only ever sees a step that already passed them,
// preserving existing customer-visible behavior exactly.

export type AtlCommercialActionRequestSourceInput = {
  step: AgentStepUseTool;
  conversationId: number | null;
  opportunityId: number | null;
  correlationId: string;
  /** The inbound message id this turn is answering - the causation for the resulting request. Null when unavailable (e.g. a benchmark/test harness). */
  inboundMessageId: string | null;
  now?: () => Date;
};

export function buildCommercialActionRequestFromAtlStep(input: AtlCommercialActionRequestSourceInput): CommercialActionRequest | null {
  if (input.conversationId === null) return null;

  const actionType = getActionTypeForCapability(input.step.tool);
  if (!actionType) return null;

  const causationId = input.inboundMessageId ?? null;
  const createdAt = (input.now ?? (() => new Date()))().toISOString();

  const base = {
    conversationId: input.conversationId,
    opportunityId: input.opportunityId,
    correlationId: input.correlationId,
    causationId,
    source: "agent_tool_loop" as const,
    createdAt
  };

  switch (actionType) {
    case "SELECT_PRODUCTS": {
      const requestInput = input.step.arguments as SelectProductsActionInput;
      return {
        ...base,
        actionType,
        input: requestInput,
        requestId: buildCommercialActionRequestId({ conversationId: input.conversationId, causationId, actionType, input: requestInput })
      };
    }
    case "SET_SHIPPING_DESTINATION": {
      const requestInput = input.step.arguments as SetShippingDestinationActionInput;
      return {
        ...base,
        actionType,
        input: requestInput,
        requestId: buildCommercialActionRequestId({ conversationId: input.conversationId, causationId, actionType, input: requestInput })
      };
    }
    case "SELECT_SHIPPING_OPTION": {
      const requestInput = input.step.arguments as SelectShippingOptionActionInput;
      return {
        ...base,
        actionType,
        input: requestInput,
        requestId: buildCommercialActionRequestId({ conversationId: input.conversationId, causationId, actionType, input: requestInput })
      };
    }
    case "CREATE_QUOTE": {
      // create_quote takes no arguments by contract (CREATE_QUOTE_INPUT_SCHEMA)
      // - the model's raw arguments are never trusted here even if empty.
      const requestInput: CreateQuoteActionInput = {};
      return {
        ...base,
        actionType,
        input: requestInput,
        requestId: buildCommercialActionRequestId({ conversationId: input.conversationId, causationId, actionType, input: requestInput })
      };
    }
  }
}

import type { CapabilityGatewayResult } from "../capability-gateway/types";

// SALES-AGENT-R3-A03. The canonical R3 boundary between agent reasoning and
// commercial mutation. A CommercialActionRequest is a REQUEST, never proof
// the action is valid - validation, the R3-A02 shared identity gate, and
// executeGovernedCapability all still run before any domain side effect can
// occur (see executeCommercialActionRequest.ts).
//
// Naming note: lib/brain/commercial/action-lifecycle/types.ts already
// exports an unrelated `CommercialActionType` (the legacy dispatch-action
// vocabulary - send_whatsapp_reply/schedule_followup/take_over_case/... - a
// different action model entirely, for CRM operator-facing dispatch actions,
// never Capability Gateway mutations). This module deliberately never reuses
// that name - see CommercialActionRequestType below.

export type CommercialActionRequestSource = "agent_tool_loop" | "multi_intent" | "commercial_work" | "sales_agent_harness";

/**
 * Phase 2. Initial supported actions map ONLY to already-existing, already
 * safely-executable mutating capabilities (capability-gateway/registry.ts) -
 * never a new capability, never order creation/discounts/refunds.
 */
export const COMMERCIAL_ACTION_REQUEST_TYPES = ["SELECT_PRODUCTS", "SET_SHIPPING_DESTINATION", "SELECT_SHIPPING_OPTION", "CREATE_QUOTE"] as const;
export type CommercialActionRequestType = (typeof COMMERCIAL_ACTION_REQUEST_TYPES)[number];

export type SelectProductsActionInput = {
  items: Array<{ productId: string; combinationId?: string; quantity: number }>;
};

export type SetShippingDestinationActionInput = {
  destination: string;
};

export type SelectShippingOptionActionInput = {
  optionIndex: number;
};

/** create_quote takes no arguments - everything is backend state (createQuoteCapability.ts). */
export type CreateQuoteActionInput = Record<string, never>;

type CommercialActionRequestBase = {
  requestId: string;
  conversationId: number;
  opportunityId: number | null;
  correlationId: string;
  /** What caused this request - usually the inbound message id. Null only when no such causation exists. */
  causationId: string | null;
  source: CommercialActionRequestSource;
  createdAt: string;
};

export type CommercialActionRequest =
  | (CommercialActionRequestBase & { actionType: "SELECT_PRODUCTS"; input: SelectProductsActionInput })
  | (CommercialActionRequestBase & { actionType: "SET_SHIPPING_DESTINATION"; input: SetShippingDestinationActionInput })
  | (CommercialActionRequestBase & { actionType: "SELECT_SHIPPING_OPTION"; input: SelectShippingOptionActionInput })
  | (CommercialActionRequestBase & { actionType: "CREATE_QUOTE"; input: CreateQuoteActionInput });

/**
 * Phase 7. Mapped from CapabilityGatewayExecutionStatus (see
 * resultMapping in executeCommercialActionRequest.ts) - never a second,
 * incompatible taxonomy.
 */
export const COMMERCIAL_ACTION_RESULT_STATUSES = [
  "COMPLETED",
  "DENIED",
  "BLOCKED",
  "FAILED",
  "RETRYABLE",
  "REQUIRES_CUSTOMER_INPUT",
  "REQUIRES_REVIEW"
] as const;
export type CommercialActionResultStatus = (typeof COMMERCIAL_ACTION_RESULT_STATUSES)[number];

export type CommercialActionResult = {
  requestId: string;
  actionType: CommercialActionRequestType;
  capability: string;
  status: CommercialActionResultStatus;
  /** Structural evidence only (the capability's own outcome.data) - never raw model output, hidden reasoning, or PII. */
  data: Record<string, unknown> | null;
  errorCode: string | null;
  retryable: boolean;
  /**
   * Always populated - either the real CapabilityGatewayResult from
   * executeGovernedCapability, or a synthesized result in the exact same
   * shape for a request rejected before reaching the Gateway (validation,
   * unknown action type, or the identity gate). Callers that already
   * understand CapabilityGatewayResult (e.g. buildToolObservation) never
   * need a second, incompatible shape.
   */
  gatewayResult: CapabilityGatewayResult;
};

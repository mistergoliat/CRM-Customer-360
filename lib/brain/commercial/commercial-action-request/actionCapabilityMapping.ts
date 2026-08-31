import { CREATE_QUOTE_INPUT_SCHEMA } from "../capability-gateway/createQuoteCapability";
import { SELECT_PRODUCTS_INPUT_SCHEMA } from "../capability-gateway/selectProductsCapability";
import { SELECT_SHIPPING_OPTION_INPUT_SCHEMA } from "../capability-gateway/selectShippingOptionCapability";
import { SET_SHIPPING_DESTINATION_INPUT_SCHEMA } from "../capability-gateway/shippingDestinationCapability";
import type { CommercialActionRequestType } from "./types";

// SALES-AGENT-R3-A03, Phase 3. The single, explicit mapping from a
// CommercialActionRequestType to its Capability Gateway capability name and
// canonical input schema. Schemas are imported directly from each
// capability's own file - never a second, duplicated schema, matching the
// discipline CapabilityGatewayDefinition.inputSchema's own doc comment
// already establishes ("the single canonical source"). No runtime may
// reproduce this mapping with an ad-hoc switch.

export type CommercialActionCapabilityMapping = {
  capability: string;
  inputSchema: Record<string, unknown>;
};

const COMMERCIAL_ACTION_TO_CAPABILITY: Record<CommercialActionRequestType, CommercialActionCapabilityMapping> = {
  SELECT_PRODUCTS: { capability: "select_products", inputSchema: SELECT_PRODUCTS_INPUT_SCHEMA },
  SET_SHIPPING_DESTINATION: { capability: "set_shipping_destination", inputSchema: SET_SHIPPING_DESTINATION_INPUT_SCHEMA },
  SELECT_SHIPPING_OPTION: { capability: "select_shipping_option", inputSchema: SELECT_SHIPPING_OPTION_INPUT_SCHEMA },
  CREATE_QUOTE: { capability: "create_quote", inputSchema: CREATE_QUOTE_INPUT_SCHEMA }
};

const CAPABILITY_TO_COMMERCIAL_ACTION = new Map<string, CommercialActionRequestType>(
  (Object.entries(COMMERCIAL_ACTION_TO_CAPABILITY) as [CommercialActionRequestType, CommercialActionCapabilityMapping][]).map(([actionType, mapping]) => [
    mapping.capability,
    actionType
  ])
);

/** Exhaustive by construction - every CommercialActionRequestType has a real mapping entry. */
export function getCapabilityMappingForActionType(actionType: CommercialActionRequestType): CommercialActionCapabilityMapping {
  return COMMERCIAL_ACTION_TO_CAPABILITY[actionType];
}

/** Null for a capability this boundary does not (yet) support - the caller must fail closed, never guess a mapping. */
export function getActionTypeForCapability(capability: string): CommercialActionRequestType | null {
  return CAPABILITY_TO_COMMERCIAL_ACTION.get(capability) ?? null;
}

/** Every capability this boundary supports, for callers that need a membership check without a specific actionType in hand. */
export const COMMERCIAL_ACTION_SUPPORTED_CAPABILITIES: ReadonlySet<string> = new Set(CAPABILITY_TO_COMMERCIAL_ACTION.keys());

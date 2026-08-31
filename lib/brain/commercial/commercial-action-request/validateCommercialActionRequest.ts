import { getCapabilityMappingForActionType } from "./actionCapabilityMapping";
import { validateAgainstCapabilityInputSchema } from "./schemaValidation";
import { COMMERCIAL_ACTION_REQUEST_TYPES } from "./types";
import type { CommercialActionRequest, CommercialActionRequestType } from "./types";

// SALES-AGENT-R3-A03, Phase 4. Runtime boundary validation - never trusts the
// caller's TypeScript types alone (a request can be built by any future
// caller, not just the ATL adapter). Deliberately narrow: confirms the
// action type is registered and the input is schema-valid against the
// capability's own canonical schema; it does NOT re-implement business
// validation each capability's own execute() already owns (e.g. "is this
// opportunityId active", "was this product actually observed this
// conversation" - see selectProductsCapability.ts/the ATL evidence gate) -
// duplicating that here would be exactly the "unnecessary duplication"
// Phase 4 warns against.

export type CommercialActionRequestValidationResult = { valid: true } | { valid: false; reason: string };

function isKnownActionType(value: string): value is CommercialActionRequestType {
  return (COMMERCIAL_ACTION_REQUEST_TYPES as readonly string[]).includes(value);
}

export function validateCommercialActionRequest(request: CommercialActionRequest): CommercialActionRequestValidationResult {
  if (!isKnownActionType(request.actionType)) {
    return { valid: false, reason: "unknown_action_type" };
  }
  if (!Number.isInteger(request.conversationId) || request.conversationId <= 0) {
    return { valid: false, reason: "conversationId_required" };
  }
  if (!request.correlationId) {
    return { valid: false, reason: "correlationId_required" };
  }

  const mapping = getCapabilityMappingForActionType(request.actionType);
  const schemaCheck = validateAgainstCapabilityInputSchema(request.input, mapping.inputSchema);
  if (!schemaCheck.valid) {
    return { valid: false, reason: `invalid_input:${schemaCheck.reason}` };
  }

  return { valid: true };
}

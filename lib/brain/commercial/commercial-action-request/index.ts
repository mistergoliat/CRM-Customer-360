// SALES-AGENT-R3-A03. Public barrel for the CommercialActionRequest boundary.

export type {
  CommercialActionRequest,
  CommercialActionRequestSource,
  CommercialActionRequestType,
  CommercialActionResult,
  CommercialActionResultStatus,
  CreateQuoteActionInput,
  SelectProductsActionInput,
  SelectShippingOptionActionInput,
  SetShippingDestinationActionInput
} from "./types";
export { COMMERCIAL_ACTION_REQUEST_TYPES, COMMERCIAL_ACTION_RESULT_STATUSES } from "./types";

export type { CommercialActionCapabilityMapping } from "./actionCapabilityMapping";
export { COMMERCIAL_ACTION_SUPPORTED_CAPABILITIES, getActionTypeForCapability, getCapabilityMappingForActionType } from "./actionCapabilityMapping";

export { validateAgainstCapabilityInputSchema } from "./schemaValidation";
export { buildCommercialActionRequestId } from "./requestIdentity";
export type { CommercialActionRequestValidationResult } from "./validateCommercialActionRequest";
export { validateCommercialActionRequest } from "./validateCommercialActionRequest";

export {
  recordCommercialActionAccepted,
  recordCommercialActionRejected,
  recordCommercialActionRequested,
  recordCommercialActionTerminal,
  resetCommercialActionRequestSessionStoreForTests
} from "./sessionEvents";

export type { ExecuteCommercialActionRequestDependencies } from "./executeCommercialActionRequest";
export { executeCommercialActionRequest } from "./executeCommercialActionRequest";

export type { AtlCommercialActionRequestSourceInput } from "./atlAdapter";
export { buildCommercialActionRequestFromAtlStep } from "./atlAdapter";

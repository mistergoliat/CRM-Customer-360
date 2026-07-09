export { buildCommercialContext } from "./buildCommercialContext";
export type { CommercialContextBuilderInput, CommercialContextBuilderResult } from "./types";

export { buildNativeCommercialContext, COMMERCIAL_CONTEXT_CONTRACT_NAME, COMMERCIAL_CONTEXT_SCHEMA_VERSION } from "./buildNativeCommercialContext";
export type {
  BuildNativeCommercialContextInput,
  CommercialContextSnapshot,
  NativeCommercialContextAction,
  NativeCommercialContextCompleteness,
  NativeCommercialContextConversation,
  NativeCommercialContextCustomer,
  NativeCommercialContextIdentityConflict,
  NativeCommercialContextMessage,
  NativeCommercialContextSignals,
  NativeCommercialContextWarning
} from "./buildNativeCommercialContext";

export { projectAutonomousCustomerContext, AUTONOMOUS_CUSTOMER_CONTEXT_CONTRACT_NAME, AUTONOMOUS_CUSTOMER_CONTEXT_SCHEMA_VERSION } from "./autonomousCustomerContext";
export type { AutonomousCustomerContext } from "./autonomousCustomerContext";

export { loadAutonomousCustomerContext } from "./loadAutonomousCustomerContext";
export type {
  AutonomousCustomerContextLoadResult,
  AutonomousCustomerContextLoadState,
  AutonomousCustomerContextWarning,
  LoadAutonomousCustomerContextInput,
  LoadCustomer360Fn
} from "./loadAutonomousCustomerContext";


export {
  CUSTOMER_DEFAULT_IDENTITY_CONFIDENCE,
  CUSTOMER_DEFAULT_IDENTITY_SOURCE,
  CUSTOMER_DEFAULT_READ_ONLY_OPTIONS,
  CUSTOMER_IDENTITY_PRECEDENCE,
  CUSTOMER_NO_MERGE_REASONS,
  CUSTOMER_PROVISIONAL_IDENTITY_TYPES,
  CUSTOMER_STRONG_IDENTITY_TYPES,
} from "./constants";

export {
  buildChilePhoneCandidates,
  normalizeEmail,
  normalizeIdentityValue,
  normalizeLooseIdentifier,
  normalizePhoneChile,
  normalizeWaId,
} from "./normalize";

export {
  readMasterCustomerCandidate,
  readLegacyConversationCandidate,
  readLegacyInboundCandidate,
  readPrestashopAddressCandidate,
  readPrestashopCustomerCandidate,
  readPrestashopOrderCandidate,
} from "./sourceReaders";

export { resolveCustomerCandidate } from "./resolveCustomerCandidate";

export type {
  CustomerIdentityConfidence,
  CustomerIdentityReadModel,
  CustomerIdentityResolution,
  CustomerIdentityResolutionInput,
  CustomerIdentityResolutionReason,
  CustomerIdentityResolutionResult,
  CustomerIdentityResolutionStatus,
  CustomerIdentitySource,
  CustomerIdentityType,
  CustomerLifecycleStage,
  CustomerMasterReadModel,
  CustomerResolutionMetadata,
  CustomerResolutionMode,
  CustomerSourceMatch,
  CustomerTimelineSeed,
  CustomerWritePolicy,
} from "./types";

export {
  CUSTOMER_IDENTITY_CONFIDENCE_LEVELS,
  CUSTOMER_IDENTITY_RESOLUTION_STATUSES,
  CUSTOMER_IDENTITY_SOURCES,
  CUSTOMER_IDENTITY_TYPES,
  CUSTOMER_LIFECYCLE_STAGES,
} from "./types";

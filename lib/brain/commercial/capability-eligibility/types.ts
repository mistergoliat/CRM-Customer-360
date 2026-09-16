import type { CapabilitySideEffect } from "../capability-gateway/types";
import type { CommercialIdentityRequirement } from "../identity/commercial-identity-requirement/types";

/**
 * P6 structural eligibility is advisory readiness only. The Capability
 * Gateway remains the authority for policy, runtime availability, arguments
 * and every eventual side effect.
 */
export const CAPABILITY_ELIGIBILITY_STATUSES = ["ELIGIBLE", "BLOCKED"] as const;
export type CapabilityEligibilityStatus = (typeof CAPABILITY_ELIGIBILITY_STATUSES)[number];

export const CAPABILITY_ELIGIBILITY_REASON_CODES = [
  "OBJECTIVE_REQUIRED",
  "OBJECTIVE_INCOMPATIBLE",
  "MISSING_SELECTION",
  "SELECTION_NOT_CURRENT",
  "IDENTITY_LEVEL_INSUFFICIENT",
  "MISSING_QUOTE",
  "QUOTE_NOT_CURRENT",
  "MISSING_DESTINATION",
  "DESTINATION_NOT_CURRENT"
] as const;
export type CapabilityEligibilityReasonCode = (typeof CAPABILITY_ELIGIBILITY_REASON_CODES)[number];

export type CapabilityEligibilityObjectiveType = "SELECT_PRODUCTS" | "QUOTE";
export type CapabilityEligibilityPrerequisite = "CURRENT_SELECTION" | "CURRENT_DESTINATION" | "CURRENT_QUOTE";

/**
 * Deliberately excludes executionClass and runtime availability. The former
 * is always derived from the Capability Gateway registry; the latter belongs
 * to P7/Gateway execution and must never be guessed by P6.
 */
export type CapabilityEligibilityDefinition = {
  readonly capability: string;
  readonly supportedObjectives: readonly CapabilityEligibilityObjectiveType[] | null;
  readonly prerequisites: readonly CapabilityEligibilityPrerequisite[];
};

export type ResolvedCapabilityEligibilityDefinition = CapabilityEligibilityDefinition & {
  readonly executionClass: CapabilitySideEffect;
  readonly identityRequirement: CommercialIdentityRequirement;
};

export type CapabilityEligibilityEntry = {
  readonly capability: string;
  readonly status: CapabilityEligibilityStatus;
  readonly reasonCodes: readonly CapabilityEligibilityReasonCode[];
  readonly executionClass: CapabilitySideEffect;
};

export type CapabilityEligibilitySnapshot = {
  readonly schemaVersion: "1";
  readonly workId: string | null;
  readonly workVersion: number | null;
  readonly objectiveId: string | null;
  readonly objectiveType: string | null;
  readonly evaluatedAt: string;
  readonly eligible: readonly CapabilityEligibilityEntry[];
  readonly blocked: readonly CapabilityEligibilityEntry[];
  readonly metadataVersion: string;
};

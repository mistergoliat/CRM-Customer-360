import {
  decideCommercialIdentityRequirement,
  getCommercialIdentityRequirement,
  getCommercialOperationForCapability,
  isIdentitySelfGovernedCapability
} from "../identity/commercial-identity-requirement";
import type { CapabilityGatewayContext, CapabilityGovernanceMetadata } from "./types";

// SALES-AGENT-R3-A02. The shared, runtime-neutral enforcement boundary:
// whatever called executeGovernedCapability (R2's commercialWorkExecutor,
// the native Agent Tool Loop, the multi-intent action plan executor, a
// future SalesAgentHarness/CommercialActionRequest caller) inherits this
// automatically - it never depends on the caller remembering to invoke a
// gate. Reuses A06's canonical requirement table and evaluator
// (decideCommercialIdentityRequirement) unmodified - no second identity
// policy is defined here, only the capability -> operation lookup
// (capabilityOperations.ts) and the mapping from its decision onto this
// module's own CapabilityGatewayResult vocabulary.

export type CapabilityIdentityGateOutcome =
  | { allowed: true }
  | {
      allowed: false;
      availability: "denied" | "temporarily_blocked";
      status: "denied" | "temporarily_blocked";
      errorCode: string;
      retryable: boolean;
      /** No PII (SALES-AGENT-R3-A02 Phase 8): capability/operation names and enum-valued identity facts only - never phone/email/wa_id/address. */
      responseSummary: Record<string, unknown>;
    };

/**
 * Read-only capabilities are never gated (no unnecessary identity
 * requirement is ever acquired). A mutating capability with no resolvable
 * operation mapping fails closed - never silently allowed through. A
 * mutating capability whose mapped requirement is NONE (e.g. select_products,
 * set_shipping_destination, select_shipping_option) is allowed without ever
 * needing a RuntimeIdentityContext at all. Otherwise this is the exact same
 * decision R2's commercialIdentityGate.ts already applies at the objective
 * level - both read the identical decideCommercialIdentityRequirement, so
 * they agree by construction, never by convention.
 */
export function evaluateCapabilityIdentityGate(
  capability: string,
  governance: CapabilityGovernanceMetadata,
  context: CapabilityGatewayContext
): CapabilityIdentityGateOutcome {
  if (governance.sideEffect !== "mutating") return { allowed: true };
  if (isIdentitySelfGovernedCapability(capability)) return { allowed: true };

  const operation = getCommercialOperationForCapability(capability);
  if (!operation) {
    return {
      allowed: false,
      availability: "denied",
      status: "denied",
      errorCode: "identity_requirement_unresolved",
      retryable: false,
      responseSummary: { capability, decisionStatus: "UNRESOLVED_OPERATION" }
    };
  }

  const requirement = getCommercialIdentityRequirement(operation);
  if (requirement.kind === "NONE") return { allowed: true };

  const runtimeIdentity = context.trustedCustomerSession?.runtimeIdentity ?? null;
  if (!runtimeIdentity) {
    return {
      allowed: false,
      availability: "denied",
      status: "denied",
      errorCode: "identity_context_unavailable",
      retryable: false,
      responseSummary: { capability, operation, decisionStatus: "IDENTITY_CONTEXT_UNAVAILABLE" }
    };
  }

  const decision = decideCommercialIdentityRequirement(requirement, runtimeIdentity);
  if (decision.status === "SUFFICIENT") return { allowed: true };

  const retryable = decision.status === "SYSTEM_WAIT" ? decision.retryable : false;
  const availability = retryable ? "temporarily_blocked" : "denied";
  return {
    allowed: false,
    availability,
    status: availability,
    // Reuses A06's own stable policyCode vocabulary as the errorCode - never
    // a second, parallel error taxonomy for the same decision.
    errorCode: decision.policyCode.toLowerCase(),
    retryable,
    responseSummary: {
      capability,
      operation,
      requiredLevel: requirement.kind === "MINIMUM_LEVEL" ? requirement.level : null,
      observedLevel: runtimeIdentity.identityLevel,
      observedStatus: runtimeIdentity.status,
      decisionStatus: decision.status,
      policyCode: decision.policyCode
    }
  };
}

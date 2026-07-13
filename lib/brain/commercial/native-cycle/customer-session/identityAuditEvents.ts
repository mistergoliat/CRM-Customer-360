import {
  recordCustomerIdentityCapabilityOutcomeCommercialEvent,
  recordCustomerIdentityResolutionCommercialEvent,
  recordCustomerOnboardingTransitionCommercialEvent,
  recordCustomerSessionWarningCommercialEvent
} from "../../events/service";
import type {
  CustomerIdentityResolutionMatchedBy,
  CustomerIdentityResolutionOutcome,
  CustomerIdentityResolutionPhase,
  CustomerOnboardingTransitionOperation
} from "../../events/types";
import { deriveIdentityCapabilityBusinessOutcome } from "../../capability-gateway/identityCapabilityOutcome";
import type { CapabilityGatewayResult } from "../../capability-gateway/types";
import type { CustomerIdentityMatchedBy, CustomerIdentityResolutionStatus, ResolveCustomerIdentityResult } from "@/lib/domains/customer-identity";
import type { CustomerOnboardingMutationResult, CustomerOnboardingState } from "@/lib/domains/customer-onboarding";
import type { CustomerResolutionEvidence } from "@/lib/domains/customer-service";
import { isNativeSessionWarning } from "./warnings";

// ACS-R1-04-T07. Descriptive identity/onboarding audit trail on top of
// commercial_event - never authoritative (release spec, "Persistencia
// fail-safe"). recordCommercialEvent already never throws (it catches DB
// failures internally and returns {ok:false}), so every function here is
// safe to call unconditionally from the native cycle without its own
// try/catch - a recording failure can never surface as a raw error, change a
// business outcome, or open a second transaction.

function assertNeverStatus(value: never): never {
  throw new Error(`customer_identity_resolution_status_unclassified:${JSON.stringify(value)}`);
}

function mapLocalResolutionStatus(status: CustomerIdentityResolutionStatus): CustomerIdentityResolutionOutcome {
  switch (status) {
    case "identified":
      return "identified";
    case "identification_required":
      return "no_match";
    case "conflict":
      return "conflict";
    case "temporarily_unavailable":
      return "temporarily_unavailable";
    case "invalid_input":
      return "invalid_input";
    default:
      return assertNeverStatus(status);
  }
}

function mapLocalMatchedBy(matchedBy: CustomerIdentityMatchedBy): CustomerIdentityResolutionMatchedBy {
  if (matchedBy === "external_identity") return "external_identity";
  if (matchedBy === "phone") return "normalized_phone";
  return "none";
}

export async function recordLocalIdentityResolution(params: {
  messageId: string;
  correlationId?: string | null;
  conversationId: string;
  customerId?: string | null;
  result: ResolveCustomerIdentityResult;
}): Promise<void> {
  try {
    await recordCustomerIdentityResolutionCommercialEvent({
      messageId: params.messageId,
      phase: "pre_plan",
      resolver: "local",
      outcome: mapLocalResolutionStatus(params.result.status),
      matchedBy: mapLocalMatchedBy(params.result.matchedBy),
      hasResolvedCustomer: params.result.customerId !== null,
      correlationId: params.correlationId ?? null,
      conversationId: params.conversationId,
      customerId: params.customerId ?? params.result.customerId ?? null
    });
  } catch {
    // Audit recording is descriptive only - a failure here can never
    // surface as a raw error or change a business outcome (release spec,
    // "Persistencia fail-safe").
  }
}

function mapExternalResolutionStatus(status: CustomerResolutionEvidence["result"]["status"]): CustomerIdentityResolutionOutcome {
  switch (status) {
    case "resolved":
      return "identified";
    case "no_match":
      return "no_match";
    case "conflict":
      return "conflict";
    case "invalid_input":
      return "invalid_input";
    case "temporarily_unavailable":
      return "temporarily_unavailable";
    default:
      return assertNeverStatus(status);
  }
}

export async function recordExternalIdentityResolution(params: {
  phase: CustomerIdentityResolutionPhase;
  messageId: string;
  correlationId?: string | null;
  conversationId: string;
  opportunityId?: string | null;
  customerId?: string | null;
  evidence: CustomerResolutionEvidence;
}): Promise<void> {
  const resolved = params.evidence.result.status === "resolved";
  try {
    await recordCustomerIdentityResolutionCommercialEvent({
      messageId: params.messageId,
      phase: params.phase,
      resolver: "customer_service",
      outcome: mapExternalResolutionStatus(params.evidence.result.status),
      matchedBy: resolved ? "customer_service" : "none",
      hasResolvedCustomer: resolved,
      correlationId: params.correlationId ?? null,
      conversationId: params.conversationId,
      opportunityId: params.opportunityId ?? null,
      customerId: params.customerId ?? (params.evidence.result.status === "resolved" ? params.evidence.result.customerId : null)
    });
  } catch {
    // Fail-safe - see recordLocalIdentityResolution.
  }
}

export async function recordIdentityCapabilityOutcome(params: {
  capability: "resolve_customer" | "create_customer" | "link_external_identity";
  correlationId?: string | null;
  conversationId?: string | null;
  opportunityId?: string | null;
  customerId?: string | null;
  decisionId?: string | null;
  gatewayResult: CapabilityGatewayResult;
}): Promise<void> {
  const executionPublicId = params.gatewayResult.executionPublicId;
  if (!executionPublicId) return; // nothing to correlate against - never fabricate an id (release spec section 9).

  try {
    const businessOutcome = deriveIdentityCapabilityBusinessOutcome(
      params.capability,
      params.gatewayResult.status,
      params.gatewayResult.data as Record<string, unknown> | null
    );

    await recordCustomerIdentityCapabilityOutcomeCommercialEvent({
      capability: params.capability,
      executionPublicId,
      gatewayStatus: params.gatewayResult.status,
      businessOutcome,
      retryable: params.gatewayResult.retryable,
      stableErrorCode: params.gatewayResult.errorCode,
      correlationId: params.correlationId ?? null,
      conversationId: params.conversationId ?? null,
      opportunityId: params.opportunityId ?? null,
      customerId: params.customerId ?? null,
      decisionId: params.decisionId ?? null
    });
  } catch {
    // Fail-safe - see recordLocalIdentityResolution. A recording failure
    // here can never revert or reclassify an already-confirmed create/link.
  }
}

export async function recordOnboardingTransitionIfChanged(params: {
  operation: CustomerOnboardingTransitionOperation;
  previous: CustomerOnboardingState | null;
  result: CustomerOnboardingMutationResult;
  correlationId?: string | null;
}): Promise<void> {
  if (!params.result.ok || params.result.status === "unchanged") return; // no effective transition - never recorded (release spec: "no evento cuando no existe transicion efectiva").

  const state = params.result.state;
  try {
    await recordCustomerOnboardingTransitionCommercialEvent({
      conversationId: state.conversationId,
      operation: params.operation,
      purpose: state.purpose,
      previousStatus: params.previous?.status ?? null,
      nextStatus: state.status,
      previousVersion: params.previous?.version ?? null,
      nextVersion: state.version,
      pendingFields: [...state.pendingFields],
      collectedAvailability: {
        firstName: Boolean(state.collected.firstName),
        lastName: Boolean(state.collected.lastName),
        email: Boolean(state.collected.email),
        orderReference: Boolean(state.collected.orderReference)
      },
      hasResolvedCustomer: state.customerId !== null,
      correlationId: params.correlationId ?? null,
      opportunityId: state.opportunityId,
      customerId: state.customerId
    });
  } catch {
    // Fail-safe - see recordLocalIdentityResolution. The onboarding
    // transition itself already committed; this only records evidence of it.
  }
}

export async function recordSessionWarnings(params: {
  phase: CustomerIdentityResolutionPhase;
  messageId: string;
  correlationId?: string | null;
  conversationId?: string | null;
  opportunityId?: string | null;
  customerId?: string | null;
  decisionId?: string | null;
  executionPublicId?: string | null;
  warnings: readonly string[];
}): Promise<void[]> {
  const structuredWarnings = params.warnings.filter(isNativeSessionWarning);
  return Promise.all(
    structuredWarnings.map(async (warningCode) => {
      try {
        await recordCustomerSessionWarningCommercialEvent({
          messageId: params.messageId,
          phase: params.phase,
          warningCode,
          executionPublicId: params.executionPublicId ?? null,
          correlationId: params.correlationId ?? null,
          conversationId: params.conversationId ?? null,
          opportunityId: params.opportunityId ?? null,
          customerId: params.customerId ?? null,
          decisionId: params.decisionId ?? null
        });
      } catch {
        // Fail-safe - see recordLocalIdentityResolution.
      }
    })
  );
}

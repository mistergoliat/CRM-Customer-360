import { createCustomerIdentityResolutionService } from "@/lib/domains/customer-identity";
import type { CustomerIdentityResolutionService, ResolveCustomerIdentityResult } from "@/lib/domains/customer-identity";
import { createCustomerOnboardingService } from "@/lib/domains/customer-onboarding";
import type { CustomerOnboardingService, CustomerOnboardingState } from "@/lib/domains/customer-onboarding";
import type { CustomerResolutionEvidence, ResolveCustomerInput } from "@/lib/domains/customer-service";
import { executeGovernedCapability } from "../../capability-gateway/executeCapability";
import { parseAllConsentEvidence } from "./consentEvidence";
import { recordExternalIdentityResolution, recordIdentityCapabilityOutcome, recordLocalIdentityResolution, recordSessionWarnings } from "./identityAuditEvents";
import { completeOnboardingWithCustomer, landOnboardingInTerminalState } from "./onboardingTransitions";
import { mergeWarnings } from "./warnings";
import type {
  CustomerIdentitySource,
  CustomerIdentityStatus,
  CustomerSessionAccess,
  CustomerSessionDecisionContext,
  NativeCustomerSessionExecutionContext,
  ResolvedNativeCustomerSession,
  TrustedInboundIdentity
} from "./types";
import { CUSTOMER_SESSION_DECISION_CONTEXT_SCHEMA_VERSION } from "./types";

export type ResolveCustomerExternalFn = (
  input: ResolveCustomerInput,
  context: { correlationId: string }
) => Promise<CustomerResolutionEvidence>;

export type ResolveNativeCustomerSessionDependencies = {
  identityService?: CustomerIdentityResolutionService;
  onboardingService?: CustomerOnboardingService;
  resolveCustomerExternal?: ResolveCustomerExternalFn;
  now?: () => Date;
};

export type ResolveNativeCustomerSessionInput = {
  conversationId: string;
  opportunityId: string | null;
  trustedInbound: TrustedInboundIdentity;
  messageText: string;
  correlationId: string;
  /**
   * conversation.customer_id from the pre-existing native inbound resolver
   * (resolveOrCreateNativeCustomer, untouched by T06). Never trusted
   * silently - reconciled against this turn's independent local resolution;
   * a contradiction produces conflict (task section 12).
   */
  priorConversationCustomerId: string | null;
  dependencies?: ResolveNativeCustomerSessionDependencies;
};

/** Calls resolve_customer through the same Capability Gateway boundary every other capability uses - never the HTTP adapter directly. Exported for reuse by runCustomerOnboardingPostPlanStage (ACS-R1-04-T06.1), which needs the identical default when pre-plan didn't already attempt resolution this turn. */
export async function defaultResolveCustomerExternal(input: ResolveCustomerInput, context: { correlationId: string }): Promise<CustomerResolutionEvidence> {
  const result = await executeGovernedCapability("resolve_customer", input as unknown as Record<string, unknown>, { correlationId: context.correlationId });
  await recordIdentityCapabilityOutcome({ capability: "resolve_customer", correlationId: context.correlationId, gatewayResult: result });
  if (result.status === "completed" && result.data) {
    return result.data as unknown as CustomerResolutionEvidence;
  }
  return {
    source: "customer_service",
    requestId: result.executionPublicId ?? "unavailable",
    checkedAt: result.completedAt,
    result: { status: "temporarily_unavailable", retryable: result.retryable }
  };
}

type IdentityWorkingState = {
  status: CustomerIdentityStatus;
  customerId: string | null;
  source: CustomerIdentitySource;
};

function mapLocalResolution(result: ResolveCustomerIdentityResult, onboardingActive: boolean): IdentityWorkingState {
  if (result.status === "identified") {
    return { status: "identified", customerId: result.customerId, source: result.matchedBy === "phone" ? "normalized_phone" : "external_identity" };
  }
  if (result.status === "conflict") return { status: "conflict", customerId: null, source: "none" };
  // temporarily_unavailable and invalid_input are both technical failures - never treated as a business state (contract section 8).
  if (result.status === "temporarily_unavailable" || result.status === "invalid_input") {
    return { status: "temporarily_unavailable", customerId: null, source: "none" };
  }
  // identification_required: a public query never requires onboarding.
  return { status: onboardingActive ? "identification_required" : "anonymous", customerId: null, source: "none" };
}

function computeContextAccess(identity: IdentityWorkingState, onboarding: CustomerOnboardingState | null): CustomerSessionAccess {
  // validated_entity is never granted in T06 - entity ownership validation
  // (e.g. an order truly belonging to this customer) is not implemented yet.
  if (identity.status !== "identified" || !onboarding) return "none";
  if (onboarding.purpose !== "quote" && onboarding.purpose !== "purchase") return "none";
  if (onboarding.status === "conflict" || onboarding.status === "temporarily_blocked" || onboarding.status === "temporarily_unavailable") return "none";
  return "commercial_history";
}

function buildDecisionContext(execution: NativeCustomerSessionExecutionContext): CustomerSessionDecisionContext {
  const onboarding = execution.onboarding;
  return {
    schemaVersion: CUSTOMER_SESSION_DECISION_CONTEXT_SCHEMA_VERSION,
    identity: {
      status: execution.identity.status,
      hasResolvedCustomer: execution.identity.customerId !== null,
      source: execution.identity.source
    },
    onboarding: onboarding
      ? {
          status: onboarding.status,
          purpose: onboarding.purpose,
          pendingFields: [...onboarding.pendingFields],
          collected: {
            firstNameAvailable: Boolean(onboarding.collected.firstName),
            lastNameAvailable: Boolean(onboarding.collected.lastName),
            emailAvailable: Boolean(onboarding.collected.email),
            orderReferenceAvailable: Boolean(onboarding.collected.orderReference)
          },
          failedVerificationAttempts: onboarding.failedVerificationAttempts
        }
      : null,
    contextAccess: execution.contextAccess,
    operations: {
      canAttemptResolve: execution.identity.status === "identification_required",
      canProposeCreateCustomer: execution.identity.status === "identification_required",
      canProposeLinkExternalIdentity: execution.identity.status === "identified"
    }
  };
}

/**
 * Single session orchestrator for the native inbound (ACS-R1-04-T06). Loads
 * onboarding once, resolves local identity once, attempts external
 * resolution only under the strict conditions in contract section 7,
 * reconciles, captures this-turn consent, and gates Customer 360 access.
 * Never executes create_customer or link_external_identity, never writes
 * master_customer/customer_external_identity, never generates customer-facing text.
 */
export async function resolveNativeCustomerSession(input: ResolveNativeCustomerSessionInput): Promise<ResolvedNativeCustomerSession> {
  const identityService = input.dependencies?.identityService ?? createCustomerIdentityResolutionService();
  const onboardingService = input.dependencies?.onboardingService ?? createCustomerOnboardingService();
  const resolveCustomerExternal = input.dependencies?.resolveCustomerExternal ?? defaultResolveCustomerExternal;
  const now = input.dependencies?.now ?? (() => new Date());

  const warnings: string[] = [];

  // 1. Load onboarding once.
  let onboarding = await onboardingService.getState(input.conversationId);

  // 2. Resolve local identity once.
  const localResult = await identityService.resolveIdentity({
    channel: "whatsapp",
    externalId: input.trustedInbound.externalId,
    phoneNumber: input.trustedInbound.normalizedPhone
  });
  if (localResult.status === "invalid_input") warnings.push("customer_identity_invalid_input");
  if (localResult.status === "temporarily_unavailable") warnings.push("customer_identity_unavailable");
  if (localResult.status === "conflict") warnings.push("customer_identity_conflict");

  await recordLocalIdentityResolution({
    messageId: input.trustedInbound.messageId,
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    result: localResult
  });

  let identity = mapLocalResolution(localResult, onboarding !== null && onboarding.status !== "completed");

  // 4. Reconcile identity + onboarding - never silently pick a side.
  if (onboarding?.status === "completed" && onboarding.customerId) {
    if (identity.status === "identified" && identity.customerId !== onboarding.customerId) {
      identity = { status: "conflict", customerId: null, source: "none" };
      warnings.push("customer_identity_conflict");
    } else if (identity.status !== "conflict") {
      identity = { status: "identified", customerId: onboarding.customerId, source: identity.status === "identified" ? identity.source : "onboarding_state" };
    }
  }
  if (input.priorConversationCustomerId && identity.status === "identified" && identity.customerId !== input.priorConversationCustomerId) {
    identity = { status: "conflict", customerId: null, source: "none" };
    warnings.push("customer_identity_conflict");
  }
  if (identity.status === "conflict" && onboarding && onboarding.status !== "conflict") {
    const landed = await landOnboardingInTerminalState(onboardingService, onboarding, "conflict", input.correlationId);
    onboarding = landed.state;
    if (landed.warning) warnings.push(landed.warning);
  }
  // Local resolution alone can also close out an open onboarding (contract
  // section 18: "local/external resolved -> completed with customerId") -
  // not only the external resolve_customer branch below.
  if (identity.status === "identified" && identity.customerId && onboarding && (onboarding.status === "required" || onboarding.status === "collecting")) {
    const landed = await completeOnboardingWithCustomer(onboardingService, onboarding, identity.customerId, input.correlationId);
    onboarding = landed.state;
    if (landed.warning) warnings.push(landed.warning);
  }

  // 3. External resolution - only local no_match + active onboarding requiring identity (section 7).
  let externalOutcome: string | null = null;
  let freshEvidence: CustomerResolutionEvidence | null = null;
  const onboardingNeedsIdentity = onboarding !== null && (onboarding.status === "required" || onboarding.status === "collecting");
  if (identity.status === "identification_required" && onboardingNeedsIdentity && onboarding) {
    let evidence: CustomerResolutionEvidence;
    try {
      evidence = await resolveCustomerExternal(
        {
          channel: "whatsapp",
          externalId: input.trustedInbound.externalId,
          phoneNumber: input.trustedInbound.normalizedPhone,
          email: onboarding.collected.email ?? null
        },
        { correlationId: input.correlationId }
      );
    } catch {
      evidence = { source: "customer_service", requestId: "unavailable", checkedAt: now().toISOString(), result: { status: "temporarily_unavailable", retryable: true } };
    }
    externalOutcome = evidence.result.status;
    freshEvidence = evidence;

    await recordExternalIdentityResolution({
      phase: "pre_plan",
      messageId: input.trustedInbound.messageId,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      opportunityId: input.opportunityId,
      evidence
    });

    if (evidence.result.status === "resolved") {
      identity = { status: "identified", customerId: evidence.result.customerId, source: "customer_service" };
      const landed = await completeOnboardingWithCustomer(onboardingService, onboarding, evidence.result.customerId, input.correlationId);
      onboarding = landed.state;
      if (landed.warning) warnings.push(landed.warning);
    } else if (evidence.result.status === "conflict") {
      identity = { status: "conflict", customerId: null, source: "none" };
      warnings.push("customer_identity_conflict");
      const landed = await landOnboardingInTerminalState(onboardingService, onboarding, "conflict", input.correlationId);
      onboarding = landed.state;
      if (landed.warning) warnings.push(landed.warning);
    } else if (evidence.result.status === "temporarily_unavailable") {
      identity = { status: "temporarily_unavailable", customerId: null, source: "none" };
      warnings.push("customer_service_unavailable");
      const landed = await landOnboardingInTerminalState(onboardingService, onboarding, "temporarily_unavailable", input.correlationId);
      onboarding = landed.state;
      if (landed.warning) warnings.push(landed.warning);
    } else if (evidence.result.status === "invalid_input") {
      warnings.push("customer_identity_invalid_input");
    }
    // no_match: identity stays identification_required, onboarding untouched, evidence kept fresh for this turn only.
  }

  // 5. Consent - current turn only.
  const currentTurnConsent = parseAllConsentEvidence({
    messageText: input.messageText,
    messageId: input.trustedInbound.messageId,
    capturedAt: input.trustedInbound.receivedAt
  });

  // 6. Customer 360 access gate.
  const contextAccess = computeContextAccess(identity, onboarding);
  if (onboarding?.status === "temporarily_blocked") warnings.push("customer_onboarding_temporarily_blocked");

  const execution: NativeCustomerSessionExecutionContext = {
    conversationId: input.conversationId,
    opportunityId: input.opportunityId,
    trustedInbound: input.trustedInbound,
    identity: {
      status: identity.status,
      customerId: identity.customerId,
      source: identity.source,
      localResolutionOutcome: localResult.status,
      externalResolutionOutcome: externalOutcome
    },
    onboarding,
    contextAccess,
    currentTurnConsent,
    freshExternalResolutionEvidence: freshEvidence
  };

  const dedupedWarnings = mergeWarnings(warnings);
  await recordSessionWarnings({
    phase: "pre_plan",
    messageId: input.trustedInbound.messageId,
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    opportunityId: input.opportunityId,
    customerId: identity.customerId,
    warnings: dedupedWarnings
  });

  return { execution, decision: buildDecisionContext(execution), warnings: dedupedWarnings };
}

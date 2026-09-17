import type { NativeCustomerSessionExecutionContext } from "../../../native-cycle/customer-session/types";

/**
 * SALES-AGENT-R3-P7.4. Injected directly as trustedCustomerSession - this
 * harness enters at runSalesAgentRuntimeCycle, never runNativeAutonomousCycle,
 * so resolveNativeCustomerSession never runs and the real Customer Service is
 * never called (see environmentHealthPrecheck.ts's own comment). Same shape
 * tests/agent-loop/runAgentToolLoop.test.ts's own level0SessionForOpportunityTests
 * already establishes for LEVEL_0 - mirrored here, plus a LEVEL_2 variant
 * this corpus needs for its create_quote-success cases.
 */
export function buildLevel0AnonymousSession(input: { conversationId: number; waId: string; messageId: string; currentTime: string }): NativeCustomerSessionExecutionContext {
  return {
    conversationId: String(input.conversationId),
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: input.waId, normalizedPhone: input.waId, messageId: input.messageId, receivedAt: input.currentTime },
    identity: { status: "anonymous", customerId: null, source: "none", localResolutionOutcome: "anonymous", externalResolutionOutcome: null },
    masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_source_unsupported" },
    runtimeIdentity: {
      status: "ANONYMOUS",
      identityLevel: "LEVEL_0_ANONYMOUS",
      masterCustomerId: null,
      prestashopCustomerId: null,
      verificationRequired: false,
      requiredEvidence: [],
      readyToLink: false,
      conflictCode: null,
      policyCode: "NO_CHANNEL_EVIDENCE",
      evidenceRefs: []
    },
    onboarding: null,
    contextAccess: "none",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
    freshExternalResolutionEvidence: null
  };
}

export function buildLevel2MasterResolvedSession(input: { conversationId: number; waId: string; messageId: string; currentTime: string; masterCustomerId: number }): NativeCustomerSessionExecutionContext {
  return {
    conversationId: String(input.conversationId),
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: input.waId, normalizedPhone: input.waId, messageId: input.messageId, receivedAt: input.currentTime },
    identity: { status: "identified", customerId: String(input.masterCustomerId), source: "customer_service", localResolutionOutcome: "identified", externalResolutionOutcome: null },
    masterCustomerIdentity: { status: "resolved", masterCustomerId: String(input.masterCustomerId), source: "customer_service_verified" },
    runtimeIdentity: {
      status: "MASTER_RESOLVED",
      identityLevel: "LEVEL_2_MASTER_RESOLVED",
      masterCustomerId: String(input.masterCustomerId),
      prestashopCustomerId: null,
      verificationRequired: false,
      requiredEvidence: [],
      readyToLink: false,
      conflictCode: null,
      policyCode: "MASTER_CUSTOMER_VERIFIED",
      evidenceRefs: []
    },
    onboarding: null,
    contextAccess: "validated_entity",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
    freshExternalResolutionEvidence: null
  };
}

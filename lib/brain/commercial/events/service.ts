import type { PoolConnection } from "mysql2/promise";
import type { CommercialEventPersistResult } from "./types";
import {
  normalizeAgentToolLoopCompletedCommercialEvent,
  normalizeAgentTurnInputShadowBuiltEvent,
  normalizeAutonomousTurnContinuityFailedCommercialEvent,
  normalizeAutonomousTurnDispositionCommercialEvent,
  normalizeCommercialProposalShadowBuiltEvent,
  normalizeCommercialCapabilityEligibilityEvaluatedEvent,
  normalizeCommercialCapabilityInvocationObservedEvent,
  normalizeCommercialWorkAsyncDeliveryEvaluatedEvent,
  normalizeCommercialWorkInboundCycleCompletedEvent,
  normalizeCommercialObjectiveReconciledEvent,
  normalizeCommercialObjectiveReconciliationDecidedEvent,
  normalizeCommercialWorkKernelResolvedEvent,
  normalizeCustomerIdentityCapabilityOutcomeCommercialEvent,
  normalizeCustomerIdentityResolutionCommercialEvent,
  normalizeCustomerOnboardingTransitionCommercialEvent,
  normalizeCustomerSessionWarningCommercialEvent,
  normalizeFollowUpDueCommercialEvent,
  normalizeIdentityVerificationDecisionCommercialEvent,
  normalizeInternalCommandCommercialEvent,
  normalizeMetaWhatsAppInboundCommercialEvent,
  normalizeMetaWhatsAppStatusCommercialEvent,
  normalizePersistentSessionCognitionAppliedEvent,
  normalizePersistentSessionShadowComparedEvent,
  normalizeSalesAgentRuntimeResponseDispatchedEvent,
  normalizeSalesAgentRuntimeTerminalDispatchedEvent
} from "./normalize";
import { recordCommercialEvent } from "./repository";

export async function recordCommercialWorkInboundCycleCompletedEvent(
  input: Parameters<typeof normalizeCommercialWorkInboundCycleCompletedEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCommercialWorkInboundCycleCompletedEvent(input), connection);
}

export async function recordMetaWhatsAppInboundCommercialEvent(
  input: Parameters<typeof normalizeMetaWhatsAppInboundCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeMetaWhatsAppInboundCommercialEvent(input), connection);
}

export async function recordMetaWhatsAppStatusCommercialEvent(
  input: Parameters<typeof normalizeMetaWhatsAppStatusCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeMetaWhatsAppStatusCommercialEvent(input), connection);
}

export async function recordFollowUpDueCommercialEvent(
  input: Parameters<typeof normalizeFollowUpDueCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeFollowUpDueCommercialEvent(input), connection);
}

export async function recordInternalCommandCommercialEvent(
  input: Parameters<typeof normalizeInternalCommandCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeInternalCommandCommercialEvent(input), connection);
}

// ACS-R1-04-T07.

export async function recordCustomerIdentityResolutionCommercialEvent(
  input: Parameters<typeof normalizeCustomerIdentityResolutionCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCustomerIdentityResolutionCommercialEvent(input), connection);
}

export async function recordCustomerOnboardingTransitionCommercialEvent(
  input: Parameters<typeof normalizeCustomerOnboardingTransitionCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCustomerOnboardingTransitionCommercialEvent(input), connection);
}

export async function recordCustomerIdentityCapabilityOutcomeCommercialEvent(
  input: Parameters<typeof normalizeCustomerIdentityCapabilityOutcomeCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCustomerIdentityCapabilityOutcomeCommercialEvent(input), connection);
}

export async function recordCustomerSessionWarningCommercialEvent(
  input: Parameters<typeof normalizeCustomerSessionWarningCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCustomerSessionWarningCommercialEvent(input), connection);
}

// SALES-AGENT-R2-ID-R2-A05.

export async function recordIdentityVerificationDecisionCommercialEvent(
  input: Parameters<typeof normalizeIdentityVerificationDecisionCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeIdentityVerificationDecisionCommercialEvent(input), connection);
}

// ACS-R1-05-T06.2.

export async function recordAutonomousTurnDispositionCommercialEvent(
  input: Parameters<typeof normalizeAutonomousTurnDispositionCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeAutonomousTurnDispositionCommercialEvent(input), connection);
}

export async function recordAutonomousTurnContinuityFailedCommercialEvent(
  input: Parameters<typeof normalizeAutonomousTurnContinuityFailedCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeAutonomousTurnContinuityFailedCommercialEvent(input), connection);
}

export async function recordAgentToolLoopCompletedCommercialEvent(
  input: Parameters<typeof normalizeAgentToolLoopCompletedCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeAgentToolLoopCompletedCommercialEvent(input), connection);
}

// SALES-AGENT-R3-V1.5.

export async function recordSalesAgentRuntimeResponseDispatchedEvent(
  input: Parameters<typeof normalizeSalesAgentRuntimeResponseDispatchedEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeSalesAgentRuntimeResponseDispatchedEvent(input), connection);
}

// SALES-AGENT-R3-V1.6.

export async function recordSalesAgentRuntimeTerminalDispatchedEvent(
  input: Parameters<typeof normalizeSalesAgentRuntimeTerminalDispatchedEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeSalesAgentRuntimeTerminalDispatchedEvent(input), connection);
}

// SALES-AGENT-R3-V1.8-D4.

export async function recordPersistentSessionShadowComparedEvent(
  input: Parameters<typeof normalizePersistentSessionShadowComparedEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizePersistentSessionShadowComparedEvent(input), connection);
}

// SALES-AGENT-R3-V1.8-D5.

export async function recordPersistentSessionCognitionAppliedEvent(
  input: Parameters<typeof normalizePersistentSessionCognitionAppliedEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizePersistentSessionCognitionAppliedEvent(input), connection);
}

// SALES-AGENT-R3-P2. Descriptive only; a failed write never becomes a
// customer-turn failure because callers invoke this after the R3 outcome is
// already known and isolate the write.
export async function recordAgentTurnInputShadowBuiltCommercialEvent(
  input: Parameters<typeof normalizeAgentTurnInputShadowBuiltEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeAgentTurnInputShadowBuiltEvent(input), connection);
}

// SALES-AGENT-R3-P4. Descriptive shadow only; callers must isolate failures.
export async function recordCommercialProposalShadowBuiltEvent(
  input: Parameters<typeof normalizeCommercialProposalShadowBuiltEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCommercialProposalShadowBuiltEvent(input), connection);
}

// SALES-AGENT-R3-P6.2-A. Descriptive shadow only; callers isolate failures
// so telemetry can never affect the customer turn or Gateway authority.
export async function recordCommercialCapabilityEligibilityEvaluatedEvent(
  input: Parameters<typeof normalizeCommercialCapabilityEligibilityEvaluatedEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCommercialCapabilityEligibilityEvaluatedEvent(input), connection);
}

// SALES-AGENT-R3-P7.2. Descriptive coherence observation only; the caller
// (runAgentToolLoop.ts) wraps this in the same fail-open try/catch discipline
// as every other per-call observability write in that file (e.g.
// recordPreGatewayToolRejection) - a recording failure never throws into the
// turn, never changes the ToolObservation already returned to the model.
export async function recordCommercialCapabilityInvocationObservedEvent(
  input: Parameters<typeof normalizeCommercialCapabilityInvocationObservedEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCommercialCapabilityInvocationObservedEvent(input), connection);
}

// SALES-AGENT-R3 ASYNC RESULT DELIVERY V1.

export async function recordCommercialWorkAsyncDeliveryEvaluatedEvent(
  input: Parameters<typeof normalizeCommercialWorkAsyncDeliveryEvaluatedEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCommercialWorkAsyncDeliveryEvaluatedEvent(input), connection);
}

// SALES-AGENT-R3-P3.5.

export async function recordCommercialWorkKernelResolvedEvent(
  input: Parameters<typeof normalizeCommercialWorkKernelResolvedEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCommercialWorkKernelResolvedEvent(input), connection);
}

// SALES-AGENT-R3-P5.

export async function recordCommercialObjectiveReconciliationDecidedEvent(
  input: Parameters<typeof normalizeCommercialObjectiveReconciliationDecidedEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCommercialObjectiveReconciliationDecidedEvent(input), connection);
}

export async function recordCommercialObjectiveReconciledEvent(
  input: Parameters<typeof normalizeCommercialObjectiveReconciledEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCommercialObjectiveReconciledEvent(input), connection);
}

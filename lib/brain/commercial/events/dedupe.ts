import { createHash } from "node:crypto";
import type { CommercialEventType } from "./types";

function stableId(parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

function compact(parts: Array<string | null | undefined>) {
  return parts.map((part) => (part ?? "").trim()).filter((part) => part.length > 0);
}

export function buildCommercialEventId(dedupeKey: string) {
  return `cevt_${stableId([dedupeKey])}`;
}

export function buildInboundCommercialEventDedupeKey(providerMessageId: string) {
  return `meta:whatsapp:inbound:${providerMessageId.trim()}`;
}

export function buildCommercialStatusEventDedupeKey(providerMessageId: string, status: string) {
  return `meta:whatsapp:status:${providerMessageId.trim()}:${status.trim()}`;
}

export function buildFollowUpDueCommercialEventDedupeKey(actionId: string, scheduledAt: string) {
  return `timer:follow_up:${actionId.trim()}:${scheduledAt.trim()}`;
}

export function buildInternalCommandCommercialEventDedupeKey(commandId: string, result: string) {
  return `internal:command:${commandId.trim()}:${result.trim()}`;
}

// ACS-R1-04-T07 dedupe keys (release spec section 8). No timestamps, no PII -
// only stable identifiers already available in the caller's scope.

export function buildCustomerIdentityResolutionDedupeKey(
  messageId: string,
  phase: string,
  resolver: string,
  outcome: string
) {
  return `identity:${messageId.trim()}:${phase.trim()}:${resolver.trim()}:${outcome.trim()}`;
}

export function buildCustomerOnboardingTransitionDedupeKey(
  conversationId: string,
  nextVersion: number,
  operation: string
) {
  return `onboarding:${conversationId.trim()}:${nextVersion}:${operation.trim()}`;
}

export function buildCustomerIdentityCapabilityOutcomeDedupeKey(
  executionPublicId: string,
  businessOutcome: string
) {
  return `identity-capability:${executionPublicId.trim()}:${businessOutcome.trim()}`;
}

export function buildCustomerSessionWarningDedupeKey(
  messageId: string,
  phase: string,
  warningCode: string
) {
  return `identity-warning:${messageId.trim()}:${phase.trim()}:${warningCode.trim()}`;
}

// SALES-AGENT-R2-ID-R2-A05.
export function buildIdentityVerificationDecisionDedupeKey(
  messageId: string,
  status: string,
  policyCode: string
) {
  return `identity-verification:${messageId.trim()}:${status.trim()}:${policyCode.trim()}`;
}

// ACS-R1-05-T06.2 dedupe keys. One canonical disposition event per inbound
// message; a technical failure to establish continuity gets a distinct key
// (never overwrites/collides with a successful disposition for the same message).

export function buildAutonomousTurnDispositionDedupeKey(inboundMessageId: string) {
  return `autonomous-turn-disposition:${inboundMessageId.trim()}`;
}

export function buildAutonomousTurnContinuityFailedDedupeKey(inboundMessageId: string) {
  return `autonomous-turn-continuity-failed:${inboundMessageId.trim()}`;
}

// ACS-R1-05.1-T02.1. One canonical loop-completion event per inbound
// message, same rationale as the disposition key above.
export function buildAgentToolLoopCompletedDedupeKey(inboundMessageId: string) {
  return `agent-tool-loop-completed:${inboundMessageId.trim()}`;
}

// SALES-AGENT-R2-A08.5. One canonical event per inbound message on the R2
// path, same rationale as buildAgentToolLoopCompletedDedupeKey above.
export function buildCommercialWorkInboundCycleCompletedDedupeKey(inboundMessageId: string) {
  return `commercial-work-inbound-cycle-completed:${inboundMessageId.trim()}`;
}

// SALES-AGENT-R3-V1.5. One canonical event per inbound message on the R3
// native response-dispatch path, same rationale as
// buildAgentToolLoopCompletedDedupeKey above.
export function buildSalesAgentRuntimeResponseDispatchedDedupeKey(inboundMessageId: string) {
  return `sales-agent-r3-response-dispatched:${inboundMessageId.trim()}`;
}

// SALES-AGENT-R3-V1.6. One canonical event per inbound message on the
// broader terminal-dispatch path (responded/fallback/hard_handoff), same
// rationale as buildSalesAgentRuntimeResponseDispatchedDedupeKey above.
export function buildSalesAgentRuntimeTerminalDispatchedDedupeKey(inboundMessageId: string) {
  return `sales-agent-r3-terminal-dispatched:${inboundMessageId.trim()}`;
}

// SALES-AGENT-R3-V1.8-D4. One canonical shadow-comparison event per inbound
// message on the R3 SalesAgentRuntime path, same rationale as
// buildAgentToolLoopCompletedDedupeKey above.
export function buildPersistentSessionShadowComparedDedupeKey(inboundMessageId: string) {
  return `persistent-session-shadow-compared:${inboundMessageId.trim()}`;
}

// SALES-AGENT-R3-V1.8-D5. One canonical live-cognition-applied event per
// inbound message on the R3 SalesAgentRuntime path, same rationale as
// buildPersistentSessionShadowComparedDedupeKey above.
export function buildPersistentSessionCognitionAppliedDedupeKey(inboundMessageId: string) {
  return `persistent-session-cognition-applied:${inboundMessageId.trim()}`;
}

// SALES-AGENT-R3-P2. One descriptive shadow observation per inbound turn;
// retries/replays collapse to the same commercial_event row.
export function buildAgentTurnInputShadowBuiltDedupeKey(inboundMessageId: string) {
  return `agent-turn-input-shadow-built:${inboundMessageId.trim()}`;
}

// SALES-AGENT-R3-P4. One commercial-proposal shadow observation per
// inbound turn. Retries/replays collapse onto the same event.
export function buildCommercialProposalShadowBuiltDedupeKey(inboundMessageId: string) {
  return `commercial-proposal-shadow-built:${inboundMessageId.trim()}`;
}

// SALES-AGENT-R3 ASYNC RESULT DELIVERY V1. Keyed on the delivered work
// version (an optimistic-concurrency identity only one caller can ever
// legitimately reach - see commercialWorkExecutor.ts), never a random id -
// a repeated idempotent re-evaluation of the same version collapses into the
// same event instead of spamming one row per recovery-sweep tick.
export function buildCommercialWorkAsyncDeliveryEvaluatedDedupeKey(workPublicId: string, workVersion: number) {
  return `commercial-work-async-delivery-evaluated:${workPublicId.trim()}:${workVersion}`;
}

// SALES-AGENT-R3-P3.5. One descriptive case-kernel-resolution event per
// inbound turn where the bootstrap ran; retries/replays collapse to the
// same commercial_event row, same rationale as
// buildAgentTurnInputShadowBuiltDedupeKey above.
export function buildCommercialWorkKernelResolvedDedupeKey(inboundMessageId: string) {
  return `commercial-work-kernel-resolved:${inboundMessageId.trim()}`;
}

// SALES-AGENT-R3-P5. One reconciliation decision per inbound turn, same
// rationale as buildCommercialProposalShadowBuiltDedupeKey above.
export function buildCommercialObjectiveReconciliationDecidedDedupeKey(inboundMessageId: string) {
  return `commercial-objective-reconciliation-decided:${inboundMessageId.trim()}`;
}

// SALES-AGENT-R3-P5. At most one durable reconciliation mutation per inbound
// turn - a retry that decides CONTINUE/MODIFY/NOOP/REJECT never reaches this
// event at all (applyCommercialObjectiveReconciliation.ts only calls it after
// a successful write), so this key never needs to distinguish attempts.
export function buildCommercialObjectiveReconciledDedupeKey(inboundMessageId: string) {
  return `commercial-objective-reconciled:${inboundMessageId.trim()}`;
}

export function buildCommercialEventCorrelationId(
  eventType: CommercialEventType,
  source: string,
  sourceEventId: string | null,
  dedupeKey: string,
  providedCorrelationId?: string | null
) {
  if (providedCorrelationId && providedCorrelationId.trim()) return providedCorrelationId.trim();
  const prefix = compact([source, eventType, sourceEventId ?? dedupeKey]).join(":");
  return `${prefix}:${stableId([dedupeKey, eventType, source])}`;
}

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

// ACS-R1-05-T06.2 dedupe keys. One canonical disposition event per inbound
// message; a technical failure to establish continuity gets a distinct key
// (never overwrites/collides with a successful disposition for the same message).

export function buildAutonomousTurnDispositionDedupeKey(inboundMessageId: string) {
  return `autonomous-turn-disposition:${inboundMessageId.trim()}`;
}

export function buildAutonomousTurnContinuityFailedDedupeKey(inboundMessageId: string) {
  return `autonomous-turn-continuity-failed:${inboundMessageId.trim()}`;
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

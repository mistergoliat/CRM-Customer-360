import { insertCapabilityExecution } from "./repository";
import { resolveCapabilityGatewayDefinition } from "./registry";
import type { CapabilityGatewayContext, CapabilityGatewayResult } from "./types";

const UNREGISTERED_VERSION = "unregistered" as const;

function nowIso() {
  return new Date().toISOString();
}

/**
 * Single entry point the commercial runtime uses to call a governed
 * capability. Never executes a capability that is not registered (ADR-006
 * absolute prohibition), always persists an audit row, and applies one
 * bounded retry when the capability itself reports a retryable failure.
 */
export async function executeGovernedCapability(
  capabilityName: string,
  input: Record<string, unknown>,
  context: CapabilityGatewayContext
): Promise<CapabilityGatewayResult> {
  const startedAt = nowIso();
  const definition = resolveCapabilityGatewayDefinition(capabilityName);

  if (!definition) {
    const completedAt = nowIso();
    const persisted = await insertCapabilityExecution({
      correlationId: context.correlationId,
      capabilityName,
      capabilityVersion: UNREGISTERED_VERSION,
      availabilityStatus: "denied",
      executionStatus: "denied",
      retryCount: 0,
      retryable: false,
      errorCode: "capability_not_registered",
      requestSummary: input,
      responseSummary: null,
      evidence: [],
      opportunityId: context.opportunityId ?? null,
      conversationId: context.conversationId ?? null,
      decisionId: context.decisionId ?? null,
      actionId: context.actionId ?? null,
      requestId: context.requestId ?? null,
      startedAt,
      completedAt
    });

    return {
      capability: capabilityName,
      version: UNREGISTERED_VERSION,
      availability: "denied",
      status: "denied",
      data: null,
      errorCode: "capability_not_registered",
      retryable: false,
      evidence: [],
      retryCount: 0,
      startedAt,
      completedAt,
      executionPublicId: persisted.publicId
    };
  }

  const availability = await definition.checkAvailability(context);

  if (availability.status !== "available") {
    const executionStatus = availability.status === "unavailable" ? "temporarily_blocked" : availability.status;
    const completedAt = nowIso();
    const persisted = await insertCapabilityExecution({
      correlationId: context.correlationId,
      capabilityName: definition.capability,
      capabilityVersion: definition.version,
      availabilityStatus: availability.status,
      executionStatus,
      retryCount: 0,
      retryable: availability.status === "unavailable" || availability.status === "temporarily_blocked",
      errorCode: availability.reason,
      requestSummary: input,
      responseSummary: null,
      evidence: [],
      opportunityId: context.opportunityId ?? null,
      conversationId: context.conversationId ?? null,
      decisionId: context.decisionId ?? null,
      actionId: context.actionId ?? null,
      requestId: context.requestId ?? null,
      startedAt,
      completedAt
    });

    return {
      capability: definition.capability,
      version: definition.version,
      availability: availability.status,
      status: executionStatus,
      data: null,
      errorCode: availability.reason,
      retryable: availability.status === "unavailable" || availability.status === "temporarily_blocked",
      evidence: [],
      retryCount: 0,
      startedAt,
      completedAt,
      executionPublicId: persisted.publicId
    };
  }

  let retryCount = 0;
  let outcome = await definition.execute(input, context);
  while (outcome.retryable && retryCount < definition.maxRetries) {
    retryCount += 1;
    outcome = await definition.execute(input, context);
  }

  const completedAt = nowIso();
  const persisted = await insertCapabilityExecution({
    correlationId: context.correlationId,
    capabilityName: definition.capability,
    capabilityVersion: definition.version,
    availabilityStatus: availability.status,
    executionStatus: outcome.status,
    retryCount,
    retryable: outcome.retryable,
    errorCode: outcome.errorCode,
    requestSummary: input,
    responseSummary: outcome.data as Record<string, unknown> | null,
    evidence: outcome.evidence,
    opportunityId: context.opportunityId ?? null,
    conversationId: context.conversationId ?? null,
    decisionId: context.decisionId ?? null,
    actionId: context.actionId ?? null,
    requestId: context.requestId ?? null,
    startedAt,
    completedAt
  });

  return {
    capability: definition.capability,
    version: definition.version,
    availability: availability.status,
    status: outcome.status,
    data: outcome.data,
    errorCode: outcome.errorCode,
    retryable: outcome.retryable,
    evidence: outcome.evidence,
    retryCount,
    startedAt,
    completedAt,
    executionPublicId: persisted.publicId
  };
}

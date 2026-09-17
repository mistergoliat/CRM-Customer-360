import type { AgentLoopTerminalReason } from "../../agentStepTypes";
import type { CapabilityEligibilityReasonCode } from "../../../capability-eligibility/types";
import type { CapabilityEvidenceType } from "../../../capability-gateway/types";
import type { BenchmarkProviderCallRecord } from "../types";
import type { CommercialEventRow } from "./eventRows";
import type {
  BenchmarkE2EDurableStateSnapshot,
  BenchmarkE2EEligibilityShadowTrace,
  BenchmarkE2EKernelTrace,
  BenchmarkE2EObjectiveReconciliationTrace,
  BenchmarkE2EOutboxTrace,
  BenchmarkE2EProposalTrace,
  BenchmarkE2ETurnTrace,
  BenchmarkE2EToolInvocationTrace
} from "./types";

/**
 * SALES-AGENT-R3-P7.4. Pure assembler - no IO. Every event row it reads was
 * already fetched by eventRows.ts (loadCommercialEventRowsForInboundMessage),
 * keyed by the canonical source_event_id = inboundMessageId - never a
 * "most recent row" guess. Absence of an event type is not an error: it
 * means that phase's flag was off or never reached this turn (e.g. no
 * commercial_capability_eligibility_evaluated row when
 * capabilityEligibilityShadowEnabled produced nothing to shadow), and the
 * corresponding trace field is simply null.
 */

function findFirst(rows: readonly CommercialEventRow[], eventType: string): Record<string, unknown> | null {
  return rows.find((row) => row.eventType === eventType)?.payload ?? null;
}

function findAll(rows: readonly CommercialEventRow[], eventType: string): Record<string, unknown>[] {
  return rows.filter((row) => row.eventType === eventType).map((row) => row.payload);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function buildKernelTrace(rows: readonly CommercialEventRow[]): BenchmarkE2EKernelTrace {
  const payload = findFirst(rows, "commercial_work_kernel_resolved");
  if (!payload) return null;
  const result = payload.result;
  if (result !== "EXISTING" && result !== "CREATED" && result !== "UNAVAILABLE" && result !== "FAILED") return null;
  return { workId: asString(payload.workId), workVersion: asNumber(payload.workVersion), result };
}

function buildProposalTrace(rows: readonly CommercialEventRow[]): BenchmarkE2EProposalTrace {
  const payload = findFirst(rows, "commercial_proposal_shadow_built");
  if (!payload) return null;
  return {
    present: asBoolean(payload.proposalPresent),
    objectiveKind: asString(payload.objectiveKind),
    operation: asString(payload.operation),
    confidence: asString(payload.confidence),
    requestedOutcome: asString(payload.requestedOutcome),
    evidenceCodes: asStringArray(payload.evidenceCodes)
  };
}

function buildObjectiveReconciliationTrace(rows: readonly CommercialEventRow[]): BenchmarkE2EObjectiveReconciliationTrace {
  const decidedPayload = findFirst(rows, "commercial_objective_reconciliation_decided");
  const reconciledPayload = findFirst(rows, "commercial_objective_reconciled");
  return {
    decided: decidedPayload
      ? {
          decisionAction: asString(decidedPayload.decisionAction) ?? "UNKNOWN",
          reasonCode: asString(decidedPayload.reasonCode) ?? "UNKNOWN",
          workVersionBefore: asNumber(decidedPayload.workVersionBefore) ?? 0,
          proposalObjectiveKind: asString(decidedPayload.proposalObjectiveKind),
          previousObjectiveKind: asString(decidedPayload.previousObjectiveKind)
        }
      : null,
    reconciled: reconciledPayload
      ? {
          workVersionAfter: asNumber(reconciledPayload.workVersionAfter) ?? 0,
          resultingObjectiveKind: asString(reconciledPayload.resultingObjectiveKind),
          resultingObjectiveId: asString(reconciledPayload.resultingObjectiveId)
        }
      : null
  };
}

function buildEligibilityShadowTrace(rows: readonly CommercialEventRow[]): BenchmarkE2EEligibilityShadowTrace {
  const payload = findFirst(rows, "commercial_capability_eligibility_evaluated");
  if (!payload) return null;
  const blockedCapabilities = Array.isArray(payload.blockedCapabilities)
    ? (payload.blockedCapabilities as unknown[])
        .filter((entry): entry is { capability: unknown; reasonCodes: unknown } => typeof entry === "object" && entry !== null)
        .map((entry) => ({ capability: asString(entry.capability) ?? "unknown", reasonCodes: asStringArray(entry.reasonCodes) }))
    : [];
  return {
    workId: asString(payload.workId),
    workVersion: asNumber(payload.workVersion),
    objectiveType: asString(payload.objectiveType),
    eligibleCapabilityNames: asStringArray(payload.eligibleCapabilityNames),
    blockedCapabilities
  };
}

function buildToolInvocationTraces(rows: readonly CommercialEventRow[]): BenchmarkE2EToolInvocationTrace[] {
  return findAll(rows, "commercial_capability_invocation_observed")
    .map((payload) => {
      const eligibilityAtTurnStart = payload.eligibilityAtTurnStart as Record<string, unknown> | null;
      const gateway = payload.gateway as Record<string, unknown> | null;
      const toolObservation = payload.toolObservation as Record<string, unknown> | null;
      const inTurnEvidence = payload.inTurnEvidence as Record<string, unknown> | null;
      return {
        stepIndex: asNumber(payload.stepIndex) ?? -1,
        capability: asString(payload.capability) ?? "unknown",
        workId: asString(payload.workId),
        workVersion: asNumber(payload.workVersion),
        objectiveId: asString(payload.objectiveId),
        objectiveType: asString(payload.objectiveType),
        eligibilityAtTurnStart: eligibilityAtTurnStart
          ? {
              status: asString(eligibilityAtTurnStart.status) ?? "UNKNOWN",
              reasonCodes: asStringArray(eligibilityAtTurnStart.reasonCodes) as readonly CapabilityEligibilityReasonCode[],
              metadataVersion: asString(eligibilityAtTurnStart.metadataVersion) ?? "unknown"
            }
          : null,
        gateway: gateway
          ? { status: asString(gateway.status) ?? "unknown", errorCode: asString(gateway.errorCode), retryable: asBoolean(gateway.retryable) }
          : null,
        toolObservation: {
          status: asString(toolObservation?.status) ?? "unknown",
          errorCode: asString(toolObservation?.errorCode),
          retryable: typeof toolObservation?.retryable === "boolean" ? toolObservation.retryable : null
        },
        inTurnEvidence: {
          relevantEvidenceProduced: asStringArray(inTurnEvidence?.relevantEvidenceProduced) as readonly CapabilityEvidenceType[],
          blockerPotentiallyChanged: asBoolean(inTurnEvidence?.blockerPotentiallyChanged),
          potentiallyAffectedReasonCodes: asStringArray(inTurnEvidence?.potentiallyAffectedReasonCodes) as readonly CapabilityEligibilityReasonCode[]
        }
      };
    })
    .sort((left, right) => left.stepIndex - right.stepIndex);
}

export function buildTurnTrace(input: {
  turnOrdinal: number;
  inboundMessageId: string;
  correlationId: string;
  customerMessage: string;
  eventRows: readonly CommercialEventRow[];
  runtimeStatus: string;
  terminalReason: AgentLoopTerminalReason;
  finalMessage: string | null;
  handoffReason: string | null;
  toolExecutionCount: number;
  runtimeWarnings: readonly string[];
  outboxAttempted: boolean;
  outboxWritten: boolean;
  outboxId: number | null;
  outboxRow: { status: string; messageText: string | null } | null;
  durableStateBeforeTurn: BenchmarkE2EDurableStateSnapshot | null;
  durableStateAfterTurn: BenchmarkE2EDurableStateSnapshot | null;
  providerCalls: readonly BenchmarkProviderCallRecord[];
}): BenchmarkE2ETurnTrace {
  const outbox: BenchmarkE2EOutboxTrace = {
    attempted: input.outboxAttempted,
    outboxWritten: input.outboxWritten,
    outboxId: input.outboxId,
    status: input.outboxRow?.status ?? null,
    messageTextPresent: Boolean(input.outboxRow?.messageText)
  };

  return {
    turnOrdinal: input.turnOrdinal,
    inboundMessageId: input.inboundMessageId,
    correlationId: input.correlationId,
    customerMessage: input.customerMessage,
    durableStateBeforeTurn: input.durableStateBeforeTurn,
    kernel: buildKernelTrace(input.eventRows),
    toolInvocations: buildToolInvocationTraces(input.eventRows),
    proposal: buildProposalTrace(input.eventRows),
    objectiveReconciliation: buildObjectiveReconciliationTrace(input.eventRows),
    eligibilityShadow: buildEligibilityShadowTrace(input.eventRows),
    response: {
      status: input.runtimeStatus,
      terminalReason: input.terminalReason,
      finalMessage: input.finalMessage,
      handoffReason: input.handoffReason,
      toolExecutionCount: input.toolExecutionCount
    },
    runtimeWarnings: input.runtimeWarnings,
    outbox,
    durableStateAfterTurn: input.durableStateAfterTurn,
    providerCalls: input.providerCalls
  };
}

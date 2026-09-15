import { recordAgentTurnInputShadowBuiltCommercialEvent } from "../events/service";
import type { AgentTurnInputShadowObservation } from "./shadow";

/**
 * Persists only the bounded P2 observation. The event is descriptive and
 * deduped by inboundMessageId; callers must invoke it after the R3 terminal
 * outcome and isolate any persistence error from the customer turn.
 */
export async function recordAgentTurnInputShadowObservation(input: {
  observation: AgentTurnInputShadowObservation;
  customerId?: string | number | null;
  conversationId: number;
  opportunityId?: number | string | null;
  occurredAt?: string | null;
  receivedAt?: string | null;
}) {
  const observation = input.observation;
  return recordAgentTurnInputShadowBuiltCommercialEvent({
    inboundMessageId: observation.inboundMessageId,
    correlationId: observation.correlationId,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId,
    opportunityId: input.opportunityId ?? null,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    payload: {
      schemaVersion: observation.schemaVersion,
      inboundMessageId: observation.inboundMessageId,
      case: { ...observation.case },
      state: { ...observation.state },
      capabilityNames: [...observation.capabilityNames],
      buildStatus: observation.buildStatus,
      warnings: [...observation.warnings],
      classification: observation.classification,
      missingRequirements: [...observation.missingRequirements],
      r3CommercialObjective: observation.r3CommercialObjective,
      terminalReason: observation.terminalReason,
      toolExecutionCount: observation.toolExecutionCount,
      outboxWritten: observation.outboxWritten,
      outboxId: observation.outboxId,
      toolComparison: observation.toolComparison,
      addedDbReads: observation.addedDbReads,
      addedHttpReads: observation.addedHttpReads,
      sessionAvailable: observation.sessionAvailable,
      sessionVersion: observation.sessionVersion
    }
  });
}

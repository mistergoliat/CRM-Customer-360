import { resolveCapabilityGatewayDefinition } from "../capability-gateway/registry";
import type { CapabilityEvidenceType } from "../capability-gateway/types";
import { CAPABILITY_ELIGIBILITY_REASON_CODE_TO_EVIDENCE } from "./blockerEvidenceMapping";
import type { CapabilityEligibilityAtTurnStart } from "./lookupCapabilityEligibility";
import type { CapabilityEligibilityReasonCode } from "./types";

/**
 * SALES-AGENT-R3-P7.3. One prior use_tool decision from the same turn,
 * reduced to exactly what this derivation needs - never the full
 * AgentLoopStepRecord/AgentStep union, so this module has no dependency on
 * agent-loop's types (capability-eligibility stays a DRM/registry sidecar,
 * never coupled to a specific loop implementation). `observationStatus` is
 * the real ToolObservation.status already built for that step - the caller
 * never pre-filters "only completed" itself; this function is the one place
 * that decides which prior outcomes count as evidence.
 */
export type PriorToolStepForEvidence = {
  readonly stepIndex: number;
  readonly capability: string;
  readonly observationStatus: "completed" | "failed" | "blocked" | "skipped";
};

export type InTurnEvidenceSignal = {
  readonly relevantEvidenceProducedThisTurn: readonly CapabilityEvidenceType[];
  /**
   * Naming is deliberate: this is NOT blockerResolvedThisTurn. Without
   * DRM reprojection (P8), P7.3 cannot know the prerequisite is CURRENT
   * again - only that a capability whose registry-declared evidenceProduced
   * relates to this blocker's reason code actually completed earlier in the
   * same turn. The Capability Gateway remains the sole authority on whether
   * execution is actually permitted.
   */
  readonly blockerPotentiallyChangedThisTurn: boolean;
  /** Subset of eligibilityAtTurnStart.reasonCodes whose mapped evidence was produced - empty when blockerPotentiallyChangedThisTurn is false. */
  readonly potentiallyAffectedReasonCodes: readonly CapabilityEligibilityReasonCode[];
};

const NO_SIGNAL: InTurnEvidenceSignal = {
  relevantEvidenceProducedThisTurn: [],
  blockerPotentiallyChangedThisTurn: false,
  potentiallyAffectedReasonCodes: []
};

/**
 * Pure function - no IO, no DB, no HTTP, no DRM, no Gateway execution, no
 * LLM. Derives, for one capability invocation blocked at turn start, whether
 * any prior *completed* tool call in the same turn (stepIndex strictly less
 * than currentStepIndex - never the current or a future step) produced
 * evidence the Gateway registry itself declares as relevant to that
 * blocker's reason code(s).
 *
 * Deliberately NOT a generic "any mutation happened" flag: relevance is
 * always mediated by CAPABILITY_ELIGIBILITY_REASON_CODE_TO_EVIDENCE and the
 * registry's own evidenceProduced, never by tool name or side effect alone.
 * ELIGIBLE-at-turn-start and null snapshots both short-circuit to NO_SIGNAL:
 * this function never recomputes or overrides eligibilityAtTurnStart, it
 * only annotates a BLOCKED entry with what happened since.
 */
export function deriveInTurnEvidenceForInvocation(input: {
  readonly currentStepIndex: number;
  readonly eligibilityAtTurnStart: CapabilityEligibilityAtTurnStart | null;
  readonly priorToolSteps: readonly PriorToolStepForEvidence[];
}): InTurnEvidenceSignal {
  if (!input.eligibilityAtTurnStart || input.eligibilityAtTurnStart.status !== "BLOCKED") return NO_SIGNAL;

  const blockedReasonCodes = input.eligibilityAtTurnStart.reasonCodes;
  const relevantEvidenceCodes = new Set<CapabilityEvidenceType>();
  for (const reasonCode of blockedReasonCodes) {
    for (const evidenceCode of CAPABILITY_ELIGIBILITY_REASON_CODE_TO_EVIDENCE[reasonCode] ?? []) {
      relevantEvidenceCodes.add(evidenceCode);
    }
  }
  if (relevantEvidenceCodes.size === 0) return NO_SIGNAL;

  const producedEvidenceCodes = new Set<CapabilityEvidenceType>();
  for (const priorStep of input.priorToolSteps) {
    if (priorStep.stepIndex >= input.currentStepIndex) continue;
    if (priorStep.observationStatus !== "completed") continue;
    const definition = resolveCapabilityGatewayDefinition(priorStep.capability);
    for (const evidenceCode of definition?.evidenceProduced ?? []) {
      producedEvidenceCodes.add(evidenceCode);
    }
  }
  if (producedEvidenceCodes.size === 0) return NO_SIGNAL;

  const relevantEvidenceProducedThisTurn = [...relevantEvidenceCodes].filter((code) => producedEvidenceCodes.has(code));
  if (relevantEvidenceProducedThisTurn.length === 0) return NO_SIGNAL;

  const potentiallyAffectedReasonCodes = blockedReasonCodes.filter((reasonCode) =>
    (CAPABILITY_ELIGIBILITY_REASON_CODE_TO_EVIDENCE[reasonCode] ?? []).some((code) => producedEvidenceCodes.has(code))
  );

  return { relevantEvidenceProducedThisTurn, blockerPotentiallyChangedThisTurn: true, potentiallyAffectedReasonCodes };
}

import type { CapabilityEligibilityReasonCode, CapabilityEligibilitySnapshot, CapabilityEligibilityStatus } from "./types";

/**
 * SALES-AGENT-R3-P7.2. What the model saw for one capability inside the
 * pre-cognition snapshot already computed at the start of this turn
 * (eligibilityAtTurnStart semantics - never eligibilityAtExecutionTime).
 * Deliberately excludes executionClass/workId/objectiveId/PII: telemetry
 * only needs the coherence signal, never the full internal snapshot.
 */
export type CapabilityEligibilityAtTurnStart = {
  readonly status: CapabilityEligibilityStatus;
  readonly reasonCodes: readonly CapabilityEligibilityReasonCode[];
  readonly metadataVersion: string;
};

/**
 * Pure lookup, no recomputation. `snapshot` is exactly the same
 * CapabilityEligibilitySnapshot P6.3 already evaluated once before the
 * provider ran (SalesAgentRuntimeResult.cognitionContext.preCognitionCapabilityEligibility) -
 * never rebuilt, never re-derived from a fresher DRM. A capability absent
 * from both lists (not covered by P6's definitions, or no snapshot at all)
 * returns null - never a fabricated ELIGIBLE/BLOCKED guess.
 */
export function lookupCapabilityEligibility(
  snapshot: CapabilityEligibilitySnapshot | null,
  capability: string
): CapabilityEligibilityAtTurnStart | null {
  if (!snapshot) return null;
  const eligible = snapshot.eligible.find((entry) => entry.capability === capability);
  if (eligible) return { status: "ELIGIBLE", reasonCodes: eligible.reasonCodes, metadataVersion: snapshot.metadataVersion };
  const blocked = snapshot.blocked.find((entry) => entry.capability === capability);
  if (blocked) return { status: "BLOCKED", reasonCodes: blocked.reasonCodes, metadataVersion: snapshot.metadataVersion };
  return null;
}

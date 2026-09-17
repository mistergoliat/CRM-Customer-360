import type { AgentCapabilityEligibilityView } from "../agent-turn-input/types";
import type { CapabilityEligibilitySnapshot } from "./types";

/**
 * P6.3's one-way cognitive projection. Keep telemetry's complete snapshot
 * internal: the model receives only canonical names and structural blockers.
 */
export function toAgentCapabilityEligibilityView(snapshot: CapabilityEligibilitySnapshot): AgentCapabilityEligibilityView {
  return {
    schemaVersion: snapshot.schemaVersion,
    metadataVersion: snapshot.metadataVersion,
    eligible: snapshot.eligible.map((entry) => entry.capability),
    blocked: snapshot.blocked.map((entry) => ({
      capability: entry.capability,
      reasonCodes: [...entry.reasonCodes]
    }))
  };
}

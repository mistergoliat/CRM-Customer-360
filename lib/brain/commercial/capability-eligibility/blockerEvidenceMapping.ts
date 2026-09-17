import type { CapabilityEvidenceType } from "../capability-gateway/types";
import type { CapabilityEligibilityReasonCode } from "./types";

/**
 * SALES-AGENT-R3-P7.3 (In-turn Relevant Evidence Correlation). Pure,
 * hand-curated mapping from a P6 structural blocker reason code to the
 * Capability Gateway registry's own evidenceProduced/evidenceRequired codes
 * (capability-gateway/types.ts#CapabilityEvidenceType) that could plausibly
 * have changed that specific blocker within the same turn. This is a
 * sidecar of two existing models (P6's reason codes, the Gateway's evidence
 * codes) - never a third, independently-maintained semantic model, and
 * never inferred at runtime from tool names or side effects.
 *
 * A reason code absent from this map (OBJECTIVE_REQUIRED,
 * OBJECTIVE_INCOMPATIBLE, IDENTITY_LEVEL_INSUFFICIENT) has no unambiguous,
 * evidence-producing capability in the current registry: no capability in
 * AGENT_LOOP_TOOL_POOL declares evidenceProduced for objective state or
 * identity level, and inventing one here would assert commercial semantics
 * this repo does not otherwise support. deriveInTurnEvidence.ts treats a
 * missing entry as "no relevant evidence possible", never as a fabricated
 * empty-but-implied relation.
 */
export const CAPABILITY_ELIGIBILITY_REASON_CODE_TO_EVIDENCE: Readonly<
  Partial<Record<CapabilityEligibilityReasonCode, readonly CapabilityEvidenceType[]>>
> = {
  MISSING_SELECTION: ["COMMERCIAL_SELECTION_STATE"],
  SELECTION_NOT_CURRENT: ["COMMERCIAL_SELECTION_STATE"],
  MISSING_DESTINATION: ["COMMERCIAL_DESTINATION_STATE"],
  DESTINATION_NOT_CURRENT: ["COMMERCIAL_DESTINATION_STATE"],
  MISSING_QUOTE: ["QUOTE_CREATED"],
  QUOTE_NOT_CURRENT: ["QUOTE_CREATED"]
};

import type { CommercialObjectiveKind } from "../../commercial-proposal/types";

/**
 * SALES-AGENT-R3-P5.
 *
 * Deterministic decision produced by reconciling a CommercialProposalV1
 * against the current CommercialWork objective state. Never inferred from
 * customer free text, never a second model call - see reconcile.ts's own
 * comment for the full rule set.
 */
export type CommercialObjectiveReconciliationDecision =
  | { action: "NOOP"; reasonCode: string }
  | { action: "REJECT"; reasonCode: string }
  | { action: "START"; kind: CommercialObjectiveKind; reasonCode: string }
  | { action: "CONTINUE"; objectiveId: string; reasonCode: string }
  | { action: "MODIFY"; objectiveId: string; reasonCode: string }
  | { action: "REPLACE"; previousObjectiveId: string; kind: CommercialObjectiveKind; reasonCode: string }
  | { action: "CANCEL"; objectiveId: string; reasonCode: string };

export type CommercialObjectiveReconciliationDecisionAction = CommercialObjectiveReconciliationDecision["action"];

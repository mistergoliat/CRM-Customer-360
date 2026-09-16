/**
 * SALES-AGENT-R3-P4.
 *
 * Structured commercial interpretation emitted by the SAME R3 cognition
 * harness that produces AgentStep.
 *
 * This is a proposal only:
 * - it does not mutate CommercialWork;
 * - it does not create objective ids;
 * - it does not own workVersion/CAS;
 * - it does not authorize capability execution;
 * - P5 will reconcile it deterministically against durable state.
 */

export const COMMERCIAL_PROPOSAL_SCHEMA_VERSION = "1" as const;

export const COMMERCIAL_OBJECTIVE_KINDS = [
  "DISCOVER_NEED",
  "SELECT_PRODUCTS",
  "QUOTE",
  "ORDER",
  "AFTER_SALES"
] as const;

export type CommercialObjectiveKind =
  (typeof COMMERCIAL_OBJECTIVE_KINDS)[number];

export const COMMERCIAL_OBJECTIVE_OPERATIONS = [
  "START",
  "CONTINUE",
  "MODIFY",
  "REPLACE",
  "COMPLETE",
  "CANCEL",
  "NONE"
] as const;

export type CommercialObjectiveOperation =
  (typeof COMMERCIAL_OBJECTIVE_OPERATIONS)[number];

export const COMMERCIAL_PROPOSAL_CONFIDENCES = [
  "HIGH",
  "MEDIUM",
  "LOW"
] as const;

export type CommercialProposalConfidence =
  (typeof COMMERCIAL_PROPOSAL_CONFIDENCES)[number];

export const COMMERCIAL_REQUESTED_OUTCOMES = [
  "RECOMMENDATION",
  "PRODUCT_SELECTION",
  "SHIPPING_CALCULATION",
  "QUOTE_CREATION",
  "QUOTE_RETRIEVAL",
  "QUOTE_DELIVERY",
  "ORDER_PROGRESS",
  "AFTER_SALES_RESOLUTION",
  "CLARIFICATION",
  "OTHER"
] as const;

export type CommercialRequestedOutcome =
  (typeof COMMERCIAL_REQUESTED_OUTCOMES)[number];

export const COMMERCIAL_REQUIREMENTS = [
  "PRODUCTS",
  "QUANTITY",
  "BUDGET",
  "DESTINATION",
  "SHIPPING",
  "IDENTITY"
] as const;

export type CommercialRequirement =
  (typeof COMMERCIAL_REQUIREMENTS)[number];

export const COMMERCIAL_REQUIREMENT_SIGNALS = [
  "PROVIDED",
  "CHANGED",
  "REQUESTED",
  "AMBIGUOUS"
] as const;

export type CommercialRequirementSignal =
  (typeof COMMERCIAL_REQUIREMENT_SIGNALS)[number];

export type CommercialProposalRequirementSignal = {
  requirement: CommercialRequirement;
  signal: CommercialRequirementSignal;
};

export type CommercialProposalV1 = {
  schemaVersion: typeof COMMERCIAL_PROPOSAL_SCHEMA_VERSION;

  objective: {
    kind: CommercialObjectiveKind;
    operation: CommercialObjectiveOperation;
    confidence: CommercialProposalConfidence;
  } | null;

  requestedOutcome: CommercialRequestedOutcome | null;

  requirementSignals: CommercialProposalRequirementSignal[];

  /**
   * Fixed/bounded semantic evidence labels only.
   * Never chain-of-thought and never customer free text.
   */
  evidenceCodes: string[];

  ambiguity: {
    present: boolean;
    reasonCode: string | null;
  };
};

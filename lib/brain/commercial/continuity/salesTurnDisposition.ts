import type {
  AutonomousTurnCommercialObjective,
  AutonomousTurnResponseOwner,
  AutonomousTurnTerminalOutcome
} from "../events/types";

export type { AutonomousTurnCommercialObjective, AutonomousTurnResponseOwner, AutonomousTurnTerminalOutcome };

/**
 * ACS-R1-05-T06.2 (release spec section A2). The durable, terminal record of
 * what happened to one autonomous sales turn - continuity is satisfied only
 * when a response (or a real responsible party) exists, commercial context
 * was preserved, the opportunity stays coherent, a next best action is
 * defined, and follow-up eligibility is explicit when it applies.
 */
export type SalesTurnDisposition = {
  terminalOutcome: AutonomousTurnTerminalOutcome;
  commercialObjective: AutonomousTurnCommercialObjective;
  responseOwner: AutonomousTurnResponseOwner;
  responsePlanned: boolean;
  opportunityAdvanced: boolean;
  nextBestActionDefined: boolean;
  fallbackUsed: boolean;
  followUpEligible: boolean;
  followUpReason: string | null;
};

/** Reasons a customer-facing fallback message may be synthesized (release spec section A7). */
export const CONTINUITY_FALLBACK_CLASSES = [
  "catalog_unavailable",
  "model_unavailable",
  "invalid_model_result",
  "unsafe_primary_draft",
  "handoff_acknowledgement"
] as const;
export type ContinuityFallbackClass = (typeof CONTINUITY_FALLBACK_CLASSES)[number];

/** Reasons the reactive turn's own outcome should never trigger a synthesized fallback (release spec section A7 exclusions). */
export const CONTINUITY_NO_FALLBACK_REASONS = [
  "recipient_not_whitelisted",
  "unsupported_channel",
  "existing_human_owner_active",
  "ai_blocked",
  "opt_out",
  "case_closed",
  "duplicate_inbound",
  "technical_event"
] as const;
export type ContinuityNoFallbackReason = (typeof CONTINUITY_NO_FALLBACK_REASONS)[number];

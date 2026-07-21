import type {
  AutonomousTurnCommercialObjective,
  AutonomousTurnResponseOwner,
  AutonomousTurnTerminalOutcome,
  AutonomousTurnWaitingFor
} from "../events/types";

export type { AutonomousTurnCommercialObjective, AutonomousTurnResponseOwner, AutonomousTurnTerminalOutcome, AutonomousTurnWaitingFor };

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
  /**
   * ACS-R1-05-T06.2 (second correction, section 9). When the AI sends a
   * safe acknowledgement ("Voy a confirmar este punto con el equipo...")
   * standing in for an unsafe/ungrounded draft, `acknowledgementSender`
   * records that the AI authored that acknowledgement while `responseOwner`
   * still correctly reads "human" - the real resolution depends on a
   * person, even though the AI was the one who told the customer that.
   * `null` when no acknowledgement-style fallback was used this turn.
   */
  acknowledgementSender: AutonomousTurnResponseOwner | null;
  /** What this turn is now waiting on - "none" when the turn reached a real terminal outcome with nothing pending. */
  waitingFor: AutonomousTurnWaitingFor;
  /** True when this turn's outcome depends on a durable, queryable record a human can act on (the terminalized original action + this disposition event) - never a new table, never a reservation/hold record. */
  handoffCreated: boolean;
};

/** Reasons a customer-facing fallback message may be synthesized (release spec section A7). */
export const CONTINUITY_FALLBACK_CLASSES = [
  "catalog_unavailable",
  "model_unavailable",
  "invalid_model_result",
  "unsafe_primary_draft",
  "handoff_acknowledgement",
  // ACS-R1-05.1-T02.1: the native agent tool loop exhausted its decision
  // budget (spec section 11) without reaching respond/handoff.
  "max_steps_exceeded"
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

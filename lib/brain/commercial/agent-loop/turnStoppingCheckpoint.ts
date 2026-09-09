// SALES-AGENT-R3-V1.8.2-B (Open Turn Execution Core). The one place a
// candidate respond/handoff AgentStep is evaluated for whether the turn may
// actually terminate on it, under BRAIN_R3_OPEN_TURN_EXECUTION_ENABLED.
// Structural execution evidence only - no commercial strategy, no semantic
// task-completion judgment, no persisted reasoning, no text/regex inspection
// of the candidate's own message. See
// docs/releases/SALES-AGENT-R3-V1.8.2-A-HARNESS-ALIGNED-TURN-SEMANTICS-CONTRACT-AUDIT.md
// Deliverable 10 for the Turn/Step/Work-owed/Quiescence/Terminal-checkpoint
// contract this implements, and Deliverable 5 for why `respond` being
// unconditionally terminal was the audit's #2 ranked causal gap.

export const TURN_STOPPING_CHECKPOINT_DECISIONS = ["accept_stop", "continue"] as const;
export type TurnStoppingCheckpointDecision = (typeof TURN_STOPPING_CHECKPOINT_DECISIONS)[number];

export type TurnStoppingCheckpointInput = {
  candidateStepType: "respond" | "handoff";
  /**
   * Structural evidence-backing signal, computed by the caller via the
   * EXISTING checkUnbackedCommercialMutationClaim (commercialMutationClaims.ts)
   * - never a new regex rule, this module never inspects text itself. True
   * only when the candidate's own message claims a completed governed action
   * with no backing observation this turn. Always false for a "handoff"
   * candidate - a handoff carries no customer-facing completion claim.
   */
  unbackedExecutionClaim: boolean;
  /**
   * True only when a tool executed this turn and no subsequent accepted step
   * has yet had an opportunity to reason over it. Always false today in this
   * loop's sequential (at most one tool call per step) architecture: every
   * candidate is itself produced by a provider call whose own prompt already
   * included every prior step/observation (buildAgentStepPromptPackage's
   * priorSteps) - so "reasoning already happened" is guaranteed by
   * construction, not by this check. Computed for real by the caller (never
   * hardcoded here) so this stays meaningful if a future step is ever
   * allowed more than one tool call.
   */
  hasUnreasonedToolObservation: boolean;
  /** External cancellation (AbortSignal) always wins - never itself blocked by this checkpoint. */
  cancelled: boolean;
  /** Wall-clock deadline exceeded always wins - same reasoning as cancelled. */
  deadlineExceeded: boolean;
};

export type TurnStoppingCheckpointResult = {
  decision: TurnStoppingCheckpointDecision;
  reason: string;
};

/**
 * Deliberately narrow: decides ONLY whether the turn is structurally
 * quiescent enough to let this exact candidate terminate it. Never decides
 * search strategy, product recommendations, whether to ask for budget, or
 * any other commercial judgment - the model's own reasoning about WHAT to do
 * next stays entirely its own; this only ever gates WHETHER "I'm done" may
 * be accepted right now.
 */
export function evaluateTurnStoppingCheckpoint(input: TurnStoppingCheckpointInput): TurnStoppingCheckpointResult {
  if (input.cancelled) return { decision: "accept_stop", reason: "cancelled_overrides_checkpoint" };
  if (input.deadlineExceeded) return { decision: "accept_stop", reason: "deadline_overrides_checkpoint" };
  if (input.hasUnreasonedToolObservation) return { decision: "continue", reason: "unreasoned_tool_observation" };
  if (input.unbackedExecutionClaim) return { decision: "continue", reason: "unbacked_execution_claim" };
  return { decision: "accept_stop", reason: "quiescent" };
}

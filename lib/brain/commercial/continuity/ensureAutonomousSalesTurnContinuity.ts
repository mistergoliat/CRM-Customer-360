import { runNativeAutonomousCycle } from "../native-cycle/runNativeAutonomousCycle";
import type { NativeAutonomousCycleInput, NativeAutonomousCycleResult } from "../native-cycle/runNativeAutonomousCycle";
import type { CommercialNextAction } from "../operational-loop";
import { terminalizeBlockedAgentAction } from "./terminalizeBlockedAgentAction";
import { dispatchFallbackAction } from "./dispatchFallbackAction";
import { buildContinuityFallbackMessage } from "./buildContinuityFallbackMessage";
import type { ContinuityFallbackClass } from "./salesTurnDisposition";
import type { AutonomousTurnCommercialObjective, SalesTurnDisposition } from "./salesTurnDisposition";
import {
  recordAutonomousTurnContinuityFailedCommercialEvent,
  recordAutonomousTurnDispositionCommercialEvent
} from "../events/service";
import type { AutonomousTurnDispositionRecordedPayload } from "../events/types";

/**
 * ACS-R1-05-T06.2 (release spec section A1). Shared application service:
 * runs the autonomous commercial cycle and guarantees the turn never ends in
 * silence. Reusable by processNativeWhatsAppInbound (wired in this task) and,
 * later, by runFollowupTick / a future proactive-contact runner - this task
 * connects it functionally only to the reactive cycle (section A1: "En T06.2
 * conectala funcionalmente solo al ciclo reactivo").
 */
export type EnsureAutonomousSalesTurnContinuityInput = NativeAutonomousCycleInput & {
  /** Test-only injection point; production callers never set this (defaults to the real runNativeAutonomousCycle). */
  cycleRunner?: typeof runNativeAutonomousCycle;
};

export type EnsureAutonomousSalesTurnContinuityResult = {
  cycle: NativeAutonomousCycleResult;
  disposition: SalesTurnDisposition;
};

const CUSTOMER_FACING_NEXT_ACTION_TYPES = new Set<CommercialNextAction["type"]>(["respond", "ask_clarifying_question"]);

function inboundMessageIdOf(input: EnsureAutonomousSalesTurnContinuityInput): string {
  return input.messageId === null || input.messageId === undefined ? input.correlationId : String(input.messageId);
}

function mapCommercialObjective(nextActionType: CommercialNextAction["type"] | null, catalogExecuted: boolean): AutonomousTurnCommercialObjective {
  switch (nextActionType) {
    case "respond":
      return catalogExecuted ? "recommend" : "retain_interest";
    case "ask_clarifying_question":
      return "discover_need";
    case "qualify":
      return "qualify";
    case "recommend_products":
      return "recommend";
    case "prepare_quote":
      return "prepare_quote";
    case "escalate_to_operator":
      return "handoff";
    case "propose_followup":
    case "wait_for_customer":
    case "pause":
    case "close_as_lost_candidate":
      return "retain_interest";
    default:
      return "none";
  }
}

function classifyFallback(cycle: NativeAutonomousCycleResult): ContinuityFallbackClass {
  if (cycle.warnings.some((warning) => warning.startsWith("shadow_failed:"))) return "model_unavailable";
  if (cycle.catalogCapability?.warnings.some((warning) => warning === "catalog_batch_unavailable" || warning === "catalog_stage_unavailable")) {
    return "catalog_unavailable";
  }
  if (cycle.warnings.some((warning) => warning.startsWith("loop_failed:"))) return "invalid_model_result";
  if (!cycle.loop || cycle.loop.status === "failed_safe") return "invalid_model_result";
  return "unsafe_primary_draft";
}

async function persistDisposition(input: {
  inboundMessageId: string;
  correlationId: string;
  conversationId: number;
  opportunityId: string | number | null;
  disposition: SalesTurnDisposition;
  primaryActionId: string | null;
  primaryDisposition: string | null;
  primaryBlockReasons: string[];
  fallbackActionId: string | null;
  outboxId: string | null;
}) {
  const payload: AutonomousTurnDispositionRecordedPayload = {
    inboundMessageId: input.inboundMessageId,
    responseOwner: input.disposition.responseOwner,
    commercialObjective: input.disposition.commercialObjective,
    primaryActionId: input.primaryActionId,
    primaryDisposition: input.primaryDisposition,
    primaryBlockReasons: input.primaryBlockReasons,
    fallbackActionId: input.fallbackActionId,
    outboxId: input.outboxId,
    opportunityAdvanced: input.disposition.opportunityAdvanced,
    nextBestAction: input.disposition.nextBestActionDefined ? "defined" : null,
    followUpEligible: input.disposition.followUpEligible,
    followUpReason: input.disposition.followUpReason,
    terminalOutcome: input.disposition.terminalOutcome,
    acknowledgementSender: input.disposition.acknowledgementSender,
    waitingFor: input.disposition.waitingFor,
    handoffCreated: input.disposition.handoffCreated
  };

  try {
    await recordAutonomousTurnDispositionCommercialEvent({
      inboundMessageId: input.inboundMessageId,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      opportunityId: input.opportunityId,
      payload
    });
  } catch {
    // Observability must never break the turn itself - the durable state
    // (crm_agent_actions/crm_agent_decisions/crm_opportunities) already
    // reflects the outcome regardless of this audit write succeeding.
  }
}

async function persistContinuityFailed(input: { inboundMessageId: string; correlationId: string; conversationId: number | null; reason: string }) {
  try {
    await recordAutonomousTurnContinuityFailedCommercialEvent({
      inboundMessageId: input.inboundMessageId,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      reason: input.reason
    });
  } catch {
    // Same rationale as persistDisposition above.
  }
}

function baseDisposition(overrides: Partial<SalesTurnDisposition> & Pick<SalesTurnDisposition, "terminalOutcome" | "responseOwner">): SalesTurnDisposition {
  return {
    commercialObjective: "none",
    responsePlanned: false,
    opportunityAdvanced: false,
    nextBestActionDefined: false,
    fallbackUsed: false,
    followUpEligible: false,
    followUpReason: null,
    acknowledgementSender: null,
    waitingFor: "none",
    handoffCreated: false,
    ...overrides
  };
}

/** Reasons runNativeAutonomousCycle intentionally never engages this conversation at all (pilot allowlist / feature flags off) - pre-existing, already-tested (T06.1) safety gates, out of scope for continuity duty. */
const INTENTIONAL_NO_RUN_REASONS = new Set(["wa_id_not_authorized_for_pilot", "autonomous_cycle_disabled", "shadow_disabled"]);

export async function ensureAutonomousSalesTurnContinuity(
  input: EnsureAutonomousSalesTurnContinuityInput
): Promise<EnsureAutonomousSalesTurnContinuityResult> {
  const cycleRunner = input.cycleRunner ?? runNativeAutonomousCycle;
  const cycle = await cycleRunner({
    conversationId: input.conversationId,
    conversationPublicId: input.conversationPublicId,
    customerMasterId: input.customerMasterId,
    waId: input.waId,
    phoneNumberId: input.phoneNumberId,
    messageId: input.messageId,
    messageText: input.messageText,
    correlationId: input.correlationId,
    currentTime: input.currentTime,
    abortSignal: input.abortSignal,
    provider: input.provider,
    loadCustomer360: input.loadCustomer360,
    customerSessionDependencies: input.customerSessionDependencies
  });
  const inboundMessageId = inboundMessageIdOf(input);

  if (!cycle.ran) {
    if (INTENTIONAL_NO_RUN_REASONS.has(cycle.reason ?? "")) {
      // Out of pilot/feature scope by design - no autonomous action of any
      // kind is authorized for this conversation, so there is nothing for
      // continuity to guarantee (see T06.1 pilot isolation).
      return { cycle, disposition: baseDisposition({ terminalOutcome: "no_response_required", responseOwner: "none" }) };
    }

    // A real technical failure (e.g. conversation_not_found) before any
    // session/context could be established - no responsible party, no valid
    // fallback path (no conversationCaseId to attach a fallback action to).
    const disposition = baseDisposition({ terminalOutcome: "continuity_failed", responseOwner: "none" });
    await persistContinuityFailed({
      inboundMessageId,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      reason: cycle.reason ?? "unknown"
    });
    return { cycle, disposition };
  }

  const loop = cycle.loop;
  const bridge = cycle.bridge;
  const resultingState = loop?.resultingState ?? null;
  const nextActionType = loop?.selectedNextAction?.type ?? null;
  const opportunityId = resultingState?.opportunityId ?? null;
  const opportunityAdvanced = Boolean(loop?.sideEffects?.commercialOpportunityWritten);
  const nextBestActionDefined = Boolean(nextActionType && nextActionType !== "no_action");
  const followUpEligible = nextActionType === "propose_followup";
  const followUpReason = followUpEligible ? loop?.selectedNextAction?.reason ?? null : null;
  const catalogExecuted = Boolean(cycle.catalogCapability?.executed && cycle.catalogCapability.ranking);

  const humanOwnerActive = Boolean(resultingState?.humanOwnerActive);
  const aiBlocked = Boolean(resultingState?.aiBlocked);

  // A4: real human ownership - AI must never simulate continuity over a
  // conversation a human already owns or that is explicitly AI-blocked.
  if (humanOwnerActive || aiBlocked) {
    const disposition = baseDisposition({
      terminalOutcome: "human_response_required",
      responseOwner: "human",
      waitingFor: "human_response",
      handoffCreated: true,
      commercialObjective: mapCommercialObjective(nextActionType, catalogExecuted),
      opportunityAdvanced,
      nextBestActionDefined,
      followUpEligible,
      followUpReason
    });
    await persistDisposition({
      inboundMessageId,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      opportunityId,
      disposition,
      primaryActionId: bridge?.action?.actionId ?? null,
      primaryDisposition: bridge?.status ?? null,
      primaryBlockReasons: [],
      fallbackActionId: null,
      outboxId: null
    });
    return { cycle, disposition };
  }

  const responsePlanned = bridge !== null && bridge.status === "outbox_planned";
  const commercialNeed = cycle.commercialNeed ?? { productQuery: null, usage: null, budgetMax: null, currency: null };

  // A handoff decision is its own scenario: not blocked, but the customer
  // still deserves an acknowledgement (governance permitting) rather than
  // silence while a human takes over.
  if (nextActionType === "escalate_to_operator" && !responsePlanned) {
    const message = buildContinuityFallbackMessage("handoff_acknowledgement", commercialNeed);
    const dispatched = await dispatchFallbackAction({
      conversationId: input.conversationId,
      conversationCaseId: resultingState?.conversationCaseId ?? input.conversationId,
      opportunityId,
      decisionId: loop?.decisionRecord?.decisionId ?? null,
      waId: input.waId,
      inboundMessageId,
      currentTime: input.currentTime,
      fallbackClass: "handoff_acknowledgement",
      message,
      humanOwnerActive: false,
      aiBlocked: false,
      caseStatus: resultingState?.status ?? null
    });

    /**
     * ACS-R1-05-T06.2 (second correction, section 9): the AI may author the
     * acknowledgement text, but ownership of the actual resolution is
     * always the human being handed off to - `responseOwner` reads "human"
     * even when `dispatched.outboxWritten` is true; `acknowledgementSender`
     * separately records that the AI sent that specific message.
     */
    const disposition = baseDisposition({
      terminalOutcome: dispatched.outboxWritten ? "handoff_acknowledgement_planned" : "human_response_required",
      responseOwner: "human",
      acknowledgementSender: dispatched.outboxWritten ? "ai" : null,
      waitingFor: "human_response",
      handoffCreated: true,
      commercialObjective: "handoff",
      responsePlanned: dispatched.outboxWritten,
      opportunityAdvanced,
      nextBestActionDefined,
      fallbackUsed: dispatched.attempted,
      followUpEligible,
      followUpReason
    });
    await persistDisposition({
      inboundMessageId,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      opportunityId,
      disposition,
      primaryActionId: bridge?.action?.actionId ?? null,
      primaryDisposition: bridge?.status ?? null,
      primaryBlockReasons: [],
      fallbackActionId: dispatched.action?.actionId ?? null,
      outboxId: dispatched.outboxId === null ? null : String(dispatched.outboxId)
    });
    return { cycle, disposition };
  }

  const isCustomerFacingIntent = nextActionType !== null && CUSTOMER_FACING_NEXT_ACTION_TYPES.has(nextActionType);

  if (isCustomerFacingIntent && !responsePlanned) {
    const originalBlockReasons = [...(bridge?.sandboxEvaluation?.blockReasons ?? []), ...(bridge?.executionGate?.blockReasons ?? [])];

    // A5: terminalize the original blocked/stuck action before creating a
    // fallback - it must never be left sitting at a pre-execution status
    // forever with no outbox attached.
    if (bridge?.action?.actionId) {
      await terminalizeBlockedAgentAction({
        actionId: bridge.action.actionId,
        failureReason: bridge.error ?? bridge.status,
        blockReasons: originalBlockReasons
      });
    }

    // A7: some block reasons require a structured disposition and correct
    // ownership, never a synthesized fallback attempt (recipient outside the
    // authorized channel, unsupported channel, or a case already closed -
    // opt_out/ai_blocked/human_owner_active are handled earlier via the
    // real channel-state check above).
    if (originalBlockReasons.some((reason) => reason === "recipient_not_whitelisted" || reason === "unsupported_channel" || reason === "case_closed")) {
      const disposition = baseDisposition({
        terminalOutcome: "human_response_required",
        responseOwner: "human",
        waitingFor: "human_response",
        commercialObjective: mapCommercialObjective(nextActionType, catalogExecuted),
        opportunityAdvanced,
        nextBestActionDefined,
        followUpEligible,
        followUpReason
      });
      await persistDisposition({
        inboundMessageId,
        correlationId: input.correlationId,
        conversationId: input.conversationId,
        opportunityId,
        disposition,
        primaryActionId: bridge?.action?.actionId ?? null,
        primaryDisposition: bridge?.status ?? null,
        primaryBlockReasons: originalBlockReasons,
        fallbackActionId: null,
        outboxId: null
      });
      return { cycle, disposition };
    }

    const fallbackClass = classifyFallback(cycle);
    /**
     * ACS-R1-05-T06.2 (second correction, section 9): only `unsafe_primary_draft`
     * means the draft was blocked for CONTENT reasons (an unsupported
     * commitment, or an ungrounded commercial statement) - that genuinely
     * needs a person's judgment, not just a retry. `catalog_unavailable` /
     * `model_unavailable` / `invalid_model_result` are infrastructure
     * failures the AI can legitimately keep owning and retry autonomously
     * on a later turn, so `responseOwner` stays "ai" for those.
     */
    const isSafetyFallback = fallbackClass === "unsafe_primary_draft";
    const message = buildContinuityFallbackMessage(fallbackClass, commercialNeed);
    const dispatched = await dispatchFallbackAction({
      conversationId: input.conversationId,
      conversationCaseId: resultingState?.conversationCaseId ?? input.conversationId,
      opportunityId,
      decisionId: loop?.decisionRecord?.decisionId ?? null,
      waId: input.waId,
      inboundMessageId,
      currentTime: input.currentTime,
      fallbackClass,
      message,
      humanOwnerActive: false,
      aiBlocked: false,
      caseStatus: resultingState?.status ?? null
    });

    const disposition = baseDisposition({
      terminalOutcome: dispatched.outboxWritten ? "fallback_outbox_planned" : "continuity_failed",
      responseOwner: isSafetyFallback ? "human" : dispatched.outboxWritten ? "ai" : "none",
      acknowledgementSender: isSafetyFallback && dispatched.outboxWritten ? "ai" : null,
      waitingFor: isSafetyFallback ? "human_response" : "none",
      handoffCreated: isSafetyFallback,
      commercialObjective: mapCommercialObjective(nextActionType, catalogExecuted),
      responsePlanned: dispatched.outboxWritten,
      opportunityAdvanced,
      nextBestActionDefined,
      fallbackUsed: dispatched.attempted,
      followUpEligible,
      followUpReason
    });

    /**
     * ACS-R1-05-T06.2 (second correction, section 14): "duplicate_ignored"
     * means a concurrent execution already legitimately owns this exact
     * fallback's idempotency key (persistAgentAction.ts's ER_DUP_ENTRY
     * recovery, or a prior terminal row) - that sibling call already wrote,
     * or will write, its own disposition. If ITS outbox write had not yet
     * landed at the exact instant we re-selected its row, that is a timing
     * artifact of this call losing the race, never a real continuity
     * failure - persisting `autonomous_turn_continuity_failed` here would
     * be spurious for a turn that its sibling is actively completing.
     */
    const lostRaceToConcurrentSibling = dispatched.actionPersistence?.status === "duplicate_ignored";

    if (dispatched.outboxWritten) {
      await persistDisposition({
        inboundMessageId,
        correlationId: input.correlationId,
        conversationId: input.conversationId,
        opportunityId,
        disposition,
        primaryActionId: bridge?.action?.actionId ?? null,
        primaryDisposition: bridge?.status ?? null,
        primaryBlockReasons: originalBlockReasons,
        fallbackActionId: dispatched.action?.actionId ?? null,
        outboxId: dispatched.outboxId === null ? null : String(dispatched.outboxId)
      });
    } else if (!lostRaceToConcurrentSibling) {
      await persistContinuityFailed({
        inboundMessageId,
        correlationId: input.correlationId,
        conversationId: input.conversationId,
        reason: `fallback_dispatch_failed:${fallbackClass}:${dispatched.warnings.join(",")}`
      });
    }
    return { cycle, disposition };
  }

  // Either a customer-facing response was successfully planned, or the
  // turn's own decision legitimately needed no immediate outbound message
  // (e.g. schedule_followup, pause, prepare_quote) - the commercial decision
  // itself is this turn's response.
  const terminalOutcome = responsePlanned
    ? nextActionType === "ask_clarifying_question"
      ? "clarification_planned"
      : catalogExecuted
        ? "catalog_recommendation_planned"
        : nextActionType === "prepare_quote"
          ? "quote_progression_planned"
          : "commercial_response_planned"
    : nextBestActionDefined
      ? "commercial_response_planned"
      : "no_response_required";

  const disposition = baseDisposition({
    terminalOutcome,
    responseOwner: "ai",
    commercialObjective: mapCommercialObjective(nextActionType, catalogExecuted),
    responsePlanned,
    opportunityAdvanced,
    nextBestActionDefined,
    followUpEligible,
    followUpReason
  });

  await persistDisposition({
    inboundMessageId,
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    opportunityId,
    disposition,
    primaryActionId: bridge?.action?.actionId ?? null,
    primaryDisposition: bridge?.status ?? null,
    primaryBlockReasons: [],
    fallbackActionId: null,
    outboxId: bridge?.executionGate?.repositoryResult.outboxRowId != null ? String(bridge.executionGate.repositoryResult.outboxRowId) : null
  });

  return { cycle, disposition };
}

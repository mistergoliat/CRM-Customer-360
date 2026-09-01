// SALES-AGENT-R3-V1.6. The single R3-native terminal dispatch boundary for
// SalesAgentRuntime - the one dispatch call site runSalesAgentRuntimeCycle.ts
// now uses for EVERY terminalReason, replacing the two-branch call site
// (R3-native for "responded", the old R1 response dispatcher for everything
// else) V1.5 left behind. Routes deterministically by loop.terminalReason:
//
//   responded                                    -> dispatchSalesAgentResponse (V1.5, unchanged)
//   handoff, eligible (see dispatchSalesAgentHardHandoff.ts)  -> dispatchSalesAgentHardHandoff
//   handoff, ambiguous/non-eligible               -> dispatchSalesAgentFallback
//   timeout / provider_unavailable / invalid_output / max_steps_exceeded -> dispatchSalesAgentFallback
//
// None of these branches touch crm_agent_actions/autonomy-sandbox/execution-
// gate or the old R1 response dispatcher - see
// docs/releases/SALES-AGENT-R3-V1.6-native-terminal-dispatch.md for the full
// architecture writeup and the false-dependency-removal proof.

import type { AgentLoopResult } from "../agent-loop/agentStepTypes";
import type { ContinuityFallbackContext } from "../continuity/buildContinuityFallbackMessage";
import { dispatchSalesAgentResponse } from "./dispatchSalesAgentResponse";
import { dispatchSalesAgentFallback, type SalesAgentFallbackTerminalReason } from "./dispatchSalesAgentFallback";
import { dispatchSalesAgentHardHandoff } from "./dispatchSalesAgentHardHandoff";
import { recordSalesAgentRuntimeTerminalDispatchedEvent } from "../events/service";
import type { SalesAgentRuntimeTerminalDispatchKind, SalesAgentRuntimeTerminalDispatchReason } from "../events/types";

export const SALES_AGENT_TERMINAL_DISPATCHER_VERSION = "sales-agent-r3-terminal-dispatch.v1";

export type DispatchSalesAgentTerminalOutcomeInput = {
  conversationId: number;
  conversationCaseId: number | string | null;
  opportunityId: number | string | null;
  waId: string;
  inboundMessageId: string;
  correlationId?: string | null;
  currentTime: string;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  loop: AgentLoopResult;
  commercialNeed: ContinuityFallbackContext;
};

export type DispatchSalesAgentTerminalOutcomeResult = {
  attempted: boolean;
  dispatchKind: SalesAgentRuntimeTerminalDispatchKind;
  outboxWritten: boolean;
  outboxId: number | null;
  duplicate: boolean;
  status: "dispatched" | "skipped" | "failed";
  reason: SalesAgentRuntimeTerminalDispatchReason;
  ownershipTransferred: boolean;
  messageSent: string | null;
  warnings: string[];
};

async function emitObservabilityEvent(input: DispatchSalesAgentTerminalOutcomeInput, outcome: DispatchSalesAgentTerminalOutcomeResult): Promise<void> {
  try {
    await recordSalesAgentRuntimeTerminalDispatchedEvent({
      inboundMessageId: input.inboundMessageId,
      terminalReason: input.loop.terminalReason,
      dispatchKind: outcome.dispatchKind,
      outboxWritten: outcome.outboxWritten,
      outboxId: outcome.outboxId,
      duplicate: outcome.duplicate,
      reason: outcome.reason,
      dispatcherVersion: SALES_AGENT_TERMINAL_DISPATCHER_VERSION,
      ownershipTransferred: outcome.ownershipTransferred,
      correlationId: input.correlationId ?? null,
      conversationId: input.conversationId,
      opportunityId: input.opportunityId
    });
  } catch {
    // Observability must never break the turn.
  }
}

/**
 * R3-native terminal dispatch for a completed SalesAgentRuntime turn. Never
 * throws for a governed skip or a real persistence failure - callers branch
 * on `status`/`reason`, never on a caught exception.
 */
export async function dispatchSalesAgentTerminalOutcome(input: DispatchSalesAgentTerminalOutcomeInput): Promise<DispatchSalesAgentTerminalOutcomeResult> {
  const common = {
    conversationId: input.conversationId,
    conversationCaseId: input.conversationCaseId,
    opportunityId: input.opportunityId,
    waId: input.waId,
    inboundMessageId: input.inboundMessageId,
    correlationId: input.correlationId,
    currentTime: input.currentTime,
    humanOwnerActive: input.humanOwnerActive,
    aiBlocked: input.aiBlocked
  };

  let outcome: DispatchSalesAgentTerminalOutcomeResult;

  if (input.loop.terminalReason === "responded") {
    const r = await dispatchSalesAgentResponse({ ...common, finalMessage: input.loop.finalMessage });
    outcome = {
      attempted: r.attempted,
      dispatchKind: "responded",
      outboxWritten: r.outboxWritten,
      outboxId: r.outboxId,
      duplicate: r.duplicate,
      status: r.status,
      reason: r.reason,
      ownershipTransferred: false,
      messageSent: r.status === "dispatched" ? input.loop.finalMessage : null,
      warnings: r.warnings
    };
  } else if (input.loop.terminalReason === "handoff") {
    const hh = await dispatchSalesAgentHardHandoff({ ...common, handoffReason: input.loop.handoffReason, commercialNeed: input.commercialNeed });
    if (hh.eligible) {
      outcome = {
        attempted: hh.attempted,
        dispatchKind: "hard_handoff",
        outboxWritten: hh.outboxWritten,
        outboxId: hh.outboxId,
        duplicate: hh.duplicate,
        status: hh.status,
        reason: hh.reason,
        ownershipTransferred: hh.ownershipTransferred,
        messageSent: hh.messageSent,
        warnings: hh.warnings
      };
    } else {
      // Ambiguous/non-eligible handoff: deterministic fallback, ownership
      // stays with the AI. `reason` deliberately surfaces the eligibility
      // classification (per this task's own event contract), never the
      // fallback dispatch's own dispatched/duplicate/skip reason - that one
      // is preserved in `warnings` for full traceability.
      const fb = await dispatchSalesAgentFallback({ ...common, terminalReason: "handoff" as SalesAgentFallbackTerminalReason, commercialNeed: input.commercialNeed });
      outcome = {
        attempted: fb.attempted,
        dispatchKind: "fallback",
        outboxWritten: fb.outboxWritten,
        outboxId: fb.outboxId,
        duplicate: fb.duplicate,
        status: fb.status,
        reason: hh.reason,
        ownershipTransferred: false,
        messageSent: fb.messageSent,
        warnings: [...fb.warnings, `fallback_dispatch_reason:${fb.reason}`]
      };
    }
  } else {
    const fb = await dispatchSalesAgentFallback({ ...common, terminalReason: input.loop.terminalReason, commercialNeed: input.commercialNeed });
    outcome = {
      attempted: fb.attempted,
      dispatchKind: "fallback",
      outboxWritten: fb.outboxWritten,
      outboxId: fb.outboxId,
      duplicate: fb.duplicate,
      status: fb.status,
      reason: fb.reason,
      ownershipTransferred: false,
      messageSent: fb.messageSent,
      warnings: fb.warnings
    };
  }

  await emitObservabilityEvent(input, outcome);
  return outcome;
}

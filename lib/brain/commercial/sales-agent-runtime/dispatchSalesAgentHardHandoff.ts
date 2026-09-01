// SALES-AGENT-R3-V1.6. R3-native HARD_HANDOFF dispatch: an actual, durable
// transfer of conversation ownership from AI to human. Reserved only for:
//   1. an explicit customer request for a human/operator, or
//   2. a deterministic policy requirement that mandates human intervention.
// Temporary inability, uncertainty, tool failure, model failure, timeout, or
// missing capability MUST NOT automatically become a handoff - that is
// dispatchSalesAgentFallback.ts's job (AI stays the owner, gets another
// turn). Invariant: temporary agent incapacity does not imply ownership
// transfer.
//
// Eligibility evidence gap (documented, not guessed around): AgentStepHandoff
// (agent-loop/agentStepTypes.ts) carries only a free-text `reason` the model
// writes itself - validateAgentStep.ts accepts any non-empty string, and the
// prompt (buildAgentStepPromptPackage.ts) only ever says "hand off to a human
// if you genuinely cannot proceed", which is exactly the SELF_RECOVERY-shaped
// language this task warns against conflating with HARD_HANDOFF. There is no
// structured signal today distinguishing "the customer explicitly asked for a
// human" from ordinary model uncertainty. Per this task's own instruction not
// to guess at that distinction from natural-language free text, and to fail
// safe toward NON-HANDOFF for ambiguous reasons, classifyHardHandoffEligibility
// below treats only an exact/prefixed match against a minimal, explicit
// reason-code vocabulary as eligible. Every real free-text sentence the model
// currently produces is therefore "ambiguous_handoff_reason" and safely falls
// back - closing this gap for real production traffic requires extending
// ATL's own AgentStepHandoff/prompt contract with structured evidence, which
// is ATL behavior and explicitly out of scope for V1.6 (Scope Guard).
//
// Ownership mutation reuses takeHumanControlForAiHandoff verbatim (the same
// neutral domain-level primitive an operator's manual "take" action and the
// R1 response dispatcher's own handoff path already use) - never rewritten
// here. Critical ordering: that mutation COMMITS before this file ever
// attempts to queue the acknowledgement (never the reverse).
//
// See docs/releases/SALES-AGENT-R3-V1.6-native-terminal-dispatch.md.

import type { PoolConnection } from "mysql2/promise";
import { withTransaction } from "@/lib/db";
import { isConversationClosedStatus, takeHumanControlForAiHandoff } from "@/lib/domains/conversations/control";
import { writeCanonicalOutboxMessage } from "../../messaging/canonicalOutboxWriter";
import { normalizeWaIdDigits } from "../autonomy-sandbox";
import { isWaIdAuthorizedForPilot, loadAutonomousPilotAllowlist, loadAutonomousResponsesEnabled } from "../../runtime/autonomousRuntimeConfig";
import { buildContinuityFallbackMessage, type ContinuityFallbackContext } from "../continuity/buildContinuityFallbackMessage";
import type { SalesAgentRuntimeTerminalDispatchReason } from "../events/types";

export const SALES_AGENT_HARD_HANDOFF_DISPATCHER_VERSION = "sales-agent-r3-hard-handoff-dispatch.v1";

/**
 * The only two HARD_HANDOFF-eligible categories per this task's architecture
 * decision. Matched verbatim (or as a "<code>:<free text>" prefix) against
 * AgentLoopResult.handoffReason - see this file's own header comment for why
 * this is a minimal typed contract rather than free-text inference.
 */
export const HARD_HANDOFF_ELIGIBLE_REASON_CODES = ["customer_requested_human", "policy_requires_human"] as const;
export type HardHandoffEligibleReasonCode = (typeof HARD_HANDOFF_ELIGIBLE_REASON_CODES)[number];

export type HardHandoffEligibility =
  | { eligible: true; reasonCode: HardHandoffEligibleReasonCode }
  | { eligible: false; reason: "hard_handoff_not_eligible" | "ambiguous_handoff_reason" };

export function classifyHardHandoffEligibility(handoffReason: string | null): HardHandoffEligibility {
  const normalized = (handoffReason ?? "").trim().toLowerCase();
  if (!normalized) return { eligible: false, reason: "hard_handoff_not_eligible" };
  const match = HARD_HANDOFF_ELIGIBLE_REASON_CODES.find((code) => normalized === code || normalized.startsWith(`${code}:`));
  return match ? { eligible: true, reasonCode: match } : { eligible: false, reason: "ambiguous_handoff_reason" };
}

export type DispatchSalesAgentHardHandoffInput = {
  conversationId: number;
  conversationCaseId: number | string | null;
  opportunityId: number | string | null;
  waId: string;
  inboundMessageId: string;
  correlationId?: string | null;
  currentTime: string;
  handoffReason: string | null;
  commercialNeed: ContinuityFallbackContext;
};

export type DispatchSalesAgentHardHandoffResult =
  | {
      eligible: false;
      ownershipTransferred: false;
      attempted: false;
      outboxWritten: false;
      outboxId: null;
      duplicate: false;
      status: "not_eligible";
      reason: "hard_handoff_not_eligible" | "ambiguous_handoff_reason";
      messageSent: null;
      warnings: string[];
    }
  | {
      eligible: true;
      ownershipTransferred: boolean;
      attempted: boolean;
      outboxWritten: boolean;
      outboxId: number | null;
      duplicate: boolean;
      status: "dispatched" | "skipped" | "failed";
      reason: SalesAgentRuntimeTerminalDispatchReason;
      messageSent: string | null;
      warnings: string[];
    };

function toBool(value: unknown): boolean {
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized !== "" && normalized !== "0" && normalized !== "false";
  }
  return Boolean(value);
}

type PreTransferGuard = { ok: true } | { ok: false; reason: "conversation_not_found" | "conversation_closed" };

/** Never transfer ownership onto a conversation that no longer exists or is already closed - same case_closed governance dispatchGovernedSalesAgentMessage.ts enforces for outbound messages. */
async function checkConversationTransferable(connection: PoolConnection, conversationId: number): Promise<PreTransferGuard> {
  const [rows] = await connection.execute("SELECT status FROM conversation WHERE id = ? LIMIT 1", [conversationId]);
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return { ok: false, reason: "conversation_not_found" };
  if (isConversationClosedStatus(row.status as string | null | undefined)) return { ok: false, reason: "conversation_closed" };
  return { ok: true };
}

/**
 * Narrowly scoped acknowledgement writer for exactly one already-eligible,
 * already-committed hard handoff - deliberately NOT dispatchGovernedSalesAgentMessage.ts,
 * whose generic "human_owner_active blocks AI outbound" check would always
 * (incorrectly) block this specific message, since ownership was just
 * transferred to that same human by this same operation. Still preserves the
 * kill switch, pilot allowlist, waId validity, non-empty message, case_closed
 * governance and DB-backed dedupe - only the ownership polarity differs
 * (requires human-owned, not AI-owned), and only for this one dedupe key.
 */
async function writeHardHandoffAcknowledgement(input: {
  conversationId: number;
  conversationCaseId: number | string | null;
  opportunityId: number | string | null;
  waId: string;
  inboundMessageId: string;
  currentTime: string;
  message: string;
}): Promise<Extract<DispatchSalesAgentHardHandoffResult, { eligible: true }>> {
  const eligibleBase = { eligible: true as const };

  if (!loadAutonomousResponsesEnabled()) {
    return { ...eligibleBase, ownershipTransferred: true, attempted: false, outboxWritten: false, outboxId: null, duplicate: false, status: "skipped", reason: "autonomous_responses_disabled", messageSent: null, warnings: ["autonomous_responses_disabled"] };
  }
  if (!isWaIdAuthorizedForPilot(input.waId, loadAutonomousPilotAllowlist())) {
    return { ...eligibleBase, ownershipTransferred: true, attempted: false, outboxWritten: false, outboxId: null, duplicate: false, status: "skipped", reason: "wa_not_allowlisted", messageSent: null, warnings: ["wa_not_allowlisted"] };
  }
  const recipient = normalizeWaIdDigits(input.waId);
  if (!recipient) {
    return { ...eligibleBase, ownershipTransferred: true, attempted: false, outboxWritten: false, outboxId: null, duplicate: false, status: "skipped", reason: "invalid_wa_id", messageSent: null, warnings: ["invalid_wa_id"] };
  }

  const dedupeKey = `sales-agent-r3:${input.conversationId}:${input.inboundMessageId}:handoff`;

  try {
    return await withTransaction(async (connection) => {
      const [rows] = await connection.execute(
        "SELECT status, ai_enabled, human_owner_active FROM conversation WHERE id = ? LIMIT 1 FOR UPDATE",
        [input.conversationId]
      );
      const row = (rows as Record<string, unknown>[])[0];
      if (!row) {
        return { ...eligibleBase, ownershipTransferred: true, attempted: false, outboxWritten: false, outboxId: null, duplicate: false, status: "skipped" as const, reason: "conversation_not_found" as const, messageSent: null, warnings: ["conversation_not_found"] };
      }
      if (isConversationClosedStatus(row.status as string | null | undefined)) {
        return { ...eligibleBase, ownershipTransferred: true, attempted: false, outboxWritten: false, outboxId: null, duplicate: false, status: "skipped" as const, reason: "conversation_closed" as const, messageSent: null, warnings: ["conversation_closed"] };
      }
      if (!toBool(row.human_owner_active) || toBool(row.ai_enabled)) {
        // Defensive only - the transfer this same call just committed should
        // already be visible here. The one way this can trip is a concurrent
        // "release" landing between that commit and this recheck; never send
        // a "connecting you with a human" message once the AI is back in
        // control.
        return {
          ...eligibleBase,
          ownershipTransferred: true,
          attempted: false,
          outboxWritten: false,
          outboxId: null,
          duplicate: false,
          status: "skipped" as const,
          reason: "ownership_transfer_lost_before_acknowledgement" as const,
          messageSent: null,
          warnings: ["ownership_transfer_lost_before_acknowledgement"]
        };
      }

      const write = await writeCanonicalOutboxMessage(
        {
          dedupeKey,
          status: "planned",
          source: "sales-agent-r3",
          sourceRequestId: input.inboundMessageId,
          sourceAgentName: "sales-agent-r3-native-hard-handoff-dispatcher",
          sourceAgentVersion: SALES_AGENT_HARD_HANDOFF_DISPATCHER_VERSION,
          waId: recipient,
          phoneNumberId: null,
          conversationCaseId: input.conversationCaseId,
          messageText: input.message,
          metaPayloadJson: {
            inboundMessageId: input.inboundMessageId,
            conversationId: input.conversationId,
            terminalReason: "handoff",
            dispatcherVersion: SALES_AGENT_HARD_HANDOFF_DISPATCHER_VERSION
          },
          providerMessageId: null,
          errorCode: null,
          errorMessage: null,
          opportunityId: input.opportunityId,
          plannedAt: input.currentTime
        },
        connection
      );

      return {
        ...eligibleBase,
        ownershipTransferred: true,
        attempted: true,
        outboxWritten: true,
        outboxId: write.rowId,
        duplicate: write.duplicate,
        status: "dispatched" as const,
        reason: (write.duplicate ? "duplicate" : "dispatched") as SalesAgentRuntimeTerminalDispatchReason,
        messageSent: input.message,
        warnings: write.duplicate ? ["sales_agent_r3_hard_handoff_dispatch_duplicate"] : []
      };
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "unknown";
    return {
      ...eligibleBase,
      ownershipTransferred: true,
      attempted: true,
      outboxWritten: false,
      outboxId: null,
      duplicate: false,
      status: "failed",
      reason: "persistence_error",
      messageSent: null,
      warnings: [`sales_agent_r3_hard_handoff_dispatch_persistence_failed:${messageText}`]
    };
  }
}

/**
 * R3-native HARD_HANDOFF dispatcher. Validates eligibility itself (defensive
 * - never trusts a caller's own pre-classification), then, only if eligible:
 * durably transfers ownership (commits) before ever attempting the
 * acknowledgement. Never throws - callers branch on `eligible`/`status`/`reason`.
 */
export async function dispatchSalesAgentHardHandoff(input: DispatchSalesAgentHardHandoffInput): Promise<DispatchSalesAgentHardHandoffResult> {
  const eligibility = classifyHardHandoffEligibility(input.handoffReason);
  if (!eligibility.eligible) {
    return {
      eligible: false,
      ownershipTransferred: false,
      attempted: false,
      outboxWritten: false,
      outboxId: null,
      duplicate: false,
      status: "not_eligible",
      reason: eligibility.reason,
      messageSent: null,
      warnings: [eligibility.reason]
    };
  }

  const guard = await withTransaction((connection) => checkConversationTransferable(connection, input.conversationId));
  if (!guard.ok) {
    return {
      eligible: true,
      ownershipTransferred: false,
      attempted: false,
      outboxWritten: false,
      outboxId: null,
      duplicate: false,
      status: "skipped",
      reason: guard.reason,
      messageSent: null,
      warnings: [guard.reason]
    };
  }

  try {
    await takeHumanControlForAiHandoff({
      conversationId: input.conversationId,
      currentTime: input.currentTime,
      reason: `sales-agent-r3:hard_handoff:${eligibility.reasonCode}`
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "unknown";
    return {
      eligible: true,
      ownershipTransferred: false,
      attempted: false,
      outboxWritten: false,
      outboxId: null,
      duplicate: false,
      status: "failed",
      reason: "persistence_error",
      messageSent: null,
      warnings: [`sales_agent_r3_hard_handoff_ownership_transfer_failed:${messageText}`]
    };
  }

  const message = buildContinuityFallbackMessage("handoff_acknowledgement", input.commercialNeed);
  return writeHardHandoffAcknowledgement({
    conversationId: input.conversationId,
    conversationCaseId: input.conversationCaseId,
    opportunityId: input.opportunityId,
    waId: input.waId,
    inboundMessageId: input.inboundMessageId,
    currentTime: input.currentTime,
    message
  });
}

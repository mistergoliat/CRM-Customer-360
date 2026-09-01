// SALES-AGENT-R3-V1.6. The shared R3-native primitive every terminal
// dispatcher (dispatchSalesAgentResponse.ts, dispatchSalesAgentFallback.ts)
// reuses instead of re-implementing: governed outbound message -> ownership
// recheck -> dedupe -> canonical brain_message_outbox. Extracted verbatim
// from dispatchSalesAgentResponse.ts (SALES-AGENT-R3-V1.5) - same governance
// chain, same transactional recheck, same dedupe/outbox contract, zero
// behavior change for that caller. Deliberately independent of the R1
// dispatch stack (crm_agent_actions/autonomy-sandbox/execution-gate) - see
// docs/releases/SALES-AGENT-R3-V1.5-native-response-dispatch.md.
//
// Not used by dispatchSalesAgentHardHandoff.ts's own acknowledgement write:
// that message is sent to a conversation this same operation just made
// human-owned, so the generic "human_owner_active blocks AI outbound" check
// below would always (incorrectly) block it - see that file's own narrowly
// scoped ack writer instead.

import type { PoolConnection } from "mysql2/promise";
import { withTransaction } from "@/lib/db";
import { isConversationClosedStatus } from "@/lib/domains/conversations/control";
import { writeCanonicalOutboxMessage } from "../../messaging/canonicalOutboxWriter";
import { normalizeWaIdDigits } from "../autonomy-sandbox";
import { isWaIdAuthorizedForPilot, loadAutonomousPilotAllowlist, loadAutonomousResponsesEnabled } from "../../runtime/autonomousRuntimeConfig";
import type { SalesAgentRuntimeResponseDispatchReason } from "../events/types";

export type DispatchGovernedSalesAgentMessageReason = SalesAgentRuntimeResponseDispatchReason;

export type DispatchGovernedSalesAgentMessageInput = {
  conversationId: number;
  conversationCaseId: number | string | null;
  opportunityId: number | string | null;
  waId: string;
  /** Candidate outbound text - null/blank resolves to the "empty_message" skip. */
  message: string | null;
  /** Appended after `sales-agent-r3:{conversationId}:{inboundMessageId}:` to form the dedupe key - e.g. "responded", "fallback:timeout", "handoff". */
  dedupeSuffix: string;
  sourceAgentName: string;
  sourceAgentVersion: string;
  /** Merged into meta_payload_json alongside the always-present inboundMessageId/conversationId/dispatcherVersion fields. */
  metaPayloadExtra?: Record<string, unknown>;
  inboundMessageId: string;
  currentTime: string;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
};

export type DispatchGovernedSalesAgentMessageResult = {
  attempted: boolean;
  outboxWritten: boolean;
  outboxId: number | null;
  duplicate: boolean;
  status: "dispatched" | "skipped" | "failed";
  reason: DispatchGovernedSalesAgentMessageReason;
  messageSent: string | null;
  warnings: string[];
};

export function buildSalesAgentR3DedupeKey(conversationId: number, inboundMessageId: string, suffix: string): string {
  return `sales-agent-r3:${conversationId}:${inboundMessageId}:${suffix}`;
}

function skipped(reason: DispatchGovernedSalesAgentMessageReason): DispatchGovernedSalesAgentMessageResult {
  return { attempted: false, outboxWritten: false, outboxId: null, duplicate: false, status: "skipped", reason, messageSent: null, warnings: [reason] };
}

function toBool(value: unknown): boolean {
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized !== "" && normalized !== "0" && normalized !== "false";
  }
  return Boolean(value);
}

type OwnershipRecheck = { ok: true } | { ok: false; reason: "human_owner_active" | "ai_blocked" | "conversation_closed" | "conversation_not_found" };

/**
 * Transactional recheck (SELECT ... FOR UPDATE on the conversation row,
 * inside the same transaction as the outbox insert below) - closes the race
 * the turn-start humanOwnerActive/aiBlocked snapshot cannot: an operator
 * taking control, or pausing the AI, while SalesAgentRuntime was reasoning
 * must never let a stale response reach the outbox. See
 * dispatchSalesAgentResponse.ts's original comment (SALES-AGENT-R3-V1.5,
 * proven by tests [D9]/[D9b]) for the full rationale - unchanged here.
 */
async function recheckConversationOwnership(connection: PoolConnection, conversationId: number): Promise<OwnershipRecheck> {
  const [rows] = await connection.execute(
    "SELECT status, ai_enabled, human_owner_active FROM conversation WHERE id = ? LIMIT 1 FOR UPDATE",
    [conversationId]
  );
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return { ok: false, reason: "conversation_not_found" };
  if (toBool(row.human_owner_active)) return { ok: false, reason: "human_owner_active" };
  if (!toBool(row.ai_enabled)) return { ok: false, reason: "ai_blocked" };
  if (isConversationClosedStatus(row.status as string | null | undefined)) return { ok: false, reason: "conversation_closed" };
  return { ok: true };
}

/**
 * R3-native governed dispatch of one outbound message. Never throws for a
 * governed skip or a real persistence failure - callers branch on
 * `status`/`reason`, never on a caught exception.
 */
export async function dispatchGovernedSalesAgentMessage(input: DispatchGovernedSalesAgentMessageInput): Promise<DispatchGovernedSalesAgentMessageResult> {
  const message = input.message?.trim() || null;
  if (!message) return skipped("empty_message");
  if (input.humanOwnerActive) return skipped("human_owner_active");
  if (input.aiBlocked) return skipped("ai_blocked");
  if (!loadAutonomousResponsesEnabled()) return skipped("autonomous_responses_disabled");
  if (!isWaIdAuthorizedForPilot(input.waId, loadAutonomousPilotAllowlist())) return skipped("wa_not_allowlisted");

  const recipient = normalizeWaIdDigits(input.waId);
  if (!recipient) return skipped("invalid_wa_id");

  const dedupeKey = buildSalesAgentR3DedupeKey(input.conversationId, input.inboundMessageId, input.dedupeSuffix);

  try {
    return await withTransaction(async (connection) => {
      const ownership = await recheckConversationOwnership(connection, input.conversationId);
      if (!ownership.ok) return skipped(ownership.reason);

      const write = await writeCanonicalOutboxMessage(
        {
          dedupeKey,
          status: "planned",
          source: "sales-agent-r3",
          sourceRequestId: input.inboundMessageId,
          sourceAgentName: input.sourceAgentName,
          sourceAgentVersion: input.sourceAgentVersion,
          waId: recipient,
          phoneNumberId: null,
          conversationCaseId: input.conversationCaseId,
          messageText: message,
          metaPayloadJson: {
            inboundMessageId: input.inboundMessageId,
            conversationId: input.conversationId,
            dispatcherVersion: input.sourceAgentVersion,
            ...(input.metaPayloadExtra ?? {})
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
        attempted: true,
        outboxWritten: true,
        outboxId: write.rowId,
        duplicate: write.duplicate,
        status: "dispatched" as const,
        reason: (write.duplicate ? "duplicate" : "dispatched") as DispatchGovernedSalesAgentMessageReason,
        messageSent: message,
        warnings: write.duplicate ? ["sales_agent_r3_dispatch_duplicate"] : []
      };
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "unknown";
    return {
      attempted: true,
      outboxWritten: false,
      outboxId: null,
      duplicate: false,
      status: "failed",
      reason: "persistence_error",
      messageSent: null,
      warnings: [`sales_agent_r3_dispatch_persistence_failed:${messageText}`]
    };
  }
}

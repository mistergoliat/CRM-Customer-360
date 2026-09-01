// SALES-AGENT-R3-V1.5. R3-native response dispatch for terminalReason
// "responded" - deliberately independent of the R1 dispatch stack
// (crm_agent_actions / autonomy-sandbox / execution-gate). A final
// conversational response is not a commercial mutation: reasoning stays
// flexible (SalesAgentRuntime), this boundary's own governance is
// deterministic, and the durable state it writes is exactly one row in the
// existing canonical brain_message_outbox (lib/brain/messaging/canonicalOutboxWriter.ts)
// - the same table/writer/worker every other runtime already uses, never a
// second outbound queue. Commercial mutations (select_products, create_quote,
// ...) are untouched by this file; they continue through
// CommercialActionRequest -> Capability Gateway, unaffected by anything here.
//
// See docs/releases/SALES-AGENT-R3-V1.5-native-response-dispatch.md.

import type { PoolConnection } from "mysql2/promise";
import { withTransaction } from "@/lib/db";
import { isConversationClosedStatus } from "@/lib/domains/conversations/control";
import { writeCanonicalOutboxMessage } from "../../messaging/canonicalOutboxWriter";
import { normalizeWaIdDigits } from "../autonomy-sandbox";
import { isWaIdAuthorizedForPilot, loadAutonomousPilotAllowlist, loadAutonomousResponsesEnabled } from "../../runtime/autonomousRuntimeConfig";
import { recordSalesAgentRuntimeResponseDispatchedEvent } from "../events/service";
import type { SalesAgentRuntimeResponseDispatchReason } from "../events/types";

export const SALES_AGENT_RESPONSE_DISPATCHER_VERSION = "sales-agent-r3-dispatch.v1";

export type DispatchSalesAgentResponseInput = {
  conversationId: number;
  conversationCaseId: number | string | null;
  opportunityId: number | string | null;
  waId: string;
  inboundMessageId: string;
  correlationId?: string | null;
  currentTime: string;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  finalMessage: string | null;
};

export type DispatchSalesAgentResponseReason = SalesAgentRuntimeResponseDispatchReason;

export type DispatchSalesAgentResponseResult = {
  attempted: boolean;
  outboxWritten: boolean;
  outboxId: number | null;
  duplicate: boolean;
  status: "dispatched" | "skipped" | "failed";
  reason: DispatchSalesAgentResponseReason;
  warnings: string[];
};

function buildDedupeKey(conversationId: number, inboundMessageId: string): string {
  return `sales-agent-r3:${conversationId}:${inboundMessageId}:responded`;
}

function skipped(reason: DispatchSalesAgentResponseReason): DispatchSalesAgentResponseResult {
  return { attempted: false, outboxWritten: false, outboxId: null, duplicate: false, status: "skipped", reason, warnings: [reason] };
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
 * must never let a stale response reach the outbox. Rechecking only
 * `conversation` (not crm_opportunities) is sufficient - takeHumanControlTx
 * and applyConversationControl (lib/domains/conversations/control.ts) always
 * flip conversation.human_owner_active/ai_enabled in the same transaction as
 * any crm_opportunities-level mirror, so a fresh read of this one row already
 * reflects both. `case_closed` is folded in here too (same column, same
 * query, zero extra cost) to preserve execution-gate's existing "never send
 * into a closed case" governance, which is not itself part of the human/AI
 * ownership race but is otherwise lost when bypassing execution-gate.
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

async function emitObservabilityEvent(input: DispatchSalesAgentResponseInput, result: DispatchSalesAgentResponseResult): Promise<void> {
  try {
    await recordSalesAgentRuntimeResponseDispatchedEvent({
      inboundMessageId: input.inboundMessageId,
      outboxWritten: result.outboxWritten,
      outboxId: result.outboxId,
      duplicate: result.duplicate,
      reason: result.reason,
      dispatcherVersion: SALES_AGENT_RESPONSE_DISPATCHER_VERSION,
      correlationId: input.correlationId ?? null,
      conversationId: input.conversationId,
      opportunityId: input.opportunityId
    });
  } catch {
    // Observability must never break the turn - the customer already has
    // (or was correctly denied) their response regardless of this write.
  }
}

/**
 * R3-native dispatch for a SalesAgentRuntime "responded" turn. Deliberately
 * bypasses crm_agent_actions/autonomy-sandbox/execution-gate entirely -
 * those exist to govern R1's action-lifecycle (propose/approve/execute a
 * commercial mutation), which a conversational reply is not. Writes at most
 * one row to the existing brain_message_outbox (via the same canonical
 * writer/dedupe-key/worker every other runtime uses) and never throws for a
 * governed skip or a real persistence failure - callers branch on
 * `status`/`reason`, never on a caught exception.
 */
export async function dispatchSalesAgentResponse(input: DispatchSalesAgentResponseInput): Promise<DispatchSalesAgentResponseResult> {
  const message = input.finalMessage?.trim() || null;
  let result: DispatchSalesAgentResponseResult;

  if (!message) {
    result = skipped("empty_message");
  } else if (input.humanOwnerActive) {
    result = skipped("human_owner_active");
  } else if (input.aiBlocked) {
    result = skipped("ai_blocked");
  } else if (!loadAutonomousResponsesEnabled()) {
    result = skipped("autonomous_responses_disabled");
  } else if (!isWaIdAuthorizedForPilot(input.waId, loadAutonomousPilotAllowlist())) {
    result = skipped("wa_not_allowlisted");
  } else {
    const recipient = normalizeWaIdDigits(input.waId);
    if (!recipient) {
      result = skipped("invalid_wa_id");
    } else {
      const dedupeKey = buildDedupeKey(input.conversationId, input.inboundMessageId);
      try {
        result = await withTransaction(async (connection) => {
          const ownership = await recheckConversationOwnership(connection, input.conversationId);
          if (!ownership.ok) return skipped(ownership.reason);

          const write = await writeCanonicalOutboxMessage(
            {
              dedupeKey,
              status: "planned",
              source: "sales-agent-r3",
              sourceRequestId: input.inboundMessageId,
              sourceAgentName: "sales-agent-r3-native-dispatcher",
              sourceAgentVersion: SALES_AGENT_RESPONSE_DISPATCHER_VERSION,
              waId: recipient,
              phoneNumberId: null,
              conversationCaseId: input.conversationCaseId,
              messageText: message,
              metaPayloadJson: {
                inboundMessageId: input.inboundMessageId,
                conversationId: input.conversationId,
                terminalReason: "responded",
                dispatcherVersion: SALES_AGENT_RESPONSE_DISPATCHER_VERSION
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
            reason: (write.duplicate ? "duplicate" : "dispatched") as DispatchSalesAgentResponseReason,
            warnings: write.duplicate ? ["sales_agent_r3_dispatch_duplicate"] : []
          };
        });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "unknown";
        result = {
          attempted: true,
          outboxWritten: false,
          outboxId: null,
          duplicate: false,
          status: "failed",
          reason: "persistence_error",
          warnings: [`sales_agent_r3_dispatch_persistence_failed:${messageText}`]
        };
      }
    }
  }

  await emitObservabilityEvent(input, result);
  return result;
}

import { queryRows } from "@/lib/db";
import type { CommercialEventType } from "../../../events/types";

/**
 * SALES-AGENT-R3-P7.4. Thin, IO-only reader: fetches exactly the
 * commercial_event rows this turn produced, by the canonical id every event
 * this cycle already writes (source_event_id = inboundMessageId - see
 * events/normalize.ts, unchanged by this task). Never infers by timestamp or
 * "most recent row" - every row returned genuinely belongs to this turn by
 * construction. All parsing/interpretation lives in buildTurnTrace.ts (pure,
 * DB-free); this module does nothing but SQL + JSON.parse.
 */
export type CommercialEventRow = {
  eventType: CommercialEventType;
  payload: Record<string, unknown>;
};

/**
 * agent_tool_loop_completed is deliberately excluded: terminalReason/
 * toolExecutionCount/toolsUsed already arrive from runSalesAgentRuntimeCycle's
 * own return value (priority #1 per "DATA SOURCE PRIORITY" - never
 * re-derived from an event this harness has a cheaper, more direct source
 * for).
 */
const TURN_EVENT_TYPES: readonly CommercialEventType[] = [
  "commercial_work_kernel_resolved",
  "commercial_objective_reconciliation_decided",
  "commercial_objective_reconciled",
  "commercial_capability_eligibility_evaluated",
  "commercial_capability_invocation_observed",
  "commercial_proposal_shadow_built"
];

export async function loadCommercialEventRowsForInboundMessage(inboundMessageId: string): Promise<CommercialEventRow[]> {
  const placeholders = TURN_EVENT_TYPES.map(() => "?").join(", ");
  const rows = await queryRows<{ event_type: string; payload_json: string; id: number }>(
    `SELECT id, event_type, payload_json FROM commercial_event WHERE source_event_id = ? AND event_type IN (${placeholders}) ORDER BY id ASC`,
    [inboundMessageId, ...TURN_EVENT_TYPES]
  );
  return rows.map((row) => ({
    eventType: row.event_type as CommercialEventType,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>
  }));
}

export type OutboxRow = {
  id: number;
  status: string;
  messageText: string | null;
} | null;

/** ID-based lookup only (brain_message_outbox.id, the primary key) - never a dedupe-key reconstruction or a "latest row" guess. */
export async function loadOutboxRowById(outboxId: number): Promise<OutboxRow> {
  const rows = await queryRows<{ id: number; status: string; message_text: string | null }>(
    "SELECT id, status, message_text FROM brain_message_outbox WHERE id = ? LIMIT 1",
    [outboxId]
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, status: row.status, messageText: row.message_text };
}

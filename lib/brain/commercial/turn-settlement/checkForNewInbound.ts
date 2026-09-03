// SALES-AGENT-R3-V1.8.1b-A (Objetivo A - live turn assimilation). Pure
// durable-truth read: no semantic interpretation, no LLM, no state mutation.
// Open-ended sibling of assembleTurnFragments.ts's closed-range query - same
// ordering discipline (conversation_message.id, never provider_timestamp),
// used by runAgentToolLoop.ts's safe-boundary assimilation checks to detect
// whether new customer input arrived while cognition was in flight.

import { safeQueryRows } from "@/lib/db";

export type NewInboundFragment = { id: number; body: string };

export type CheckForNewInboundResult = {
  fragments: NewInboundFragment[];
  latestMessageId: number | null;
};

type FragmentRow = { id: number; body: string | null };

export async function checkForNewInbound(input: { conversationId: number; afterMessageId: number }): Promise<CheckForNewInboundResult> {
  const result = await safeQueryRows<FragmentRow>(
    `SELECT id, body
       FROM conversation_message
      WHERE conversation_id = ? AND direction = 'inbound' AND id > ?
      ORDER BY id ASC`,
    [input.conversationId, input.afterMessageId]
  );

  const rows = result.ok ? result.rows : [];
  const fragments = rows.map((row) => ({ id: row.id, body: row.body ?? "" }));
  const latestMessageId = fragments.length > 0 ? fragments[fragments.length - 1].id : null;

  return { fragments, latestMessageId };
}

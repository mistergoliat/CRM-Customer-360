// SALES-AGENT-R3-V1.8.1 (Section I). Reads the canonical, already-persisted
// conversation_message rows belonging to one settled turn and builds the
// explicit turn representation R3 cognition receives. Never rewrites or
// merges conversation_message itself - the persistent transcript stays
// exactly as Meta delivered it (Section B).

import { safeQueryRows } from "@/lib/db";
import type { AssembledTurnFragments } from "./types";

type FragmentRow = {
  id: number;
  body: string | null;
  provider_message_id: string | null;
};

/**
 * Ordering is preserved by conversation_message.id (the same monotonic,
 * auto-increment ordering every other reader of this table already relies
 * on - never provider_timestamp, which is client-reported and can arrive out
 * of order). Range is inclusive on both ends: firstInboundMessageId is
 * itself a real fragment, not an exclusive lower bound.
 */
export async function assembleTurnFragments(input: {
  conversationId: number;
  firstInboundMessageId: number;
  latestInboundMessageId: number;
}): Promise<AssembledTurnFragments> {
  const result = await safeQueryRows<FragmentRow>(
    `SELECT id, body, provider_message_id
       FROM conversation_message
      WHERE conversation_id = ? AND direction = 'inbound' AND id BETWEEN ? AND ?
      ORDER BY id ASC`,
    [input.conversationId, input.firstInboundMessageId, input.latestInboundMessageId]
  );

  const rows = result.ok ? result.rows : [];
  const inboundMessageIds = rows.map((row) => row.id);
  const content = rows
    .map((row) => row.body?.trim() ?? "")
    .filter((body) => body.length > 0)
    .join("\n");
  const latestFragment = rows[rows.length - 1] ?? null;

  return {
    inboundMessageIds,
    latestInboundProviderMessageId: latestFragment?.provider_message_id ?? null,
    content
  };
}

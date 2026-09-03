// SALES-AGENT-R3-V1.8.1. Types for the durable inbound turn-settlement
// mechanism (migrations/035_crm_inbound_turn_settlements.sql). Execution
// states only - never a cognitive/business vocabulary (no intent/topic/
// nextStep here, see the migration's own header comment).

/**
 * SALES-AGENT-R3-V1.8.1b-A. "ASSIMILATED" added: a sibling row whose entire
 * inbound range was folded into a DIFFERENT row's live cognitive run (never
 * ran its own cognition, never had its content discarded/stale - see
 * migration 036's own comment for why neither COMPLETED nor SUPERSEDED is a
 * truthful reuse).
 */
export const TURN_SETTLEMENT_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "SUPERSEDED", "ASSIMILATED"] as const;
export type TurnSettlementStatus = (typeof TURN_SETTLEMENT_STATUSES)[number];

export type TurnSettlementRow = {
  id: number;
  conversation_id: number;
  wa_id: string;
  phone_number_id: string;
  first_inbound_message_id: number;
  latest_inbound_message_id: number;
  latest_inbound_provider_message_id: string | null;
  fragment_count: number;
  first_inbound_at: string;
  last_inbound_at: string;
  settle_after: string;
  max_settle_at: string;
  status: TurnSettlementStatus;
  superseded_by_message_id: number | null;
  last_correlation_id: string | null;
  created_at: string;
  updated_at: string;
};

export type UpsertPendingTurnInput = {
  conversationId: number;
  waId: string;
  phoneNumberId: string;
  inboundMessageId: number;
  providerMessageId: string | null;
  correlationId: string;
  settleDelayMs: number;
  maxSettleMs: number;
};

export type UpsertPendingTurnResult = { ok: true; created: boolean } | { ok: false; error: string };

/** One assembled turn ready for cognition - every fragment's conversation_message.id, in ascending order, and its joined text. */
export type AssembledTurnFragments = {
  inboundMessageIds: number[];
  latestInboundProviderMessageId: string | null;
  content: string;
};

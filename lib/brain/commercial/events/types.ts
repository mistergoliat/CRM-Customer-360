export const COMMERCIAL_EVENT_CONTRACT_NAME = "CommercialEvent" as const;
export const COMMERCIAL_EVENT_SCHEMA_VERSION = "1.0" as const;

export type CommercialEventType =
  | "customer_message_received"
  | "outbound_message_queued"
  | "outbound_message_sent"
  | "outbound_message_delivered"
  | "outbound_message_read"
  | "outbound_message_failed"
  | "follow_up_due"
  | "human_takeover_started"
  | "human_takeover_released"
  | "internal_command_completed"
  | "internal_command_failed";

export type CommercialEventSource = "meta_whatsapp" | "system_timer" | "internal_command" | "human_operator";

export interface CommercialEventV1 {
  contractName: typeof COMMERCIAL_EVENT_CONTRACT_NAME;
  schemaVersion: typeof COMMERCIAL_EVENT_SCHEMA_VERSION;

  id: string;
  eventType: CommercialEventType;
  source: CommercialEventSource;

  sourceEventId: string | null;
  dedupeKey: string;

  correlationId: string;
  causationId: string | null;

  customerId: string | null;
  conversationId: string | null;
  opportunityId: string | null;

  channel: string | null;
  provider: string | null;

  occurredAt: string;
  receivedAt: string;

  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export type CommercialEventPersistStatus = "created" | "duplicate";

export type CommercialEventPersistResult =
  | { ok: true; status: "created"; event: CommercialEventV1 }
  | { ok: true; status: "duplicate"; event: CommercialEventV1 }
  | { ok: false; status: "error"; event: null; warning: string };

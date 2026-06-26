import type {
  CommercialEventSource,
  CommercialEventType,
  CommercialEventV1
} from "./types";
import {
  COMMERCIAL_EVENT_CONTRACT_NAME,
  COMMERCIAL_EVENT_SCHEMA_VERSION
} from "./types";
import {
  buildCommercialEventCorrelationId,
  buildCommercialEventId,
  buildCommercialStatusEventDedupeKey,
  buildFollowUpDueCommercialEventDedupeKey,
  buildInboundCommercialEventDedupeKey,
  buildInternalCommandCommercialEventDedupeKey
} from "./dedupe";

const SENSITIVE_KEY_PATTERN = /authorization|api[-_]?key|token|secret|password|cookie|header|webhook/i;
const COMMERCIAL_EVENT_CAUSATION_ID_PATTERN = /^cevt_[a-f0-9]{32}$/i;

function nowIso() {
  return new Date().toISOString();
}

function assertPlainSerializable(value: unknown, path: string): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol" || typeof value === "undefined") {
    throw new Error(`commercial_event_non_serializable:${path}`);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item, index) => assertPlainSerializable(item, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(record)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        throw new Error(`commercial_event_forbidden_key:${path}.${key}`);
      }
      if (typeof nestedValue === "undefined") continue;
      output[key] = assertPlainSerializable(nestedValue, `${path}.${key}`);
    }
    return output;
  }
  throw new Error(`commercial_event_non_serializable:${path}`);
}

function normalizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const normalized = assertPlainSerializable(value, "root");
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new Error("commercial_event_invalid_record");
  }
  return normalized as Record<string, unknown>;
}

function normalizeCommercialEventCausationId(value?: string | null) {
  const causationId = value?.trim() || null;
  if (!causationId) return null;
  if (!COMMERCIAL_EVENT_CAUSATION_ID_PATTERN.test(causationId)) {
    throw new Error(`commercial_event_invalid_causation_id:${causationId}`);
  }
  return causationId;
}

function buildBaseEvent(input: {
  eventType: CommercialEventType;
  source: CommercialEventSource;
  sourceEventId: string | null;
  dedupeKey: string;
  correlationId?: string | null;
  causationId?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  channel?: string | null;
  provider?: string | null;
  occurredAt?: string | null;
  receivedAt?: string | null;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): CommercialEventV1 {
  const dedupeKey = input.dedupeKey.trim();
  if (!dedupeKey) throw new Error("commercial_event_missing_dedupe_key");
  const sourceEventId = input.sourceEventId?.trim() || null;
  const occurredAt = input.occurredAt?.trim() || nowIso();
  const receivedAt = input.receivedAt?.trim() || nowIso();
  const payload = normalizeRecord(input.payload);
  const metadata = normalizeRecord(input.metadata ?? {});

  return {
    contractName: COMMERCIAL_EVENT_CONTRACT_NAME,
    schemaVersion: COMMERCIAL_EVENT_SCHEMA_VERSION,
    id: buildCommercialEventId(dedupeKey),
    eventType: input.eventType,
    source: input.source,
    sourceEventId,
    dedupeKey,
    correlationId: buildCommercialEventCorrelationId(input.eventType, input.source, sourceEventId, dedupeKey, input.correlationId),
    causationId: normalizeCommercialEventCausationId(input.causationId),
    customerId: input.customerId === undefined || input.customerId === null || input.customerId === "" ? null : String(input.customerId),
    conversationId: input.conversationId === undefined || input.conversationId === null || input.conversationId === "" ? null : String(input.conversationId),
    opportunityId: input.opportunityId === undefined || input.opportunityId === null || input.opportunityId === "" ? null : String(input.opportunityId),
    channel: input.channel?.trim() || null,
    provider: input.provider?.trim() || null,
    occurredAt,
    receivedAt,
    payload,
    metadata
  };
}

export function normalizeCommercialEventPayload(payload: Record<string, unknown>) {
  return normalizeRecord(payload);
}

export function normalizeCommercialEventMetadata(metadata: Record<string, unknown>) {
  return normalizeRecord(metadata);
}

export function normalizeMetaWhatsAppInboundCommercialEvent(input: {
  providerMessageId: string;
  phoneNumberId: string;
  externalSenderId: string;
  senderPhone: string | null;
  senderName: string | null;
  messageType: string;
  text: string;
  occurredAt: string;
  receivedAt?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  messageId?: string | number | null;
  correlationId?: string | null;
  causationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const providerMessageId = input.providerMessageId.trim();
  return buildBaseEvent({
    eventType: "customer_message_received",
    source: "meta_whatsapp",
    sourceEventId: providerMessageId,
    dedupeKey: buildInboundCommercialEventDedupeKey(providerMessageId),
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    channel: "whatsapp",
    provider: "meta",
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt ?? undefined,
    payload: {
      providerMessageId,
      phoneNumberId: input.phoneNumberId.trim(),
      externalSenderId: input.externalSenderId.trim(),
      senderPhone: input.senderPhone,
      senderName: input.senderName,
      messageType: input.messageType.trim(),
      text: input.text,
      messageId: input.messageId === undefined || input.messageId === null ? null : String(input.messageId)
    },
    metadata: {
      eventKind: "native_whatsapp_inbound",
      channel: "whatsapp",
      provider: "meta",
      messageId: input.messageId === undefined || input.messageId === null ? null : String(input.messageId),
      ...normalizeCommercialEventMetadata(input.metadata ?? {})
    }
  });
}

export function normalizeMetaWhatsAppStatusCommercialEvent(input: {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  occurredAt: string;
  receivedAt?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  messageId?: string | number | null;
  correlationId?: string | null;
  causationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const providerMessageId = input.providerMessageId.trim();
  const status = input.status.trim();
  return buildBaseEvent({
    eventType: `outbound_message_${status}` as CommercialEventType,
    source: "meta_whatsapp",
    sourceEventId: providerMessageId,
    dedupeKey: buildCommercialStatusEventDedupeKey(providerMessageId, status),
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    channel: "whatsapp",
    provider: "meta",
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt ?? undefined,
    payload: {
      providerMessageId,
      status,
      messageId: input.messageId === undefined || input.messageId === null ? null : String(input.messageId)
    },
    metadata: {
      eventKind: "meta_whatsapp_status",
      channel: "whatsapp",
      provider: "meta",
      messageId: input.messageId === undefined || input.messageId === null ? null : String(input.messageId),
      ...normalizeCommercialEventMetadata(input.metadata ?? {})
    }
  });
}

export function normalizeFollowUpDueCommercialEvent(input: {
  actionId: string;
  scheduledAt: string;
  occurredAt?: string | null;
  receivedAt?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  correlationId?: string | null;
  causationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const actionId = input.actionId.trim();
  const scheduledAt = input.scheduledAt.trim();
  return buildBaseEvent({
    eventType: "follow_up_due",
    source: "system_timer",
    sourceEventId: actionId,
    dedupeKey: buildFollowUpDueCommercialEventDedupeKey(actionId, scheduledAt),
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    channel: null,
    provider: null,
    occurredAt: input.occurredAt ?? scheduledAt,
    receivedAt: input.receivedAt ?? undefined,
    payload: {
      actionId,
      scheduledAt
    },
    metadata: {
      eventKind: "follow_up_timer",
      ...normalizeCommercialEventMetadata(input.metadata ?? {})
    }
  });
}

export function normalizeInternalCommandCommercialEvent(input: {
  commandId: string;
  result: "completed" | "failed";
  occurredAt?: string | null;
  receivedAt?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  correlationId?: string | null;
  causationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const commandId = input.commandId.trim();
  const result = input.result.trim();
  return buildBaseEvent({
    eventType: result === "failed" ? "internal_command_failed" : "internal_command_completed",
    source: "internal_command",
    sourceEventId: commandId,
    dedupeKey: buildInternalCommandCommercialEventDedupeKey(commandId, result),
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    channel: null,
    provider: null,
    occurredAt: input.occurredAt ?? nowIso(),
    receivedAt: input.receivedAt ?? undefined,
    payload: {
      commandId,
      result
    },
    metadata: {
      eventKind: "internal_command",
      ...normalizeCommercialEventMetadata(input.metadata ?? {})
    }
  });
}

import { createHash } from "node:crypto";
import type { CommercialEventType } from "./types";

function stableId(parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

function compact(parts: Array<string | null | undefined>) {
  return parts.map((part) => (part ?? "").trim()).filter((part) => part.length > 0);
}

export function buildCommercialEventId(dedupeKey: string) {
  return `cevt_${stableId([dedupeKey])}`;
}

export function buildInboundCommercialEventDedupeKey(providerMessageId: string) {
  return `meta:whatsapp:inbound:${providerMessageId.trim()}`;
}

export function buildCommercialStatusEventDedupeKey(providerMessageId: string, status: string) {
  return `meta:whatsapp:status:${providerMessageId.trim()}:${status.trim()}`;
}

export function buildFollowUpDueCommercialEventDedupeKey(actionId: string, scheduledAt: string) {
  return `timer:follow_up:${actionId.trim()}:${scheduledAt.trim()}`;
}

export function buildInternalCommandCommercialEventDedupeKey(commandId: string, result: string) {
  return `internal:command:${commandId.trim()}:${result.trim()}`;
}

export function buildCommercialEventCorrelationId(
  eventType: CommercialEventType,
  source: string,
  sourceEventId: string | null,
  dedupeKey: string,
  providedCorrelationId?: string | null
) {
  if (providedCorrelationId && providedCorrelationId.trim()) return providedCorrelationId.trim();
  const prefix = compact([source, eventType, sourceEventId ?? dedupeKey]).join(":");
  return `${prefix}:${stableId([dedupeKey, eventType, source])}`;
}

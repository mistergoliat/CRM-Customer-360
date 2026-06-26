import type { PoolConnection } from "mysql2/promise";
import type { CommercialEventPersistResult } from "./types";
import {
  normalizeFollowUpDueCommercialEvent,
  normalizeInternalCommandCommercialEvent,
  normalizeMetaWhatsAppInboundCommercialEvent,
  normalizeMetaWhatsAppStatusCommercialEvent
} from "./normalize";
import { recordCommercialEvent } from "./repository";

export async function recordMetaWhatsAppInboundCommercialEvent(
  input: Parameters<typeof normalizeMetaWhatsAppInboundCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeMetaWhatsAppInboundCommercialEvent(input), connection);
}

export async function recordMetaWhatsAppStatusCommercialEvent(
  input: Parameters<typeof normalizeMetaWhatsAppStatusCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeMetaWhatsAppStatusCommercialEvent(input), connection);
}

export async function recordFollowUpDueCommercialEvent(
  input: Parameters<typeof normalizeFollowUpDueCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeFollowUpDueCommercialEvent(input), connection);
}

export async function recordInternalCommandCommercialEvent(
  input: Parameters<typeof normalizeInternalCommandCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeInternalCommandCommercialEvent(input), connection);
}

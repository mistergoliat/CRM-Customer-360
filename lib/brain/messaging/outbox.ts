import { safeQueryRows } from "@/lib/db";
import type { BrainExecutionActionType, BrainExecutionPlan, BrainOutboxPreview, BrainOutboxStatus } from "./types";
import type { BrainDedupeCheckResult, BrainDedupeKeyInput } from "./dedupe";
import { buildDedupeKey, hashMessageText } from "./dedupe";
import {
  BRAIN_MESSAGE_OUTBOX_TABLE,
  BRAIN_MESSAGE_OUTBOX_MODEL_VERSION,
  rowToRecord,
  writeCanonicalOutboxMessage,
  type BrainOutboxRecord,
  type CanonicalOutboxExperimentMetadata
} from "./canonicalOutboxWriter";

export { BRAIN_MESSAGE_OUTBOX_TABLE, BRAIN_MESSAGE_OUTBOX_MODEL_VERSION, type BrainOutboxRecord };

export type BrainOutboxRecordInput = {
  dedupeKeyInput: BrainDedupeKeyInput;
  status: BrainOutboxStatus;
  source: string | null;
  sourceRequestId?: string | null;
  sourceAgentName?: string | null;
  sourceAgentVersion?: string | null;
  waId?: string | null;
  phoneNumberId?: string | null;
  conversationCaseId?: string | number | null;
  messageText?: string | null;
  metaPayloadJson?: Record<string, unknown> | null;
  providerMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Opportunity this send belongs to, when known - carried through to delivery-outcome projection (ACS-R1-05-T04). */
  opportunityId?: number | string | null;
  /** Optional A/B-testing attribution, folded into meta_payload_json (ACS-R1-05-T04 section 11). */
  experiment?: CanonicalOutboxExperimentMetadata | null;
};

export type BrainOutboxLookupResult =
  | { ok: true; row: BrainOutboxRecord | null; warning?: string }
  | { ok: false; row: null; warning: string };

export type BrainOutboxPersistResult =
  | { ok: true; persisted: boolean; existing: boolean; row: BrainOutboxRecord; warning?: string }
  | { ok: false; persisted: false; existing: false; row: null; warning: string };

export type BrainOutboxPreviewInput = {
  actionType: BrainExecutionActionType;
  status: BrainExecutionPlan["status"];
  dedupeCheck: BrainDedupeCheckResult;
  reason: string;
};

async function brainOutboxTableExists() {
  const rows = await safeQueryRows<{ table_exists: number }>(
    "SELECT 1 AS table_exists FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [BRAIN_MESSAGE_OUTBOX_TABLE]
  );
  return rows.ok && rows.rows.length > 0;
}

function normalizeRecordJson(value: Record<string, unknown> | null | undefined) {
  if (!value) return null;
  return value;
}

export function buildOutboxPreview(input: BrainOutboxPreviewInput): BrainOutboxPreview {
  return {
    dedupe_key: input.dedupeCheck.dedupe_key,
    channel: "whatsapp",
    status: input.status,
    action_type: input.actionType,
    duplicate_detected: input.dedupeCheck.duplicate_detected,
    reason: input.reason
  };
}

export function buildOutboxRecord(input: BrainOutboxRecordInput): BrainOutboxRecord {
  return {
    dedupe_key: buildDedupeKey(input.dedupeKeyInput),
    channel: "whatsapp",
    direction: "outbound",
    status: input.status,
    source: input.source,
    source_request_id: input.sourceRequestId ?? input.dedupeKeyInput.sourceRequestId ?? null,
    source_agent_name: input.sourceAgentName ?? null,
    source_agent_version: input.sourceAgentVersion ?? null,
    wa_id: input.waId ?? input.dedupeKeyInput.waId ?? null,
    phone_number_id: input.phoneNumberId ?? input.dedupeKeyInput.phoneNumberId ?? null,
    conversation_case_id: input.conversationCaseId ?? input.dedupeKeyInput.conversationCaseId ?? null,
    message_text: input.messageText ?? null,
    message_hash: input.messageText ? hashMessageText(input.messageText) : null,
    meta_payload_json: normalizeRecordJson(input.metaPayloadJson),
    provider_message_id: input.providerMessageId ?? null,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null
  };
}

export async function findOutboxByDedupeKey(dedupeKey: string): Promise<BrainOutboxLookupResult> {
  if (!(await brainOutboxTableExists())) {
    return { ok: false, row: null, warning: `Tabla ${BRAIN_MESSAGE_OUTBOX_TABLE} no disponible` };
  }

  const rows = await safeQueryRows<Record<string, unknown>>(`SELECT * FROM \`${BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE dedupe_key = ? LIMIT 1`, [dedupeKey]);
  if (!rows.ok) {
    return { ok: false, row: null, warning: rows.error };
  }

  return { ok: true, row: rows.rows[0] ? rowToRecord(rows.rows[0]) : null };
}

/**
 * Legacy public entrypoint. Delegates all persistence to the canonical
 * writer (ACS-R1-05-T04, P1-4) - no SQL of its own left here.
 */
export async function createOutboxPlannedRecord(input: BrainOutboxRecordInput): Promise<BrainOutboxPersistResult> {
  const dedupeKey = buildDedupeKey(input.dedupeKeyInput);

  try {
    const result = await writeCanonicalOutboxMessage({
      dedupeKey,
      status: input.status,
      source: input.source,
      sourceRequestId: input.sourceRequestId ?? input.dedupeKeyInput.sourceRequestId ?? null,
      sourceAgentName: input.sourceAgentName ?? null,
      sourceAgentVersion: input.sourceAgentVersion ?? null,
      waId: input.waId ?? input.dedupeKeyInput.waId ?? null,
      phoneNumberId: input.phoneNumberId ?? input.dedupeKeyInput.phoneNumberId ?? null,
      conversationCaseId: input.conversationCaseId ?? input.dedupeKeyInput.conversationCaseId ?? null,
      messageText: input.messageText ?? null,
      metaPayloadJson: input.metaPayloadJson ?? null,
      providerMessageId: input.providerMessageId ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      opportunityId: input.opportunityId ?? null,
      experiment: input.experiment ?? null
    });

    return {
      ok: true,
      persisted: result.inserted,
      existing: result.duplicate,
      row: result.row,
      warning: result.duplicate ? "Existing outbox record reused." : undefined
    };
  } catch (error) {
    return {
      ok: false,
      persisted: false,
      existing: false,
      row: null,
      warning: error instanceof Error ? error.message : String(error)
    };
  }
}

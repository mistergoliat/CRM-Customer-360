import crypto from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/db";
import { hashMessageText } from "./dedupe";
import type { BrainOutboxStatus } from "./types";

// Canonical persistence for brain_message_outbox (ACS-R1-05-T04, P1-4).
// This is the ONLY module allowed to INSERT into brain_message_outbox.
// lib/brain/messaging/outbox.ts (legacy adapter) and
// lib/brain/commercial/execution-gate/sqlExecutionUnitOfWork.ts (execution-gate
// adapter) both delegate here instead of running their own INSERT.

export const BRAIN_MESSAGE_OUTBOX_TABLE = "brain_message_outbox";
export const BRAIN_MESSAGE_OUTBOX_MODEL_VERSION = "brain.message-outbox.v1";

export type BrainOutboxRecord = {
  id?: number;
  dedupe_key: string;
  channel: "whatsapp";
  direction: "outbound";
  status: BrainOutboxStatus;
  source: string | null;
  source_request_id: string | null;
  source_agent_name: string | null;
  source_agent_version: string | null;
  wa_id: string | null;
  phone_number_id: string | null;
  conversation_case_id: string | number | null;
  message_text: string | null;
  message_hash: string | null;
  meta_payload_json: Record<string, unknown> | null;
  provider_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  planned_at?: string;
  locked_at?: string | null;
  sent_at?: string | null;
  failed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

// Optional A/B-testing attribution (ACS-R1-05-T04 section 11). T04 only wires
// traceability through to crm_action_outcomes - no variant assignment, no
// statistics, no campaign/UI logic lives here or anywhere else yet.
export type CanonicalOutboxExperimentMetadata = {
  experimentId?: string | null;
  variantId?: string | null;
  templateId?: string | null;
  promptVersion?: string | null;
  contentHash?: string | null;
};

export type CanonicalOutboxWriteInput = {
  dedupeKey: string;
  status: BrainOutboxStatus;
  source: string | null;
  sourceRequestId: string | null;
  sourceAgentName: string | null;
  sourceAgentVersion: string | null;
  waId: string | null;
  /** Explicit override. When absent, resolved from the conversation's channel_account_id, then env fallback. */
  phoneNumberId: string | null;
  conversationCaseId: string | number | null;
  messageText: string | null;
  metaPayloadJson: Record<string, unknown> | null;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** Folded into meta_payload_json.opportunity_id - the primary signal delivery-status projection resolves against. */
  opportunityId: number | string | null;
  experiment?: CanonicalOutboxExperimentMetadata | null;
  plannedAt?: string;
};

export type CanonicalOutboxWriteResult = {
  inserted: boolean;
  duplicate: boolean;
  rowId: number;
  row: BrainOutboxRecord;
};

/** The single logical identity of an outbox send (ACS-R1-05-T04.1, P1-4). */
export type CanonicalOutboxIdentity = {
  channel: string;
  actionId: string;
  idempotencyKey: string;
  recipient: string;
  content: string;
};

/**
 * The ONLY function allowed to compute a brain_message_outbox dedupe_key.
 * Both adapters (outbox.ts, execution-gate/buildOutboxCommand.ts) call this
 * with their own domain fields mapped onto the same five parameters - same
 * actionId + idempotencyKey + recipient + content + channel always yields the
 * same key, regardless of which adapter produced it. Adapters may map
 * genuinely different logical types onto different (actionId, idempotencyKey)
 * namespaces, but never diverge for the same logical command.
 */
export function buildCanonicalOutboxDedupeKey(identity: CanonicalOutboxIdentity): string {
  const contentHash = hashMessageText(identity.content ?? "");
  const hash = crypto
    .createHash("sha256")
    .update([identity.channel, identity.actionId, identity.idempotencyKey, identity.recipient, contentHash].join("|"))
    .digest("hex")
    .slice(0, 24);
  return `brain-outbox-${hash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalStringOrNumber(value: unknown): string | number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

function toMysqlDateTime(value: string | Date | null | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toISOString().slice(0, 19).replace("T", " ");
}

export function rowToRecord(row: Record<string, unknown>): BrainOutboxRecord {
  const rawMetaPayload = row.meta_payload_json;
  let metaPayloadJson: Record<string, unknown> | null = null;
  if (isRecord(rawMetaPayload)) {
    metaPayloadJson = rawMetaPayload;
  } else if (typeof rawMetaPayload === "string" && rawMetaPayload.trim()) {
    try {
      const parsed = JSON.parse(rawMetaPayload);
      metaPayloadJson = isRecord(parsed) ? parsed : null;
    } catch {
      metaPayloadJson = null;
    }
  }

  return {
    id: typeof row.id === "number" ? row.id : Number(row.id ?? 0) || undefined,
    dedupe_key: asString(row.dedupe_key) ?? "",
    channel: "whatsapp",
    direction: "outbound",
    status: (asString(row.status) as BrainOutboxStatus) ?? "planned",
    source: asString(row.source),
    source_request_id: asString(row.source_request_id),
    source_agent_name: asString(row.source_agent_name),
    source_agent_version: asString(row.source_agent_version),
    wa_id: asString(row.wa_id),
    phone_number_id: asString(row.phone_number_id),
    conversation_case_id: asOptionalStringOrNumber(row.conversation_case_id),
    message_text: asString(row.message_text),
    message_hash: asString(row.message_hash),
    meta_payload_json: metaPayloadJson,
    provider_message_id: asString(row.provider_message_id),
    error_code: asString(row.error_code),
    error_message: asString(row.error_message),
    planned_at: asString(row.planned_at) ?? undefined,
    locked_at: asString(row.locked_at),
    sent_at: asString(row.sent_at),
    failed_at: asString(row.failed_at),
    created_at: asString(row.created_at) ?? undefined,
    updated_at: asString(row.updated_at) ?? undefined
  };
}

async function brainOutboxTableExists(connection: PoolConnection) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT 1 AS table_exists FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [BRAIN_MESSAGE_OUTBOX_TABLE]
  );
  return rows.length > 0;
}

// Single canonical phone_number_id resolution (ACS-R1-05-T04 section 5):
// explicit input wins; otherwise the conversation's channel_account_id (the
// Meta phone number the customer actually wrote to); otherwise the
// configured default. Neither adapter may resolve this on its own anymore.
async function resolveCanonicalPhoneNumberId(input: CanonicalOutboxWriteInput, connection: PoolConnection): Promise<string | null> {
  const explicit = asString(input.phoneNumberId);
  if (explicit) return explicit;

  if (input.conversationCaseId !== null && input.conversationCaseId !== undefined) {
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT channel_account_id FROM conversation WHERE id = ? LIMIT 1", [input.conversationCaseId]);
    const row = rows[0] as Record<string, unknown> | undefined;
    const fromConversation = asString(row?.channel_account_id);
    if (fromConversation) return fromConversation;
  }

  return process.env.META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID?.trim() || null;
}

function hasExperimentValue(experiment: CanonicalOutboxExperimentMetadata | null | undefined) {
  if (!experiment) return false;
  return Object.values(experiment).some((value) => typeof value === "string" && value.trim().length > 0);
}

function compactExperimentMetadata(experiment: CanonicalOutboxExperimentMetadata) {
  const compact: Record<string, string> = {};
  if (experiment.experimentId?.trim()) compact.experiment_id = experiment.experimentId.trim();
  if (experiment.variantId?.trim()) compact.variant_id = experiment.variantId.trim();
  if (experiment.templateId?.trim()) compact.template_id = experiment.templateId.trim();
  if (experiment.promptVersion?.trim()) compact.prompt_version = experiment.promptVersion.trim();
  if (experiment.contentHash?.trim()) compact.content_hash = experiment.contentHash.trim();
  return compact;
}

// Single canonical column normalization: opportunity_id and experiment
// attribution always land in the same meta_payload_json shape regardless of
// which adapter called the writer (section 5/11).
function buildMetaPayloadJson(input: CanonicalOutboxWriteInput): Record<string, unknown> | null {
  const hasOpportunity = input.opportunityId !== null && input.opportunityId !== undefined;
  const hasExperiment = hasExperimentValue(input.experiment);
  if (!input.metaPayloadJson && !hasOpportunity && !hasExperiment) return null;

  return {
    ...(input.metaPayloadJson ?? {}),
    ...(hasOpportunity ? { opportunity_id: input.opportunityId } : {}),
    ...(hasExperiment ? { experiment: compactExperimentMetadata(input.experiment!) } : {})
  };
}

async function runCanonicalWrite(input: CanonicalOutboxWriteInput, connection: PoolConnection): Promise<CanonicalOutboxWriteResult> {
  if (!(await brainOutboxTableExists(connection))) {
    throw new Error(`Tabla ${BRAIN_MESSAGE_OUTBOX_TABLE} no disponible`);
  }

  const phoneNumberId = await resolveCanonicalPhoneNumberId(input, connection);
  const metaPayloadJson = buildMetaPayloadJson(input);
  const plannedAt = toMysqlDateTime(input.plannedAt);
  const messageHash = input.messageText ? hashMessageText(input.messageText) : null;

  // INSERT IGNORE backed by the unique index on dedupe_key is the only safe
  // guard against two concurrent writers observing "not found" at the same
  // time - a SELECT-then-INSERT pattern cannot rule that race out.
  const [insertResult] = await connection.execute<ResultSetHeader>(
    `
      INSERT IGNORE INTO \`${BRAIN_MESSAGE_OUTBOX_TABLE}\`
        (
          dedupe_key,
          channel,
          direction,
          status,
          source,
          source_request_id,
          source_agent_name,
          source_agent_version,
          wa_id,
          phone_number_id,
          conversation_case_id,
          message_text,
          message_hash,
          meta_payload_json,
          provider_message_id,
          error_code,
          error_message,
          planned_at,
          locked_at,
          sent_at,
          failed_at,
          created_at,
          updated_at
        )
      VALUES (
        ?,
        'whatsapp',
        'outbound',
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        NULL,
        NULL,
        NULL,
        ?,
        ?
      )
    `,
    [
      input.dedupeKey,
      input.status,
      input.source,
      input.sourceRequestId,
      input.sourceAgentName,
      input.sourceAgentVersion,
      input.waId,
      phoneNumberId,
      input.conversationCaseId,
      input.messageText,
      messageHash,
      metaPayloadJson ? JSON.stringify(metaPayloadJson) : null,
      input.providerMessageId,
      input.errorCode,
      input.errorMessage,
      plannedAt,
      plannedAt,
      plannedAt
    ]
  );

  if (insertResult.affectedRows > 0 && insertResult.insertId > 0) {
    const [insertedRows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM \`${BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE id = ? LIMIT 1`, [insertResult.insertId]);
    const row = insertedRows[0];
    if (!row) throw new Error(`canonical_outbox_write_missing_row:${insertResult.insertId}`);
    return { inserted: true, duplicate: false, rowId: insertResult.insertId, row: rowToRecord(row as Record<string, unknown>) };
  }

  const [existingRows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM \`${BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE dedupe_key = ? LIMIT 1`, [input.dedupeKey]);
  const existingRow = existingRows[0];
  if (!existingRow) throw new Error(`canonical_outbox_write_duplicate_missing:${input.dedupeKey}`);
  const record = rowToRecord(existingRow as Record<string, unknown>);
  return { inserted: false, duplicate: true, rowId: record.id ?? 0, row: record };
}

/**
 * Canonical writer for brain_message_outbox. Pass the caller's own
 * PoolConnection to participate in an existing transaction (never opens a
 * second connection in that case); omit it for a standalone call.
 *
 * Throws on failure (missing table, DB error) - callers decide how to
 * surface that: the legacy adapter (outbox.ts) catches it into a
 * `{ok:false}` result, the execution-gate adapter lets it propagate so the
 * unit-of-work transaction rolls back.
 */
export async function writeCanonicalOutboxMessage(input: CanonicalOutboxWriteInput, connection?: PoolConnection): Promise<CanonicalOutboxWriteResult> {
  if (connection) return runCanonicalWrite(input, connection);
  return withConnection((conn) => runCanonicalWrite(input, conn));
}

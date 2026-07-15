import { safeExecute, safeQueryRows, queryRows } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { selectPlannedOutboxCandidates, lockOutboxRecord } from "./outboxWorker";
import { sendMetaWhatsAppTextMessage } from "./metaClient";
import { persistCanonicalOutboundMessage } from "./outboundMessages";
import {
  persistActionExecution,
  persistActionOutcome,
  markActionExecuted,
  markActionFailed,
  loadActionIdByOutboxMessageId,
  buildDeliveryOutcomeDedupeKey,
  extractDeliveryExperimentAttribution
} from "@/lib/brain/commercial/action-queue/persistActionOutcome";
import { redactErrorMessage } from "@/lib/brain/commercial/redactErrorMessage";
import { isWaIdAuthorizedForPilot } from "@/lib/brain/runtime/autonomousRuntimeConfig";
import { isWhatsAppWindowOpen } from "@/lib/domains/conversations/control";

/**
 * One outbox polling tick, shared by the worker script, tests and the E2E
 * harness (the send function is injectable so no real Meta call is needed to
 * exercise the full state machine).
 *
 * Guarantees enforced here, per row:
 *  1. Atomic claim (planned → locked) — concurrent workers never double-send.
 *  2. Ownership re-validation IMMEDIATELY before the send: an AI-authored row
 *     is cancelled if, since planning, an operator took control, the AI was
 *     paused, or the conversation was closed.
 *  3. WhatsApp 24h window check for AI rows (free text outside it is blocked).
 *  4. Retry with exponential backoff for transient provider failures
 *     (network errors, HTTP 429/5xx) up to maxAttempts; then terminal failure
 *     with ActionOutcome + escalation audit entry.
 *  5. Terminal transitions guarded by `WHERE status='locked'` — if an operator
 *     cancelled the row mid-flight, the race is detected and audited.
 */

export const DEFAULT_OUTBOX_MAX_ATTEMPTS = 5;
export const DEFAULT_OUTBOX_RETRY_BASE_SECONDS = 30;
export const DEFAULT_OUTBOX_RETRY_MAX_SECONDS = 900;

function readIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name]?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type OutboxTickSendResult = Awaited<ReturnType<typeof sendMetaWhatsAppTextMessage>>;

export type OutboxTickOptions = {
  batchSize: number;
  lockSeconds: number;
  workerId: string;
  dryRun?: boolean;
  allowedWaIds?: string[];
  /** Restrict the tick to these outbox rows (tests/harness isolation). */
  outboxIds?: number[];
  maxAttempts?: number;
  retryBaseSeconds?: number;
  retryMaxSeconds?: number;
  sendFn?: (input: Parameters<typeof sendMetaWhatsAppTextMessage>[0]) => Promise<OutboxTickSendResult>;
  log?: (message: string) => void;
};

export type OutboxTickResult = {
  processed: number;
  sent: number;
  failed: number;
  retried: number;
  cancelled: number;
  skipped: number;
};

type FullOutboxRow = {
  id: number;
  dedupe_key: string;
  status: string;
  source: string | null;
  wa_id: string | null;
  phone_number_id: string | null;
  conversation_case_id: string | number | null;
  message_text: string | null;
  meta_payload_json: unknown;
  attempt_count: number;
};

type ConversationOwnershipRow = {
  id: number;
  status: string;
  ai_enabled: number | string;
  human_owner_active: number | string;
  last_inbound_at: string | Date | null;
};

const CLOSED_STATUSES = ["closed", "resolved", "done", "archived"];

function toBool(value: number | string): boolean {
  if (typeof value === "number") return value !== 0;
  const t = String(value).trim().toLowerCase();
  return t !== "" && t !== "0" && t !== "false";
}

/** Transient provider failures are retried; config/policy failures are terminal. */
export function isRetryableSendFailure(errorCode: string | null, httpStatus: number | null | undefined): boolean {
  if (errorCode === "meta_network_error") return true;
  if (errorCode === "meta_http_error") {
    if (httpStatus === undefined || httpStatus === null) return true;
    return httpStatus === 429 || httpStatus >= 500;
  }
  return false;
}

export function computeRetryDelaySeconds(attemptCount: number, baseSeconds: number, maxSeconds: number): number {
  return Math.min(baseSeconds * 2 ** attemptCount, maxSeconds);
}

async function loadFullOutboxRow(outboxId: number): Promise<FullOutboxRow | null> {
  const result = await safeQueryRows<FullOutboxRow>(
    `SELECT id, dedupe_key, status, source, wa_id, phone_number_id, conversation_case_id, message_text, meta_payload_json, attempt_count
      FROM brain_message_outbox WHERE id = ? LIMIT 1`,
    [outboxId]
  );
  return result.ok ? result.rows[0] ?? null : null;
}

async function loadConversationOwnership(conversationCaseId: string | number): Promise<ConversationOwnershipRow | null> {
  const result = await safeQueryRows<ConversationOwnershipRow>(
    "SELECT id, status, ai_enabled, human_owner_active, last_inbound_at FROM conversation WHERE id = ? LIMIT 1",
    [conversationCaseId]
  );
  return result.ok ? result.rows[0] ?? null : null;
}

/** Cancel a locked row that must not be sent; also cancel its source action. */
async function cancelLockedRow(row: FullOutboxRow, reason: string, workerId: string): Promise<boolean> {
  const result = await safeExecute(
    `UPDATE brain_message_outbox
      SET status = 'cancelled', error_code = ?, failed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND status = 'locked'`,
    [reason, row.id]
  );
  const applied = result.ok && result.affectedRows > 0;

  const actionId = await loadActionIdByOutboxMessageId(row.id);
  if (actionId) {
    await safeQueryRows(
      `UPDATE crm_agent_actions SET status = 'cancelled', cancel_reason = ?, updated_at = CURRENT_TIMESTAMP(3)
        WHERE action_id = ? AND status IN ('proposed','planned','approved')`,
      [reason, actionId]
    );
  }

  await persistActionExecution({
    actionId: actionId ?? `outbox:${row.id}`,
    actionRowId: null,
    outboxMessageId: row.id,
    outboxDedupeKey: row.dedupe_key,
    attemptNumber: row.attempt_count + 1,
    status: "cancelled",
    requestedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    errorCode: reason,
    retryable: false,
    correlationId: row.dedupe_key
  });

  await auditLog({
    action: "outbox.send.cancelled",
    entityType: "brain_message_outbox",
    entityId: row.id,
    after: { reason, workerId, dedupeKey: row.dedupe_key }
  });

  return applied;
}

/**
 * Re-validate, immediately before sending, that this row is still allowed to
 * go out. Returns null when the send may proceed, or the cancel reason applied.
 */
async function revalidateBeforeSend(row: FullOutboxRow, workerId: string): Promise<string | null> {
  // The row may have been cancelled between claim and now (operator takeover
  // cancels planned AND locked rows atomically).
  const current = await safeQueryRows<{ status: string }>(
    "SELECT status FROM brain_message_outbox WHERE id = ? LIMIT 1",
    [row.id]
  );
  const currentStatus = current.ok ? current.rows[0]?.status ?? null : null;
  if (currentStatus !== "locked") return "superseded";

  const isOperatorRow = (row.source ?? "").trim().toLowerCase() === "operator";
  if (isOperatorRow || !row.conversation_case_id) return null;

  const conversation = await loadConversationOwnership(row.conversation_case_id);
  if (!conversation) return null;

  if (CLOSED_STATUSES.includes((conversation.status ?? "").trim().toLowerCase())) {
    await cancelLockedRow(row, "conversation_closed", workerId);
    return "conversation_closed";
  }
  if (toBool(conversation.human_owner_active) || !toBool(conversation.ai_enabled)) {
    await cancelLockedRow(row, "ownership_revoked", workerId);
    return "ownership_revoked";
  }
  if (!isWhatsAppWindowOpen(conversation.last_inbound_at)) {
    await cancelLockedRow(row, "window_closed", workerId);
    await auditLog({
      action: "outbox.window_closed.escalated",
      entityType: "brain_message_outbox",
      entityId: row.id,
      after: { workerId, dedupeKey: row.dedupe_key, conversationId: conversation.id }
    });
    return "window_closed";
  }

  return null;
}

export async function runOutboxTick(options: OutboxTickOptions): Promise<OutboxTickResult> {
  const log = options.log ?? (() => void 0);
  const maxAttempts = options.maxAttempts ?? readIntEnv("BRAIN_OUTBOX_MAX_ATTEMPTS", DEFAULT_OUTBOX_MAX_ATTEMPTS);
  const retryBaseSeconds = options.retryBaseSeconds ?? readIntEnv("BRAIN_OUTBOX_RETRY_BASE_SECONDS", DEFAULT_OUTBOX_RETRY_BASE_SECONDS);
  const retryMaxSeconds = options.retryMaxSeconds ?? readIntEnv("BRAIN_OUTBOX_RETRY_MAX_SECONDS", DEFAULT_OUTBOX_RETRY_MAX_SECONDS);
  const sendFn = options.sendFn ?? sendMetaWhatsAppTextMessage;
  const allowedWaIds = options.allowedWaIds ?? [];

  const result: OutboxTickResult = { processed: 0, sent: 0, failed: 0, retried: 0, cancelled: 0, skipped: 0 };

  const candidatesResult = await selectPlannedOutboxCandidates(options.batchSize);
  if (!candidatesResult.ok || candidatesResult.candidates.length === 0) return result;

  const candidates = options.outboxIds
    ? candidatesResult.candidates.filter((candidate) => candidate.id !== null && options.outboxIds!.includes(candidate.id))
    : candidatesResult.candidates;

  for (const candidate of candidates) {
    if (!candidate.id) continue;
    const requestedAt = new Date().toISOString();

    // Allowlist guard BEFORE locking, so a non-allowlisted row is never left
    // claimed (it stays planned and visible instead of stuck in 'locked').
    // ACS-R1-05-T06.1: isWaIdAuthorizedForPilot digit-normalizes both sides
    // (a raw .includes() could miss a match on "+56 9..." vs "569...") and
    // treats a missing wa_id as unauthorized whenever the allowlist is active
    // - the previous `candidate.wa_id &&` short-circuit let a null wa_id skip
    // the guard entirely.
    if (!isWaIdAuthorizedForPilot(candidate.wa_id, allowedWaIds)) {
      log(`[worker:outbox] skipping non-allowlisted wa_id ${candidate.wa_id ?? "(none)"}`);
      result.skipped++;
      continue;
    }

    // (1) Atomic claim — skips if another worker already took it.
    const lockResult = await lockOutboxRecord(candidate, { lockSeconds: options.lockSeconds, debug: false });
    if (!lockResult.applied || lockResult.simulated) {
      result.skipped++;
      continue;
    }

    const row = await loadFullOutboxRow(candidate.id);
    if (!row) {
      result.skipped++;
      continue;
    }

    if (!row.wa_id || !row.phone_number_id || !row.message_text) {
      log(`[worker:outbox] skipping row with missing fields ${row.id}`);
      await cancelLockedRow(row, "invalid_payload", options.workerId);
      result.cancelled++;
      continue;
    }

    // (2)+(3) Ownership + window re-validation immediately before the send.
    const cancelReason = await revalidateBeforeSend(row, options.workerId);
    if (cancelReason) {
      log(`[worker:outbox] cancelled row ${row.id}: ${cancelReason}`);
      result.cancelled++;
      continue;
    }

    const actionId = await loadActionIdByOutboxMessageId(row.id);

    if (options.dryRun) {
      log(`[worker:outbox] DRY RUN — would send to ${row.wa_id}: ${row.message_text.slice(0, 60)}`);
      result.processed++;
      continue;
    }

    let sendStatus: "succeeded" | "failed" = "failed";
    let providerMessageId: string | null = null;
    let sendErrorCode: string | null = null;
    let sendErrorMessage: string | null = null;
    let httpStatus: number | null = null;
    const startedAt = new Date().toISOString();

    try {
      const sendResult = await sendFn({
        waId: row.wa_id,
        phoneNumberId: row.phone_number_id,
        messageText: row.message_text,
        timeoutMs: 10000,
        source: "brain",
        sourceRequestId: row.dedupe_key,
        conversationCaseId: row.conversation_case_id
      });
      if (sendResult.ok && sendResult.status === "sent") {
        sendStatus = "succeeded";
        providerMessageId = sendResult.provider_message_id ?? null;
      } else {
        sendErrorCode = sendResult.error_code ?? "send_failed";
        // ACS-R1-05-T06.1 (P1-2): redacted once here so every downstream
        // write (crm_action_executions.error_message, brain_message_outbox.
        // error_message, markActionFailed's failure_reason) inherits the
        // sanitized value - a provider error can otherwise echo back the
        // recipient's own phone number/email in its message text.
        sendErrorMessage = sendResult.error_message ? redactErrorMessage(sendResult.error_message) : null;
        httpStatus = (sendResult as { http_status?: number | null }).http_status ?? null;
      }
    } catch (error) {
      sendErrorCode = "exception";
      sendErrorMessage = redactErrorMessage(error) || "unknown";
    }

    const completedAt = new Date().toISOString();
    const attemptNumber = row.attempt_count + 1;
    const experimentAttribution = extractDeliveryExperimentAttribution(row.meta_payload_json);

    if (sendStatus === "succeeded") {
      const update = await safeExecute(
        `UPDATE brain_message_outbox
          SET status = 'sent', sent_at = CURRENT_TIMESTAMP(3), provider_message_id = ?,
              attempt_count = ?, next_attempt_at = NULL, error_code = NULL, error_message = NULL
          WHERE id = ? AND status = 'locked'`,
        [providerMessageId, attemptNumber, row.id]
      );
      const applied = update.ok && update.affectedRows > 0;
      if (!applied) {
        // Race: an operator cancelled the row while the provider call was in
        // flight. The message DID reach the provider — make that visible.
        await auditLog({
          action: "outbox.sent_after_cancel",
          entityType: "brain_message_outbox",
          entityId: row.id,
          after: { providerMessageId, workerId: options.workerId, dedupeKey: row.dedupe_key }
        });
      }

      const execResult = await persistActionExecution({
        actionId: actionId ?? `outbox:${row.id}`,
        actionRowId: null,
        outboxMessageId: row.id,
        outboxDedupeKey: row.dedupe_key,
        attemptNumber,
        status: "succeeded",
        requestedAt,
        startedAt,
        completedAt,
        retryable: false,
        correlationId: row.dedupe_key
      });
      // Same outcome_dedupe_key contract as the webhook path (recordDeliveryOutcome):
      // a later Meta "sent" webhook for this same providerMessageId reuses this row.
      await persistActionOutcome({
        actionId: actionId ?? `outbox:${row.id}`,
        actionRowId: null,
        executionId: execResult.executionId,
        outboxMessageId: row.id,
        providerMessageId,
        outcomeType: "sent",
        occurredAt: completedAt,
        metadataJson: {
          workerId: options.workerId,
          dedupeKey: row.dedupe_key,
          attemptNumber,
          ...(experimentAttribution ? { experiment: experimentAttribution } : {})
        },
        outcomeDedupeKey: providerMessageId ? buildDeliveryOutcomeDedupeKey("meta", providerMessageId, "sent") : null
      });

      await persistCanonicalOutboundMessage({
        enabled: true,
        outboxId: row.id,
        dedupeKey: row.dedupe_key,
        outboxStatus: "sent",
        conversationCaseId: row.conversation_case_id,
        waId: row.wa_id,
        phoneNumberId: row.phone_number_id,
        messageText: row.message_text,
        providerMessageId,
        sentAt: completedAt
      });

      if (actionId) await markActionExecuted(actionId, row.id, providerMessageId, completedAt);
      if (row.conversation_case_id) {
        await queryRows(
          "UPDATE conversation SET last_message_at = CURRENT_TIMESTAMP(3), last_outbound_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
          [row.conversation_case_id]
        );
      }

      log(`[worker:outbox] sent row ${row.id} to ${row.wa_id} → ${providerMessageId}`);
      result.sent++;
      result.processed++;
      continue;
    }

    const retryable = isRetryableSendFailure(sendErrorCode, httpStatus);

    // Every attempt is recorded as its own execution; the action row is never duplicated.
    const execResult = await persistActionExecution({
      actionId: actionId ?? `outbox:${row.id}`,
      actionRowId: null,
      outboxMessageId: row.id,
      outboxDedupeKey: row.dedupe_key,
      attemptNumber,
      status: "failed",
      requestedAt,
      startedAt,
      completedAt,
      errorCode: sendErrorCode,
      errorMessage: sendErrorMessage,
      retryable: retryable && attemptNumber < maxAttempts,
      correlationId: row.dedupe_key
    });

    if (retryable && attemptNumber < maxAttempts) {
      const delaySeconds = computeRetryDelaySeconds(row.attempt_count, retryBaseSeconds, retryMaxSeconds);
      await safeQueryRows(
        `UPDATE brain_message_outbox
          SET status = 'planned', locked_at = NULL, attempt_count = ?,
              next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
              error_code = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND status = 'locked'`,
        [attemptNumber, delaySeconds, sendErrorCode, sendErrorMessage, row.id]
      );
      log(`[worker:outbox] retrying row ${row.id} in ${delaySeconds}s (attempt ${attemptNumber}/${maxAttempts}): ${sendErrorCode}`);
      result.retried++;
      result.processed++;
      continue;
    }

    // Terminal failure: outcome + action failure + escalation audit entry.
    await safeQueryRows(
      `UPDATE brain_message_outbox
        SET status = 'failed', failed_at = CURRENT_TIMESTAMP(3), attempt_count = ?,
            error_code = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ? AND status = 'locked'`,
      [attemptNumber, sendErrorCode, sendErrorMessage, row.id]
    );
    await persistActionOutcome({
      actionId: actionId ?? `outbox:${row.id}`,
      actionRowId: null,
      executionId: execResult.executionId,
      outboxMessageId: row.id,
      providerMessageId: null,
      outcomeType: "failed",
      occurredAt: completedAt,
      metadataJson: {
        workerId: options.workerId,
        dedupeKey: row.dedupe_key,
        attemptNumber,
        errorCode: sendErrorCode,
        ...(experimentAttribution ? { experiment: experimentAttribution } : {})
      }
      // No outcomeDedupeKey: no provider_message_id exists yet for a failed send attempt.
    });
    if (actionId) await markActionFailed(actionId, sendErrorCode, sendErrorMessage);
    await auditLog({
      action: "outbox.send.escalated",
      entityType: "brain_message_outbox",
      entityId: row.id,
      after: {
        workerId: options.workerId,
        dedupeKey: row.dedupe_key,
        attemptNumber,
        maxAttempts,
        errorCode: sendErrorCode,
        retryable
      }
    });

    log(`[worker:outbox] failed row ${row.id} to ${row.wa_id}: ${sendErrorCode} (attempt ${attemptNumber}/${maxAttempts})`);
    result.failed++;
    result.processed++;
  }

  return result;
}

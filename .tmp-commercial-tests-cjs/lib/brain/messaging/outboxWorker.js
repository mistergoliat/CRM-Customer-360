"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRAIN_OUTBOX_WORKER_VERSION = exports.DEFAULT_OUTBOX_WORKER_LOCK_SECONDS = exports.DEFAULT_OUTBOX_WORKER_BATCH_SIZE = void 0;
exports.selectPlannedOutboxCandidates = selectPlannedOutboxCandidates;
exports.lockOutboxRecord = lockOutboxRecord;
exports.lockOutboxBatch = lockOutboxBatch;
exports.planOutboxWorkerRun = planOutboxWorkerRun;
const db_1 = require("@/lib/db");
const metaClient_1 = require("./metaClient");
const metaPayload_1 = require("./metaPayload");
const caseUpdates_1 = require("./caseUpdates");
const outbox_1 = require("./outbox");
const outboundMessages_1 = require("./outboundMessages");
const outboxTransitions_1 = require("./outboxTransitions");
exports.DEFAULT_OUTBOX_WORKER_BATCH_SIZE = 5;
exports.DEFAULT_OUTBOX_WORKER_LOCK_SECONDS = 60;
exports.BRAIN_OUTBOX_WORKER_VERSION = "brain.outbox.worker.v1";
function asTrimmedString(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime()))
        return value.toISOString();
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function asNumberOrNull(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value.trim());
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
function asOptionalStringOrNumber(value) {
    if (value === undefined || value === null || value === "")
        return null;
    if (typeof value === "string" || typeof value === "number")
        return value;
    return null;
}
function asPositiveInteger(value, fallback, max = fallback) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return fallback;
    const normalized = Math.floor(value);
    if (normalized <= 0)
        return fallback;
    return Math.min(normalized, max);
}
function getOutboxWorkerEnabled() {
    return process.env.BRAIN_OUTBOX_WORKER_ENABLED?.trim() === "true";
}
function getOutboxWorkerAllowRealSend() {
    return process.env.BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND?.trim() === "true";
}
function getOutboxWorkerBatchSize() {
    return asPositiveInteger(process.env.BRAIN_OUTBOX_WORKER_BATCH_SIZE ? Number(process.env.BRAIN_OUTBOX_WORKER_BATCH_SIZE) : NaN, exports.DEFAULT_OUTBOX_WORKER_BATCH_SIZE, 100);
}
function getOutboxWorkerLockSeconds() {
    return asPositiveInteger(process.env.BRAIN_OUTBOX_WORKER_LOCK_SECONDS ? Number(process.env.BRAIN_OUTBOX_WORKER_LOCK_SECONDS) : NaN, exports.DEFAULT_OUTBOX_WORKER_LOCK_SECONDS, 3600);
}
function normalizeLimit(limit, batchSize) {
    if (typeof limit !== "number" || !Number.isFinite(limit))
        return batchSize;
    const normalized = Math.floor(limit);
    if (normalized <= 0)
        return batchSize;
    return Math.min(normalized, batchSize);
}
function compactWarnings(items) {
    return items.filter((item) => typeof item === "string" && item.length > 0);
}
function normalizeOutboxId(value) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0)
        return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value.trim());
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
}
function getPersistCanonicalOutboundEnabled() {
    return process.env[outboundMessages_1.BRAIN_PERSIST_CANONICAL_OUTBOUND_FLAG]?.trim() === "true";
}
function getUpdateCaseAfterBackendSendEnabled() {
    return process.env[caseUpdates_1.BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND_FLAG]?.trim() === "true";
}
function extractMetaEquivalentMessageId(responseBody) {
    if (!responseBody || typeof responseBody !== "object" || Array.isArray(responseBody))
        return null;
    const body = responseBody;
    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0)
        return null;
    const firstMessage = messages[0];
    if (!firstMessage || typeof firstMessage !== "object" || Array.isArray(firstMessage))
        return null;
    const message = firstMessage;
    return asTrimmedString(message.id) ?? asTrimmedString(message.message_id) ?? null;
}
function buildNotes(enabled, dryRun, lockOnly, allowRealSend, selectedCount, staleLockedCount, sendLocked = false, sentCount = 0, failedCount = 0) {
    const notes = [
        "Real locking is enabled and controlled sendLocked remains gated by flags in P1I-006.",
        "No automatic polling or cron is introduced by this endpoint."
    ];
    if (!enabled)
        notes.unshift("Outbox worker is disabled by default.");
    if (dryRun)
        notes.push("dryRun=true returns candidate summaries and planned transitions only.");
    if (lockOnly)
        notes.push("lockOnly=true locks planned rows transactionally and stops before any send step.");
    if (sendLocked)
        notes.push("sendLocked=true processes locked rows only and transitions through sending -> sent/failed.");
    if (!allowRealSend)
        notes.push("Real send path remains disabled by flag.");
    if (selectedCount === 0)
        notes.push("No planned outbox candidates were selected.");
    if (staleLockedCount > 0)
        notes.push(`${staleLockedCount} stale locked record(s) were detected and reported only.`);
    if (sendLocked && sentCount > 0)
        notes.push(`${sentCount} record(s) sent successfully.`);
    if (sendLocked && failedCount > 0)
        notes.push(`${failedCount} record(s) failed during Meta send.`);
    return notes;
}
function buildBlockedReasons(...groups) {
    const reasons = new Set();
    for (const group of groups) {
        for (const reason of group ?? []) {
            if (typeof reason === "string" && reason.trim())
                reasons.add(reason);
        }
    }
    return [...reasons];
}
function buildCandidateSummary(row, debug, staleLocked = false) {
    return {
        id: typeof row.id === "number" ? row.id : Number(row.id ?? 0) || null,
        dedupe_key: asTrimmedString(row.dedupe_key) ?? "",
        status: asTrimmedString(row.status) ?? "planned",
        source: asTrimmedString(row.source),
        wa_id: asTrimmedString(row.wa_id),
        phone_number_id: asTrimmedString(row.phone_number_id),
        conversation_case_id: asOptionalStringOrNumber(row.conversation_case_id),
        message_text_preview: debug ? asTrimmedString(row.message_text_preview) : null,
        message_text_length: asNumberOrNull(row.message_text_length),
        planned_at: asTrimmedString(row.planned_at),
        locked_at: asTrimmedString(row.locked_at),
        failed_at: asTrimmedString(row.failed_at),
        created_at: asTrimmedString(row.created_at),
        updated_at: asTrimmedString(row.updated_at),
        stale_locked: staleLocked
    };
}
function asJsonRecord(value) {
    if (value && typeof value === "object" && !Array.isArray(value))
        return value;
    if (typeof value !== "string" || !value.trim())
        return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
function toLockedSendRow(row, staleLocked = false) {
    return {
        id: typeof row.id === "number" ? row.id : Number(row.id ?? 0) || null,
        dedupe_key: asTrimmedString(row.dedupe_key) ?? "",
        status: asTrimmedString(row.status) ?? "locked",
        source: asTrimmedString(row.source),
        wa_id: asTrimmedString(row.wa_id),
        phone_number_id: asTrimmedString(row.phone_number_id),
        conversation_case_id: asOptionalStringOrNumber(row.conversation_case_id),
        message_text: asTrimmedString(row.message_text),
        meta_payload_json: asJsonRecord(row.meta_payload_json),
        provider_message_id: asTrimmedString(row.provider_message_id),
        error_code: asTrimmedString(row.error_code),
        error_message: asTrimmedString(row.error_message),
        planned_at: asTrimmedString(row.planned_at),
        locked_at: asTrimmedString(row.locked_at),
        sent_at: asTrimmedString(row.sent_at),
        failed_at: asTrimmedString(row.failed_at),
        created_at: asTrimmedString(row.created_at),
        updated_at: asTrimmedString(row.updated_at),
        stale_locked: staleLocked
    };
}
function buildLockedSendQuery(debug, outboxId) {
    return `
    SELECT
      id,
      dedupe_key,
      status,
      source,
      wa_id,
      phone_number_id,
      conversation_case_id,
      message_text,
      meta_payload_json,
      provider_message_id,
      error_code,
      error_message,
      planned_at,
      locked_at,
      sent_at,
      failed_at,
      created_at,
      updated_at,
      ${debug ? "LEFT(COALESCE(message_text, ''), 160)" : "NULL"} AS message_text_preview,
      CHAR_LENGTH(COALESCE(message_text, '')) AS message_text_length
    FROM \`${outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE}\`
    WHERE status = 'locked'
      ${typeof outboxId === "number" ? "AND id = ?" : ""}
    ORDER BY locked_at ASC, id ASC
    LIMIT ?
  `;
}
async function selectLockedOutboxCandidates(limit, debug = false, outboxId, lockSeconds = exports.DEFAULT_OUTBOX_WORKER_LOCK_SECONDS) {
    if (!(await brainOutboxTableExists())) {
        return { ok: false, candidates: [], warning: `Tabla ${outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE} no disponible` };
    }
    const params = [];
    if (typeof outboxId === "number")
        params.push(outboxId);
    params.push(limit);
    const rows = await (0, db_1.safeQueryRows)(buildLockedSendQuery(debug, outboxId), params);
    if (!rows.ok) {
        return { ok: false, candidates: [], warning: rows.error };
    }
    return {
        ok: true,
        candidates: rows.rows.map((row) => toLockedSendRow(row, isStaleLockedTimestamp(asTrimmedString(row.locked_at), lockSeconds)))
    };
}
async function selectOutboxById(outboxId, lockSeconds = exports.DEFAULT_OUTBOX_WORKER_LOCK_SECONDS) {
    if (!(await brainOutboxTableExists())) {
        return { ok: false, row: null, warning: `Tabla ${outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE} no disponible` };
    }
    const rows = await (0, db_1.safeQueryRows)(`SELECT id, dedupe_key, status, source, wa_id, phone_number_id, conversation_case_id, message_text, meta_payload_json, provider_message_id, error_code, error_message, planned_at, locked_at, sent_at, failed_at, created_at, updated_at FROM \`${outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE id = ? LIMIT 1`, [outboxId]);
    if (!rows.ok) {
        return { ok: false, row: null, warning: rows.error };
    }
    return {
        ok: true,
        row: rows.rows[0] ? toLockedSendRow(rows.rows[0], isStaleLockedTimestamp(asTrimmedString(rows.rows[0].locked_at), lockSeconds)) : null
    };
}
function buildSendLockedRecord(row, providerMessageId, sentAt, canonicalPersistResult, caseUpdateResult) {
    return {
        outbox_id: row.id,
        previous_status: "sending",
        status: "sent",
        dedupe_key: row.dedupe_key,
        provider_message_id: providerMessageId,
        sent_at: sentAt,
        error_code: null,
        error_message: null,
        stale_locked: row.stale_locked,
        canonical_persist_result: canonicalPersistResult ?? null,
        case_update_result: caseUpdateResult ?? null
    };
}
function buildFailedLockedRecord(row, previousStatus, providerMessageId, sentAt, failedAt, errorCode, errorMessage) {
    return {
        outbox_id: row.id,
        previous_status: previousStatus,
        status: "failed",
        dedupe_key: row.dedupe_key,
        provider_message_id: providerMessageId,
        sent_at: sentAt,
        failed_at: failedAt,
        error_code: errorCode,
        error_message: errorMessage,
        stale_locked: row.stale_locked
    };
}
function buildSkippedLockedSendRecord(row, reason) {
    return {
        id: row.id,
        previous_status: row.status,
        status: row.status,
        dedupe_key: row.dedupe_key,
        reason,
        stale_locked: row.stale_locked
    };
}
function toLockedSendCandidateSummary(row, debug) {
    return buildCandidateSummary({
        id: row.id,
        dedupe_key: row.dedupe_key,
        status: row.status,
        source: row.source,
        wa_id: row.wa_id,
        phone_number_id: row.phone_number_id,
        conversation_case_id: row.conversation_case_id,
        message_text_preview: debug ? row.message_text : null,
        message_text_length: row.message_text ? row.message_text.length : null,
        planned_at: row.planned_at,
        locked_at: row.locked_at,
        failed_at: row.failed_at,
        created_at: row.created_at,
        updated_at: row.updated_at
    }, debug, row.stale_locked);
}
async function transitionLockedSendRow(input) {
    const debug = input.debug ?? false;
    return (0, db_1.withConnection)(async (connection) => {
        await connection.beginTransaction();
        try {
            const setFragments = ["status = ?", "updated_at = NOW()"];
            const params = [input.nextStatus];
            if (input.nextStatus === "sending") {
                setFragments.push("provider_message_id = NULL", "error_code = NULL", "error_message = NULL");
                setFragments.push("sent_at = NULL", "failed_at = NULL");
            }
            else if (input.nextStatus === "sent") {
                setFragments.push("provider_message_id = ?", "error_code = NULL", "error_message = NULL");
                setFragments.push("sent_at = NOW()", "failed_at = NULL");
                params.push(input.providerMessageId ?? null);
            }
            else {
                setFragments.push("provider_message_id = ?", "error_code = ?", "error_message = ?");
                setFragments.push("sent_at = NULL", "failed_at = NOW()");
                params.push(input.providerMessageId ?? null, input.errorCode ?? null, input.errorMessage ?? null);
            }
            const [updateResult] = await connection.execute(`UPDATE \`${outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE}\` SET ${setFragments.join(", ")} WHERE id = ? AND status = ?`, [...params, input.row.id, input.expectedStatus]);
            if (updateResult.affectedRows === 0) {
                const [currentRows] = await connection.execute(`SELECT id, status, locked_at, sent_at, failed_at, provider_message_id, error_code, error_message, dedupe_key FROM \`${outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE id = ? LIMIT 1`, [input.row.id]);
                const currentRow = (currentRows[0] ?? {});
                const currentStatus = asTrimmedString(currentRow.status) ?? input.row.status;
                const currentLockedAt = asTrimmedString(currentRow.locked_at);
                const transition = (0, outboxTransitions_1.transitionOutboxStatus)({
                    outboxId: input.row.id,
                    dedupeKey: input.row.dedupe_key,
                    fromStatus: input.row.status,
                    toStatus: input.nextStatus,
                    simulated: false,
                    applied: false,
                    reason: input.reason ?? "update_skipped",
                    lockedAt: currentLockedAt,
                    failedAt: asTrimmedString(currentRow.failed_at),
                    warnings: [currentStatus !== input.expectedStatus ? `Outbox row is ${currentStatus} and was not updated.` : "Outbox row was not updated."],
                    metadata: {
                        debug,
                        current_status: currentStatus,
                        expected_status: input.expectedStatus
                    }
                });
                await connection.rollback();
                return { ok: false, row: null, transition, warning: "outbox_update_skipped" };
            }
            const [rows] = await connection.execute(`SELECT id, dedupe_key, status, source, wa_id, phone_number_id, conversation_case_id, message_text, meta_payload_json, provider_message_id, error_code, error_message, planned_at, locked_at, sent_at, failed_at, created_at, updated_at FROM \`${outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE id = ? LIMIT 1`, [input.row.id]);
            const currentRow = (rows[0] ?? {});
            const updatedRow = toLockedSendRow(currentRow, isStaleLockedTimestamp(asTrimmedString(currentRow.locked_at), getOutboxWorkerLockSeconds()));
            const transition = (0, outboxTransitions_1.transitionOutboxStatus)({
                outboxId: updatedRow.id,
                dedupeKey: updatedRow.dedupe_key,
                fromStatus: input.row.status,
                toStatus: input.nextStatus,
                simulated: false,
                applied: true,
                reason: input.reason ?? input.nextStatus,
                lockedAt: updatedRow.locked_at,
                failedAt: updatedRow.failed_at,
                warnings: debug ? [`Outbox row transitioned to ${input.nextStatus}.`] : [],
                metadata: {
                    debug,
                    provider_message_id: updatedRow.provider_message_id,
                    error_code: updatedRow.error_code,
                    error_message: updatedRow.error_message
                }
            });
            await connection.commit();
            return { ok: true, row: updatedRow, transition };
        }
        catch (error) {
            try {
                await connection.rollback();
            }
            catch {
                // ignore rollback failures
            }
            const transition = (0, outboxTransitions_1.transitionOutboxStatus)({
                outboxId: input.row.id,
                dedupeKey: input.row.dedupe_key,
                fromStatus: input.row.status,
                toStatus: input.nextStatus,
                simulated: false,
                applied: false,
                reason: input.reason ?? "update_failed",
                warnings: [error instanceof Error ? error.message : String(error)],
                metadata: {
                    debug
                }
            });
            return { ok: false, row: null, transition, warning: error instanceof Error ? error.message : String(error) };
        }
    });
}
async function sendLockedOutboxRecord(row, input) {
    const debug = input?.debug ?? false;
    const warnings = [];
    const transitions = [];
    const waId = row.wa_id?.trim() ?? "";
    const phoneNumberId = row.phone_number_id?.trim() ?? "";
    const messageText = row.message_text?.trim() ?? "";
    if (!waId || !phoneNumberId || !messageText) {
        const invalidPayloadTransition = await transitionLockedSendRow({
            row,
            nextStatus: "failed",
            expectedStatus: "locked",
            debug,
            errorCode: "invalid_payload",
            errorMessage: "locked record missing wa_id, phone_number_id or message_text.",
            reason: "invalid_payload"
        });
        transitions.push(invalidPayloadTransition.transition);
        if (!invalidPayloadTransition.ok || !invalidPayloadTransition.row) {
            return {
                ok: false,
                skippedRecord: buildSkippedLockedSendRecord(row, "invalid_payload"),
                transitions,
                warnings: compactWarnings([...warnings, invalidPayloadTransition.warning, ...(invalidPayloadTransition.transition.warnings ?? [])])
            };
        }
        return {
            ok: false,
            failedRecord: buildFailedLockedRecord(invalidPayloadTransition.row, "locked", null, null, invalidPayloadTransition.row.failed_at, "invalid_payload", "locked record missing wa_id, phone_number_id or message_text."),
            transitions,
            warnings: compactWarnings([...warnings, ...(invalidPayloadTransition.transition.warnings ?? [])])
        };
    }
    if (row.status !== "locked") {
        const skippedRecord = buildSkippedLockedSendRecord(row, "not_locked");
        return {
            ok: false,
            skippedRecord,
            transitions,
            warnings: [`Locked send requires status=locked, received ${row.status}.`]
        };
    }
    const sendingTransition = await transitionLockedSendRow({
        row,
        nextStatus: "sending",
        expectedStatus: "locked",
        debug,
        reason: "send_locked"
    });
    transitions.push(sendingTransition.transition);
    if (!sendingTransition.ok || !sendingTransition.row) {
        return {
            ok: false,
            skippedRecord: buildSkippedLockedSendRecord(row, "sending_transition_failed"),
            transitions,
            warnings: compactWarnings([...warnings, sendingTransition.warning, ...(sendingTransition.transition.warnings ?? [])])
        };
    }
    const payloadPreview = (0, metaPayload_1.buildMetaWhatsAppTextPayloadPreview)({ waId, messageText });
    if (debug && row.meta_payload_json && row.meta_payload_json["messaging_product"] !== "whatsapp") {
        warnings.push("meta_payload_json was ignored and payload was reconstructed from persisted fields.");
    }
    const metaResponse = await (0, metaClient_1.sendMetaWhatsAppTextMessage)({
        waId,
        phoneNumberId,
        messageText,
        timeoutMs: 8000,
        source: "operator",
        sourceRequestId: row.dedupe_key,
        conversationCaseId: row.conversation_case_id,
        metadata: {
            outbox_id: row.id,
            dedupe_key: row.dedupe_key,
            worker: "brain.outbox.worker",
            stale_locked: row.stale_locked,
            message_preview: debug ? payloadPreview : undefined
        }
    });
    if (metaResponse.ok && metaResponse.status === "sent") {
        const providerMessageId = metaResponse.provider_message_id ?? extractMetaEquivalentMessageId(metaResponse.response_body);
        const finalize = await transitionLockedSendRow({
            row: sendingTransition.row,
            nextStatus: "sent",
            expectedStatus: "sending",
            debug,
            providerMessageId: providerMessageId ?? null,
            reason: "meta_sent"
        });
        transitions.push(finalize.transition);
        if (!finalize.ok || !finalize.row) {
            return {
                ok: false,
                failedRecord: buildFailedLockedRecord(sendingTransition.row, "sending", providerMessageId, null, null, "finalize_failed", finalize.warning ?? null),
                transitions,
                warnings: compactWarnings([...warnings, finalize.warning, ...(finalize.transition.warnings ?? [])])
            };
        }
        const canonicalPersistResult = await (0, outboundMessages_1.persistCanonicalOutboundMessage)({
            enabled: getPersistCanonicalOutboundEnabled(),
            outboxId: finalize.row.id,
            dedupeKey: finalize.row.dedupe_key,
            outboxStatus: finalize.row.status,
            conversationCaseId: finalize.row.conversation_case_id,
            waId: finalize.row.wa_id,
            phoneNumberId: finalize.row.phone_number_id,
            messageText: finalize.row.message_text,
            providerMessageId,
            sentAt: finalize.row.sent_at,
            debug
        });
        if (canonicalPersistResult.warning)
            warnings.push(canonicalPersistResult.warning);
        const caseUpdateResult = await (0, caseUpdates_1.updateCaseAfterBackendOutbound)({
            enabled: getUpdateCaseAfterBackendSendEnabled(),
            conversationCaseId: finalize.row.conversation_case_id,
            canonicalPersistResult,
            canonicalPersistenceEnabled: getPersistCanonicalOutboundEnabled(),
            canonicalMessageId: canonicalPersistResult.message_id,
            debug
        });
        if (caseUpdateResult.warning)
            warnings.push(caseUpdateResult.warning);
        return {
            ok: true,
            sentRecord: buildSendLockedRecord(finalize.row, providerMessageId, finalize.row.sent_at, canonicalPersistResult, caseUpdateResult),
            transitions,
            warnings
        };
    }
    const providerMessageId = metaResponse.provider_message_id ?? extractMetaEquivalentMessageId(metaResponse.response_body);
    const errorCode = metaResponse.error_code ?? "meta_http_error";
    const errorMessage = metaResponse.error_message ?? "Meta send failed.";
    const finalize = await transitionLockedSendRow({
        row: sendingTransition.row,
        nextStatus: "failed",
        expectedStatus: "sending",
        debug,
        providerMessageId: providerMessageId ?? null,
        errorCode,
        errorMessage,
        reason: "meta_failed"
    });
    transitions.push(finalize.transition);
    if (!finalize.ok || !finalize.row) {
        return {
            ok: false,
            failedRecord: buildFailedLockedRecord(sendingTransition.row, "sending", metaResponse.provider_message_id ?? null, null, null, errorCode, `${errorMessage} (finalize_failed: ${finalize.warning ?? "unknown"})`),
            transitions,
            warnings: compactWarnings([...warnings, finalize.warning, ...(finalize.transition.warnings ?? [])])
        };
    }
    return {
        ok: false,
        failedRecord: buildFailedLockedRecord(finalize.row, "sending", providerMessageId, finalize.row.sent_at, finalize.row.failed_at, errorCode, errorMessage),
        transitions,
        warnings: compactWarnings([...warnings, ...(metaResponse.warnings ?? [])])
    };
}
function buildDisabledPlan(limit, batchSize, lockSeconds) {
    return {
        mode: "disabled",
        enabled: false,
        allowRealSend: false,
        dryRun: true,
        lockOnly: false,
        debug: false,
        limit,
        batchSize,
        lockSeconds,
        candidateCount: 0,
        lockedCount: 0,
        skippedCount: 0,
        selectedCount: 0,
        candidates: [],
        lockedRecords: [],
        skippedRecords: [],
        transitionResults: [],
        blocked_reasons: ["worker_disabled"],
        warnings: ["BRAIN_OUTBOX_WORKER_ENABLED=false"],
        notes: buildNotes(false, true, false, false, 0, 0)
    };
}
function buildWorkerPlan(input) {
    const candidateCount = input.candidates.length;
    const lockedCount = input.lockedRecords.length;
    const skippedCount = input.skippedRecords.length;
    const sentCount = input.sentRecords?.length ?? 0;
    const failedCount = input.failedRecords?.length ?? 0;
    return {
        mode: input.mode ?? (input.enabled
            ? input.dryRun
                ? "dry_run"
                : input.sendLocked
                    ? "send_locked"
                    : input.lockOnly
                        ? "lock_only"
                        : candidateCount > 0
                            ? "blocked"
                            : "noop"
            : "disabled"),
        enabled: input.enabled,
        allowRealSend: input.allowRealSend,
        dryRun: input.dryRun,
        lockOnly: input.lockOnly,
        sendLocked: input.sendLocked,
        outboxId: input.outboxId,
        debug: input.debug,
        limit: input.limit,
        batchSize: input.batchSize,
        lockSeconds: input.lockSeconds,
        candidateCount,
        lockedCount,
        skippedCount,
        selectedCount: candidateCount,
        sentCount,
        failedCount,
        candidates: input.candidates,
        lockedRecords: input.lockedRecords,
        skippedRecords: input.skippedRecords,
        sentRecords: input.sentRecords ?? [],
        failedRecords: input.failedRecords ?? [],
        transitionResults: input.transitionResults,
        blocked_reasons: input.blockedReasons ?? [],
        warnings: input.warnings ?? [],
        notes: input.notes ??
            buildNotes(input.enabled, input.dryRun, input.lockOnly, input.allowRealSend, candidateCount, skippedCount, input.sendLocked ?? false, sentCount, failedCount)
    };
}
function buildWorkerResponse(input) {
    return {
        ok: input.ok,
        disabled: input.disabled,
        status: input.status,
        reason: input.reason ?? null,
        dryRun: input.dryRun,
        lockOnly: input.lockOnly,
        sendLocked: input.sendLocked ?? false,
        debug: input.debug,
        locked_count: input.lockedCount,
        sent_count: input.sentCount ?? 0,
        failed_count: input.failedCount ?? 0,
        skipped_count: input.skippedCount,
        candidates: input.candidates,
        locked_records: input.lockedRecords,
        skipped_records: input.skippedRecords,
        sent_records: input.sentRecords ?? [],
        failed_records: input.failedRecords ?? [],
        error_code: input.errorCode ?? null,
        error_message: input.errorMessage ?? null,
        blocked_reasons: input.blockedReasons ?? [],
        warnings: input.warnings ?? [],
        plan: input.plan,
        metadata: {
            version: exports.BRAIN_OUTBOX_WORKER_VERSION,
            generatedAt: new Date().toISOString(),
            processingMs: input.processingMs,
            enabled: input.enabled,
            allowRealSend: input.allowRealSend,
            dryRun: input.dryRun,
            lockOnly: input.lockOnly,
            sendLocked: input.sendLocked ?? false,
            debug: input.debug,
            limit: input.limit,
            batchSize: input.batchSize,
            lockSeconds: input.lockSeconds,
            outboxId: input.outboxId ?? null
        }
    };
}
async function brainOutboxTableExists() {
    const rows = await (0, db_1.safeQueryRows)("SELECT 1 AS table_exists FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1", [outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE]);
    return rows.ok && rows.rows.length > 0;
}
function isStaleLockedTimestamp(lockedAt, lockSeconds) {
    if (!lockedAt)
        return false;
    const lockedAtMs = Date.parse(lockedAt);
    if (!Number.isFinite(lockedAtMs))
        return false;
    return Date.now() - lockedAtMs > lockSeconds * 1000;
}
function buildCandidateQuery(debug) {
    return `
    SELECT
      id,
      dedupe_key,
      status,
      source,
      wa_id,
      phone_number_id,
      conversation_case_id,
      ${debug ? "LEFT(COALESCE(message_text, ''), 160)" : "NULL"} AS message_text_preview,
      CHAR_LENGTH(COALESCE(message_text, '')) AS message_text_length,
      planned_at,
      locked_at,
      failed_at,
      created_at,
      updated_at
    FROM \`${outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE}\`
    WHERE status = 'planned'
    ORDER BY planned_at ASC, id ASC
    LIMIT ?
  `;
}
function buildStaleLockedQuery(debug) {
    return `
    SELECT
      id,
      dedupe_key,
      status,
      source,
      wa_id,
      phone_number_id,
      conversation_case_id,
      ${debug ? "LEFT(COALESCE(message_text, ''), 160)" : "NULL"} AS message_text_preview,
      CHAR_LENGTH(COALESCE(message_text, '')) AS message_text_length,
      planned_at,
      locked_at,
      failed_at,
      created_at,
      updated_at
    FROM \`${outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE}\`
    WHERE status = 'locked'
      AND locked_at IS NOT NULL
      AND locked_at < DATE_SUB(NOW(), INTERVAL ? SECOND)
    ORDER BY locked_at ASC, id ASC
    LIMIT ?
  `;
}
function toLockedRecord(candidate, lockedAt) {
    return {
        id: candidate.id,
        previous_status: "planned",
        status: "locked",
        dedupe_key: candidate.dedupe_key,
        locked_at: lockedAt
    };
}
function toSkippedRecord(candidate, reason, previousStatus = candidate.status) {
    return {
        id: candidate.id,
        previous_status: previousStatus,
        status: candidate.status,
        dedupe_key: candidate.dedupe_key,
        reason,
        stale_locked: candidate.stale_locked || reason === "stale_locked"
    };
}
async function selectPlannedOutboxCandidates(limit, debug = false) {
    if (!(await brainOutboxTableExists())) {
        return { ok: false, candidates: [], warning: `Tabla ${outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE} no disponible` };
    }
    const rows = await (0, db_1.safeQueryRows)(buildCandidateQuery(debug), [limit]);
    if (!rows.ok) {
        return { ok: false, candidates: [], warning: rows.error };
    }
    return {
        ok: true,
        candidates: rows.rows.map((row) => buildCandidateSummary(row, debug, false))
    };
}
async function selectStaleLockedOutboxCandidates(limit, lockSeconds, debug = false) {
    if (!(await brainOutboxTableExists())) {
        return { ok: false, candidates: [], warning: `Tabla ${outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE} no disponible` };
    }
    const rows = await (0, db_1.safeQueryRows)(buildStaleLockedQuery(debug), [lockSeconds, limit]);
    if (!rows.ok) {
        return { ok: false, candidates: [], warning: rows.error };
    }
    return {
        ok: true,
        candidates: rows.rows.map((row) => buildCandidateSummary(row, debug, true))
    };
}
async function lockOutboxRecord(candidate, input) {
    const debug = input?.debug ?? false;
    const dryRun = input?.dryRun ?? false;
    const lockSeconds = input?.lockSeconds ?? exports.DEFAULT_OUTBOX_WORKER_LOCK_SECONDS;
    if (dryRun) {
        return (0, outboxTransitions_1.transitionOutboxStatus)({
            outboxId: candidate.id,
            dedupeKey: candidate.dedupe_key,
            fromStatus: candidate.status,
            toStatus: "locked",
            simulated: true,
            applied: false,
            reason: input?.reason ?? "dry_run_only",
            warnings: ["Dry run only. No DB mutation applied."],
            metadata: {
                debug,
                dry_run: true,
                lock_seconds: lockSeconds
            }
        });
    }
    if (!candidate.id) {
        return (0, outboxTransitions_1.transitionOutboxStatus)({
            outboxId: null,
            dedupeKey: candidate.dedupe_key,
            fromStatus: candidate.status,
            toStatus: "locked",
            simulated: false,
            applied: false,
            reason: input?.reason ?? "missing_outbox_id",
            warnings: ["Outbox record is missing id."],
            metadata: {
                debug,
                dry_run: false,
                lock_seconds: lockSeconds
            }
        });
    }
    return (0, db_1.withConnection)(async (connection) => {
        await connection.beginTransaction();
        try {
            const [updateResult] = await connection.execute(`UPDATE \`${outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE}\`
         SET status = 'locked', locked_at = NOW(), updated_at = NOW()
         WHERE id = ? AND status = 'planned'`, [candidate.id]);
            if (updateResult.affectedRows === 0) {
                const [currentRows] = await connection.execute(`SELECT id, status, locked_at, dedupe_key FROM \`${outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE id = ? LIMIT 1`, [candidate.id]);
                const currentRow = (currentRows[0] ?? {});
                const currentStatus = asTrimmedString(currentRow.status) ?? candidate.status;
                const currentLockedAt = asTrimmedString(currentRow.locked_at);
                const staleLocked = currentStatus === "locked" && isStaleLockedTimestamp(currentLockedAt, lockSeconds);
                await connection.rollback();
                return (0, outboxTransitions_1.transitionOutboxStatus)({
                    outboxId: candidate.id,
                    dedupeKey: candidate.dedupe_key,
                    fromStatus: candidate.status,
                    toStatus: "locked",
                    simulated: false,
                    applied: false,
                    reason: staleLocked ? "stale_locked" : "already_locked",
                    lockedAt: currentLockedAt,
                    warnings: [staleLocked ? "Record is stale_locked and reported only." : "Record already locked."],
                    metadata: {
                        debug,
                        current_status: currentStatus,
                        stale_locked: staleLocked,
                        lock_seconds: lockSeconds
                    }
                });
            }
            const [lockedRows] = await connection.execute(`SELECT id, status, locked_at, dedupe_key FROM \`${outbox_1.BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE id = ? LIMIT 1`, [candidate.id]);
            const lockedRow = (lockedRows[0] ?? {});
            const lockedAt = asTrimmedString(lockedRow.locked_at);
            await connection.commit();
            return (0, outboxTransitions_1.transitionOutboxStatus)({
                outboxId: candidate.id,
                dedupeKey: candidate.dedupe_key,
                fromStatus: "planned",
                toStatus: "locked",
                simulated: false,
                applied: true,
                reason: "locked",
                lockedAt,
                warnings: debug ? ["Outbox row locked successfully."] : [],
                metadata: {
                    debug,
                    locked_at: lockedAt,
                    lock_seconds: lockSeconds
                }
            });
        }
        catch (error) {
            try {
                await connection.rollback();
            }
            catch {
                // ignore rollback failures in skeleton worker
            }
            return (0, outboxTransitions_1.transitionOutboxStatus)({
                outboxId: candidate.id,
                dedupeKey: candidate.dedupe_key,
                fromStatus: candidate.status,
                toStatus: "locked",
                simulated: false,
                applied: false,
                reason: "lock_failed",
                warnings: [error instanceof Error ? error.message : String(error)],
                metadata: {
                    debug,
                    lock_seconds: lockSeconds
                }
            });
        }
    });
}
async function lockOutboxBatch(input) {
    const lockedRecords = [];
    const skippedRecords = [];
    const transitionResults = [];
    const warnings = [];
    const debug = input.debug ?? false;
    for (const staleCandidate of input.staleLockedCandidates) {
        skippedRecords.push(toSkippedRecord(staleCandidate, "stale_locked", "locked"));
    }
    for (const candidate of input.candidates) {
        const result = await lockOutboxRecord(candidate, {
            debug,
            dryRun: false,
            lockSeconds: input.lockSeconds,
            reason: "lock_only"
        });
        transitionResults.push(result);
        if (result.applied && result.allowed) {
            lockedRecords.push(toLockedRecord(candidate, result.locked_at ?? null));
            continue;
        }
        skippedRecords.push(toSkippedRecord(candidate, result.reason === "stale_locked" ? "stale_locked" : "already_locked", candidate.status));
        if (result.warnings.length > 0)
            warnings.push(...result.warnings);
    }
    return {
        lockedRecords,
        skippedRecords,
        transitionResults,
        warnings: [...new Set(warnings)]
    };
}
async function planOutboxWorkerRun(request) {
    const startedAt = Date.now();
    const enabled = getOutboxWorkerEnabled();
    const allowRealSend = getOutboxWorkerAllowRealSend();
    const metaSendEnabled = process.env.BRAIN_META_SEND_ENABLED?.trim() === "true";
    const batchSize = getOutboxWorkerBatchSize();
    const lockSeconds = getOutboxWorkerLockSeconds();
    const lockOnly = request.lockOnly ?? false;
    const sendLocked = request.sendLocked ?? false;
    const outboxId = normalizeOutboxId(request.outboxId);
    const dryRun = request.dryRun ?? !lockOnly;
    const debug = request.debug ?? false;
    const limit = normalizeLimit(request.limit, batchSize);
    if (!enabled) {
        const plan = buildDisabledPlan(limit, batchSize, lockSeconds);
        return buildWorkerResponse({
            ok: false,
            disabled: true,
            status: "disabled",
            reason: "worker_disabled",
            errorCode: "disabled",
            errorMessage: "BRAIN_OUTBOX_WORKER_ENABLED=false",
            blockedReasons: ["worker_disabled"],
            warnings: ["Outbox worker is disabled by default."],
            plan,
            enabled,
            allowRealSend,
            dryRun,
            lockOnly,
            debug,
            limit,
            batchSize,
            lockSeconds,
            lockedCount: 0,
            skippedCount: 0,
            candidates: [],
            lockedRecords: [],
            skippedRecords: [],
            processingMs: Date.now() - startedAt
        });
    }
    if (sendLocked) {
        if (!allowRealSend || !metaSendEnabled) {
            const plan = buildWorkerPlan({
                enabled,
                allowRealSend,
                dryRun,
                lockOnly,
                sendLocked: true,
                outboxId,
                debug,
                limit,
                batchSize,
                lockSeconds,
                candidates: [],
                lockedRecords: [],
                skippedRecords: [],
                sentRecords: [],
                failedRecords: [],
                transitionResults: [],
                blockedReasons: ["real_send_disabled"],
                warnings: ["sendLocked=true requires BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND=true and BRAIN_META_SEND_ENABLED=true."],
                notes: buildNotes(enabled, dryRun, lockOnly, allowRealSend, 0, 0, true, 0, 0),
                mode: "blocked"
            });
            return buildWorkerResponse({
                ok: false,
                disabled: true,
                status: "disabled",
                reason: "real_send_disabled",
                errorCode: "real_send_disabled",
                errorMessage: "Real send is disabled until both flags are enabled.",
                blockedReasons: plan.blocked_reasons,
                warnings: plan.warnings,
                plan,
                enabled,
                allowRealSend,
                dryRun,
                lockOnly,
                sendLocked: true,
                debug,
                limit,
                batchSize,
                lockSeconds,
                outboxId,
                lockedCount: 0,
                sentCount: 0,
                failedCount: 0,
                skippedCount: 0,
                candidates: [],
                lockedRecords: [],
                skippedRecords: [],
                sentRecords: [],
                failedRecords: [],
                processingMs: Date.now() - startedAt
            });
        }
        if (dryRun || lockOnly) {
            const plan = buildWorkerPlan({
                enabled,
                allowRealSend,
                dryRun,
                lockOnly,
                sendLocked: true,
                outboxId,
                debug,
                limit,
                batchSize,
                lockSeconds,
                candidates: [],
                lockedRecords: [],
                skippedRecords: [],
                sentRecords: [],
                failedRecords: [],
                transitionResults: [],
                blockedReasons: ["invalid_send_request"],
                warnings: ["sendLocked=true requires dryRun=false and lockOnly=false."],
                notes: buildNotes(enabled, dryRun, lockOnly, allowRealSend, 0, 0, true, 0, 0),
                mode: "blocked"
            });
            return buildWorkerResponse({
                ok: false,
                disabled: false,
                status: "blocked",
                reason: "invalid_send_request",
                errorCode: "invalid_send_request",
                errorMessage: "sendLocked=true requires dryRun=false and lockOnly=false.",
                blockedReasons: plan.blocked_reasons,
                warnings: plan.warnings,
                plan,
                enabled,
                allowRealSend,
                dryRun,
                lockOnly,
                sendLocked: true,
                debug,
                limit,
                batchSize,
                lockSeconds,
                outboxId,
                lockedCount: 0,
                sentCount: 0,
                failedCount: 0,
                skippedCount: 0,
                candidates: [],
                lockedRecords: [],
                skippedRecords: [],
                sentRecords: [],
                failedRecords: [],
                processingMs: Date.now() - startedAt
            });
        }
        const lockedSelection = outboxId !== null
            ? await selectOutboxById(outboxId, lockSeconds)
            : await selectLockedOutboxCandidates(limit, debug, undefined, lockSeconds);
        if (!lockedSelection.ok) {
            const plan = buildWorkerPlan({
                enabled,
                allowRealSend,
                dryRun,
                lockOnly,
                sendLocked: true,
                outboxId,
                debug,
                limit,
                batchSize,
                lockSeconds,
                candidates: [],
                lockedRecords: [],
                skippedRecords: [],
                sentRecords: [],
                failedRecords: [],
                transitionResults: [],
                blockedReasons: ["locked_lookup_failed"],
                warnings: [lockedSelection.warning],
                notes: buildNotes(enabled, dryRun, lockOnly, allowRealSend, 0, 0, true, 0, 0),
                mode: "failed"
            });
            return buildWorkerResponse({
                ok: false,
                disabled: false,
                status: "failed",
                reason: "locked_lookup_failed",
                errorCode: "failed",
                errorMessage: lockedSelection.warning,
                blockedReasons: plan.blocked_reasons,
                warnings: plan.warnings,
                plan,
                enabled,
                allowRealSend,
                dryRun,
                lockOnly,
                sendLocked: true,
                debug,
                limit,
                batchSize,
                lockSeconds,
                outboxId,
                lockedCount: 0,
                sentCount: 0,
                failedCount: 0,
                skippedCount: 0,
                candidates: [],
                lockedRecords: [],
                skippedRecords: [],
                sentRecords: [],
                failedRecords: [],
                processingMs: Date.now() - startedAt
            });
        }
        let lockedRows = [];
        if (outboxId !== null) {
            const lockedSelectionById = lockedSelection;
            const currentRow = lockedSelectionById.row;
            if (!currentRow || currentRow.status !== "locked") {
                const skippedRecord = currentRow
                    ? buildSkippedLockedSendRecord(currentRow, currentRow.status === "locked" ? "not_sendable" : `status_${currentRow.status}`)
                    : {
                        id: outboxId,
                        previous_status: "planned",
                        status: "planned",
                        dedupe_key: String(outboxId),
                        reason: "not_found",
                        stale_locked: false
                    };
                const plan = buildWorkerPlan({
                    enabled,
                    allowRealSend,
                    dryRun,
                    lockOnly,
                    sendLocked: true,
                    outboxId,
                    debug,
                    limit,
                    batchSize,
                    lockSeconds,
                    candidates: [],
                    lockedRecords: [],
                    skippedRecords: [skippedRecord],
                    sentRecords: [],
                    failedRecords: [],
                    transitionResults: [],
                    blockedReasons: ["outbox_not_locked"],
                    warnings: ["Requested outboxId is not locked or does not exist."],
                    notes: buildNotes(enabled, dryRun, lockOnly, allowRealSend, 0, 0, true, 0, 0),
                    mode: "blocked"
                });
                return buildWorkerResponse({
                    ok: false,
                    disabled: false,
                    status: "blocked",
                    reason: "outbox_not_locked",
                    errorCode: "blocked",
                    errorMessage: "Requested outboxId is not locked or does not exist.",
                    blockedReasons: plan.blocked_reasons,
                    warnings: plan.warnings,
                    plan,
                    enabled,
                    allowRealSend,
                    dryRun,
                    lockOnly,
                    sendLocked: true,
                    debug,
                    limit,
                    batchSize,
                    lockSeconds,
                    outboxId,
                    lockedCount: 0,
                    sentCount: 0,
                    failedCount: 0,
                    skippedCount: 1,
                    candidates: [],
                    lockedRecords: [],
                    skippedRecords: plan.skippedRecords,
                    sentRecords: [],
                    failedRecords: [],
                    processingMs: Date.now() - startedAt
                });
            }
            lockedRows = [currentRow];
        }
        else {
            const lockedSelectionBatch = lockedSelection;
            lockedRows = lockedSelectionBatch.candidates;
        }
        const lockedCandidates = lockedRows.map((row) => toLockedSendCandidateSummary(row, debug));
        const staleLockedCount = lockedCandidates.filter((candidate) => candidate.stale_locked).length;
        const sentRecords = [];
        const failedRecords = [];
        const skippedRecords = [];
        const transitionResults = [];
        const warnings = [];
        if (staleLockedCount > 0) {
            warnings.push(`${staleLockedCount} locked record(s) are stale_locked; sendLocked will process them manually.`);
        }
        for (const row of lockedRows) {
            const sendResult = await sendLockedOutboxRecord(row, { debug });
            transitionResults.push(...sendResult.transitions);
            warnings.push(...sendResult.warnings);
            if (sendResult.sentRecord) {
                sentRecords.push(sendResult.sentRecord);
            }
            if (sendResult.failedRecord) {
                failedRecords.push(sendResult.failedRecord);
            }
            if (sendResult.skippedRecord) {
                skippedRecords.push(sendResult.skippedRecord);
            }
        }
        const plan = buildWorkerPlan({
            enabled,
            allowRealSend,
            dryRun: false,
            lockOnly: false,
            sendLocked: true,
            outboxId,
            debug,
            limit,
            batchSize,
            lockSeconds,
            candidates: lockedCandidates,
            lockedRecords: [],
            skippedRecords,
            sentRecords,
            failedRecords,
            transitionResults,
            blockedReasons: failedRecords.length > 0 && sentRecords.length === 0 ? ["meta_send_failed"] : [],
            warnings: buildBlockedReasons(warnings),
            notes: buildNotes(enabled, false, false, allowRealSend, lockedCandidates.length, staleLockedCount, true, sentRecords.length, failedRecords.length),
            mode: sentRecords.length > 0 && failedRecords.length === 0 ? "send_locked" : failedRecords.length > 0 ? "failed" : "noop"
        });
        return buildWorkerResponse({
            ok: failedRecords.length === 0,
            disabled: false,
            status: failedRecords.length > 0 ? "failed" : sentRecords.length > 0 ? "sent" : "noop",
            reason: failedRecords.length > 0 ? "meta_send_failed" : sentRecords.length > 0 ? "sent" : "noop",
            errorCode: failedRecords.length > 0 ? "failed" : null,
            errorMessage: failedRecords.length > 0 ? "One or more locked records failed during Meta send." : null,
            blockedReasons: plan.blocked_reasons,
            warnings: plan.warnings,
            plan,
            enabled,
            allowRealSend,
            dryRun: false,
            lockOnly: false,
            sendLocked: true,
            debug,
            limit,
            batchSize,
            lockSeconds,
            outboxId,
            lockedCount: 0,
            sentCount: sentRecords.length,
            failedCount: failedRecords.length,
            skippedCount: skippedRecords.length,
            candidates: lockedCandidates,
            lockedRecords: [],
            skippedRecords,
            sentRecords,
            failedRecords,
            processingMs: Date.now() - startedAt
        });
    }
    const plannedSelection = await selectPlannedOutboxCandidates(limit, debug);
    if (!plannedSelection.ok) {
        const plan = buildWorkerPlan({
            enabled,
            allowRealSend,
            dryRun,
            lockOnly,
            debug,
            limit,
            batchSize,
            lockSeconds,
            candidates: [],
            lockedRecords: [],
            skippedRecords: [],
            transitionResults: [],
            blockedReasons: ["outbox_lookup_failed"],
            warnings: [plannedSelection.warning],
            notes: buildNotes(enabled, dryRun, lockOnly, allowRealSend, 0, 0),
            mode: "failed"
        });
        return buildWorkerResponse({
            ok: false,
            disabled: false,
            status: "failed",
            reason: "outbox_lookup_failed",
            errorCode: "failed",
            errorMessage: plannedSelection.warning,
            blockedReasons: plan.blocked_reasons,
            warnings: plan.warnings,
            plan,
            enabled,
            allowRealSend,
            dryRun,
            lockOnly,
            debug,
            limit,
            batchSize,
            lockSeconds,
            lockedCount: 0,
            skippedCount: 0,
            candidates: [],
            lockedRecords: [],
            skippedRecords: [],
            processingMs: Date.now() - startedAt
        });
    }
    const staleSelection = await selectStaleLockedOutboxCandidates(limit, lockSeconds, debug);
    if (!staleSelection.ok) {
        const plan = buildWorkerPlan({
            enabled,
            allowRealSend,
            dryRun,
            lockOnly,
            debug,
            limit,
            batchSize,
            lockSeconds,
            candidates: plannedSelection.candidates,
            lockedRecords: [],
            skippedRecords: [],
            transitionResults: [],
            blockedReasons: ["stale_lookup_failed"],
            warnings: [staleSelection.warning],
            notes: buildNotes(enabled, dryRun, lockOnly, allowRealSend, plannedSelection.candidates.length, 0),
            mode: "failed"
        });
        return buildWorkerResponse({
            ok: false,
            disabled: false,
            status: "failed",
            reason: "stale_lookup_failed",
            errorCode: "failed",
            errorMessage: staleSelection.warning,
            blockedReasons: plan.blocked_reasons,
            warnings: plan.warnings,
            plan,
            enabled,
            allowRealSend,
            dryRun,
            lockOnly,
            debug,
            limit,
            batchSize,
            lockSeconds,
            lockedCount: 0,
            skippedCount: 0,
            candidates: plannedSelection.candidates,
            lockedRecords: [],
            skippedRecords: [],
            processingMs: Date.now() - startedAt
        });
    }
    const staleLockedCandidates = staleSelection.candidates;
    if (dryRun) {
        const skippedRecords = staleLockedCandidates.map((candidate) => toSkippedRecord(candidate, "stale_locked", "locked"));
        const plan = buildWorkerPlan({
            enabled,
            allowRealSend,
            dryRun,
            lockOnly,
            debug,
            limit,
            batchSize,
            lockSeconds,
            candidates: plannedSelection.candidates,
            lockedRecords: [],
            skippedRecords,
            transitionResults: [],
            warnings: buildBlockedReasons(plannedSelection.warning ? [plannedSelection.warning] : undefined, staleSelection.warning ? [staleSelection.warning] : undefined),
            notes: buildNotes(enabled, dryRun, lockOnly, allowRealSend, plannedSelection.candidates.length, skippedRecords.length),
            mode: "dry_run"
        });
        return buildWorkerResponse({
            ok: true,
            disabled: false,
            status: plannedSelection.candidates.length > 0 ? "planned" : "noop",
            reason: "dry_run",
            lockedCount: 0,
            skippedCount: skippedRecords.length,
            candidates: plannedSelection.candidates,
            lockedRecords: [],
            skippedRecords,
            warnings: plan.warnings,
            plan,
            enabled,
            allowRealSend,
            dryRun,
            lockOnly,
            debug,
            limit,
            batchSize,
            lockSeconds,
            processingMs: Date.now() - startedAt
        });
    }
    if (!lockOnly) {
        const plan = buildWorkerPlan({
            enabled,
            allowRealSend,
            dryRun,
            lockOnly,
            debug,
            limit,
            batchSize,
            lockSeconds,
            candidates: plannedSelection.candidates,
            lockedRecords: [],
            skippedRecords: staleLockedCandidates.map((candidate) => toSkippedRecord(candidate, "stale_locked", "locked")),
            transitionResults: [],
            blockedReasons: ["lock_only_required"],
            warnings: ["dryRun=false requires lockOnly=true in this milestone."],
            notes: buildNotes(enabled, dryRun, lockOnly, allowRealSend, plannedSelection.candidates.length, staleLockedCandidates.length),
            mode: "blocked"
        });
        return buildWorkerResponse({
            ok: false,
            disabled: false,
            status: "blocked",
            reason: "lock_only_required",
            errorCode: "blocked",
            errorMessage: "lockOnly=true is required when dryRun=false in P1I-005.",
            blockedReasons: plan.blocked_reasons,
            warnings: plan.warnings,
            plan,
            enabled,
            allowRealSend,
            dryRun,
            lockOnly,
            debug,
            limit,
            batchSize,
            lockSeconds,
            lockedCount: 0,
            skippedCount: staleLockedCandidates.length,
            candidates: plannedSelection.candidates,
            lockedRecords: [],
            skippedRecords: plan.skippedRecords,
            processingMs: Date.now() - startedAt
        });
    }
    const batchResult = await lockOutboxBatch({
        candidates: plannedSelection.candidates,
        staleLockedCandidates,
        debug,
        lockSeconds
    });
    const plan = buildWorkerPlan({
        enabled,
        allowRealSend,
        dryRun,
        lockOnly,
        debug,
        limit,
        batchSize,
        lockSeconds,
        candidates: plannedSelection.candidates,
        lockedRecords: batchResult.lockedRecords,
        skippedRecords: batchResult.skippedRecords,
        transitionResults: batchResult.transitionResults,
        warnings: buildBlockedReasons(plannedSelection.warning ? [plannedSelection.warning] : undefined, staleSelection.warning ? [staleSelection.warning] : undefined, batchResult.warnings),
        notes: buildNotes(enabled, dryRun, lockOnly, allowRealSend, plannedSelection.candidates.length, staleLockedCandidates.length),
        mode: plannedSelection.candidates.length > 0 ? "lock_only" : "noop"
    });
    return buildWorkerResponse({
        ok: true,
        disabled: false,
        status: batchResult.lockedRecords.length > 0 ? "locked" : "noop",
        reason: batchResult.lockedRecords.length > 0 ? "locked" : "noop",
        lockedCount: batchResult.lockedRecords.length,
        skippedCount: batchResult.skippedRecords.length,
        candidates: plannedSelection.candidates,
        lockedRecords: batchResult.lockedRecords,
        skippedRecords: batchResult.skippedRecords,
        warnings: plan.warnings,
        plan,
        enabled,
        allowRealSend,
        dryRun,
        lockOnly,
        debug,
        limit,
        batchSize,
        lockSeconds,
        processingMs: Date.now() - startedAt
    });
}

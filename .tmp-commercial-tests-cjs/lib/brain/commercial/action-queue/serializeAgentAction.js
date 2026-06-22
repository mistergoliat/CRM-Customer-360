"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeAgentActionJsonValue = sanitizeAgentActionJsonValue;
exports.stringifyAgentActionJsonValue = stringifyAgentActionJsonValue;
exports.buildAgentActionStorageRow = buildAgentActionStorageRow;
exports.serializeAgentAction = serializeAgentAction;
exports.deserializeAgentActionRow = deserializeAgentActionRow;
exports.buildAgentActionIdentitySeed = buildAgentActionIdentitySeed;
const node_crypto_1 = require("node:crypto");
const constants_1 = require("./constants");
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDangerousKey(key) {
    const normalized = key.toLowerCase();
    return normalized === "__proto__" || normalized === "prototype" || normalized === "constructor";
}
function isSensitiveKey(key) {
    const normalized = key.toLowerCase();
    return (normalized.includes("authorization") ||
        normalized.includes("apiKey".toLowerCase()) ||
        normalized.includes("apikey") ||
        normalized.includes("token") ||
        normalized.includes("secret") ||
        normalized.includes("password") ||
        normalized.includes("credential") ||
        normalized.includes("cookie") ||
        normalized.includes("header") ||
        normalized.includes("webhook") ||
        normalized.includes("payload") ||
        normalized.includes("session"));
}
function sanitizeAgentActionJsonValue(value) {
    const state = {
        seen: new WeakSet(),
        applied: false,
        strippedKeys: []
    };
    const sanitize = (input, depth) => {
        if (depth > 8) {
            state.applied = true;
            state.strippedKeys.push("max_depth");
            return null;
        }
        if (input === null || input === undefined)
            return null;
        if (typeof input === "string" || typeof input === "boolean")
            return input;
        if (typeof input === "number")
            return Number.isFinite(input) ? input : String(input);
        if (typeof input === "bigint") {
            state.applied = true;
            state.strippedKeys.push("bigint");
            return input.toString();
        }
        if (typeof input === "function" || typeof input === "symbol") {
            state.applied = true;
            state.strippedKeys.push(typeof input);
            return undefined;
        }
        if (input instanceof Date) {
            state.applied = true;
            return Number.isNaN(input.getTime()) ? null : input.toISOString();
        }
        if (Array.isArray(input)) {
            const output = [];
            for (const item of input.slice(0, 100)) {
                const sanitizedItem = sanitize(item, depth + 1);
                if (sanitizedItem !== undefined)
                    output.push(sanitizedItem);
            }
            if (input.length > 100) {
                state.applied = true;
                state.strippedKeys.push("array_truncated");
            }
            return output;
        }
        if (!isRecord(input)) {
            state.applied = true;
            state.strippedKeys.push("non_json_value");
            return String(input);
        }
        if (state.seen.has(input)) {
            state.applied = true;
            state.strippedKeys.push("circular_reference");
            return undefined;
        }
        state.seen.add(input);
        const output = {};
        for (const [key, nestedValue] of Object.entries(input)) {
            if (isDangerousKey(key) || isSensitiveKey(key)) {
                state.applied = true;
                state.strippedKeys.push(key);
                continue;
            }
            const sanitizedNestedValue = sanitize(nestedValue, depth + 1);
            if (sanitizedNestedValue !== undefined) {
                output[key] = sanitizedNestedValue;
            }
        }
        return output;
    };
    return {
        value: sanitize(value, 0),
        applied: state.applied,
        strippedKeys: [...new Set(state.strippedKeys)]
    };
}
function stringifyAgentActionJsonValue(value) {
    const sanitized = sanitizeAgentActionJsonValue(value);
    return JSON.stringify(sanitized.value ?? null);
}
function toText(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number" && Number.isFinite(value))
        return String(value);
    if (typeof value === "bigint")
        return value.toString();
    return null;
}
function toSerializableId(value) {
    if (value === null || value === undefined || value === "")
        return null;
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "bigint")
        return value.toString();
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed)
            return null;
        const numeric = Number(trimmed);
        if (trimmed !== "" && Number.isSafeInteger(numeric) && String(numeric) === trimmed)
            return numeric;
        return trimmed;
    }
    return null;
}
function toIsoString(value) {
    if (value === null || value === undefined || value === "")
        return null;
    const date = value instanceof Date ? value : new Date(typeof value === "bigint" ? Number(value) : value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function clampText(value, maxLength = constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_TEXT_LENGTH) {
    const text = toText(value);
    if (!text)
        return null;
    return text.length > maxLength ? text.slice(0, maxLength) : text;
}
function uniqueTextArray(value, maxItems) {
    if (!Array.isArray(value))
        return [];
    const output = [];
    for (const item of value) {
        const text = clampText(item, 400);
        if (text && !output.includes(text))
            output.push(text);
        if (output.length >= maxItems)
            break;
    }
    return output;
}
function parseJson(value) {
    if (value === null || value === undefined)
        return null;
    if (Array.isArray(value) || isRecord(value))
        return value;
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return null;
    }
}
function normalizeJsonColumn(value) {
    const parsed = parseJson(value);
    const sanitized = sanitizeAgentActionJsonValue(parsed);
    return sanitized.value ?? null;
}
function buildAgentActionStorageRow(action) {
    return {
        id: action.id,
        action_id: action.actionId,
        idempotency_key: action.idempotencyKey,
        opportunity_id: toSerializableId(action.opportunityId),
        decision_id: clampText(action.decisionId, 191),
        decision_row_id: toSerializableId(action.decisionRowId),
        conversation_case_id: toSerializableId(action.conversationCaseId),
        message_id: clampText(action.messageId, 255),
        wa_id: clampText(action.waId, 64),
        channel: clampText(action.channel, 32) ?? "unknown",
        action_type: clampText(action.actionType, 64) ?? "no_action",
        status: clampText(action.status, 64) ?? "blocked",
        risk_level: clampText(action.riskLevel, 32) ?? "unknown",
        approval_requirement: clampText(action.approvalRequirement, 64) ?? "blocked",
        draft_payload_json: normalizeJsonColumn(action.draftPayload),
        final_payload_json: normalizeJsonColumn(action.finalPayload),
        execution_payload_json: normalizeJsonColumn(action.executionPayload),
        draft_message: clampText(action.draftMessage, constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_TEXT_LENGTH),
        final_message: clampText(action.finalMessage, constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_TEXT_LENGTH),
        scheduled_for: toIsoString(action.scheduledFor),
        expires_at: toIsoString(action.expiresAt),
        attempt_number: Number.isInteger(action.attemptNumber) ? action.attemptNumber : 1,
        max_attempts: Number.isInteger(action.maxAttempts) && action.maxAttempts > 0 ? action.maxAttempts : 1,
        block_reasons_json: uniqueTextArray(action.blockReasons, constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_BLOCK_REASONS),
        cancel_reason: clampText(action.cancelReason, 64),
        failure_reason: clampText(action.failureReason, 1200),
        policy_status: clampText(action.policyStatus, 64) ?? "unknown",
        policy_notes_json: uniqueTextArray(action.policyNotes, constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_NOTES),
        source: clampText(action.source, 64) ?? "ai_sdr",
        created_by: clampText(action.createdBy, 64) ?? "ai",
        approved_by: clampText(action.approvedBy, 191),
        approved_at: toIsoString(action.approvedAt),
        executed_at: toIsoString(action.executedAt),
        cancelled_at: toIsoString(action.cancelledAt),
        outbox_message_id: toSerializableId(action.outboxMessageId),
        lifecycle_version: clampText(action.lifecycleVersion, 64),
        policy_version: clampText(action.policyVersion, 64),
        runtime_version: clampText(action.runtimeVersion, 64),
        created_at: toIsoString(action.createdAt),
        updated_at: toIsoString(action.updatedAt)
    };
}
function serializeAgentAction(action) {
    return buildAgentActionStorageRow(action);
}
function readTextRow(row, candidates) {
    for (const candidate of candidates) {
        const text = clampText(row[candidate], constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_TEXT_LENGTH);
        if (text)
            return text;
    }
    return null;
}
function readIdRow(row, candidates) {
    for (const candidate of candidates) {
        const id = toSerializableId(row[candidate]);
        if (id !== null)
            return id;
    }
    return null;
}
function readNumberRow(row, candidates, fallback) {
    for (const candidate of candidates) {
        const value = row[candidate];
        if (typeof value === "number" && Number.isFinite(value))
            return value;
        if (typeof value === "string" && value.trim()) {
            const parsed = Number(value);
            if (Number.isInteger(parsed))
                return parsed;
        }
    }
    return fallback;
}
function readStringArrayRow(row, candidates) {
    for (const candidate of candidates) {
        const value = row[candidate];
        if (Array.isArray(value))
            return uniqueTextArray(value, constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_NOTES);
        const parsed = parseJson(value);
        if (Array.isArray(parsed))
            return uniqueTextArray(parsed, constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_NOTES);
    }
    return [];
}
function deserializeAgentActionRow(row) {
    return {
        id: typeof row.id === "number" && Number.isFinite(row.id) ? row.id : typeof row.id === "string" && row.id.trim() ? Number(row.id) : null,
        actionId: readTextRow(row, ["action_id", "actionId"]) ?? "",
        idempotencyKey: readTextRow(row, ["idempotency_key", "idempotencyKey"]) ?? "",
        opportunityId: readIdRow(row, ["opportunity_id", "opportunityId"]),
        decisionId: readTextRow(row, ["decision_id", "decisionId"]),
        decisionRowId: typeof row.decision_row_id === "number" && Number.isFinite(row.decision_row_id)
            ? row.decision_row_id
            : typeof row.decisionRowId === "number" && Number.isFinite(row.decisionRowId)
                ? row.decisionRowId
                : null,
        conversationCaseId: readIdRow(row, ["conversation_case_id", "conversationCaseId"]),
        messageId: readTextRow(row, ["message_id", "messageId"]),
        waId: readTextRow(row, ["wa_id", "waId"]),
        channel: (readTextRow(row, ["channel"]) ?? "unknown"),
        actionType: (readTextRow(row, ["action_type", "actionType"]) ?? "no_action"),
        status: (readTextRow(row, ["status"]) ?? "blocked"),
        riskLevel: (readTextRow(row, ["risk_level", "riskLevel"]) ?? "unknown"),
        approvalRequirement: (readTextRow(row, ["approval_requirement", "approvalRequirement"]) ?? "blocked"),
        draftPayload: normalizeJsonColumn(row.draft_payload_json ?? row.draftPayload ?? null),
        finalPayload: normalizeJsonColumn(row.final_payload_json ?? row.finalPayload ?? null),
        executionPayload: normalizeJsonColumn(row.execution_payload_json ?? row.executionPayload ?? null),
        draftMessage: clampText(row.draft_message ?? row.draftMessage, constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_TEXT_LENGTH),
        finalMessage: clampText(row.final_message ?? row.finalMessage, constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_TEXT_LENGTH),
        scheduledFor: toIsoString(row.scheduled_for ?? row.scheduledFor),
        expiresAt: toIsoString(row.expires_at ?? row.expiresAt),
        attemptNumber: readNumberRow(row, ["attempt_number", "attemptNumber"], 1),
        maxAttempts: Math.max(1, readNumberRow(row, ["max_attempts", "maxAttempts"], 1)),
        blockReasons: readStringArrayRow(row, ["block_reasons_json", "blockReasons"]),
        cancelReason: readTextRow(row, ["cancel_reason", "cancelReason"]),
        failureReason: readTextRow(row, ["failure_reason", "failureReason"]),
        policyStatus: readTextRow(row, ["policy_status", "policyStatus"]) ?? "unknown",
        policyNotes: readStringArrayRow(row, ["policy_notes_json", "policyNotes"]),
        source: (readTextRow(row, ["source"]) ?? "ai_sdr"),
        createdBy: (readTextRow(row, ["created_by", "createdBy"]) ?? "ai"),
        approvedBy: readTextRow(row, ["approved_by", "approvedBy"]),
        approvedAt: toIsoString(row.approved_at ?? row.approvedAt),
        executedAt: toIsoString(row.executed_at ?? row.executedAt),
        cancelledAt: toIsoString(row.cancelled_at ?? row.cancelledAt),
        outboxMessageId: readIdRow(row, ["outbox_message_id", "outboxMessageId"]),
        lifecycleVersion: readTextRow(row, ["lifecycle_version", "lifecycleVersion"]),
        policyVersion: readTextRow(row, ["policy_version", "policyVersion"]),
        runtimeVersion: readTextRow(row, ["runtime_version", "runtimeVersion"]),
        createdAt: toIsoString(row.created_at ?? row.createdAt),
        updatedAt: toIsoString(row.updated_at ?? row.updatedAt)
    };
}
function buildAgentActionIdentitySeed(action) {
    const seed = {
        actionType: action.actionType,
        status: action.status,
        channel: action.channel,
        riskLevel: action.riskLevel,
        approvalRequirement: action.approvalRequirement,
        opportunityId: action.opportunityId,
        decisionId: action.decisionId,
        decisionRowId: action.decisionRowId,
        conversationCaseId: action.conversationCaseId,
        messageId: action.messageId,
        waId: action.waId,
        scheduledFor: action.scheduledFor,
        expiresAt: action.expiresAt,
        attemptNumber: action.attemptNumber,
        maxAttempts: action.maxAttempts,
        blockReasons: action.blockReasons,
        cancelReason: action.cancelReason,
        policyStatus: action.policyStatus,
        policyNotes: action.policyNotes,
        draftMessage: action.draftMessage,
        finalMessage: action.finalMessage,
        source: action.source,
        createdBy: action.createdBy,
        extra: action.extra ?? null,
        queueVersion: constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_VERSION
    };
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(sanitizeAgentActionJsonValue(seed).value ?? null)).digest("hex");
}

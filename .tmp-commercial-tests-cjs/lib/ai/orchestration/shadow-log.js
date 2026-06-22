"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SHADOW_RAW_JSON_MAX_CHARS = exports.AI_ORCHESTRATOR_SHADOW_LOG_TABLE = void 0;
exports.prepareShadowRawJson = prepareShadowRawJson;
exports.writeAiOrchestratorShadowLog = writeAiOrchestratorShadowLog;
const db_1 = require("@/lib/db");
exports.AI_ORCHESTRATOR_SHADOW_LOG_TABLE = "ai_orchestrator_shadow_log";
exports.DEFAULT_SHADOW_RAW_JSON_MAX_CHARS = 12000;
function toNullableString(value) {
    if (value === undefined || value === null || value === "")
        return null;
    return String(value);
}
function toNullableNumber(value) {
    if (value === undefined || value === null || value === "")
        return null;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
}
function toNullableBool(value) {
    if (value === undefined || value === null)
        return null;
    return value ? 1 : 0;
}
function truncateText(value, maxChars) {
    if (value.length <= maxChars)
        return value;
    return value.slice(0, maxChars);
}
function prepareShadowRawJson(value, maxChars = exports.DEFAULT_SHADOW_RAW_JSON_MAX_CHARS) {
    if (value === undefined)
        return null;
    const serialized = JSON.stringify(value);
    if (!serialized)
        return null;
    if (serialized.length <= maxChars)
        return serialized;
    return JSON.stringify({
        truncated: true,
        originalChars: serialized.length,
        maxChars,
        preview: truncateText(serialized, maxChars)
    });
}
async function writeAiOrchestratorShadowLog(input, options = {}) {
    try {
        const tableExists = await (0, db_1.hasTable)(exports.AI_ORCHESTRATOR_SHADOW_LOG_TABLE);
        if (!tableExists) {
            return { ok: false, error: `${exports.AI_ORCHESTRATOR_SHADOW_LOG_TABLE} no disponible` };
        }
        const rawJsonMaxChars = options.rawJsonMaxChars ?? exports.DEFAULT_SHADOW_RAW_JSON_MAX_CHARS;
        await (0, db_1.insertExistingColumns)(exports.AI_ORCHESTRATOR_SHADOW_LOG_TABLE, {
            wa_id: toNullableString(input.waId),
            phone_number_id: toNullableString(input.phoneNumberId),
            message_id: input.messageId,
            conversation_case_id: toNullableNumber(input.conversationCaseId),
            backend_decision_id: toNullableString(input.backendDecisionId),
            backend_intent: toNullableString(input.backendIntent),
            backend_department: toNullableString(input.backendDepartment),
            backend_final_action: toNullableString(input.backendFinalAction),
            backend_requires_human: toNullableBool(input.backendRequiresHuman),
            backend_should_reply: toNullableBool(input.backendShouldReply),
            backend_confidence: toNullableNumber(input.backendConfidence),
            backend_ok: input.backendOk ? 1 : 0,
            backend_error: input.backendError ? truncateText(input.backendError, 500) : null,
            current_n8n_intent: toNullableString(input.currentN8nIntent),
            current_n8n_department: toNullableString(input.currentN8nDepartment),
            current_n8n_final_action: toNullableString(input.currentN8nFinalAction),
            matched_intent: toNullableBool(input.matchedIntent),
            matched_department: toNullableBool(input.matchedDepartment),
            matched_final_action: toNullableBool(input.matchedFinalAction),
            latency_ms: toNullableNumber(input.latencyMs),
            raw_request_json: prepareShadowRawJson(input.rawRequestJson, rawJsonMaxChars),
            raw_response_json: prepareShadowRawJson(input.rawResponseJson, rawJsonMaxChars),
            created_at: "__CHILE_NOW__"
        }, ["message_id"]);
        return { ok: true };
    }
    catch (error) {
        return { ok: false, error: (0, db_1.sanitizeDbError)(error) };
    }
}

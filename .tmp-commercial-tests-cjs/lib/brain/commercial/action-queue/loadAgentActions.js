"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadAgentActions = loadAgentActions;
const db_1 = require("../../../db");
const constants_1 = require("./constants");
const serializeAgentAction_1 = require("./serializeAgentAction");
const validateAgentAction_1 = require("./validateAgentAction");
function asText(value) {
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
function asId(value) {
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
        if (Number.isSafeInteger(numeric) && String(numeric) === trimmed)
            return numeric;
        return trimmed;
    }
    return null;
}
function asList(value) {
    if (Array.isArray(value)) {
        return [...new Set(value.map((item) => asText(item)).filter((item) => Boolean(item)))];
    }
    const text = asText(value);
    return text ? [text] : [];
}
function buildResult(status, actions, warnings, error, limit) {
    return {
        status,
        actions,
        warnings: [...new Set(warnings)],
        error,
        totalCount: actions.length,
        limit
    };
}
function normalizeLimit(limit) {
    if (!Number.isInteger(limit ?? constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_LIMIT))
        return constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_LIMIT;
    return Math.min(constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_LIMIT, Math.max(1, limit ?? constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_LIMIT));
}
function buildWhereClause(input) {
    const identityClauses = [];
    const identityParams = [];
    const opportunityId = asId(input.opportunityId);
    const conversationCaseId = asId(input.conversationCaseId);
    const waId = asText(input.waId);
    if (opportunityId !== null) {
        identityClauses.push("opportunity_id = ?");
        identityParams.push(opportunityId);
    }
    if (conversationCaseId !== null) {
        identityClauses.push("conversation_case_id = ?");
        identityParams.push(conversationCaseId);
    }
    if (waId !== null) {
        identityClauses.push("wa_id = ?");
        identityParams.push(waId);
    }
    const statusValues = asList(input.status);
    const actionTypeValues = asList(input.actionType);
    const clauses = [];
    const params = [...identityParams];
    if (identityClauses.length > 0) {
        clauses.push(`(${identityClauses.join(" OR ")})`);
    }
    if (statusValues.length > 0) {
        clauses.push(`status IN (${statusValues.map(() => "?").join(", ")})`);
        params.push(...statusValues);
    }
    if (actionTypeValues.length > 0) {
        clauses.push(`action_type IN (${actionTypeValues.map(() => "?").join(", ")})`);
        params.push(...actionTypeValues);
    }
    return {
        where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
        params
    };
}
async function defaultHasTable(tableName) {
    try {
        return await (0, db_1.hasTable)(tableName);
    }
    catch {
        return false;
    }
}
function normalizeAdapter(adapter) {
    if (!adapter)
        return null;
    return {
        hasTable: adapter.hasTable ?? defaultHasTable,
        queryRows: adapter.queryRows ?? (async (sql, params = []) => (0, db_1.queryRows)(sql, params))
    };
}
async function loadAgentActions(input, adapter) {
    const limit = normalizeLimit(input.limit);
    const safeAdapter = normalizeAdapter(adapter);
    if (!input.queueEnabled) {
        return buildResult("unavailable", [], ["agent_action_queue_disabled"], null, limit);
    }
    try {
        const tableExists = safeAdapter ? await safeAdapter.hasTable(constants_1.CRM_AGENT_ACTIONS_TABLE) : await defaultHasTable(constants_1.CRM_AGENT_ACTIONS_TABLE);
        if (!tableExists) {
            return buildResult("unavailable", [], ["agent_action_queue_missing"], null, limit);
        }
        const { where, params } = buildWhereClause(input);
        const rows = safeAdapter
            ? await safeAdapter.queryRows(`
            SELECT *
            FROM ${constants_1.CRM_AGENT_ACTIONS_TABLE}
            ${where}
            ORDER BY updated_at DESC, id DESC
            LIMIT ${limit}
          `, params)
            : await (0, db_1.queryRows)(`
            SELECT *
            FROM ${constants_1.CRM_AGENT_ACTIONS_TABLE}
            ${where}
            ORDER BY updated_at DESC, id DESC
            LIMIT ${limit}
          `, params);
        const actions = [];
        const warnings = [];
        for (const row of rows) {
            const action = (0, serializeAgentAction_1.deserializeAgentActionRow)(row);
            const validation = (0, validateAgentAction_1.validateAgentAction)(action);
            if (validation.valid && validation.action) {
                actions.push(validation.action);
            }
            else {
                warnings.push(validation.code);
            }
        }
        return buildResult("loaded", actions, warnings, null, limit);
    }
    catch (error) {
        return buildResult("error", [], ["agent_action_queue_read_failed"], (0, db_1.sanitizeDbError)(error), limit);
    }
}

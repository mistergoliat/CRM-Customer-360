"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCommercialState = loadCommercialState;
const constants_1 = require("../constants");
const adapters_1 = require("../context/adapters");
const db_1 = require("../../../db");
const resolveOpportunityIdentity_1 = require("./resolveOpportunityIdentity");
const constants_2 = require("./constants");
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
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
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "bigint")
        return value.toString();
    return null;
}
function asBoolean(value, fallback = false) {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return value !== 0;
    if (typeof value === "string")
        return value.trim().toLowerCase() === "true";
    return fallback;
}
function toIso(value, fallback) {
    if (value instanceof Date && !Number.isNaN(value.getTime()))
        return value.toISOString();
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
        const parsed = new Date(typeof value === "bigint" ? Number(value) : value);
        if (!Number.isNaN(parsed.getTime()))
            return parsed.toISOString();
    }
    return fallback;
}
function parseJson(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "object")
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
function parseJsonArray(value) {
    const parsed = parseJson(value);
    return Array.isArray(parsed) ? parsed : [];
}
function parseJsonRecord(value) {
    const parsed = parseJson(value);
    return isRecord(parsed) ? parsed : {};
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}
function normalizeWarnings(values) {
    const list = parseJsonArray(values);
    return uniqueStrings(list).filter((value) => constants_2.COMMERCIAL_OPERATIONAL_LOOP_WARNING_VALUES.includes(value));
}
function normalizeNextActionType(value) {
    const text = asText(value);
    if (text && constants_2.COMMERCIAL_OPERATIONAL_LOOP_NEXT_ACTION_TYPES.includes(text)) {
        return text;
    }
    return "no_action";
}
function isTerminalStatus(status) {
    return status === "won" || status === "lost" || status === "cancelled" || status === "archived";
}
function normalizeOpportunityStatus(value) {
    const text = asText(value);
    if (text && constants_1.OPPORTUNITY_STATUSES.includes(text))
        return text;
    return "new";
}
function normalizeOpportunityStage(value) {
    const text = asText(value);
    if (text && constants_1.OPPORTUNITY_STAGES.includes(text))
        return text;
    return null;
}
function normalizeCommercialIntent(value) {
    const text = asText(value);
    if (text && constants_1.COMMERCIAL_INTENTS.includes(text))
        return text;
    return "unknown";
}
function normalizePriority(value) {
    const text = asText(value);
    if (text && constants_1.COMMERCIAL_PRIORITIES.includes(text))
        return text;
    return "normal";
}
function normalizeTemperature(value) {
    const text = asText(value);
    if (text && constants_1.COMMERCIAL_TEMPERATURES.includes(text))
        return text;
    return "unknown";
}
function normalizeSignalList(value) {
    const list = parseJsonArray(value);
    return list
        .map((item) => asText(item))
        .filter((item) => Boolean(item));
}
function normalizeRequirements(value) {
    return parseJsonArray(value);
}
function normalizeProductInterests(value) {
    return parseJsonArray(value);
}
function normalizeObjections(value) {
    return parseJsonArray(value);
}
function normalizeDecision(row) {
    const createdAt = toIso(row.created_at ?? row.createdAt, new Date(0).toISOString());
    const stateChanges = parseJsonRecord(row.state_changes_json);
    const detectedSignals = parseJsonArray(row.detected_signals_json);
    const missingInformation = parseJsonArray(row.missing_information_json);
    const warnings = normalizeWarnings(row.warnings_json);
    const nextActionRecord = parseJsonRecord(row.next_action_json);
    return {
        decisionId: asText(row.decision_id) ?? `decision-${asText(row.id) ?? "unknown"}`,
        opportunityId: asId(row.opportunity_id) ?? asText(row.opportunity_id) ?? "unknown",
        opportunityKey: asText(row.opportunity_key) ?? asText(row.opportunityKey) ?? `opportunity-${asText(row.opportunity_id) ?? "unknown"}`,
        correlationId: asText(row.correlation_id) ?? "unknown",
        processInboundRunId: asText(row.process_inbound_run_id ?? row.processInboundRunId),
        salesAgentRunId: asText(row.sales_agent_run_id ?? row.salesAgentRunId),
        messageId: asText(row.message_id ?? row.messageId),
        previousStatus: normalizeOpportunityStatus(row.previous_status ?? row.previousStatus),
        nextStatus: normalizeOpportunityStatus(row.next_status ?? row.nextStatus),
        previousStage: normalizeOpportunityStage(row.previous_stage ?? row.previousStage),
        nextStage: normalizeOpportunityStage(row.next_stage ?? row.nextStage),
        detectedSignals,
        stateChanges: {
            opportunityKey: asText(stateChanges.opportunityKey) ?? asText(row.opportunity_key) ?? "unknown",
            previousStatus: normalizeOpportunityStatus(stateChanges.previousStatus ?? row.previous_status ?? row.previousStatus),
            nextStatus: normalizeOpportunityStatus(stateChanges.nextStatus ?? row.next_status ?? row.nextStatus),
            previousStage: normalizeOpportunityStage(stateChanges.previousStage ?? row.previous_stage ?? row.previousStage),
            nextStage: normalizeOpportunityStage(stateChanges.nextStage ?? row.next_stage ?? row.nextStage),
            statusChanged: asBoolean(stateChanges.statusChanged),
            stageChanged: asBoolean(stateChanges.stageChanged),
            summaryChanged: asBoolean(stateChanges.summaryChanged),
            waitingForChanged: asBoolean(stateChanges.waitingForChanged),
            nextActionChanged: asBoolean(stateChanges.nextActionChanged),
            changedFields: parseJsonArray(stateChanges.changedFields),
            addedSignals: parseJsonArray(stateChanges.addedSignals),
            removedSignals: parseJsonArray(stateChanges.removedSignals),
            addedRequirements: parseJsonArray(stateChanges.addedRequirements),
            removedRequirements: parseJsonArray(stateChanges.removedRequirements),
            addedObjections: parseJsonArray(stateChanges.addedObjections),
            removedObjections: parseJsonArray(stateChanges.removedObjections)
        },
        missingInformation,
        nextAction: {
            type: normalizeNextActionType(nextActionRecord.type),
            reason: asText(nextActionRecord.reason) ?? "No decision available.",
            confidence: (asText(nextActionRecord.confidence) ?? "low"),
            riskLevel: (asText(nextActionRecord.riskLevel) ?? "blocked"),
            approvalRequirement: (asText(nextActionRecord.approvalRequirement) ?? "blocked"),
            recommendedChannel: (asText(nextActionRecord.recommendedChannel) ?? "unknown"),
            draftMessage: asText(nextActionRecord.draftMessage),
            requiredInformation: parseJsonArray(nextActionRecord.requiredInformation),
            blockedReasons: parseJsonArray(nextActionRecord.blockedReasons),
            executable: false
        },
        policyStatus: (asText(row.policy_status) ?? "blocked"),
        riskLevel: (asText(row.risk_level) ?? "blocked"),
        approvalRequirement: (asText(row.approval_requirement) ?? "blocked"),
        decisionStatus: (asText(row.decision_status) ?? "recorded"),
        rationale: asText(row.rationale) ?? "Operational decision recorded.",
        warnings,
        contractVersion: asText(row.contract_version ?? row.contractVersion),
        policyVersion: asText(row.policy_version ?? row.policyVersion),
        runtimeVersion: asText(row.runtime_version ?? row.runtimeVersion),
        createdAt
    };
}
function normalizeState(row) {
    const createdAt = toIso(row.created_at ?? row.createdAt, new Date(0).toISOString());
    const updatedAt = toIso(row.updated_at ?? row.updatedAt, createdAt);
    const lastActivityAt = toIso(row.last_activity_at ?? row.lastActivityAt ?? row.updated_at ?? row.updatedAt, updatedAt);
    const opportunityId = asId(row.id ?? row.opportunity_id ?? row.opportunityId);
    const previousDecisionId = asText(row.last_agent_decision_id ?? row.lastAgentDecisionId);
    return {
        opportunityId,
        opportunityKey: asText(row.opportunity_key ?? row.opportunityKey) ?? `opportunity-${opportunityId ?? "unknown"}`,
        customerCandidateId: asId(row.customer_candidate_id ?? row.customerCandidateId),
        customerMasterId: asId(row.customer_master_id ?? row.customerMasterId),
        leadId: asId(row.lead_id ?? row.leadId),
        conversationCaseId: asId(row.conversation_case_id ?? row.conversationCaseId),
        waId: asText(row.wa_id ?? row.waId),
        channel: (asText(row.channel) ?? "unknown"),
        primaryIntent: normalizeCommercialIntent(row.primary_intent),
        status: normalizeOpportunityStatus(row.status),
        stage: normalizeOpportunityStage(row.stage),
        temperature: normalizeTemperature(row.temperature),
        priority: normalizePriority(row.priority),
        currentSummary: asText(row.current_summary ?? row.currentSummary),
        requirements: normalizeRequirements(row.requirements_json),
        missingRequirements: normalizeRequirements(row.missing_requirements_json),
        productInterests: normalizeProductInterests(row.product_interests_json),
        objections: normalizeObjections(row.objections_json),
        signals: normalizeSignalList(row.signals_json),
        lastCustomerMessageId: asId(row.last_customer_message_id ?? row.lastCustomerMessageId),
        lastAgentDecisionId: asId(row.last_agent_decision_id ?? row.lastAgentDecisionId),
        waitingFor: asText(row.waiting_for ?? row.waitingFor),
        nextActionType: asText(row.next_action_type ?? row.nextActionType),
        nextActionDueAt: toIso(row.next_action_due_at ?? row.nextActionDueAt, lastActivityAt),
        humanOwnerActive: asBoolean(row.human_owner_active ?? row.humanOwnerActive),
        aiBlocked: asBoolean(row.ai_blocked ?? row.aiBlocked),
        version: Number.isFinite(Number(row.version)) ? Number(row.version) : 1,
        createdAt,
        updatedAt,
        lastActivityAt,
        closedAt: row.closed_at === null || row.closed_at === undefined ? null : toIso(row.closed_at, createdAt),
        previousDecision: previousDecisionId
            ? {
                decisionId: previousDecisionId,
                decisionStatus: "recorded",
                createdAt: updatedAt
            }
            : null
    };
}
async function safeHasTable(tableName) {
    try {
        const rows = await (0, db_1.queryRows)(`SELECT 1 AS table_exists FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`, [tableName]);
        return rows.length > 0;
    }
    catch {
        return false;
    }
}
function buildCandidateWhereClause(hints) {
    const clauses = [];
    const params = [];
    const addClause = (column, value) => {
        if (value === null || value === undefined || value === "")
            return;
        clauses.push(`\`${column}\` = ?`);
        params.push(value);
    };
    addClause("wa_id", hints.waId);
    addClause("customer_candidate_id", hints.customerCandidateId);
    addClause("customer_master_id", hints.customerMasterId);
    addClause("lead_id", hints.leadId);
    addClause("conversation_case_id", hints.conversationCaseId);
    addClause("channel", hints.channel === "unknown" ? null : hints.channel);
    return {
        where: clauses.length > 0 ? `WHERE ${clauses.join(" OR ")}` : "",
        params
    };
}
async function loadLatestDecision(opportunityId) {
    try {
        const rows = await (0, db_1.queryRows)(`SELECT * FROM crm_agent_decisions WHERE opportunity_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`, [opportunityId]);
        const row = rows[0];
        if (row)
            return normalizeDecision(row);
    }
    catch {
        // fall back to no decision
    }
    return null;
}
async function loadCommercialState(input) {
    const currentTime = typeof input.currentTime === "string" ? input.currentTime : input.currentTime.toISOString();
    const hints = (0, resolveOpportunityIdentity_1.buildCommercialIdentityHints)({
        inboundMessage: input.inboundMessage,
        brainContext: input.brainContext,
        commercialContext: input.commercialContext
    });
    if (!hints.hasCommercialSignal && !hints.hasExplicitCommercialState) {
        return {
            status: "not_found",
            candidates: [],
            activeState: null,
            latestDecision: null,
            warnings: ["commercial_state_missing"],
            metadata: {
                version: constants_2.COMMERCIAL_OPERATIONAL_LOOP_VERSION,
                currentTime,
                correlationId: input.correlationId,
                hint: hints,
                reason: "No commercial signal was found."
            }
        };
    }
    const opportunitiesTableExists = await safeHasTable("crm_opportunities");
    const decisionsTableExists = await safeHasTable("crm_agent_decisions");
    if (!opportunitiesTableExists || !decisionsTableExists) {
        return {
            status: "not_found",
            candidates: [],
            activeState: null,
            latestDecision: null,
            warnings: ["commercial_state_missing"],
            metadata: {
                version: constants_2.COMMERCIAL_OPERATIONAL_LOOP_VERSION,
                currentTime,
                correlationId: input.correlationId,
                hint: hints,
                reason: "Commercial state tables are not available."
            }
        };
    }
    const { where, params } = buildCandidateWhereClause(hints);
    if (!where) {
        return {
            status: "not_found",
            candidates: [],
            activeState: null,
            latestDecision: null,
            warnings: ["commercial_state_missing"],
            metadata: {
                version: constants_2.COMMERCIAL_OPERATIONAL_LOOP_VERSION,
                currentTime,
                correlationId: input.correlationId,
                hint: hints,
                reason: "No identity hints were available."
            }
        };
    }
    try {
        const rows = await (0, db_1.queryRows)(`
        SELECT
          id,
          opportunity_key,
          customer_candidate_id,
          customer_master_id,
          lead_id,
          conversation_case_id,
          wa_id,
          channel,
          primary_intent,
          status,
          stage,
          temperature,
          priority,
          current_summary,
          requirements_json,
          missing_requirements_json,
          product_interests_json,
          objections_json,
          signals_json,
          last_customer_message_id,
          last_agent_decision_id,
          waiting_for,
          next_action_type,
          next_action_due_at,
          human_owner_active,
          ai_blocked,
          version,
          created_at,
          updated_at,
          last_activity_at,
          closed_at
        FROM crm_opportunities
        ${where}
        ORDER BY updated_at DESC, last_activity_at DESC, id DESC
        LIMIT 25
      `, params);
        const candidates = rows.map((row) => normalizeState(row));
        const activeState = candidates.find((state) => !isTerminalStatus(state.status) && !state.humanOwnerActive && !state.aiBlocked) ??
            candidates.find((state) => !isTerminalStatus(state.status)) ??
            candidates[0] ??
            null;
        const latestDecision = activeState ? await loadLatestDecision(activeState.opportunityId ?? activeState.opportunityKey) : null;
        const warnings = uniqueStrings([
            candidates.length > 1 ? "commercial_state_conflict" : null,
            candidates.some((candidate) => candidate.humanOwnerActive) ? "commercial_state_human_owner_active" : null,
            candidates.some((candidate) => candidate.aiBlocked) ? "commercial_state_ai_blocked" : null,
            candidates.some((candidate) => candidate.status === "stalled") ? "commercial_state_no_action" : null,
            candidates.some((candidate) => candidate.status === "archived" || candidate.status === "cancelled" || candidate.status === "lost" || candidate.status === "won") ? "commercial_state_terminal" : null
        ]);
        return {
            status: "loaded",
            candidates,
            activeState,
            latestDecision,
            warnings: warnings,
            metadata: {
                version: constants_2.COMMERCIAL_OPERATIONAL_LOOP_VERSION,
                currentTime,
                correlationId: input.correlationId,
                hint: hints,
                rowCount: rows.length,
                sanitized: Boolean(sanitizedCommercialSummary(input.commercialContext))
            }
        };
    }
    catch (error) {
        return {
            status: "error",
            candidates: [],
            activeState: null,
            latestDecision: null,
            warnings: ["commercial_state_missing"],
            metadata: {
                version: constants_2.COMMERCIAL_OPERATIONAL_LOOP_VERSION,
                currentTime,
                correlationId: input.correlationId,
                hint: hints,
                error: error instanceof Error ? error.message : String(error)
            }
        };
    }
}
function sanitizedCommercialSummary(commercialContext) {
    if (!commercialContext)
        return null;
    const summary = (0, adapters_1.sanitizeCommercialObject)({
        status: commercialContext.status,
        completeness: commercialContext.completeness,
        warnings: commercialContext.warnings,
        sourceSummary: commercialContext.sourceSummary
    });
    return summary.value;
}

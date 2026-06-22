"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSourceQueueDetail = getSourceQueueDetail;
exports.getCaseDetailData = getCaseDetailData;
const cases_1 = require("./cases");
const db_1 = require("./db");
const action_queue_1 = require("./brain/commercial/action-queue");
const review_1 = require("./brain/commercial/review");
const operator_pilot_1 = require("./brain/commercial/operator-pilot");
const autonomy_sandbox_1 = require("./brain/commercial/autonomy-sandbox");
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asText(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number" || typeof value === "bigint")
        return String(value);
    return null;
}
function asId(value) {
    if (value === null || value === undefined || value === "")
        return null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    if (typeof value === "bigint")
        return value.toString();
    return null;
}
function asDateInput(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (value instanceof Date)
        return Number.isNaN(value.getTime()) ? null : value;
    return null;
}
function parseBooleanEnv(value, fallback) {
    if (typeof value !== "string")
        return fallback;
    const normalized = value.trim().toLowerCase();
    if (!normalized)
        return fallback;
    return ["1", "true", "yes", "on"].includes(normalized);
}
function parseAllowedActionTypes(raw) {
    if (typeof raw !== "string" || !raw.trim())
        return [...autonomy_sandbox_1.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_ACTION_TYPES];
    const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
    return values.length > 0 ? [...new Set(values)] : [...autonomy_sandbox_1.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_ACTION_TYPES];
}
function readSandboxAutonomyConfig() {
    return (0, autonomy_sandbox_1.buildSandboxAutonomyConfig)({
        sandboxEnabled: parseBooleanEnv(process.env.BRAIN_AUTONOMOUS_SANDBOX_ENABLED, false),
        autonomousReplyEnabled: parseBooleanEnv(process.env.BRAIN_AUTONOMOUS_REPLY_ENABLED, false),
        whitelistedWaIds: (0, autonomy_sandbox_1.parseAutonomousTestWaIds)(process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS),
        allowedActionTypes: parseAllowedActionTypes(process.env.BRAIN_AUTONOMOUS_ALLOWED_ACTION_TYPES),
        maxRiskLevel: (process.env.BRAIN_AUTONOMOUS_MAX_RISK_LEVEL?.trim() || "low").toLowerCase()
    });
}
function firstRecordValue(row, keys) {
    for (const key of keys) {
        const value = row[key];
        if (value !== undefined && value !== null)
            return value;
    }
    return null;
}
function buildCommercialShadowReviewIdentifiers(caseRow, sourceQueue) {
    return {
        correlationId: asText(firstRecordValue(caseRow, ["commercial_shadow_correlation_id", "shadow_correlation_id", "correlation_id"])) ?? null,
        processInboundRunId: asText(firstRecordValue(caseRow, ["process_inbound_run_id", "inbound_run_id", "brain_run_id"])) ?? null,
        salesAgentRunId: asText(firstRecordValue(caseRow, ["sales_agent_run_id", "commercial_run_id", "agent_run_id"])) ?? null,
        caseId: asId(caseRow.conversation_case_id ?? caseRow.case_id ?? caseRow.id ?? null),
        conversationCaseId: asId(caseRow.conversation_case_id ?? caseRow.id ?? null),
        waId: asText(caseRow.wa_id ?? null),
        email: asText(caseRow.email ?? null),
        phone: asText(caseRow.phone ?? sourceQueue?.phone_normalized ?? null),
        idCustomer: asId(caseRow.id_customer ?? sourceQueue?.id_customer ?? null),
        idOrder: asId(caseRow.id_order ?? sourceQueue?.id_order ?? null),
        invoiceNumber: asId(caseRow.invoice_number ?? sourceQueue?.invoice_number ?? null)
    };
}
function readCommercialShadowReviewSource(caseRow) {
    const candidates = [
        "commercial_shadow_review",
        "commercial_shadow_result",
        "commercial_evaluation",
        "ai_sdr_review",
        "ai_sdr_shadow_review",
        "shadow_review"
    ];
    for (const candidate of candidates) {
        const value = caseRow[candidate];
        if (!isRecord(value))
            continue;
        const status = asText(value.status);
        if (status === "available" || status === "disabled" || status === "not_found" || status === "error") {
            return value;
        }
        if (value.shadowResult || value.shadow_result) {
            return { status: "available", ...value };
        }
    }
    const metadata = isRecord(caseRow.metadata) ? caseRow.metadata : null;
    if (metadata) {
        for (const candidate of candidates) {
            const value = metadata[candidate];
            if (!isRecord(value))
                continue;
            const status = asText(value.status);
            if (status === "available" || status === "disabled" || status === "not_found" || status === "error") {
                return value;
            }
            if (value.shadowResult || value.shadow_result) {
                return { status: "available", ...value };
            }
        }
    }
    return null;
}
function readCommercialOperationalResultSource(caseRow) {
    const candidates = [
        "commercial_operational_result",
        "commercialOperationalResult",
        "commercial_operational_loop",
        "commercialOperationalLoop",
        "commercial_operational_loop_result",
        "commercialOperationalLoopResult",
        "operational_result",
        "operationalResult"
    ];
    for (const candidate of candidates) {
        const value = caseRow[candidate];
        if (value !== undefined && value !== null)
            return value;
    }
    const metadata = isRecord(caseRow.metadata) ? caseRow.metadata : null;
    if (metadata) {
        for (const candidate of candidates) {
            const value = metadata[candidate];
            if (value !== undefined && value !== null)
                return value;
        }
    }
    return null;
}
function buildCommercialShadowReviewForCase(caseRow, sourceQueue) {
    const source = readCommercialShadowReviewSource(caseRow);
    const identifiers = buildCommercialShadowReviewIdentifiers(caseRow, sourceQueue);
    if (!source) {
        const input = {
            status: "not_found",
            identifiers,
            observedAt: null,
            reason: "No persisted commercial shadow source is available for this case.",
            warnings: [],
            metadata: {
                source: "case_detail_read_adapter"
            }
        };
        return (0, review_1.buildCommercialShadowReview)(input);
    }
    if (asText(source.status) === "disabled") {
        const input = {
            status: "disabled",
            identifiers,
            observedAt: asText(source.observedAt ?? source.observed_at ?? null) ?? null,
            correlationId: asText(source.correlationId ?? source.correlation_id ?? null) ?? null,
            processInboundRunId: asText(source.processInboundRunId ?? source.process_inbound_run_id ?? null) ?? null,
            salesAgentRunId: asText(source.salesAgentRunId ?? source.sales_agent_run_id ?? null) ?? null,
            reason: asText(source.reason ?? source.message ?? null),
            warnings: Array.isArray(source.warnings) ? source.warnings.map((warning) => asText(warning) ?? "").filter(Boolean) : [],
            metadata: isRecord(source.metadata) ? source.metadata : { source: "case_detail_read_adapter" }
        };
        return (0, review_1.buildCommercialShadowReview)(input);
    }
    if (asText(source.status) === "error") {
        const input = {
            status: "error",
            identifiers,
            observedAt: asText(source.observedAt ?? source.observed_at ?? null) ?? null,
            correlationId: asText(source.correlationId ?? source.correlation_id ?? null) ?? null,
            processInboundRunId: asText(source.processInboundRunId ?? source.process_inbound_run_id ?? null) ?? null,
            salesAgentRunId: asText(source.salesAgentRunId ?? source.sales_agent_run_id ?? null) ?? null,
            reason: asText(source.reason ?? source.message ?? null),
            error: source.error ?? source.details ?? null,
            warnings: Array.isArray(source.warnings) ? source.warnings.map((warning) => asText(warning) ?? "").filter(Boolean) : [],
            metadata: isRecord(source.metadata) ? source.metadata : { source: "case_detail_read_adapter" }
        };
        return (0, review_1.buildCommercialShadowReview)(input);
    }
    const shadowResult = source.shadowResult ?? source.shadow_result ?? null;
    const evaluationResult = source.evaluationResult ?? source.evaluation_result ?? null;
    if (!isRecord(shadowResult)) {
        return (0, review_1.buildCommercialShadowReview)({
            status: "not_found",
            identifiers,
            observedAt: null,
            reason: "Commercial shadow read adapter found no structured shadow result.",
            warnings: [],
            metadata: {
                source: "case_detail_read_adapter"
            }
        });
    }
    return (0, review_1.buildCommercialShadowReview)({
        status: "available",
        identifiers,
        observedAt: asText(source.observedAt ?? source.observed_at ?? caseRow.updated_at ?? caseRow.last_message_at ?? null) ?? null,
        correlationId: asText(source.correlationId ?? source.correlation_id ?? null) ?? null,
        processInboundRunId: asText(source.processInboundRunId ?? source.process_inbound_run_id ?? null) ?? null,
        salesAgentRunId: asText(source.salesAgentRunId ?? source.sales_agent_run_id ?? null) ?? null,
        shadowResult: shadowResult,
        evaluationResult: isRecord(evaluationResult) ? evaluationResult : null,
        warnings: Array.isArray(source.warnings) ? source.warnings.map((warning) => asText(warning) ?? "").filter(Boolean) : [],
        metadata: isRecord(source.metadata) ? source.metadata : { source: "case_detail_read_adapter" }
    });
}
function toPositiveNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
}
async function getSourceQueueDetail(caseRow) {
    const sourceTable = String(caseRow.source_table || "");
    const sourceId = toPositiveNumber(caseRow.source_id);
    const idOrder = toPositiveNumber(caseRow.id_order);
    const query = `
    SELECT *
    FROM (
      SELECT
        'postventa_armado' AS source_domain,
        'n8n_postventa_queue' AS source_table,
        q.id AS source_id,
        q.id_order,
        NULL AS id_customer,
        NULL AS invoice_number,
        NULL AS firstname,
        NULL AS lastname,
        q.phone_normalized,
        NULL AS comuna,
        NULL AS comuna_normalized,
        NULL AS purchase_date,
        NULL AS months_since_purchase,
        NULL AS maintenance_stage,
        NULL AS maintenance_cycle,
        NULL AS maintenance_due_date,
        NULL AS product_references,
        NULL AS product_names,
        q.status,
        q.estado_caso,
        q.last_intent,
        q.respondio,
        q.requiere_contacto_humano,
        q.canal_derivacion,
        q.sac_notified,
        q.contact_reply_sent,
        q.contact_reply_sent_at,
        q.rechazo_reply_sent,
        q.rechazo_reply_sent_at,
        q.last_inbound_text,
        q.last_inbound_at,
        q.provider_message_id,
        q.message_status,
        q.sent_at,
        q.delivered_at,
        q.read_at,
        q.failed_at,
        q.created_at,
        q.updated_at,
        CASE
          WHEN ? = 'n8n_postventa_queue' AND q.id = ? THEN 1
          WHEN q.id_order = ? THEN 2
          ELSE 99
        END AS match_priority
      FROM n8n_postventa_queue q
      WHERE
        ((? = 'n8n_postventa_queue' AND q.id = ?) OR (? > 0 AND q.id_order = ?))

      UNION ALL

      SELECT
        'postventa_mantencion' AS source_domain,
        'n8n_mantenciones_cardio_queue' AS source_table,
        q.id AS source_id,
        q.id_order,
        q.id_customer,
        q.invoice_number,
        q.firstname,
        q.lastname,
        q.phone_normalized,
        q.comuna,
        q.comuna_normalized,
        q.purchase_date,
        q.months_since_purchase,
        q.maintenance_stage,
        q.maintenance_cycle,
        q.maintenance_due_date,
        q.product_references,
        q.product_names,
        q.status,
        q.estado_caso,
        q.last_intent,
        q.respondio,
        q.requiere_contacto_humano,
        q.canal_derivacion,
        q.sac_notified,
        q.contact_reply_sent,
        q.contact_reply_sent_at,
        q.rechazo_reply_sent,
        q.rechazo_reply_sent_at,
        q.last_inbound_text,
        q.last_inbound_at,
        q.provider_message_id,
        q.message_status,
        q.sent_at,
        q.delivered_at,
        q.read_at,
        q.failed_at,
        q.created_at,
        q.updated_at,
        CASE
          WHEN ? = 'n8n_mantenciones_cardio_queue' AND q.id = ? THEN 1
          WHEN q.id_order = ? THEN 2
          ELSE 99
        END AS match_priority
      FROM n8n_mantenciones_cardio_queue q
      WHERE
        ((? = 'n8n_mantenciones_cardio_queue' AND q.id = ?) OR (? > 0 AND q.id_order = ?))
    ) queue_match
    ORDER BY match_priority ASC, updated_at DESC
    LIMIT 1
  `;
    const params = [
        sourceTable,
        sourceId || 0,
        idOrder || -1,
        sourceTable,
        sourceId || 0,
        idOrder || 0,
        idOrder || -1,
        sourceTable,
        sourceId || 0,
        idOrder || -1,
        sourceTable,
        sourceId || 0,
        idOrder || 0,
        idOrder || -1
    ];
    const result = await (0, db_1.safeQueryRows)(query, params);
    if (!result.ok)
        return { ok: false, error: result.error, row: null };
    return { ok: true, row: result.rows[0] ?? null };
}
async function getCaseDetailData(caseId) {
    const caseResult = await (0, cases_1.getCaseById)(caseId);
    if (!caseResult.ok)
        return { ok: false, error: caseResult.error };
    if (!caseResult.row)
        return { ok: true, data: null };
    const [timeline, sourceQueueResult] = await Promise.all([(0, cases_1.getCaseTimeline)(caseResult.row), getSourceQueueDetail(caseResult.row)]);
    const notes = [];
    if (!sourceQueueResult.ok) {
        notes.push({
            tone: "warning",
            title: "Fuente operacional incompleta",
            body: "No se pudo cargar el detalle de cola operacional legacy desde las tablas n8n_postventa_queue/n8n_mantenciones_cardio_queue."
        });
    }
    else if (!sourceQueueResult.row) {
        notes.push({
            tone: "info",
            title: "Sin match de cola legacy",
            body: "No se encontro una fila asociada en las colas legacy usando source_table/source_id o id_order."
        });
    }
    notes.push({
        tone: "warning",
        title: "Prestashop no disponible en esta conexion",
        body: "El legacy consultaba ps_orders, ps_customer, ps_address y ps_order_detail con otra credencial. Esos datos comerciales no existen en el schema actual conectado."
    });
    const commercialShadowReview = buildCommercialShadowReviewForCase(caseResult.row, sourceQueueResult.ok ? sourceQueueResult.row : null);
    const commercialOperationalResult = readCommercialOperationalResultSource(caseResult.row);
    const commercialActionQueue = await (0, action_queue_1.buildActionQueueViewModel)({
        caseId,
        caseRow: caseResult.row,
        sourceQueue: sourceQueueResult.ok ? sourceQueueResult.row : null,
        commercialOperationalResult,
        currentTime: asDateInput(caseResult.row.updated_at ?? caseResult.row.last_message_at ?? null),
        timezone: "America/Santiago",
        sandboxAutonomyConfig: readSandboxAutonomyConfig()
    });
    const commercialOperatorPilot = (0, operator_pilot_1.buildAiSdrOperatorPilotViewModel)({
        caseId,
        caseRow: caseResult.row,
        sourceQueue: sourceQueueResult.ok ? sourceQueueResult.row : null,
        commercialShadowReview,
        commercialOperationalResult
    });
    return {
        ok: true,
        data: {
            caseRow: caseResult.row,
            timeline,
            sourceQueue: sourceQueueResult.ok ? sourceQueueResult.row : null,
            notes,
            commercialOperatorPilot,
            commercialShadowReview,
            commercialActionQueue
        }
    };
}

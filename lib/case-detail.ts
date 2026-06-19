import { getCaseById, getCaseTimeline, type TimelineEntry } from "./cases";
import type { DbRow } from "./db";
import { safeQueryRows } from "./db";
import { buildActionQueueViewModel, type ActionQueueViewModel } from "./brain/commercial/action-queue";
import { buildCommercialShadowReview, type CommercialShadowReviewAvailableInput, type CommercialShadowReviewIdentifiers, type CommercialShadowReviewInput, type CommercialShadowReviewViewModel } from "./brain/commercial/review";
import { buildAiSdrOperatorPilotViewModel, type AiSdrOperatorPilotViewModel } from "./brain/commercial/operator-pilot";

export type SourceQueueDetail = {
  source_domain: string | null;
  source_table: string | null;
  source_id: number | null;
  id_order: number | null;
  id_customer: number | null;
  invoice_number: number | null;
  firstname: string | null;
  lastname: string | null;
  phone_normalized: string | null;
  comuna: string | null;
  comuna_normalized: string | null;
  purchase_date: string | null;
  months_since_purchase: number | null;
  maintenance_stage: string | null;
  maintenance_cycle: number | null;
  maintenance_due_date: string | null;
  product_references: string | null;
  product_names: string | null;
  status: string | null;
  estado_caso: string | null;
  last_intent: string | null;
  respondio: number | null;
  requiere_contacto_humano: number | null;
  canal_derivacion: string | null;
  sac_notified: number | null;
  contact_reply_sent: number | null;
  contact_reply_sent_at: string | null;
  rechazo_reply_sent: number | null;
  rechazo_reply_sent_at: string | null;
  last_inbound_text: string | null;
  last_inbound_at: string | null;
  provider_message_id: string | null;
  message_status: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type CaseCompatibilityNote = {
  tone: "info" | "warning";
  title: string;
  body: string;
};

export type CaseDetailData = {
  caseRow: DbRow;
  timeline: { ok: true; rows: TimelineEntry[]; source: string } | { ok: false; rows: TimelineEntry[]; source: string; error: string };
  sourceQueue: SourceQueueDetail | null;
  notes: CaseCompatibilityNote[];
  commercialOperatorPilot: AiSdrOperatorPilotViewModel;
  commercialShadowReview: CommercialShadowReviewViewModel;
  commercialActionQueue: ActionQueueViewModel;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

function asId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asDateInput(value: unknown): string | Date | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  return null;
}

function firstRecordValue(row: DbRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function buildCommercialShadowReviewIdentifiers(caseRow: DbRow, sourceQueue: SourceQueueDetail | null): CommercialShadowReviewIdentifiers {
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

function readCommercialShadowReviewSource(caseRow: DbRow) {
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
    if (!isRecord(value)) continue;
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
      if (!isRecord(value)) continue;
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

function readCommercialOperationalResultSource(caseRow: DbRow) {
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
    if (value !== undefined && value !== null) return value;
  }

  const metadata = isRecord(caseRow.metadata) ? caseRow.metadata : null;
  if (metadata) {
    for (const candidate of candidates) {
      const value = metadata[candidate];
      if (value !== undefined && value !== null) return value;
    }
  }

  return null;
}

function buildCommercialShadowReviewForCase(caseRow: DbRow, sourceQueue: SourceQueueDetail | null): CommercialShadowReviewViewModel {
  const source = readCommercialShadowReviewSource(caseRow);
  const identifiers = buildCommercialShadowReviewIdentifiers(caseRow, sourceQueue);

  if (!source) {
    const input: CommercialShadowReviewInput = {
      status: "not_found",
      identifiers,
      observedAt: null,
      reason: "No persisted commercial shadow source is available for this case.",
      warnings: [],
      metadata: {
        source: "case_detail_read_adapter"
      }
    };
    return buildCommercialShadowReview(input);
  }

  if (asText(source.status) === "disabled") {
    const input: CommercialShadowReviewInput = {
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
    return buildCommercialShadowReview(input);
  }

  if (asText(source.status) === "error") {
    const input: CommercialShadowReviewInput = {
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
    return buildCommercialShadowReview(input);
  }

  const shadowResult = source.shadowResult ?? source.shadow_result ?? null;
  const evaluationResult = source.evaluationResult ?? source.evaluation_result ?? null;
  if (!isRecord(shadowResult)) {
    return buildCommercialShadowReview({
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

  return buildCommercialShadowReview({
    status: "available",
    identifiers,
    observedAt: asText(source.observedAt ?? source.observed_at ?? caseRow.updated_at ?? caseRow.last_message_at ?? null) ?? null,
    correlationId: asText(source.correlationId ?? source.correlation_id ?? null) ?? null,
    processInboundRunId: asText(source.processInboundRunId ?? source.process_inbound_run_id ?? null) ?? null,
    salesAgentRunId: asText(source.salesAgentRunId ?? source.sales_agent_run_id ?? null) ?? null,
    shadowResult: shadowResult as CommercialShadowReviewAvailableInput["shadowResult"],
    evaluationResult: isRecord(evaluationResult) ? (evaluationResult as CommercialShadowReviewAvailableInput["evaluationResult"]) : null,
    warnings: Array.isArray(source.warnings) ? source.warnings.map((warning) => asText(warning) ?? "").filter(Boolean) : [],
    metadata: isRecord(source.metadata) ? source.metadata : { source: "case_detail_read_adapter" }
  });
}

function toPositiveNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export async function getSourceQueueDetail(caseRow: DbRow) {
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

  const result = await safeQueryRows<SourceQueueDetail>(query, params);
  if (!result.ok) return { ok: false as const, error: result.error, row: null };
  return { ok: true as const, row: result.rows[0] ?? null };
}

export async function getCaseDetailData(caseId: string | number): Promise<
  | { ok: false; error: string }
  | { ok: true; data: CaseDetailData | null }
> {
  const caseResult = await getCaseById(caseId);
  if (!caseResult.ok) return { ok: false, error: caseResult.error };
  if (!caseResult.row) return { ok: true, data: null };

  const [timeline, sourceQueueResult] = await Promise.all([getCaseTimeline(caseResult.row), getSourceQueueDetail(caseResult.row)]);

  const notes: CaseCompatibilityNote[] = [];
  if (!sourceQueueResult.ok) {
    notes.push({
      tone: "warning",
      title: "Fuente operacional incompleta",
      body: "No se pudo cargar el detalle de cola operacional legacy desde las tablas n8n_postventa_queue/n8n_mantenciones_cardio_queue."
    });
  } else if (!sourceQueueResult.row) {
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
  const commercialActionQueue = await buildActionQueueViewModel({
    caseId,
    caseRow: caseResult.row,
    sourceQueue: sourceQueueResult.ok ? sourceQueueResult.row : null,
    commercialOperationalResult,
    currentTime: asDateInput(caseResult.row.updated_at ?? caseResult.row.last_message_at ?? null),
    timezone: "America/Santiago"
  });
  const commercialOperatorPilot = buildAiSdrOperatorPilotViewModel({
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

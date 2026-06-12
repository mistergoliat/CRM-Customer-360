import { getCaseById, getCaseTimeline, type TimelineEntry } from "./cases";
import type { DbRow } from "./db";
import { safeQueryRows } from "./db";

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
};

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

  return {
    ok: true,
    data: {
      caseRow: caseResult.row,
      timeline,
      sourceQueue: sourceQueueResult.ok ? sourceQueueResult.row : null,
      notes
    }
  };
}

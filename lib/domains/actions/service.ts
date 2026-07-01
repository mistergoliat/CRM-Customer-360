import { hasTable, safeQueryRows } from "@/lib/db";
import type { ModuleDataMode } from "../runtime/data-source-status";

export type ActionListInput = {
  q?: string;
  page?: number;
  pageSize?: number;
};

export type ActionListItem = {
  id: string;
  client: string;
  relatedEntity: string;
  status: string;
  risk: string;
  approval: string;
  origin: string;
  schedule: string;
  owner: string;
  href: string;
};

export type ActionListReadModel = {
  items: ActionListItem[];
  pagination: { page: number; pageSize: number; total: number };
  meta: { mode: ModuleDataMode; source: string; warnings: string[] };
};

export type ActionDetailReadModel = {
  action: ActionListItem | null;
  lifecycle: string[];
  rationale: string;
  evidence: string[];
  missing: string[];
  eligibility: string[];
  guardrails: string[];
  preview: string;
  warnings: string[];
  meta: { mode: ModuleDataMode; source: string; warnings: string[] };
};

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return null;
}

function asIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "number" || typeof value === "bigint") {
    const parsed = new Date(Number(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function asJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function ownerForRow(row: Record<string, unknown>) {
  return asText(row.approved_by) ?? asText(row.created_by) ?? "AI";
}

function relatedEntityForRow(row: Record<string, unknown>) {
  return asText(row.opportunity_key) ?? asText(row.conversation_case_id) ?? asText(row.wa_id) ?? asText(row.action_type) ?? "No disponible";
}

function clientForRow(row: Record<string, unknown>) {
  return asText(row.customer_name) ?? asText(row.wa_id) ?? asText(row.opportunity_key) ?? "Sin cliente";
}

function scheduleForRow(row: Record<string, unknown>) {
  return asIso(row.scheduled_for) ?? "Pending";
}

function buildActionItem(row: Record<string, unknown>): ActionListItem {
  const id = asText(row.id) ?? asText(row.action_id) ?? "unknown";
  const status = asText(row.status) ?? "unknown";
  return {
    id,
    client: clientForRow(row),
    relatedEntity: relatedEntityForRow(row),
    status,
    risk: asText(row.risk_level) ?? "unknown",
    approval: asText(row.approval_requirement) ?? "unknown",
    origin: asText(row.source) ?? "crm_agent_actions",
    schedule: scheduleForRow(row),
    owner: ownerForRow(row),
    href: `/actions/${id}`
  };
}

function buildLifecycle(row: Record<string, unknown>) {
  const items = [
    asIso(row.created_at) ? `Created ${asIso(row.created_at)}` : null,
    asIso(row.approved_at) ? `Approved ${asIso(row.approved_at)}` : null,
    asIso(row.scheduled_for) ? `Scheduled ${asIso(row.scheduled_for)}` : null,
    asIso(row.executed_at) ? `Executed ${asIso(row.executed_at)}` : null,
    asIso(row.cancelled_at) ? `Cancelled ${asIso(row.cancelled_at)}` : null
  ].filter((value): value is string => Boolean(value));
  return items.length > 0 ? items : ["No lifecycle events available"];
}

function buildEvidence(row: Record<string, unknown>) {
  const evidence = [
    asText(row.draft_message) ? `Draft: ${asText(row.draft_message)}` : null,
    asText(row.final_message) ? `Final: ${asText(row.final_message)}` : null,
    ...asJsonArray(row.policy_notes_json).map((item) => (typeof item === "string" ? item : "")).filter(Boolean),
    ...asJsonArray(row.block_reasons_json).map((item) => (typeof item === "string" ? item : "")).filter(Boolean)
  ].filter((value): value is string => Boolean(value));
  return evidence.length > 0 ? evidence : ["No evidence available"];
}

function buildMissing(row: Record<string, unknown>) {
  const missing = [
    asText(row.cancel_reason) ? `Cancel reason: ${asText(row.cancel_reason)}` : null,
    asText(row.failure_reason) ? `Failure reason: ${asText(row.failure_reason)}` : null,
    asText(row.approval_requirement) === "operator_review" ? "Operator approval pending" : null,
    asText(row.status) === "blocked" ? "Blocked by policy" : null
  ].filter((value): value is string => Boolean(value));
  return missing.length > 0 ? missing : ["No missing data"];
}

function buildEligibility(row: Record<string, unknown>) {
  return [
    `Status: ${asText(row.status) ?? "unknown"}`,
    `Risk: ${asText(row.risk_level) ?? "unknown"}`,
    `Approval: ${asText(row.approval_requirement) ?? "unknown"}`
  ];
}

function buildGuardrails(row: Record<string, unknown>) {
  return [
    `Policy: ${asText(row.policy_status) ?? "unknown"}`,
    `Source: ${asText(row.source) ?? "unknown"}`,
    `Lifecycle: ${asText(row.lifecycle_version) ?? "unknown"}`
  ];
}

function buildPreview(row: Record<string, unknown>) {
  return asText(row.final_message) ?? asText(row.draft_message) ?? "No message preview available";
}

export async function listActions(input: ActionListInput = {}): Promise<ActionListReadModel> {
  const pageSize = Math.max(1, Math.min(50, Number(input.pageSize ?? 25)));
  const page = Math.max(1, Number(input.page ?? 1));
  const offset = (page - 1) * pageSize;
  const search = input.q?.trim() ?? "";
  const tableAvailable = await hasTable("crm_agent_actions");
  const opportunityTableAvailable = await hasTable("crm_opportunities");
  if (!tableAvailable) {
    return {
      items: [],
      pagination: { page, pageSize, total: 0 },
      meta: { mode: "error", source: "crm_agent_actions", warnings: ["crm_agent_actions_unavailable"] }
    };
  }

  const where: string[] = [];
  const params: Array<string | number> = [];
  if (search) {
    const term = `%${search.toLowerCase()}%`;
    where.push(
      `(LOWER(COALESCE(a.action_id, '')) LIKE ? OR LOWER(COALESCE(a.action_type, '')) LIKE ? OR LOWER(COALESCE(a.status, '')) LIKE ? OR LOWER(COALESCE(a.wa_id, '')) LIKE ? OR LOWER(COALESCE(o.opportunity_key, '')) LIKE ? OR LOWER(COALESCE(mc.firstname, '')) LIKE ? OR LOWER(COALESCE(mc.lastname, '')) LIKE ?)`
    );
    params.push(term, term, term, term, term, term, term);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const countResult = await safeQueryRows<{ total: number }>(
    `
      SELECT COUNT(*) AS total
      FROM crm_agent_actions a
      LEFT JOIN crm_opportunities o ON o.id = a.opportunity_id
      LEFT JOIN master_customer mc ON mc.id = o.customer_master_id
      ${whereSql}
    `,
    params
  );

  const rowsResult = await safeQueryRows<Record<string, unknown>>(
    `
      SELECT
        a.id,
        a.action_id,
        a.opportunity_id,
        a.conversation_case_id,
        a.wa_id,
        a.channel,
        a.action_type,
        a.status,
        a.risk_level,
        a.approval_requirement,
        a.draft_message,
        a.final_message,
        a.scheduled_for,
        a.created_at,
        a.updated_at,
        a.source,
        a.created_by,
        a.approved_by,
        a.policy_status,
        a.lifecycle_version,
        a.policy_version,
        COALESCE(CONCAT_WS(' ', mc.firstname, mc.lastname), a.wa_id, o.opportunity_key, 'Sin cliente') AS customer_name,
        o.opportunity_key,
        o.stage AS opportunity_stage
      FROM crm_agent_actions a
      LEFT JOIN crm_opportunities o ON o.id = a.opportunity_id
      LEFT JOIN master_customer mc ON mc.id = o.customer_master_id
      ${whereSql}
      ORDER BY COALESCE(a.updated_at, a.created_at) DESC, a.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    params
  );

  const items = (rowsResult.ok ? rowsResult.rows : []).map((row) => buildActionItem(row));
  const warnings = [
    !opportunityTableAvailable ? "crm_opportunities_unavailable" : null,
    rowsResult.ok ? null : rowsResult.error
  ].filter((value): value is string => Boolean(value));

  return {
    items,
    pagination: {
      page,
      pageSize,
      total: countResult.ok ? Number(countResult.rows[0]?.total ?? items.length) : items.length
    },
    meta: {
      mode: warnings.length > 0 ? "partial" : "real",
      source: "crm_agent_actions",
      warnings
    }
  };
}

export async function getActionById(id: string): Promise<ActionDetailReadModel | null> {
  const result = await safeQueryRows<Record<string, unknown>>(
    `
      SELECT
        a.id,
        a.action_id,
        a.idempotency_key,
        a.opportunity_id,
        a.decision_id,
        a.decision_row_id,
        a.conversation_case_id,
        a.message_id,
        a.wa_id,
        a.channel,
        a.action_type,
        a.status,
        a.risk_level,
        a.approval_requirement,
        a.draft_payload_json,
        a.final_payload_json,
        a.execution_payload_json,
        a.draft_message,
        a.final_message,
        a.scheduled_for,
        a.expires_at,
        a.attempt_number,
        a.max_attempts,
        a.block_reasons_json,
        a.cancel_reason,
        a.failure_reason,
        a.policy_status,
        a.policy_notes_json,
        a.source,
        a.created_by,
        a.approved_by,
        a.approved_at,
        a.executed_at,
        a.cancelled_at,
        a.outbox_message_id,
        a.lifecycle_version,
        a.policy_version,
        a.runtime_version,
        a.created_at,
        a.updated_at,
        COALESCE(CONCAT_WS(' ', mc.firstname, mc.lastname), a.wa_id, o.opportunity_key, 'Sin cliente') AS customer_name,
        mc.email AS customer_email,
        mc.platform_origin AS customer_platform_origin,
        o.opportunity_key,
        o.stage AS opportunity_stage,
        o.current_summary
      FROM crm_agent_actions a
      LEFT JOIN crm_opportunities o ON o.id = a.opportunity_id
      LEFT JOIN master_customer mc ON mc.id = o.customer_master_id
      WHERE CAST(a.id AS CHAR) = ? OR a.action_id = ?
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT 1
    `,
    [id, id]
  );

  if (!result.ok) return null;
  const row = result.rows[0] ?? null;
  if (!row) return null;

  const action = buildActionItem(row);
  const warnings: string[] = [];

  return {
    action,
    lifecycle: buildLifecycle(row),
    rationale: asText(row.failure_reason) ?? asText(row.cancel_reason) ?? asText(row.policy_status) ?? "Action recorded by the system.",
    evidence: buildEvidence(row),
    missing: buildMissing(row),
    eligibility: buildEligibility(row),
    guardrails: buildGuardrails(row),
    preview: buildPreview(row),
    warnings,
    meta: {
      mode: warnings.length > 0 ? "partial" : "real",
      source: "crm_agent_actions",
      warnings
    }
  };
}

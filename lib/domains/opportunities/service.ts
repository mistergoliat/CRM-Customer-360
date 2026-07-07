import { hasTable, safeQueryRows } from "@/lib/db";
import type { ModuleDataMode } from "../runtime/data-source-status";
import type { SalesNeedProfile } from "@/lib/brain/commercial/sales-consultative/types";

export type OpportunityListInput = {
  q?: string;
  page?: number;
  pageSize?: number;
};

export type OpportunityListItem = {
  id: string;
  customer: string;
  stage: string;
  status: string;
  estimatedValue: string;
  activity: string;
  nextAction: string;
  owner: string;
  risk: string;
  source: string;
  href: string;
};

export type OpportunityListReadModel = {
  items: OpportunityListItem[];
  pagination: { page: number; pageSize: number; total: number };
  meta: { mode: ModuleDataMode; source: string; warnings: string[] };
};

export type OpportunityDecision = {
  decisionId: string;
  nextStatus: string;
  nextStage: string | null;
  rationale: string;
  createdAt: string;
  warnings: string[];
};

export type OpportunityAction = {
  id: number;
  actionId: string;
  actionType: string;
  status: string;
  scheduledFor: string | null;
  draftMessage: string | null;
  finalMessage: string | null;
  createdAt: string;
  updatedAt: string;
  riskLevel: string;
  approvalRequirement: string;
  owner: string;
};

export type OpportunityDetailReadModel = {
  opportunity: OpportunityListItem | null;
  customer: {
    name: string;
    email: string | null;
    platformOrigin: string | null;
    source: string;
  } | null;
  profile: SalesNeedProfile | null;
  decision: OpportunityDecision | null;
  actions: OpportunityAction[];
  timeline: Array<{ id: string; title: string; subtitle: string; time: string; tone: "green" | "amber" | "red" | "blue" | "gray" }>;
  quote: {
    number: string;
    status: string;
    amount: string;
    issued: string;
    expiry: string;
  } | null;
  copilot: {
    summary: string;
    nextAction: string;
    risk: string;
    approval: string;
    evidence: string[];
  };
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

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
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

function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function formatClp(value: unknown) {
  const amount = asNumber(value);
  if (amount === null) return "No disponible";
  return `CLP $${new Intl.NumberFormat("es-CL").format(amount)}`;
}

function normalizeProfile(row: Record<string, unknown> | null): SalesNeedProfile | null {
  if (!row) return null;
  const profile = asJsonObject(row.profile_json);
  return {
    useCase: asText(row.use_case) ?? (typeof profile?.useCase === "string" ? profile.useCase : null),
    customerType: asText(row.customer_type) ?? (typeof profile?.customerType === "string" ? profile.customerType : null),
    goals: asJsonArray(row.goals_json).map((item) => (typeof item === "string" ? item : "")).filter(Boolean),
    requiredFeatures: asJsonArray(row.required_features_json).map((item) => (typeof item === "string" ? item : "")).filter(Boolean),
    preferredFeatures: asJsonArray(row.preferred_features_json).map((item) => (typeof item === "string" ? item : "")).filter(Boolean),
    budgetMin: asNumber(row.budget_min),
    budgetMax: asNumber(row.budget_max),
    availableSpace: asJsonObject(row.available_space_json) as SalesNeedProfile["availableSpace"],
    location: asJsonObject(row.location_json) as SalesNeedProfile["location"],
    deliveryDeadline: asText(row.delivery_deadline),
    experienceLevel: asText(row.experience_level),
    purchaseUrgency: asText(row.purchase_urgency),
    decisionReadiness: asText(row.decision_readiness),
    missingInformation: asJsonArray(row.missing_information_json).map((item) => (typeof item === "string" ? item : "")).filter(Boolean),
    lastUpdatedAt: asText(row.updated_at) ?? new Date(0).toISOString()
  };
}

function riskForOpportunity(row: Record<string, unknown>) {
  const status = (asText(row.status) ?? "unknown").toLowerCase();
  const stage = (asText(row.stage) ?? "").toLowerCase();
  const humanOwnerActive = Boolean(asNumber(row.human_owner_active));
  const aiBlocked = Boolean(asNumber(row.ai_blocked));
  if (status === "won" || status === "lost" || status === "archived" || status === "cancelled") return "Bajo";
  if (humanOwnerActive || aiBlocked) return "Alto";
  if (stage === "quote_pending" || stage === "purchase_intent" || stage === "checkout_support") return "Medio";
  return "Bajo";
}

function ownerForOpportunity(row: Record<string, unknown>) {
  if (Boolean(asNumber(row.human_owner_active))) return "Human owner";
  if (Boolean(asNumber(row.ai_blocked))) return "AI blocked";
  return "AI SDR";
}

function buildOpportunityItem(row: Record<string, unknown>): OpportunityListItem {
  const id = asText(row.id) ?? asText(row.opportunity_key) ?? "unknown";
  const customer = asText(row.customer_name) ?? asText(row.wa_id) ?? asText(row.opportunity_key) ?? "Sin cliente";
  const stage = asText(row.stage) ?? "unknown";
  const status = asText(row.status) ?? "unknown";
  const profileBudgetMax = asNumber(row.profile_budget_max);
  const profileBudgetMin = asNumber(row.profile_budget_min);
  const estimatedValue = profileBudgetMax !== null
    ? formatClp(profileBudgetMax)
    : profileBudgetMin !== null
      ? formatClp(profileBudgetMin)
      : "No disponible";
  const activity = asIso(row.last_activity_at ?? row.updated_at ?? row.created_at) ?? "Sin actividad";
  const nextAction = asText(row.next_action_type) ?? asText(row.waiting_for) ?? "No disponible";

  return {
    id,
    customer,
    stage,
    status,
    estimatedValue,
    activity,
    nextAction,
    owner: ownerForOpportunity(row),
    risk: riskForOpportunity(row),
    source: "crm_opportunities",
    href: `/opportunities/${id}`
  };
}

async function loadLatestProfile(opportunityId: string | number, opportunityKey: string) {
  const result = await safeQueryRows<Record<string, unknown>>(
    `
      SELECT *
      FROM crm_sales_need_profiles
      WHERE opportunity_id = ? OR opportunity_key = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `,
    [opportunityId, opportunityKey]
  );
  if (!result.ok) return { row: null, warning: result.error };
  return { row: result.rows[0] ?? null, warning: null };
}

async function loadLatestDecision(opportunityId: string | number) {
  const result = await safeQueryRows<Record<string, unknown>>(
    `
      SELECT decision_id, next_status, next_stage, rationale, created_at, warnings_json
      FROM crm_agent_decisions
      WHERE opportunity_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [opportunityId]
  );
  if (!result.ok) return { row: null, warning: result.error };
  const row = result.rows[0] ?? null;
  if (!row) return { row: null, warning: null };
  return {
    row: {
      decisionId: asText(row.decision_id) ?? "decision",
      nextStatus: asText(row.next_status) ?? "unknown",
      nextStage: asText(row.next_stage),
      rationale: asText(row.rationale) ?? "Operational decision recorded.",
      createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
      warnings: asJsonArray(row.warnings_json).map((item) => (typeof item === "string" ? item : "")).filter(Boolean)
    },
    warning: null
  };
}

async function loadRecentActions(opportunityId: string | number) {
  const result = await safeQueryRows<Record<string, unknown>>(
    `
      SELECT
        id,
        action_id,
        action_type,
        status,
        scheduled_for,
        draft_message,
        final_message,
        created_at,
        updated_at,
        risk_level,
        approval_requirement,
        approved_by,
        created_by
      FROM crm_agent_actions
      WHERE opportunity_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 10
    `,
    [opportunityId]
  );
  if (!result.ok) return { rows: [], warning: result.error };

  return {
    rows: result.rows.map((row) => ({
      id: Number(row.id),
      actionId: asText(row.action_id) ?? `action-${row.id}`,
      actionType: asText(row.action_type) ?? "unknown",
      status: asText(row.status) ?? "unknown",
      scheduledFor: asIso(row.scheduled_for),
      draftMessage: asText(row.draft_message),
      finalMessage: asText(row.final_message),
      createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
      updatedAt: asIso(row.updated_at) ?? new Date(0).toISOString(),
      riskLevel: asText(row.risk_level) ?? "unknown",
      approvalRequirement: asText(row.approval_requirement) ?? "unknown",
      owner: asText(row.approved_by) ?? asText(row.created_by) ?? "AI"
    })),
    warning: null
  };
}

function buildTimeline(input: {
  opportunity: OpportunityListItem;
  profile: SalesNeedProfile | null;
  decision: OpportunityDecision | null;
  actions: OpportunityAction[];
}) {
  const timeline: Array<{
    id: string;
    title: string;
    subtitle: string;
    time: string;
    tone: "green" | "amber" | "red" | "blue" | "gray";
  }> = [
    {
      id: `opp-${input.opportunity.id}-activity`,
      title: "Latest activity",
      subtitle: input.opportunity.activity,
      time: input.opportunity.activity,
      tone: "blue" as const
    }
  ];

  if (input.decision) {
    timeline.push({
      id: `decision-${input.decision.decisionId}`,
      title: "Commercial decision",
      subtitle: `${input.decision.nextStatus}${input.decision.nextStage ? ` / ${input.decision.nextStage}` : ""}`,
      time: input.decision.createdAt,
      tone: "amber" as const
    });
  }

  if (input.profile) {
    timeline.push({
      id: `profile-${input.opportunity.id}`,
      title: "Need profile",
      subtitle: input.profile.useCase ?? "No use case available",
      time: input.profile.lastUpdatedAt,
      tone: "green" as const
    });
  }

  input.actions.slice(0, 5).forEach((action) => {
    timeline.push({
      id: `action-${action.id}`,
      title: action.actionType,
      subtitle: action.status,
      time: action.updatedAt,
      tone: action.status === "blocked" || action.status === "failed" ? "red" : action.status === "requires_review" ? "amber" : "blue"
    });
  });

  return timeline;
}

function buildCopilotSummary(item: OpportunityListItem, profile: SalesNeedProfile | null, decision: OpportunityDecision | null) {
  const summary = item.status === "won" || item.status === "lost"
    ? `Opportunity is terminal with status ${item.status}.`
    : item.stage !== "unknown"
      ? `Opportunity is in ${item.stage} and remains active.`
      : "Opportunity is active but stage is not available.";

  const nextAction = item.nextAction !== "No disponible" ? item.nextAction : "No next action available.";
  const evidence = [
    item.activity !== "Sin actividad" ? `Last activity at ${item.activity}` : null,
    profile?.useCase ? `Use case: ${profile.useCase}` : null,
    decision ? `Latest decision: ${decision.decisionId}` : null
  ].filter((value): value is string => Boolean(value));

  return {
    summary,
    nextAction,
    risk: item.risk,
    approval: item.owner === "Human owner" ? "Required" : "Not required",
    evidence
  };
}

export async function listOpportunities(input: OpportunityListInput = {}): Promise<OpportunityListReadModel> {
  const pageSize = Math.max(1, Math.min(50, Number(input.pageSize ?? 25)));
  const page = Math.max(1, Number(input.page ?? 1));
  const offset = (page - 1) * pageSize;
  const search = input.q?.trim() ?? "";
  const opportunityTableAvailable = await hasTable("crm_opportunities");
  const profileTableAvailable = await hasTable("crm_sales_need_profiles");

  if (!opportunityTableAvailable) {
    return {
      items: [],
      pagination: { page, pageSize, total: 0 },
      meta: { mode: "error", source: "crm_opportunities", warnings: ["crm_opportunities_unavailable"] }
    };
  }

  const where: string[] = [];
  const params: Array<string | number> = [];
  if (search) {
    const term = `%${search.toLowerCase()}%`;
    where.push(
      `(LOWER(o.opportunity_key) LIKE ? OR LOWER(o.status) LIKE ? OR LOWER(COALESCE(o.stage, '')) LIKE ? OR LOWER(COALESCE(o.current_summary, '')) LIKE ? OR LOWER(COALESCE(mc.firstname, '')) LIKE ? OR LOWER(COALESCE(mc.lastname, '')) LIKE ? OR LOWER(COALESCE(o.wa_id, '')) LIKE ?)`
    );
    params.push(term, term, term, term, term, term, term);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const countResult = await safeQueryRows<{ total: number }>(
    `
      SELECT COUNT(*) AS total
      FROM crm_opportunities o
      LEFT JOIN master_customer mc ON mc.id = o.customer_master_id
      ${whereSql}
    `,
    params
  );

  const rowsResult = await safeQueryRows<Record<string, unknown>>(
    `
      SELECT
        o.id,
        o.opportunity_key,
        o.status,
        o.stage,
        o.current_summary,
        o.next_action_type,
        o.next_action_due_at,
        o.waiting_for,
        o.human_owner_active,
        o.ai_blocked,
        o.last_activity_at,
        o.updated_at,
        o.created_at,
        o.wa_id,
        COALESCE(CONCAT_WS(' ', mc.firstname, mc.lastname), o.wa_id, o.opportunity_key) AS customer_name,
        mc.email AS customer_email,
        mc.platform_origin AS customer_platform_origin,
        (
          SELECT p.budget_max
          FROM crm_sales_need_profiles p
          WHERE p.opportunity_id = o.id OR p.opportunity_key = o.opportunity_key
          ORDER BY p.updated_at DESC, p.id DESC
          LIMIT 1
        ) AS profile_budget_max,
        (
          SELECT p.budget_min
          FROM crm_sales_need_profiles p
          WHERE p.opportunity_id = o.id OR p.opportunity_key = o.opportunity_key
          ORDER BY p.updated_at DESC, p.id DESC
          LIMIT 1
        ) AS profile_budget_min
      FROM crm_opportunities o
      LEFT JOIN master_customer mc ON mc.id = o.customer_master_id
      ${whereSql}
      ORDER BY COALESCE(o.last_activity_at, o.updated_at, o.created_at) DESC, o.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    params
  );

  const items = (rowsResult.ok ? rowsResult.rows : []).map((row) => buildOpportunityItem(row));
  const warnings = [
    !profileTableAvailable ? "crm_sales_need_profiles_unavailable" : null,
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
      source: "crm_opportunities",
      warnings
    }
  };
}

export async function getOpportunityById(id: string): Promise<OpportunityDetailReadModel | null> {
  const opportunityResult = await safeQueryRows<Record<string, unknown>>(
    `
      SELECT
        o.id,
        o.opportunity_key,
        o.status,
        o.stage,
        o.primary_intent,
        o.current_summary,
        o.next_action_type,
        o.next_action_due_at,
        o.waiting_for,
        o.human_owner_active,
        o.ai_blocked,
        o.customer_candidate_id,
        o.customer_master_id,
        o.lead_id,
        o.conversation_case_id,
        o.wa_id,
        o.requirements_json,
        o.missing_requirements_json,
        o.product_interests_json,
        o.objections_json,
        o.signals_json,
        o.version,
        o.last_activity_at,
        o.created_at,
        o.updated_at,
        o.closed_at,
        COALESCE(CONCAT_WS(' ', mc.firstname, mc.lastname), o.wa_id, o.opportunity_key) AS customer_name,
        mc.email AS customer_email,
        mc.platform_origin AS customer_platform_origin
      FROM crm_opportunities o
      LEFT JOIN master_customer mc ON mc.id = o.customer_master_id
      WHERE CAST(o.id AS CHAR) = ? OR o.opportunity_key = ?
      ORDER BY o.updated_at DESC, o.id DESC
      LIMIT 1
    `,
    [id, id]
  );

  if (!opportunityResult.ok) return null;
  const opportunityRow = opportunityResult.rows[0] ?? null;
  if (!opportunityRow) return null;

  const item = buildOpportunityItem(opportunityRow);
  const opportunityId = asText(opportunityRow.id) ?? id;
  const opportunityKey = asText(opportunityRow.opportunity_key) ?? id;
  const profileResult = await loadLatestProfile(opportunityId, opportunityKey);
  const decisionResult = await loadLatestDecision(opportunityId);
  const actionsResult = await loadRecentActions(opportunityId);

  const profile = normalizeProfile(profileResult.row);
  const decision = decisionResult.row;
  const actions = actionsResult.rows;
  const warnings = [
    profileResult.warning,
    decisionResult.warning,
    actionsResult.warning
  ].filter((value): value is string => Boolean(value));

  const customer = {
    name: asText(opportunityRow.customer_name) ?? item.customer,
    email: asText(opportunityRow.customer_email),
    platformOrigin: asText(opportunityRow.customer_platform_origin),
    source: "crm_opportunities"
  };

  return {
    opportunity: item,
    customer,
    profile,
    decision,
    actions,
    timeline: buildTimeline({ opportunity: item, profile, decision, actions }),
    quote: null,
    copilot: buildCopilotSummary(item, profile, decision),
    warnings,
    meta: {
      mode: warnings.length > 0 ? "partial" : "real",
      source: "crm_opportunities",
      warnings
    }
  };
}

import { hasTable, safeQueryRows, safeScalar } from "./db";
import { listConversations } from "./domains/conversations";
import { listCustomers } from "./domains/customers";
import { isDbWriteEnabled } from "./write-access";
import type { ModuleDataMode } from "./domains/runtime/data-source-status";

type DashboardMetricState = "ok" | "warning" | "error" | "muted";

export type DashboardMetric = {
  key: string;
  title: string;
  value: string | number;
  description: string;
  state: DashboardMetricState;
  icon: string;
  error?: string;
};

export type DashboardHealthItem = {
  key: string;
  label: string;
  status: "ok" | "warning" | "error";
  description: string;
  details: string;
};

export type DashboardModuleState = {
  module: "dashboard" | "conversations" | "cases" | "customers" | "opportunities" | "actions";
  label: string;
  mode: ModuleDataMode;
  available: boolean;
  source: string;
  summary: string;
  warnings: string[];
  href: string;
};

export type DashboardConversationRow = {
  id: string;
  contactName: string;
  waId: string;
  status: string;
  priority: string;
  lastMessage: string;
  lastMessageAt: string | null;
  source: string;
  href: string;
};

export type DashboardOpportunityRow = {
  id: string;
  opportunityKey: string;
  customer: string;
  status: string;
  stage: string;
  nextAction: string;
  lastActivityAt: string | null;
  source: string;
};

export type DashboardActionRow = {
  id: string;
  actionId: string;
  client: string;
  actionType: string;
  status: string;
  riskLevel: string;
  approvalRequirement: string;
  scheduledFor: string | null;
  updatedAt: string | null;
  source: string;
};

export type DashboardCustomerRow = {
  id: string;
  displayName: string;
  email: string;
  identityState: string;
  platformOrigin: string;
  lastActivity: string | null;
  source: string;
  href: string;
};

export type DashboardPulse = {
  conversationsActive: number;
  customersTotal: number;
  opportunitiesActive: number;
  actionsPending: number;
  outboxPending: number;
  messagesToday: number;
  decisionsToday: number;
  latestDecision: {
    decisionId: string;
    nextStatus: string;
    nextStage: string | null;
    rationale: string;
    createdAt: string;
  } | null;
  latestMessageAt: string | null;
  latestActionAt: string | null;
};

export type DashboardData = {
  generatedAt: string;
  metrics: DashboardMetric[];
  health: DashboardHealthItem[];
  moduleStates: DashboardModuleState[];
  pulse: DashboardPulse;
  recentConversations: DashboardConversationRow[];
  recentOpportunities: DashboardOpportunityRow[];
  recentActions: DashboardActionRow[];
  recentCustomers: DashboardCustomerRow[];
  warnings: string[];
};

type CountResult = {
  ok: boolean;
  value: number;
  error: string | null;
};

const CHILE_TODAY_SQL = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00'))";

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

function stateForCount(count: number, fallback: DashboardMetricState = "ok"): DashboardMetricState {
  if (count < 0) return "error";
  if (count === 0) return fallback === "warning" ? "ok" : fallback;
  return fallback;
}

async function countRows(sql: string): Promise<CountResult> {
  const result = await safeScalar(sql);
  if (!result.ok) return { ok: false, value: 0, error: result.error };
  return { ok: true, value: Number(result.value ?? 0), error: null };
}

async function countRowsIfAvailable(tableName: string, sql: string): Promise<CountResult> {
  const available = await hasTable(tableName);
  if (!available) {
    return { ok: false, value: 0, error: `${tableName}_unavailable` };
  }
  return countRows(sql);
}

function mapConversationRow(row: Record<string, unknown>): DashboardConversationRow {
  const publicId = asText(row.public_id) ?? asText(row.id) ?? "unknown";
  const rawId = asText(row.id) ?? publicId;
  return {
    id: rawId,
    contactName: asText(row.contactName ?? row.customer_name ?? row.customer_full_name ?? row.external_contact_id) ?? "Sin nombre",
    waId: asText(row.wa_id ?? row.external_contact_id) ?? "-",
    status: asText(row.status) ?? "unknown",
    priority: asText(row.priority) ?? "normal",
    lastMessage: asText(row.lastMessage ?? row.last_message) ?? "Sin mensaje",
    lastMessageAt: asIso(row.lastMessageAt ?? row.last_message_at ?? row.updated_at),
    source: "conversation",
    href: `/conversations/${publicId}`
  };
}

function mapOpportunityRow(row: Record<string, unknown>): DashboardOpportunityRow {
  return {
    id: asText(row.id) ?? "unknown",
    opportunityKey: asText(row.opportunity_key) ?? asText(row.opportunityKey) ?? "opportunity",
    customer: asText(row.customer_name ?? row.customer ?? row.wa_id ?? row.opportunity_key) ?? "Sin cliente",
    status: asText(row.status) ?? "unknown",
    stage: asText(row.stage) ?? "-",
    nextAction: asText(row.next_action_type) ?? asText(row.waiting_for) ?? "-",
    lastActivityAt: asIso(row.last_activity_at ?? row.updated_at ?? row.created_at),
    source: "crm_opportunities"
  };
}

function mapActionRow(row: Record<string, unknown>): DashboardActionRow {
  return {
    id: asText(row.id) ?? "unknown",
    actionId: asText(row.action_id) ?? asText(row.id) ?? "action",
    client: asText(row.client ?? row.customer_name ?? row.wa_id ?? row.opportunity_key) ?? "Sin cliente",
    actionType: asText(row.action_type) ?? "unknown",
    status: asText(row.status) ?? "unknown",
    riskLevel: asText(row.risk_level) ?? "unknown",
    approvalRequirement: asText(row.approval_requirement) ?? "unknown",
    scheduledFor: asIso(row.scheduled_for),
    updatedAt: asIso(row.updated_at ?? row.created_at),
    source: "crm_agent_actions"
  };
}

function mapCustomerRow(row: Record<string, unknown>): DashboardCustomerRow {
  const id = asText(row.id) ?? "unknown";
  return {
    id,
    displayName: asText(row.displayName ?? row.display_name ?? row.firstname ?? row.email) ?? "Sin nombre",
    email: asText(row.email) ?? "-",
    identityState: asText(row.identityState ?? row.identity_state) ?? "unknown",
    platformOrigin: asText(row.platformOrigin ?? row.platform_origin) ?? "unknown",
    lastActivity: asIso(row.lastActivity ?? row.last_activity),
    source: asText(row.source) ?? "master_customer",
    href: `/customers/${id}`
  };
}

async function loadHealth(): Promise<DashboardHealthItem[]> {
  const db = await safeScalar("SELECT 1");
  const metaConfigured = Boolean(process.env.META_ACCESS_TOKEN && (process.env.DEFAULT_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID));
  const n8nConfigured = Boolean(process.env.N8N_BASE_URL?.trim());
  const outboxWorkerEnabled = process.env.BRAIN_OUTBOX_WORKER_ENABLED?.trim() === "true";
  const writeEnabled = isDbWriteEnabled();
  const outboxTable = await hasTable("brain_message_outbox");
  const actionTable = await hasTable("crm_agent_actions");

  const n8nHealth = n8nConfigured
    ? await (async () => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3500);
          const response = await fetch(process.env.N8N_BASE_URL as string, { signal: controller.signal, cache: "no-store" });
          clearTimeout(timeout);
          return {
            status: response.ok ? ("ok" as const) : ("warning" as const),
            description: response.ok ? "N8N_BASE_URL respondio." : `N8N_BASE_URL respondio HTTP ${response.status}.`,
            details: "Transito legado visible, pero la operacion manual no depende de n8n."
          };
        } catch (error) {
          return {
            status: "warning" as const,
            description: "n8n no respondio o no esta disponible.",
            details: error instanceof Error ? error.message : String(error)
          };
        }
      })()
    : {
        status: "warning" as const,
        description: "N8N_BASE_URL no configurado.",
        details: "La webapp sigue operando con DB y Meta configurados."
      };

  return [
    {
      key: "db",
      label: "Base de datos",
      status: db.ok ? "ok" : "error",
      description: db.ok ? "Conexión MySQL/MariaDB disponible." : "No se pudo conectar a la base de datos.",
      details: db.ok ? "Query SELECT 1 completada." : db.error
    },
    {
      key: "meta",
      label: "Meta WhatsApp",
      status: metaConfigured ? "ok" : "warning",
      description: metaConfigured ? "Meta configurado para envío y callbacks." : "Falta configuración de Meta para envío real.",
      details: "Validación local de configuración."
    },
    {
      key: "n8n",
      label: "n8n",
      status: n8nHealth.status,
      description: n8nHealth.description,
      details: n8nHealth.details
    },
    {
      key: "write",
      label: "DB writer",
      status: writeEnabled ? "ok" : "warning",
      description: writeEnabled ? "Escrituras operativas habilitadas." : "DB_WRITE_ENABLED=false.",
      details: "Protección de side effects activa."
    },
    {
      key: "outbox_worker",
      label: "Outbox worker",
      status: outboxWorkerEnabled ? "ok" : "warning",
      description: outboxWorkerEnabled ? "Worker configurado como activo." : "Worker no habilitado por flag.",
      details: outboxTable ? "Tabla brain_message_outbox disponible." : "brain_message_outbox no disponible."
    },
    {
      key: "action_queue",
      label: "Action queue",
      status: actionTable ? "ok" : "warning",
      description: actionTable ? "crm_agent_actions disponible." : "crm_agent_actions no disponible.",
      details: "La cola de acciones todavía puede mostrar review/pending."
    }
  ];
}

function metricStateForCount(count: number, emphasizeWarning = false): DashboardMetricState {
  if (count < 0) return "error";
  if (count === 0) return emphasizeWarning ? "muted" : "ok";
  return emphasizeWarning ? "warning" : "ok";
}

function buildModuleStates(input: {
  conversationsAvailable: boolean;
  casesAvailable: boolean;
  customersAvailable: boolean;
  opportunitiesAvailable: boolean;
  actionsAvailable: boolean;
  dashboardWarnings: string[];
  openConversations: number;
  legacyCases: number;
  customersTotal: number;
  opportunitiesActive: number;
  actionsPending: number;
}): DashboardModuleState[] {
  const coreHealthy =
    input.conversationsAvailable &&
    input.customersAvailable &&
    input.opportunitiesAvailable &&
    input.actionsAvailable;

  return [
    {
      module: "dashboard",
      label: "Dashboard",
      mode: coreHealthy ? "real" : "partial",
      available: true,
      source: "native_read_models",
      summary: `${input.openConversations} conversaciones activas · ${input.opportunitiesActive} oportunidades abiertas`,
      warnings: input.dashboardWarnings,
      href: "/dashboard"
    },
    {
      module: "conversations",
      label: "Conversations",
      mode: input.conversationsAvailable ? "real" : "error",
      available: input.conversationsAvailable,
      source: "conversation",
      summary: `${input.openConversations} activas`,
      warnings: input.conversationsAvailable ? [] : ["conversation_table_unavailable"],
      href: "/conversations"
    },
    {
      module: "cases",
      label: "Cases",
      mode: input.casesAvailable ? "partial" : "error",
      available: input.casesAvailable,
      source: "n8n_vw_hub_cases",
      summary: input.casesAvailable ? `${input.legacyCases} filas legacy visibles` : "Legacy view no disponible",
      warnings: input.casesAvailable ? ["legacy_cases_backing"] : ["n8n_vw_hub_cases_unavailable"],
      href: "/cases"
    },
    {
      module: "customers",
      label: "Customers",
      mode: input.customersAvailable ? "real" : "error",
      available: input.customersAvailable,
      source: "master_customer",
      summary: `${input.customersTotal} clientes`,
      warnings: input.customersAvailable ? [] : ["master_customer_unavailable"],
      href: "/customers"
    },
    {
      module: "opportunities",
      label: "Opportunities",
      mode: input.opportunitiesAvailable ? "real" : "error",
      available: input.opportunitiesAvailable,
      source: "crm_opportunities",
      summary: `${input.opportunitiesActive} activas`,
      warnings: input.opportunitiesAvailable ? [] : ["crm_opportunities_unavailable"],
      href: "/opportunities"
    },
    {
      module: "actions",
      label: "Actions",
      mode: input.actionsAvailable ? "real" : "error",
      available: input.actionsAvailable,
      source: "crm_agent_actions",
      summary: `${input.actionsPending} pendientes de revisión o ejecución`,
      warnings: input.actionsAvailable ? [] : ["crm_agent_actions_unavailable"],
      href: "/actions"
    }
  ];
}

function buildMetric(
  key: string,
  title: string,
  value: string | number,
  description: string,
  icon: string,
  state: DashboardMetricState,
  error?: string
): DashboardMetric {
  return { key, title, value, description, state, icon, ...(error ? { error } : {}) };
}

export async function getDashboardData(): Promise<DashboardData> {
  const generatedAt = new Date().toISOString();

  const [
    conversationsResult,
    customersResult,
    conversationTableAvailable,
    customerTableAvailable,
    opportunityTableAvailable,
    actionTableAvailable,
    outboxTableAvailable,
    decisionTableAvailable,
    legacyCasesTableAvailable,
    openConversationsCount,
    customersCount,
    openOpportunitiesCount,
    pendingActionsCount,
    outboxPendingCount,
    messagesTodayCount,
    decisionsTodayCount,
    legacyCaseCount
  ] = await Promise.all([
    listConversations({ page: 1 }),
    listCustomers({ page: 1, pageSize: 6 }),
    hasTable("conversation"),
    hasTable("master_customer"),
    hasTable("crm_opportunities"),
    hasTable("crm_agent_actions"),
    hasTable("brain_message_outbox"),
    hasTable("crm_agent_decisions"),
    hasTable("n8n_vw_hub_cases"),
    countRowsIfAvailable("conversation", "SELECT COUNT(*) AS total FROM conversation WHERE COALESCE(status, '') NOT IN ('closed', 'resolved', 'done', 'cancelled', 'archived', 'finalized')"),
    countRowsIfAvailable("master_customer", "SELECT COUNT(*) AS total FROM master_customer"),
    countRowsIfAvailable("crm_opportunities", "SELECT COUNT(*) AS total FROM crm_opportunities WHERE COALESCE(status, '') NOT IN ('won', 'lost', 'cancelled', 'archived')"),
    countRowsIfAvailable("crm_agent_actions", "SELECT COUNT(*) AS total FROM crm_agent_actions WHERE status IN ('proposed', 'requires_review', 'approved', 'planned', 'scheduled')"),
    countRowsIfAvailable("brain_message_outbox", "SELECT COUNT(*) AS total FROM brain_message_outbox WHERE status IN ('planned', 'locked')"),
    countRowsIfAvailable("conversation_message", `SELECT COUNT(*) AS total FROM conversation_message WHERE DATE(COALESCE(provider_timestamp, created_at)) = ${CHILE_TODAY_SQL}`),
    countRowsIfAvailable("crm_agent_decisions", `SELECT COUNT(*) AS total FROM crm_agent_decisions WHERE DATE(created_at) = ${CHILE_TODAY_SQL}`),
    countRowsIfAvailable("n8n_vw_hub_cases", "SELECT COUNT(*) AS total FROM n8n_vw_hub_cases")
  ]);

  const recentConversations = (conversationsResult.items ?? []).slice(0, 6).map((item) => mapConversationRow({
    id: item.id,
    public_id: item.id,
    external_contact_id: item.waId,
    contactName: item.contactName,
    status: item.status,
    priority: item.priority,
    lastMessage: item.lastMessage,
    lastMessageAt: item.lastMessageAt,
    source: item.source
  }));

  const recentCustomers = (customersResult.items ?? []).slice(0, 6).map((item) => mapCustomerRow({
    id: item.id,
    displayName: item.displayName,
    email: item.email,
    identityState: item.identityState,
    platform_origin: item.platformOrigin,
    lastActivity: item.lastActivity,
    source: item.source
  }));

  const recentOpportunitiesResult = opportunityTableAvailable
    ? await safeQueryRows<Record<string, unknown>>(
        `
          SELECT
            id,
            opportunity_key,
            wa_id,
            status,
            stage,
            current_summary,
            next_action_type,
            last_activity_at,
            updated_at,
            created_at
          FROM crm_opportunities
          ORDER BY COALESCE(last_activity_at, updated_at, created_at) DESC, id DESC
          LIMIT 6
        `
      )
    : { ok: false as const, rows: [] as Record<string, unknown>[], error: "crm_opportunities_unavailable" };

  const recentActionsResult = actionTableAvailable
    ? await safeQueryRows<Record<string, unknown>>(
        `
          SELECT
            id,
            action_id,
            wa_id,
            opportunity_key,
            action_type,
            status,
            risk_level,
            approval_requirement,
            scheduled_for,
            updated_at,
            created_at
          FROM crm_agent_actions
          ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
          LIMIT 6
        `
      )
    : { ok: false as const, rows: [] as Record<string, unknown>[], error: "crm_agent_actions_unavailable" };

  const moduleWarnings = [
    !conversationTableAvailable ? "conversation_table_unavailable" : null,
    !customerTableAvailable ? "master_customer_unavailable" : null,
    !opportunityTableAvailable ? "crm_opportunities_unavailable" : null,
    !actionTableAvailable ? "crm_agent_actions_unavailable" : null,
    !outboxTableAvailable ? "brain_message_outbox_unavailable" : null
  ].filter((warning): warning is string => Boolean(warning));

  const conversationsActive = openConversationsCount.ok ? openConversationsCount.value : 0;
  const customersTotal = customersCount.ok ? customersCount.value : Number(customersResult.pagination.total ?? 0);
  const opportunitiesActive = openOpportunitiesCount.ok ? openOpportunitiesCount.value : 0;
  const actionsPending = pendingActionsCount.ok ? pendingActionsCount.value : 0;
  const outboxPending = outboxPendingCount.ok ? outboxPendingCount.value : 0;
  const messagesToday = messagesTodayCount.ok ? messagesTodayCount.value : 0;
  const decisionsToday = decisionsTodayCount.ok ? decisionsTodayCount.value : 0;

  const latestDecision = decisionTableAvailable
    ? await (async () => {
        const result = await safeQueryRows<Record<string, unknown>>(
          `
            SELECT decision_id, next_status, next_stage, rationale, created_at
            FROM crm_agent_decisions
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          `
        );
        const row = result.ok ? result.rows[0] : null;
        if (!row) return null;
        return {
          decisionId: asText(row.decision_id) ?? "decision",
          nextStatus: asText(row.next_status) ?? "unknown",
          nextStage: asText(row.next_stage),
          rationale: asText(row.rationale) ?? "Operational decision recorded.",
          createdAt: asIso(row.created_at) ?? generatedAt
        };
      })()
    : null;

  const recentOpportunities = (recentOpportunitiesResult.ok ? recentOpportunitiesResult.rows : []).map((row) => mapOpportunityRow(row));
  const recentActions = (recentActionsResult.ok ? recentActionsResult.rows : []).map((row) => mapActionRow(row));

  const pulse: DashboardPulse = {
    conversationsActive,
    customersTotal,
    opportunitiesActive,
    actionsPending,
    outboxPending,
    messagesToday,
    decisionsToday,
    latestDecision,
    latestMessageAt: recentConversations[0]?.lastMessageAt ?? null,
    latestActionAt: recentActions[0]?.updatedAt ?? null
  };

  const health = await loadHealth();
  const moduleStates = buildModuleStates({
    conversationsAvailable: conversationTableAvailable,
    casesAvailable: legacyCasesTableAvailable,
    customersAvailable: customerTableAvailable,
    opportunitiesAvailable: opportunityTableAvailable,
    actionsAvailable: actionTableAvailable,
    dashboardWarnings: moduleWarnings,
    openConversations: conversationsActive,
    legacyCases: legacyCaseCount.ok ? legacyCaseCount.value : 0,
    customersTotal,
    opportunitiesActive,
    actionsPending
  });

  const metrics = [
    buildMetric(
      "open_conversations",
      "Conversaciones activas",
      conversationsActive,
      "En cola nativa de conversaciones",
      "forum",
      metricStateForCount(conversationsActive, true),
      openConversationsCount.error ?? undefined
    ),
    buildMetric(
      "customers_total",
      "Clientes reales",
      customersTotal,
      "Desde master_customer",
      "person",
      metricStateForCount(customersTotal),
      customersCount.error ?? undefined
    ),
    buildMetric(
      "opportunities_active",
      "Oportunidades activas",
      opportunitiesActive,
      "Pipeline native de crm_opportunities",
      "target",
      metricStateForCount(opportunitiesActive, true),
      openOpportunitiesCount.error ?? undefined
    ),
    buildMetric(
      "actions_pending",
      "Acciones pendientes",
      actionsPending,
      "Review, approval, planned o scheduled",
      "bolt",
      metricStateForCount(actionsPending, true),
      pendingActionsCount.error ?? undefined
    ),
    buildMetric(
      "outbox_pending",
      "Outbox pendiente",
      outboxPending,
      "Borradores y locks a la espera del worker",
      "send",
      metricStateForCount(outboxPending, true),
      outboxPendingCount.error ?? undefined
    ),
    buildMetric(
      "messages_today",
      "Mensajes hoy",
      messagesToday,
      "Inbound + outbound del día",
      "message",
      stateForCount(messagesToday),
      messagesTodayCount.error ?? undefined
    )
  ];

  return {
    generatedAt,
    metrics,
    health,
    moduleStates,
    pulse,
    recentConversations,
    recentOpportunities,
    recentActions,
    recentCustomers,
    warnings: moduleWarnings.concat(
      health.filter((item) => item.status !== "ok").map((item) => `${item.key}:${item.status}`)
    )
  };
}

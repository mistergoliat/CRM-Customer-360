import { safeQueryRows, safeScalar } from "./db";
import { getSystemCapabilities } from "./domains/runtime/capability-registry";

type DashboardMetric = {
  key: string;
  title: string;
  value: string | number;
  description: string;
  state: "ok" | "warning" | "error" | "muted";
  icon: string;
  error?: string;
};

type N8nHealth = {
  status: "ok" | "warning" | "error";
  description: string;
  details: string;
  configured: boolean;
};

async function metric(key: string, title: string, sql: string, description: string, icon: string): Promise<DashboardMetric> {
  const result = await safeScalar(sql);
  if (!result.ok) {
    return { key, title, value: "query_error", description: result.error, state: "error", icon, error: result.error };
  }
  return { key, title, value: Number(result.value ?? 0), description, state: "ok", icon };
}

async function getN8nHealth(): Promise<N8nHealth> {
  const n8nUrl = process.env.N8N_BASE_URL?.trim();
  const configured = Boolean(n8nUrl);
  if (!n8nUrl) {
    return {
      status: "warning",
      description: "N8N_BASE_URL no configurado.",
      details: "La webapp sigue operando con DB y Meta configurados.",
      configured
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const response = await fetch(n8nUrl, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        status: "error",
        description: `N8N_BASE_URL respondio HTTP ${response.status}.`,
        details: "La continuidad del HUB no depende de n8n para operar manualmente.",
        configured
      };
    }

    return {
      status: "ok",
      description: "N8N_BASE_URL respondio.",
      details: "El HUB no depende de esta respuesta para operar casos manualmente.",
      configured
    };
  } catch (error) {
    return {
      status: "error",
      description: "n8n no respondio o no esta disponible.",
      details: error instanceof Error ? error.message : String(error),
      configured
    };
  }
}

export async function getDashboardData() {
  const settledMetrics = await Promise.allSettled([
    metric("open_cases", "Casos abiertos", "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE COALESCE(status, '') NOT IN ('closed', 'resolved', 'done')", "Desde n8n_vw_hub_cases", "assignment"),
    metric("human_required", "Requieren humano", "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE requires_human = 1", "Operación manual prioritaria", "support_agent"),
    metric("inbound_today", "Inbound hoy", "SELECT COUNT(*) FROM n8n_wa_inbound_messages WHERE DATE(COALESCE(occurred_at, created_at)) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00'))", "Mensajes recibidos en hora Chile", "call_received"),
    metric("outbound_today", "Outbound hoy", "SELECT COUNT(*) FROM n8n_conversation_messages WHERE (direction IN ('outbound', 'manual') OR message_direction IN ('outbound', 'manual')) AND DATE(COALESCE(occurred_at, created_at)) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00'))", "Respuestas registradas en DB", "send"),
    metric("created_today", "Casos creados hoy", "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE DATE(created_at) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00'))", "Nuevos casos detectados", "add_task"),
    metric("updated_today", "Actualizados hoy", "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE DATE(updated_at) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00'))", "Casos con actividad reciente", "update"),
    metric("priority_cases", "Prioritarios", "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE priority IN ('high', 'urgent')", "Prioridad high/urgent", "priority_high"),
    metric("whatsapp_window", "Ventana 24h abierta", "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE whatsapp_window_open = 1", "Casos donde Meta permite texto libre", "schedule"),
    metric("master_customers", "Clientes reales", "SELECT COUNT(*) FROM master_customer", "Desde master_customer", "person")
  ]);

  const metrics = settledMetrics.map((entry, index) => {
    if (entry.status === "fulfilled") return entry.value;
    return {
      key: `metric_${index}`,
      title: "Métrica no disponible",
      value: "error",
      description: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
      state: "error" as const,
      icon: "error"
    };
  });

  const [recentCasesResult, recentAuditResult, dbHealthResult, customerCountResult, n8nHealthResult, capabilitiesResult] = await Promise.allSettled([
    safeQueryRows("SELECT * FROM n8n_vw_hub_cases ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT 8"),
    safeQueryRows("SELECT * FROM hub_audit_log ORDER BY created_at DESC LIMIT 8"),
    safeQueryRows("SELECT 1 AS ok"),
    safeScalar("SELECT COUNT(*) FROM master_customer"),
    getN8nHealth(),
    getSystemCapabilities()
  ]);

  const recentCases = recentCasesResult.status === "fulfilled" ? recentCasesResult.value : { ok: false as const, rows: [], error: "recent_cases_failed" };
  const recentAudit = recentAuditResult.status === "fulfilled" ? recentAuditResult.value : { ok: false as const, rows: [], error: "recent_audit_failed" };
  const dbHealth = dbHealthResult.status === "fulfilled" ? dbHealthResult.value : { ok: false as const, rows: [], error: "db_health_failed" };
  const customerCount = customerCountResult.status === "fulfilled" ? customerCountResult.value : { ok: false as const, value: 0, error: "customer_count_failed" };
  const n8nHealth = n8nHealthResult.status === "fulfilled" ? n8nHealthResult.value : { status: "error" as const, description: "n8n_health_failed", details: String(n8nHealthResult.reason), configured: false };
  const capabilities = capabilitiesResult.status === "fulfilled" ? capabilitiesResult.value : { modules: [], warnings: ["capabilities_failed"], checkedAt: new Date().toISOString() };

  return {
    metrics,
    recentCases,
    recentAudit,
    dbHealth,
    customerCount: customerCount.ok ? Number(customerCount.value ?? 0) : 0,
    capabilities,
    metaConfigured: Boolean(process.env.META_ACCESS_TOKEN && (process.env.DEFAULT_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID)),
    n8nConfigured: n8nHealth.configured,
    n8nHealth
  };
}

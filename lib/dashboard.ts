import { safeQueryRows, safeScalar } from "./db";

type DashboardMetric = {
  key: string;
  title: string;
  value: string | number;
  description: string;
  state: "ok" | "warning" | "error" | "muted";
  icon: string;
  error?: string;
};

async function metric(key: string, title: string, sql: string, description: string, icon: string): Promise<DashboardMetric> {
  const result = await safeScalar(sql);
  if (!result.ok) {
    return { key, title, value: "query_error", description: result.error, state: "error", icon, error: result.error };
  }
  return { key, title, value: Number(result.value ?? 0), description, state: "ok", icon };
}

export async function getDashboardData() {
  const metrics = await Promise.all([
    metric(
      "open_cases",
      "Casos abiertos",
      "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE COALESCE(status, '') NOT IN ('closed', 'resolved', 'done')",
      "Desde n8n_vw_hub_cases",
      "assignment"
    ),
    metric(
      "human_required",
      "Requieren humano",
      "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE requires_human = 1",
      "Operación manual prioritaria",
      "support_agent"
    ),
    metric(
      "inbound_today",
      "Inbound hoy",
      "SELECT COUNT(*) FROM n8n_wa_inbound_messages WHERE DATE(COALESCE(occurred_at, created_at)) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00'))",
      "Mensajes recibidos en hora Chile",
      "call_received"
    ),
    metric(
      "outbound_today",
      "Outbound hoy",
      "SELECT COUNT(*) FROM n8n_conversation_messages WHERE (direction IN ('outbound', 'manual') OR message_direction IN ('outbound', 'manual')) AND DATE(COALESCE(occurred_at, created_at)) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00'))",
      "Respuestas registradas en DB",
      "send"
    ),
    metric(
      "created_today",
      "Casos creados hoy",
      "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE DATE(created_at) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00'))",
      "Nuevos casos detectados",
      "add_task"
    ),
    metric(
      "updated_today",
      "Actualizados hoy",
      "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE DATE(updated_at) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00'))",
      "Casos con actividad reciente",
      "update"
    ),
    metric(
      "priority_cases",
      "Prioritarios",
      "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE priority IN ('high', 'urgent')",
      "Prioridad high/urgent",
      "priority_high"
    ),
    metric(
      "whatsapp_window",
      "Ventana 24h abierta",
      "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE whatsapp_window_open = 1",
      "Casos donde Meta permite texto libre",
      "schedule"
    )
  ]);

  const recentCases = await safeQueryRows(
    "SELECT * FROM n8n_vw_hub_cases ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT 8"
  );
  const recentAudit = await safeQueryRows("SELECT * FROM hub_audit_log ORDER BY created_at DESC LIMIT 8");
  const dbHealth = await safeQueryRows("SELECT 1 AS ok");

  return {
    metrics,
    recentCases,
    recentAudit,
    dbHealth,
    metaConfigured: Boolean(process.env.META_ACCESS_TOKEN && (process.env.DEFAULT_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID)),
    n8nConfigured: Boolean(process.env.N8N_BASE_URL)
  };
}

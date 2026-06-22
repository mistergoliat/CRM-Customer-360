"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardData = getDashboardData;
const db_1 = require("./db");
async function metric(key, title, sql, description, icon) {
    const result = await (0, db_1.safeScalar)(sql);
    if (!result.ok) {
        return { key, title, value: "query_error", description: result.error, state: "error", icon, error: result.error };
    }
    return { key, title, value: Number(result.value ?? 0), description, state: "ok", icon };
}
async function getN8nHealth() {
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
    }
    catch (error) {
        return {
            status: "error",
            description: "n8n no respondio o no esta disponible.",
            details: error instanceof Error ? error.message : String(error),
            configured
        };
    }
}
async function getDashboardData() {
    const metrics = await Promise.all([
        metric("open_cases", "Casos abiertos", "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE COALESCE(status, '') NOT IN ('closed', 'resolved', 'done')", "Desde n8n_vw_hub_cases", "assignment"),
        metric("human_required", "Requieren humano", "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE requires_human = 1", "Operación manual prioritaria", "support_agent"),
        metric("inbound_today", "Inbound hoy", "SELECT COUNT(*) FROM n8n_wa_inbound_messages WHERE DATE(COALESCE(occurred_at, created_at)) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00'))", "Mensajes recibidos en hora Chile", "call_received"),
        metric("outbound_today", "Outbound hoy", "SELECT COUNT(*) FROM n8n_conversation_messages WHERE (direction IN ('outbound', 'manual') OR message_direction IN ('outbound', 'manual')) AND DATE(COALESCE(occurred_at, created_at)) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00'))", "Respuestas registradas en DB", "send"),
        metric("created_today", "Casos creados hoy", "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE DATE(created_at) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00'))", "Nuevos casos detectados", "add_task"),
        metric("updated_today", "Actualizados hoy", "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE DATE(updated_at) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00'))", "Casos con actividad reciente", "update"),
        metric("priority_cases", "Prioritarios", "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE priority IN ('high', 'urgent')", "Prioridad high/urgent", "priority_high"),
        metric("whatsapp_window", "Ventana 24h abierta", "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE whatsapp_window_open = 1", "Casos donde Meta permite texto libre", "schedule")
    ]);
    const recentCases = await (0, db_1.safeQueryRows)("SELECT * FROM n8n_vw_hub_cases ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT 8");
    const recentAudit = await (0, db_1.safeQueryRows)("SELECT * FROM hub_audit_log ORDER BY created_at DESC LIMIT 8");
    const dbHealth = await (0, db_1.safeQueryRows)("SELECT 1 AS ok");
    const n8nHealth = await getN8nHealth();
    return {
        metrics,
        recentCases,
        recentAudit,
        dbHealth,
        metaConfigured: Boolean(process.env.META_ACCESS_TOKEN && (process.env.DEFAULT_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID)),
        n8nConfigured: n8nHealth.configured,
        n8nHealth
    };
}

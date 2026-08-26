import { recentInboundMessages, recentOutboundMessages } from "./cases";
import { safeScalar } from "./db";
import { PrestashopDbConfigurationError, readPrestashopDbConfig } from "./integrations/prestashop-mirror/config";
import { getPrestashopQueryExecutor } from "./integrations/prestashop-mirror/pool";
import { isDbWriteEnabled } from "./write-access";

export type HealthItem = {
  key: string;
  status: "ok" | "warning" | "error";
  title: string;
  description: string;
  details?: string;
};

export async function getSystemHealth(): Promise<{ generatedAt: string; items: HealthItem[] }> {
  const items: HealthItem[] = [];

  const db = await safeScalar("SELECT 1");
  items.push({
    key: "db",
    title: "Base de datos",
    status: db.ok ? "ok" : "error",
    description: db.ok ? "Conexión MySQL/MariaDB disponible." : "No se pudo conectar a la base de datos.",
    details: db.ok ? undefined : db.error
  });

  const openCases = await safeScalar(
    "SELECT COUNT(*) FROM n8n_vw_hub_cases WHERE COALESCE(status, '') NOT IN ('closed', 'resolved', 'done')"
  );
  items.push({
    key: "open_cases",
    title: "Casos abiertos",
    status: openCases.ok ? "ok" : "warning",
    description: openCases.ok ? `${openCases.value ?? 0} casos abiertos detectados.` : "No se pudo consultar casos abiertos.",
    details: openCases.ok ? undefined : openCases.error
  });

  const inbound = await recentInboundMessages(5);
  items.push({
    key: "inbound",
    title: "Inbound recientes",
    status: inbound.ok ? "ok" : "warning",
    description: inbound.ok ? `${inbound.rows.length} mensajes inbound recientes disponibles.` : "Consulta inbound falló.",
    details: inbound.ok ? undefined : inbound.error
  });

  const outbound = await recentOutboundMessages(5);
  items.push({
    key: "outbound",
    title: "Outbound recientes",
    status: outbound.ok ? "ok" : "warning",
    description: outbound.ok ? `${outbound.rows.length} mensajes outbound recientes disponibles.` : "Consulta outbound falló.",
    details: outbound.ok ? undefined : outbound.error
  });

  items.push({
    key: "meta_config",
    title: "Meta WhatsApp config",
    status: process.env.META_ACCESS_TOKEN && (process.env.DEFAULT_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID) ? "ok" : "warning",
    description:
      process.env.META_ACCESS_TOKEN && (process.env.DEFAULT_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID)
        ? "Token y phone_number_id configurados. No se hizo llamada invasiva a Meta."
        : "Falta META_ACCESS_TOKEN o DEFAULT_PHONE_NUMBER_ID.",
    details: "Validación local de configuración solamente."
  });

  // ID-R2-A11.1 PARTE 12: identity onboarding's PrestaShop candidate reads
  // (email/order-reference) depend on this source. A misconfigured
  // production_db surfaces as "error" here without ever falling back to
  // main_management; a live column probe distinguishes "reachable" from
  // "unavailable" the same way the "db" item above does, and never takes
  // down the rest of this health report (own try/catch, own item).
  try {
    const config = readPrestashopDbConfig();
    const executor = getPrestashopQueryExecutor();
    const columns = await executor.getColumns("ps_customer");
    const available = columns.length > 0;
    items.push({
      key: "prestashop_identity_db",
      title: "PrestaShop identity source",
      status: available ? "ok" : "warning",
      description:
        config.source === "production_db"
          ? available
            ? `Conectado a la base productiva configurada (${config.database}).`
            : `PRESTASHOP_IDENTITY_SOURCE=production_db (${config.database}) configurado, pero ps_customer no respondió.`
          : available
            ? "Usando el mirror local compartido (PRESTASHOP_IDENTITY_SOURCE no configurado)."
            : "Usando el mirror local compartido; ps_customer no disponible.",
      details: config.source === "production_db" ? `source=production_db host=${config.host}` : "source=local_mirror"
    });
  } catch (error) {
    items.push({
      key: "prestashop_identity_db",
      title: "PrestaShop identity source",
      status: "error",
      description: "PRESTASHOP_IDENTITY_SOURCE=production_db configurado de forma incompleta o inválida.",
      details: error instanceof PrestashopDbConfigurationError ? error.message : error instanceof Error ? error.message : String(error)
    });
  }

  items.push({
    key: "db_write",
    title: "DB writer",
    status: isDbWriteEnabled() ? "ok" : "warning",
    description: isDbWriteEnabled()
      ? "Acciones operativas con trazabilidad habilitadas."
      : "DB_WRITE_ENABLED=false. Las acciones de caso quedan bloqueadas por seguridad.",
    details: "No se permite enviar Meta ni escribir en DB sin trazabilidad habilitada."
  });

  if (process.env.N8N_BASE_URL) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const response = await fetch(process.env.N8N_BASE_URL, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timeout);
      items.push({
        key: "n8n",
        title: "n8n",
        status: response.ok ? "ok" : "warning",
        description: response.ok ? "N8N_BASE_URL respondió." : `N8N_BASE_URL respondió HTTP ${response.status}.`,
        details: "El HUB no depende de esta respuesta para operar casos manualmente."
      });
    } catch (error) {
      items.push({
        key: "n8n",
        title: "n8n",
        status: "warning",
        description: "n8n no respondió o no está disponible.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  } else {
    items.push({
      key: "n8n",
      title: "n8n",
      status: "warning",
      description: "N8N_BASE_URL no configurado.",
      details: "La webapp sigue operando con DB y Meta configurados."
    });
  }

  return { generatedAt: new Date().toISOString(), items };
}

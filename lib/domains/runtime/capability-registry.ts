import { hasTable, getColumns, safeScalar } from "@/lib/db";
import { getConfiguredModuleModes, type ModuleDataMode, type ModuleName } from "./data-source-status";
import { createModuleRuntimeStatus, type ModuleRuntimeStatus } from "./module-status";

type ModuleCapabilityContext = {
  module: ModuleName;
  mode: ModuleDataMode;
  available: boolean;
  source: string;
  warnings: string[];
};

const TABLES = {
  conversations: ["n8n_vw_hub_cases", "n8n_conversation_messages", "n8n_wa_inbound_messages"],
  cases: ["n8n_vw_hub_cases", "n8n_conversation_messages"],
  customers: ["master_customer"],
  dashboard: ["n8n_vw_hub_cases", "master_customer", "hub_audit_log"],
  opportunities: ["crm_opportunities"],
  actions: ["crm_agent_actions"],
  marketing: ["marketing_campaigns"],
  knowledge: ["knowledge_articles"],
  analytics: ["analytics_daily_metrics"],
  integrations: ["hub_audit_log"]
} as const satisfies Record<string, readonly string[]>;

async function tablesExist(tableNames: readonly string[]) {
  const results = await Promise.allSettled(tableNames.map((table) => hasTable(table)));
  const warnings: string[] = [];
  const availability = results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    warnings.push(`table_check_failed:${tableNames[index]}`);
    return false;
  });
  return { available: availability.every(Boolean), warnings };
}

async function sourceHealthForTables(tableNames: readonly string[]) {
  const { available, warnings } = await tablesExist(tableNames);
  return { available, warnings };
}

async function buildCapability(module: ModuleName, mode: ModuleDataMode, tables: readonly string[], source: string): Promise<ModuleCapabilityContext> {
  if (mode === "disabled") {
    return { module, mode, available: false, source, warnings: ["module_disabled_by_config"] };
  }

  const health = await sourceHealthForTables(tables);
  const warnings = [...health.warnings];
  if (!health.available && mode === "real") {
    warnings.push("required_tables_missing");
  }

  const available = mode === "real" ? health.available : mode !== "error";
  return { module, mode: available ? mode : "error", available, source, warnings };
}

export async function getSystemCapabilities() {
  const modes = getConfiguredModuleModes();
  const now = new Date().toISOString();
  const capabilities: ModuleRuntimeStatus[] = [];

  const conversationCapability = await buildCapability("conversations", modes.conversations, TABLES.conversations, "n8n_legacy_tables");
  capabilities.push(createModuleRuntimeStatus({ ...conversationCapability, checkedAt: now }));

  const casesCapability = await buildCapability("cases", modes.cases, TABLES.cases, "n8n_legacy_tables");
  capabilities.push(createModuleRuntimeStatus({ ...casesCapability, checkedAt: now }));

  const customerTables = TABLES.customers;
  const customerHealth = await sourceHealthForTables(customerTables);
  capabilities.push(
    createModuleRuntimeStatus({
      module: "customers",
      mode: customerHealth.available && modes.customers !== "disabled" ? (modes.customers === "partial" ? "partial" : modes.customers === "fixture" ? "partial" : modes.customers === "error" ? "error" : "real") : "error",
      available: customerHealth.available && modes.customers !== "disabled",
      source: "master_customer",
      warnings: customerHealth.available ? [] : ["master_customer_missing"],
      checkedAt: now
    })
  );

  capabilities.push(
    createModuleRuntimeStatus({
      module: "dashboard",
      mode: modes.dashboard === "disabled" ? "disabled" : "partial",
      available: true,
      source: "modular_runtime_projection",
      warnings: ["mixed_real_and_fixture_sections"],
      checkedAt: now
    })
  );

  capabilities.push(
    createModuleRuntimeStatus({
      module: "opportunities",
      mode: modes.opportunities,
      available: modes.opportunities !== "disabled",
      source: "fixture_projection",
      warnings: modes.opportunities === "fixture" ? ["fixture_backed"] : [],
      checkedAt: now
    })
  );

  capabilities.push(
    createModuleRuntimeStatus({
      module: "actions",
      mode: modes.actions,
      available: modes.actions !== "disabled",
      source: "mixed_runtime_projection",
      warnings: modes.actions === "fixture" ? ["partial_fixture_backed"] : [],
      checkedAt: now
    })
  );

  capabilities.push(
    createModuleRuntimeStatus({
      module: "marketing",
      mode: modes.marketing,
      available: modes.marketing !== "disabled",
      source: "fixture_projection",
      warnings: modes.marketing === "fixture" ? ["fixture_backed"] : [],
      checkedAt: now
    })
  );

  capabilities.push(
    createModuleRuntimeStatus({
      module: "knowledge",
      mode: modes.knowledge,
      available: modes.knowledge !== "disabled",
      source: "fixture_projection",
      warnings: modes.knowledge === "fixture" ? ["fixture_backed"] : [],
      checkedAt: now
    })
  );

  capabilities.push(
    createModuleRuntimeStatus({
      module: "analytics",
      mode: modes.analytics,
      available: modes.analytics !== "disabled",
      source: "mixed_runtime_projection",
      warnings: modes.analytics === "partial" ? ["some_metrics_fixture_backed"] : [],
      checkedAt: now
    })
  );

  capabilities.push(
    createModuleRuntimeStatus({
      module: "integrations",
      mode: modes.integrations,
      available: modes.integrations !== "disabled",
      source: "system_health_projection",
      warnings: [],
      checkedAt: now
    })
  );

  const dashboardWarnings = Array.from(
    new Set(
      capabilities.flatMap((capability) => capability.module === "dashboard" ? capability.warnings : [])
    )
  );

  return {
    modules: capabilities,
    warnings: dashboardWarnings,
    checkedAt: now
  };
}

export async function getTableHealthSummary(tableNames: string[]) {
  const results = await Promise.allSettled(tableNames.map(async (table) => {
    const columns = await getColumns(table);
    const count = await safeScalar(`SELECT COUNT(*) AS total FROM \`${table}\``);
    return {
      table,
      available: columns.length > 0,
      columns,
      count: count.ok ? Number(count.value ?? 0) : null,
      countError: count.ok ? null : count.error
    };
  }));

  return results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    return {
      table: tableNames[index],
      available: false,
      columns: [] as string[],
      count: null,
      countError: "table_check_failed"
    };
  });
}

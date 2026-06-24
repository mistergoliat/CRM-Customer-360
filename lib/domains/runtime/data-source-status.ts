export type ModuleDataMode = "real" | "partial" | "fixture" | "disabled" | "error";

export const MODULE_NAMES = [
  "dashboard",
  "conversations",
  "cases",
  "customers",
  "opportunities",
  "actions",
  "marketing",
  "knowledge",
  "analytics",
  "integrations"
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

export type ModuleDataModeConfig = Record<ModuleName, ModuleDataMode>;

const DEFAULT_MODES: ModuleDataModeConfig = {
  dashboard: "partial",
  conversations: "real",
  cases: "real",
  customers: "partial",
  opportunities: "fixture",
  actions: "partial",
  marketing: "fixture",
  knowledge: "fixture",
  analytics: "partial",
  integrations: "partial"
};

const MODE_ENV_MAP: Record<ModuleName, string> = {
  dashboard: "DASHBOARD_DATA_MODE",
  conversations: "CONVERSATIONS_DATA_MODE",
  cases: "CASES_DATA_MODE",
  customers: "CUSTOMERS_DATA_MODE",
  opportunities: "OPPORTUNITIES_DATA_MODE",
  actions: "ACTIONS_DATA_MODE",
  marketing: "MARKETING_DATA_MODE",
  knowledge: "KNOWLEDGE_DATA_MODE",
  analytics: "ANALYTICS_DATA_MODE",
  integrations: "INTEGRATIONS_DATA_MODE"
};

export function parseModuleDataMode(value: string | undefined | null, fallback: ModuleDataMode): ModuleDataMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "real" || normalized === "partial" || normalized === "fixture" || normalized === "disabled" || normalized === "error") {
    return normalized;
  }
  return fallback;
}

export function getConfiguredModuleModes(env: NodeJS.ProcessEnv = process.env): ModuleDataModeConfig {
  return {
    dashboard: parseModuleDataMode(env[DASHBOARD_DATA_MODE_KEY], DEFAULT_MODES.dashboard),
    conversations: parseModuleDataMode(env[MODE_ENV_MAP.conversations], DEFAULT_MODES.conversations),
    cases: parseModuleDataMode(env[MODE_ENV_MAP.cases], DEFAULT_MODES.cases),
    customers: parseModuleDataMode(env[MODE_ENV_MAP.customers], DEFAULT_MODES.customers),
    opportunities: parseModuleDataMode(env[MODE_ENV_MAP.opportunities], DEFAULT_MODES.opportunities),
    actions: parseModuleDataMode(env[MODE_ENV_MAP.actions], DEFAULT_MODES.actions),
    marketing: parseModuleDataMode(env[MODE_ENV_MAP.marketing], DEFAULT_MODES.marketing),
    knowledge: parseModuleDataMode(env[MODE_ENV_MAP.knowledge], DEFAULT_MODES.knowledge),
    analytics: parseModuleDataMode(env[MODE_ENV_MAP.analytics], DEFAULT_MODES.analytics),
    integrations: parseModuleDataMode(env[MODE_ENV_MAP.integrations], DEFAULT_MODES.integrations)
  };
}

export function isModuleDataMode(value: string | undefined | null): value is ModuleDataMode {
  return value === "real" || value === "partial" || value === "fixture" || value === "disabled" || value === "error";
}

const DASHBOARD_DATA_MODE_KEY = "DASHBOARD_DATA_MODE";

export function getDefaultModuleModes() {
  return { ...DEFAULT_MODES };
}

export function getModuleModeLabel(mode: ModuleDataMode) {
  switch (mode) {
    case "real":
      return "Real";
    case "partial":
      return "Parcial";
    case "fixture":
      return "Fixture";
    case "disabled":
      return "Deshabilitado";
    case "error":
    default:
      return "Error";
  }
}

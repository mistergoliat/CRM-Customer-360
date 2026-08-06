import type { CustomerHistoryCommercialPolicyConfig, CustomerProfileContextConfig } from "./types";

const DEFAULT_PURCHASED_PRODUCTS_LIMIT = 20;
const DEFAULT_TOP_PRODUCTS_LIMIT = 5;
const DEFAULT_TOP_VARIANTS_LIMIT = 5;
const DEFAULT_RECENT_PURCHASES_LIMIT = 5;
/** CP-R1-T12D. */
const DEFAULT_RECENT_PURCHASE_WINDOW_DAYS = 90;
const DEFAULT_MAX_SIGNALS = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readFlag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function readPositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readCustomerProfileContextConfig(env: NodeJS.ProcessEnv = process.env): CustomerProfileContextConfig {
  return {
    contextEnabled: readFlag(env, "CUSTOMER_PROFILE_CONTEXT_ENABLED", false),
    purchasedProductsLimit: clamp(readPositiveInt(env, "CUSTOMER_PROFILE_PURCHASED_PRODUCTS_LIMIT", DEFAULT_PURCHASED_PRODUCTS_LIMIT), 1, 100),
    topProductsLimit: clamp(readPositiveInt(env, "CUSTOMER_PROFILE_TOP_PRODUCTS_LIMIT", DEFAULT_TOP_PRODUCTS_LIMIT), 1, 10),
    topVariantsLimit: clamp(readPositiveInt(env, "CUSTOMER_PROFILE_TOP_VARIANTS_LIMIT", DEFAULT_TOP_VARIANTS_LIMIT), 1, 10),
    recentPurchasesLimit: clamp(readPositiveInt(env, "CUSTOMER_PROFILE_RECENT_PURCHASES_LIMIT", DEFAULT_RECENT_PURCHASES_LIMIT), 1, 10)
  };
}

/**
 * CP-R1-T12D. Independent flag from `contextEnabled` above - the commercial
 * signals/policy layer only ever runs on top of an already-loaded
 * `CustomerCommercialHistoryContext`, but its own runtime activation
 * (deriving signals, filtering by relevance, adding them to the prompt) is
 * gated separately so T12C's existing behavior is exactly preserved while
 * this flag stays at its default `false`.
 */
export function readCustomerHistoryCommercialPolicyConfig(env: NodeJS.ProcessEnv = process.env): CustomerHistoryCommercialPolicyConfig {
  return {
    enabled: readFlag(env, "CUSTOMER_HISTORY_COMMERCIAL_POLICY_ENABLED", false),
    recentPurchaseWindowDays: clamp(readPositiveInt(env, "CUSTOMER_HISTORY_RECENT_PURCHASE_DAYS", DEFAULT_RECENT_PURCHASE_WINDOW_DAYS), 1, 3650),
    maxSignals: clamp(readPositiveInt(env, "CUSTOMER_HISTORY_MAX_SIGNALS", DEFAULT_MAX_SIGNALS), 1, 50)
  };
}

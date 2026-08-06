import type { CustomerProfileContextConfig } from "./types";

const DEFAULT_PURCHASED_PRODUCTS_LIMIT = 20;
const DEFAULT_TOP_PRODUCTS_LIMIT = 5;
const DEFAULT_TOP_VARIANTS_LIMIT = 5;
const DEFAULT_RECENT_PURCHASES_LIMIT = 5;

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

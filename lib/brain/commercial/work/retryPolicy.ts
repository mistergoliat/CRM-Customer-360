import type { CommercialWorkStep } from "./types";

export type CommercialWorkRetryPolicy = {
  stepType: CommercialWorkStep["type"];
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableGatewayStatuses: readonly string[];
  retryableOutcomeCodes: readonly string[];
};

const MINUTE = 60_000;

export const COMMERCIAL_WORK_RETRY_POLICIES: readonly CommercialWorkRetryPolicy[] = [
  {
    stepType: "SEARCH_PRODUCTS",
    maxAttempts: 3,
    baseDelayMs: MINUTE,
    maxDelayMs: 5 * MINUTE,
    retryableGatewayStatuses: ["temporarily_blocked"],
    retryableOutcomeCodes: ["catalog_service_not_configured", "rate_limited", "unavailable", "timeout"]
  },
  {
    stepType: "SELECT_PRODUCTS",
    maxAttempts: 2,
    baseDelayMs: 30_000,
    maxDelayMs: 2 * MINUTE,
    retryableGatewayStatuses: ["temporarily_blocked"],
    retryableOutcomeCodes: ["commercial_line_items_persistence_failed"]
  },
  {
    stepType: "SET_SHIPPING_DESTINATION",
    maxAttempts: 2,
    baseDelayMs: 30_000,
    maxDelayMs: 2 * MINUTE,
    retryableGatewayStatuses: ["temporarily_blocked"],
    retryableOutcomeCodes: ["resolver_error", "shipping_destination_persistence_failed"]
  },
  {
    stepType: "CALCULATE_SHIPPING",
    maxAttempts: 3,
    baseDelayMs: MINUTE,
    maxDelayMs: 5 * MINUTE,
    retryableGatewayStatuses: ["temporarily_blocked"],
    retryableOutcomeCodes: ["catalog_unavailable", "carrier_unavailable", "carrier_timeout", "timeout", "unavailable"]
  },
  {
    stepType: "CREATE_QUOTE",
    maxAttempts: 3,
    baseDelayMs: MINUTE,
    maxDelayMs: 5 * MINUTE,
    retryableGatewayStatuses: ["temporarily_blocked"],
    retryableOutcomeCodes: ["quote_service_not_configured", "catalog_unavailable", "created_quote_persistence_failed", "timeout", "unavailable"]
  }
] as const;

const POLICY_BY_STEP_TYPE = new Map(COMMERCIAL_WORK_RETRY_POLICIES.map((policy) => [policy.stepType, policy]));

export function getCommercialWorkRetryPolicy(step: Pick<CommercialWorkStep, "type">): CommercialWorkRetryPolicy | null {
  return POLICY_BY_STEP_TYPE.get(step.type) ?? null;
}

export function calculateCommercialWorkRetryDelayMs(policy: CommercialWorkRetryPolicy, attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(policy.baseDelayMs * 2 ** exponent, policy.maxDelayMs);
}

export function calculateCommercialWorkNextAttemptAt(input: {
  policy: CommercialWorkRetryPolicy;
  attemptCount: number;
  now: string | Date;
}): string {
  const base = input.now instanceof Date ? input.now : new Date(input.now);
  const safeBase = Number.isNaN(base.getTime()) ? new Date() : base;
  return new Date(safeBase.getTime() + calculateCommercialWorkRetryDelayMs(input.policy, input.attemptCount)).toISOString();
}


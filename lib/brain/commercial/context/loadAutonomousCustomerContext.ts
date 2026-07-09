import type { Customer360LoadResult } from "@/lib/domains/customer-360";
import { projectAutonomousCustomerContext, type AutonomousCustomerContext } from "./autonomousCustomerContext";

export type AutonomousCustomerContextLoadState = "not_requested" | "available" | "partial" | "not_found" | "unavailable";

export type AutonomousCustomerContextWarning = "customer_360_not_found" | "customer_360_unavailable" | "customer_360_partial" | "customer_360_stale";

export type AutonomousCustomerContextLoadResult = {
  state: AutonomousCustomerContextLoadState;
  customerId: string | null;
  context: AutonomousCustomerContext | null;
  warnings: AutonomousCustomerContextWarning[];
};

export type LoadCustomer360Fn = (customerId: string) => Promise<Customer360LoadResult>;

export type LoadAutonomousCustomerContextInput = {
  customerId: string | null;
  loadCustomer360: LoadCustomer360Fn;
};

/**
 * Single load point for Customer 360 in the autonomous cycle. customerId
 * null means identity was never resolved this turn - zero calls, not a
 * degraded read. A thrown/rejected loadCustomer360 is treated exactly like
 * status: "unavailable" - the raw exception never reaches the caller.
 */
export async function loadAutonomousCustomerContext(input: LoadAutonomousCustomerContextInput): Promise<AutonomousCustomerContextLoadResult> {
  if (!input.customerId) {
    return { state: "not_requested", customerId: null, context: null, warnings: [] };
  }

  const customerId = input.customerId;
  let result: Customer360LoadResult;
  try {
    result = await input.loadCustomer360(customerId);
  } catch {
    return { state: "unavailable", customerId, context: null, warnings: ["customer_360_unavailable"] };
  }

  if (result.status === "not_found") {
    return { state: "not_found", customerId, context: null, warnings: ["customer_360_not_found"] };
  }

  if (result.status === "unavailable") {
    return { state: "unavailable", customerId, context: null, warnings: ["customer_360_unavailable"] };
  }

  const context = projectAutonomousCustomerContext(result.snapshot);
  const degraded = context.dataQuality.completeness !== "complete" || context.dataQuality.unavailableSections.length > 0;
  const warnings: AutonomousCustomerContextWarning[] = [];
  if (degraded) warnings.push("customer_360_partial");
  if (context.dataQuality.freshness === "stale") warnings.push("customer_360_stale");

  return { state: degraded ? "partial" : "available", customerId, context, warnings };
}

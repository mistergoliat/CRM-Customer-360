import { createHttpCarrierServiceAdapter } from "./httpCarrierServiceAdapter";
import { readCarrierServiceConfig } from "./config";
import type { CarrierService } from "@/lib/domains/carrier-service";

export * from "./config";
export * from "./httpCarrierServiceAdapter";

/** Productive CarrierService factory. Returns null when CARRIER_SERVICE_BASE_URL is not configured so callers can report unavailable instead of crashing. */
export function createCarrierService(): CarrierService | null {
  const config = readCarrierServiceConfig();
  if (!config) return null;
  return createHttpCarrierServiceAdapter(config);
}

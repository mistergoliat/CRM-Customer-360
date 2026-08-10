import type { CarrierCoverageStatus, CarrierRate } from "./types";

export type CarrierCoverageEntry = {
  carrierId: number;
  carrierKey: string;
  carrierName: string;
  enabled: boolean;
  coverage: CarrierCoverageStatus;
};

export type CarrierCoverageLookupResult =
  | { ok: true; carriers: CarrierCoverageEntry[] }
  | { ok: false; reason: "configuration_unavailable" | "unavailable" | "timeout"; detail: string };

/** Boundary this domain depends on for coverage - the one real implementation is lib/integrations/logistics/shipping-coverage-adapter.ts (pc_pos.carriers/carrier_coverage). */
export interface ShippingCoverageProvider {
  getCoverageForCommune(communeId: number): Promise<CarrierCoverageLookupResult>;
}

export type CarrierRateLookupResult = { ok: true; rate: CarrierRate } | { ok: false; reason: string };

/**
 * No real implementation exists yet: CRM-R1-T13E's live pc_pos audit found
 * carrier_rangos_dd's rango_ini/rango_fin span 1-99,999,999, a magnitude
 * inconsistent with a kg weight bracket and with no corroborating evidence
 * (unit, currency, tax treatment, or client-vs-internal price) - see
 * docs/releases/CRM-R1-T13E-shipping-calculation.md,
 * RATE_SOURCE_SEMANTICS_UNCONFIRMED. Defined here so a future increment can
 * inject a real adapter without reshaping the calculator. Optional on
 * CalculateShippingDeps - its absence is itself the honest default.
 */
export interface ShippingRateProvider {
  getRate(carrierId: number, input: { totalWeightKg: number; communeId: number }): Promise<CarrierRateLookupResult>;
}

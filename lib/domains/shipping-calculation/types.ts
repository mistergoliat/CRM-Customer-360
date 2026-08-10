// Shipping calculation domain (CRM-R1-T13E.1). Pure: no SQL, no HTTP, no
// pc_pos, no Catalog Service client - see ports.ts for the boundaries this
// depends on instead. Combines a confirmed shipping destination (T13C/T13D),
// backend-assembled line items (weight already hydrated from Catalog
// Service) and a ShippingCoverageProvider into verifiable shipping
// alternatives. Never computes or accepts a communeId/weight/carrier/rate
// value invented by the LLM - see docs/releases/
// CRM-R1-T13E-shipping-calculation.md.

export type ShippingCalculationLineItem = {
  productId: string;
  combinationId: string | null;
  quantity: number;
  /**
   * Already resolved by Catalog Service (base product weight + combination
   * delta), rounded to 3 decimals there. null means the service could not
   * resolve a weight for this line - the whole calculation fails closed to
   * "weight_unavailable" rather than partially pricing the order.
   */
  unitWeightKg: number | null;
};

export type ShippingCalculationInput = {
  opportunityId: number;
  destination: {
    communeId: number;
    canonicalName: string;
    /** crm_request_facts id this calculation was run against (T13D) - lets a caller detect a later destination change as staleness. */
    destinationFactId: string;
  };
  items: ShippingCalculationLineItem[];
};

export const CARRIER_COVERAGE_STATUSES = ["covered", "not_covered", "unknown"] as const;
/**
 * "unknown" is not a fallback for "not_covered" - it is the honest result
 * when pc_pos.carrier_coverage has no row at all for (carrierId, communeId),
 * verified against real data to be a distinct, real case (CRM-R1-T13E
 * audit: e.g. Starken has zero configured rows for 3 remote communes,
 * distinct from the 27 communes it explicitly marks covered=0 for).
 */
export type CarrierCoverageStatus = (typeof CARRIER_COVERAGE_STATUSES)[number];

export type CarrierRate = {
  amount: number;
  currency: string;
};

export const CARRIER_RATE_STATUSES = ["available", "unavailable"] as const;
export type CarrierRateStatus = (typeof CARRIER_RATE_STATUSES)[number];

export type CarrierOption = {
  carrierId: number;
  carrierKey: string;
  carrierName: string;
  coverage: CarrierCoverageStatus;
  rateStatus: CarrierRateStatus;
  rate: CarrierRate | null;
  /** Present only when rateStatus is "unavailable" - a short machine reason, never a fabricated price. */
  rateUnavailableReason: string | null;
};

export const SHIPPING_CALCULATION_STATUSES = [
  "available",
  "partial",
  "not_covered",
  "weight_unavailable",
  "invalid_input",
  "configuration_unavailable",
  "technical_error"
] as const;
export type ShippingCalculationStatus = (typeof SHIPPING_CALCULATION_STATUSES)[number];

export type ShippingCalculationResult =
  | {
      status: "available" | "partial" | "not_covered";
      destination: { communeId: number; canonicalName: string; destinationFactId: string };
      totalWeightKg: number;
      options: CarrierOption[];
    }
  | { status: "weight_unavailable"; reason: string }
  | { status: "invalid_input"; reason: string }
  | { status: "configuration_unavailable"; reason: string; detail: string }
  | { status: "technical_error"; reason: string; detail: string };

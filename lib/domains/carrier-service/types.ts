// Carrier MS is the sole authority over shipping coverage, carriers and
// rates (CRM-R1-T13E.2) - this domain is a thin, typed boundary CRM assembles
// a request against and normalizes a response from. Never coverage/rate
// logic of its own.

export type CarrierQuoteInput = {
  /** Canonical commune name (T13D shippingDestination.canonicalName) - never a communeId, never raw conversation text. */
  destination: string;
  totalWeightKg: number;
  totalBoleta: number;
};

/** Mirrors the real Carrier MS response field-for-field (captured live against http://ms.pesaschile.cl - see release doc). estimatedDelivery is an opaque string: sometimes a date ("17-08-2026"), sometimes free text ("1 a 2 dias habiles") - never parsed as a date. */
export type CarrierOption = {
  carrierName: string;
  serviceType: string;
  totalCost: number;
  estimatedDelivery: string;
};

export const CARRIER_QUOTE_FAILURE_REASONS = ["carrier_service_unavailable", "carrier_service_timeout", "carrier_invalid_response"] as const;
export type CarrierQuoteFailureReason = (typeof CARRIER_QUOTE_FAILURE_REASONS)[number];

/**
 * An empty options[] from a real 2xx response is `ok: true, options: []` -
 * "no carrier serves this destination" is a business fact Carrier MS itself
 * reports, never a technical failure this type conflates with one.
 */
export type CarrierQuoteResult = { ok: true; options: CarrierOption[] } | { ok: false; reason: CarrierQuoteFailureReason; detail: string };

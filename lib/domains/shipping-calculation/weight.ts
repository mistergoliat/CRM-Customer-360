import type { ShippingCalculationLineItem } from "./types";

export type WeightValidationResult =
  | { ok: true; totalWeightKg: number }
  | { ok: false; status: "invalid_input"; reason: string }
  | { ok: false; status: "weight_unavailable"; reason: string }
  | { ok: false; status: "technical_error"; reason: string };

/**
 * Integer-scaled sum (kg * 1000 as integers, summed, divided back once) so
 * floating-point summation error can never accumulate across line items -
 * unitWeightKg is already rounded to 3 decimals by Catalog Service, so
 * Math.round(kg * 1000) recovers the exact integer despite float
 * representation noise (e.g. 20.123 * 1000 = 20122.999999999996 in IEEE754).
 * Never re-rounds a line's own precision beyond what Catalog Service already
 * fixed - see CRM-R1-T13E section 9/25.
 */
export function validateAndSumWeightKg(items: readonly ShippingCalculationLineItem[]): WeightValidationResult {
  if (items.length === 0) {
    return { ok: false, status: "invalid_input", reason: "items_required" };
  }

  let totalThousandths = 0;
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { ok: false, status: "invalid_input", reason: `invalid_quantity:${item.productId}` };
    }
    if (item.unitWeightKg === null) {
      return { ok: false, status: "weight_unavailable", reason: `weight_unavailable:${item.productId}` };
    }
    if (!Number.isFinite(item.unitWeightKg) || item.unitWeightKg < 0) {
      return { ok: false, status: "technical_error", reason: `invalid_upstream_weight:${item.productId}` };
    }
    totalThousandths += Math.round(item.unitWeightKg * 1000) * item.quantity;
  }

  return { ok: true, totalWeightKg: totalThousandths / 1000 };
}

import type { PricedLineItem } from "./types";

export type SubtotalValidationResult =
  | { ok: true; totalBoleta: number }
  | { ok: false; status: "invalid_input"; reason: string }
  | { ok: false; status: "price_unavailable"; reason: string }
  | { ok: false; status: "technical_error"; reason: string };

/**
 * total_boleta for Carrier MS (CRM-R1-T13E.2 section 9): the subtotal of
 * selected products, never including shipping itself. Fed exclusively by
 * Catalog Service's CatalogProductPrice.amount, passed through exactly as
 * that service reports it (including whatever its own taxIncluded flag
 * says) - CRM has no separate net/gross field to choose between and never
 * fabricates one. CLP has no subunit, so unlike weightKg's known 3-decimal
 * precision this sums whole pesos directly (Math.round per line, integer
 * arithmetic throughout - never a fractional accumulation to drift).
 */
export function validateAndSumTotalBoleta(items: readonly PricedLineItem[]): SubtotalValidationResult {
  if (items.length === 0) {
    return { ok: false, status: "invalid_input", reason: "items_required" };
  }

  let total = 0;
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { ok: false, status: "invalid_input", reason: `invalid_quantity:${item.productId}` };
    }
    if (item.unitPrice === null) {
      return { ok: false, status: "price_unavailable", reason: `price_unavailable:${item.productId}` };
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      return { ok: false, status: "technical_error", reason: `invalid_upstream_price:${item.productId}` };
    }
    total += Math.round(item.unitPrice) * item.quantity;
  }

  return { ok: true, totalBoleta: total };
}

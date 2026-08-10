// Pure line-item aggregation utilities (CRM-R1-T13E.1, narrowed in T13E.2).
// Carrier MS is the sole authority over coverage/carriers/rates (see
// lib/domains/carrier-service/) - this domain no longer represents a
// coverage/rate result of its own, only the weight/price aggregates CRM must
// compute to build a Carrier MS request. No SQL, no HTTP, no pc_pos, no
// Catalog Service client.

export type ShippingCalculationLineItem = {
  productId: string;
  combinationId: string | null;
  quantity: number;
  /** Already resolved by Catalog Service (base product weight + combination delta), rounded to 3 decimals there. null means unresolvable - fails the whole calculation closed. */
  unitWeightKg: number | null;
};

export type PricedLineItem = {
  productId: string;
  combinationId: string | null;
  quantity: number;
  /** Catalog Service's CatalogProductPrice.amount - passed through exactly as reported (see subtotal.ts doc comment for the net/tax-included caveat). null means unresolvable. */
  unitPrice: number | null;
};

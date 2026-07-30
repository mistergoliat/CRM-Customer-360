/**
 * Customer Profile port (CP-R1-T10B1): historical purchase facts for an
 * already-resolved master customer. This is transport plumbing only - field
 * shapes mirror MS-pesaschile-customer-profile's real contracts
 * (src/domain/customer-purchased-products/contracts.ts,
 * src/domain/customer-purchase-behavior/contracts.ts) exactly, ported here
 * (not imported as a dependency) so this repo stays free of a cross-repo
 * package. Distinct from lib/integrations/customer-service (identity /
 * onboarding) and lib/domains/customer-360 (local SQL read model) - never
 * conflate the three.
 */

export type CustomerProfileRequestContext = {
  correlationId: string;
};

/** Mirrors src/domain/customer-purchased-products/contracts.ts#PurchasedProduct. */
export type PurchasedProductItem = {
  productId: number;
  productAttributeId: number;
  productName: string;
  productReference: string | null;
  totalQuantityPurchased: number;
  orderCount: number;
  firstPurchasedAt: string;
  lastPurchasedAt: string;
  /** Decimal amount, kept as string exactly as returned - never coerced to number. */
  totalSpentTaxIncl: string;
  catalogStatus: "linked" | "deleted_or_unavailable";
};

export type PurchasedProductsPagination = {
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
};

export type GetPurchasedProductsInput = {
  masterCustomerId: string;
  limit?: number;
  offset?: number;
};

export type GetPurchasedProductsData = {
  products: PurchasedProductItem[];
  pagination: PurchasedProductsPagination;
};

/** Mirrors src/domain/customer-purchase-behavior/contracts.ts#PurchaseBehaviorConcentration. */
export type PurchaseBehaviorConcentration = {
  top1Share: string;
  top3Share: string;
  hhi: string;
  effectiveDiversity: string;
};

export type PurchaseBehaviorSummary = {
  validOrderCount: number;
  distinctProductCount: number;
  distinctVariantCount: number;
  repeatedProductCount: number;
  repeatedVariantCount: number;
  repeatProductRate: string;
  repeatVariantRate: string;
  repeatedVariantSpendShare: string;
  productSpendConcentration: PurchaseBehaviorConcentration;
  variantSpendConcentration: PurchaseBehaviorConcentration;
};

export type PurchaseBehaviorProduct = {
  productId: number;
  latestObservedProductName: string;
  latestObservedProductReference: string | null;
  variantCountPurchased: number;
  repeatedVariantCount: number;
  orderCount: number;
  totalQuantityPurchased: number;
  totalSpentTaxIncl: string;
  spendShare: string;
  orderShare: string;
  quantityShare: string;
  firstPurchasedAt: string;
  lastPurchasedAt: string;
  daysSinceLastPurchase: number;
  isRepeated: boolean;
};

export type PurchaseBehaviorVariant = {
  productId: number;
  productAttributeId: number;
  productName: string;
  productReference: string | null;
  orderCount: number;
  totalQuantityPurchased: number;
  totalSpentTaxIncl: string;
  spendShare: string;
  orderShare: string;
  quantityShare: string;
  firstPurchasedAt: string;
  lastPurchasedAt: string;
  daysSinceLastPurchase: number;
  isRepeated: boolean;
};

export type GetPurchaseBehaviorInput = {
  masterCustomerId: string;
  topProducts?: number;
  topVariants?: number;
};

export type GetPurchaseBehaviorData = {
  currencyIsoCode: "CLP";
  calculatedAt: string;
  summary: PurchaseBehaviorSummary;
  topProducts: PurchaseBehaviorProduct[];
  topVariants: PurchaseBehaviorVariant[];
};

/**
 * Discriminated result. `available` with an empty list is a valid customer
 * with no purchase history - never conflated with `customer_not_found`
 * (identity does not exist) or `customer_not_linked` (no PrestaShop link).
 * `degraded` means the upstream PrestaShop dependency is unavailable, not
 * that the request failed.
 */
export type CustomerProfileLookupResult<T> =
  | {
      status: "available";
      data: T;
    }
  | {
      status: "customer_not_found";
    }
  | {
      status: "customer_not_linked";
    }
  | {
      status: "degraded";
      reason: "prestashop_unavailable" | "prestashop_timeout" | "unknown";
      retryable: boolean;
    }
  | {
      status: "failed";
      code:
        | "invalid_request"
        | "authentication_error"
        | "rate_limited"
        | "upstream_error"
        | "invalid_response"
        | "timeout"
        | "unavailable";
      retryable: boolean;
    };

/**
 * masterCustomerId arrives already resolved by the caller. This port never
 * resolves identity, never accepts email/phone/DNI, and never reads a
 * caller-global identity value on its own.
 */
export type CustomerProfilePort = {
  getPurchasedProducts(
    input: GetPurchasedProductsInput,
    context: CustomerProfileRequestContext
  ): Promise<CustomerProfileLookupResult<GetPurchasedProductsData>>;

  getPurchaseBehavior(
    input: GetPurchaseBehaviorInput,
    context: CustomerProfileRequestContext
  ): Promise<CustomerProfileLookupResult<GetPurchaseBehaviorData>>;
};

export const CUSTOMER_PROFILE_ADAPTER_CONTRACT_VERSION = "customer-profile.v1" as const;

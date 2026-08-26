export const CUSTOMER_PROFILE_CONTRACT_VERSION = "customer-profile-prestashop-direct-v1" as const;
export const CUSTOMER_RFM_CONTRACT_VERSION = "customer-rfm-runtime-v1" as const;
export const CUSTOMER_PROFILE_IDENTITY_SOURCE = "PRESTASHOP" as const;
export const CUSTOMER_PROFILE_IDENTITY_STATUS = "DIRECT_SOURCE" as const;

export type CustomerProfileCustomerId = number;

export type CustomerDataSourceEntity =
  | "ps_customer"
  | "ps_orders"
  | "ps_order_detail"
  | "ps_order_cart_rule"
  | "derived_purchase_behavior";

export type CustomerDataSource = {
  readonly source: typeof CUSTOMER_PROFILE_IDENTITY_SOURCE;
  readonly entity: CustomerDataSourceEntity;
  readonly purpose: string;
};

export type CustomerDataProvenance = {
  readonly customerIdentity: {
    readonly customerId: CustomerProfileCustomerId;
    readonly source: typeof CUSTOMER_PROFILE_IDENTITY_SOURCE;
    readonly externalCustomerId: string;
    readonly status: typeof CUSTOMER_PROFILE_IDENTITY_STATUS;
  };
  readonly dataSources: readonly CustomerDataSource[];
  readonly generatedAt: string;
  readonly contractVersion: typeof CUSTOMER_PROFILE_CONTRACT_VERSION;
};

export type CustomerProfileRecentOrderState = {
  readonly stateId: number;
  readonly name: string | null;
  readonly resolution: "resolved" | "unknown";
};

export type CustomerProfileRecentOrder = {
  readonly orderId: number;
  readonly reference: string;
  readonly currentStateId: number;
  readonly currentState: CustomerProfileRecentOrderState;
  readonly valid: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly totalPaidTaxIncl: string;
  readonly totalProductsTaxIncl: string;
  readonly currencyId: number;
};

export type CustomerProfileResponse = {
  readonly status: "available";
  readonly customerId: CustomerProfileCustomerId;
  readonly profile: {
    readonly customerId: CustomerProfileCustomerId;
    readonly generatedAt: string;
    readonly customer: {
      readonly firstname: string;
      readonly lastname: string;
      readonly email: string;
      readonly rut: string | null;
      readonly platformOrigin: string;
    };
    readonly prestashop: {
      readonly customerId: CustomerProfileCustomerId;
      readonly active: boolean;
      readonly shopId: number;
      readonly createdAt: string | null;
      readonly updatedAt: string | null;
    };
    readonly recentOrders: readonly CustomerProfileRecentOrder[];
    readonly warnings: readonly string[];
  };
  readonly provenance: CustomerDataProvenance;
  readonly warnings: readonly string[];
};

export type CustomerCommercialSummaryResponse = {
  readonly status: "available";
  readonly customerId: CustomerProfileCustomerId;
  readonly summary: {
    readonly totalOrders: number;
    readonly totalSpentTaxIncl: string;
    readonly averageOrderValueTaxIncl: string;
    readonly firstOrderAt: string | null;
    readonly lastOrderAt: string | null;
    readonly daysSinceLastOrder: number | null;
    readonly purchaseFrequencyDays: number | null;
    readonly totalUnitsPurchased: number;
    readonly distinctProductsPurchased: number;
    readonly cancelledOrderCount: number;
    readonly refundedOrderCount: number;
    readonly currencyIsoCode: "CLP";
  };
  readonly provenance: CustomerDataProvenance;
};

export type CustomerPurchasedProductsItem = {
  readonly productId: number;
  readonly productAttributeId: number;
  readonly productName: string;
  readonly productReference: string | null;
  readonly totalQuantityPurchased: number;
  readonly orderCount: number;
  readonly firstPurchasedAt: string;
  readonly lastPurchasedAt: string;
  readonly totalSpentTaxIncl: string;
  readonly catalogStatus: "linked" | "deleted_or_unavailable";
};

export type CustomerPurchasedProductsResponse = {
  readonly status: "available";
  readonly customerId: CustomerProfileCustomerId;
  readonly products: readonly CustomerPurchasedProductsItem[];
  readonly pagination: {
    readonly limit: number;
    readonly offset: number;
    readonly returned: number;
    readonly hasMore: boolean;
  };
  readonly provenance: CustomerDataProvenance;
};

export type CustomerPurchaseBehaviorConcentration = {
  readonly top1Share: string;
  readonly top3Share: string;
  readonly hhi: string;
  readonly effectiveDiversity: string;
};

export type CustomerPurchaseBehaviorProduct = {
  readonly productId: number;
  readonly latestObservedProductName: string;
  readonly latestObservedProductReference: string | null;
  readonly variantCountPurchased: number;
  readonly repeatedVariantCount: number;
  readonly orderCount: number;
  readonly totalQuantityPurchased: number;
  readonly totalSpentTaxIncl: string;
  readonly spendShare: string;
  readonly orderShare: string;
  readonly quantityShare: string;
  readonly firstPurchasedAt: string;
  readonly lastPurchasedAt: string;
  readonly daysSinceLastPurchase: number;
  readonly isRepeated: boolean;
};

export type CustomerPurchaseBehaviorVariant = {
  readonly productId: number;
  readonly productAttributeId: number;
  readonly productName: string;
  readonly productReference: string | null;
  readonly orderCount: number;
  readonly totalQuantityPurchased: number;
  readonly totalSpentTaxIncl: string;
  readonly spendShare: string;
  readonly orderShare: string;
  readonly quantityShare: string;
  readonly firstPurchasedAt: string;
  readonly lastPurchasedAt: string;
  readonly daysSinceLastPurchase: number;
  readonly isRepeated: boolean;
};

export type CustomerPurchaseBehaviorResponse = {
  readonly status: "available";
  readonly customerId: CustomerProfileCustomerId;
  readonly currencyIsoCode: "CLP";
  readonly calculatedAt: string;
  readonly summary: {
    readonly validOrderCount: number;
    readonly distinctProductCount: number;
    readonly distinctVariantCount: number;
    readonly repeatedProductCount: number;
    readonly repeatedVariantCount: number;
    readonly repeatProductRate: string;
    readonly repeatVariantRate: string;
    readonly repeatedVariantSpendShare: string;
    readonly productSpendConcentration: CustomerPurchaseBehaviorConcentration;
    readonly variantSpendConcentration: CustomerPurchaseBehaviorConcentration;
  };
  readonly topProducts: readonly CustomerPurchaseBehaviorProduct[];
  readonly topVariants: readonly CustomerPurchaseBehaviorVariant[];
  readonly provenance: CustomerDataProvenance;
};

export type CustomerOrderStatusDeliveryMethod =
  | "direct_dispatch"
  | "external_carrier"
  | "store_pickup"
  | "warehouse_pickup"
  | "event_pickup"
  | "unknown";

export type CustomerOrderStatusDeliveryEstimate =
  | {
      readonly status: "applicable";
      readonly minimumBusinessDays: number;
      readonly maximumBusinessDays: number;
      readonly startsFrom: "dispatch";
    }
  | {
      readonly status: "not_applicable" | "unknown";
      readonly minimumBusinessDays: null;
      readonly maximumBusinessDays: null;
      readonly startsFrom: null;
    };

export type CustomerOrderStatusWarning = "order_state_label_missing" | "carrier_not_found" | "delivery_method_unknown";

export type CustomerOrderStatusResponse = {
  readonly status: "available";
  readonly customerId: CustomerProfileCustomerId;
  readonly order: {
    readonly orderId: number;
    readonly reference: string;
    readonly currentStateId: number;
    readonly currentStateName: string | null;
    readonly deliveryMethod: CustomerOrderStatusDeliveryMethod;
    readonly deliveryEstimate: CustomerOrderStatusDeliveryEstimate;
    readonly lastRecordedUpdateAt: string;
    readonly source: "prestashop_current_state";
    readonly isRealTimeTracking: false;
  };
  readonly provenance: CustomerDataProvenance;
  readonly warnings: readonly CustomerOrderStatusWarning[];
};

export type CustomerProfileReadinessResponse =
  | {
      readonly status: "ready";
      readonly prestashop: true;
      readonly crm: boolean;
      readonly customerIdentitySource: typeof CUSTOMER_PROFILE_IDENTITY_SOURCE;
      readonly identityStatus: typeof CUSTOMER_PROFILE_IDENTITY_STATUS;
      readonly contractVersion: typeof CUSTOMER_PROFILE_CONTRACT_VERSION;
    }
  | {
      readonly status: "not_ready";
      readonly prestashop: false;
      readonly crm: boolean;
      readonly customerIdentitySource: typeof CUSTOMER_PROFILE_IDENTITY_SOURCE;
      readonly identityStatus: typeof CUSTOMER_PROFILE_IDENTITY_STATUS;
      readonly contractVersion: typeof CUSTOMER_PROFILE_CONTRACT_VERSION;
      readonly reason: "prestashop_unavailable" | "prestashop_schema_incompatible";
    };

export type CustomerProfileRequestMetadata = {
  readonly requestId?: string;
};

export type GetCustomerProfileInput = CustomerProfileRequestMetadata & {
  readonly customerId: CustomerProfileCustomerId;
};

export type GetCommercialSummaryInput = CustomerProfileRequestMetadata & {
  readonly customerId: CustomerProfileCustomerId;
};

export type GetPurchasedProductsInput = CustomerProfileRequestMetadata & {
  readonly customerId: CustomerProfileCustomerId;
  readonly limit?: number;
  readonly offset?: number;
};

export type GetPurchaseBehaviorInput = CustomerProfileRequestMetadata & {
  readonly customerId: CustomerProfileCustomerId;
  readonly topProducts?: number;
  readonly topVariants?: number;
};

export type GetCustomerOrderStatusInput = CustomerProfileRequestMetadata & {
  readonly customerId: CustomerProfileCustomerId;
  readonly orderReference: string;
};

// SALES-AGENT-R2-ID-R2-A10. Deliberately CustomerProfileCustomerId (the same
// ps_customer.id_customer space as every other operation on this client) -
// never a master_customer.id. RFM's primary route is
// `/v1/customers/:customerId/rfm`, identical id space to profile/
// commercial-summary/purchased-products/purchase-behavior; there is no
// separate "master customer id" input on this client.
export type GetCustomerRfmInput = CustomerProfileRequestMetadata & {
  readonly customerId: CustomerProfileCustomerId;
};

export type CustomerProfileClientAvailableMetadata = {
  readonly requestedCustomerId: CustomerProfileCustomerId;
  readonly contractVersion: string;
  readonly identitySource: string;
  readonly generatedAt: string;
  readonly durationMs: number;
};

export type CustomerRfmClientAvailableMetadata = {
  readonly requestedCustomerId: CustomerProfileCustomerId;
  readonly contractVersion: string;
  readonly segmentVersion: string | null;
  readonly referenceTime: string;
  readonly publishedAt: string;
  readonly durationMs: number;
};

export type CustomerProfileNotFoundReason = "CUSTOMER_NOT_FOUND" | "ORDER_NOT_FOUND";
export type CustomerProfileInvalidRequestReason =
  | "INVALID_CUSTOMER_ID"
  | "INVALID_LIMIT"
  | "INVALID_OFFSET"
  | "INVALID_TOP_PRODUCTS"
  | "INVALID_TOP_VARIANTS"
  | "INVALID_ORDER_REFERENCE";
export type CustomerProfileUnavailableReason =
  | "CUSTOMER_PROFILE_DISABLED"
  | "CUSTOMER_PROFILE_TIMEOUT"
  | "CUSTOMER_PROFILE_UNAVAILABLE"
  | "PRESTASHOP_UNAVAILABLE"
  | "PRESTASHOP_SCHEMA_INCOMPATIBLE";
export type CustomerProfileContractErrorReason =
  | "INVALID_RESPONSE"
  | "CONTRACT_VERSION_UNSUPPORTED"
  | "PROVENANCE_MISMATCH";

export type CustomerRfmResponse = {
  readonly status: "available";
  // SALES-AGENT-R2-ID-R2-A10. The wire body's own field is literally named
  // "masterCustomerId" (external contract this repo does not own - see
  // schemas.ts#parseCustomerRfmResponse), but it echoes back the same
  // ps_customer.id_customer-space value this client requested via
  // GetCustomerRfmInput.customerId - never a real master_customer.id. Named
  // `customerId` here, matching every sibling response type on this client,
  // so nothing downstream re-derives the historical "pass master_customer.id"
  // mistake from this type's own field name.
  readonly customerId: CustomerProfileCustomerId;
  readonly snapshot: {
    readonly snapshotId: string;
    readonly calculationVersion: string;
    readonly referenceTime: string;
    readonly publishedAt: string;
    readonly currencyCode: string;
  };
  readonly rfm: {
    readonly recencyDays: number;
    readonly frequencyOrders: number;
    readonly grossOrderValueTaxIncl: string;
    readonly averageOrderValueTaxIncl: string;
    readonly recencyScore: 1 | 2 | 3 | 4 | 5;
    readonly frequencyScore: 1 | 2 | 3 | 4 | 5;
    readonly monetaryScore: 1 | 2 | 3 | 4 | 5;
    readonly rfmCode: string;
  };
  readonly segment: {
    readonly code: string | null;
    readonly version: string | null;
  };
  readonly contractVersion: typeof CUSTOMER_RFM_CONTRACT_VERSION;
};

export type CustomerRfmNotFoundReason = "CUSTOMER_NOT_FOUND" | "RFM_NOT_AVAILABLE";
export type CustomerRfmUnavailableReason = "CUSTOMER_PROFILE_TIMEOUT" | "CUSTOMER_PROFILE_UNAVAILABLE" | "RFM_DEGRADED";
export type CustomerRfmContractErrorReason =
  | "INVALID_RESPONSE"
  | "CONTRACT_VERSION_UNSUPPORTED"
  | "PROVENANCE_MISMATCH";

export type CustomerRfmResult =
  | {
      readonly status: "AVAILABLE";
      readonly data: CustomerRfmResponse;
      readonly metadata: CustomerRfmClientAvailableMetadata;
    }
  | {
      readonly status: "NOT_FOUND";
      readonly reason: CustomerRfmNotFoundReason;
    }
  | {
      readonly status: "INVALID_REQUEST";
      readonly reason: "INVALID_CUSTOMER_ID";
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly reason: CustomerRfmUnavailableReason;
      readonly retryable: boolean;
    }
  | {
      readonly status: "CONTRACT_ERROR";
      readonly reason: CustomerRfmContractErrorReason;
    };

export type CustomerProfileClientResult<TData, TNotFound extends CustomerProfileNotFoundReason = CustomerProfileNotFoundReason> =
  | {
      readonly status: "AVAILABLE";
      readonly data: TData;
      readonly metadata: CustomerProfileClientAvailableMetadata;
    }
  | {
      readonly status: "NOT_FOUND";
      readonly reason: TNotFound;
    }
  | {
      readonly status: "INVALID_REQUEST";
      readonly reason: CustomerProfileInvalidRequestReason;
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly reason: CustomerProfileUnavailableReason;
      readonly retryable: boolean;
    }
  | {
      readonly status: "CONTRACT_ERROR";
      readonly reason: CustomerProfileContractErrorReason;
    };

export type CustomerProfileResult = CustomerProfileClientResult<CustomerProfileResponse, "CUSTOMER_NOT_FOUND">;
export type CustomerCommercialSummaryResult = CustomerProfileClientResult<CustomerCommercialSummaryResponse, "CUSTOMER_NOT_FOUND">;
export type CustomerPurchasedProductsResult = CustomerProfileClientResult<CustomerPurchasedProductsResponse, "CUSTOMER_NOT_FOUND">;
export type CustomerPurchaseBehaviorResult = CustomerProfileClientResult<CustomerPurchaseBehaviorResponse, "CUSTOMER_NOT_FOUND">;
export type CustomerOrderStatusResult = CustomerProfileClientResult<CustomerOrderStatusResponse, "CUSTOMER_NOT_FOUND" | "ORDER_NOT_FOUND">;

export type CustomerProfileReadinessResult =
  | {
      readonly status: "AVAILABLE";
      readonly data: CustomerProfileReadinessResponse;
      readonly metadata: {
        readonly contractVersion: string;
        readonly identitySource: string;
        readonly durationMs: number;
      };
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly reason: CustomerProfileUnavailableReason;
      readonly retryable: boolean;
    }
  | {
      readonly status: "CONTRACT_ERROR";
      readonly reason: CustomerProfileContractErrorReason;
    };

export type CustomerProfileClient = {
  getProfile(input: GetCustomerProfileInput): Promise<CustomerProfileResult>;
  getCommercialSummary(input: GetCommercialSummaryInput): Promise<CustomerCommercialSummaryResult>;
  getPurchasedProducts(input: GetPurchasedProductsInput): Promise<CustomerPurchasedProductsResult>;
  getPurchaseBehavior(input: GetPurchaseBehaviorInput): Promise<CustomerPurchaseBehaviorResult>;
  getOrderStatus(input: GetCustomerOrderStatusInput): Promise<CustomerOrderStatusResult>;
  getRfm(input: GetCustomerRfmInput): Promise<CustomerRfmResult>;
  checkReadiness(input?: CustomerProfileRequestMetadata): Promise<CustomerProfileReadinessResult>;
};

export type CustomerProfileClientConfig = {
  readonly enabled: boolean;
  readonly baseUrl: string | null;
  readonly timeoutMs: number;
  readonly authToken: string | null;
};

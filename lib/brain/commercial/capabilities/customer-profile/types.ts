import type {
  CustomerCommercialSummaryResult,
  CustomerOrderStatusResult,
  CustomerProfileClient,
  CustomerProfileReadinessResult,
  CustomerProfileResult,
  CustomerPurchasedProductsResult,
  CustomerPurchaseBehaviorResult,
  GetCommercialSummaryInput,
  GetCustomerOrderStatusInput,
  GetCustomerProfileInput,
  GetPurchaseBehaviorInput,
  GetPurchasedProductsInput
} from "@/lib/integrations/customer-profile";

export type CustomerProfileCapabilities = {
  getProfile(input: GetCustomerProfileInput): Promise<CustomerProfileResult>;
  getCommercialSummary(input: GetCommercialSummaryInput): Promise<CustomerCommercialSummaryResult>;
  getPurchasedProducts(input: GetPurchasedProductsInput): Promise<CustomerPurchasedProductsResult>;
  getPurchaseBehavior(input: GetPurchaseBehaviorInput): Promise<CustomerPurchaseBehaviorResult>;
  getOrderStatus(input: GetCustomerOrderStatusInput): Promise<CustomerOrderStatusResult>;
  checkReadiness(input?: { requestId?: string }): Promise<CustomerProfileReadinessResult>;
};

export type CreateCustomerProfileCapabilitiesDeps = {
  customerProfileClient: CustomerProfileClient;
};

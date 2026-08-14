import type {
  CustomerCommercialSummaryResult,
  CustomerOrderStatusResult,
  CustomerProfileClient,
  CustomerProfileReadinessResult,
  CustomerProfileResult,
  CustomerPurchasedProductsResult,
  CustomerPurchaseBehaviorResult,
  CustomerRfmResult,
  GetCommercialSummaryInput,
  GetCustomerOrderStatusInput,
  GetCustomerProfileInput,
  GetCustomerRfmInput,
  GetPurchaseBehaviorInput,
  GetPurchasedProductsInput
} from "@/lib/integrations/customer-profile";

export type CustomerProfileCapabilities = {
  getProfile(input: GetCustomerProfileInput): Promise<CustomerProfileResult>;
  getCommercialSummary(input: GetCommercialSummaryInput): Promise<CustomerCommercialSummaryResult>;
  getPurchasedProducts(input: GetPurchasedProductsInput): Promise<CustomerPurchasedProductsResult>;
  getPurchaseBehavior(input: GetPurchaseBehaviorInput): Promise<CustomerPurchaseBehaviorResult>;
  getOrderStatus(input: GetCustomerOrderStatusInput): Promise<CustomerOrderStatusResult>;
  getRfm(input: GetCustomerRfmInput): Promise<CustomerRfmResult>;
  checkReadiness(input?: { requestId?: string }): Promise<CustomerProfileReadinessResult>;
};

export type CreateCustomerProfileCapabilitiesDeps = {
  customerProfileClient: CustomerProfileClient;
};

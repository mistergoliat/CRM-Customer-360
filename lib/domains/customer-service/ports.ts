import type { CreateCustomerInput, CreateCustomerResult, LinkExternalIdentityInput, LinkExternalIdentityResult, ResolveCustomerInput, ResolveCustomerResult } from "./types";

// Boundary the customer-service domain depends on (contract section 2).
// lib/integrations/customer-service/http-adapter.ts is the one productive
// implementation. No fallback implementation may read master_customer,
// PrestaShop, SAP, POS or customer_external_identity directly (section 7).
export interface CustomerServicePort {
  resolveCustomer(input: ResolveCustomerInput): Promise<ResolveCustomerResult>;
  createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult>;
  linkExternalIdentity(input: LinkExternalIdentityInput): Promise<LinkExternalIdentityResult>;
}

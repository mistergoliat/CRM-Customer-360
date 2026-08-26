import type {
  CreateCustomerInput,
  CreateCustomerResult,
  LinkExternalIdentityInput,
  LinkExternalIdentityResult,
  LinkPrestashopIdentityInput,
  LinkPrestashopIdentityResult,
  ResolveCustomerInput,
  ResolveCustomerResult
} from "./types";

// Boundary the customer-service domain depends on (contract section 2).
// lib/integrations/customer-service/http-adapter.ts is the one productive
// implementation. No fallback implementation may read master_customer,
// PrestaShop, SAP, POS or customer_external_identity directly (section 7).
export interface CustomerServicePort {
  resolveCustomer(input: ResolveCustomerInput): Promise<ResolveCustomerResult>;
  createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult>;
  linkExternalIdentity(input: LinkExternalIdentityInput): Promise<LinkExternalIdentityResult>;
  /** SALES-AGENT-R2-ID-R2-A09. Separate from linkExternalIdentity - see types.ts. */
  linkPrestashopIdentity(input: LinkPrestashopIdentityInput): Promise<LinkPrestashopIdentityResult>;
}

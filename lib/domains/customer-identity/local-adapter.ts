import { findDistinctCustomersByNormalizedValue, findExternalIdentityByProviderExternalId } from "@/lib/integrations/customer-external-identity";
import type { CustomerIdentityLookupResult, CustomerIdentityPort } from "./types";

export type LocalCustomerIdentityAdapter = CustomerIdentityPort;

// Read-only over customer_external_identity: both repository calls below are
// SELECT-only (see lib/integrations/customer-external-identity/repository.ts).
export function createLocalCustomerIdentityAdapter(): LocalCustomerIdentityAdapter {
  return {
    async findCustomerByExternalIdentity({ provider, externalId }): Promise<CustomerIdentityLookupResult> {
      const result = await findExternalIdentityByProviderExternalId(provider, externalId);
      if (!result.ok) {
        return { ok: false, error: result.error ?? "customer_external_identity_query_failed" };
      }
      return { ok: true, candidateCustomerIds: result.row ? [String(result.row.customer_id)] : [] };
    },

    async findCustomersByNormalizedPhone({ provider, normalizedPhone }): Promise<CustomerIdentityLookupResult> {
      const result = await findDistinctCustomersByNormalizedValue(provider, normalizedPhone);
      if (!result.ok) {
        return { ok: false, error: result.error ?? "customer_external_identity_query_failed" };
      }
      return { ok: true, candidateCustomerIds: result.customerIds.map(String) };
    }
  };
}

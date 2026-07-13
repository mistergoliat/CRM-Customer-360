import { findDistinctCustomersByNormalizedValueAcrossProviders, findExternalIdentityByProviderExternalId } from "@/lib/integrations/customer-external-identity";
import type { CustomerIdentityLookupResult, CustomerIdentityPort } from "./types";

export type LocalCustomerIdentityAdapter = CustomerIdentityPort;

// Read-only over customer_external_identity: both repository calls below are
// SELECT-only (see lib/integrations/customer-external-identity/repository.ts).
//
// Phone sources reviewed and NOT connected here, with reasons:
// - master_customer has no phone column (see migrations/006).
// - customer_addresses.recipient_phone is a delivery contact, not a
//   verified identity of the account holder - using it for identity
//   resolution risks matching the wrong person (e.g. a gift recipient).
// - ps_customer (PrestaShop) phone/mobile fields have no verified bridge
//   into master_customer.id in this codebase (no writer ever creates a
//   customer_external_identity row with provider "prestashop"); treating
//   ps_customer.id_customer as a master_customer id would invent an
//   identity link the contract forbids.
export function createLocalCustomerIdentityAdapter(): LocalCustomerIdentityAdapter {
  return {
    async findCustomerByExternalIdentity({ provider, externalId }): Promise<CustomerIdentityLookupResult> {
      const result = await findExternalIdentityByProviderExternalId(provider, externalId);
      if (!result.ok) {
        return { ok: false, error: result.error ?? "customer_external_identity_query_failed" };
      }
      // A row can exist with customer_id = NULL (an unresolved external
      // identity persisted by resolveOrPersistNativeExternalIdentity,
      // T06.2, for a first-contact sender with no match yet). That is not a
      // candidate match - without this guard, String(null) === "null" was
      // counted as one candidate, making resolveIdentity report a brand new
      // contact as "identified" with a bogus literal customerId "null".
      return { ok: true, candidateCustomerIds: result.row && result.row.customer_id !== null ? [String(result.row.customer_id)] : [] };
    },

    async findCustomersByNormalizedPhone({ normalizedPhone }): Promise<CustomerIdentityLookupResult> {
      const result = await findDistinctCustomersByNormalizedValueAcrossProviders(normalizedPhone);
      if (!result.ok) {
        return { ok: false, error: result.error ?? "customer_external_identity_query_failed" };
      }
      return { ok: true, candidateCustomerIds: Array.from(new Set(result.customerIds.map(String))) };
    }
  };
}

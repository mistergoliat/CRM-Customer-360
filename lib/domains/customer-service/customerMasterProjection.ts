// ACS-R1-04-T08.1. Read-only reader over the local master_customer
// projection, used to verify that a customerMasterId a Customer Service
// success result claims actually exists locally before ACS trusts it (see
// lib/brain/commercial/native-cycle/customer-session/onboardingTransitions.ts).
// Customer Service remains the sole authority for creation/linking - this
// module never inserts or updates master_customer, and never falls back to
// PrestaShop or any other source. Reuses the existing read-only repository
// function (lib/integrations/customer-master/customer-repository.ts) instead
// of issuing raw SQL here.
import { getMasterCustomerById } from "@/lib/integrations/customer-master/customer-repository";

export interface CustomerMasterProjectionReader {
  exists(customerMasterId: string): Promise<boolean>;
}

export function createCustomerMasterProjectionReader(): CustomerMasterProjectionReader {
  return {
    async exists(customerMasterId: string): Promise<boolean> {
      const result = await getMasterCustomerById(customerMasterId);
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result.data !== null;
    }
  };
}

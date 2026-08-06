import { getSharedCustomerProfileClient } from "@/lib/integrations/customer-profile";
import type { CreateCustomerProfileCapabilitiesDeps, CustomerProfileCapabilities } from "./types";

export function createCustomerProfileCapabilities(deps: CreateCustomerProfileCapabilitiesDeps): CustomerProfileCapabilities {
  return {
    getProfile(input) {
      return deps.customerProfileClient.getProfile(input);
    },
    getCommercialSummary(input) {
      return deps.customerProfileClient.getCommercialSummary(input);
    },
    getPurchasedProducts(input) {
      return deps.customerProfileClient.getPurchasedProducts(input);
    },
    getPurchaseBehavior(input) {
      return deps.customerProfileClient.getPurchaseBehavior(input);
    },
    getOrderStatus(input) {
      return deps.customerProfileClient.getOrderStatus(input);
    },
    checkReadiness(input) {
      return deps.customerProfileClient.checkReadiness(input);
    }
  };
}

export function createProductionCustomerProfileCapabilities(): CustomerProfileCapabilities {
  return createCustomerProfileCapabilities({ customerProfileClient: getSharedCustomerProfileClient() });
}

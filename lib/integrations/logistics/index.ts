// pc_pos integration (CRM-R1-T13C/T13E). Read-only. The commune resolver is
// wired into the Native Agent Tool Loop (T13D, set_shipping_destination);
// the shipping coverage provider (T13E.1) is not wired into any capability
// yet - see docs/releases/CRM-R1-T13E-shipping-calculation.md.
import { createCommuneResolver, type CommuneResolver } from "@/lib/domains/commune-resolution";
import type { ShippingCoverageProvider } from "@/lib/domains/shipping-calculation";
import { createPcPosCommuneCatalog } from "./pc-pos-adapter";
import { createPcPosShippingCoverageProvider } from "./shipping-coverage-adapter";

export * from "./config";
export * from "./pool";
export * from "./queryExecutor";
export * from "./pc-pos-adapter";
export * from "./shipping-coverage-adapter";

/** The production CommuneResolver, backed by pc_pos.comuna. Lazy: no connection is made until resolve() is actually called. */
export function createPcPosCommuneResolver(): CommuneResolver {
  return createCommuneResolver(createPcPosCommuneCatalog());
}

/** The production ShippingCoverageProvider, backed by pc_pos.carriers/carrier_coverage. Lazy: no connection until getCoverageForCommune() is actually called. */
export function createPcPosShippingCoverageResolver(): ShippingCoverageProvider {
  return createPcPosShippingCoverageProvider();
}

// pc_pos integration (CRM-R1-T13C). Read-only. Scope narrowed by T13E.2:
// pc_pos.comuna remains the canonical commune catalog for destination
// resolution (wired into the Native Agent Tool Loop via T13D,
// set_shipping_destination), but coverage/carriers/rates are no longer CRM's
// concern - Carrier MS (lib/integrations/carrier-service/) is the sole
// authority there. T13E.1's shipping-coverage-adapter.ts (a direct
// pc_pos.carrier_coverage read) was removed in T13E.2, having never gained a
// second consumer - see docs/releases/CRM-R1-T13E-shipping-calculation.md.
import { createCommuneResolver, type CommuneResolver } from "@/lib/domains/commune-resolution";
import { createPcPosCommuneCatalog } from "./pc-pos-adapter";

export * from "./config";
export * from "./pool";
export * from "./queryExecutor";
export * from "./pc-pos-adapter";

/** The production CommuneResolver, backed by pc_pos.comuna. Lazy: no connection is made until resolve() is actually called. */
export function createPcPosCommuneResolver(): CommuneResolver {
  return createCommuneResolver(createPcPosCommuneCatalog());
}

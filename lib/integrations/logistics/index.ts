// pc_pos integration (CRM-R1-T13C). Read-only. NOT wired into the agent
// loop, capabilities, or crm_request_facts yet - see
// docs/releases/CRM-R1-T13C-canonical-commune-resolution.md.
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

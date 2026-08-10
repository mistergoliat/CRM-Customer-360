// Canonical commune resolution (CRM-R1-T13C). Resolves free text (from the
// customer or extracted by the LLM) to a pc_pos.comuna.id_comuna,
// deterministically, never fabricating an id. The one productive
// implementation of CommuneCatalogPort is
// lib/integrations/logistics/pc-pos-adapter.ts. NOT wired into the agent
// loop, capabilities, or crm_request_facts yet - see
// docs/audits/CRM-R1-T13B-shipping-destination-commune-resolution-audit.md
// section 21 and docs/releases/CRM-R1-T13C-canonical-commune-resolution.md.
export * from "./types";
export * from "./ports";
export * from "./normalize";
export * from "./aliases";
export * from "./knownAmbiguous";
export * from "./service";

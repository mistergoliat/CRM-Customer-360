// Durable created-quote reference (SALES-AGENT-R1-T3). Persisted on top of
// the existing crm_request_facts lifecycle (lib/brain/commercial/request-facts)
// - no new table, same pattern already established by
// lib/domains/shipping-destination/constants.ts (T13D),
// lib/domains/commercial-line-items/constants.ts (T13E.2) and
// lib/domains/selected-shipping-option/constants.ts (T2.1). A fourth,
// distinct fact_key on the SAME "opportunity:<id>" anchor - crm_request_facts'
// uniqueness is on (request_id, fact_key), so all four facts coexist without
// collision. See docs/audits/SALES-AGENT-R1-T3-create-quote-wiring-audit.md.
export const CREATED_QUOTE_FACT_KEY = "created_quote";

export function buildCreatedQuoteRequestAnchor(opportunityId: number): string {
  return `opportunity:${opportunityId}`;
}

// Durable commercial line-item selection (CRM-R1-T13E.2). Persisted on top of
// the existing crm_request_facts lifecycle (lib/brain/commercial/request-facts)
// - no new table, same pattern already established by
// lib/domains/shipping-destination/constants.ts (T13D). Anchored by
// opportunity, never by crm_conversation_requests.request_id (the
// non-canonical multi-request runtime the Native Agent Tool Loop never
// populates). A different fact_key on the SAME "opportunity:<id>" anchor as
// shipping_destination - crm_request_facts' uniqueness is on
// (request_id, fact_key), so both facts coexist without collision.
export const COMMERCIAL_LINE_ITEMS_FACT_KEY = "commercial_line_items";

export function buildCommercialLineItemsRequestAnchor(opportunityId: number): string {
  return `opportunity:${opportunityId}`;
}

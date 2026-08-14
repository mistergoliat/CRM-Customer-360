// Durable selected shipping option (SALES-AGENT-R1-T2.1). Persisted on top of
// the existing crm_request_facts lifecycle (lib/brain/commercial/request-facts)
// - no new table, same pattern already established by
// lib/domains/shipping-destination/constants.ts (T13D) and
// lib/domains/commercial-line-items/constants.ts (T13E.2). A third, distinct
// fact_key on the SAME "opportunity:<id>" anchor as shipping_destination and
// commercial_line_items - crm_request_facts' uniqueness is on
// (request_id, fact_key), so all three facts coexist without collision.
export const SELECTED_SHIPPING_OPTION_FACT_KEY = "selected_shipping_option";

export function buildSelectedShippingOptionRequestAnchor(opportunityId: number): string {
  return `opportunity:${opportunityId}`;
}

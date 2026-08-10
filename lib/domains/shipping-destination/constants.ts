// Durable shipping destination state (CRM-R1-T13D). Persisted on top of the
// existing crm_request_facts lifecycle (lib/brain/commercial/request-facts) -
// no new table. request_id there is an opaque VARCHAR(191) with no FK
// (migrations/017_crm_request_facts.sql): this fact key is anchored by
// opportunity, never by crm_conversation_requests.request_id (that runtime
// - lib/brain/commercial/conversation-request - is the non-canonical
// multi-request path the Native Agent Tool Loop never populates; see
// docs/audits/CRM-R1-T13B-shipping-destination-commune-resolution-audit.md
// section 14). The "opportunity:" prefix is deliberately distinct from that
// runtime's own "convreq-" prefix so the two id spaces can never collide.
export const SHIPPING_DESTINATION_FACT_KEY = "shipping_destination";

export function buildShippingDestinationRequestAnchor(opportunityId: number): string {
  return `opportunity:${opportunityId}`;
}

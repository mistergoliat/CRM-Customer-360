import type { RequestDefinition } from "./types";

const HUMAN_ESCALATION = [{ eventType: "human_escalation_created" as const }];

/**
 * Declarative behavior per request type: which facts gate mutations, which
 * capabilities apply, and - decisive - which observed EVENTS resolve or
 * escalate the request. Resolution never comes from model output: only these
 * conditions, evaluated deterministically, can close a request.
 *
 * `autoEscalate` / `primaryCapability` drive the turn executor
 * (executeRequestTurn.ts): they are the only two auto-execution strategies
 * implemented so far. product_quote/maintenance_quote deliberately have
 * neither - assembling a quote means picking a specific product for the
 * customer, which needs real recommendation/candidate-selection (a separate,
 * dedicated piece of work per ADR-006's "no inventar productos" boundary),
 * not a one-line capability call. They stay gated on their required facts.
 */
export const REQUEST_DEFINITIONS: readonly RequestDefinition[] = [
  {
    intentType: "product_information",
    domain: "catalog",
    requiredFacts: [],
    optionalFacts: ["product_hint"],
    allowedCapabilities: ["search_products", "get_product_information", "get_product_price"],
    resolutionConditions: [{ eventType: "information_provided", resolutionType: "information_provided" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null,
    autoEscalate: null,
    primaryCapability: { capability: "search_products", factKey: "product_hint", inputField: "query", fallbackToMessageText: true }
  },
  {
    intentType: "product_quote",
    domain: "sales",
    requiredFacts: ["products"],
    optionalFacts: ["quantity", "delivery_address_id"],
    allowedCapabilities: ["search_products", "get_product_information", "get_product_price", "list_customer_addresses", "get_customer_address", "create_quote", "send_quote"],
    resolutionConditions: [{ eventType: "quote_sent", resolutionType: "quote_sent" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: { purpose: "quote_follow_up", delayMinutes: 60 * 24 },
    autoEscalate: null,
    primaryCapability: null
  },
  {
    intentType: "maintenance_information",
    domain: "maintenance",
    requiredFacts: [],
    optionalFacts: ["equipment_code"],
    allowedCapabilities: ["identify_equipment", "get_service_price"],
    resolutionConditions: [{ eventType: "information_provided", resolutionType: "information_provided" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null,
    autoEscalate: null,
    // identify_equipment has no real source yet (implemented: false in the
    // registry) - this will keep deferring honestly until a service catalog exists.
    primaryCapability: { capability: "identify_equipment", factKey: "equipment_code", inputField: "query", fallbackToMessageText: true }
  },
  {
    intentType: "customer_identification",
    domain: "sales",
    requiredFacts: ["customer_email"],
    optionalFacts: ["customer_creation_consent", "customer_firstname", "customer_lastname"],
    allowedCapabilities: ["find_customer_by_email", "get_identity_status"],
    resolutionConditions: [
      { eventType: "identity_matched", resolutionType: "identity_matched" },
      { eventType: "customer_created", resolutionType: "customer_created" }
    ],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null,
    autoEscalate: null,
    primaryCapability: { capability: "find_customer_by_email", factKey: "customer_email", inputField: "query", fallbackToMessageText: false }
  },
  {
    intentType: "customer_registration",
    domain: "sales",
    requiredFacts: ["customer_email", "customer_firstname", "customer_lastname", "customer_creation_consent"],
    optionalFacts: ["customer_id"],
    allowedCapabilities: ["get_identity_status", "find_customer_by_email"],
    resolutionConditions: [{ eventType: "customer_created", resolutionType: "customer_created" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null,
    autoEscalate: null,
    primaryCapability: null
  },
  {
    intentType: "delivery_address_selection",
    domain: "sales",
    requiredFacts: ["customer_id"],
    optionalFacts: ["selected_delivery_address_id"],
    allowedCapabilities: ["list_customer_addresses", "get_customer_address"],
    resolutionConditions: [{ eventType: "delivery_address_selected", resolutionType: "delivery_address_selected" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null,
    autoEscalate: null,
    primaryCapability: null
  },
  {
    intentType: "delivery_address_confirmation",
    domain: "sales",
    requiredFacts: ["customer_id", "selected_delivery_address_id"],
    optionalFacts: ["confirmed_delivery_address_id"],
    allowedCapabilities: ["list_customer_addresses", "get_customer_address"],
    resolutionConditions: [{ eventType: "delivery_address_confirmed", resolutionType: "delivery_address_confirmed" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null,
    autoEscalate: null,
    primaryCapability: null
  },
  {
    intentType: "maintenance_quote",
    domain: "maintenance",
    requiredFacts: ["equipment_code"],
    optionalFacts: ["delivery_address_id", "preferred_datetime"],
    allowedCapabilities: ["identify_equipment", "get_service_price", "list_customer_addresses", "get_customer_address", "create_quote", "send_quote"],
    resolutionConditions: [{ eventType: "quote_sent", resolutionType: "quote_sent" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: { purpose: "maintenance_quote_follow_up", delayMinutes: 60 * 24 },
    autoEscalate: null,
    primaryCapability: null
  },
  {
    intentType: "order_status",
    domain: "order",
    requiredFacts: ["order_identifier"],
    optionalFacts: [],
    allowedCapabilities: ["find_order", "get_order_status"],
    resolutionConditions: [{ eventType: "order_status_provided", resolutionType: "order_status_provided" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null,
    autoEscalate: null,
    // No message-text fallback: an order identifier must come from a real
    // fact, never a guess from free text.
    primaryCapability: { capability: "get_order_status", factKey: "order_identifier", inputField: "orderIdentifier", fallbackToMessageText: false }
  },
  {
    intentType: "warranty",
    domain: "warranty",
    requiredFacts: [],
    optionalFacts: ["order_identifier", "equipment_code"],
    allowedCapabilities: ["find_order", "get_order_status"],
    resolutionConditions: [{ eventType: "information_provided", resolutionType: "information_provided" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null,
    autoEscalate: null,
    primaryCapability: { capability: "find_order", factKey: "order_identifier", inputField: "orderIdentifier", fallbackToMessageText: false }
  },
  {
    // A complaint never auto-resolves: only an operator closes it, so it has
    // no resolution conditions at all - the turn executor escalates it directly.
    intentType: "complaint",
    domain: "support",
    requiredFacts: [],
    optionalFacts: ["order_identifier"],
    allowedCapabilities: ["request_human_assistance"],
    resolutionConditions: [],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null,
    autoEscalate: { category: "customer_service", mode: "exclusive_handoff", reason: "complaint_requires_human_attention" },
    primaryCapability: null
  },
  {
    intentType: "human_assistance",
    domain: "human_assistance",
    requiredFacts: [],
    optionalFacts: [],
    allowedCapabilities: ["request_human_assistance"],
    resolutionConditions: [],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null,
    autoEscalate: { category: "customer_service", mode: "exclusive_handoff", reason: "customer_requested_human_assistance" },
    primaryCapability: null
  },
  {
    intentType: "general_question",
    domain: "general",
    requiredFacts: [],
    optionalFacts: [],
    allowedCapabilities: ["search_products"],
    resolutionConditions: [{ eventType: "information_provided", resolutionType: "information_provided" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null,
    autoEscalate: null,
    primaryCapability: { capability: "search_products", factKey: null, inputField: "query", fallbackToMessageText: true }
  }
];

const DEFINITIONS_BY_INTENT = new Map(REQUEST_DEFINITIONS.map((definition) => [definition.intentType, definition]));

const FALLBACK_DEFINITION = DEFINITIONS_BY_INTENT.get("general_question")!;

/** Unknown intent types behave like a general question - fail-open for reads, nothing auto-resolves them beyond information_provided. */
export function resolveRequestDefinition(intentType: string): RequestDefinition {
  return DEFINITIONS_BY_INTENT.get(intentType) ?? FALLBACK_DEFINITION;
}

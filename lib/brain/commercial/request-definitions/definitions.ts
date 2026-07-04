import type { RequestDefinition } from "./types";

const HUMAN_ESCALATION = [{ eventType: "human_escalation_created" as const }];

/**
 * Declarative behavior per request type: which facts gate mutations, which
 * capabilities apply, and - decisive - which observed EVENTS resolve or
 * escalate the request. Resolution never comes from model output: only these
 * conditions, evaluated deterministically, can close a request.
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
    followupPolicy: null
  },
  {
    intentType: "product_quote",
    domain: "sales",
    requiredFacts: ["products"],
    optionalFacts: ["quantity", "delivery_address_id"],
    allowedCapabilities: ["search_products", "get_product_information", "get_product_price", "list_customer_addresses", "get_customer_address", "create_quote", "send_quote"],
    resolutionConditions: [{ eventType: "quote_sent", resolutionType: "quote_sent" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: { purpose: "quote_follow_up", delayMinutes: 60 * 24 }
  },
  {
    intentType: "maintenance_information",
    domain: "maintenance",
    requiredFacts: [],
    optionalFacts: ["equipment_code"],
    allowedCapabilities: ["identify_equipment", "get_service_price"],
    resolutionConditions: [{ eventType: "information_provided", resolutionType: "information_provided" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null
  },
  {
    intentType: "maintenance_quote",
    domain: "maintenance",
    requiredFacts: ["equipment_code"],
    optionalFacts: ["delivery_address_id", "preferred_datetime"],
    allowedCapabilities: ["identify_equipment", "get_service_price", "list_customer_addresses", "get_customer_address", "create_quote", "send_quote"],
    resolutionConditions: [{ eventType: "quote_sent", resolutionType: "quote_sent" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: { purpose: "maintenance_quote_follow_up", delayMinutes: 60 * 24 }
  },
  {
    intentType: "order_status",
    domain: "order",
    requiredFacts: ["order_identifier"],
    optionalFacts: [],
    allowedCapabilities: ["find_order", "get_order_status"],
    resolutionConditions: [{ eventType: "order_status_provided", resolutionType: "order_status_provided" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null
  },
  {
    intentType: "warranty",
    domain: "warranty",
    requiredFacts: [],
    optionalFacts: ["order_identifier", "equipment_code"],
    allowedCapabilities: ["find_order", "get_order_status"],
    resolutionConditions: [{ eventType: "information_provided", resolutionType: "information_provided" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null
  },
  {
    // A complaint never auto-resolves: only an operator closes it, so it has
    // no resolution conditions at all.
    intentType: "complaint",
    domain: "support",
    requiredFacts: [],
    optionalFacts: ["order_identifier"],
    allowedCapabilities: ["request_human_assistance"],
    resolutionConditions: [],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null
  },
  {
    intentType: "human_assistance",
    domain: "human_assistance",
    requiredFacts: [],
    optionalFacts: [],
    allowedCapabilities: ["request_human_assistance"],
    resolutionConditions: [],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null
  },
  {
    intentType: "general_question",
    domain: "general",
    requiredFacts: [],
    optionalFacts: [],
    allowedCapabilities: ["search_products"],
    resolutionConditions: [{ eventType: "information_provided", resolutionType: "information_provided" }],
    escalationConditions: HUMAN_ESCALATION,
    followupPolicy: null
  }
];

const DEFINITIONS_BY_INTENT = new Map(REQUEST_DEFINITIONS.map((definition) => [definition.intentType, definition]));

const FALLBACK_DEFINITION = DEFINITIONS_BY_INTENT.get("general_question")!;

/** Unknown intent types behave like a general question - fail-open for reads, nothing auto-resolves them beyond information_provided. */
export function resolveRequestDefinition(intentType: string): RequestDefinition {
  return DEFINITIONS_BY_INTENT.get(intentType) ?? FALLBACK_DEFINITION;
}

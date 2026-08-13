import type { AgentLoopProviderMessage } from "../agent-loop/agentLoopProviderTypes";
import type { RecentCatalogContext } from "../agent-loop/recentCatalogContext";
import type { PendingCommercialIntentRecord } from "./types";

/**
 * LLM-R1-T09A, Part 2/16/20. The planner's ONE job: turn one customer
 * message into structured intents (semantic interpretation). It never sees
 * a productId/communeId, never decides which capability to call, and never
 * claims anything was done - the requirement resolver, execution planner and
 * executor (all deterministic, no LLM) own everything past this point. This
 * is what makes this call small and fast relative to the legacy Agent Tool
 * Loop's per-decision gathering calls (Part 19).
 */

export type IntentPlannerPriorAttemptFailure = { kind: "invalid_response" } | { kind: "invalid_plan_shape" };

export type BuildIntentPlannerPromptPackageInput = {
  customerMessage: string;
  recentCatalogContext: RecentCatalogContext | null;
  hasDurableSelection: boolean;
  durableSelectionItemCount: number;
  durableShippingDestinationName: string | null;
  pendingIntents: PendingCommercialIntentRecord[];
  priorAttemptFailure?: IntentPlannerPriorAttemptFailure | null;
};

const PLAN_JSON_INSTRUCTION =
  'Return exactly one JSON object matching {"intents":[...]}, nothing else, no markdown fence, no prose.';

const INTENT_SHAPES = [
  '{"type":"select_products","productReference":"...","quantity":N}',
  '{"type":"get_shipping_quote","destination":"..."}',
  '{"type":"unsupported","description":"..."}'
].join(" | ");

function buildSystemInstructions(priorAttemptFailure: IntentPlannerPriorAttemptFailure | null | undefined): string {
  const repairLines =
    priorAttemptFailure?.kind === "invalid_response"
      ? ["Your previous response was structurally invalid or empty.", "Return exactly one valid JSON object matching the contract below.", "Do not include markdown, prose, explanations, or any text outside the JSON object."]
      : priorAttemptFailure?.kind === "invalid_plan_shape"
        ? ["Your previous JSON did not match the required {\"intents\":[...]} shape.", "Return exactly one valid plan for the current message, correcting that specific problem."]
        : [];

  return [
    ...repairLines,
    "You extract commercial intents from one customer WhatsApp message. You do not execute anything and you do not decide prices, stock, or shipping costs - a separate deterministic backend does that from the values you extract.",
    PLAN_JSON_INSTRUCTION,
    `Each entry in intents must be one of: ${INTENT_SHAPES}.`,
    "A message can contain zero, one, or several distinct intents - list each one only once.",
    "Never include more than one intent of the same type in the same plan.",
    'select_products is for a product the customer wants to buy/add/change the quantity of. productReference should name the product as specifically as the customer did.',
    'If the customer used a pronoun or vague reference ("esa", "ese", "la anterior", "la misma") instead of a name, and recentCatalogContext below names exactly one product that is clearly what they mean, use that product\'s exact name as productReference instead of the pronoun. If more than one product in recentCatalogContext could match, keep the customer\'s own ambiguous words - the backend will ask which one, never guess yourself.',
    "quantity must be a positive whole number the customer actually stated - never invent or default one.",
    'get_shipping_quote is for a shipping cost/delivery question. destination should be the customer\'s own words for the commune/city they want delivery to - never invent, correct, or resolve it yourself; the backend resolves the real commune.',
    'If the customer only asks how much shipping/delivery costs without naming a specific commune or city, omit destination entirely - never use a generic shipping word itself (e.g. "despacho", "envio", "delivery") as if it were a place name.',
    "If pendingIntents below lists an intent still missing a field, and the customer's current message plausibly answers exactly that missing field (e.g. a bare commune name while get_shipping_quote is missing destination, or a bare product name/quantity while select_products is missing one), emit that same intent type again with the field now filled in from this message - a short, on-topic reply is never \"unsupported\".",
    "Only use select_products or get_shipping_quote when the message is actually asking for a product purchase/selection or a shipping cost. Anything else this system does not implement (holding an item for someone else, custom requests, complaints, unrelated questions, anything you are not sure maps to one of the two types above) must be {\"type\":\"unsupported\"} with a short description - never invent a third type, never force-fit it into select_products/get_shipping_quote.",
    "You never invent that a product was selected, added, or that shipping was calculated - you only report what the customer is asking for."
  ].join("\n");
}

export function buildIntentPlannerPromptPackage(input: BuildIntentPlannerPromptPackageInput): { messages: AgentLoopProviderMessage[] } {
  const catalogProductNames = [
    ...new Set((input.recentCatalogContext?.interactions ?? []).flatMap((interaction) => interaction.products.map((product) => product.name)))
  ].slice(0, 20);

  const userPayload = {
    customerMessage: input.customerMessage,
    recentCatalogContextProductNames: catalogProductNames,
    durableState: {
      hasSelection: input.hasDurableSelection,
      selectionItemCount: input.durableSelectionItemCount,
      shippingDestination: input.durableShippingDestinationName
    },
    pendingIntents: input.pendingIntents.map((record) => ({ type: record.intent.type, missingRequirements: record.missingRequirements })),
    question: "What commercial intents does this message express?"
  };

  return {
    messages: [
      { role: "system", content: buildSystemInstructions(input.priorAttemptFailure) },
      { role: "user", content: JSON.stringify(userPayload) }
    ]
  };
}

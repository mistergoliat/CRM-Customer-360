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
  /** SALES-AGENT-R2-A08.6, Part 2. Sum of quantities across the durable selection - lets the model compute an absolute new quantity for "quita una"/"deja 3"-style corrections without inventing arithmetic it can't ground. Null when there is no durable selection at all. */
  durableSelectionQuantity: number | null;
  durableShippingDestinationName: string | null;
  pendingIntents: PendingCommercialIntentRecord[];
  /** SALES-AGENT-R2-A08.6, Part 5. The single most recent agent-authored message, if any - the only context that lets a bare "sí" be interpreted safely, never inferred from anything else. Null when there is none or it is out of the recency window the caller applies. */
  lastAgentMessage: string | null;
  priorAttemptFailure?: IntentPlannerPriorAttemptFailure | null;
};

const PLAN_JSON_INSTRUCTION =
  'Return exactly one JSON object matching {"intents":[...]}, nothing else, no markdown fence, no prose.';

const INTENT_SHAPES = [
  '{"type":"select_products","productReference":"...","quantity":N}',
  '{"type":"get_shipping_quote","destination":"..."}',
  '{"type":"create_quote"}',
  '{"type":"cancel","scope":"selection"|"destination"|"shipping"|"quote"|"all","additionalScopes":["shipping"|"quote"|"selection"|"destination", ...]}',
  '{"type":"unsupported","description":"..."}'
].join(" | ");

/**
 * SALES-AGENT-R2-A08.7, Part 14. The A08.6 cancel-scope rule was a single
 * prose sentence buried inside a long instruction list - live-validated
 * (SALES-AGENT-R2-A08.6-semantic-completeness-integration-closure.md, item
 * 15) to be followed 10/10 for untargeted phrases but 0/8 for phrases naming
 * a specific target, despite those exact phrases already being listed in the
 * prose. Root cause was prompt salience, not a wiring gap - every downstream
 * layer (parser/resolver/adapter/reconciliation) already carries scope
 * correctly once the planner emits it (see parseCommercialIntentPlan.ts,
 * semanticIntentAdapter.ts, reconciliation.ts's cancelTargetFamily). This
 * table format - one line per literal phrase-to-scope mapping, separated from
 * the rest of the instructions - is the fix: an explicit input->output example
 * a model can pattern-match, not a rule it has to apply from a description.
 */
const CANCEL_SCOPE_EXAMPLES = [
  '"olvidalo" -> {"scope":"all"}',
  '"olvidalo todo" -> {"scope":"all"}',
  '"dejalo" -> {"scope":"all"}',
  '"no importa" -> {"scope":"all"}',
  '"cancela eso" -> {"scope":"all"} (only when nothing more specific was named this turn)',
  '"cancela todo" -> {"scope":"all"}',
  '"mejor no" -> {"scope":"all"}',
  '"ya no quiero nada" -> {"scope":"all"}',
  '"no necesito despacho" -> {"scope":"shipping"}',
  '"olvida el despacho" -> {"scope":"shipping"}',
  '"cancela el despacho" -> {"scope":"shipping"}',
  '"ya no quiero despacho" -> {"scope":"shipping"}',
  '"sin despacho" -> {"scope":"shipping"}',
  '"no cotices el envio" -> {"scope":"shipping"}',
  '"no calcules despacho" -> {"scope":"shipping"}',
  '"no quiero cotizacion" -> {"scope":"quote"}',
  '"mejor no cotices" -> {"scope":"quote"}',
  '"olvida la cotizacion" -> {"scope":"quote"}',
  '"cancela la cotizacion" -> {"scope":"quote"}',
  '"no me hagas la cotizacion" -> {"scope":"quote"}',
  '"ya no necesito la cotizacion" -> {"scope":"quote"}',
  '"quita los productos" / "olvida la seleccion" -> {"scope":"selection"}',
  '"no quiero despacho ni cotizacion" -> {"scope":"shipping","additionalScopes":["quote"]}',
  '"olvida el despacho, solo quiero los productos" -> {"scope":"shipping"} (plus a separate select_products intent for "solo quiero los productos" if it adds new information, otherwise nothing extra)'
].join("\n");

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
    'A message that only corrects the quantity of a product already selected ("mejor 3", "que sean 3", "cambialo a 3", "deja 3", "solo 3", "mejor dame 4", "ponme 2") - without naming a different product - is still select_products: set quantity to the new total the customer wants, and OMIT productReference entirely (never restate or guess the product name; the backend already knows which product this refers to from the active selection). durableState.selectionQuantity below tells you the customer\'s current total quantity, if any - use it to compute a NEW ABSOLUTE total for a relative phrase (e.g. "quita una" with a current quantity of 2 means quantity:1; "una mas" with 2 means quantity:3). If there is no current selection to correct, or the relative phrase cannot be resolved into a safe whole number from the given quantity alone, do not guess - use {"type":"unsupported"} instead.',
    'get_shipping_quote is for a shipping cost/delivery question. destination should be the customer\'s own words for the commune/city they want delivery to - never invent, correct, or resolve it yourself; the backend resolves the real commune.',
    'If the customer only asks how much shipping/delivery costs without naming a specific commune or city, omit destination entirely - never use a generic shipping word itself (e.g. "despacho", "envio", "delivery") as if it were a place name.',
    'create_quote is for the customer explicitly asking to prepare/generate/send a quote or price document ("hazme una cotizacion", "cotizame esto", "quiero una cotizacion", "mandame una cotizacion", "puedes cotizarme estas 2", "preparame la cotizacion"). It never carries any fields.',
    'If lastAgentMessage below shows the agent just asked something like "would you like me to prepare a quote" and the customer\'s current message is a short, clear, unqualified affirmative ("si", "sí", "dale", "ya", "obvio", "porfavor") with no other content, that is create_quote too - the confirmation is answering exactly that question, nothing else. If lastAgentMessage did not ask about a quote, or the customer\'s reply could plausibly mean something else, do not guess - use unsupported instead. A bare "si" is NEVER create_quote unless lastAgentMessage makes the referent unambiguous.',
    'cancel is for the customer explicitly withdrawing, dropping, or rejecting something already in progress. Choose the NARROWEST scope the customer\'s own words actually name - "shipping" only for despacho/envio/delivery, "quote"/"cotizacion" only for the quote, "selection" only for the product(s) chosen, "destination" only for the delivery address/commune itself, "all" ONLY for a general, untargeted cancellation with no specific target named. Never pick "all" when a specific target was named - this is the single most common mistake, avoid it. If the message names more than one specific target, put the first in scope and the rest in additionalScopes (never omit a second named target, never use additionalScopes to add "all"). The exact mapping below is authoritative - match the customer\'s message against these examples first:',
    CANCEL_SCOPE_EXAMPLES,
    "If pendingIntents below lists an intent still missing a field, and the customer's current message plausibly answers exactly that missing field (e.g. a bare commune name while get_shipping_quote is missing destination, or a bare product name/quantity while select_products is missing one), emit that same intent type again with the field now filled in from this message - a short, on-topic reply is never \"unsupported\".",
    'Only use select_products, get_shipping_quote, create_quote, or cancel when the message actually matches one of those - as described above. Anything else this system does not implement (holding an item for someone else, custom requests, complaints, unrelated questions, anything you are not sure maps to one of the four types above) must be {"type":"unsupported"} with a short description - never invent a fifth type, never force-fit it into one of the four.',
    "You never invent that a product was selected, added, that shipping was calculated, that a quote was created, or that something was cancelled - you only report what the customer is asking for."
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
      selectionQuantity: input.durableSelectionQuantity,
      shippingDestination: input.durableShippingDestinationName
    },
    pendingIntents: input.pendingIntents.map((record) => ({ type: record.intent.type, missingRequirements: record.missingRequirements })),
    lastAgentMessage: input.lastAgentMessage,
    question: "What commercial intents does this message express?"
  };

  return {
    messages: [
      { role: "system", content: buildSystemInstructions(input.priorAttemptFailure) },
      { role: "user", content: JSON.stringify(userPayload) }
    ]
  };
}

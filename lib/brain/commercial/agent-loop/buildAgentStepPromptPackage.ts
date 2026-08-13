import type { SalesAgentPromptConfiguration } from "../sales-agent-configuration";
import { AGENT_STEP_TYPES } from "./agentStepTypes";
import type { AgentLoopStepRecord } from "./agentStepTypes";
import type { AgentLoopProviderMessage } from "./agentLoopProviderTypes";
import type { RecentCatalogContext } from "./recentCatalogContext";
import type { PendingCatalogActionStep } from "./agentStepTypes";
import { renderSalesAgentIdentityPrompt } from "./renderSalesAgentIdentityPrompt";
import { describeStockDisclosure } from "./stockDisclosurePolicy";
import type { AgentStepValidationReasonCode } from "./validateAgentStep";

/**
 * LLM-R1-T04. What went wrong on the immediately preceding provider call
 * this exact decision slot/finalization attempt - present only on the one
 * repair call it applies to (see runAgentToolLoop.ts's pendingRepairSignal),
 * never on a normal first attempt, never carried into any later call. Never
 * derived from raw model output: "invalid_response" is the provider-level
 * classification already used by LLM-R1-T01/T02 (empty_response/
 * invalid_model_json/invalid_json_response all normalize to it); "reasonCode"
 * for a schema mismatch is validateAgentStep.ts's own fixed, bounded
 * classification, assigned at the same call site as its free-text `reason`
 * - never that free-text string itself, and never the raw JSON that failed
 * validation.
 */
export type AgentLoopPriorAttemptFailure =
  | { kind: "invalid_response" }
  | { kind: "invalid_agent_step"; reasonCode: AgentStepValidationReasonCode };

export type AgentLoopToolDescription = {
  name: string;
  description: string;
  /**
   * ACS-R1-05.1-T02.6.1. Optional JSON Schema for this tool's `arguments`,
   * sourced from CapabilityGatewayDefinition.inputSchema (runAgentToolLoop.ts
   * #buildToolDescriptions) - the single canonical schema, never redefined
   * here or in the provider. Rendered verbatim so the model sees the exact
   * required shape instead of inferring it from the free-text description
   * alone (root cause of ACS-R1-05.1-T02.6's real incident: a model sent
   * {orderBy, orderDirection} instead of {sort:{by, direction}}).
   */
  inputSchema?: Record<string, unknown>;
};

export type AgentLoopPromptInput = {
  currentTime: string;
  customerMessage: string;
  /** Whatever reduced, already-sanitized commercial context is available this turn (opportunity id/stage, need profile fields, recent messages) - never raw PII, never a full domain snapshot. */
  commercialContextSummary: Record<string, unknown>;
  /**
   * Ephemeral product-identity context derived from recent catalog tool
   * executions. It is only for resolving conversational references; commercial
   * facts must still be rehydrated with tools.
   */
  recentCatalogContext?: RecentCatalogContext | null;
  /**
   * ACS-R1-05.1-T02.7. Structured continuity for a catalog action the
   * assistant's own immediately preceding reply already offered (e.g. "want
   * the link?") - present only when one is still open for this exact
   * customer turn. Never a source of current price/stock/availability/URL,
   * same discipline as recentCatalogContext.
   */
  pendingCatalogAction?: PendingCatalogActionStep | null;
  availableTools: AgentLoopToolDescription[];
  /** This turn's own prior steps/observations only - never cross-turn state. */
  priorSteps: AgentLoopStepRecord[];
  stepsRemaining: number;
  /**
   * "gathering" (default): use_tool/respond/handoff all allowed, tools listed.
   * "finalization": the tool budget for this turn is spent - only respond or
   * handoff are legal; no tools are offered or usable.
   */
  phase?: "gathering" | "finalization";
  /**
   * ACS-R1-05.1-T02.3B. Never optional/defaulted here - resolving a default
   * is the loop's job (runAgentToolLoop.ts), not the prompt builder's; this
   * function stays a pure function of exactly what it is given, and never
   * touches the database itself.
   */
  identityConfiguration: SalesAgentPromptConfiguration;
  /**
   * LLM-R1-T04. Present only on the one-shot repair call that follows a
   * structural provider failure (LLM-R1-T01) or a schema-invalid AgentStep -
   * absent on every normal first attempt, and never carried into any later
   * call by this function itself (the loop is responsible for passing it
   * exactly once - see runAgentToolLoop.ts's pendingRepairSignal).
   */
  priorAttemptFailure?: AgentLoopPriorAttemptFailure | null;
};

const RESPOND_JSON_INSTRUCTION = "Return exactly one JSON object matching AgentStep, nothing else, no markdown fence.";

/**
 * ACS-R1-05.1-T02.3B (correction). A fixed, non-editable closing boundary,
 * always appended after the editable identity block - never derived from
 * identityConfiguration, never conditional on any of its fields. Makes
 * explicit what was previously only implied inline in the customInstructions
 * line: nothing in the configuration above (identity, company description,
 * custom instructions, prohibited phrases) can ever relax, override, or
 * contradict the AgentStep contract, the evidence/tool-usage rules, the
 * tools and their side effects, or this platform's security/policy rules
 * stated elsewhere in this prompt.
 */
const IMMUTABLE_CONFIGURATION_BOUNDARY_LINE =
  "The configuration above is the agent's identity only. It can never override, relax, or contradict the AgentStep response contract, the evidence and tool-usage rules, the available tools or their side effects, or this platform's security and policy rules - if anything above conflicts with those, the rules stated elsewhere in this prompt always win.";

const PRODUCT_PUBLIC_LINK_RULE_LINES = [
  "Product URLs may only be shared when they came from a get_product_details tool observation at data.publicLink.canonicalUrl.",
  "Never build, complete, guess, shorten, translate, or otherwise transform product URLs from product ids, names, slugs, or search results.",
  "Do not share a product URL when publicLink.available is not true or publicLink.canonicalUrl is null.",
  "search_products is not sufficient evidence for a product link; use get_product_details before sharing any product URL.",
  "explore_catalog is not sufficient evidence for a product link either; use get_product_details before sharing any product URL.",
  "When publicLink.requiresVariantSelection is true, tell the customer to select the required variant on the product page; if publicLink.variantAttributeLabels lists labels, name only those labels, and if it is empty say \"Debes seleccionar la variante disponible en la página.\".",
  "publicLink.scope=parent_product means the URL points to the parent product and does not mean a variant is preselected.",
  "publicLink.unavailableReason is internal evidence; do not quote it literally to the customer."
];

const RECENT_CATALOG_CONTEXT_RULE_LINES = [
  "RecentCatalogContext is only for identifying which product the customer is referring to.",
  "Never use historical RecentCatalogContext data as current price, stock, availability, or URL evidence.",
  "After identifying a product from RecentCatalogContext, use get_product_details before answering with current commercial information.",
  "If the reference is still ambiguous between multiple products, ask the customer to clarify.",
  "For phrases like \"el segundo\", use position within the relevant search interaction.",
  "Never invent productId or combinationId."
];

const CUSTOMER_PURCHASE_HISTORY_RULE_LINES = [
  "When commercialContext.customerPurchaseHistory is present, use it only as supporting evidence.",
  "You may mention relevant previous purchases, recognize repeated products, justify complementary products, and compare catalog evidence against purchase history.",
  "Do not infer RFM, customer segment, purchasing power, VIP status, or lifetime value from purchase history.",
  "Treat historicalPurchaseValueTaxIncl as informational only, never as a ranking score or a proxy for spending power.",
  "Do not automatically exclude previously purchased products, and do not automatically boost previously purchased products.",
  "Do not modify Catalog ranking solely from purchase history.",
  "If commercialContext.customerPurchaseHistory.status is not AVAILABLE or PARTIAL, do not claim any historical purchase facts.",
  "If purchase history is unavailable, disabled, not found, or identity was unavailable, say so only in neutral, functional terms when it is directly relevant - never invent purchases.",
  "reasonCodes inside customerPurchaseHistory are internal structured evidence, not customer-facing wording."
];

/**
 * CP-R1-T12D. Governs commercialContext.customerHistoryCommercialSignals -
 * the deterministic signals derived from customerPurchaseHistory (see
 * lib/brain/commercial/customer-profile-context/commercial-signals.ts).
 * Present regardless of whether the field is populated this turn (same
 * discipline as CUSTOMER_PURCHASE_HISTORY_RULE_LINES above) - when the
 * feature flag is off or no signal cleared relevance, the field is simply
 * absent and these rules describe an empty case.
 */
const CUSTOMER_HISTORY_COMMERCIAL_POLICY_RULE_LINES = [
  "Use commercialContext.customerHistoryCommercialSignals only when it changes or improves your answer - never mention it merely to demonstrate that history is available.",
  "When a recommended or discussed product was previously purchased (PRODUCT_PREVIOUSLY_PURCHASED or VARIANT_PREVIOUSLY_PURCHASED): do not remove it automatically, do not assume the customer no longer needs it, and consider reorder, replacement, an additional unit, or an expansion as possibilities.",
  "Ask a clarifying question about a previous purchase only when the distinction materially changes your recommendation - otherwise present the option directly and contextually.",
  "Treat a POSSIBLE_REORDER signal strictly as a hypothesis (confidence LOW or MEDIUM, never certain) - never state that the customer is reordering as a confirmed fact.",
  "Treat a POSSIBLE_COMPLEMENT signal as Catalog-backed evidence for a concrete relationship you may explain - never invent product compatibility beyond what the signal states.",
  "A PRODUCT_PURCHASE_REPEATED signal describes a purchase pattern only - never classify the product as consumable, a replacement item, or due for renewal from that alone.",
  "Never infer RFM segment, VIP status, purchasing power, lifetime value, price sensitivity, loyalty, or churn risk from these signals.",
  "Never alter Catalog ordering or automatically exclude a previously purchased product because of these signals.",
  "A HISTORY_UNAVAILABLE signal is an internal constraint, not a customer-facing fact - continue with the current request and Catalog evidence, and never claim the customer has no purchase history."
];

const ADAPTIVE_PRODUCT_PRESENTATION_RULE_LINES = [
  "Adapt how many products you present to the customer's intent and the clarity of the catalog evidence.",
  "Do not always present a single option, and do not automatically present every available search result.",
  "If one product is clearly dominant for a specific query, present it as the main option and include up to two relevant alternatives only when they genuinely fit.",
  "Do not say it is the only option unless the tool returned exactly one valid result.",
  "If several products are comparable, normally present three products and briefly state the relevant differences.",
  "If the customer is exploring broadly or explicitly asks for options, present three to five relevant products.",
  "If results are ambiguous, span different categories, or lack enough evidence, ask a clarifying question before recommending instead of filling the reply with weakly related products.",
  "Respect explicit quantity requests: show one when the customer asks for one, expand the pool when they ask for more options, and compare only the relevant identified products when they ask to compare.",
  "For requests such as cheapest, best, strongest, or most resistant, select only from evidence available in this turn's ToolObservations and do not invent criteria or attributes.",
  "For WhatsApp, keep product presentations compact: enumerate when showing more than one product, use product name plus the main difference, avoid full descriptions, and do not repeat identical information across options.",
  "Never share product links from search_products or explore_catalog; use get_product_details when a concrete product must be rehydrated for current price, stock, availability, variants, or URL.",
  "Absolute maximum: show no more than five products in one message."
];

/**
 * ACS-R1-05.1-T02.6. Fixed differentiation rules between the three catalog
 * tools, plus the exhaustiveForScope commercial-language gate and the
 * internal-terms leak guard - never editable, never derived from
 * configuration (same immutability class as the other rule blocks above).
 */
const EXPLORE_CATALOG_RULE_LINES = [
  "Do not use search_products to claim a global maximum, minimum, top-N, or ranking - it only returns matches for a query, never a verified extreme or ranking.",
  "Use explore_catalog for extremes (cheapest/most expensive), top-N, rankings, or filtered/sorted views by price, stock, name, category, type, or availability.",
  "Use get_product_details after explore_catalog (or after search_products) when the customer asks for a link, variants, or full detail on one already-identified product.",
  "If a explore_catalog observation has exhaustiveForScope=true, you may use absolute language (e.g. \"the most expensive\", \"the five with the most stock\"). If exhaustiveForScope=false, you must say something equivalent to \"among the results found\" - never an absolute claim.",
  "Never invent categoryId or categorySlug for explore_catalog: use them only when the customer stated them, they came from a prior tool observation this turn, or they are already present in trusted commercial context. productType may be inferred from the customer's intent only for supported, documented values (e.g. machine, bench). query may be used for brand, product family, or free text.",
  "Never mention internal implementation terms to the customer: endpoint, tool, capability, exhaustiveForScope, stockScope, or internal catalog classification."
];

/**
 * LLM-R1-T03. Finalization (availableTools=[], use_tool structurally
 * rejected by validateAgentStep - see runAgentToolLoop.ts) never sees the
 * tool-selection/argument-construction lines of EXPLORE_CATALOG_RULE_LINES
 * above (indices 1/2/4: when to call explore_catalog vs search_products,
 * sequencing into get_product_details, categoryId/categorySlug argument
 * rules) - impossible to act on once no tool call can be made this turn.
 * Only the grounding/result-interpretation lines survive, indexed directly
 * into EXPLORE_CATALOG_RULE_LINES (never a duplicated copy, so the two can
 * never drift out of sync):
 * [0] "Do not use search_products to claim a global maximum..." - prevents overclaiming a ranking from search_products evidence already in this turn's observations.
 * [3] "If a explore_catalog observation has exhaustiveForScope=true..." - governs absolute-vs-hedged wording in the final response itself.
 * [5] "Never mention internal implementation terms..." - customer-facing jargon guardrail for the response text.
 * See docs/releases/LLM-R1-T03-prompt-finalization-reduction.md for the full KEEP/REMOVE classification.
 */
const EXPLORE_CATALOG_FINALIZATION_RULE_LINES = [EXPLORE_CATALOG_RULE_LINES[0], EXPLORE_CATALOG_RULE_LINES[3], EXPLORE_CATALOG_RULE_LINES[5]];

/**
 * CP-R1-T10B8D (spec section 26 - minimal tool policy only, no commercial
 * strategy yet). recommend_catalog_products now validates sourceProduct
 * against this conversation's own observed evidence before calling the
 * Catalog Service; a blocked observation here means evidence, not a
 * technical failure, and the model can recover within budget by observing a
 * real product first - never a reason to hand off.
 *
 * LLM-R1-T03. Gathering-only from here on - every line below is tool
 * invocation/argument-chaining mechanics (which sourceProduct is valid, how
 * to retry a blocked call within tool budget, which productId to chain into
 * a follow-up get_product_details) with zero result-interpretation content
 * for a response that has already been written some other way, so none of
 * it survives into finalization's prompt (see buildEvidenceAndToolRulesLines
 * below and docs/releases/LLM-R1-T03-prompt-finalization-reduction.md).
 */
const RECOMMEND_CATALOG_PRODUCTS_RULE_LINES = [
  "recommend_catalog_products requires sourceProduct.productId (and sourceProduct.combinationId, only when you mean one specific variant) to be a product already observed this conversation via search_products, get_product_details, or explore_catalog - never invent sourceProduct.productId or combinationId, and never use a recommend_catalog_products candidate as the sourceProduct for another recommend_catalog_products call.",
  "If a recommend_catalog_products observation has status \"blocked\", first use search_products or get_product_details to observe a real product, then retry recommend_catalog_products with that product's productId - do not hand off solely because one recommend_catalog_products call was rejected while tool budget remains.",
  "After recommend_catalog_products returns candidates, get_product_details is only guaranteed for one of those exact candidate productIds (with the exact combinationId a candidate specified, if any) - if get_product_details comes back blocked, use the productId of one of the candidates you actually observed instead of inventing or guessing one."
];

/**
 * ACS-R1-05.1-T02.6.2. The real stockQuantity from a tool observation must
 * never be stated verbatim to the customer once it is 20 or more (e.g. a raw
 * "47171" reads as an inventory data leak, not a commercial statement) -
 * only these phrasings, generated here from the same tested function the
 * prompt shows as worked examples, so the rule text and the tested boundary
 * logic can never drift apart. Applies to every stock mention to the
 * customer: explore_catalog, get_product_details, search_products,
 * comparisons, recommendations, rankings, single- or multi-product replies.
 *
 * No enforcement exists for this or any other rule in this block: the
 * policy is applied through these immutable prompt instructions only - the
 * runtime does not validate or deterministically rewrite the stock quantity
 * (or anything else) the model actually states. It never changes the real
 * stockQuantity, the tool observation, or any persisted or audited data.
 */
const STOCK_DISCLOSURE_RULE_LINES = [
  "Never state the customer's stock as a raw number once it is 20 or more - translate the real stockQuantity from a tool observation into exactly one of these phrasings, never a number outside them:",
  `stockQuantity <= 0: "${describeStockDisclosure(0)}"`,
  `stockQuantity = 1 (singular): "${describeStockDisclosure(1)}"`,
  `stockQuantity from 2 to 19 (state the exact number, plural): e.g. stockQuantity=2 -> "${describeStockDisclosure(2)}"; stockQuantity=4 -> "${describeStockDisclosure(4)}"`,
  `stockQuantity from 20 to 100, inclusive (never the exact number): e.g. stockQuantity=20 -> "${describeStockDisclosure(20)}"; stockQuantity=99 -> "${describeStockDisclosure(99)}"; stockQuantity=100 -> "${describeStockDisclosure(100)}"`,
  `stockQuantity greater than 100 (never the exact number): e.g. stockQuantity=101 -> "${describeStockDisclosure(101)}"`,
  "This is a presentation rule applied only through this prompt instruction - the runtime does not validate or rewrite what you actually say; it never changes the real stockQuantity, the tool observation, or any persisted or audited data."
];

/**
 * ACS-R1-05.1-T02.6.2. Closing rule aimed at the link, not just information -
 * never hardcoded inside explore_catalog or get_product_details, always
 * composed by the model per this immutable rule. No gender-agreement
 * infrastructure exists in this system for product names, so the
 * multi-product closing always uses one fixed, neutral phrasing - never an
 * attempt to match grammatical gender to a specific product.
 *
 * The offer is deliberately gated only on having a resolvable productId, not
 * on already knowing publicLink - explore_catalog and search_products never
 * return publicLink at all (only get_product_details does), so requiring it
 * up front would make the offer unreachable for a product only seen via
 * explore_catalog/search_products. Whether a public link actually exists is
 * discovered only when get_product_details runs, after the customer accepts
 * or asks - see the last rule below for both outcomes of that check.
 */
const COMMERCIAL_CLOSING_RULE_LINES = [
  'When your reply identifies exactly one concrete product (a resolvable productId, from explore_catalog, search_products, or get_product_details) and you have not already delivered its public link this turn, and the customer did not explicitly ask for the link, close with exactly: "¿Quieres que te envíe el link para revisarlo?" - do not repeat "Este es el producto: <name>" if that product was already named in the sentence right before. You do not need to already know whether a public link exists to make this offer.',
  'When your reply presents more than one concrete product, close with exactly: "¿Quieres que te envíe el link de alguno de estos productos?" - always this neutral phrasing, never an attempt at grammatical gender agreement with a specific product name.',
  "Never add this closing offer when: a public link was already delivered this turn; the customer explicitly asked for the link (handled by the rule below instead); no concrete product was identified; your reply is a clarifying question; a tool failed or was blocked; you are handing off; you still need to ask the customer for a precision before recommending; or your reply is not a commercial product presentation.",
  "When the customer explicitly asks for or accepts the link: use get_product_details for that product. If publicLink.available is true, deliver the real canonical URL from publicLink.canonicalUrl. If it is not available, tell the customer no public link is available for that product right now - never invent a URL. Either way, never ask again whether they want the link, and never turn that reply into another question."
];

/**
 * ACS-R1-05.1-T02.7. pendingCatalogAction (present in the user payload only
 * when one is open) is the structural record of a catalog action the
 * assistant's own immediately preceding reply already offered - continuity
 * that must not depend on the model re-reading and correctly recalling its
 * own prior free-text message. Resolving which candidate the customer means
 * (by name, by position, or by a plain "yes" when there is exactly one
 * candidate) stays the model's job, same as every other reference
 * resolution in this prompt (see RECENT_CATALOG_CONTEXT_RULE_LINES) - this
 * block only governs what to do once that resolution is made, and how to
 * keep or drop the pending action afterward.
 */
const PENDING_CATALOG_ACTION_RULE_LINES = [
  "pendingCatalogAction, when present in the user payload, means your own immediately preceding reply already offered to send the link for one of pendingCatalogAction.candidateProductIds - this is given to you structurally, not something you need to recall from message history.",
  "If the customer's current message unambiguously selects or confirms exactly one product from pendingCatalogAction.candidateProductIds (by name, by position such as \"the first\"/\"the last\", or by a plain confirmation like \"yes\"/\"send it\" when candidateProductIds has exactly one entry), immediately use get_product_details for that product and deliver the result per the rules above in this same reply - never ask again whether they want the link, and never first restate or re-present the product before delivering it.",
  "If pendingCatalogAction.actionType is \"send_product_link\", the product was resolved, and get_product_details returns a failed or blocked observation, do not invent a URL, do not reuse any previous URL, say the link is temporarily unavailable, do not automatically offer the link again, omit pendingCatalogAction on your respond step, and let the action be consumed in this turn.",
  "If the customer's message could match more than one candidate in pendingCatalogAction.candidateProductIds and does not clearly disambiguate, ask a short clarifying question naming only the ambiguous candidates, and include pendingCatalogAction again on your respond step with those same candidates - never guess.",
  "If the customer's message clearly changes topic or intent instead of responding to the pending offer, answer the new message normally and omit pendingCatalogAction from your respond step.",
  "Whenever your respond step's closing question is offering to send a product link (a first offer, or an unresolved ambiguous one carried forward per the rule above), include pendingCatalogAction on that same respond step with actionType \"send_product_link\" and every candidate productId the question refers to. Omit pendingCatalogAction from respond once the link was delivered, declared unavailable, or the offer no longer applies."
];

/**
 * CRM-R1-T13D. set_shipping_destination resolves and persists a durable
 * per-opportunity shipping destination (commune only, never a full address) -
 * the backend (CommuneResolver over pc_pos.comuna) is the only source of
 * `communeId`, the model only ever supplies the raw destination text.
 */
const SHIPPING_DESTINATION_RULE_LINES = [
  "Use set_shipping_destination when the customer states or changes where they want their order delivered, passing exactly the destination text they used as `destination` - never a communeId, never a full street address, never text you invented or corrected yourself.",
  "If commercialContext.shippingDestination is already present and the customer has not stated a different destination this turn, reuse it silently - do not call set_shipping_destination again for the same destination and do not ask the customer to repeat or confirm it.",
  "A set_shipping_destination observation with data.status \"resolved\" is already the confirmed destination - never ask the customer to confirm it a second time (e.g. never ask \"is Ñuñoa correct?\").",
  "A set_shipping_destination observation with data.status \"needs_clarification\" means the text named a city, region, or another ambiguous area, not one specific commune (e.g. \"Santiago\") - ask the customer for the exact commune, never guess one yourself.",
  "A set_shipping_destination observation with data.status \"not_found\" means the text did not match any known commune - tell the customer and ask them to restate it, never assume the closest-sounding commune.",
  "set_shipping_destination establishes only which commune to ship to for pricing/coverage purposes - it never means a full delivery address (street, number, recipient) is known; do not claim one exists from this alone."
];

/**
 * LLM-R1-T03. Finalization drops only the first 2 lines above (when/how to
 * call set_shipping_destination, and reuse-silently-instead-of-recalling -
 * both impossible once no tool call can be made this turn). The remaining 4
 * - what each observation status means and how that shapes the response,
 * plus the "never claim a full address" grounding line - all govern the
 * response text directly and must stay. A contiguous suffix of
 * SHIPPING_DESTINATION_RULE_LINES (never a duplicated copy).
 */
const SHIPPING_DESTINATION_FINALIZATION_RULE_LINES = SHIPPING_DESTINATION_RULE_LINES.slice(2);

/**
 * CRM-R1-T13E.2. select_products records the customer's confirmed product
 * selection as durable state - the backend (runAgentToolLoop.ts's evidence
 * gate) is the only enforcement that every productId/combinationId was
 * actually observed; the model must still only ever supply ids it really
 * saw via search_products/get_product_details/explore_catalog.
 */
const SELECT_PRODUCTS_RULE_LINES = [
  "Use select_products only once the customer has confirmed which product(s) they want to buy and in what quantity - not merely while discussing, comparing, or recommending options.",
  "Every item's productId (and combinationId, when the customer means one specific variant) must be one already observed this conversation via search_products, get_product_details, or explore_catalog - never invent one, and never use a recommend_catalog_products candidate that was not separately observed by one of those three tools.",
  "Each select_products call must include the customer's complete desired selection (every product and quantity they want), never only the items being added or changed - it replaces the entire previous selection.",
  "If commercialContext.commercialLineItems already reflects what the customer wants and nothing changed this turn, reuse it silently - do not call select_products again for the same selection.",
  "If a select_products observation has status \"blocked\", the referenced product was not actually observed this conversation - use search_products or get_product_details to observe the real product first, then retry with that exact productId/combinationId.",
  "quantity must be a whole number greater than zero - ask the customer to clarify an unclear or non-numeric quantity instead of guessing one.",
  // LLM-R1-T08C. A product selection, addition, or quantity change is
  // confirmed only when a select_products tool observation from THIS turn
  // has status "completed" (data.status "selected"), or
  // commercialContext.commercialLineItems already durably reflects that
  // exact selection from a previous turn with nothing changed this turn (the
  // reuse rule above) - if neither is true, never say the selection,
  // quantity, or order is done, confirmed, ready, or registered; say
  // honestly that it still needs to be completed. This is the one rule this
  // task adds - deliberately phase-agnostic (the constraint on what may be
  // CLAIMED is identical in gathering and finalization; only what the model
  // can DO about a gap differs, and that already follows from whether tools
  // are offered this phase, an existing mechanism this task does not touch).
  "A product selection, addition, or quantity change is confirmed only when a select_products tool observation from this turn has status \"completed\" (data.status \"selected\"), or commercialContext.commercialLineItems already durably reflects that exact selection from a previous turn with nothing changed this turn (see the reuse rule above) - if neither is true, never say the selection, quantity, or order is done, confirmed, ready, or registered.",
  "Understanding what the customer wants is not the same as it being done: never turn \"the customer wants 3 units\" into \"I left you 3 units\" (or any equivalent confirmation) without that select_products evidence."
];

/**
 * LLM-R1-T03. Finalization drops the first 4 lines above (when to call
 * select_products, evidence for its arguments, full-replace call semantics,
 * reuse-silently-instead-of-recalling - all impossible/moot once no tool
 * call can be made this turn). The remaining lines stay actionable via
 * `respond` itself: acknowledging a "blocked" selection honestly instead of
 * implying it succeeded, asking a clarifying question for an unclear
 * quantity rather than guessing, and (LLM-R1-T08C) never narrating a
 * selection/quantity/order as done without the same evidence gathering
 * requires - this last one is the finalization guard: since no tool is
 * available here, the only compliant response when the evidence is missing
 * is a truthful "not done yet", never a fabricated success. A contiguous
 * suffix of SELECT_PRODUCTS_RULE_LINES (never a duplicated copy).
 */
const SELECT_PRODUCTS_FINALIZATION_RULE_LINES = SELECT_PRODUCTS_RULE_LINES.slice(4);

/**
 * CRM-R1-T13E.2. calculate_shipping takes no arguments - destination,
 * products and quantities are already backend state (set_shipping_destination/
 * select_products). Carrier MS is the sole authority over coverage, carriers
 * and rates - the model must never compute, estimate, or restate a shipping
 * cost that did not come from this tool's own observation.
 */
const CALCULATE_SHIPPING_RULE_LINES = [
  "Use calculate_shipping only after the destination (set_shipping_destination) and the product selection (select_products) are both already confirmed - it takes no arguments and reads that state itself.",
  "Never calculate, estimate, or state a shipping cost yourself - the only valid shipping costs are the totalCost values inside a calculate_shipping observation's data.options.",
  "Never mention or offer a carrier, service type, cost, or estimated delivery that is not present in the most recent calculate_shipping observation's data.options.",
  "A calculate_shipping observation with data.status \"shipping_destination_required\" means no destination is confirmed yet - ask the customer for their comuna (or use set_shipping_destination if they already stated one this turn) before retrying.",
  "A calculate_shipping observation with data.status \"commercial_items_required\" means no product selection is confirmed yet - complete the selection (use select_products once the customer confirms products/quantities) before retrying.",
  "A calculate_shipping observation with data.status \"catalog_product_unavailable\", \"weight_unavailable\", or \"price_unavailable\" means one selected product's commercial data could not be resolved right now - tell the customer you cannot calculate shipping for that product at the moment, never estimate a substitute value.",
  "A calculate_shipping observation with data.status \"no_shipping_options\" means Carrier MS found no carrier serving that destination - tell the customer honestly, never claim a carrier covers it and never invent a workaround.",
  "If a calculate_shipping observation has status \"blocked\" or \"failed\" (a technical failure, not a business result), tell the customer shipping could not be calculated right now and offer to try again shortly - never reinterpret a technical failure as \"we don't ship there\".",
  "Never mention Carrier MS, pc_pos, kilos, total_boleta, or any other internal field/system name to the customer - refer to shipping/delivery options in plain commercial language only."
];

/**
 * LLM-R1-T03. Finalization drops only the first line above (when to call
 * calculate_shipping - impossible once no tool call can be made this turn).
 * Every remaining line is a grounding/anti-invention guardrail directly
 * protecting the response text (never invent a cost, never invent a
 * carrier, what each failure status means and how to say so honestly,
 * never leak internal field/system names) - this is the block the audit's
 * blanket "remove the whole thing" recommendation would have been wrong
 * about; see docs/releases/LLM-R1-T03-prompt-finalization-reduction.md. A
 * contiguous suffix of CALCULATE_SHIPPING_RULE_LINES (never a duplicated
 * copy).
 */
const CALCULATE_SHIPPING_FINALIZATION_RULE_LINES = CALCULATE_SHIPPING_RULE_LINES.slice(1);

const RESPOND_STEP_SHAPE_WITH_PENDING_ACTION =
  '{"type":"respond","message":"...","pendingCatalogAction":{"actionType":"send_product_link","candidateProductIds":["..."]}}. pendingCatalogAction is optional on respond - include it only per the pendingCatalogAction rules above';

/**
 * Layer 1: the immutable Agent Tool Loop contract - what actions exist this
 * phase and the exact response shape. Never editable, never touched by
 * configuration.
 */
function buildLoopContractLines(phase: "gathering" | "finalization", stepsRemaining: number): string[] {
  if (phase === "finalization") {
    return [
      "This turn's tool budget is spent - no more tools are available.",
      "You must now either respond to the customer with what you already know, or hand off to a human if you genuinely cannot proceed.",
      RESPOND_JSON_INSTRUCTION,
      `AgentStep shapes: ${RESPOND_STEP_SHAPE_WITH_PENDING_ACTION} | {"type":"handoff","reason":"..."}. use_tool is not available this turn.`,
      "type must be one of: respond, handoff."
    ];
  }
  return [
    "Deciding one step at a time.",
    "You may only: request one read-only tool, respond to the customer, or hand off to a human.",
    `Steps remaining this turn: ${stepsRemaining}.`,
    RESPOND_JSON_INSTRUCTION,
    `AgentStep shapes: {"type":"use_tool","tool":"<tool name>","arguments":{...}} | ${RESPOND_STEP_SHAPE_WITH_PENDING_ACTION} | {"type":"handoff","reason":"..."}.`,
    `type must be one of: ${AGENT_STEP_TYPES.join(", ")}.`
  ];
}

/**
 * ACS-R1-05.1-T02.6.1. Renders the tool's canonical inputSchema (sourced from
 * CapabilityGatewayDefinition.inputSchema, never redefined here) verbatim as
 * JSON, so the model sees the exact required argument shape instead of only
 * a free-text description. Absent for a tool with no declared schema (falls
 * back to description-only, previous behavior).
 */
function renderToolLine(tool: AgentLoopToolDescription): string {
  const schemaText = tool.inputSchema ? ` Arguments must satisfy exactly this JSON Schema (no properties beyond what it lists): ${JSON.stringify(tool.inputSchema)}` : "";
  return `- ${tool.name}: ${tool.description}${schemaText}`;
}

/**
 * ACS-R1-05.1-T02.6.1 (real incident: crm_capability_executions recorded
 * execution_status=invalid_arguments after a model sent {orderBy,
 * orderDirection} instead of the schema's {sort:{by,direction}}). A rejected
 * tool call must be a recoverable, in-budget event, not an automatic
 * handoff - the model is told explicitly it may retry once with corrected
 * arguments before this turn's tool budget forces finalization.
 */
const INVALID_ARGUMENTS_RECOVERY_RULE_LINE =
  'If a tool observation has status "blocked" with an errorCode indicating invalid arguments (e.g. sort_and_limit_required, price_range_invalid, limit_out_of_range), correct the arguments using that tool\'s JSON Schema shown below and try again once with different, corrected arguments - do not hand off to a human solely because one tool call was rejected while tool budget remains.';

/**
 * Layer 2: immutable evidence/tool-usage rules - grounding invariants and,
 * for gathering only, the tool catalog. Never editable, never derived from
 * configuration.
 */
function buildEvidenceAndToolRulesLines(phase: "gathering" | "finalization", availableTools: AgentLoopToolDescription[]): string[] {
  if (phase === "finalization") {
    // LLM-R1-T03. availableTools=[] this phase and validateAgentStep rejects
    // any use_tool step outright (runAgentToolLoop.ts) - no tool can ever be
    // invoked here, so every line whose sole purpose is teaching how/when to
    // invoke a capability is omitted below. recommend_catalog_products'
    // rules are 100% invocation mechanics (see its own doc comment above) and
    // are entirely absent - explore_catalog/shipping-destination/
    // select_products/calculate_shipping keep only their grounding/
    // result-interpretation subset (the ...*_FINALIZATION_RULE_LINES
    // constants above, each a documented, never-duplicated slice of the same
    // array gathering uses below). Full KEEP/REMOVE classification recorded
    // in docs/releases/LLM-R1-T03-prompt-finalization-reduction.md.
    return [
      "Use the customer's already-confirmed context (product type, training type, goal, budget, and any tool results already returned this turn) - do not ask again for anything already provided, and do not broaden or change the product category the customer already stated.",
      "You must never invent product, price, stock, or delivery information not returned by a tool this turn.",
      ...PRODUCT_PUBLIC_LINK_RULE_LINES,
      ...RECENT_CATALOG_CONTEXT_RULE_LINES,
      ...CUSTOMER_PURCHASE_HISTORY_RULE_LINES,
      ...CUSTOMER_HISTORY_COMMERCIAL_POLICY_RULE_LINES,
      ...ADAPTIVE_PRODUCT_PRESENTATION_RULE_LINES,
      ...EXPLORE_CATALOG_FINALIZATION_RULE_LINES,
      ...SHIPPING_DESTINATION_FINALIZATION_RULE_LINES,
      ...SELECT_PRODUCTS_FINALIZATION_RULE_LINES,
      ...CALCULATE_SHIPPING_FINALIZATION_RULE_LINES,
      ...STOCK_DISCLOSURE_RULE_LINES,
      ...COMMERCIAL_CLOSING_RULE_LINES,
      ...PENDING_CATALOG_ACTION_RULE_LINES,
      "You must never claim to have executed anything yourself - the platform executes tools, not you."
    ];
  }
  return [
    "Use a tool as soon as you have enough information to do so - do not wait for a fully detailed query, and do not ask the customer to repeat information already given.",
    "You must never invent product, price, stock, or delivery information not returned by a tool.",
    ...PRODUCT_PUBLIC_LINK_RULE_LINES,
    ...RECENT_CATALOG_CONTEXT_RULE_LINES,
    ...CUSTOMER_PURCHASE_HISTORY_RULE_LINES,
    ...CUSTOMER_HISTORY_COMMERCIAL_POLICY_RULE_LINES,
    ...ADAPTIVE_PRODUCT_PRESENTATION_RULE_LINES,
    ...EXPLORE_CATALOG_RULE_LINES,
    ...RECOMMEND_CATALOG_PRODUCTS_RULE_LINES,
    // CRM-R1-T13E.2 (fixes a pre-existing gap: SHIPPING_DESTINATION_RULE_LINES
    // was only ever in the finalization branch above, where tools are never
    // offered - the gathering phase, where set_shipping_destination is
    // actually callable, never saw it).
    ...SHIPPING_DESTINATION_RULE_LINES,
    ...SELECT_PRODUCTS_RULE_LINES,
    ...CALCULATE_SHIPPING_RULE_LINES,
    ...STOCK_DISCLOSURE_RULE_LINES,
    ...COMMERCIAL_CLOSING_RULE_LINES,
    ...PENDING_CATALOG_ACTION_RULE_LINES,
    "You must never claim to have executed anything yourself - the platform executes tools, not you.",
    INVALID_ARGUMENTS_RECOVERY_RULE_LINE,
    "Available tools:",
    ...(availableTools.length > 0 ? availableTools.map(renderToolLine) : ["none"])
  ];
}

function summarizeObservation(record: AgentLoopStepRecord) {
  const step = record.step;
  return {
    step:
      step.type === "use_tool"
        ? { type: "use_tool", tool: step.tool, arguments: step.arguments }
        : step.type === "respond"
          ? { type: "respond", message: step.message }
          : { type: "handoff", reason: step.reason },
    observation: record.observation
  };
}

/**
 * LLM-R1-T04. Absent (returns []) whenever priorAttemptFailure is absent -
 * a normal first attempt's prompt is byte-identical to before this task.
 * Never includes raw model output, a stack trace, or the free-text
 * validateAgentStep `reason` string - only the fixed "invalid_response"
 * classification or the bounded reasonCode enum, so this function can never
 * leak anything the model itself produced back into a new prompt.
 */
function buildPriorAttemptFailureLines(priorAttemptFailure: AgentLoopPriorAttemptFailure | null | undefined): string[] {
  if (!priorAttemptFailure) return [];
  if (priorAttemptFailure.kind === "invalid_response") {
    return [
      "Your previous response was structurally invalid or empty.",
      "Return exactly one valid JSON object matching the AgentStep contract below.",
      "Do not include markdown, prose, explanations, or any text outside the JSON object."
    ];
  }
  return [
    `Your previous AgentStep was rejected: reason=${priorAttemptFailure.reasonCode}.`,
    "Return exactly one valid AgentStep for the current phase, correcting that specific problem."
  ];
}

/**
 * ACS-R1-05.1-T02.1/T02.3B (spec section 7). One question only: "what is the
 * next step?" - never analysis, policy assessment, rationale, a final
 * response, multiple tool requests, entity proposals, or full commercial
 * state in the same call. Deliberately much smaller than
 * buildSalesAgentPromptPackage.ts.
 *
 * Six layers, in order, never interleaved: (0, LLM-R1-T04) an optional
 * repair instruction, present only on the one-shot retry that follows a
 * structural provider failure or a schema-invalid AgentStep - absent (and
 * therefore byte-identical to before this task) on every normal first
 * attempt; (1) immutable loop contract, (2) immutable evidence/tool rules,
 * (3) editable identity (renderSalesAgentIdentityPrompt.ts - the one shared
 * renderer, called identically from both phases below), (4) immutable
 * closing boundary (IMMUTABLE_CONFIGURATION_BOUNDARY_LINE - configuration
 * can never override layers 1-2 or platform policy), (5) dynamic per-turn
 * context, (6) this turn's own prior tool observations. Layers 5-6 travel in
 * the `user` message (unchanged shape) - layers 0-4 compose the `system`
 * message.
 */
export function buildAgentStepPromptPackage(input: AgentLoopPromptInput): { messages: AgentLoopProviderMessage[] } {
  const phase = input.phase ?? "gathering";

  const systemInstructions = [
    ...buildPriorAttemptFailureLines(input.priorAttemptFailure),
    ...buildLoopContractLines(phase, input.stepsRemaining),
    ...buildEvidenceAndToolRulesLines(phase, input.availableTools),
    renderSalesAgentIdentityPrompt(input.identityConfiguration),
    IMMUTABLE_CONFIGURATION_BOUNDARY_LINE
  ].join("\n");

  const userPayload = {
    currentTime: input.currentTime,
    customerMessage: input.customerMessage,
    commercialContext: input.commercialContextSummary,
    recentCatalogContext: input.recentCatalogContext ?? { interactions: [] },
    ...(input.pendingCatalogAction ? { pendingCatalogAction: input.pendingCatalogAction } : {}),
    priorStepsThisTurn: input.priorSteps.map(summarizeObservation),
    question: "What is the single next AgentStep?"
  };

  return {
    messages: [
      { role: "system", content: systemInstructions },
      { role: "user", content: JSON.stringify(userPayload) }
    ]
  };
}

import type { SalesAgentPromptConfiguration } from "../sales-agent-configuration";
import { AGENT_STEP_TYPES } from "./agentStepTypes";
import type { AgentLoopStepRecord } from "./agentStepTypes";
import type { AgentLoopProviderMessage } from "./agentLoopProviderTypes";
import type { RecentCatalogContext } from "./recentCatalogContext";
import { renderSalesAgentIdentityPrompt } from "./renderSalesAgentIdentityPrompt";

export type AgentLoopToolDescription = {
  name: string;
  description: string;
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
  "Never share product links from search_products; use get_product_details when a concrete product must be rehydrated for current price, stock, availability, variants, or URL.",
  "Absolute maximum: show no more than five products in one message."
];

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
      'AgentStep shapes: {"type":"respond","message":"..."} | {"type":"handoff","reason":"..."}. use_tool is not available this turn.',
      "type must be one of: respond, handoff."
    ];
  }
  return [
    "Deciding one step at a time.",
    "You may only: request one read-only tool, respond to the customer, or hand off to a human.",
    `Steps remaining this turn: ${stepsRemaining}.`,
    RESPOND_JSON_INSTRUCTION,
    'AgentStep shapes: {"type":"use_tool","tool":"<tool name>","arguments":{...}} | {"type":"respond","message":"..."} | {"type":"handoff","reason":"..."}.',
    `type must be one of: ${AGENT_STEP_TYPES.join(", ")}.`
  ];
}

/**
 * Layer 2: immutable evidence/tool-usage rules - grounding invariants and,
 * for gathering only, the tool catalog. Never editable, never derived from
 * configuration.
 */
function buildEvidenceAndToolRulesLines(phase: "gathering" | "finalization", availableTools: AgentLoopToolDescription[]): string[] {
  if (phase === "finalization") {
    return [
      "Use the customer's already-confirmed context (product type, training type, goal, budget, and any tool results already returned this turn) - do not ask again for anything already provided, and do not broaden or change the product category the customer already stated.",
      "You must never invent product, price, stock, or delivery information not returned by a tool this turn.",
      ...PRODUCT_PUBLIC_LINK_RULE_LINES,
      ...RECENT_CATALOG_CONTEXT_RULE_LINES,
      ...ADAPTIVE_PRODUCT_PRESENTATION_RULE_LINES,
      "You must never claim to have executed anything yourself - the platform executes tools, not you."
    ];
  }
  return [
    "Use a tool as soon as you have enough information to do so - do not wait for a fully detailed query, and do not ask the customer to repeat information already given.",
    "You must never invent product, price, stock, or delivery information not returned by a tool.",
    ...PRODUCT_PUBLIC_LINK_RULE_LINES,
    ...RECENT_CATALOG_CONTEXT_RULE_LINES,
    ...ADAPTIVE_PRODUCT_PRESENTATION_RULE_LINES,
    "You must never claim to have executed anything yourself - the platform executes tools, not you.",
    `Available tools: ${availableTools.map((tool) => `${tool.name} - ${tool.description}`).join("; ") || "none"}.`
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
 * ACS-R1-05.1-T02.1/T02.3B (spec section 7). One question only: "what is the
 * next step?" - never analysis, policy assessment, rationale, a final
 * response, multiple tool requests, entity proposals, or full commercial
 * state in the same call. Deliberately much smaller than
 * buildSalesAgentPromptPackage.ts.
 *
 * Six layers, in order, never interleaved: (1) immutable loop contract,
 * (2) immutable evidence/tool rules, (3) editable identity
 * (renderSalesAgentIdentityPrompt.ts - the one shared renderer, called
 * identically from both phases below), (4) immutable closing boundary
 * (IMMUTABLE_CONFIGURATION_BOUNDARY_LINE - configuration can never override
 * layers 1-2 or platform policy), (5) dynamic per-turn context, (6) this
 * turn's own prior tool observations. Layers 5-6 travel in the `user`
 * message (unchanged shape) - layers 1-4 compose the `system` message.
 */
export function buildAgentStepPromptPackage(input: AgentLoopPromptInput): { messages: AgentLoopProviderMessage[] } {
  const phase = input.phase ?? "gathering";

  const systemInstructions = [
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

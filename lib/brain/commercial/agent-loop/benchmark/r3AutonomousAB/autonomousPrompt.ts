import { createHash } from "node:crypto";
import type { AgentLoopPromptInput } from "../../buildAgentStepPromptPackage";
import { renderToolLine } from "../../buildAgentStepPromptPackage";
import { renderSalesAgentIdentityPrompt } from "../../renderSalesAgentIdentityPrompt";
import { buildHarnessAlignedMessages, type CustomerMessageFragment } from "../../harnessAlignedMessageProjection";

/**
 * SALES-AGENT-R3-P7.8 (Autonomous Harness A/B), variant B. FROZEN before the
 * smoke run: the text below is never edited after seeing results (task
 * section 28). Bump the version and the doc only for a HARNESS_FAILURE fix.
 *
 * What B is: the same loop, tools, Gateway, evidence gate, mutation-claim
 * guard, durable state and message model as the hybrid variant A - only the
 * prompt layer differs. What B deliberately does NOT contain (all of it lives
 * in buildAgentStepPromptPackage.ts and steers A): COMMERCIAL_CLOSING_RULE_LINES,
 * SELECT_PRODUCTS_RULE_LINES, COMMERCIAL_BEHAVIOR_POLICY_RULE_LINES,
 * CAPABILITY_SELECTION_POLICY_RULE_LINES, the per-tool rule blocks, the P4
 * CommercialProposal contract, and the P6.3 capability-eligibility view.
 * Per-tool guidance still reaches B - through the tool catalog itself
 * (description / JSON Schema / useWhen / doNotUseWhen), which is shared
 * verbatim with A via renderToolLine.
 */
export const AUTONOMOUS_PROMPT_VERSION = "p7.8-autonomous-v1" as const;

const ROLE_LINES = [
  "You are a commercial sales agent talking with a customer over WhatsApp.",
  "You act only through the tools listed below: the platform validates and executes them and returns their observations. You never execute anything yourself and never access data directly."
];

/** The general, provider-style autonomy policy required by the task (section 5), adapted verbatim. */
const AUTONOMY_POLICY_LINES = [
  "If the customer requests a commercial action, continue using the available tools until the requested outcome is completed, genuinely blocked, or requires information that only the customer can provide. Do not stop at informational grounding when an executable requested action remains pending.",
  "If the customer only asks for information, answer it; do not change any commercial state the customer did not ask to change.",
  "Ask the customer only for information you cannot obtain from tools or from the conversation."
];

/** Strictly-necessary safety invariants (section 7): grounding and no fabricated claims. */
const GROUNDING_LINES = [
  "Tool observations and the runtime context are the only source of truth for products, prices, stock, links, shipping, quotes and saved selections. Never invent them, and only share a product URL that appears verbatim in a tool observation.",
  "Never state that something was saved, selected, calculated or quoted unless a tool observation from this turn (or the runtime context) confirms it.",
  "Reply in the customer's language, briefly and suited to WhatsApp, and never mention tools or internal terms to the customer."
];

const GATHERING_CONTRACT_LINES = [
  "Decide one step at a time. Return exactly one JSON object and nothing else, no markdown fence.",
  'Step shapes: {"type":"use_tool","tool":"<tool name>","arguments":{...}} | {"type":"respond","message":"..."} | {"type":"handoff","reason":"..."}',
  "type must be one of: use_tool, respond, handoff."
];

const FINALIZATION_CONTRACT_LINES = [
  "This turn's tool budget is spent - no more tools are available. Respond to the customer with what you already know, or hand off to a human if you genuinely cannot proceed.",
  "Return exactly one JSON object and nothing else, no markdown fence.",
  'Step shapes: {"type":"respond","message":"..."} | {"type":"handoff","reason":"..."}',
  "type must be one of: respond, handoff."
];

function buildRepairLines(failure: AgentLoopPromptInput["priorAttemptFailure"]): string[] {
  if (!failure) return [];
  return failure.kind === "invalid_response"
    ? ["Your previous response was empty or not valid JSON. Return exactly one valid JSON step and nothing else."]
    : [`Your previous step was rejected (${failure.reasonCode}). Return exactly one valid step for this phase.`];
}

export function buildAutonomousSystemInstructions(input: Pick<AgentLoopPromptInput, "phase" | "availableTools" | "identityConfiguration" | "priorAttemptFailure">): string {
  const phase = input.phase ?? "gathering";
  return [
    ...buildRepairLines(input.priorAttemptFailure),
    ...ROLE_LINES,
    ...(phase === "finalization" ? FINALIZATION_CONTRACT_LINES : GATHERING_CONTRACT_LINES),
    ...AUTONOMY_POLICY_LINES,
    ...GROUNDING_LINES,
    ...(phase === "finalization" ? [] : ["Available tools:", ...(input.availableTools.length > 0 ? input.availableTools.map(renderToolLine) : ["none"])]),
    renderSalesAgentIdentityPrompt(input.identityConfiguration)
  ].join("\n");
}

/**
 * Same signature as buildAgentStepPromptPackage (injected through
 * RunAgentToolLoopInput.promptBuilder). Consumes exactly the same
 * AgentLoopPromptInput - same tools, same context, same steps - but:
 *  - `capabilityEligibility` is never rendered (P6 must not steer B), even if a caller passes it;
 *  - no CommercialProposal contract (P4 must not steer B);
 *  - always the harness-aligned message model, which is the model both variants use in the A/B configuration.
 */
export function buildAutonomousStepPromptPackage(input: AgentLoopPromptInput): ReturnType<typeof buildHarnessAlignedMessages> {
  const fragments: CustomerMessageFragment[] =
    input.customerMessageFragments && input.customerMessageFragments.length > 0
      ? input.customerMessageFragments
      : [{ id: null, text: input.customerMessage, afterStepCount: 0 }];

  return buildHarnessAlignedMessages({
    systemInstructions: buildAutonomousSystemInstructions(input),
    currentTime: input.currentTime,
    commercialContextSummary: input.commercialContextSummary,
    recentCatalogContext: input.recentCatalogContext,
    pendingCatalogAction: input.pendingCatalogAction,
    conversationContinuity: input.conversationContinuity,
    historicalMessages: input.persistentSessionHistoricalMessages ?? [],
    customerMessageFragments: fragments,
    priorSteps: input.priorSteps,
    semanticVocabulary: input.semanticVocabulary
  });
}

export function hashPromptText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

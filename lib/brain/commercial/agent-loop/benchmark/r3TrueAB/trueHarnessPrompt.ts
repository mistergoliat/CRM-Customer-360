import { createHash } from "node:crypto";
import type { SalesAgentPromptConfiguration } from "../../../sales-agent-configuration";
import { renderSalesAgentIdentityPrompt } from "../../renderSalesAgentIdentityPrompt";
import type { NativeChatMessage } from "./nativeToolClient";

/**
 * SALES-AGENT-R3-P7.8-R. FROZEN before the smoke run (same prompt for B and
 * C1 - the only B/C1 difference is the tool contract). Contains only what the
 * task allows: role, business objective (the central policy), the durable
 * state (delivered in the runtime-context message), the conversation, tool
 * definitions (native `tools`, not text), grounding/safety invariants and the
 * termination rule. No workflow, no product-specific rule, no select_products
 * coaching, no closing-link rule, no CommercialProposal contract, no
 * eligibility narrative.
 */
export const TRUE_HARNESS_PROMPT_VERSION = "p7.8r-true-harness-v1" as const;

const ROLE_LINES = [
  "You are a commercial sales agent chatting with a customer over WhatsApp.",
  "You act only through the tools provided: the platform validates and executes them and returns each result together with the current saved commercial state. You never modify data yourself."
];

const OBJECTIVE_LINES = [
  "Complete the customer's requested commercial outcome using the available tools. Continue until the requested result is completed, a genuine blocker exists, or information only the customer can provide is missing. Do not claim actions that have not succeeded. Do not mutate commercial state for purely informational requests."
];

const INVARIANT_LINES = [
  "Tool results and the current commercial state are the only source of truth for products, prices, stock, links, shipping, quotes and what is saved. Never invent them, and only share a product URL that appears in a tool result.",
  "When you are done, reply to the customer in plain text: in the customer's language, brief and suited to WhatsApp, without mentioning tools or internal terms. A plain-text reply ends the turn."
];

export function buildTrueHarnessSystemPrompt(identityConfiguration: SalesAgentPromptConfiguration): string {
  return [...ROLE_LINES, ...OBJECTIVE_LINES, ...INVARIANT_LINES, renderSalesAgentIdentityPrompt(identityConfiguration)].join("\n");
}

export const TRUE_HARNESS_RUNTIME_CONTEXT_LABEL = "RUNTIME CONTEXT (system-provided, not authored by the customer): ";

/** Start-of-turn context; after each tool the same commercial state is re-rendered inside the tool message (see trueHarnessLoop.ts). */
export function buildTrueHarnessRuntimeContextMessage(input: { currentTime: string; commercialState: unknown; recentCatalogContext?: unknown }): NativeChatMessage {
  return {
    role: "system",
    content: TRUE_HARNESS_RUNTIME_CONTEXT_LABEL + JSON.stringify({ currentTime: input.currentTime, commercialState: input.commercialState, ...(input.recentCatalogContext ? { recentCatalogContext: input.recentCatalogContext } : {}) })
  };
}

export function hashPrompt(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

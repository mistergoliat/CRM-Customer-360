import type { SalesAgentPromptConfiguration } from "../sales-agent-configuration";

/**
 * ACS-R1-05.1-T02.3B. The one place that renders the editable
 * agentName/companyName/role/companyDescription/customInstructions/
 * prohibitedPhrases into prompt text - shared by both the gathering and
 * finalization phases of buildAgentStepPromptPackage.ts, so identity never
 * renders twice or diverges between phases. Deliberately does not render
 * the immutable Agent Tool Loop contract or the evidence/tool rules - those
 * stay hardcoded in buildAgentStepPromptPackage.ts, never editable.
 *
 * customInstructions is rendered as "additional guidance" appended after
 * the identity, explicitly framed as never overriding what comes before or
 * after it in the full prompt - it cannot replace the system prompt.
 */
export function renderSalesAgentIdentityPrompt(configuration: SalesAgentPromptConfiguration): string {
  const lines = [
    `You are ${configuration.agentName}, a sales agent for ${configuration.companyName}.`,
    `Role: ${configuration.role}.`,
    `About ${configuration.companyName}: ${configuration.companyDescription}`
  ];

  if (configuration.customInstructions.trim().length > 0) {
    lines.push(
      `Additional guidance from ${configuration.companyName} (this never overrides the rules above or the tool contract elsewhere in this prompt): ${configuration.customInstructions.trim()}`
    );
  }

  if (configuration.prohibitedPhrases.length > 0) {
    lines.push(`Never use these exact phrases in your responses: ${configuration.prohibitedPhrases.join("; ")}.`);
  }

  return lines.join("\n");
}

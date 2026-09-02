// SALES-AGENT-R3-V1.8-D7. The one boundary that calls a model to compact
// older conversation history (task brief Section H). Pure with respect to
// the database - its only I/O is provider.invoke(). Never mutates
// agent_sessions itself (runSessionCompaction.ts owns persistence) and never
// throws - every failure mode (provider error, timeout, empty/invalid
// output) returns a typed { ok: false } result so a caller can fail open to
// the existing bounded raw history for this turn (Section I/T).

import type { AgentLoopProvider, AgentLoopProviderMessage } from "../agent-loop/agentLoopProviderTypes";

/**
 * Section B/G content policy, verbatim in the instruction so the model
 * cannot drift toward "what to do next": summarize what happened, never
 * intent/next-step/workflow state, never chain-of-thought or raw tool
 * dumps. response_format is already forced to json_object by
 * httpAgentLoopProvider.ts - this instruction just names the one field it
 * must contain.
 */
const SESSION_COMPACTION_SYSTEM_INSTRUCTION = [
  "You compact older conversation turns into a compact evidentiary summary for a sales assistant's own future turns.",
  "Summarize WHAT HAPPENED: customer-stated goals, preferences, constraints, product categories discussed, corrections, contradictions, topic switches, references likely to matter later, commitments or statements the assistant made, and unresolved questions.",
  "Never summarize what the assistant should do next. Never include a current intent, a next step, a workflow stage, or a plan - memory informs reasoning, it does not prescribe it.",
  "Never include chain-of-thought, hidden reasoning, raw tool-result dumps, or internal identifiers. Business facts like exact prices, stock, shipping status, or quote status belong to live systems, not this summary - you may note that something was discussed, never assert it as current truth.",
  "If a previous summary is given below, merge it with the new turns into one updated summary - never drop information the previous summary already captured.",
  'Respond with exactly one JSON object: {"summaryText": "<the summary in plain prose>"}. No other fields, no markdown, no text outside the JSON object.'
].join("\n");

const SESSION_COMPACTION_FINAL_INSTRUCTION = "Summarize the conversation above now, per the instructions.";

function buildCompactionMessages(previousSummaryText: string | null, messagesToCompact: readonly AgentLoopProviderMessage[]): AgentLoopProviderMessage[] {
  const messages: AgentLoopProviderMessage[] = [{ role: "system", content: SESSION_COMPACTION_SYSTEM_INSTRUCTION }];
  if (previousSummaryText) {
    messages.push({ role: "system", content: `Previously compacted historical evidence (merge, do not discard):\n${previousSummaryText}` });
  }
  messages.push(...messagesToCompact);
  messages.push({ role: "user", content: SESSION_COMPACTION_FINAL_INSTRUCTION });
  return messages;
}

export type CompactAgentSessionHistoryInput = {
  previousSummaryText: string | null;
  /** Real user/assistant turns being folded into the summary - never fabricated, never a tool-result dump (the caller is responsible for that filtering, same as deriveConversationMessages). */
  messagesToCompact: readonly AgentLoopProviderMessage[];
  provider: AgentLoopProvider;
  timeoutMs: number;
  correlationId?: string | null;
};

export type CompactAgentSessionHistoryResult = { ok: true; summaryText: string } | { ok: false; reason: string };

export async function compactAgentSessionHistory(input: CompactAgentSessionHistoryInput): Promise<CompactAgentSessionHistoryResult> {
  if (input.messagesToCompact.length === 0) return { ok: false, reason: "nothing_to_compact" };

  try {
    const response = await input.provider.invoke(
      { messages: buildCompactionMessages(input.previousSummaryText, input.messagesToCompact), correlationId: input.correlationId ?? null },
      { signal: null, timeoutMs: input.timeoutMs }
    );
    const rawOutput = response.rawOutput;
    const summaryText =
      rawOutput && typeof rawOutput === "object" && "summaryText" in (rawOutput as Record<string, unknown>)
        ? (rawOutput as { summaryText?: unknown }).summaryText
        : null;
    if (typeof summaryText !== "string" || !summaryText.trim()) {
      return { ok: false, reason: "empty_or_invalid_summary" };
    }
    return { ok: true, summaryText: summaryText.trim() };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

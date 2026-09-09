/**
 * SALES-AGENT-R3-V1.8.2-C1 (Harness-Aligned Message Sequencing). Pure
 * message-projection functions only - no I/O, no env reads, no mutation.
 * Reconstructs the causal transcript Harness-style agent frameworks send
 * (system contract / dynamic runtime context / real history / raw customer
 * message / assistant-AgentStep+tool-observation pairs / newly assimilated
 * inbound as its own message) instead of buildAgentStepPromptPackage.ts's
 * legacy single JSON-stringified `user` mega-envelope. Only ever called when
 * BRAIN_R3_HARNESS_ALIGNED_MESSAGE_MODEL_ENABLED is true - the legacy/
 * persistent branches in buildAgentStepPromptPackage.ts are untouched and
 * never call into this module.
 *
 * D5.1/D5.2 regression discipline (docs/releases/SALES-AGENT-R3-V1.8-D5.1-B06-HANDOFF-REPRODUCIBILITY.md,
 * .../SALES-AGENT-R3-V1.8-D5.2-...md): two bare consecutive `user`-role
 * messages with no `assistant` message between them caused a real, measured
 * 60%-vs-0% handoff-rate regression under DeepSeek. This module avoids that
 * shape for every message boundary it controls:
 *  - dynamic context is a second `role:"system"` message, never a `user`
 *    message adjacent to the customer's own message.
 *  - every tool-observation `user` message is immediately preceded by its own
 *    `assistant` AgentStep and immediately followed by the next `assistant`
 *    decision - clean alternation.
 * The one boundary this module does NOT eliminate (deliberately, per the
 * task's own "measure, don't harden" instruction): a mid-turn assimilated
 * customer fragment arriving immediately after a tool observation still
 * produces a bare `user`/`user` adjacency (tool result, then new customer
 * text) - see buildCausalTurnMessages below and the release doc's residual-
 * risk section. No synthetic `assistant` separator is inserted to paper over
 * it - that would fabricate model speech, which is worse than the risk it
 * would be hiding.
 */

import type { AgentLoopProviderMessage } from "./agentLoopProviderTypes";
import type { AgentLoopStepRecord, AgentStep, PendingCatalogActionStep } from "./agentStepTypes";
import type { RecentCatalogContext } from "./recentCatalogContext";
import { CONVERSATION_CONTINUITY_UNKNOWN, type ConversationContinuitySignal } from "./conversationContinuity";

/**
 * One customer-authored fragment of this turn's own input - the original
 * claim-time message (afterStepCount: 0) or a mid-turn Live Turn Assimilation
 * fragment (runAgentToolLoop.ts's tryAssimilate()). `afterStepCount` is
 * `priorSteps.length` at the moment this fragment was discovered - since both
 * fragments and steps only ever grow by append, this fully determines causal
 * interleaving order without needing a database timestamp.
 */
export type CustomerMessageFragment = {
  id: number | null;
  text: string;
  afterStepCount: number;
};

export type AgentStepPromptProjectionMetadata = {
  mode: "legacy_envelope" | "harness_aligned";
  messageCount: number;
  toolObservationCount: number;
  assimilatedUserMessageCount: number;
};

const RUNTIME_CONTEXT_LABEL = "RUNTIME CONTEXT (system-provided, not authored by the customer): ";
const TOOL_RESULT_LABEL_PREFIX = "[TOOL RESULT: ";

function buildDynamicContextMessage(input: {
  currentTime: string;
  commercialContextSummary: Record<string, unknown>;
  recentCatalogContext?: RecentCatalogContext | null;
  pendingCatalogAction?: PendingCatalogActionStep | null;
  conversationContinuity?: ConversationContinuitySignal | null;
}): AgentLoopProviderMessage {
  const payload = {
    currentTime: input.currentTime,
    commercialContext: input.commercialContextSummary,
    recentCatalogContext: input.recentCatalogContext ?? { interactions: [] },
    ...(input.pendingCatalogAction ? { pendingCatalogAction: input.pendingCatalogAction } : {}),
    conversationContinuity: input.conversationContinuity ?? CONVERSATION_CONTINUITY_UNKNOWN
  };
  return { role: "system", content: RUNTIME_CONTEXT_LABEL + JSON.stringify(payload) };
}

/** Replays exactly what the model itself emitted for this step - no reasoning, nothing added, nothing observation-derived. */
function stepOnlyJson(step: AgentStep): string {
  if (step.type === "use_tool") return JSON.stringify({ type: "use_tool", tool: step.tool, arguments: step.arguments });
  if (step.type === "respond") return JSON.stringify({ type: "respond", message: step.message, ...(step.pendingCatalogAction ? { pendingCatalogAction: step.pendingCatalogAction } : {}) });
  return JSON.stringify({ type: "handoff", reason: step.reason });
}

/**
 * Interleaves customer-message fragments and accepted step/observation pairs
 * in the exact order they actually happened. In practice every record in
 * `priorSteps` is a use_tool record by the time it reaches this function -
 * runAgentToolLoop.ts always returns immediately once a respond/handoff step
 * is accepted, so it never appears in a `priorSteps` list that gets prompted
 * again - but every AgentStep variant is still handled defensively since the
 * type itself does not encode that runtime invariant.
 */
function buildCausalTurnMessages(
  fragments: readonly CustomerMessageFragment[],
  priorSteps: readonly AgentLoopStepRecord[]
): { messages: AgentLoopProviderMessage[]; toolObservationCount: number } {
  const messages: AgentLoopProviderMessage[] = [];
  let toolObservationCount = 0;

  const emitFragmentsThrough = (stepCount: number) => {
    for (const fragment of fragments) {
      if (fragment.afterStepCount === stepCount) messages.push({ role: "user", content: fragment.text });
    }
  };

  emitFragmentsThrough(0);
  for (let i = 0; i < priorSteps.length; i++) {
    const record = priorSteps[i];
    messages.push({ role: "assistant", content: stepOnlyJson(record.step) });
    if (record.observation) {
      messages.push({ role: "user", content: `${TOOL_RESULT_LABEL_PREFIX}${record.observation.tool}] ${JSON.stringify(record.observation)}` });
      toolObservationCount += 1;
    }
    emitFragmentsThrough(i + 1);
  }

  return { messages, toolObservationCount };
}

export type BuildHarnessAlignedMessagesInput = {
  systemInstructions: string;
  currentTime: string;
  commercialContextSummary: Record<string, unknown>;
  recentCatalogContext?: RecentCatalogContext | null;
  pendingCatalogAction?: PendingCatalogActionStep | null;
  conversationContinuity?: ConversationContinuitySignal | null;
  /** Verbatim from deriveMessages()/persistentSessionHistoricalMessages - never re-ordered, may itself start with a role:"system" compacted-prefix message. Empty array for a turn with no persistent session. */
  historicalMessages: readonly AgentLoopProviderMessage[];
  /** Resolved by the caller (buildAgentStepPromptPackage.ts) - always at least one fragment (the turn's original customer message). */
  customerMessageFragments: readonly CustomerMessageFragment[];
  priorSteps: readonly AgentLoopStepRecord[];
};

export function buildHarnessAlignedMessages(input: BuildHarnessAlignedMessagesInput): {
  messages: AgentLoopProviderMessage[];
  projection: AgentStepPromptProjectionMetadata;
} {
  const dynamicContextMessage = buildDynamicContextMessage(input);
  const { messages: causalMessages, toolObservationCount } = buildCausalTurnMessages(input.customerMessageFragments, input.priorSteps);

  const messages: AgentLoopProviderMessage[] = [
    { role: "system", content: input.systemInstructions },
    dynamicContextMessage,
    ...input.historicalMessages,
    ...causalMessages
  ];

  return {
    messages,
    projection: {
      mode: "harness_aligned",
      messageCount: messages.length,
      toolObservationCount,
      // Fragments beyond the first (the turn's original message, afterStepCount 0 by construction) are mid-turn assimilated ones.
      assimilatedUserMessageCount: Math.max(0, input.customerMessageFragments.length - 1)
    }
  };
}

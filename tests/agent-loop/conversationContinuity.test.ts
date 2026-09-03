import assert from "node:assert/strict";
import test from "node:test";
import {
  CONVERSATION_CONTINUITY_UNKNOWN,
  deriveConversationContinuityFromHistoricalMessages,
  deriveConversationContinuityFromLegacyContext
} from "@/lib/brain/commercial/agent-loop/conversationContinuity";
import type { AgentLoopProviderMessage } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";

/**
 * SALES-AGENT-R3-V1.8.1b (Objetivo C). Pure, no-DB unit coverage of the
 * continuity derivation itself - end-to-end coverage against real persisted
 * history lives in tests/commercial/salesAgentRuntime.test.ts
 * ([V1.8.1b-C9]/[V1.8.1b-C10]).
 */

test("[C1] empty historicalMessages -> first conversational turn", () => {
  const signal = deriveConversationContinuityFromHistoricalMessages([]);
  assert.deepEqual(signal, { isFirstConversationalTurn: true, hasPriorAssistantMessages: false, hasPriorCustomerMessages: false });
});

test("[C2] a real assistant turn alone -> not first, hasPriorAssistantMessages only", () => {
  const messages: AgentLoopProviderMessage[] = [{ role: "assistant", content: "hola" }];
  const signal = deriveConversationContinuityFromHistoricalMessages(messages);
  assert.deepEqual(signal, { isFirstConversationalTurn: false, hasPriorAssistantMessages: true, hasPriorCustomerMessages: false });
});

test("[C3] a real user turn alone -> not first, hasPriorCustomerMessages only", () => {
  const messages: AgentLoopProviderMessage[] = [{ role: "user", content: "hola" }];
  const signal = deriveConversationContinuityFromHistoricalMessages(messages);
  assert.deepEqual(signal, { isFirstConversationalTurn: false, hasPriorAssistantMessages: false, hasPriorCustomerMessages: true });
});

test("[C4] a compacted-prefix-only array (role:system, no real tail) reads as a first turn by this pure function - documented, not a bug, since the compaction policy always keeps a real recent-message tail in practice, and even in that edge case the prefix's own summary text already tells the model prior history exists", () => {
  const messages: AgentLoopProviderMessage[] = [{ role: "system", content: "[Compacted session history through message #10] resumen" }];
  const signal = deriveConversationContinuityFromHistoricalMessages(messages);
  assert.equal(signal.isFirstConversationalTurn, true);
});

test("[C5] real user + assistant turns together -> not first, both true", () => {
  const messages: AgentLoopProviderMessage[] = [
    { role: "user", content: "hola" },
    { role: "assistant", content: "hola, en que te ayudo" }
  ];
  const signal = deriveConversationContinuityFromHistoricalMessages(messages);
  assert.deepEqual(signal, { isFirstConversationalTurn: false, hasPriorAssistantMessages: true, hasPriorCustomerMessages: true });
});

test("[C6] legacy path: missing/malformed recentMessages falls back to CONVERSATION_CONTINUITY_UNKNOWN (never claims a first turn when unknown)", () => {
  assert.deepEqual(deriveConversationContinuityFromLegacyContext({}), CONVERSATION_CONTINUITY_UNKNOWN);
  assert.deepEqual(deriveConversationContinuityFromLegacyContext({ recentMessages: "not-an-array" }), CONVERSATION_CONTINUITY_UNKNOWN);
});

test("[C7] legacy path: a genuinely empty recentMessages array IS read as a first turn", () => {
  const signal = deriveConversationContinuityFromLegacyContext({ recentMessages: [] });
  assert.deepEqual(signal, { isFirstConversationalTurn: true, hasPriorAssistantMessages: false, hasPriorCustomerMessages: false });
});

test("[C8] legacy path: real inbound/outbound entries are detected by direction", () => {
  const signal = deriveConversationContinuityFromLegacyContext({
    recentMessages: [
      { direction: "inbound", body: "hola" },
      { direction: "outbound", body: "hola, en que te ayudo" }
    ]
  });
  assert.deepEqual(signal, { isFirstConversationalTurn: false, hasPriorAssistantMessages: true, hasPriorCustomerMessages: true });
});

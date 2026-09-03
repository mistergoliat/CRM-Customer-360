import assert from "node:assert/strict";
import test from "node:test";
import { deriveConversationMessages } from "@/lib/brain/commercial/agent-session/deriveMessages";
import type { ConversationTranscriptMessage } from "@/lib/brain/commercial/agent-session/conversationTranscriptReader";

// SALES-AGENT-R3-V1.8.1. Pure, no-DB tests for the additionalExcludedMessageIds
// widening of deriveConversationMessages (turn settling: a settled turn can
// fold more than one conversation_message row into the current turn's own
// aggregated text - every one of those rows must be excluded from history,
// not just the single id the pre-V1.8.1 contract already excluded). See
// tests/commercial/deriveMessages.test.ts for the pre-existing D3 coverage
// this file deliberately does not duplicate.

function transcript(id: string, direction: string, body: string | null): ConversationTranscriptMessage {
  return { id, direction, body, createdAt: "2026-09-03T10:00:00.000Z" };
}

test("[V1.8.1-1] additionalExcludedMessageIds removes every listed fragment from history, alongside currentInboundMessageId", () => {
  const messages = deriveConversationMessages({
    transcriptMessages: [
      transcript("1", "inbound", "hola previo"),
      transcript("2", "outbound", "hola, en que te ayudo"),
      transcript("101", "inbound", "hola"),
      transcript("102", "inbound", "como"),
      transcript("103", "inbound", "estas")
    ],
    compactedPrefix: null,
    // 103 is the turn's own anchor (excluded by the pre-existing single-id
    // path); 101/102 are the earlier fragments of the SAME settled turn.
    currentInboundMessageId: "103",
    additionalExcludedMessageIds: ["101", "102"]
  });

  assert.deepEqual(messages, [
    { role: "user", content: "hola previo" },
    { role: "assistant", content: "hola, en que te ayudo" }
  ]);
});

test("[V1.8.1-2] undefined/null/empty additionalExcludedMessageIds is a no-op - identical output to the pre-V1.8.1 single-id contract (delay=0 compatibility)", () => {
  const transcriptMessages = [transcript("1", "inbound", "hola previo"), transcript("2", "outbound", "hola")];

  const withUndefined = deriveConversationMessages({ transcriptMessages, compactedPrefix: null, currentInboundMessageId: "2" });
  const withNull = deriveConversationMessages({ transcriptMessages, compactedPrefix: null, currentInboundMessageId: "2", additionalExcludedMessageIds: null });
  const withEmpty = deriveConversationMessages({ transcriptMessages, compactedPrefix: null, currentInboundMessageId: "2", additionalExcludedMessageIds: [] });

  assert.deepEqual(withUndefined, [{ role: "user", content: "hola previo" }]);
  assert.deepEqual(withNull, withUndefined);
  assert.deepEqual(withEmpty, withUndefined);
});

test("[V1.8.1-3] a fragment id that only appears in additionalExcludedMessageIds (currentInboundMessageId null) is still excluded", () => {
  const messages = deriveConversationMessages({
    transcriptMessages: [transcript("1", "inbound", "quiero una barra"), transcript("2", "inbound", "olimpica de 20kg")],
    compactedPrefix: null,
    currentInboundMessageId: null,
    additionalExcludedMessageIds: ["1", "2"]
  });
  assert.deepEqual(messages, []);
});

test("[V1.8.1-4/J] the settled turn's own fragments never appear twice: excluded from history regardless of how many OTHER real historical turns surround them", () => {
  const messages = deriveConversationMessages({
    transcriptMessages: [
      transcript("50", "inbound", "cotizame la de 20kg"),
      transcript("51", "outbound", "aqui esta tu cotizacion"),
      transcript("60", "inbound", "espera"),
      transcript("61", "inbound", "mejor la de 15kg")
    ],
    compactedPrefix: null,
    currentInboundMessageId: "61",
    additionalExcludedMessageIds: ["60"]
  });

  assert.deepEqual(messages, [
    { role: "user", content: "cotizame la de 20kg" },
    { role: "assistant", content: "aqui esta tu cotizacion" }
  ]);
  assert.ok(!messages.some((message) => message.content.includes("espera")), "fragment 60 must never surface as history");
  assert.ok(!messages.some((message) => message.content.includes("mejor la de 15kg")), "fragment 61 must never surface as history");
});

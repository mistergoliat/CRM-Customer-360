import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveConversationMessages,
  deriveMessages,
  deriveToolActivityObservations
} from "@/lib/brain/commercial/agent-session/deriveMessages";
import type { PersistentSessionCompactedPrefix } from "@/lib/brain/commercial/agent-session/deriveMessages";
import type { ConversationTranscriptMessage } from "@/lib/brain/commercial/agent-session/conversationTranscriptReader";
import type { AgentSessionEvent } from "@/lib/brain/commercial/agent-session/types";

// SALES-AGENT-R3-V1.8-D3. Pure, no-DB tests for deriveMessages.ts - the
// selected merge strategy (conversation_message = canonical human transcript,
// agent_session_events = operational evidence only, never merged into one
// array) and every explicit rule the task brief names: current-turn
// exclusion (Section K), tool activity kept separate from conversational
// history (Section L), compacted-prefix placement + event exclusion
// (Section Q), byte-stable historical prefix across turns (Section R), and
// the exact assistant-history-ordering defect V1.8-A found (Section N).

function transcript(id: string, direction: string, body: string | null, createdAt = "2026-08-31T10:00:00.000Z"): ConversationTranscriptMessage {
  return { id, direction, body, createdAt };
}

let nextTestSeq = 1;
function sessionEvent(overrides: Partial<AgentSessionEvent> & Pick<AgentSessionEvent, "eventType" | "occurredAt">): AgentSessionEvent {
  return {
    contractName: "AgentSession",
    schemaVersion: "1.0",
    eventId: `agev_${Math.random().toString(16).slice(2)}`,
    sessionId: "agsess_test",
    conversationId: 1,
    correlationId: "corr_test",
    causationId: null,
    dedupeKey: `dedupe_${Math.random()}`,
    payload: {},
    createdAt: overrides.occurredAt,
    seq: nextTestSeq++,
    ...overrides
  };
}

test.beforeEach(() => {
  nextTestSeq = 1;
});

test("[D3-1] no transcript, no compaction -> empty historical messages", () => {
  const result = deriveMessages({ transcriptMessages: [], events: [], compactedPrefix: null, currentInboundMessageId: null });
  assert.deepEqual(result.historicalMessages, []);
  assert.deepEqual(result.toolActivityObservations, []);
});

// Section N. The exact structural defect V1.8-A found: a real persisted
// conversation's assistant reply must appear as role "assistant", in the
// correct position, not folded into or after the wrong user turn.
test("[D3-N] maps inbound -> user and outbound -> assistant, in ascending order", () => {
  const messages = deriveConversationMessages({
    transcriptMessages: [
      transcript("1", "inbound", "que barras tienen"),
      transcript("2", "outbound", "tenemos la barra olimpica 20kg y la barra estandar"),
      transcript("3", "inbound", "quiero la segunda")
    ],
    compactedPrefix: null,
    currentInboundMessageId: "3"
  });

  assert.deepEqual(messages, [
    { role: "user", content: "que barras tienen" },
    { role: "assistant", content: "tenemos la barra olimpica 20kg y la barra estandar" }
  ]);
});

// Section K. The current turn's own inbound message already exists in
// conversation_message before R3 runs and is inside the bounded window - it
// must never be emitted as history.
test("[D3-K] excludes the current inbound message from history, deterministically by id", () => {
  const messages = deriveConversationMessages({
    transcriptMessages: [transcript("10", "inbound", "hola"), transcript("11", "outbound", "hola, en que te ayudo?"), transcript("12", "inbound", "busco una barra")],
    compactedPrefix: null,
    currentInboundMessageId: "12"
  });

  assert.deepEqual(messages, [
    { role: "user", content: "hola" },
    { role: "assistant", content: "hola, en que te ayudo?" }
  ]);
  assert.ok(!messages.some((m) => m.content === "busco una barra"), "the current turn's own message must not appear in history");
});

test("[D3-2] a null currentInboundMessageId excludes nothing", () => {
  const messages = deriveConversationMessages({
    transcriptMessages: [transcript("1", "inbound", "hola")],
    compactedPrefix: null,
    currentInboundMessageId: null
  });
  assert.deepEqual(messages, [{ role: "user", content: "hola" }]);
});

// Section E. conversation_message.direction also carries "system" rows
// (lib/domains/conversations/control.ts's own timeline entries) - these are
// operational markers, never a conversational turn.
test("[D3-3] excludes non-human directions (e.g. conversation-control 'system' rows)", () => {
  const messages = deriveConversationMessages({
    transcriptMessages: [
      transcript("1", "inbound", "hola"),
      transcript("2", "system", "El operador tomo el control de la conversacion."),
      transcript("3", "outbound", "hola!")
    ],
    compactedPrefix: null,
    currentInboundMessageId: null
  });
  assert.deepEqual(messages, [
    { role: "user", content: "hola" },
    { role: "assistant", content: "hola!" }
  ]);
});

test("[D3-4] skips rows with a null or blank body", () => {
  const messages = deriveConversationMessages({
    transcriptMessages: [transcript("1", "inbound", null), transcript("2", "outbound", "   "), transcript("3", "inbound", "hola")],
    compactedPrefix: null,
    currentInboundMessageId: null
  });
  assert.deepEqual(messages, [{ role: "user", content: "hola" }]);
});

// Section Q. compactedPrefix (once D7 ever populates it) is placed before
// recent history, as a system-role message - never fabricated as a fake
// user/assistant turn.
test("[D3-Q1] places a valid compacted prefix before recent history as a system message", () => {
  const compactedPrefix: PersistentSessionCompactedPrefix = { throughSeq: 5, prefixJson: { note: "resumen de turnos previos" } };
  const messages = deriveConversationMessages({
    transcriptMessages: [transcript("6", "inbound", "y las mancuernas?")],
    compactedPrefix,
    currentInboundMessageId: "6"
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "system");
  assert.ok(messages[0].content.includes("#5"));
  assert.ok(messages[0].content.includes("resumen de turnos previos"));
});

test("[D3-Q2] compactedPrefix null (the normal case today) adds no extra message", () => {
  const messages = deriveConversationMessages({
    transcriptMessages: [transcript("1", "inbound", "hola")],
    compactedPrefix: null,
    currentInboundMessageId: null
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
});

// Section L. Tool activity stays a separate, structured array - never
// injected into the message list as a fake assistant/user turn.
test("[D3-L1] classifies read/action tool events into toolActivityObservations, never into historicalMessages", () => {
  const events: AgentSessionEvent[] = [
    sessionEvent({ eventType: "USER_MESSAGE_RECEIVED", occurredAt: "2026-08-31T10:00:00.000Z" }),
    sessionEvent({ eventType: "READ_TOOL_REQUESTED", occurredAt: "2026-08-31T10:00:01.000Z", payload: { tool: "search_products" } }),
    sessionEvent({ eventType: "READ_TOOL_COMPLETED", occurredAt: "2026-08-31T10:00:02.000Z", payload: { tool: "search_products" } }),
    sessionEvent({ eventType: "COMMERCIAL_ACTION_REQUESTED", occurredAt: "2026-08-31T10:00:03.000Z", payload: { tool: "select_products" } }),
    sessionEvent({ eventType: "COMMERCIAL_ACTION_FAILED", occurredAt: "2026-08-31T10:00:04.000Z", payload: { tool: "select_products" } }),
    sessionEvent({ eventType: "ASSISTANT_MESSAGE_SENT", occurredAt: "2026-08-31T10:00:05.000Z" })
  ];

  const result = deriveMessages({ transcriptMessages: [], events, compactedPrefix: null, currentInboundMessageId: null });

  assert.deepEqual(result.historicalMessages, []);
  assert.deepEqual(result.toolActivityObservations, [
    { tool: "search_products", kind: "read", outcome: "requested", occurredAt: "2026-08-31T10:00:01.000Z" },
    { tool: "search_products", kind: "read", outcome: "completed", occurredAt: "2026-08-31T10:00:02.000Z" },
    { tool: "select_products", kind: "action", outcome: "requested", occurredAt: "2026-08-31T10:00:03.000Z" },
    { tool: "select_products", kind: "action", outcome: "failed", occurredAt: "2026-08-31T10:00:04.000Z" }
  ]);
});

// Section Q. Events already covered by a compacted prefix must never be
// represented twice.
test("[D3-L2] excludes tool activity at or before compactedThroughSeq", () => {
  const events: AgentSessionEvent[] = [
    sessionEvent({ eventType: "READ_TOOL_REQUESTED", occurredAt: "2026-08-31T10:00:00.000Z", payload: { tool: "search_products" } }), // seq 1
    sessionEvent({ eventType: "READ_TOOL_COMPLETED", occurredAt: "2026-08-31T10:00:01.000Z", payload: { tool: "search_products" } }), // seq 2
    sessionEvent({ eventType: "READ_TOOL_REQUESTED", occurredAt: "2026-08-31T10:00:02.000Z", payload: { tool: "get_product_details" } }) // seq 3
  ];
  const compactedPrefix: PersistentSessionCompactedPrefix = { throughSeq: 2, prefixJson: {} };

  const observations = deriveToolActivityObservations(events, compactedPrefix);
  assert.deepEqual(observations, [{ tool: "get_product_details", kind: "read", outcome: "requested", occurredAt: "2026-08-31T10:00:02.000Z" }]);
});

// Section Q. Invalid/absent metadata never crashes - loadPersistentSessionContext.ts
// is the layer that validates compactedPrefix before it ever reaches this
// module, so deriveMessages itself simply treats null as "no compaction".
test("[D3-Q3] absent compactedPrefix excludes nothing from tool activity", () => {
  const events: AgentSessionEvent[] = [sessionEvent({ eventType: "READ_TOOL_REQUESTED", occurredAt: "2026-08-31T10:00:00.000Z", payload: { tool: "search_products" } })];
  const observations = deriveToolActivityObservations(events, null);
  assert.equal(observations.length, 1);
});

// Section R. The historical prefix for every turn already completed must be
// byte-stable once a later turn's own (excluded) inbound message is added -
// never recomputed differently just because the bounded window grew by one.
test("[D3-R] the completed-turns prefix is byte-stable across consecutive turns", () => {
  const turnN = deriveConversationMessages({
    transcriptMessages: [transcript("1", "inbound", "que barras tienen"), transcript("2", "outbound", "tenemos varias opciones")],
    compactedPrefix: null,
    currentInboundMessageId: null
  });

  const turnNPlus1 = deriveConversationMessages({
    transcriptMessages: [
      transcript("1", "inbound", "que barras tienen"),
      transcript("2", "outbound", "tenemos varias opciones"),
      transcript("3", "inbound", "muestrame varias opciones")
    ],
    compactedPrefix: null,
    currentInboundMessageId: "3"
  });

  assert.deepEqual(turnNPlus1, turnN, "the prefix covering completed turns must not change once the next turn's own message is excluded");
});

// Section O. Harness-parity characterization (V18B-01 fixtures) - the exact
// 4-turn conversation this task brief specifies. Never a real DeepSeek call;
// this only proves the derived historical prefix carries the same logical
// prior user/assistant sequence a persistent Harness session would expose.
test("[D3-O] harness-parity: derived prefix accumulates prior turns in order across a 4-turn conversation", () => {
  const rows: ConversationTranscriptMessage[] = [
    transcript("1", "inbound", "Estoy buscando una barra olimpica de 20 kg para home gym"),
    transcript("2", "outbound", "Claro, tenemos la Barra Olimpica PRO 20kg y la Barra Olimpica Basic 20kg."),
    transcript("3", "inbound", "Muestrame varias opciones"),
    transcript("4", "outbound", "Aqui tienes: 1) Barra Olimpica PRO 20kg 2) Barra Olimpica Basic 20kg 3) Barra Multipower 20kg."),
    transcript("5", "inbound", "Ahora dime que colchonetas tienen"),
    transcript("6", "outbound", "Tenemos colchonetas de yoga y colchonetas de crossfit."),
    transcript("7", "inbound", "Volvamos a la barra anterior")
  ];

  // Before turn 2 (currently processing message "3"), the derived prefix
  // must already contain turn 1's real exchange, in order.
  const beforeTurn2 = deriveConversationMessages({ transcriptMessages: rows.slice(0, 3), compactedPrefix: null, currentInboundMessageId: "3" });
  assert.deepEqual(beforeTurn2, [
    { role: "user", content: rows[0].body },
    { role: "assistant", content: rows[1].body }
  ]);

  // Before turn 4 (currently processing message "7"), the prefix must
  // contain turns 1-3 in order, including the colchonetas detour - and
  // still not have lost the original barra exchange.
  const beforeTurn4 = deriveConversationMessages({ transcriptMessages: rows.slice(0, 7), compactedPrefix: null, currentInboundMessageId: "7" });
  assert.deepEqual(beforeTurn4, [
    { role: "user", content: rows[0].body },
    { role: "assistant", content: rows[1].body },
    { role: "user", content: rows[2].body },
    { role: "assistant", content: rows[3].body },
    { role: "user", content: rows[4].body },
    { role: "assistant", content: rows[5].body }
  ]);
  assert.ok(beforeTurn4.some((m) => m.role === "assistant" && m.content?.includes("Barra Olimpica PRO")), "the original barra exchange must still be present for 'volvamos a la barra anterior' to resolve");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPersistentSessionShadowComparison,
  extractLegacyRecentMessagesForShadow
} from "@/lib/brain/commercial/agent-session/persistentSessionShadowComparison";
import type { PersistentSessionShadowLegacyMessage } from "@/lib/brain/commercial/agent-session/persistentSessionShadowComparison";
import { deriveConversationMessages } from "@/lib/brain/commercial/agent-session/deriveMessages";
import type { ConversationTranscriptMessage } from "@/lib/brain/commercial/agent-session/conversationTranscriptReader";

// SALES-AGENT-R3-V1.8-D4. Pure, no-DB tests. Two things this file proves:
//
// 1. extractLegacyRecentMessagesForShadow/buildPersistentSessionShadowComparison
//    themselves - defensive extraction, count math, duplicate detection.
// 2. The continuity benchmark (task brief Section I, C01-C12): real
//    deriveConversationMessages() output (D3, unchanged, reused - never
//    reimplemented here) run through the comparison, proving the structural
//    invariants D4's gates (G1/G3/G4/G5/G6/G7/G13/G14) actually require.
//    C08/C10 (missing session events / read failure) are I/O concerns and
//    are covered in tests/commercial/runPersistentSessionShadow.test.ts
//    instead - nothing here touches the DB.

function transcript(id: string, direction: string, body: string | null, createdAt: string): ConversationTranscriptMessage {
  return { id, direction, body, createdAt };
}

function legacy(direction: "inbound" | "outbound", body: string): PersistentSessionShadowLegacyMessage {
  return { direction, body };
}

// --- extractLegacyRecentMessagesForShadow ---

test("[D4-E1] extracts a well-formed recentMessages array", () => {
  const result = extractLegacyRecentMessagesForShadow({
    recentMessages: [
      { direction: "inbound", body: "hola" },
      { direction: "outbound", body: "hola! en que te ayudo?" }
    ]
  });
  assert.deepEqual(result, [legacy("inbound", "hola"), legacy("outbound", "hola! en que te ayudo?")]);
});

test("[D4-E2] degrades to an empty array on every malformed shape - never throws", () => {
  assert.deepEqual(extractLegacyRecentMessagesForShadow({}), []);
  assert.deepEqual(extractLegacyRecentMessagesForShadow({ recentMessages: "not-an-array" }), []);
  assert.deepEqual(extractLegacyRecentMessagesForShadow({ recentMessages: [null, 42, { direction: "sideways", body: "x" }, { direction: "inbound", body: 7 }] }), []);
  assert.deepEqual(
    extractLegacyRecentMessagesForShadow({ recentMessages: [{ direction: "inbound", body: "ok" }, { direction: "outbound" }] }),
    [legacy("inbound", "ok")]
  );
});

// --- buildPersistentSessionShadowComparison: basic counts ---

test("[D4-C1] legacy/persistent counts and passthrough fields", () => {
  const comparison = buildPersistentSessionShadowComparison({
    legacyRecentMessages: [legacy("inbound", "a"), legacy("outbound", "b"), legacy("inbound", "c")],
    historicalMessages: [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" }
    ],
    toolActivityCount: 2,
    bootstrapUsed: true,
    degraded: false,
    currentInboundMessageId: "99"
  });

  assert.deepEqual(comparison.legacy, { recentMessageCount: 3, inboundCount: 2, outboundCount: 1 });
  assert.equal(comparison.persistent.historyMessageCount, 3);
  assert.equal(comparison.persistent.userCount, 2);
  assert.equal(comparison.persistent.assistantCount, 1);
  assert.equal(comparison.persistent.toolActivityCount, 2);
  assert.equal(comparison.persistent.bootstrapUsed, true);
  assert.equal(comparison.persistent.degraded, false);
  assert.equal(comparison.comparison.currentInboundExcluded, true);
  assert.equal(comparison.comparison.duplicateTranscriptMessageCount, 0);
  assert.equal(comparison.comparison.persistentOlderMessageCount, 0);
  assert.equal(comparison.comparison.persistentAdditionalAssistantCount, 0);
});

// G3. currentInboundExcluded reflects whether an id was actually threaded
// through to deriveMessages this turn - deriveMessages' own exclusion
// correctness is D3's proven job (13 unit tests), not re-verified here.
test("[D4-G3] currentInboundExcluded is false only when no real id was provided", () => {
  const base = { legacyRecentMessages: [], historicalMessages: [], toolActivityCount: 0, bootstrapUsed: false, degraded: false };
  assert.equal(buildPersistentSessionShadowComparison({ ...base, currentInboundMessageId: null }).comparison.currentInboundExcluded, false);
  assert.equal(buildPersistentSessionShadowComparison({ ...base, currentInboundMessageId: "42" }).comparison.currentInboundExcluded, true);
});

// G4. A structural self-consistency check on historicalMessages itself -
// never a legacy-vs-persistent cross check.
test("[D4-G4] duplicateTranscriptMessageCount is 0 for a normal transcript and counts real repeats", () => {
  const clean = buildPersistentSessionShadowComparison({
    legacyRecentMessages: [],
    historicalMessages: [
      { role: "user", content: "hola" },
      { role: "assistant", content: "hola!" }
    ],
    toolActivityCount: 0,
    bootstrapUsed: false,
    degraded: false,
    currentInboundMessageId: null
  });
  assert.equal(clean.comparison.duplicateTranscriptMessageCount, 0);

  const withRepeat = buildPersistentSessionShadowComparison({
    legacyRecentMessages: [],
    historicalMessages: [
      { role: "user", content: "hola" },
      { role: "assistant", content: "hola!" },
      { role: "user", content: "hola" } // exact repeat of the first turn
    ],
    toolActivityCount: 0,
    bootstrapUsed: false,
    degraded: false,
    currentInboundMessageId: null
  });
  assert.equal(withRepeat.comparison.duplicateTranscriptMessageCount, 1);

  // The compacted-prefix "system" message has no legacy analogue and is
  // never counted as a duplicate/older message, however many appear.
  const withSystemPrefix = buildPersistentSessionShadowComparison({
    legacyRecentMessages: [],
    historicalMessages: [
      { role: "system", content: "[Compacted session history through event #3] {}" },
      { role: "user", content: "hola" }
    ],
    toolActivityCount: 0,
    bootstrapUsed: false,
    degraded: false,
    currentInboundMessageId: null
  });
  assert.equal(withSystemPrefix.comparison.duplicateTranscriptMessageCount, 0);
  assert.equal(withSystemPrefix.comparison.persistentOlderMessageCount, 1, "only the real user turn counts toward older-message recovery");
});

// G14. No deterministic conversation-state machinery - the comparison shape
// itself never grows an activeTopic/currentIntent/conversationStage/nextStep
// field, checked directly against the real returned object's own keys.
test("[D4-G14] the comparison result never carries an interpreted/semantic-state field", () => {
  const comparison = buildPersistentSessionShadowComparison({
    legacyRecentMessages: [],
    historicalMessages: [],
    toolActivityCount: 0,
    bootstrapUsed: false,
    degraded: false,
    currentInboundMessageId: null
  });
  const forbidden = ["activeTopic", "currentIntent", "conversationStage", "nextStep", "confidence", "score"];
  const allKeys = [...Object.keys(comparison), ...Object.keys(comparison.legacy), ...Object.keys(comparison.persistent), ...Object.keys(comparison.comparison)];
  for (const key of allKeys) {
    assert.ok(!forbidden.includes(key), `unexpected semantic-state key: ${key}`);
  }
});

// --- Continuity benchmark (Section I) run through real deriveConversationMessages ---

function deriveHistory(rows: ConversationTranscriptMessage[], currentInboundMessageId: string | null = null) {
  return deriveConversationMessages({ transcriptMessages: rows, compactedPrefix: null, currentInboundMessageId });
}

// C01 - carry-forward: "barra 20kg" then "muestrame varias opciones" must
// both remain visible as history once the second turn is the current one.
test("[D4-C01] carry-forward: the prior barra-20kg exchange survives into the next turn's history", () => {
  const rows = [
    transcript("1", "inbound", "necesito una barra olimpica de 20kg para home gym", "2026-08-31T09:00:00.000Z"),
    transcript("2", "outbound", "tenemos la barra olimpica 20kg disponible", "2026-08-31T09:00:05.000Z"),
    transcript("3", "inbound", "muestrame varias opciones para home gym", "2026-08-31T09:01:00.000Z")
  ];
  const history = deriveHistory(rows, "3");
  assert.deepEqual(history, [
    { role: "user", content: "necesito una barra olimpica de 20kg para home gym" },
    { role: "assistant", content: "tenemos la barra olimpica 20kg disponible" }
  ]);
});

// C02 - topic switch: both topics present, in order, nothing dropped.
test("[D4-C02] topic switch: barra then colchoneta both remain in history", () => {
  const rows = [
    transcript("1", "inbound", "tienen barras olimpicas?", "2026-08-31T09:00:00.000Z"),
    transcript("2", "outbound", "si, tenemos la 20kg", "2026-08-31T09:00:05.000Z"),
    transcript("3", "inbound", "y colchonetas?", "2026-08-31T09:01:00.000Z"),
    transcript("4", "outbound", "si, tenemos varias colchonetas", "2026-08-31T09:01:05.000Z")
  ];
  const history = deriveHistory(rows);
  assert.equal(history.length, 4);
  assert.ok(history.some((m) => m.content.includes("barras")));
  assert.ok(history.some((m) => m.content.includes("colchonetas")));
});

// C03 - topic return: barra -> colchoneta -> "volvamos a la barra" - the
// original barra exchange must still be present, never deterministically
// filtered out just because a later topic appeared.
test("[D4-C03] topic return: the original barra exchange is not dropped by the later switch", () => {
  const rows = [
    transcript("1", "inbound", "tienen barras olimpicas?", "2026-08-31T09:00:00.000Z"),
    transcript("2", "outbound", "si, tenemos la 20kg", "2026-08-31T09:00:05.000Z"),
    transcript("3", "inbound", "y colchonetas?", "2026-08-31T09:01:00.000Z"),
    transcript("4", "outbound", "si, tenemos varias", "2026-08-31T09:01:05.000Z"),
    transcript("5", "inbound", "volvamos a la barra", "2026-08-31T09:02:00.000Z")
  ];
  const history = deriveHistory(rows, "5");
  assert.equal(history.length, 4, "all four prior turns survive - no active-topic filtering");
  assert.equal(history[0].content, "tienen barras olimpicas?");
  assert.equal(history[1].content, "si, tenemos la 20kg");
});

// C04 - ordinal: A/B/C then "la segunda" - the full option list stays in
// history so an ordinal reference remains resolvable from real evidence.
test("[D4-C04] ordinal reference: the offered option list remains in history", () => {
  const rows = [
    transcript("1", "inbound", "que opciones tienen?", "2026-08-31T09:00:00.000Z"),
    transcript("2", "outbound", "tenemos: A) barra 20kg, B) barra 15kg, C) barra 10kg", "2026-08-31T09:00:05.000Z"),
    transcript("3", "inbound", "la segunda", "2026-08-31T09:01:00.000Z")
  ];
  const history = deriveHistory(rows, "3");
  assert.equal(history.length, 2);
  assert.ok(history[1].content.includes("B) barra 15kg"));
});

// C05 - superseding: "20kg" then "mejor 15kg" - both remain, never collapsed
// into one canonical value (no interpretation, per Section B).
test("[D4-C05] superseding preference: both the original and the correction remain in history", () => {
  const rows = [
    transcript("1", "inbound", "quiero la barra de 20kg", "2026-08-31T09:00:00.000Z"),
    transcript("2", "outbound", "listo, la barra 20kg", "2026-08-31T09:00:05.000Z"),
    transcript("3", "inbound", "mejor la de 15kg", "2026-08-31T09:01:00.000Z")
  ];
  const history = deriveHistory(rows, "3");
  assert.equal(history.length, 2);
  assert.ok(history[0].content.includes("20kg"), "the original request is not erased by the correction");
});

// C06 - shipping correction: "San Bernardo" then "finalmente Maipu" - same
// discipline as C05, both remain as transcript evidence.
test("[D4-C06] shipping correction: both destinations remain in history, never silently overwritten", () => {
  const rows = [
    transcript("1", "inbound", "el envio es a San Bernardo", "2026-08-31T09:00:00.000Z"),
    transcript("2", "outbound", "perfecto, San Bernardo", "2026-08-31T09:00:05.000Z"),
    transcript("3", "inbound", "finalmente a Maipu", "2026-08-31T09:01:00.000Z")
  ];
  const history = deriveHistory(rows, "3");
  assert.equal(history.length, 2);
  assert.ok(history.some((m) => m.content.includes("San Bernardo")));
});

// C07 - stale historical truth: history is opaque text, never parsed for
// numeric/price content - the comparison treats a "stale price" message
// exactly like any other content string (Section J: never auto-compare
// prices from historical text).
test("[D4-C07] historical price-shaped text is opaque - never parsed, compared, or specially treated", () => {
  const rows = [
    transcript("1", "inbound", "cuanto cuesta?", "2026-08-31T09:00:00.000Z"),
    transcript("2", "outbound", "cuesta $29.990", "2026-08-31T09:00:05.000Z")
  ];
  const history = deriveHistory(rows);
  const comparison = buildPersistentSessionShadowComparison({
    legacyRecentMessages: [],
    historicalMessages: history,
    toolActivityCount: 0,
    bootstrapUsed: false,
    degraded: false,
    currentInboundMessageId: null
  });
  // The only fields this task's own type carries are counts/booleans -
  // there is no price/amount field for a fresh catalog value to ever be
  // compared against, structurally proving separation from authoritative state.
  assert.deepEqual(Object.keys(comparison.persistent).sort(), ["assistantCount", "bootstrapUsed", "degraded", "historyMessageCount", "toolActivityCount", "userCount"].sort());
  assert.equal(comparison.persistent.historyMessageCount, 2);
});

// C09 - old conversation with no session events: a bounded transcript alone
// (no events at all) still produces real history - mirrors D3's own
// bootstrapUsed fixture, exercised here through the comparison.
test("[D4-C09] a transcript with zero tool-activity events still yields real comparison counts", () => {
  const rows = [
    transcript("1", "inbound", "hola", "2026-08-31T09:00:00.000Z"),
    transcript("2", "outbound", "hola! en que ayudo?", "2026-08-31T09:00:05.000Z")
  ];
  const history = deriveHistory(rows);
  const comparison = buildPersistentSessionShadowComparison({
    legacyRecentMessages: [],
    historicalMessages: history,
    toolActivityCount: 0,
    bootstrapUsed: true,
    degraded: false,
    currentInboundMessageId: null
  });
  assert.equal(comparison.persistent.historyMessageCount, 2);
  assert.equal(comparison.persistent.toolActivityCount, 0);
  assert.equal(comparison.persistent.bootstrapUsed, true);
});

// C11 - correction after several turns: an old preference, an unrelated
// topic, a correction, then a return - every turn survives.
test("[D4-C11] correction after several intervening turns: nothing is dropped along the way", () => {
  const rows = [
    transcript("1", "inbound", "prefiero color negro", "2026-08-31T09:00:00.000Z"),
    transcript("2", "outbound", "anotado, negro", "2026-08-31T09:00:05.000Z"),
    transcript("3", "inbound", "tienen mancuernas?", "2026-08-31T09:01:00.000Z"),
    transcript("4", "outbound", "si, varias", "2026-08-31T09:01:05.000Z"),
    transcript("5", "inbound", "mejor color rojo", "2026-08-31T09:02:00.000Z"),
    transcript("6", "outbound", "anotado, rojo", "2026-08-31T09:02:05.000Z"),
    transcript("7", "inbound", "y sobre lo de las mancuernas?", "2026-08-31T09:03:00.000Z")
  ];
  const history = deriveHistory(rows, "7");
  assert.equal(history.length, 6, "every prior turn survives the multi-hop correction");
  assert.ok(history[0].content.includes("negro"));
  assert.ok(history[4].content.includes("rojo"));
});

// C12 - lateral question: product comparison -> shipping question -> return
// to product comparison. Both threads remain, in real order.
test("[D4-C12] lateral question: a shipping detour does not erase the product-comparison thread", () => {
  const rows = [
    transcript("1", "inbound", "cual es mejor, la 20kg o la 15kg?", "2026-08-31T09:00:00.000Z"),
    transcript("2", "outbound", "la 20kg rinde mas para entrenamiento avanzado", "2026-08-31T09:00:05.000Z"),
    transcript("3", "inbound", "cuanto demora el envio?", "2026-08-31T09:01:00.000Z"),
    transcript("4", "outbound", "entre 2 y 4 dias habiles", "2026-08-31T09:01:05.000Z"),
    transcript("5", "inbound", "ok, volviendo a las barras, me quedo con la 20kg", "2026-08-31T09:02:00.000Z")
  ];
  const history = deriveHistory(rows, "5");
  assert.equal(history.length, 4);
  assert.ok(history[0].content.includes("20kg o la 15kg"));
  assert.ok(history[2].content.includes("envio"));
});

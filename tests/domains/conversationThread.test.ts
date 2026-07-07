import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeConversationThread,
  normalizeMessageState,
  normalizeOutboxState,
  deriveAiControlMode,
  type ConversationMessageRow,
  type ConversationOutboxRow
} from "../../lib/domains/conversations/thread";

function messageRow(overrides: Partial<ConversationMessageRow>): ConversationMessageRow {
  return {
    id: 1,
    public_id: "cm-1",
    provider: "meta",
    provider_message_id: null,
    direction: "inbound",
    sender_type: null,
    message_type: "text",
    body: "hola",
    status: null,
    provider_timestamp: null,
    created_at: "2026-06-30 10:00:00",
    ...overrides
  };
}

function outboxRow(overrides: Partial<ConversationOutboxRow>): ConversationOutboxRow {
  return {
    id: 1,
    dedupe_key: "dk-1",
    status: "planned",
    source: null,
    source_agent_name: null,
    message_text: "respuesta",
    provider_message_id: null,
    error_code: null,
    created_at: "2026-06-30 10:05:00",
    planned_at: "2026-06-30 10:05:00",
    sent_at: null,
    failed_at: null,
    ...overrides
  };
}

test("deriveAiControlMode: human ownership wins, then paused, else autonomous", () => {
  assert.equal(deriveAiControlMode(true, false), "ai_autonomous");
  assert.equal(deriveAiControlMode(false, false), "paused");
  assert.equal(deriveAiControlMode(false, true), "human");
  assert.equal(deriveAiControlMode(true, true), "human");
});

test("normalizeMessageState: inbound always received; outbound uses delivery status", () => {
  assert.equal(normalizeMessageState("inbound", null), "received");
  assert.equal(normalizeMessageState("inbound", "whatever"), "received");
  assert.equal(normalizeMessageState("outbound", "delivered"), "delivered");
  assert.equal(normalizeMessageState("outbound", "read"), "read");
  assert.equal(normalizeMessageState("outbound", "failed"), "failed");
  assert.equal(normalizeMessageState("outbound", null), "sent");
});

test("normalizeOutboxState: lifecycle maps to timeline state", () => {
  assert.equal(normalizeOutboxState("planned"), "planned");
  assert.equal(normalizeOutboxState("locked"), "queued");
  assert.equal(normalizeOutboxState("sent"), "sent");
  assert.equal(normalizeOutboxState("failed"), "failed");
  assert.equal(normalizeOutboxState(null), "planned");
});

test("mergeConversationThread: dedupes outbox already canonicalized by provider_message_id", () => {
  const messages = [
    messageRow({ id: 10, public_id: "cm-in", direction: "inbound", provider_message_id: "wamid.IN", created_at: "2026-06-30 10:00:00" }),
    messageRow({
      id: 11,
      public_id: "cm-out",
      direction: "outbound",
      sender_type: "ai_sdr",
      body: "respuesta enviada",
      status: "delivered",
      provider_message_id: "wamid.A",
      created_at: "2026-06-30 10:06:00"
    })
  ];
  const outbox = [
    // Same provider_message_id as the canonical outbound → must be deduped (cm wins).
    outboxRow({ id: 20, dedupe_key: "dk-A", status: "sent", provider_message_id: "wamid.A", created_at: "2026-06-30 10:06:00", sent_at: "2026-06-30 10:06:00" }),
    // Planned draft with no provider id → kept.
    outboxRow({ id: 21, dedupe_key: "dk-P", status: "planned", provider_message_id: null, message_text: "borrador pendiente", created_at: "2026-06-30 10:10:00" })
  ];

  const merged = mergeConversationThread(messages, outbox);

  assert.equal(merged.length, 3, "3 distinct entries after dedup");
  const providerIds = merged.map((m) => m.providerMessageId);
  assert.equal(providerIds.filter((id) => id === "wamid.A").length, 1, "wamid.A appears once");

  // The delivered canonical row wins over the outbox 'sent' row.
  const delivered = merged.find((m) => m.providerMessageId === "wamid.A");
  assert.equal(delivered?.state, "delivered");
  assert.equal(delivered?.source, "meta");

  // Planned draft survives.
  const planned = merged.find((m) => m.body === "borrador pendiente");
  assert.equal(planned?.state, "planned");
  assert.equal(planned?.source, "outbox");
});

test("mergeConversationThread: alignment + origin classification and chronological order", () => {
  const messages = [
    messageRow({ id: 1, public_id: "a", direction: "inbound", created_at: "2026-06-30 09:00:00" }),
    messageRow({ id: 2, public_id: "b", direction: "outbound", sender_type: "ai_sdr", status: "sent", created_at: "2026-06-30 09:01:00" }),
    messageRow({ id: 3, public_id: "c", direction: "outbound", sender_type: "operator", status: "sent", created_at: "2026-06-30 09:02:00" })
  ];

  const merged = mergeConversationThread(messages, []);

  assert.deepEqual(
    merged.map((m) => m.key),
    ["a", "b", "c"],
    "sorted ascending by occurredAt"
  );
  assert.equal(merged[0].direction, "inbound");
  assert.equal(merged[0].origin, "customer");
  assert.equal(merged[1].direction, "outbound");
  assert.equal(merged[1].origin, "ai");
  assert.equal(merged[2].direction, "outbound");
  assert.equal(merged[2].origin, "operator");
});

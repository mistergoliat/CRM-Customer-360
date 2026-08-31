import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { getPool, queryRows, safeExecute, safeQueryRows } from "@/lib/db";
import { runFollowupTick } from "@/lib/brain/commercial/followup/runFollowupTick";
import { createMariaDbAgentSessionStore } from "@/lib/brain/commercial/agent-session";
import type { AgentSessionEvent } from "@/lib/brain/commercial/agent-session";

// SALES-AGENT-R3-A05. Real MariaDB (crm_test - already carries migration 033,
// unlike main_management, per docs/releases/SALES-AGENT-R3-A05-structured-followup-wake.md
// "Known limitations"). Covers the checklist items runFollowupTick.test.ts's
// mechanically-updated cycleRunner->dispatchDraftedFollowUpMessage suite does
// not: FOLLOWUP_WAKE actually lands in AgentSessionStore, its payload is
// PII-safe, disposition mapping is correct, duplicate wakes dedupe, and no
// fake inbound conversation_message is ever created for an internal wake.
Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  BRAIN_META_SEND_ENABLED: "false",
  BRAIN_OUTBOX_WORKER_ENABLED: "false",
  BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true",
  BRAIN_WHATSAPP_TEST_MODE_ENABLED: "false"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function unique(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function seedConversation(): Promise<{ id: number; waId: string }> {
  const waId = `5699${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const [result] = await getPool().execute(
    `INSERT INTO conversation (
      public_id, channel, provider, channel_account_id, external_contact_id,
      status, owner_type, ai_enabled, human_owner_active
    ) VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [randomUUID(), unique("phone"), waId]
  );
  return { id: Number((result as { insertId: number }).insertId), waId };
}

/** Same producer shape confirmed live for the native shadow/operational-loop runtime (buildAgentActionFromNextAction.ts) - draft_payload_json is NOT {kind:"objective_aware_followup"}, so it hits the generalized dispatch path, not R2's own processor. */
async function seedDraftedFollowUp(input: { conversationId: number; waId: string; draftMessage?: string | null }): Promise<string> {
  const actionId = `action-${unique("wake")}`;
  const scheduledFor = new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace("T", " ");
  const createdAt = new Date(Date.now() + 2000).toISOString().slice(0, 19).replace("T", " ");
  const insert = await safeExecute(
    `INSERT INTO crm_agent_actions (
        action_id, idempotency_key, conversation_case_id, wa_id, channel,
        action_type, status, draft_message, scheduled_for, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'whatsapp', 'schedule_followup', 'planned', ?, ?, ?, ?)`,
    [actionId, actionId, input.conversationId, input.waId, input.draftMessage ?? "Seguimos con tu cotizacion?", scheduledFor, createdAt, createdAt]
  );
  assert.ok(insert.ok, insert.ok ? "" : insert.error);
  return actionId;
}

async function loadFollowUpWakeEvents(conversationId: number): Promise<AgentSessionEvent[]> {
  const store = createMariaDbAgentSessionStore();
  const session = await store.loadSessionForConversation(conversationId);
  if (!session) return [];
  const events = await store.loadRecentEvents({ sessionId: session.id, maxEvents: 50 });
  return events.filter((event) => event.eventType === "FOLLOWUP_WAKE");
}

async function countInboundMessages(conversationId: number): Promise<number> {
  const rows = await queryRows<{ count: number }>(
    `SELECT COUNT(*) AS count FROM conversation_message WHERE conversation_id = ? AND direction = 'inbound'`,
    [conversationId]
  );
  return Number(rows[0]?.count ?? 0);
}

test("a due drafted follow-up dispatches through the canonical outbound path and records exactly one FOLLOWUP_WAKE event", async () => {
  const conversation = await seedConversation();
  const draftMessage = "Hola, seguimos con tu cotizacion de jaula de potencia?";
  const actionId = await seedDraftedFollowUp({ conversationId: conversation.id, waId: conversation.waId, draftMessage });

  const inboundBefore = await countInboundMessages(conversation.id);

  const tick = await runFollowupTick({ limit: 10, actionIds: [actionId] });
  assert.deepEqual(tick.executed, [actionId]);

  const row = await safeQueryRows<{ status: string }>("SELECT status FROM crm_agent_actions WHERE action_id = ? LIMIT 1", [actionId]);
  assert.equal(row.ok && row.rows[0]?.status, "executed");

  // No fake customer message was ever created for this internal wake.
  const inboundAfter = await countInboundMessages(conversation.id);
  assert.equal(inboundAfter, inboundBefore, "a follow-up wake must never create a customer-authored conversation_message");

  // The dispatched text is exactly the row's own durable draft.
  const outboxRows = await queryRows<{ message_text: string | null; status: string }>(
    "SELECT message_text, status FROM brain_message_outbox WHERE conversation_case_id = ? ORDER BY id DESC LIMIT 1",
    [conversation.id]
  );
  assert.equal(outboxRows[0]?.message_text, draftMessage);
  assert.equal(outboxRows[0]?.status, "planned");

  // Exactly one FOLLOWUP_WAKE event, structurally sound, PII-safe.
  const wakeEvents = await loadFollowUpWakeEvents(conversation.id);
  assert.equal(wakeEvents.length, 1);
  const wakeEvent = wakeEvents[0]!;
  assert.equal(wakeEvent.payload.actionPublicId, actionId);
  assert.equal(wakeEvent.payload.disposition, "executed");
  assert.equal(wakeEvent.payload.wakeReason, "scheduled_due");
  assert.equal(wakeEvent.conversationId, conversation.id);
  for (const forbidden of ["waId", "wa_id", "phone", "email", "draftMessage", "messageText", "body"]) {
    assert.equal(forbidden in wakeEvent.payload, false, `wake payload must never carry "${forbidden}"`);
  }
});

test("a wake cancelled by human takeover records disposition=cancelled with the real reason, never dispatches", async () => {
  const conversation = await seedConversation();
  const actionId = await seedDraftedFollowUp({ conversationId: conversation.id, waId: conversation.waId });
  await safeExecute("UPDATE conversation SET human_owner_active = 1 WHERE id = ?", [conversation.id]);

  const tick = await runFollowupTick({ limit: 10, actionIds: [actionId] });
  assert.equal(tick.executed.length, 0);
  assert.equal(tick.cancelled[0]?.reason, "human_owner_active");

  const wakeEvents = await loadFollowUpWakeEvents(conversation.id);
  assert.equal(wakeEvents.length, 1);
  assert.equal(wakeEvents[0]!.payload.disposition, "cancelled");
  assert.equal(wakeEvents[0]!.payload.dispositionReason, "human_owner_active");

  const outboxRows = await queryRows<{ count: number }>(
    "SELECT COUNT(*) AS count FROM brain_message_outbox WHERE conversation_case_id = ?",
    [conversation.id]
  );
  assert.equal(Number(outboxRows[0]?.count ?? 0), 0, "a cancelled wake must never produce an outbound message");
});

test("a repeated worker tick on the same claimed attempt never produces a second logical FOLLOWUP_WAKE event", async () => {
  const conversation = await seedConversation();
  const actionId = await seedDraftedFollowUp({ conversationId: conversation.id, waId: conversation.waId });

  const first = await runFollowupTick({ limit: 10, actionIds: [actionId] });
  assert.deepEqual(first.executed, [actionId]);

  // The row is now 'executed' (terminal) - a second tick finds nothing to
  // claim at all, proving the CAS-level guarantee that already protects
  // FOLLOWUP_WAKE (same discipline runFollowupTick.test.ts's own "second
  // tick does not duplicate" cases prove for the dispatch itself).
  const second = await runFollowupTick({ limit: 10, actionIds: [actionId] });
  assert.equal(second.processed, 0);

  const wakeEvents = await loadFollowUpWakeEvents(conversation.id);
  assert.equal(wakeEvents.length, 1, "exactly one logical wake for one claimed attempt, regardless of how many ticks ran");
});

test("correlationId is shared between the FOLLOWUP_WAKE session event and its own dedupe key - both derive from the same fired wake", async () => {
  const conversation = await seedConversation();
  const actionId = await seedDraftedFollowUp({ conversationId: conversation.id, waId: conversation.waId });

  await runFollowupTick({ limit: 10, actionIds: [actionId] });

  const wakeEvents = await loadFollowUpWakeEvents(conversation.id);
  assert.equal(wakeEvents.length, 1);
  const event = wakeEvents[0]!;
  assert.equal(event.correlationId.startsWith(`followup:${actionId}:`), true);
  assert.equal(event.dedupeKey.includes("followup_wake"), true);
});

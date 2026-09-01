import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { dispatchSalesAgentResponse, SALES_AGENT_RESPONSE_DISPATCHER_VERSION } from "@/lib/brain/commercial/sales-agent-runtime";
import { runOutboxTick } from "@/lib/brain/messaging/autonomousOutboxTick";

/**
 * SALES-AGENT-R3-V1.5. Unit-level coverage of the R3-native response
 * dispatcher itself (dispatchSalesAgentResponse.ts) - never re-proves what
 * tests/commercial/runSalesAgentRuntimeCycle.test.ts already covers at the
 * routing-seam level ([RC1]/[RC5]/[RC7]). Same local dev DB credentials
 * those files already establish.
 */
Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: ""
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures - test results already reported
  }
});

async function withEnv<T>(overrides: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous = { ...process.env };
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    process.env = previous;
  }
}

/**
 * `last_inbound_at = NOW()` matters only for [D10] (real outbox-worker
 * compatibility) - the worker's own 24h WhatsApp-window revalidation
 * (autonomousOutboxTick.ts#revalidateBeforeSend) would otherwise cancel any
 * row for a conversation with no recent inbound message.
 */
async function insertConversation(): Promise<number> {
  const [result] = await getPool().execute(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id, status, owner_type, ai_enabled, human_owner_active, last_inbound_at)
     VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0, UTC_TIMESTAMP())`,
    [randomUUID(), `phone-${randomUUID()}`, "56900002222"]
  );
  return Number((result as { insertId: number }).insertId);
}

async function setConversationOwnership(conversationId: number, fields: { aiEnabled?: boolean; humanOwnerActive?: boolean; status?: string }) {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (fields.aiEnabled !== undefined) {
    sets.push("ai_enabled = ?");
    params.push(fields.aiEnabled ? 1 : 0);
  }
  if (fields.humanOwnerActive !== undefined) {
    sets.push("human_owner_active = ?");
    params.push(fields.humanOwnerActive ? 1 : 0);
  }
  if (fields.status !== undefined) {
    sets.push("status = ?");
    params.push(fields.status);
  }
  params.push(conversationId);
  await getPool().execute(`UPDATE conversation SET ${sets.join(", ")} WHERE id = ?`, params);
}

function dedupeKeyFor(conversationId: number, inboundMessageId: string) {
  return `sales-agent-r3:${conversationId}:${inboundMessageId}:responded`;
}

async function loadOutboxRowByDedupeKey(dedupeKey: string) {
  const [rows] = await getPool().execute(
    "SELECT id, status, source, source_agent_name, source_agent_version, wa_id, phone_number_id, conversation_case_id, message_text, meta_payload_json FROM brain_message_outbox WHERE dedupe_key = ? LIMIT 1",
    [dedupeKey]
  );
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return null;
  const rawMeta = row.meta_payload_json;
  const meta = typeof rawMeta === "string" ? JSON.parse(rawMeta) : (rawMeta as Record<string, unknown> | null);
  return { ...row, meta_payload_json: meta } as {
    id: number;
    status: string;
    source: string | null;
    source_agent_name: string | null;
    source_agent_version: string | null;
    wa_id: string | null;
    phone_number_id: string | null;
    conversation_case_id: number | string | null;
    message_text: string | null;
    meta_payload_json: Record<string, unknown> | null;
  };
}

async function countOutboxRowsByDedupeKey(dedupeKey: string) {
  const [rows] = await getPool().execute("SELECT id FROM brain_message_outbox WHERE dedupe_key = ?", [dedupeKey]);
  return (rows as unknown[]).length;
}

async function loadLatestDispatchEvent(inboundMessageId: string) {
  const rows = await safeQueryRows<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_event WHERE event_type = 'sales_agent_runtime_response_dispatched' AND source_event_id = ? ORDER BY id DESC LIMIT 1",
    [inboundMessageId]
  );
  assert.ok(rows.ok, rows.ok ? "" : rows.error);
  const raw = rows.rows[0]?.payload_json;
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

function baseInput(conversationId: number, overrides: Partial<Parameters<typeof dispatchSalesAgentResponse>[0]> = {}) {
  const inboundMessageId = `dsr-msg-${conversationId}`;
  return {
    conversationId,
    conversationCaseId: conversationId,
    opportunityId: null,
    waId: "56900002222",
    inboundMessageId,
    correlationId: `dsr-corr-${conversationId}`,
    currentTime: "2026-08-31T15:00:00.000Z",
    humanOwnerActive: false,
    aiBlocked: false,
    finalMessage: "Tenemos disponibilidad, ¿te ayudo con algo mas?",
    ...overrides
  };
}

test("[D1] dispatched: writes exactly one canonical outbox row with the R3 dedupe key and contract fields", async () => {
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const result = await dispatchSalesAgentResponse(input);

    assert.equal(result.status, "dispatched");
    assert.equal(result.outboxWritten, true);
    assert.equal(result.duplicate, false);
    assert.ok(result.outboxId);

    const row = await loadOutboxRowByDedupeKey(dedupeKeyFor(conversationId, input.inboundMessageId));
    assert.ok(row);
    assert.equal(row!.status, "planned");
    assert.equal(row!.wa_id, "56900002222");
    assert.equal(Number(row!.conversation_case_id), conversationId);
    assert.equal(row!.message_text, input.finalMessage);
    assert.equal(row!.source, "sales-agent-r3");
    assert.equal(row!.source_agent_version, SALES_AGENT_RESPONSE_DISPATCHER_VERSION);

    const event = await loadLatestDispatchEvent(input.inboundMessageId);
    assert.ok(event);
    assert.equal(event!.reason, "dispatched");
    assert.equal(event!.outboxWritten, true);
    assert.equal(event!.duplicate, false);
    assert.equal(event!.dispatcherVersion, SALES_AGENT_RESPONSE_DISPATCHER_VERSION);
  });
});

test("[D2] duplicate inbound: reprocessing the same conversation + inboundMessageId never creates a second outbox row", async () => {
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const first = await dispatchSalesAgentResponse(input);
    const second = await dispatchSalesAgentResponse(input);

    assert.equal(first.outboxWritten, true);
    assert.equal(first.duplicate, false);
    assert.equal(second.outboxWritten, true);
    assert.equal(second.duplicate, true);
    assert.equal(second.outboxId, first.outboxId);

    assert.equal(await countOutboxRowsByDedupeKey(dedupeKeyFor(conversationId, input.inboundMessageId)), 1);
  });
});

test("[D3] legacy R1 flags are irrelevant: with the action queue/execution gate/sandbox stack fully disabled, R3 still dispatches on its own flag", async () => {
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);

  await withEnv(
    {
      BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true",
      BRAIN_AGENT_ACTION_QUEUE_ENABLED: "false",
      BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "false",
      BRAIN_EXECUTION_GATE_ENABLED: "false",
      BRAIN_OUTBOX_BRIDGE_ENABLED: "false",
      BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "false",
      BRAIN_AUTONOMOUS_REPLY_ENABLED: "false"
    },
    async () => {
      const result = await dispatchSalesAgentResponse(input);
      assert.equal(result.status, "dispatched");
      assert.equal(result.outboxWritten, true);
    }
  );
});

test("[D4] humanOwnerActive input flag: no outbox row, governed skip", async () => {
  const conversationId = await insertConversation();
  const input = baseInput(conversationId, { humanOwnerActive: true });

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const result = await dispatchSalesAgentResponse(input);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "human_owner_active");
    assert.equal(result.outboxWritten, false);
    assert.equal(await countOutboxRowsByDedupeKey(dedupeKeyFor(conversationId, input.inboundMessageId)), 0);
  });
});

test("[D5] aiBlocked input flag: no outbox row, governed skip", async () => {
  const conversationId = await insertConversation();
  const input = baseInput(conversationId, { aiBlocked: true });

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const result = await dispatchSalesAgentResponse(input);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "ai_blocked");
    assert.equal(result.outboxWritten, false);
  });
});

test("[D6] BRAIN_AUTONOMOUS_RESPONSES_ENABLED off (default): no outbox row - the one R3 top-level killswitch", async () => {
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);

  const result = await dispatchSalesAgentResponse(input);
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "autonomous_responses_disabled");
  assert.equal(result.outboxWritten, false);
});

test("[D7] non-allowlisted waId during a pilot: no outbox row", async () => {
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true", BRAIN_AUTONOMOUS_TEST_WA_IDS: "56900009999" }, async () => {
    const result = await dispatchSalesAgentResponse(input);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "wa_not_allowlisted");
    assert.equal(result.outboxWritten, false);
  });
});

test("[D7b] allowlisted waId during a pilot: dispatches normally", async () => {
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true", BRAIN_AUTONOMOUS_TEST_WA_IDS: input.waId }, async () => {
    const result = await dispatchSalesAgentResponse(input);
    assert.equal(result.status, "dispatched");
    assert.equal(result.outboxWritten, true);
  });
});

test("[D8] empty response: no outbox row, no DB touched", async () => {
  const conversationId = await insertConversation();
  const input = baseInput(conversationId, { finalMessage: "   " });

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const result = await dispatchSalesAgentResponse(input);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "empty_message");
    assert.equal(result.outboxWritten, false);
  });
});

test("[D9] ownership race: a human takeover recorded in the DB after the turn's own stale snapshot must still block the outbox write", async () => {
  const conversationId = await insertConversation();
  // Turn-start snapshot said humanOwnerActive:false (SalesAgentRuntime reasoned
  // under that assumption) - but an operator's "take control" committed to the
  // conversation row WHILE the model was reasoning. The transactional recheck
  // inside dispatchSalesAgentResponse.ts (SELECT ... FOR UPDATE, same
  // transaction as the outbox insert) must catch this live state, not just the
  // stale input flags, per the release's own explicit race requirement.
  await setConversationOwnership(conversationId, { humanOwnerActive: true, aiEnabled: false });
  const input = baseInput(conversationId, { humanOwnerActive: false, aiBlocked: false });

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const result = await dispatchSalesAgentResponse(input);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "human_owner_active");
    assert.equal(result.outboxWritten, false);
    assert.equal(await countOutboxRowsByDedupeKey(dedupeKeyFor(conversationId, input.inboundMessageId)), 0);
  });
});

test("[D9b] ownership race: AI paused mid-turn (ai_enabled flipped false, no explicit takeover) still blocks the outbox write", async () => {
  const conversationId = await insertConversation();
  await setConversationOwnership(conversationId, { aiEnabled: false });
  const input = baseInput(conversationId);

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const result = await dispatchSalesAgentResponse(input);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "ai_blocked");
    assert.equal(result.outboxWritten, false);
  });
});

test("[D10] outbox worker compatibility: the row this dispatcher writes is a real, processable planned row for the existing crm-outbox worker", async () => {
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const result = await dispatchSalesAgentResponse(input);
    assert.equal(result.outboxWritten, true);
    assert.ok(result.outboxId);

    const tick = await runOutboxTick({ batchSize: 10, lockSeconds: 60, workerId: "test-dsr-worker", dryRun: true, outboxIds: [result.outboxId!] });
    assert.equal(tick.processed, 1, "the worker must select, authorize and claim this row without cancelling it (ownership/window revalidation must pass)");
    assert.equal(tick.cancelled, 0);
    assert.equal(tick.skipped, 0);
  });
});

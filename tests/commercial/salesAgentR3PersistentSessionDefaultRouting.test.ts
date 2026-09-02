import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import type { AgentLoopProvider } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";

/**
 * SALES-AGENT-R3-V1.8-D6. Real MariaDB (crm_test), same convention/pipeline
 * layer as tests/commercial/salesAgentR3PilotRoutingAuthority.test.ts (V1.7)
 * - proves, at the runNativeAutonomousCycle runtime-selection level, that
 * persistent-session cognition is the DEFAULT conversational-memory path for
 * every R3-eligible turn, with no second, D5-specific allowlist required.
 *
 * Task brief Section S coverage:
 *   [T1]  R3 eligible + session success -> persistent path by default.
 *   [T2]  new conversation + empty history -> persistent path, not fallback.
 *   [T8]  R3 routing gate (BRAIN_SALES_AGENT_RUNTIME_WA_IDS) still controls
 *         eligibility - a non-allowlisted waId never reaches cognition at all.
 *   [T9]  the retired BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS allowlist
 *         is never set in these tests and cognition is still active - proves
 *         it is no longer required.
 *   [T10] rollback (BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED=false)
 *         works end-to-end: no persistent_session_cognition_applied event,
 *         the turn still completes normally via the legacy path.
 */
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
  BRAIN_WHATSAPP_TEST_MODE_ENABLED: "false"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
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

async function insertConversation(): Promise<{ id: number; publicId: string; waId: string }> {
  const publicId = `conv-r3d6-${randomUUID().slice(0, 8)}`;
  const waId = `5699${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 15);
  const [result] = await getPool().execute(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id, status, owner_type, ai_enabled, human_owner_active)
     VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [publicId, `phone-${randomUUID().slice(0, 8)}`, waId]
  );
  return { id: Number((result as { insertId: number }).insertId), publicId, waId };
}

async function insertPriorMessage(conversationId: number, direction: "inbound" | "outbound", body: string, createdAt: string): Promise<void> {
  const publicId = randomUUID();
  await getPool().execute(
    `INSERT INTO conversation_message (public_id, conversation_id, provider, direction, sender_type, message_type, body, status, created_at)
     VALUES (?, ?, 'meta', ?, 'customer', 'text', ?, 'received', ?)`,
    [publicId, conversationId, direction, body, createdAt]
  );
}

async function loadCognitionAppliedPayload(inboundMessageId: string): Promise<{ active: boolean; historyMessageCount: number; fallbackReason: string | null } | null> {
  const result = await safeQueryRows<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_event WHERE event_type = 'persistent_session_cognition_applied' AND source_event_id = ? ORDER BY id DESC LIMIT 1",
    [inboundMessageId]
  );
  if (!result.ok || result.rows.length === 0) return null;
  return JSON.parse(result.rows[0].payload_json);
}

function respondOnlyProvider(message: string): AgentLoopProvider {
  return createFakeAgentLoopProvider({ script: [{ type: "respond", message }] });
}

const LEGACY_RUNTIME_OFF = {
  BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED: "false",
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false",
  BRAIN_AGENT_TOOL_LOOP_ENABLED: "false",
  BRAIN_MULTI_INTENT_PLANNER_ENABLED: "false",
  BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED: "false"
};

function r3PilotEnv(waId: string) {
  return {
    ...LEGACY_RUNTIME_OFF,
    BRAIN_SALES_AGENT_RUNTIME_ENABLED: "true",
    BRAIN_SALES_AGENT_RUNTIME_WA_IDS: waId,
    BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true"
  };
}

test("[D6-T2] fresh conversation, zero historical messages, no D5 allowlist configured: persistent path is used by default (active, not a fallback)", async () => {
  const conversation = await insertConversation();
  const messageId = `wamid.r3-d6-zero.${conversation.id}`;

  await withEnv(r3PilotEnv(conversation.waId), async () => {
    const result = await runNativeAutonomousCycle({
      conversationId: conversation.id,
      conversationPublicId: conversation.publicId,
      customerMasterId: null,
      waId: conversation.waId,
      phoneNumberId: "phone-r3-d6-test",
      messageId,
      messageText: "Hola",
      correlationId: `corr-r3-d6-zero-${conversation.id}`,
      currentTime: new Date().toISOString(),
      agentLoopProvider: respondOnlyProvider("Hola, en que te puedo ayudar?")
    });

    assert.equal(result.reason, "sales_agent_runtime");
    assert.equal(result.salesAgentRuntime!.runtime.status, "responded");
  });

  const payload = await loadCognitionAppliedPayload(messageId);
  assert.notEqual(payload, null, "a persistent_session_cognition_applied event must be recorded by default, with no BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS set");
  assert.equal(payload!.active, true, "empty history is still a successful persistent-session turn, never a fallback");
  assert.equal(payload!.historyMessageCount, 0);
  assert.equal(payload!.fallbackReason, null);
});

test("[D6-T1/T9] fresh conversation with real prior turns, no D5 allowlist configured: persistent path carries the real historical messages by default", async () => {
  const conversation = await insertConversation();
  const base = Date.now();
  const iso = (offsetMs: number) => new Date(base + offsetMs).toISOString().slice(0, 23).replace("T", " ");
  await insertPriorMessage(conversation.id, "inbound", "necesito una barra olimpica de 20kg", iso(0));
  await insertPriorMessage(conversation.id, "outbound", "tenemos la barra olimpica 20kg", iso(1000));
  const messageId = `wamid.r3-d6-hist.${conversation.id}`;

  await withEnv(r3PilotEnv(conversation.waId), async () => {
    const result = await runNativeAutonomousCycle({
      conversationId: conversation.id,
      conversationPublicId: conversation.publicId,
      customerMasterId: null,
      waId: conversation.waId,
      phoneNumberId: "phone-r3-d6-test",
      messageId,
      messageText: "me puedes dar mas opciones?",
      correlationId: `corr-r3-d6-hist-${conversation.id}`,
      currentTime: new Date(base + 2000).toISOString(),
      agentLoopProvider: respondOnlyProvider("Claro, contamos con varias opciones.")
    });

    assert.equal(result.reason, "sales_agent_runtime");
    assert.equal(result.salesAgentRuntime!.runtime.status, "responded");
  });

  const payload = await loadCognitionAppliedPayload(messageId);
  assert.notEqual(payload, null);
  assert.equal(payload!.active, true, "no BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS configured for this waId - proves the D5 allowlist is no longer required");
  assert.equal(payload!.historyMessageCount, 2, "the real prior inbound+outbound turns must be carried, not evicted/ignored");
});

test("[D6-T10] rollback: BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED=false reverts an otherwise-eligible turn to the legacy path", async () => {
  const conversation = await insertConversation();
  const base = Date.now();
  await insertPriorMessage(conversation.id, "inbound", "hola", new Date(base).toISOString().slice(0, 23).replace("T", " "));
  const messageId = `wamid.r3-d6-rollback.${conversation.id}`;

  await withEnv({ ...r3PilotEnv(conversation.waId), BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED: "false" }, async () => {
    const result = await runNativeAutonomousCycle({
      conversationId: conversation.id,
      conversationPublicId: conversation.publicId,
      customerMasterId: null,
      waId: conversation.waId,
      phoneNumberId: "phone-r3-d6-test",
      messageId,
      messageText: "otra pregunta",
      correlationId: `corr-r3-d6-rollback-${conversation.id}`,
      currentTime: new Date(base + 1000).toISOString(),
      agentLoopProvider: respondOnlyProvider("Claro, cuentame mas.")
    });

    assert.equal(result.reason, "sales_agent_runtime", "rollback disables cognition, never routing itself");
    assert.equal(result.salesAgentRuntime!.runtime.status, "responded", "the legacy path must still complete the turn normally");
  });

  const payload = await loadCognitionAppliedPayload(messageId);
  assert.equal(payload, null, "the global rollback flag disables cognition eligibility entirely - no per-turn event is written for a turn that never attempted the persistent path");
});

test("[D6-T8] a waId NOT allowlisted for SalesAgentRuntime never reaches persistent-session cognition at all", async () => {
  const conversation = await insertConversation();
  const messageId = `wamid.r3-d6-notrouted.${conversation.id}`;
  const notCalled: AgentLoopProvider = {
    name: "must-not-be-called",
    async invoke() {
      throw new Error("must not be invoked for a non-allowlisted waId");
    }
  };

  await withEnv(
    {
      ...r3PilotEnv("56900000000" /* a different waId than conversation.waId */),
      BRAIN_AUTONOMOUS_TEST_WA_IDS: conversation.waId
    },
    async () => {
      const result = await runNativeAutonomousCycle({
        conversationId: conversation.id,
        conversationPublicId: conversation.publicId,
        customerMasterId: null,
        waId: conversation.waId,
        phoneNumberId: "phone-r3-d6-test",
        messageId,
        messageText: "Hola",
        correlationId: `corr-r3-d6-notrouted-${conversation.id}`,
        currentTime: new Date().toISOString(),
        agentLoopProvider: notCalled
      });

      assert.equal(result.salesAgentRuntime ?? null, null, "SalesAgentRuntime must not run for a waId outside its own routing allowlist");
    }
  );

  const payload = await loadCognitionAppliedPayload(messageId);
  assert.equal(payload, null, "a turn that never reaches SalesAgentRuntime can never reach persistent-session cognition either");
});

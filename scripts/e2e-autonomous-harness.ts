/**
 * e2e-autonomous-harness
 *
 * Reproducible end-to-end verification of the autonomous commercial system
 * against the LOCAL database, with a fake Meta transport. It never calls the
 * real Meta API (BRAIN_META_SEND_ENABLED is forced to false and every send
 * goes through an in-process fake), so no message can reach a real customer.
 *
 * Scenarios (numbered as in the operational spec):
 *   A first inbound → cycle → decision → action → outbox → worker → delivery → timeline
 *   B multi-turn continuity without duplicate conversations
 *   C operator takeover / manual reply / release back to AI
 *   D AI-vs-operator race (pending auto-response must never go out)
 *   E proactive follow-up execution + cancellation on customer reply
 *   F duplicate inbound webhook → exactly one message and one commercial event
 *   G transient provider failure → retry with backoff; exhaustion → terminal failure
 *   H closed WhatsApp 24h window blocks free text (manual + autonomous)
 *   I close / reopen lifecycle
 *   J incomplete data (no customer, no opportunity, no actions) degrades cleanly
 *
 * Scenarios A/B run the REAL LLM cycle when the model provider is configured;
 * pass --skip-llm to run the deterministic seeded variant instead.
 *
 * Usage:
 *   npm run e2e:autonomous
 *   npm run e2e:autonomous -- --skip-llm
 */

import path from "node:path";
import { loadLocalEnv, loadEnvFile, PROJECT_ROOT } from "./db-utils";

const SKIP_LLM = process.argv.includes("--skip-llm");

type ScenarioResult = {
  id: string;
  name: string;
  status: "PASS" | "FAIL" | "PARTIAL";
  evidence: string[];
};

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function loadRuntimeEnv() {
  await loadLocalEnv();
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env.local"), false);
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env"), false);

  Object.assign(process.env, {
    DB_WRITE_ENABLED: "true",
    // HARD SAFETY: the real Meta adapter stays disabled for the whole run.
    BRAIN_META_SEND_ENABLED: "false",
    BRAIN_OUTBOX_WORKER_ENABLED: "false"
  });

  if (!SKIP_LLM) {
    Object.assign(process.env, {
      BRAIN_ENABLE_REAL_MODEL: "true",
      BRAIN_SALES_AGENT_ENABLED: "true",
      BRAIN_SALES_AGENT_DRY_RUN: "false",
      BRAIN_COMMERCIAL_SHADOW_ENABLED: "true",
      BRAIN_COMMERCIAL_RUNTIME_ENABLED: "true",
      BRAIN_COMMERCIAL_POLICY_ENABLED: "true",
      BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER: "true",
      BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "true",
      BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED: "true",
      BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
      BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
      BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "true",
      BRAIN_AUTONOMOUS_REPLY_ENABLED: "true",
      BRAIN_EXECUTION_GATE_ENABLED: "true",
      BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
      BRAIN_EXECUTION_GATE_SANDBOX_REQUIRED: "false",
      BRAIN_COMMERCIAL_SHADOW_TIMEOUT_MS: "60000",
      BRAIN_COMMERCIAL_CONTEXT_TIMEOUT_MS: "5000",
      BRAIN_COMMERCIAL_RUNTIME_TIMEOUT_MS: "45000",
      BRAIN_COMMERCIAL_POLICY_TIMEOUT_MS: "5000",
      BRAIN_MODEL_TIMEOUT_MS: "45000"
    });
  } else {
    Object.assign(process.env, {
      BRAIN_SALES_AGENT_ENABLED: "false",
      BRAIN_COMMERCIAL_SHADOW_ENABLED: "false",
      BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "false"
    });
  }
}

async function main() {
  await loadRuntimeEnv();

  const { safeQueryRows, getPool } = await import("../lib/db");
  const { processNativeWhatsAppInbound, applyMetaDeliveryStatus, loadNativeConversationDetailByPublicId } = await import("../lib/brain/native-whatsapp/service");
  const { createOutboxPlannedRecord } = await import("../lib/brain/messaging/outbox");
  const { runOutboxTick } = await import("../lib/brain/messaging/autonomousOutboxTick");
  const { runFollowupTick } = await import("../lib/brain/commercial/followup/runFollowupTick");
  const { applyConversationControl } = await import("../lib/domains/conversations/control");
  const { sendConversationManualReply } = await import("../lib/domains/conversations/manual-reply");
  const { loadConversationThread } = await import("../lib/domains/conversations/thread");
  const { loadConversationAutonomousState } = await import("../lib/domains/conversations/autonomous-state");

  type SendResult = Awaited<ReturnType<typeof import("../lib/brain/messaging/metaClient").sendMetaWhatsAppTextMessage>>;

  const fakeSent = (providerMessageId: string): SendResult =>
    ({
      ok: true,
      status: "sent",
      error_code: null,
      error_message: null,
      blocked_reasons: [],
      warnings: [],
      http_status: 200,
      provider_message_id: providerMessageId,
      meta_payload_preview: null,
      response_body: null
    }) as SendResult;

  const fakeTransientFailure = (): SendResult =>
    ({
      ok: false,
      status: "failed",
      error_code: "meta_http_error",
      error_message: "simulated 503 from provider",
      blocked_reasons: ["meta_http_error"],
      warnings: [],
      http_status: 503,
      provider_message_id: null,
      meta_payload_preview: null,
      response_body: null
    }) as SendResult;

  async function inject(waId: string, phoneNumberId: string, text: string, providerMessageId = `wamid.e2e-${uniqueSuffix("in")}`) {
    return processNativeWhatsAppInbound({
      providerMessageId,
      phoneNumberId,
      externalSenderId: waId,
      senderPhone: waId,
      senderName: "Cliente E2E",
      messageType: "text",
      text,
      occurredAt: new Date().toISOString(),
      rawPayload: { simulated: true, providerMessageId }
    });
  }

  async function seedOutbox(conv: { waId: string; phoneNumberId: string; conversationId: number }, text: string) {
    const planned = await createOutboxPlannedRecord({
      dedupeKeyInput: {
        source: "brain",
        actionType: "send_whatsapp_message",
        channel: "whatsapp",
        waId: conv.waId,
        phoneNumberId: conv.phoneNumberId,
        conversationCaseId: conv.conversationId,
        messageText: text,
        sourceRequestId: uniqueSuffix("seed")
      },
      status: "planned",
      source: "brain",
      waId: conv.waId,
      phoneNumberId: conv.phoneNumberId,
      conversationCaseId: conv.conversationId,
      messageText: text
    });
    if (!planned.ok || !planned.row.id) throw new Error(`seedOutbox failed: ${planned.ok ? "no id" : planned.warning}`);
    return planned.row.id as number;
  }

  async function count(sql: string, params: Array<string | number>) {
    const result = await safeQueryRows<{ total: number }>(sql, params);
    if (!result.ok) throw new Error(result.error);
    return Number(result.rows[0]?.total ?? 0);
  }

  function newIdentity() {
    const waId = `5696${String(Date.now()).slice(-8)}`;
    const phoneNumberId = `phone-e2e-${uniqueSuffix("pn")}`;
    return { waId, phoneNumberId };
  }

  const results: ScenarioResult[] = [];

  async function scenario(id: string, name: string, run: (evidence: string[]) => Promise<"PASS" | "PARTIAL">) {
    const evidence: string[] = [];
    try {
      const status = await run(evidence);
      results.push({ id, name, status, evidence });
      console.log(`[${id}] ${status} — ${name}`);
    } catch (error) {
      evidence.push(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      results.push({ id, name, status: "FAIL", evidence });
      console.error(`[${id}] FAIL — ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function assertTrue(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  // ============================ ESCENARIO A ============================
  await scenario("A", "primer mensaje: inbound → ciclo → outbox → worker → delivery → timeline", async (evidence) => {
    const { waId, phoneNumberId } = newIdentity();
    if (!SKIP_LLM) process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = waId;

    const inbound = await inject(waId, phoneNumberId, "Hola, quiero comprar una barra olimpica y discos, presupuesto 500.000 CLP");
    assertTrue(!inbound.duplicate && inbound.conversationId && inbound.messageId, "inbound must persist");
    const conversationId = inbound.conversationId as number;
    evidence.push(`inbound persisted: conversation=${conversationId} message=${inbound.messageId} correlation=${inbound.correlationId}`);

    const messageCount = await count("SELECT COUNT(*) AS total FROM conversation_message WHERE conversation_id = ? AND direction = 'inbound'", [conversationId]);
    assertTrue(messageCount === 1, `exactly one inbound message, got ${messageCount}`);
    const eventCount = await count("SELECT COUNT(*) AS total FROM commercial_event WHERE conversation_id = ?", [conversationId]);
    assertTrue(eventCount >= 1, "commercial event recorded");
    evidence.push(`conversation_message inbound=1, commercial_event=${eventCount}`);

    let partial = false;
    let outboxIds: number[] = [];

    if (!SKIP_LLM) {
      const decisions = await count(
        "SELECT COUNT(*) AS total FROM crm_agent_decisions d INNER JOIN crm_opportunities o ON o.id = d.opportunity_id WHERE o.conversation_case_id = ?",
        [String(conversationId)]
      );
      const actions = await count("SELECT COUNT(*) AS total FROM crm_agent_actions WHERE conversation_case_id = ?", [conversationId]);
      const outboxRows = await safeQueryRows<{ id: number }>(
        "SELECT id FROM brain_message_outbox WHERE conversation_case_id = ? AND status = 'planned'",
        [conversationId]
      );
      outboxIds = outboxRows.ok ? outboxRows.rows.map((r) => r.id) : [];
      evidence.push(`cycle wrote: decisions=${decisions} actions=${actions} planned_outbox=${outboxIds.length}`);
      if (outboxIds.length === 0) {
        // The LLM decision may legitimately not produce an outbound (policy);
        // fall back to a seeded row so the transport half is still verified.
        partial = actions === 0;
        outboxIds = [await seedOutbox({ waId, phoneNumberId, conversationId }, "Respuesta autónoma simulada A")];
        evidence.push("no planned outbox from cycle; seeded row to verify transport half");
      }
    } else {
      outboxIds = [await seedOutbox({ waId, phoneNumberId, conversationId }, "Respuesta autónoma simulada A")];
      evidence.push("LLM skipped: seeded planned outbox row");
      partial = false;
    }

    const providerMessageId = `wamid.e2e-${uniqueSuffix("out")}`;
    const tick = await runOutboxTick({
      batchSize: 500,
      lockSeconds: 60,
      workerId: "e2e-A",
      outboxIds,
      sendFn: async () => fakeSent(providerMessageId)
    });
    assertTrue(tick.sent >= 1, `worker must send, got ${JSON.stringify(tick)}`);
    evidence.push(`worker tick: sent=${tick.sent}`);

    const executions = await count("SELECT COUNT(*) AS total FROM crm_action_executions WHERE outbox_message_id IN (" + outboxIds.map(() => "?").join(",") + ")", outboxIds);
    const outcomes = await count("SELECT COUNT(*) AS total FROM crm_action_outcomes WHERE outbox_message_id IN (" + outboxIds.map(() => "?").join(",") + ") AND outcome_type = 'sent'", outboxIds);
    assertTrue(executions >= 1 && outcomes >= 1, "execution and sent outcome recorded");
    evidence.push(`execution rows=${executions}, sent outcomes=${outcomes}`);

    for (const status of ["sent", "delivered", "read"] as const) {
      const applied = await applyMetaDeliveryStatus({ providerMessageId, status, occurredAt: new Date().toISOString(), rawPayload: { simulated: true } });
      assertTrue(applied.ok, `delivery status ${status} applied`);
    }
    const readCount = await count("SELECT COUNT(*) AS total FROM conversation_message WHERE provider_message_id = ? AND status = 'read'", [providerMessageId]);
    assertTrue(readCount === 1, "outbound message reached status=read");
    evidence.push("delivery projection sent→delivered→read applied monotonically");

    const thread = await loadConversationThread(conversationId);
    const inboundMsg = thread.messages.find((m) => m.origin === "customer");
    const outboundMsg = thread.messages.find((m) => m.origin === "ai" && m.providerMessageId === providerMessageId);
    assertTrue(inboundMsg && outboundMsg, "timeline shows customer inbound and AI outbound");
    evidence.push(`timeline: ${thread.messages.length} messages, AI outbound state=${outboundMsg!.state}`);

    return partial ? "PARTIAL" : "PASS";
  });

  // ============================ ESCENARIO B ============================
  await scenario("B", "multivuelta: reutiliza conversación, sin duplicados", async (evidence) => {
    const { waId, phoneNumberId } = newIdentity();
    if (!SKIP_LLM) process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = waId;

    const first = await inject(waId, phoneNumberId, "Hola, busco una trotadora para casa");
    const second = await inject(waId, phoneNumberId, "Mi presupuesto es 800.000 y tengo 2x2 metros de espacio");
    assertTrue(!first.duplicate && !second.duplicate, "both inbounds persist");
    assertTrue(first.conversationId === second.conversationId, "same conversation reused");
    evidence.push(`conversation reused: ${first.conversationId}`);

    const conversations = await count("SELECT COUNT(*) AS total FROM conversation WHERE external_contact_id = ?", [waId]);
    assertTrue(conversations === 1, `exactly one conversation, got ${conversations}`);

    const inboundCount = await count("SELECT COUNT(*) AS total FROM conversation_message WHERE conversation_id = ? AND direction = 'inbound'", [first.conversationId as number]);
    assertTrue(inboundCount === 2, `two inbound messages, got ${inboundCount}`);
    evidence.push(`inbound messages=2, conversations=1`);

    if (!SKIP_LLM) {
      const opportunities = await safeQueryRows<{ id: number; status: string; conversation_case_id: string | null }>(
        "SELECT id, status, conversation_case_id FROM crm_opportunities WHERE conversation_case_id = ?",
        [String(first.conversationId)]
      );
      assertTrue(opportunities.ok && opportunities.rows.length >= 1, "opportunity linked to conversation");
      evidence.push(`opportunity linked: ${JSON.stringify(opportunities.ok ? opportunities.rows.map((o) => ({ id: o.id, status: o.status })) : [])}`);
      const decisions = await count(
        "SELECT COUNT(*) AS total FROM crm_agent_decisions d INNER JOIN crm_opportunities o ON o.id = d.opportunity_id WHERE o.conversation_case_id = ?",
        [String(first.conversationId)]
      );
      evidence.push(`decisions across turns=${decisions}`);
      assertTrue(decisions >= 1, "at least one auditable decision");
    } else {
      evidence.push("LLM skipped: continuity asserted at persistence level only");
    }

    return "PASS";
  });

  // ============================ ESCENARIO C ============================
  await scenario("C", "operador toma control, responde manual y devuelve control", async (evidence) => {
    const { waId, phoneNumberId } = newIdentity();
    const inbound = await inject(waId, phoneNumberId, "Quiero hablar con una persona");
    const conversationId = inbound.conversationId as number;
    const publicId = inbound.conversationPublicId as string;
    await seedOutbox({ waId, phoneNumberId, conversationId }, "Respuesta IA pendiente que debe cancelarse");

    const take = await applyConversationControl({ conversationPublicId: publicId, action: "take", operatorName: "Operador E2E" });
    assertTrue(take.ok && take.controlMode === "human", "takeover succeeds");
    assertTrue(take.ok && take.cancelledOutbox === 1, "pending auto-response cancelled atomically");
    evidence.push(`takeover: controlMode=human, cancelledOutbox=${take.ok ? take.cancelledOutbox : 0}`);

    const manualPmid = `wamid.e2e-${uniqueSuffix("manual")}`;
    const reply = await sendConversationManualReply({
      conversationPublicId: publicId,
      text: "Hola, te atiende el equipo de PesasChile.",
      operatorName: "Operador E2E",
      sendFn: async () => fakeSent(manualPmid)
    });
    assertTrue(reply.ok && reply.status === "sent", "manual reply sent");
    evidence.push(`manual reply sent: provider_message_id=${manualPmid}`);

    const thread = await loadConversationThread(conversationId);
    const operatorMsg = thread.messages.find((m) => m.origin === "operator");
    assertTrue(operatorMsg, "timeline identifies the operator message");
    evidence.push(`timeline operator message state=${operatorMsg!.state}`);

    const release = await applyConversationControl({ conversationPublicId: publicId, action: "release", operatorName: "Operador E2E" });
    assertTrue(release.ok && release.controlMode === "ai_autonomous", "control returned to AI");
    evidence.push("release: controlMode=ai_autonomous");

    return "PASS";
  });

  // ============================ ESCENARIO D ============================
  await scenario("D", "carrera IA vs operador: el mensaje incompatible no se envía", async (evidence) => {
    const { waId, phoneNumberId } = newIdentity();
    const inbound = await inject(waId, phoneNumberId, "Hola");
    const conversationId = inbound.conversationId as number;
    const outboxId = await seedOutbox({ waId, phoneNumberId, conversationId }, "Respuesta IA planificada antes del takeover");

    // Worst case: ownership flips WITHOUT the atomic outbox cancel (simulates
    // a takeover racing between the plan and the worker claim).
    await safeQueryRows("UPDATE conversation SET human_owner_active = 1, ai_enabled = 0 WHERE id = ?", [conversationId]);

    let sendCalls = 0;
    const tick = await runOutboxTick({
      batchSize: 500,
      lockSeconds: 60,
      workerId: "e2e-D",
      outboxIds: [outboxId],
      sendFn: async () => {
        sendCalls++;
        return fakeSent("wamid.should-not-send");
      }
    });
    assertTrue(sendCalls === 0, "provider was never called");
    assertTrue(tick.cancelled === 1, "row cancelled by pre-send re-validation");

    const row = await safeQueryRows<{ status: string; error_code: string }>(
      "SELECT status, error_code FROM brain_message_outbox WHERE id = ?",
      [outboxId]
    );
    assertTrue(row.ok && row.rows[0].status === "cancelled" && row.rows[0].error_code === "ownership_revoked", "reason recorded");
    evidence.push(`outbox row cancelled with error_code=ownership_revoked, provider calls=0`);

    return "PASS";
  });

  // ============================ ESCENARIO E ============================
  await scenario("E", "follow-up proactivo: ejecuta, no duplica, se cancela si el cliente responde", async (evidence) => {
    const { waId, phoneNumberId } = newIdentity();
    const inbound = await inject(waId, phoneNumberId, "Lo voy a pensar, gracias");
    const conversationId = inbound.conversationId as number;

    // createdAtOffsetSeconds controls whether messages already in the thread
    // count as "replied since schedule" at 1-second DATETIME precision:
    // +2s puts the schedule strictly after the initial inbound (no false
    // cancel); -5s puts it strictly before the reply we inject afterwards.
    async function seedFollowUp(label: string, createdAtOffsetSeconds: number) {
      const actionId = `e2e-followup-${uniqueSuffix(label)}`;
      const insert = await safeQueryRows(
        `INSERT INTO crm_agent_actions (action_id, idempotency_key, conversation_case_id, wa_id, channel, action_type, status, risk_level, approval_requirement, draft_message, scheduled_for, policy_status, created_at)
          VALUES (?, ?, ?, ?, 'whatsapp', 'schedule_followup', 'planned', 'low', 'none', ?, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE), 'allowed', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
        [actionId, `idem-${actionId}`, conversationId, waId, `Seguimiento ${label}`, createdAtOffsetSeconds]
      );
      assertTrue(insert.ok, "follow-up seeded");
      return actionId;
    }

    // (1) due follow-up executes through the cycle runner exactly once
    const actionA = await seedFollowUp("run", 2);
    let cycleCalls = 0;
    const fakeCycle = async () => {
      cycleCalls++;
      return { ran: true, shadow: null, loop: null, bridge: null, warnings: [] };
    };
    const tick1 = await runFollowupTick({ limit: 20, actionIds: [actionA], cycleRunner: fakeCycle as never });
    assertTrue(tick1.executed.includes(actionA) && cycleCalls === 1, "follow-up executed once");

    // (2) idempotent: a second tick finds nothing for the same action
    const tick2 = await runFollowupTick({ limit: 20, actionIds: [actionA], cycleRunner: fakeCycle as never });
    assertTrue(tick2.processed === 0 && cycleCalls === 1, "no duplicate execution");
    evidence.push("due follow-up executed exactly once (CAS planned→executing)");

    // (3) customer replies → a due follow-up is cancelled instead of executed
    const actionB = await seedFollowUp("cancel", -5);
    await inject(waId, phoneNumberId, "Ya me decidí, lo quiero");
    const tick3 = await runFollowupTick({ limit: 20, actionIds: [actionB], cycleRunner: fakeCycle as never });
    assertTrue(tick3.cancelled.some((c) => c.actionId === actionB && c.reason === "customer_replied_since_schedule"), "cancelled on reply");
    assertTrue(cycleCalls === 1, "no cycle run for the cancelled follow-up");
    evidence.push("follow-up cancelled with reason=customer_replied_since_schedule after inbound");

    return "PASS";
  });

  // ============================ ESCENARIO F ============================
  await scenario("F", "webhook duplicado: un solo mensaje, un solo evento", async (evidence) => {
    const { waId, phoneNumberId } = newIdentity();
    const providerMessageId = `wamid.e2e-${uniqueSuffix("dup")}`;
    const first = await inject(waId, phoneNumberId, "Hola, precio de mancuernas?", providerMessageId);
    const duplicate = await inject(waId, phoneNumberId, "Hola, precio de mancuernas?", providerMessageId);
    assertTrue(!first.duplicate && duplicate.duplicate, "second webhook detected as duplicate");

    const messages = await count("SELECT COUNT(*) AS total FROM conversation_message WHERE provider = 'meta' AND provider_message_id = ?", [providerMessageId]);
    assertTrue(messages === 1, `one message, got ${messages}`);
    const events = await count("SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?", [`meta:whatsapp:inbound:${providerMessageId}`]);
    assertTrue(events === 1, `one commercial event, got ${events}`);
    evidence.push(`duplicate webhook → messages=1, commercial_events=1`);

    return "PASS";
  });

  // ============================ ESCENARIO G ============================
  await scenario("G", "fallo temporal del proveedor: retry con backoff y escalamiento terminal", async (evidence) => {
    const { waId, phoneNumberId } = newIdentity();
    const inbound = await inject(waId, phoneNumberId, "Hola");
    const conversationId = inbound.conversationId as number;

    // Retry path
    const retryId = await seedOutbox({ waId, phoneNumberId, conversationId }, "Mensaje con fallo temporal");
    let attempt = 0;
    const flakySend = async () => {
      attempt++;
      return attempt === 1 ? fakeTransientFailure() : fakeSent(`wamid.e2e-${uniqueSuffix("retryok")}`);
    };
    const tick1 = await runOutboxTick({ batchSize: 500, lockSeconds: 60, workerId: "e2e-G", outboxIds: [retryId], sendFn: flakySend });
    assertTrue(tick1.retried === 1, "transient failure scheduled for retry");
    await safeQueryRows("UPDATE brain_message_outbox SET next_attempt_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?", [retryId]);
    const tick2 = await runOutboxTick({ batchSize: 500, lockSeconds: 60, workerId: "e2e-G", outboxIds: [retryId], sendFn: flakySend });
    assertTrue(tick2.sent === 1, "retry succeeded, message not lost");
    evidence.push("HTTP 503 → retried with backoff → sent on attempt 2");

    // Exhaustion path
    const failId = await seedOutbox({ waId, phoneNumberId, conversationId }, "Mensaje con fallo terminal");
    const tick3 = await runOutboxTick({ batchSize: 500, lockSeconds: 60, workerId: "e2e-G", outboxIds: [failId], maxAttempts: 1, sendFn: async () => fakeTransientFailure() });
    assertTrue(tick3.failed === 1, "attempt limit produces terminal failure");
    const failedOutcomes = await count("SELECT COUNT(*) AS total FROM crm_action_outcomes WHERE outbox_message_id = ? AND outcome_type = 'failed'", [failId]);
    assertTrue(failedOutcomes === 1, "failed outcome recorded for escalation");
    evidence.push("attempt limit reached → status=failed + failed outcome + escalation audit");

    return "PASS";
  });

  // ============================ ESCENARIO H ============================
  await scenario("H", "ventana WhatsApp cerrada: backend bloquea texto libre", async (evidence) => {
    const { waId, phoneNumberId } = newIdentity();
    const inbound = await inject(waId, phoneNumberId, "Hola");
    const conversationId = inbound.conversationId as number;
    const publicId = inbound.conversationPublicId as string;
    const outboxId = await seedOutbox({ waId, phoneNumberId, conversationId }, "Respuesta IA fuera de ventana");
    await safeQueryRows("UPDATE conversation SET last_inbound_at = DATE_SUB(NOW(3), INTERVAL 25 HOUR) WHERE id = ?", [conversationId]);

    const reply = await sendConversationManualReply({ conversationPublicId: publicId, text: "hola", sendFn: async () => fakeSent("wamid.no") });
    assertTrue(!reply.ok && reply.code === "window_closed", "manual free text rejected");

    let sendCalls = 0;
    await runOutboxTick({
      batchSize: 500,
      lockSeconds: 60,
      workerId: "e2e-H",
      outboxIds: [outboxId],
      sendFn: async () => {
        sendCalls++;
        return fakeSent("wamid.no");
      }
    });
    const row = await safeQueryRows<{ status: string; error_code: string }>("SELECT status, error_code FROM brain_message_outbox WHERE id = ?", [outboxId]);
    assertTrue(sendCalls === 0 && row.ok && row.rows[0].status === "cancelled" && row.rows[0].error_code === "window_closed", "AI free text blocked");
    evidence.push("manual reply → 409 window_closed; AI outbox row → cancelled window_closed; provider calls=0");

    return "PASS";
  });

  // ============================ ESCENARIO I ============================
  await scenario("I", "cierre y reapertura", async (evidence) => {
    const { waId, phoneNumberId } = newIdentity();
    const inbound = await inject(waId, phoneNumberId, "Hola");
    const publicId = inbound.conversationPublicId as string;
    const conversationId = inbound.conversationId as number;

    const close = await applyConversationControl({ conversationPublicId: publicId, action: "close" });
    assertTrue(close.ok && close.status === "closed", "closed");

    const reply = await sendConversationManualReply({ conversationPublicId: publicId, text: "hola", sendFn: async () => fakeSent("wamid.no") });
    assertTrue(!reply.ok && reply.code === "conversation_closed", "sends blocked while closed");

    const reopenInbound = await inject(waId, phoneNumberId, "Volví");
    assertTrue(!reopenInbound.duplicate && reopenInbound.conversationId === conversationId, "same conversation");
    const status = await safeQueryRows<{ status: string }>("SELECT status FROM conversation WHERE id = ?", [conversationId]);
    assertTrue(status.ok && status.rows[0].status === "open", "reopened by new inbound");
    evidence.push("close → sends blocked → new inbound reopens the same conversation");

    return "PASS";
  });

  // ============================ ESCENARIO J ============================
  await scenario("J", "datos incompletos: la conversación funciona sin cliente/oportunidad/acciones", async (evidence) => {
    const { waId, phoneNumberId } = newIdentity();
    // This scenario is about MISSING data: inject without the autonomous cycle
    // so no opportunity/decision is created for the conversation.
    const savedFlags = {
      BRAIN_SALES_AGENT_ENABLED: process.env.BRAIN_SALES_AGENT_ENABLED,
      BRAIN_COMMERCIAL_SHADOW_ENABLED: process.env.BRAIN_COMMERCIAL_SHADOW_ENABLED,
      BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: process.env.BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED
    };
    Object.assign(process.env, {
      BRAIN_SALES_AGENT_ENABLED: "false",
      BRAIN_COMMERCIAL_SHADOW_ENABLED: "false",
      BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "false"
    });
    const inbound = await inject(waId, phoneNumberId, "Hola");
    for (const [key, value] of Object.entries(savedFlags)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const conversationId = inbound.conversationId as number;
    const publicId = inbound.conversationPublicId as string;

    // Simulate an unresolved customer.
    await safeQueryRows("UPDATE conversation SET customer_id = NULL WHERE id = ?", [conversationId]);

    const detail = await loadNativeConversationDetailByPublicId(publicId);
    assertTrue(detail !== null, "detail loads");
    assertTrue(detail!.customer === null, "no customer resolved");
    assertTrue(detail!.opportunity === null, "no opportunity");

    const thread = await loadConversationThread(conversationId);
    assertTrue(thread.error === null && thread.messages.length >= 1, "thread loads");

    const autonomous = await loadConversationAutonomousState(conversationId);
    assertTrue(autonomous.error === null && autonomous.actions.length === 0, "autonomous state degrades to empty");
    evidence.push("detail/thread/autonomous all load with customer=null, opportunity=null, actions=0");

    return "PASS";
  });

  // ============================ REPORT ============================
  console.log("\n================ E2E AUTONOMOUS HARNESS ================");
  console.log(`mode: ${SKIP_LLM ? "deterministic (--skip-llm)" : "live LLM cycle"}`);
  for (const result of results) {
    console.log(`\n[${result.id}] ${result.status} — ${result.name}`);
    for (const line of result.evidence) console.log(`    • ${line}`);
  }
  const failed = results.filter((r) => r.status === "FAIL");
  const partial = results.filter((r) => r.status === "PARTIAL");
  console.log(`\nTOTAL: ${results.length} | PASS: ${results.filter((r) => r.status === "PASS").length} | PARTIAL: ${partial.length} | FAIL: ${failed.length}`);
  console.log("No real Meta API call was made during this run (BRAIN_META_SEND_ENABLED=false + fake transport).");

  await getPool().end();
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[e2e] fatal:", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows, safeExecute, safeQueryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import { runFollowupTick } from "@/lib/brain/commercial/followup/runFollowupTick";
import {
  archiveConfiguration,
  createDraftConfiguration,
  loadPublishedPesasChileConfiguration,
  publishDraftConfiguration,
  type SalesAgentFollowUpConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration";
import type { SalesAgentProvider, SalesAgentProviderRequest } from "@/lib/brain/commercial/sales-agent/runtimeTypes";

/**
 * ACS-R1-05.1-T02.3D review correction, decision 5. Direct validation
 * against the REAL runtime chain, never a shortcut through
 * resolveFollowUpSchedulingContext/revalidateFollowUpConfiguration in
 * isolation:
 *
 *   inbound -> runNativeAutonomousCycle (real operational loop, scripted
 *   provider standing in for the live LLM - same convention as
 *   tests/native/catalogConversationFlow.test.ts, no live network/LLM
 *   credentials in this environment) -> propose_followup ->
 *   runCommercialExecutionBridge persists a REAL crm_agent_actions row
 *   (scheduled_for, sequence key, config snapshot all non-null and already
 *   due by construction) -> the REAL runFollowupTick claims and re-enters
 *   the REAL runNativeAutonomousCycle (Agent Tool Loop, not a fake
 *   cycleRunner) -> a REAL brain_message_outbox row lands as 'planned',
 *   never 'sent'.
 *
 * BRAIN_META_SEND_ENABLED/BRAIN_OUTBOX_WORKER_ENABLED/
 * BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND stay false throughout - nothing in
 * this test ever reaches a real WhatsApp send.
 */

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "crm_test",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function toMysqlDateTime(value: Date) {
  return value.toISOString().slice(0, 23).replace("T", " ");
}

// Same ordering trick as catalogConversationFlow.test.ts: the conversation
// is seeded (processNativeWhatsAppInbound) BEFORE these flags are switched
// on, so seeding never triggers an automatic, un-injectable real cycle run
// with the default (live) provider - every turn below is driven manually,
// with the scripted provider explicitly injected.
const CYCLE_ENV = {
  BRAIN_COMMERCIAL_SHADOW_ENABLED: "true",
  BRAIN_COMMERCIAL_RUNTIME_ENABLED: "true",
  BRAIN_COMMERCIAL_POLICY_ENABLED: "true",
  BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER: "true",
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "true",
  BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED: "true",
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false",
  // The part catalogConversationFlow.test.ts deliberately leaves off - real
  // persistence of the decided action, real execution gate, real outbox
  // bridge - is exactly what decision 5 requires proven end-to-end.
  BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
  BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
  BRAIN_EXECUTION_GATE_ENABLED: "true",
  BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
  BRAIN_AUTONOMOUS_REPLY_ENABLED: "true",
  // Never a real send, at any layer, for the whole test.
  BRAIN_META_SEND_ENABLED: "false",
  BRAIN_OUTBOX_WORKER_ENABLED: "false",
  BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND: "false"
};

async function seedConversation(occurredAt: Date) {
  const waId = `5699${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;
  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("direct-validation")}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Validacion Directa",
    messageType: "text",
    text: "Hola, quiero cotizar una jaula de entrenamiento",
    occurredAt: occurredAt.toISOString(),
    rawPayload: {}
  });
  assert.ok(result.conversationId);
  assert.ok(result.conversationPublicId);
  assert.ok(result.messageId);

  const occurredAtSql = toMysqlDateTime(occurredAt);
  const persistedInbound = await safeExecute(
    `UPDATE conversation_message
      SET provider_timestamp = ?, created_at = ?, updated_at = ?
      WHERE id = ? AND direction = 'inbound'`,
    [occurredAtSql, occurredAtSql, occurredAtSql, result.messageId]
  );
  assert.ok(persistedInbound.ok && persistedInbound.affectedRows === 1, persistedInbound.ok ? "expected inbound timestamp update" : persistedInbound.error);

  return { ...result, waId, phoneNumberId };
}

type TurnScript = { messageIntent: "answer" | "clarify" | "follow_up"; draftText: string };

function buildResponseProposal(messageIntent: TurnScript["messageIntent"], draftText: string) {
  return {
    messageIntent,
    draftText,
    language: "es",
    tone: "friendly",
    questions: [],
    claims: [],
    disclaimers: [],
    requiresApproval: "none" as const,
    blockedClaims: [],
    confidence: "medium" as const
  };
}

/** Same scripted-provider convention as catalogConversationFlow.test.ts - stands in for the live LLM (no network/API-key dependency in this environment), while every other layer of the runtime runs for real. */
function createScriptedProvider(scripts: TurnScript[]): SalesAgentProvider {
  let callIndex = 0;
  return {
    name: "test-direct-validation-provider",
    version: "test.v1",
    async invoke(request: SalesAgentProviderRequest) {
      const script = scripts[Math.min(callIndex, scripts.length - 1)];
      callIndex += 1;

      const rawOutput = {
        runId: request.correlationId ?? "fake-run-id",
        contractVersion: request.contractVersion,
        outcome: "response_proposed",
        analysis: {
          summary: "Turno de validacion directa.",
          qualificationState: "qualified",
          customerReadiness: "ready",
          productFit: "good",
          confidence: "high",
          riskLevel: "low",
          reasonCodes: ["customer_message_present"]
        },
        decision: {
          type: "respond_now",
          reason: "Hay contexto suficiente para responder.",
          confidence: "high",
          riskLevel: "low",
          requiresApproval: "none",
          errorCode: "none",
          reasonCodes: ["customer_message_present"],
          policyTags: ["commercial_reply"]
        },
        shouldRespondNow: true,
        shouldRequestTool: false,
        shouldRequestHuman: false,
        shouldEvaluateFollowUp: script.messageIntent === "follow_up",
        proposedActions: [],
        toolRequests: [],
        entityProposals: [],
        responseProposal: buildResponseProposal(script.messageIntent, script.draftText),
        evidence: [
          {
            source: "customer_message",
            summary: "Mensaje del cliente en este turno.",
            verified: true,
            confidence: "high",
            reference: "latest_inbound_message",
            capturedAt: new Date(0).toISOString(),
            expiresAt: null
          }
        ],
        policyAssessment: {
          status: "allowed",
          blocked: false,
          reason: "Sin bloqueo de politica.",
          confidence: "high",
          riskLevel: "low",
          approvalRequirement: "none",
          errorCode: "none",
          reasonCodes: [],
          policyTags: ["commercial_reply"]
        },
        warnings: [],
        rationale: {
          summary: "Turno simulado deterministico.",
          evidence: ["Mensaje inbound del cliente."],
          counterEvidence: [],
          assumptions: [],
          riskFlags: [],
          missingInformation: [],
          policyRulesApplied: []
        },
        metadata: {}
      };

      return {
        rawOutput,
        model: "test-model",
        inputTokens: 32,
        outputTokens: 32,
        estimatedCost: 0,
        providerRequestId: `test-provider-request-${callIndex}`,
        finishReason: "stop",
        metadata: {}
      };
    }
  };
}

async function clearActivePublication() {
  const active = await loadPublishedPesasChileConfiguration();
  if (active) await archiveConfiguration(active.id);
}

const PROMPT_FIELDS = {
  agentName: "Valentina",
  companyName: "PesasChile",
  role: "Asesora comercial",
  companyDescription: "Vendemos equipamiento de gimnasio.",
  customInstructions: "",
  prohibitedPhrases: []
};

async function publishFollowUpConfiguration(followUpConfiguration: SalesAgentFollowUpConfiguration) {
  await clearActivePublication();
  const draft = await createDraftConfiguration({
    name: `direct-validation-${uniqueSuffix("cfg")}`,
    configuration: { ...PROMPT_FIELDS, followUpConfiguration },
    createdBy: "test-suite"
  });
  return publishDraftConfiguration({ id: draft.id });
}

// Always-open window (every hour, every day) - this test is about proving
// the real persistence/worker/outbox chain, not re-testing DST/window edge
// cases (already covered by computeFollowUpSchedule.test.ts).
const ALWAYS_OPEN_CONFIG: SalesAgentFollowUpConfiguration = {
  enabled: true,
  maxAttempts: 3,
  attemptDelaysMinutes: [5, 60, 120],
  allowedWindow: { timezone: "America/Santiago", startHour: 0, endHour: 23, allowedWeekdays: [0, 1, 2, 3, 4, 5, 6] },
  maxOpportunityAgeDays: 30
};

test("direct runtime validation: real inbound -> real model decision -> real due scheduled row -> real worker -> real Agent Tool Loop -> real outbox planned row", async () => {
  const nowMs = Date.now();
  const inboundAt = new Date(nowMs - 20 * 60_000);
  const turn1At = new Date(nowMs - 19 * 60_000);
  const turn2At = new Date(nowMs - 18 * 60_000);

  const published = await publishFollowUpConfiguration(ALWAYS_OPEN_CONFIG);
  const seeded = await seedConversation(inboundAt);

  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV);

  try {
    const scheduleProvider = createScriptedProvider([
      { messageIntent: "answer", draftText: "Claro, cuentame que necesitas y te ayudo a cotizar." },
      { messageIntent: "follow_up", draftText: "Sin problema, te escribo en unos dias para ver como sigues." }
    ]);

    const turn1 = await runNativeAutonomousCycle({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId ?? null,
      messageText: "Hola, quiero cotizar una jaula de entrenamiento",
      correlationId: uniqueSuffix("corr-turn1"),
      currentTime: turn1At.toISOString(),
      provider: scheduleProvider
    });
    assert.equal(turn1.ran, true, "turn 1 must run through the real operational loop");

    const turn2 = await runNativeAutonomousCycle({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: null,
      messageText: "Lo voy a pensar, gracias",
      correlationId: uniqueSuffix("corr-turn2"),
      currentTime: turn2At.toISOString(),
      provider: scheduleProvider
    });

    // Real model decision: the operational loop itself selected propose_followup.
    assert.equal(turn2.loop?.selectedNextAction?.type, "propose_followup", "the real model/loop decision must be to propose a follow-up");
    const opportunityId = turn2.loop?.resultingState?.opportunityId;
    assert.ok(opportunityId, "expected a real opportunity id to exist after turn 2");

    // Real persisted row: never a shortcut through resolveFollowUpSchedulingContext directly.
    const rowResult = await safeQueryRows<{
      action_id: string;
      status: string;
      scheduled_for: string | null;
      followup_sequence_key: string | null;
      followup_configuration_source: string | null;
      followup_configuration_id: number | null;
      followup_configuration_version: number | null;
      followup_configuration_hash: string | null;
    }>(
      `SELECT action_id, status, scheduled_for, followup_sequence_key, followup_configuration_source, followup_configuration_id, followup_configuration_version, followup_configuration_hash
        FROM crm_agent_actions
        WHERE action_type = 'schedule_followup' AND wa_id = ?
        ORDER BY id DESC LIMIT 1`,
      [seeded.waId]
    );
    assert.ok(rowResult.ok && rowResult.rows[0], "expected a real schedule_followup row persisted by the real execution bridge");
    const followUpRow = rowResult.rows[0]!;

    assert.ok(followUpRow.scheduled_for, "scheduled_for must be real and non-null - the exact defect T02.3D fixed");
    assert.ok(followUpRow.followup_sequence_key, "followup_sequence_key must be populated by the real pipeline");
    assert.equal(followUpRow.followup_configuration_source, "published");
    assert.equal(followUpRow.followup_configuration_id, published.id);
    assert.equal(followUpRow.followup_configuration_version, published.version);
    assert.equal(followUpRow.followup_configuration_hash, published.configurationHash);
    assert.ok(
      ["planned", "requires_review", "proposed"].includes(followUpRow.status),
      `expected a live, not-yet-executed status, got ${followUpRow.status}`
    );

    const outboxCountBefore = await queryRows<{ count: number }>(
      "SELECT COUNT(*) as count FROM brain_message_outbox WHERE conversation_case_id = ?",
      [seeded.conversationId]
    );

    // The REAL worker, re-entering the REAL Agent Tool Loop - never a fake
    // cycleRunner. Only the provider is injected (same reason as above: no
    // live LLM credentials in this environment).
    const replyProvider = createScriptedProvider([{ messageIntent: "answer", draftText: "Hola de nuevo! Seguimos con tu cotizacion?" }]);
    const tick = await runFollowupTick({
      limit: 10,
      actionIds: [followUpRow.action_id],
      cycleRunner: (input) => runNativeAutonomousCycle({ ...input, provider: replyProvider })
    });

    assert.deepEqual(tick.executed, [followUpRow.action_id], "the real worker must execute the real due follow-up row");
    const finalRow = await safeQueryRows<{ status: string }>("SELECT status FROM crm_agent_actions WHERE action_id = ? LIMIT 1", [
      followUpRow.action_id
    ]);
    assert.equal(finalRow.ok && finalRow.rows[0]?.status, "executed");

    // Real outbox row, planned - never sent (BRAIN_META_SEND_ENABLED/
    // BRAIN_OUTBOX_WORKER_ENABLED/BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND all
    // false throughout this whole test).
    const outboxRows = await queryRows<{ status: string; sent_at: string | null }>(
      "SELECT status, sent_at FROM brain_message_outbox WHERE conversation_case_id = ? ORDER BY id DESC LIMIT 5",
      [seeded.conversationId]
    );
    assert.ok(outboxRows.length > Number(outboxCountBefore[0].count), "the follow-up re-entry must produce at least one new real outbox row");
    const newOutboxRow = outboxRows[0];
    assert.equal(newOutboxRow.status, "planned");
    assert.equal(newOutboxRow.sent_at, null, "must never actually send - BRAIN_META_SEND_ENABLED/BRAIN_OUTBOX_WORKER_ENABLED are false");
  } finally {
    process.env = previousEnv;
  }
});

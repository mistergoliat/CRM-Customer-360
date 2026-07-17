import assert from "node:assert/strict";
import test, { after } from "node:test";

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
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
  BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
  BRAIN_EXECUTION_GATE_ENABLED: "true",
  BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
  BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "true",
  BRAIN_AUTONOMOUS_REPLY_ENABLED: "true"
});

import { getPool, queryRows, safeExecute } from "@/lib/db";
import { dispatchFallbackAction, buildContinuityFallbackIdempotencyKey } from "@/lib/brain/commercial/continuity/dispatchFallbackAction";
import { terminalizeBlockedAgentAction } from "@/lib/brain/commercial/continuity/terminalizeBlockedAgentAction";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { ensureAutonomousSalesTurnContinuity } from "@/lib/brain/commercial/continuity";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import type { SalesAgentProvider, SalesAgentProviderRequest } from "@/lib/brain/commercial/sales-agent/runtimeTypes";

/**
 * ACS-R1-05-T06.2 (P2 correction). Real concurrent execution coverage for
 * continuity - NOT sequential replay (see continuityFallback.test.ts /
 * ensureAutonomousSalesTurnContinuity.test.ts for that). Every test here
 * fires genuine parallel operations with Promise.all against the real
 * mysql2 connection pool (connectionLimit > 1 by default - see lib/db.ts),
 * so both calls can genuinely race at the storage-engine level rather than
 * being serialized onto a single blocked connection or an in-memory fake.
 *
 * Environment limitation (documented, not hidden): MariaDB was not
 * reachable in the implementation environment for this correction (no local
 * MariaDB service, Docker Desktop daemon unreachable - see the T06.2
 * correction report). This file could not be executed here and its
 * concurrency guarantees are therefore DB verification pending, not
 * validated - do not treat a green run of this suite elsewhere as
 * equivalent to having been exercised in this environment.
 */

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

test("ACS-R1-05-T06.2 (P2): two concurrent dispatchFallbackAction calls for the identical fallback resolve to exactly one action row and at most one outbox row", async () => {
  const waId = `5693${String(Date.now()).slice(-8)}`;
  process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = waId;
  const conversationId = Date.now() % 1000000;
  const inboundMessageId = uniqueSuffix("concurrent-msg");
  const currentTime = new Date().toISOString();

  const input = {
    conversationId,
    conversationCaseId: conversationId,
    opportunityId: null,
    decisionId: null,
    waId,
    inboundMessageId,
    currentTime,
    fallbackClass: "catalog_unavailable" as const,
    message: "Ya tengo registrado lo que buscas. No pude consultar el catálogo real ahora, sigo apenas pueda.",
    humanOwnerActive: false,
    aiBlocked: false,
    caseStatus: "open"
  };

  const [first, second] = await Promise.all([dispatchFallbackAction(input), dispatchFallbackAction(input)]);

  assert.equal(first.attempted, true);
  assert.equal(second.attempted, true);
  assert.equal(first.action?.actionId, second.action?.actionId, "both concurrent calls must resolve to the same idempotency-keyed action");

  const idempotencyKey = buildContinuityFallbackIdempotencyKey(conversationId, inboundMessageId, "catalog_unavailable");
  const actionRows = await queryRows<Record<string, unknown>>("SELECT id, outbox_message_id FROM crm_agent_actions WHERE idempotency_key = ?", [idempotencyKey]);
  assert.equal(actionRows.length, 1, "exactly one action row must exist after two genuinely concurrent dispatches");

  if (first.outboxWritten || second.outboxWritten) {
    const outboxId = actionRows[0].outbox_message_id;
    assert.ok(outboxId !== null, "the single action row must carry the outbox reference");
    const outboxRows = await queryRows<Record<string, unknown>>("SELECT id FROM brain_message_outbox WHERE id = ?", [outboxId]);
    assert.equal(outboxRows.length, 1, "exactly one outbox row must exist, never two, for two concurrent dispatches of the same logical fallback");
  }
});

test("ACS-R1-05-T06.2 (P2): two concurrent terminalizeBlockedAgentAction calls on the same action - exactly one CAS winner, final status applied exactly once", async () => {
  const waId = `5692${String(Date.now()).slice(-8)}`;
  const conversationId = (Date.now() + 1) % 1000000;

  const previousGate = process.env.BRAIN_EXECUTION_GATE_ENABLED;
  process.env.BRAIN_EXECUTION_GATE_ENABLED = "false";
  const seeded = await dispatchFallbackAction({
    conversationId,
    conversationCaseId: conversationId,
    opportunityId: null,
    decisionId: null,
    waId,
    inboundMessageId: uniqueSuffix("concurrent-stuck"),
    currentTime: new Date().toISOString(),
    fallbackClass: "invalid_model_result",
    message: "mensaje de prueba para quedar en proposed",
    humanOwnerActive: false,
    aiBlocked: false,
    caseStatus: "open"
  });
  process.env.BRAIN_EXECUTION_GATE_ENABLED = previousGate;

  assert.ok(seeded.action?.actionId, "expected a seeded action id");
  const actionId = seeded.action!.actionId;

  const rowsBefore = await queryRows<Record<string, unknown>>("SELECT status FROM crm_agent_actions WHERE action_id = ?", [actionId]);
  assert.equal(rowsBefore[0]?.status, "proposed");

  const [resultA, resultB] = await Promise.all([
    terminalizeBlockedAgentAction({ actionId, failureReason: "concurrent_block_a", blockReasons: ["unsafe_payload"] }),
    terminalizeBlockedAgentAction({ actionId, failureReason: "concurrent_block_b", blockReasons: ["unsupported_commercial_commitment"] })
  ]);

  const winners = [resultA, resultB].filter((result) => result.terminalized === true);
  assert.equal(winners.length, 1, "exactly one of the two concurrent CAS attempts must win - never zero, never both");

  const rowsAfter = await queryRows<Record<string, unknown>>("SELECT status FROM crm_agent_actions WHERE action_id = ?", [actionId]);
  assert.equal(rowsAfter[0]?.status, "blocked", "the row must land on 'blocked' exactly once regardless of which concurrent call won the race");
});

/** A provider whose draft trips a real technical sandbox block (unresolved placeholder), never the removed lexical check. */
function createUnsafeDraftProvider(): SalesAgentProvider {
  return {
    name: "test-unsafe-draft-provider-concurrency",
    version: "test.v1",
    async invoke(request: SalesAgentProviderRequest) {
      const rawOutput = {
        runId: request.correlationId ?? "fake-run-id",
        contractVersion: request.contractVersion,
        outcome: "response_proposed",
        analysis: {
          summary: "Cliente busca jaula de potencia con presupuesto definido.",
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
        shouldEvaluateFollowUp: false,
        proposedActions: [],
        toolRequests: [],
        entityProposals: [],
        responseProposal: {
          messageIntent: "answer",
          draftText: "Hola {{customer_first_name}}, ya reviso las opciones para ti.",
          language: "es",
          tone: "friendly",
          questions: [],
          claims: [],
          disclaimers: [],
          requiresApproval: "none",
          blockedClaims: [],
          confidence: "medium"
        },
        evidence: [
          { source: "customer_message", summary: "Mensaje del cliente.", verified: true, confidence: "high", reference: "latest_inbound_message", capturedAt: new Date(0).toISOString(), expiresAt: null }
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
          summary: "Responder ahora.",
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
        providerRequestId: "test-provider-request-id",
        finishReason: "stop",
        metadata: {}
      };
    }
  };
}

const CYCLE_ENV = {
  BRAIN_COMMERCIAL_SHADOW_ENABLED: "true",
  BRAIN_COMMERCIAL_RUNTIME_ENABLED: "true",
  BRAIN_COMMERCIAL_POLICY_ENABLED: "true",
  BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER: "true",
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "true",
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false",
  BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
  BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
  BRAIN_EXECUTION_GATE_ENABLED: "true",
  BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
  BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "true",
  BRAIN_AUTONOMOUS_REPLY_ENABLED: "true"
};

test("ACS-R1-05-T06.2 (P2): the same inbound processed by two concurrent ensureAutonomousSalesTurnContinuity calls never produces two outbox messages or two disposition events", async () => {
  const waId = `5691${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid-concurrent")}`;
  const seeded = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("concurrent-inbound")}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Concurrencia",
    messageType: "text",
    text: "Necesito una jaula de potencia para entrenar en casa. Mi presupuesto maximo es 800000.",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.ok(seeded.conversationId);
  assert.ok(seeded.conversationPublicId);

  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, { BRAIN_AUTONOMOUS_TEST_WA_IDS: waId });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const baseInput = {
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId,
      phoneNumberId,
      messageId: seeded.messageId ?? null,
      messageText: "Necesito una jaula de potencia para entrenar en casa. Mi presupuesto maximo es 800000.",
      currentTime: new Date().toISOString(),
      provider: createUnsafeDraftProvider()
    };

    const [resultA, resultB] = await Promise.all([
      ensureAutonomousSalesTurnContinuity({ ...baseInput, correlationId: uniqueSuffix("corr-concurrent-a") }),
      ensureAutonomousSalesTurnContinuity({ ...baseInput, correlationId: uniqueSuffix("corr-concurrent-b") })
    ]);

    for (const { cycle, disposition } of [resultA, resultB]) {
      assert.equal(cycle.ran, true);
      assert.equal(disposition.terminalOutcome, "fallback_outbox_planned");
    }

    const outboxRows = await queryRows<Record<string, unknown>>("SELECT id FROM brain_message_outbox WHERE wa_id = ?", [waId]);
    assert.equal(outboxRows.length, 1, "two concurrent runs of the exact same inbound must never produce two outbox messages");

    const eventRows = await queryRows<Record<string, unknown>>(
      "SELECT id FROM commercial_event WHERE dedupe_key = ?",
      [`autonomous-turn-disposition:${String(seeded.messageId)}`]
    );
    assert.equal(eventRows.length, 1, "two concurrent runs must dedupe to exactly one disposition event, never two");
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

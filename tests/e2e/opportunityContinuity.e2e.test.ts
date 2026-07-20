import assert from "node:assert/strict";
import test, { after } from "node:test";

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
  DB_WRITE_ENABLED: "true",
  BRAIN_META_SEND_ENABLED: "false",
  BRAIN_OUTBOX_WORKER_ENABLED: "false"
});

import { getPool, queryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { ensureAutonomousSalesTurnContinuity } from "@/lib/brain/commercial/continuity";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import type { SalesAgentProvider, SalesAgentProviderRequest } from "@/lib/brain/commercial/sales-agent/runtimeTypes";

/**
 * ACS-R1-05.1-T02: Stable Opportunity Continuity, MariaDB E2E (crm_test).
 * Real inbound persistence, real operational loop, real crm_opportunities
 * writes - the fake SalesAgentProvider is the only double (no real LLM/Meta
 * calls), matching the established pattern in
 * tests/e2e/reactiveTurnRestartRecovery.e2e.test.ts (ACS-R1-05-T07).
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

async function countRows(sql: string, params: Array<string | number>) {
  const rows = await queryRows<{ total: number }>(sql, params);
  return Number(rows[0]?.total ?? 0);
}

function noToolReplyProvider(): SalesAgentProvider {
  return {
    name: "t02-e2e-no-tool-provider",
    version: "t02.v1",
    async invoke(request: SalesAgentProviderRequest) {
      const rawOutput = {
        runId: request.correlationId ?? "fake-run-id",
        contractVersion: request.contractVersion,
        outcome: "response_proposed",
        analysis: {
          summary: "Cliente conversando sobre una compra.",
          qualificationState: "qualified",
          customerReadiness: "ready",
          productFit: "unknown",
          confidence: "medium",
          riskLevel: "low",
          reasonCodes: ["customer_message_present"]
        },
        decision: {
          type: "respond_now",
          reason: "Responder directamente sin herramientas.",
          confidence: "medium",
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
          draftText: "Gracias por tu mensaje, sigo revisando tu consulta.",
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
          { source: "customer_message", summary: "Mensaje inbound del cliente.", verified: true, confidence: "high", reference: "latest_inbound_message", capturedAt: new Date(0).toISOString(), expiresAt: null }
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
          summary: "Responder ahora, sin herramientas.",
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
        model: "t02-e2e-fake-model",
        inputTokens: 8,
        outputTokens: 8,
        estimatedCost: 0,
        providerRequestId: "t02-e2e-provider-request-id",
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
  // Separate gate from the operational loop itself - defaults to false
  // (.env.example) and was not part of ACS-R1-05-T07's own CYCLE_ENV since
  // that suite only exercised the action-queue/outbox path. T02's evidence is
  // specifically about crm_opportunities writes (persistCommercialState), so
  // this must be explicit here.
  BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED: "true",
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false",
  BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
  BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
  BRAIN_EXECUTION_GATE_ENABLED: "true",
  BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
  BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "true",
  BRAIN_AUTONOMOUS_REPLY_ENABLED: "true"
};

async function seedConversation(label: string) {
  const waId = `5699${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const phoneNumberId = `phone-${uniqueSuffix(label)}`;
  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix(label)}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente T02 E2E",
    messageType: "text",
    text: "Busco una jaula para entrenar en casa",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.equal(result.duplicate, false);
  assert.ok(result.conversationId);
  return { ...result, waId, phoneNumberId };
}

async function runTurn(seeded: Awaited<ReturnType<typeof seedConversation>>, messageText: string, messageId: string | number | null = null) {
  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, { BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId });
  resetCapabilityGatewayCatalogPortForTests();
  try {
    return await ensureAutonomousSalesTurnContinuity({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: messageId ?? seeded.messageId ?? null,
      messageText,
      correlationId: uniqueSuffix("corr-t02-e2e"),
      currentTime: new Date().toISOString(),
      provider: noToolReplyProvider()
    });
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
}

async function countOpportunities(conversationId: number) {
  return countRows("SELECT COUNT(*) AS total FROM crm_opportunities WHERE conversation_case_id = ?", [String(conversationId)]);
}

async function loadOpportunityRows(conversationId: number) {
  return queryRows<{ id: number; opportunity_key: string; version: number; status: string; primary_intent: string }>(
    "SELECT id, opportunity_key, version, status, primary_intent FROM crm_opportunities WHERE conversation_case_id = ? ORDER BY id",
    [String(conversationId)]
  );
}

async function seedOpportunityRow(input: { conversationCaseId: number; waId: string; opportunityKey: string; primaryIntent: string; status: string }) {
  await queryRows(
    `INSERT INTO crm_opportunities (
        opportunity_key, conversation_case_id, wa_id, channel, primary_intent, status, stage,
        requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json
      ) VALUES (?, ?, ?, 'whatsapp', ?, ?, 'discovery', '[]', '[]', '[]', '[]', '[]')`,
    [input.opportunityKey, String(input.conversationCaseId), input.waId, input.primaryIntent, input.status]
  );
}

test("Caso 1: mismo wa_id, misma compra, multiples turnos - una fila, misma key, version creciente", async () => {
  const seeded = await seedConversation("t02-case1");

  const turn1 = await runTurn(seeded, "Busco una jaula para entrenar en casa");
  assert.equal(turn1.cycle.ran, true, `turn1 did not run: ${JSON.stringify(turn1.cycle.warnings)}`);

  const turn2 = await runTurn(seeded, "Tengo 2 x 2 metros y mi presupuesto es 500 mil");
  assert.equal(turn2.cycle.ran, true);

  const turn3 = await runTurn(seeded, "Cuanto cuesta y tiene stock?");
  assert.equal(turn3.cycle.ran, true);

  const rows = await loadOpportunityRows(seeded.conversationId!);
  assert.equal(rows.length, 1, `expected exactly one opportunity row, got ${rows.length}: ${JSON.stringify(rows)}`);
  assert.equal(rows[0].version, 3, "version must increase by one per persisted turn");
  const opportunityKey = rows[0].opportunity_key;

  const turn4 = await runTurn(seeded, "Esta fuera de mi presupuesto, cuanto sale el despacho?");
  assert.equal(turn4.cycle.ran, true);

  const rowsAfter = await loadOpportunityRows(seeded.conversationId!);
  assert.equal(rowsAfter.length, 1, "no additional opportunity must appear across a normal multi-turn purchase");
  assert.equal(rowsAfter[0].opportunity_key, opportunityKey, "opportunity_key must stay stable across turns");
  assert.equal(rowsAfter[0].version, 4);
});

test("Caso 2: replay del mismo inbound - ninguna oportunidad adicional", async () => {
  const seeded = await seedConversation("t02-case2");
  await runTurn(seeded, "Busco una jaula para entrenar en casa");

  const before = await countOpportunities(seeded.conversationId!);
  assert.equal(before, 1);

  const providerMessageIdRow = await queryRows<{ provider_message_id: string }>(
    "SELECT provider_message_id FROM conversation_message WHERE id = ?",
    [String(seeded.messageId)]
  );
  const replay = await processNativeWhatsAppInbound({
    providerMessageId: providerMessageIdRow[0].provider_message_id,
    phoneNumberId: seeded.phoneNumberId,
    externalSenderId: seeded.waId,
    senderPhone: seeded.waId,
    senderName: "Cliente T02 E2E",
    messageType: "text",
    text: "Busco una jaula para entrenar en casa",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.equal(replay.duplicate, true);

  const after = await countOpportunities(seeded.conversationId!);
  assert.equal(after, before, "replay of the identical inbound must never create an additional opportunity");
});

test("Caso 3: same-inbound concurrency - una oportunidad efectiva", async () => {
  const seeded = await seedConversation("t02-case3");
  await runTurn(seeded, "Busco una jaula para entrenar en casa");
  const before = await countOpportunities(seeded.conversationId!);
  assert.equal(before, 1);

  const concurrentMessageId = `wamid.${uniqueSuffix("t02-case3-concurrent")}`;
  const concurrentInput = {
    providerMessageId: concurrentMessageId,
    phoneNumberId: seeded.phoneNumberId,
    externalSenderId: seeded.waId,
    senderPhone: seeded.waId,
    senderName: "Cliente T02 E2E",
    messageType: "text" as const,
    text: "Cuanto cuesta?",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  };

  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, { BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId });
  resetCapabilityGatewayCatalogPortForTests();
  try {
    await Promise.all([processNativeWhatsAppInbound(concurrentInput), processNativeWhatsAppInbound(concurrentInput)]);
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }

  const messageRows = await countRows("SELECT COUNT(*) AS total FROM conversation_message WHERE provider_message_id = ?", [concurrentMessageId]);
  assert.equal(messageRows, 1, "exactly one conversation_message row for the concurrently-delivered inbound");

  const after = await countOpportunities(seeded.conversationId!);
  assert.equal(after, 1, "same-inbound concurrency must resolve to exactly one effective opportunity, never a duplicate");
});

test("Caso 4: necesidad independiente (identidad distinta) - segunda oportunidad, nunca fusion silenciosa", async () => {
  const seededA = await seedConversation("t02-case4-a");
  await runTurn(seededA, "Busco una jaula para entrenar en casa");

  // A genuinely independent need arriving on a different identity
  // (conversation/customer) - documented limitation (see
  // tests/commercial/opportunityContinuity.test.ts and the T02 acceptance
  // evidence): today's resolver has no signal to detect "different need
  // within the SAME identity/thread" (that requires need-profile/
  // entityProposals semantics, out of scope until T03+). What it must do,
  // and does, is never merge across genuinely different identities.
  const seededB = await seedConversation("t02-case4-b");
  const turnB = await runTurn(seededB, "Necesito equipar un gimnasio comercial en otra comuna");
  assert.equal(turnB.cycle.ran, true);

  const rowsA = await loadOpportunityRows(seededA.conversationId!);
  const rowsB = await loadOpportunityRows(seededB.conversationId!);
  assert.equal(rowsA.length, 1);
  assert.equal(rowsB.length, 1);
  assert.notEqual(rowsA[0].opportunity_key, rowsB[0].opportunity_key, "independent identities must never share an opportunity_key");
});

test("Caso 5: dos oportunidades activas para la misma identidad - ninguna fusion silenciosa", async () => {
  const seeded = await seedConversation("t02-case5");
  const keyA = `opp-t02-case5-a-${uniqueSuffix("k")}`;
  const keyB = `opp-t02-case5-b-${uniqueSuffix("k")}`;
  await seedOpportunityRow({ conversationCaseId: seeded.conversationId!, waId: seeded.waId, opportunityKey: keyA, primaryIntent: "quote_request", status: "engaged" });
  await seedOpportunityRow({ conversationCaseId: seeded.conversationId!, waId: seeded.waId, opportunityKey: keyB, primaryIntent: "quote_request", status: "engaged" });

  const before = await loadOpportunityRows(seeded.conversationId!);
  assert.equal(before.length, 2);

  const turn = await runTurn(seeded, "Hola de nuevo, segundo mensaje");
  assert.equal(turn.cycle.ran, true);
  assert.equal(turn.cycle.loop?.identityResolution?.isAmbiguous, true, "two equally-relevant active opportunities must be governed-ambiguous, never silently picked");
  assert.equal(turn.cycle.loop?.identityResolution?.selectedOpportunityId, null);

  const after = await loadOpportunityRows(seeded.conversationId!);
  assert.equal(after.length, 2, "no third opportunity, no merge, no mutation of either existing row's identity");
  assert.equal(after.find((row) => row.opportunity_key === keyA)?.version, 1, "ambiguous turns must not write to either candidate");
  assert.equal(after.find((row) => row.opportunity_key === keyB)?.version, 1);
});

test("Caso 6: oportunidad terminal - sin reapertura automatica", async () => {
  const seeded = await seedConversation("t02-case6");
  const terminalKey = `opp-t02-case6-terminal-${uniqueSuffix("k")}`;
  await seedOpportunityRow({ conversationCaseId: seeded.conversationId!, waId: seeded.waId, opportunityKey: terminalKey, primaryIntent: "unknown", status: "won" });

  const turn = await runTurn(seeded, "Hola, quiero comprar de nuevo");
  assert.equal(turn.cycle.ran, true);

  const rows = await loadOpportunityRows(seeded.conversationId!);
  const terminalRow = rows.find((row) => row.opportunity_key === terminalKey);
  assert.ok(terminalRow, "the terminal opportunity must still exist, untouched");
  assert.equal(terminalRow!.status, "won", "a terminal opportunity's status must never be silently changed by a later turn");
  assert.equal(terminalRow!.version, 1, "a terminal opportunity must never be auto-reopened/rewritten");

  // Either a new opportunity was created for the new commercial signal, or
  // the turn stayed a governed possible_reopen/blocked disposition - both
  // are acceptable, silent auto-reopen of the terminal row is not.
  assert.ok(rows.length === 1 || rows.length === 2, `unexpected row count after a terminal-identity turn: ${rows.length}`);
});

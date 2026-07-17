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
  DB_WRITE_ENABLED: "true"
});

import { getPool, queryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { ensureAutonomousSalesTurnContinuity } from "@/lib/brain/commercial/continuity";
import type { NativeAutonomousCycleResult } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import type { SalesAgentProvider, SalesAgentProviderRequest } from "@/lib/brain/commercial/sales-agent/runtimeTypes";

/**
 * ACS-R1-05-T06.2. End-to-end coverage of the reactive continuity wrapper:
 * a "respond" turn whose draft trips a REAL technical sandbox block
 * (unresolved placeholder - never the removed lexical check) must still
 * terminalize the stuck action and reach the customer via an idempotent
 * fallback, never silence. Also covers the pilot-gate no-op and
 * conversation_not_found paths, which never touch the LLM/DB action layer.
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

async function seedConversation() {
  const waId = `5695${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;
  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("continuity")}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Continuidad",
    messageType: "text",
    text: "Necesito una jaula de potencia para entrenar en casa. Mi presupuesto maximo es 800000.",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.ok(result.conversationId);
  assert.ok(result.conversationPublicId);
  return { ...result, waId, phoneNumberId };
}

/** A provider whose draft carries an unresolved placeholder - a genuine technical sandbox block (unsafe_payload), never the removed lexical price/stock check. */
function createUnsafeDraftProvider(): SalesAgentProvider {
  return {
    name: "test-unsafe-draft-provider",
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

/**
 * ACS-R1-05-T06.2 (second correction, section 4/8/9). A provider whose draft
 * states a concrete commercial fact (a specific price) without declaring any
 * matching claim - never a technical sandbox block, never an absolute
 * promise the sandbox's commitment detector would catch. This is meant to
 * trip ONLY evaluateCommercialCommitmentGrounding.ts's instance-level check,
 * so the turn can be traced end-to-end: policy requires_review -> action
 * requires_review -> escalate_to_operator -> handoff acknowledgement, with
 * responseOwner correctly attributed to the human, not the AI.
 */
function createUngroundedDeclarativeStatementProvider(): SalesAgentProvider {
  return {
    name: "test-ungrounded-declarative-provider",
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
          draftText: "El precio informado por catálogo es $999.999.",
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

test("ACS-R1-05-T06.2: a technically-blocked draft (unresolved placeholder) is terminalized and reaches the customer through a fallback, never silence", async () => {
  const seeded = await seedConversation();
  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, { BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const correlationId = uniqueSuffix("corr-continuity");
    const { cycle, disposition } = await ensureAutonomousSalesTurnContinuity({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId ?? null,
      messageText: "Necesito una jaula de potencia para entrenar en casa. Mi presupuesto maximo es 800000.",
      correlationId,
      currentTime: new Date().toISOString(),
      provider: createUnsafeDraftProvider()
    });

    assert.equal(cycle.ran, true);
    assert.equal(cycle.bridge?.status, "blocked", "the original draft must be genuinely blocked (unresolved placeholder), not silently allowed");
    assert.ok(cycle.bridge?.sandboxEvaluation?.blockReasons.includes("unsafe_payload"));
    assert.ok(!cycle.bridge?.sandboxEvaluation?.blockReasons.includes("unsafe_message"), "must never be blocked by the removed lexical check");

    assert.equal(disposition.terminalOutcome, "fallback_outbox_planned");
    // ACS-R1-05-T06.2 (second correction, section 9): an unresolved
    // placeholder reaching the sandbox is a content-safety issue
    // (fallbackClass "unsafe_primary_draft"), not infrastructure - real
    // resolution needs a person, so responseOwner reads "human" even
    // though the AI is the one who sent the safe acknowledgement.
    assert.equal(disposition.responseOwner, "human");
    assert.equal(disposition.acknowledgementSender, "ai");
    assert.equal(disposition.waitingFor, "human_response");
    assert.equal(disposition.handoffCreated, true);
    assert.equal(disposition.responsePlanned, true);
    assert.equal(disposition.fallbackUsed, true);

    // The original action must be terminalized to 'blocked', never left at 'proposed' forever.
    const originalActionId = cycle.bridge?.action?.actionId;
    assert.ok(originalActionId);
    const originalRows = await queryRows<Record<string, unknown>>("SELECT status, outbox_message_id FROM crm_agent_actions WHERE action_id = ?", [originalActionId]);
    assert.equal(originalRows[0]?.status, "blocked");
    assert.equal(originalRows[0]?.outbox_message_id, null);

    // Exactly one fallback outbox message exists for this conversation.
    const outboxRows = await queryRows<Record<string, unknown>>(
      "SELECT message_text FROM brain_message_outbox WHERE wa_id = ? ORDER BY id DESC LIMIT 1",
      [seeded.waId]
    );
    assert.equal(outboxRows.length, 1);
    assert.match(String(outboxRows[0].message_text), /jaula de potencia/);
    assert.match(String(outboxRows[0].message_text), /800.000|800,000/);

    // A terminal disposition event was persisted.
    const eventRows = await queryRows<Record<string, unknown>>(
      "SELECT event_type FROM commercial_event WHERE dedupe_key = ?",
      [`autonomous-turn-disposition:${String(seeded.messageId)}`]
    );
    assert.equal(eventRows.length, 1);
    assert.equal(eventRows[0].event_type, "autonomous_turn_disposition");
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

test("ACS-R1-05-T06.2 (second correction, section 4/8/9): an ungrounded declarative price statement is held for review, escalated with a safe acknowledgement, and never reaches the customer as-is", async () => {
  const seeded = await seedConversation();
  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, { BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const correlationId = uniqueSuffix("corr-ungrounded");
    const { cycle, disposition } = await ensureAutonomousSalesTurnContinuity({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId ?? null,
      messageText: "Necesito una jaula de potencia para entrenar en casa. Mi presupuesto maximo es 800000.",
      correlationId,
      currentTime: new Date().toISOString(),
      provider: createUngroundedDeclarativeStatementProvider()
    });

    assert.equal(cycle.ran, true);
    // Not a sandbox block - the draft has no commitment marker at all - it is
    // policy's commitmentGrounding check that catches the missing evidence.
    assert.ok(!cycle.bridge?.sandboxEvaluation?.blockReasons.includes("unsupported_commercial_commitment"));

    assert.equal(disposition.terminalOutcome, "handoff_acknowledgement_planned");
    assert.equal(disposition.responseOwner, "human");
    assert.equal(disposition.acknowledgementSender, "ai");
    assert.equal(disposition.waitingFor, "human_response");
    assert.equal(disposition.handoffCreated, true);
    assert.equal(disposition.commercialObjective, "handoff");

    // The original ungrounded-price action must never reach the outbox.
    const originalActionId = cycle.bridge?.action?.actionId;
    if (originalActionId) {
      const originalRows = await queryRows<Record<string, unknown>>("SELECT outbox_message_id FROM crm_agent_actions WHERE action_id = ?", [originalActionId]);
      assert.equal(originalRows[0]?.outbox_message_id, null);
    }

    // Exactly one outbox message exists, and it never states the ungrounded $999.999 figure.
    const outboxRows = await queryRows<Record<string, unknown>>(
      "SELECT message_text FROM brain_message_outbox WHERE wa_id = ? ORDER BY id DESC LIMIT 1",
      [seeded.waId]
    );
    assert.equal(outboxRows.length, 1);
    assert.doesNotMatch(String(outboxRows[0].message_text), /999\.999/);
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

test("pilot allowlist gate: an unauthorized wa_id produces no_response_required with zero DB writes from continuity", async () => {
  const seeded = await seedConversation();
  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, { BRAIN_AUTONOMOUS_TEST_WA_IDS: "56900000000" });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const correlationId = uniqueSuffix("corr-unauthorized");
    const { cycle, disposition } = await ensureAutonomousSalesTurnContinuity({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId ?? null,
      messageText: "hola",
      correlationId,
      currentTime: new Date().toISOString(),
      provider: createUnsafeDraftProvider()
    });

    assert.equal(cycle.ran, false);
    assert.equal(cycle.reason, "wa_id_not_authorized_for_pilot");
    assert.equal(disposition.terminalOutcome, "no_response_required");
    assert.equal(disposition.responseOwner, "none");
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

test("conversation_not_found: a real technical failure is reported as continuity_failed, never silently swallowed", async () => {
  const waId = `5694${String(Date.now()).slice(-8)}`;
  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, { BRAIN_AUTONOMOUS_TEST_WA_IDS: waId });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const correlationId = uniqueSuffix("corr-not-found");
    const { cycle, disposition } = await ensureAutonomousSalesTurnContinuity({
      conversationId: 999999999,
      conversationPublicId: "non-existent-public-id",
      customerMasterId: null,
      waId,
      phoneNumberId: "phone-not-found",
      messageId: uniqueSuffix("msg-not-found"),
      messageText: "hola",
      correlationId,
      currentTime: new Date().toISOString(),
      provider: createUnsafeDraftProvider()
    });

    assert.equal(cycle.ran, false);
    assert.equal(cycle.reason, "conversation_not_found");
    assert.equal(disposition.terminalOutcome, "continuity_failed");
    assert.equal(disposition.responseOwner, "none");

    const eventRows = await queryRows<Record<string, unknown>>(
      "SELECT event_type FROM commercial_event WHERE event_type = 'autonomous_turn_continuity_failed' ORDER BY id DESC LIMIT 1"
    );
    assert.ok(eventRows.length >= 1);
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

test("real human ownership: AI never sends a fallback over a conversation a human already owns", async () => {
  const seeded = await seedConversation();
  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, { BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    // Force real human ownership on the underlying conversation row.
    const { safeExecute } = await import("@/lib/db");
    await safeExecute("UPDATE conversation SET human_owner_active = 1 WHERE id = ?", [seeded.conversationId]);

    const correlationId = uniqueSuffix("corr-human-owner");
    const { disposition } = await ensureAutonomousSalesTurnContinuity({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId ?? null,
      messageText: "hola",
      correlationId,
      currentTime: new Date().toISOString(),
      provider: createUnsafeDraftProvider()
    });

    assert.equal(disposition.responseOwner, "human");
    assert.equal(disposition.terminalOutcome, "human_response_required");
    assert.equal(disposition.fallbackUsed, false);
    assert.equal(disposition.waitingFor, "human_response");
    assert.equal(disposition.handoffCreated, true);
    assert.equal(disposition.acknowledgementSender, null, "AI never sent anything here - there is no acknowledgement to attribute");
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

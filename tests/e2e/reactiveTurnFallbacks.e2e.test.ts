import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";

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

import { getPool, queryRows, resetPoolForTests } from "@/lib/db";
import { closeTestHttpServer } from "../helpers/closeTestHttpServer";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { ensureAutonomousSalesTurnContinuity } from "@/lib/brain/commercial/continuity";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import type { SalesAgentProvider, SalesAgentProviderRequest } from "@/lib/brain/commercial/sales-agent/runtimeTypes";

/**
 * ACS-R1-05-T07. E2E fallback coverage for the reactive commercial turn
 * (T07-E6..E9): a sales agent draft that is unsafe, a provider that fails,
 * an unreachable catalog service, and a structurally invalid model result -
 * each must resolve to exactly one safe outbox message, never silence, never
 * an invented commercial fact, against real MariaDB (crm_test).
 */

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();

before(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await closeTestHttpServer(server);
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function destroyRuntimeForRestart() {
  await resetPoolForTests();
  resetCapabilityGatewayCatalogPortForTests();
}

async function seedConversation(label: string) {
  const waId = `5696${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const phoneNumberId = `phone-${uniqueSuffix(label)}`;
  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix(label)}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente E2E",
    messageType: "text",
    text: "Necesito una jaula de potencia para entrenar en casa. Mi presupuesto maximo es 800000.",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.ok(result.conversationId);
  assert.ok(result.conversationPublicId);
  assert.equal(result.duplicate, false);
  return { ...result, waId, phoneNumberId };
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

async function countActionsForConversation(conversationId: number) {
  return queryRows<Record<string, unknown>>("SELECT id, action_id, status, outbox_message_id FROM crm_agent_actions WHERE conversation_case_id = ?", [String(conversationId)]);
}

async function countOutboxForWaId(waId: string) {
  return queryRows<Record<string, unknown>>("SELECT id, message_text FROM brain_message_outbox WHERE wa_id = ?", [waId]);
}

async function countDispositionEvents(inboundMessageId: string) {
  return queryRows<Record<string, unknown>>("SELECT id, event_type FROM commercial_event WHERE dedupe_key = ?", [`autonomous-turn-disposition:${inboundMessageId}`]);
}

async function countContinuityFailedEvents(conversationId: number) {
  return queryRows<Record<string, unknown>>("SELECT id FROM commercial_event WHERE event_type = 'autonomous_turn_continuity_failed' AND conversation_id = ?", [String(conversationId)]);
}

function baseRawOutput(request: SalesAgentProviderRequest) {
  return {
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
}

/** A provider whose draft carries an unresolved placeholder - a genuine technical sandbox block (unsafe_payload), never a lexical/content censorship rule. */
function createUnsafeDraftProvider(): SalesAgentProvider {
  return {
    name: "test-e6-unsafe-draft-provider",
    version: "test.v1",
    async invoke(request: SalesAgentProviderRequest) {
      const rawOutput = {
        ...baseRawOutput(request),
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
        }
      };
      return { rawOutput, model: "test-model", inputTokens: 32, outputTokens: 32, estimatedCost: 0, providerRequestId: "test-provider-request-id", finishReason: "stop", metadata: {} };
    }
  };
}

/** A provider that fails technically (network/timeout/auth-shaped error) before ever returning a result - never a content problem. */
function createThrowingProvider(): SalesAgentProvider {
  return {
    name: "test-e7-throwing-provider",
    version: "test.v1",
    async invoke() {
      throw new Error("simulated provider network timeout");
    }
  };
}

/** A provider that returns a structurally invalid result - missing required fields the runtime's strict validation demands. Never raw/malformed content may reach the customer. */
function createInvalidResultProvider(): SalesAgentProvider {
  return {
    name: "test-e9-invalid-result-provider",
    version: "test.v1",
    async invoke(request: SalesAgentProviderRequest) {
      const rawOutput = {
        runId: request.correlationId ?? "fake-run-id",
        contractVersion: request.contractVersion,
        outcome: "response_proposed"
        // Deliberately missing analysis/decision/responseProposal/policyAssessment/rationale/evidence.
      };
      return { rawOutput, model: "test-model", inputTokens: 8, outputTokens: 0, estimatedCost: 0, providerRequestId: "test-provider-request-id", finishReason: "stop", metadata: {} };
    }
  };
}

test("T07-E6: unsafe commercial draft - blocked and terminalized, safe acknowledgement reaches the customer exactly once, human handoff", async () => {
  const seeded = await seedConversation("e6");
  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, { BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const correlationId = uniqueSuffix("corr-e6");
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
    assert.equal(cycle.bridge?.status, "blocked", "the unsafe draft must never reach the outbox");
    assert.ok(cycle.bridge?.sandboxEvaluation?.blockReasons.includes("unsafe_payload"));

    assert.equal(disposition.terminalOutcome, "fallback_outbox_planned");
    assert.equal(disposition.responseOwner, "human");
    assert.equal(disposition.acknowledgementSender, "ai");
    assert.equal(disposition.waitingFor, "human_response");
    assert.equal(disposition.handoffCreated, true);
    assert.equal(disposition.fallbackUsed, true);

    // The original unsafe draft's action must be terminalized (blocked), never left dangling.
    const originalActionId = cycle.bridge?.action?.actionId;
    assert.ok(originalActionId);
    const originalRows = await queryRows<Record<string, unknown>>("SELECT status, outbox_message_id FROM crm_agent_actions WHERE action_id = ?", [originalActionId]);
    assert.equal(originalRows[0]?.status, "blocked");
    assert.equal(originalRows[0]?.outbox_message_id, null);

    const outboxRows = await countOutboxForWaId(seeded.waId);
    assert.equal(outboxRows.length, 1, "exactly one safe acknowledgement reaches the customer");
    assert.doesNotMatch(String(outboxRows[0].message_text), /\{\{/, "the unresolved placeholder must never leak into the customer-facing acknowledgement");

    const eventRows = await countDispositionEvents(String(seeded.messageId));
    assert.equal(eventRows.length, 1, "exactly one disposition event");

    const failedRows = await countContinuityFailedEvents(seeded.conversationId!);
    assert.equal(failedRows.length, 0);
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

test("T07-E7: LLM provider unavailable - safe fallback, one action, one outbox, one disposition, idempotent after restart", async () => {
  const seeded = await seedConversation("e7");
  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, { BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const correlationId = uniqueSuffix("corr-e7");
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
      provider: createThrowingProvider()
    });

    assert.equal(cycle.ran, true);
    // The provider's thrown error is caught inside the sales-agent runtime
    // itself (never propagates as an uncaught exception) and surfaces as a
    // failed operational loop (loop.status === "failed_safe") rather than a
    // shadow_failed warning - ensureAutonomousSalesTurnContinuity must still
    // recognize this as a technical failure needing a fallback, never silence.
    assert.equal(disposition.terminalOutcome, "fallback_outbox_planned", `must never resolve to no_response_required on a provider failure. warnings=${JSON.stringify(cycle.warnings)} bridgeStatus=${cycle.bridge?.status}`);
    assert.equal(disposition.fallbackUsed, true);
    assert.equal(disposition.responseOwner === "ai" || disposition.responseOwner === "human", true, "a real, coherent response owner must always be assigned");

    const actionRows = await countActionsForConversation(seeded.conversationId!);
    assert.equal(actionRows.length, 1);
    const outboxRows = await countOutboxForWaId(seeded.waId);
    assert.equal(outboxRows.length, 1, "exactly one safe outbox message when the provider is unavailable");
    assert.doesNotMatch(String(outboxRows[0].message_text), /undefined|\[object Object\]|NaN/, "no raw error/promise state ever reaches the customer");

    const eventRows = await countDispositionEvents(String(seeded.messageId));
    assert.equal(eventRows.length, 1);

    // Repeat after recreating the runtime and verify idempotency: the same
    // conversation/message replayed through a fresh continuity call must
    // never duplicate the fallback (persistAgentAction's idempotency_key
    // digest for the fallback path is deterministic per conversation+
    // inboundMessageId+fallbackClass, unlike the primary response path).
    await destroyRuntimeForRestart();
    resetCapabilityGatewayCatalogPortForTests();
    Object.assign(process.env, CYCLE_ENV, { BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId });

    const replay = await ensureAutonomousSalesTurnContinuity({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId ?? null,
      messageText: "Necesito una jaula de potencia para entrenar en casa. Mi presupuesto maximo es 800000.",
      correlationId: uniqueSuffix("corr-e7-replay"),
      currentTime: new Date().toISOString(),
      provider: createThrowingProvider()
    });
    assert.equal(replay.cycle.ran, true);

    const actionRowsAfterReplay = await countActionsForConversation(seeded.conversationId!);
    assert.equal(actionRowsAfterReplay.length, 1, "replay after restart must never duplicate the fallback action");
    const outboxRowsAfterReplay = await countOutboxForWaId(seeded.waId);
    assert.equal(outboxRowsAfterReplay.length, 1, "replay after restart must never duplicate the outbox message");
    const eventRowsAfterReplay = await countDispositionEvents(String(seeded.messageId));
    assert.equal(eventRowsAfterReplay.length, 1, "replay after restart must never duplicate the disposition event");
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

test("T07-E8: catalog service unavailable - preserves known need, never invents a product or price, one outbox, one disposition", async () => {
  const seeded = await seedConversation("e8");
  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, {
    CATALOG_SERVICE_BASE_URL: "http://127.0.0.1:1", // nothing listens here
    CATALOG_SERVICE_API_KEY: "test-key",
    CATALOG_SERVICE_TIMEOUT_MS: "200",
    BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId
  });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const correlationId = uniqueSuffix("corr-e8");
    const searchToolProvider: SalesAgentProvider = {
      name: "test-e8-search-tool-request-provider",
      version: "test.v1",
      async invoke(request: SalesAgentProviderRequest) {
        const rawOutput = {
          ...baseRawOutput(request),
          shouldRequestTool: true,
          toolRequests: [
            {
              tool: "searchProducts",
              purpose: "Buscar jaulas de potencia reales en el catalogo.",
              status: "planned",
              requiredInputs: { query: "jaula de potencia" },
              optionalInputs: null,
              urgency: "high",
              blocking: false,
              reason: "Se necesita evidencia real de catalogo antes de recomendar.",
              expectedEvidence: ["product_tool"],
              fallbackDecision: "respond_now",
              confidence: "high",
              riskLevel: "low"
            }
          ],
          responseProposal: {
            messageIntent: "answer",
            draftText: "Dejame revisar el catalogo real antes de recomendarte algo.",
            language: "es",
            tone: "friendly",
            questions: [],
            claims: [],
            disclaimers: [],
            requiresApproval: "none",
            blockedClaims: [],
            confidence: "medium"
          }
        };
        return { rawOutput, model: "test-model", inputTokens: 48, outputTokens: 48, estimatedCost: 0, providerRequestId: "test-provider-request-id", finishReason: "stop", metadata: {} };
      }
    };

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
      provider: searchToolProvider
    });

    assert.equal(cycle.ran, true);
    assert.equal(cycle.catalogCapability?.searchResult?.status, "temporarily_blocked");
    // Catalog-unavailable degrades safely at the grounding layer itself
    // (buildCatalogGroundedMessage.ts composes a safe, need-preserving
    // message that becomes the loop's own next action - see
    // buildCatalogGroundedMessageBudget.test.ts's "batch unavailable" case),
    // not via the continuity fallback dispatcher - responsePlanned true and
    // fallbackUsed false is the correct, safe outcome here.
    assert.equal(disposition.responsePlanned, true);

    const outboxRows = await countOutboxForWaId(seeded.waId);
    assert.equal(outboxRows.length, 1, "exactly one outbox message when the catalog is unavailable");
    const message = String(outboxRows[0].message_text);
    assert.doesNotMatch(message, /\$\d/, "must never invent a price when the catalog could not be consulted");
    assert.doesNotMatch(message, /Jaula de entrenamiento compacta|449\.990/, "must never invent a specific product or price when the catalog could not be consulted");
    assert.ok(message.trim().length > 0, "must be a real, non-empty message, never a silent/administrative placeholder");

    const actionRows = await countActionsForConversation(seeded.conversationId!);
    assert.equal(actionRows.length, 1);
    const eventRows = await countDispositionEvents(String(seeded.messageId));
    assert.equal(eventRows.length, 1);
    const failedRows = await countContinuityFailedEvents(seeded.conversationId!);
    assert.equal(failedRows.length, 0);
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

test("T07-E9: structurally invalid model result - no raw/JSON content ever reaches the customer, one action, one outbox, one disposition", async () => {
  const seeded = await seedConversation("e9");
  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, { BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const correlationId = uniqueSuffix("corr-e9");
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
      provider: createInvalidResultProvider()
    });

    assert.equal(cycle.ran, true);
    assert.equal(disposition.fallbackUsed, true);

    const actionRows = await countActionsForConversation(seeded.conversationId!);
    assert.equal(actionRows.length, 1);
    const outboxRows = await countOutboxForWaId(seeded.waId);
    assert.equal(outboxRows.length, 1, "exactly one safe outbox message when the model result is structurally invalid");
    const message = String(outboxRows[0].message_text);
    assert.doesNotMatch(message, /\{|\}|runId|contractVersion|undefined/, "no raw/JSON provider output may ever reach the customer");

    const eventRows = await countDispositionEvents(String(seeded.messageId));
    assert.equal(eventRows.length, 1);
    const failedRows = await countContinuityFailedEvents(seeded.conversationId!);
    assert.equal(failedRows.length, 0);
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

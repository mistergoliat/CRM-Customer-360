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
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import type { NativeAutonomousCycleInput, NativeAutonomousCycleResult } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import { recordAutonomousTurnDispositionCommercialEvent } from "@/lib/brain/commercial/events/service";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import { persistAgentAction } from "@/lib/brain/commercial/action-queue";
import type { CrmAgentAction, PersistAgentActionResult } from "@/lib/brain/commercial/action-queue";
import { evaluateAgentActionForSandbox, buildSandboxAutonomyConfig } from "@/lib/brain/commercial/autonomy-sandbox";
import type { SandboxAutonomyAgentActionContext } from "@/lib/brain/commercial/autonomy-sandbox";
import { executeActionThroughGate, SqlExecutionUnitOfWork } from "@/lib/brain/commercial/execution-gate";
import type { ExecutionGateResult } from "@/lib/brain/commercial/execution-gate";
import type { SalesAgentProvider, SalesAgentProviderRequest } from "@/lib/brain/commercial/sales-agent/runtimeTypes";

/**
 * ACS-R1-05-T07. E2E restart recovery for the reactive commercial turn
 * (T07-E1..E5): a fake catalog HTTP server + real pipeline (persistAgentAction
 * -> sandbox -> execution gate -> canonical outbox), against real MariaDB
 * (crm_test). "Restart" is simulated by destroying every runtime handle the
 * exported API allows (the DB pool via resetPoolForTests, the capability
 * gateway's cached catalog port) and constructing fresh objects/providers for
 * phase 2, then reading exclusively from MariaDB to resume or verify - no
 * survives-restart in-memory state is relied on for assertions.
 */

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let searchRequests: string[] = [];

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.includes("/v1/products/search")) searchRequests.push(req.url);
    handler(req, res);
  });
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

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Simulates a process restart: destroys the DB pool and every cached, resettable runtime handle the exported API exposes. Phase 2 must construct fresh objects and read only from MariaDB. */
async function destroyRuntimeForRestart() {
  await resetPoolForTests();
  resetCapabilityGatewayCatalogPortForTests();
}

async function seedConversation(label: string) {
  const waId = `5697${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const phoneNumberId = `phone-${uniqueSuffix(label)}`;
  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix(label)}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente E2E",
    messageType: "text",
    text: "Tengo poco espacio y máximo 500 mil",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.ok(result.conversationId);
  assert.ok(result.conversationPublicId);
  assert.equal(result.duplicate, false);
  return { ...result, waId, phoneNumberId };
}

function successCatalogHandler(): Handler {
  return (req, res) => {
    if (req.url?.includes("/v1/products/search")) {
      return sendJson(res, 200, {
        query: "jaula entrenamiento",
        items: [
          { productId: 501, combinationId: 0, sku: "JLA-501", name: "Jaula de entrenamiento compacta", variantLabel: null, shortDescription: null, physicalQuantity: 4, available: true, matchType: "partial_name" }
        ],
        freshness: { cached: false, generatedAt: new Date().toISOString() }
      });
    }
    if (req.method === "POST" && req.url === "/v1/products/batch") {
      return sendJson(res, 200, {
        items: [
          {
            ok: true,
            input: { productId: 501, combinationId: 0, quantity: 1 },
            product: {
              product: { productId: 501, name: "Jaula de entrenamiento compacta", sku: "JLA-501", shortDescription: null, longDescription: null, active: true },
              selectedVariant: null,
              attributes: [],
              variants: [],
              pricing: { quantity: 1, baseUnitPrice: 449990, effectiveUnitPrice: 449990, subtotal: 449990, currency: "CLP", taxIncluded: true, taxMode: "configured_rate", discountApplied: false, discountType: null, discountValue: null, specificPriceId: null, pricingMode: "sql_specific_price" },
              stock: { physicalQuantity: 4, available: true, shopId: 1 },
              freshness: { productCheckedAt: new Date().toISOString(), priceCalculatedAt: new Date().toISOString(), stockCheckedAt: new Date().toISOString(), cached: false }
            }
          }
        ]
      });
    }
    return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "unexpected route in test fake", correlationId: "test" } });
  };
}

/** A sales agent that drafts a tentative response AND requests searchProducts in the same turn - the realistic "normal turn" shape reused across E1/E2/E3. runId must echo the caller's correlationId. */
function createSearchToolRequestProvider(): SalesAgentProvider {
  return {
    name: "test-search-tool-request-provider",
    version: "test.v1",
    async invoke(request: SalesAgentProviderRequest) {
      const rawOutput = {
        runId: request.correlationId ?? "fake-run-id",
        contractVersion: request.contractVersion,
        outcome: "response_proposed",
        analysis: {
          summary: "Cliente busca una jaula de entrenamiento con restricciones de espacio y presupuesto.",
          qualificationState: "qualified",
          customerReadiness: "ready",
          productFit: "good",
          confidence: "high",
          riskLevel: "low",
          reasonCodes: ["customer_message_present"]
        },
        decision: {
          type: "respond_now",
          reason: "Hay contexto suficiente para responder y pedir el catalogo real.",
          confidence: "high",
          riskLevel: "low",
          requiresApproval: "none",
          errorCode: "none",
          reasonCodes: ["customer_message_present"],
          policyTags: ["commercial_reply"]
        },
        shouldRespondNow: true,
        shouldRequestTool: true,
        shouldRequestHuman: false,
        shouldEvaluateFollowUp: false,
        proposedActions: [],
        toolRequests: [
          {
            tool: "searchProducts",
            purpose: "Buscar jaulas de entrenamiento reales en el catalogo.",
            status: "planned",
            requiredInputs: { query: "jaula entrenamiento" },
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
        entityProposals: [],
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
        },
        evidence: [
          { source: "customer_message", summary: "El cliente indico presupuesto y espacio disponible.", verified: true, confidence: "high", reference: "latest_inbound_message", capturedAt: new Date(0).toISOString(), expiresAt: null }
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
          summary: "Responder ahora y solicitar catalogo real en paralelo.",
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
        inputTokens: 64,
        outputTokens: 64,
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

test("T07-E1: normal reactive turn - inbound persisted, cycle executed, one action, one outbox, one disposition, grounded reply, no fallback, no duplicates", async () => {
  searchRequests = [];
  handler = successCatalogHandler();
  const seeded = await seedConversation("e1");

  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, {
    CATALOG_SERVICE_BASE_URL: baseUrl,
    CATALOG_SERVICE_API_KEY: "test-key",
    BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId
  });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const correlationId = uniqueSuffix("corr-e1");
    const { cycle, disposition } = await ensureAutonomousSalesTurnContinuity({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId ?? null,
      messageText: "Tengo poco espacio y máximo 500 mil",
      correlationId,
      currentTime: new Date().toISOString(),
      provider: createSearchToolRequestProvider()
    });

    assert.equal(cycle.ran, true);
    assert.equal(cycle.catalogCapability?.executed, true);
    assert.equal(searchRequests.length, 1, "search_products must be called exactly once");
    assert.equal(disposition.terminalOutcome, "catalog_recommendation_planned");
    assert.equal(disposition.responseOwner, "ai");
    assert.equal(disposition.fallbackUsed, false);
    assert.equal(disposition.responsePlanned, true);

    const actionRows = await countActionsForConversation(seeded.conversationId!);
    assert.equal(actionRows.length, 1, "exactly one action must be persisted for this turn");
    assert.ok(actionRows[0].outbox_message_id !== null, "the action must carry the outbox reference");

    const outboxRows = await countOutboxForWaId(seeded.waId);
    assert.equal(outboxRows.length, 1, "exactly one outbox message");
    assert.match(String(outboxRows[0].message_text), /Jaula de entrenamiento compacta/);

    const eventRows = await countDispositionEvents(String(seeded.messageId));
    assert.equal(eventRows.length, 1, "exactly one disposition event");

    const failedRows = await countContinuityFailedEvents(seeded.conversationId!);
    assert.equal(failedRows.length, 0, "no continuity_failed event on a normal turn");

    // Re-delivery of the exact same inbound (e.g. a WhatsApp webhook retry)
    // must never re-run the cycle or duplicate anything.
    const replay = await processNativeWhatsAppInbound({
      providerMessageId: (await queryRows<{ provider_message_id: string }>("SELECT provider_message_id FROM conversation_message WHERE id = ?", [String(seeded.messageId)]))[0].provider_message_id,
      phoneNumberId: seeded.phoneNumberId,
      externalSenderId: seeded.waId,
      senderPhone: seeded.waId,
      senderName: "Cliente E2E",
      messageType: "text",
      text: "Tengo poco espacio y máximo 500 mil",
      occurredAt: new Date().toISOString(),
      rawPayload: {}
    });
    assert.equal(replay.duplicate, true);

    const actionRowsAfterReplay = await countActionsForConversation(seeded.conversationId!);
    assert.equal(actionRowsAfterReplay.length, 1, "replay of the identical inbound must never create a second action");
    const outboxRowsAfterReplay = await countOutboxForWaId(seeded.waId);
    assert.equal(outboxRowsAfterReplay.length, 1, "replay of the identical inbound must never create a second outbox message");
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

test("T07-E2: replay after restart - recreating the runtime and reprocessing the same inbound never duplicates the action, outbox, or disposition", async () => {
  searchRequests = [];
  handler = successCatalogHandler();
  const seeded = await seedConversation("e2");

  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, {
    CATALOG_SERVICE_BASE_URL: baseUrl,
    CATALOG_SERVICE_API_KEY: "test-key",
    BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId
  });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const correlationId = uniqueSuffix("corr-e2");
    const providerMessageIdRow = await queryRows<{ provider_message_id: string }>("SELECT provider_message_id FROM conversation_message WHERE id = ?", [String(seeded.messageId)]);
    const providerMessageId = providerMessageIdRow[0].provider_message_id;

    const first = await ensureAutonomousSalesTurnContinuity({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId ?? null,
      messageText: "Tengo poco espacio y máximo 500 mil",
      correlationId,
      currentTime: new Date().toISOString(),
      provider: createSearchToolRequestProvider()
    });
    assert.equal(first.cycle.ran, true);
    assert.equal(first.disposition.terminalOutcome, "catalog_recommendation_planned");

    // Simulate a process restart between the first turn and the retry: no
    // in-memory pool, catalog port cache, or provider instance survives.
    await destroyRuntimeForRestart();
    resetCapabilityGatewayCatalogPortForTests();

    // The most realistic "restart recovery" trigger for the reactive path is
    // a WhatsApp webhook re-delivery of the exact same message (the sender
    // never received a timely ack because the process restarted) - it must
    // be recognized as a duplicate at the inbound boundary, never re-run the
    // cycle a second time with a freshly constructed provider/runtime.
    const replay = await processNativeWhatsAppInbound({
      providerMessageId,
      phoneNumberId: seeded.phoneNumberId,
      externalSenderId: seeded.waId,
      senderPhone: seeded.waId,
      senderName: "Cliente E2E",
      messageType: "text",
      text: "Tengo poco espacio y máximo 500 mil",
      occurredAt: new Date().toISOString(),
      rawPayload: {}
    });
    assert.equal(replay.duplicate, true, "the recreated runtime must still recognize this inbound as already processed, reading only from MariaDB");

    const actionRows = await countActionsForConversation(seeded.conversationId!);
    assert.equal(actionRows.length, 1, "one logical action after restart + replay");
    const outboxRows = await countOutboxForWaId(seeded.waId);
    assert.equal(outboxRows.length, 1, "one outbox message after restart + replay");
    const eventRows = await countDispositionEvents(String(seeded.messageId));
    assert.equal(eventRows.length, 1, "one disposition after restart + replay");
    assert.equal(searchRequests.length, 1, "the catalog search must never be repeated by the replay");

    const failedRows = await countContinuityFailedEvents(seeded.conversationId!);
    assert.equal(failedRows.length, 0, "no continuity_failed spuriously recorded across the restart");
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

function createSynchronizationBarrier(expectedArrivals: number) {
  let arrived = 0;
  let releaseAll!: () => void;
  const released = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });
  return {
    async arriveAndWait(): Promise<void> {
      arrived += 1;
      if (arrived >= expectedArrivals) releaseAll();
      await released;
    }
  };
}

function createBarrieredSearchToolRequestProvider(barrier: { arriveAndWait: () => Promise<void> }): SalesAgentProvider {
  const real = createSearchToolRequestProvider();
  return {
    name: real.name,
    version: real.version,
    async invoke(request: SalesAgentProviderRequest) {
      await barrier.arriveAndWait();
      return real.invoke(request, { timeoutMs: 5000, currentTime: new Date().toISOString(), dryRun: false, strictValidation: true, metadata: {} });
    }
  };
}

test("T07-E3: real concurrency on the same inbound (10 iterations) - exactly one action, one outbox, one disposition, no ER_DUP_ENTRY, no spurious continuity_failed", async () => {
  handler = successCatalogHandler();

  for (let iteration = 0; iteration < 10; iteration += 1) {
    searchRequests = [];
    const seeded = await seedConversation(`e3-${iteration}`);

    const previousEnv = { ...process.env };
    Object.assign(process.env, CYCLE_ENV, {
      CATALOG_SERVICE_BASE_URL: baseUrl,
      CATALOG_SERVICE_API_KEY: "test-key",
      BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId
    });
    resetCapabilityGatewayCatalogPortForTests();

    try {
      const barrier = createSynchronizationBarrier(2);
      const baseInput: NativeAutonomousCycleInput = {
        conversationId: seeded.conversationId!,
        conversationPublicId: seeded.conversationPublicId as string,
        customerMasterId: seeded.customerId ?? null,
        waId: seeded.waId,
        phoneNumberId: seeded.phoneNumberId,
        messageId: seeded.messageId ?? null,
        messageText: "Tengo poco espacio y máximo 500 mil",
        correlationId: uniqueSuffix(`corr-e3-${iteration}-a`),
        currentTime: new Date().toISOString(),
        provider: createBarrieredSearchToolRequestProvider(barrier)
      };
      const otherInput: NativeAutonomousCycleInput = { ...baseInput, correlationId: uniqueSuffix(`corr-e3-${iteration}-b`), provider: createBarrieredSearchToolRequestProvider(barrier) };

      const [resultA, resultB] = await Promise.all([
        ensureAutonomousSalesTurnContinuity(baseInput),
        ensureAutonomousSalesTurnContinuity(otherInput)
      ]);

      for (const { cycle } of [resultA, resultB]) {
        assert.equal(cycle.ran, true, `iteration ${iteration}: both concurrent cycles must run`);
      }

      const actionRows = await countActionsForConversation(seeded.conversationId!);
      const outboxRows = await countOutboxForWaId(seeded.waId);
      const eventRows = await countDispositionEvents(String(seeded.messageId));
      assert.equal(actionRows.length, 1, `iteration ${iteration}: exactly one action row despite genuine concurrency`);
      assert.equal(outboxRows.length, 1, `iteration ${iteration}: exactly one outbox row despite genuine concurrency`);
      assert.equal(eventRows.length, 1, `iteration ${iteration}: exactly one disposition event despite genuine concurrency`);

      const failedRows = await countContinuityFailedEvents(seeded.conversationId!);
      assert.equal(failedRows.length, 0, `iteration ${iteration}: no spurious continuity_failed for the race loser`);

      // Both concurrent calls must resolve usably - never "failed" from a
      // lost ER_DUP_ENTRY race (this is the exact defect fixed in
      // persistAgentAction.ts during this task - continuityConcurrency.test.ts
      // proves the isolated primitive, this proves it end-to-end through the
      // full reactive cycle under real concurrency).
      for (const { disposition } of [resultA, resultB]) {
        assert.notEqual(disposition.terminalOutcome, "continuity_failed", `iteration ${iteration}: neither concurrent call may report continuity_failed`);
      }
    } finally {
      process.env = previousEnv;
      resetCapabilityGatewayCatalogPortForTests();
    }
  }
});

function buildStandaloneTestAgentAction(input: { conversationId: number; waId: string; idempotencyKey: string; draftMessage: string; currentTime: string }): CrmAgentAction {
  return {
    id: null,
    actionId: `crm-agent-action-e2e-${input.idempotencyKey.slice(-40)}`,
    idempotencyKey: input.idempotencyKey,
    opportunityId: null,
    decisionId: null,
    decisionRowId: null,
    conversationCaseId: input.conversationId,
    messageId: null,
    waId: input.waId,
    channel: "whatsapp",
    actionType: "send_whatsapp_reply",
    status: "proposed",
    riskLevel: "low",
    approvalRequirement: "none",
    draftPayload: null,
    finalPayload: null,
    executionPayload: null,
    draftMessage: input.draftMessage,
    finalMessage: null,
    scheduledFor: null,
    expiresAt: null,
    attemptNumber: 1,
    maxAttempts: 1,
    blockReasons: [],
    cancelReason: null,
    failureReason: null,
    policyStatus: "allowed",
    policyNotes: [],
    source: "ai_sdr",
    createdBy: "ai",
    approvedBy: null,
    approvedAt: null,
    executedAt: null,
    cancelledAt: null,
    outboxMessageId: null,
    lifecycleVersion: "brain.commercial.action-lifecycle.v1",
    policyVersion: null,
    runtimeVersion: null,
    createdAt: input.currentTime,
    updatedAt: null
  };
}

test("T07-E4: restart after persistAgentAction, before the outbox is completed - the existing action is reused, exactly one final outbox, no duplicate", async () => {
  const seeded = await seedConversation("e4");
  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, { BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId });

  try {
    const idempotencyKey = `e2e-e4-${uniqueSuffix("action")}`;
    const currentTime = new Date().toISOString();
    const action = buildStandaloneTestAgentAction({ conversationId: seeded.conversationId!, waId: seeded.waId, idempotencyKey, draftMessage: "Gracias por tu mensaje, estoy revisando tu consulta.", currentTime });

    // Phase 1: durable boundary - persistAgentAction commits (status
    // 'proposed'), but the process "crashes" before the execution gate ever
    // runs - no sandbox evaluation, no outbox write.
    const phase1: PersistAgentActionResult = await persistAgentAction({ action, currentTime, featureFlags: { queueEnabled: true, persistenceEnabled: true } });
    assert.equal(phase1.status, "inserted");
    assert.ok(phase1.rowId !== null);

    const rowsAfterPhase1 = await countActionsForConversation(seeded.conversationId!);
    assert.equal(rowsAfterPhase1.length, 1);
    assert.equal(rowsAfterPhase1[0].status, "proposed");
    assert.equal(rowsAfterPhase1[0].outbox_message_id, null);

    // "Restart": destroy the pool and every resettable runtime handle.
    await destroyRuntimeForRestart();

    // Phase 2: fresh instances, read only from MariaDB before resuming.
    const reloaded = await countActionsForConversation(seeded.conversationId!);
    assert.equal(reloaded.length, 1, "the action must still exist, read fresh from MariaDB after restart");
    assert.equal(reloaded[0].status, "proposed");

    const sandboxContext: SandboxAutonomyAgentActionContext = {
      now: new Date().toISOString(),
      caseId: String(seeded.conversationId),
      caseStatus: "open",
      lifecycleStatus: "open",
      humanOwnerActive: false,
      aiBlocked: false,
      requiresHuman: false,
      policyStatus: "allowed",
      conflictingActionExists: false
    };
    const sandboxEvaluation = evaluateAgentActionForSandbox(
      action,
      sandboxContext,
      buildSandboxAutonomyConfig({
        sandboxEnabled: true,
        autonomousReplyEnabled: true,
        whitelistedWaIds: [seeded.waId],
        allowedActionTypes: ["send_whatsapp_reply", "request_more_context"],
        maxRiskLevel: "low"
      })
    );

    const gateResult: ExecutionGateResult = await executeActionThroughGate(
      {
        now: new Date().toISOString(),
        action,
        config: { executionGateEnabled: true, outboxBridgeEnabled: true, sandboxModeRequired: false },
        context: sandboxContext,
        sandboxEvaluation
      },
      { unitOfWork: new SqlExecutionUnitOfWork() }
    );

    assert.equal(gateResult.status, "allowed");
    assert.equal(gateResult.repositoryResult.outboxInserted, true);

    const finalRows = await countActionsForConversation(seeded.conversationId!);
    assert.equal(finalRows.length, 1, "recovery must reuse the existing action row, never create a second one");
    assert.ok(finalRows[0].outbox_message_id !== null, "the recovered action must now carry the outbox reference");

    const outboxRows = await countOutboxForWaId(seeded.waId);
    assert.equal(outboxRows.length, 1, "exactly one outbox row after recovery");

    // A naive retry of the exact same recovery step (e.g. an operator
    // re-running it, or a duplicate reconciliation pass) must never create a
    // second action or a second outbox row.
    const retryPersist = await persistAgentAction({ action, currentTime: new Date().toISOString(), featureFlags: { queueEnabled: true, persistenceEnabled: true } });
    assert.notEqual(retryPersist.status, "failed");
    const rowsAfterRetry = await countActionsForConversation(seeded.conversationId!);
    assert.equal(rowsAfterRetry.length, 1, "a duplicate recovery attempt must never create a second action row");
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

test("T07-E5: restart after the outbox is created, before the disposition is persisted - outbox reused, exactly one final disposition, no continuity_failed", async () => {
  searchRequests = [];
  handler = successCatalogHandler();
  const seeded = await seedConversation("e5");

  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, {
    CATALOG_SERVICE_BASE_URL: baseUrl,
    CATALOG_SERVICE_API_KEY: "test-key",
    BRAIN_AUTONOMOUS_TEST_WA_IDS: seeded.waId
  });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const correlationId = uniqueSuffix("corr-e5");

    // Phase 1: drive the cycle directly (never through
    // ensureAutonomousSalesTurnContinuity) - this completes the real
    // action+outbox pipeline exactly like a normal turn, but disposition
    // persistence lives exclusively inside the continuity wrapper, so this
    // boundary ("outbox committed, disposition not yet persisted") is real
    // and reachable without any test-only hook.
    const cycle: NativeAutonomousCycleResult = await runNativeAutonomousCycle({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId ?? null,
      messageText: "Tengo poco espacio y máximo 500 mil",
      correlationId,
      currentTime: new Date().toISOString(),
      provider: createSearchToolRequestProvider()
    });

    assert.equal(cycle.ran, true);
    assert.equal(cycle.bridge?.status, "outbox_planned");
    const outboxRowsAfterPhase1 = await countOutboxForWaId(seeded.waId);
    assert.equal(outboxRowsAfterPhase1.length, 1, "the outbox row is durably committed by phase 1");
    const eventsAfterPhase1 = await countDispositionEvents(String(seeded.messageId));
    assert.equal(eventsAfterPhase1.length, 0, "no disposition has been persisted yet - that step lives only in the continuity wrapper, never reached in phase 1");

    // "Restart": destroy the pool and every resettable runtime handle.
    await destroyRuntimeForRestart();
    resetCapabilityGatewayCatalogPortForTests();

    // Phase 2: recovery reads the already-durable outcome from MariaDB only
    // (never the phase-1 in-memory `cycle` object) and completes the missing
    // disposition bookkeeping via the same canonical event writer the
    // continuity wrapper itself uses.
    const actionRows = await countActionsForConversation(seeded.conversationId!);
    assert.equal(actionRows.length, 1);
    const recoveredOutboxRows = await countOutboxForWaId(seeded.waId);
    assert.equal(recoveredOutboxRows.length, 1, "restart must never duplicate the already-committed outbox row");

    const recoveryPayload = {
      inboundMessageId: String(seeded.messageId),
      responseOwner: "ai" as const,
      commercialObjective: "recommend" as const,
      primaryActionId: String(actionRows[0].action_id),
      primaryDisposition: "outbox_planned",
      primaryBlockReasons: [],
      fallbackActionId: null,
      outboxId: String(recoveredOutboxRows[0].id),
      opportunityAdvanced: false,
      nextBestAction: "defined" as const,
      followUpEligible: false,
      followUpReason: null,
      terminalOutcome: "catalog_recommendation_planned" as const,
      acknowledgementSender: null,
      waitingFor: "none" as const,
      handoffCreated: false
    };

    await recordAutonomousTurnDispositionCommercialEvent({
      inboundMessageId: String(seeded.messageId),
      correlationId,
      conversationId: seeded.conversationId,
      opportunityId: null,
      payload: recoveryPayload
    });

    const eventsAfterRecovery = await countDispositionEvents(String(seeded.messageId));
    assert.equal(eventsAfterRecovery.length, 1, "recovery must persist exactly one disposition event");

    // A duplicate recovery attempt (e.g. two reconciliation sweeps, or a
    // retried webhook) must dedupe to the same single disposition event.
    await recordAutonomousTurnDispositionCommercialEvent({
      inboundMessageId: String(seeded.messageId),
      correlationId,
      conversationId: seeded.conversationId,
      opportunityId: null,
      payload: recoveryPayload
    });
    const eventsAfterSecondAttempt = await countDispositionEvents(String(seeded.messageId));
    assert.equal(eventsAfterSecondAttempt.length, 1, "a duplicate recovery attempt must never create a second disposition event");

    const outboxRowsFinal = await countOutboxForWaId(seeded.waId);
    assert.equal(outboxRowsFinal.length, 1, "no second outbox was ever created by the recovery path");

    const failedRows = await countContinuityFailedEvents(seeded.conversationId!);
    assert.equal(failedRows.length, 0, "recovering a missing disposition must never be recorded as a continuity failure");
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

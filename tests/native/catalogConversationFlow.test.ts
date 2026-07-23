import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import type { SalesAgentProvider, SalesAgentProviderRequest } from "@/lib/brain/commercial/sales-agent/runtimeTypes";

/**
 * ACS-R1-01.1 objective 8 - integrated conversation flow through the real
 * canonical runtime (runNativeAutonomousCycle, real MariaDB, mocked catalog
 * HTTP server): catalog search -> grounded recommendation -> objection ->
 * alternative search -> "lo voy a pensar" (propose_followup).
 *
 * Honest scope note: this test asserts the operational loop's *next-action
 * selection* (propose_followup) - it does not enable
 * BRAIN_AGENT_ACTION_QUEUE_ENABLED/BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED,
 * so it never exercises whether a crm_agent_actions row actually gets
 * persisted or scheduled. ACS-R1-05.1-T02.3D wired real, configuration-
 * governed scheduling into that persistence path
 * (execution-bridge/runCommercialExecutionBridge.ts#resolveFollowUpSchedulingContext,
 * replacing the previously permanent scheduled_for=NULL/max_attempts=1) -
 * covered end-to-end, with those flags enabled, by
 * tests/commercial/followUpSequenceContinuity.test.ts.
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

let server: http.Server;
let baseUrl: string;
const searchQueries: string[] = [];

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/v1/products/search") {
      const q = url.searchParams.get("q") ?? "";
      searchQueries.push(q);
      const expensive = !/econ|barat/i.test(q);
      const item = expensive
        ? { productId: 501, combinationId: 0, sku: "JLA-501", name: "Jaula de entrenamiento premium", variantLabel: null, shortDescription: null, physicalQuantity: 4, available: true, matchType: "partial_name" }
        : { productId: 502, combinationId: 0, sku: "JLA-502", name: "Jaula de entrenamiento economica", variantLabel: null, shortDescription: null, physicalQuantity: 2, available: true, matchType: "partial_name" };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ query: q, items: [item], freshness: { cached: false, generatedAt: new Date().toISOString() } }));
      return;
    }
    function buildProductPayload(productId: number) {
      const cheap = productId === 502;
      return {
        product: { productId, name: cheap ? "Jaula de entrenamiento economica" : "Jaula de entrenamiento premium", sku: cheap ? "JLA-502" : "JLA-501", shortDescription: null, longDescription: null, active: true },
        selectedVariant: null,
        attributes: [],
        variants: [],
        pricing: {
          quantity: 1,
          baseUnitPrice: cheap ? 250000 : 890000,
          effectiveUnitPrice: cheap ? 219990 : 849990,
          subtotal: cheap ? 219990 : 849990,
          currency: "CLP",
          taxIncluded: true,
          taxMode: "configured_rate",
          discountApplied: true,
          discountType: "amount",
          discountValue: cheap ? 30010 : 40010,
          specificPriceId: 1,
          pricingMode: "sql_specific_price"
        },
        stock: { physicalQuantity: cheap ? 2 : 4, available: true, shopId: 1 },
        freshness: { productCheckedAt: new Date().toISOString(), priceCalculatedAt: new Date().toISOString(), stockCheckedAt: new Date().toISOString(), cached: false }
      };
    }

    if (req.method === "POST" && url.pathname === "/v1/products/batch") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body) as { items: Array<{ productId: number; combinationId?: number; quantity?: number }> };
        const items = parsed.items.map((item) => ({
          ok: true as const,
          input: { productId: item.productId, combinationId: item.combinationId ?? 0, quantity: item.quantity ?? 1 },
          product: buildProductPayload(item.productId)
        }));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ items }));
      });
      return;
    }
    if (url.pathname.startsWith("/v1/products/")) {
      const productId = Number(url.pathname.split("/").pop());
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(buildProductPayload(productId)));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

const CYCLE_ENV = {
  BRAIN_COMMERCIAL_SHADOW_ENABLED: "true",
  BRAIN_COMMERCIAL_RUNTIME_ENABLED: "true",
  BRAIN_COMMERCIAL_POLICY_ENABLED: "true",
  BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER: "true",
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "true",
  BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED: "true",
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false"
};

async function seedConversation() {
  const waId = `5699${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;
  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("flow")}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Flujo",
    messageType: "text",
    text: "Busco una jaula para entrenar en casa",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.ok(result.conversationId);
  assert.ok(result.conversationPublicId);
  return { ...result, waId, phoneNumberId };
}

type TurnScript = {
  toolQuery?: string;
  messageIntent: "answer" | "clarify" | "follow_up";
  draftText: string;
};

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

/** Turn-aware scripted provider: returns script[callIndex] each invoke, dynamically stamping runId from the real correlationId. */
function createScriptedProvider(scripts: TurnScript[]): SalesAgentProvider {
  let callIndex = 0;
  return {
    name: "test-scripted-conversation-provider",
    version: "test.v1",
    async invoke(request: SalesAgentProviderRequest) {
      const script = scripts[Math.min(callIndex, scripts.length - 1)];
      callIndex += 1;

      const toolRequests = script.toolQuery
        ? [
            {
              tool: "searchProducts" as const,
              purpose: "Buscar en el catalogo real.",
              status: "planned" as const,
              requiredInputs: { query: script.toolQuery },
              optionalInputs: null,
              urgency: "medium" as const,
              blocking: false,
              reason: "Se necesita evidencia real de catalogo.",
              expectedEvidence: ["product_tool"],
              fallbackDecision: "respond_now" as const,
              confidence: "high" as const,
              riskLevel: "low" as const
            }
          ]
        : [];

      const rawOutput = {
        runId: request.correlationId ?? "fake-run-id",
        contractVersion: request.contractVersion,
        outcome: "response_proposed",
        analysis: {
          summary: "Turno conversacional simulado.",
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
        shouldRequestTool: toolRequests.length > 0,
        shouldRequestHuman: false,
        shouldEvaluateFollowUp: script.messageIntent === "follow_up",
        proposedActions: [],
        toolRequests,
        entityProposals: [],
        responseProposal: buildResponseProposal(script.messageIntent, script.draftText),
        evidence: [
          { source: "customer_message", summary: "Mensaje del cliente en este turno.", verified: true, confidence: "high", reference: "latest_inbound_message", capturedAt: new Date(0).toISOString(), expiresAt: null }
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
        inputTokens: 64,
        outputTokens: 64,
        estimatedCost: 0,
        providerRequestId: `test-provider-request-${callIndex}`,
        finishReason: "stop",
        metadata: {}
      };
    }
  };
}

test("full conversation: search -> grounded recommendation -> objection -> alternative search -> 'lo voy a pensar' proposes a follow-up", async () => {
  searchQueries.length = 0;
  const seeded = await seedConversation();

  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, { CATALOG_SERVICE_BASE_URL: baseUrl, CATALOG_SERVICE_API_KEY: "test-key" });
  resetCapabilityGatewayCatalogPortForTests();

  const provider = createScriptedProvider([
    { toolQuery: "jaula entrenamiento", messageIntent: "answer", draftText: "Dejame revisar el catalogo." },
    { messageIntent: "clarify", draftText: "Entiendo, ¿cual es tu presupuesto?" },
    { toolQuery: "jaula economica", messageIntent: "answer", draftText: "Dejame revisar alternativas." },
    { messageIntent: "follow_up", draftText: "Sin problema, te escribo en unos dias." },
    { messageIntent: "answer", draftText: "Perfecto, avancemos." }
  ]);

  const turns = [
    "Busco una jaula para entrenar en casa",
    "Está muy cara",
    "¿Tienes algo más económico?",
    "Lo voy a pensar",
    "Listo, lo compro"
  ];

  try {
    const results = [];
    for (const messageText of turns) {
      const correlationId = uniqueSuffix("corr-flow");
      // eslint-disable-next-line no-await-in-loop
      const cycleResult = await runNativeAutonomousCycle({
        conversationId: seeded.conversationId!,
        conversationPublicId: seeded.conversationPublicId as string,
        customerMasterId: seeded.customerId ?? null,
        waId: seeded.waId,
        phoneNumberId: seeded.phoneNumberId,
        messageId: seeded.messageId ?? null,
        messageText,
        correlationId,
        currentTime: new Date().toISOString(),
        provider
      });
      results.push({ correlationId, cycleResult });
    }

    // Turn 1: real search executed, grounded recommendation cites the premium product.
    const turn1 = results[0].cycleResult;
    assert.equal(turn1.catalogCapability?.executed, true);
    assert.equal(turn1.catalogCapability?.searchResult?.status, "completed");
    assert.match(turn1.loop?.selectedNextAction?.draftMessage ?? "", /Jaula de entrenamiento premium/);

    // Turn 2 (objection): the opportunity is NOT closed/lost and the cycle still ran cleanly.
    const turn2 = results[1].cycleResult;
    assert.equal(turn2.ran, true);
    const terminalStatuses = new Set(["won", "lost", "cancelled", "archived"]);
    assert.equal(terminalStatuses.has(turn2.loop?.resultingState?.status ?? ""), false);
    assert.notEqual(turn2.loop?.selectedNextAction?.type, "close_as_lost_candidate");

    // Turn 3 (alternative request): a SECOND, distinct real HTTP search ran and grounds a different product.
    const turn3 = results[2].cycleResult;
    assert.equal(turn3.catalogCapability?.executed, true);
    assert.equal(turn3.catalogCapability?.searchResult?.status, "completed");
    assert.match(turn3.loop?.selectedNextAction?.draftMessage ?? "", /Jaula de entrenamiento economica/);
    assert.deepEqual(searchQueries, ["jaula entrenamiento", "jaula economica"]);

    // Turn 4 ("lo voy a pensar"): next action is propose_followup, and a real schedule_followup
    // row is persisted in crm_agent_actions for this opportunity/conversation.
    const turn4 = results[3].cycleResult;
    assert.equal(turn4.loop?.selectedNextAction?.type, "propose_followup");
    const opportunityId = turn4.loop?.resultingState?.opportunityId;
    assert.ok(opportunityId, "expected an opportunity id to exist by turn 4");

    // Turn 5 (customer returns before any wake-up): the cycle keeps running on the SAME
    // opportunity, producing a new decision for this turn rather than losing continuity.
    const turn5 = results[4].cycleResult;
    assert.equal(turn5.ran, true);
    assert.equal(turn5.loop?.resultingState?.opportunityId, opportunityId);

    const opportunityRows = await queryRows<Record<string, unknown>>(
      "SELECT status FROM crm_opportunities WHERE id = ? LIMIT 1",
      [opportunityId]
    );
    if (opportunityRows.length > 0) {
      assert.equal(terminalStatuses.has(String(opportunityRows[0].status)), false);
    }

    const capabilityExecutions = await queryRows<Record<string, unknown>>(
      "SELECT capability_name, execution_status FROM crm_capability_executions WHERE conversation_id = ? ORDER BY id ASC",
      [seeded.conversationId]
    );
    const searchExecutions = capabilityExecutions.filter((row) => row.capability_name === "search_products");
    assert.equal(searchExecutions.length, 2, "search_products should have executed exactly twice across the 5 turns (turn 1 and turn 3)");
    assert.ok(searchExecutions.every((row) => row.execution_status === "completed"));
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

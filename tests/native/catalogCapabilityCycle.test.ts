import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import type { SalesAgentProvider, SalesAgentProviderRequest } from "@/lib/brain/commercial/sales-agent/runtimeTypes";

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

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * A sales agent that drafts a tentative response AND requests searchProducts
 * in the same turn (a realistic pattern: respond now, but ground the draft
 * once the tool result comes back). runId must echo the caller's
 * correlationId, so this cannot be a static fixture.
 */
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
          {
            source: "customer_message",
            summary: "El cliente indico presupuesto y espacio disponible.",
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
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false"
};

async function seedConversation() {
  const waId = `5699${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;
  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("catalog-cycle")}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Catalogo",
    messageType: "text",
    text: "Busco una jaula para entrenar en casa",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.ok(result.conversationId);
  assert.ok(result.conversationPublicId);
  return { ...result, waId, phoneNumberId };
}

test("runNativeAutonomousCycle executes search_products over HTTP, persists it, and grounds the reply in real data", async () => {
  searchRequests = [];
  handler = (req, res) => {
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

  const seeded = await seedConversation();

  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, {
    CATALOG_SERVICE_BASE_URL: baseUrl,
    CATALOG_SERVICE_API_KEY: "test-key"
  });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const correlationId = uniqueSuffix("corr");
    const cycleResult = await runNativeAutonomousCycle({
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

    assert.equal(cycleResult.ran, true);
    assert.ok(cycleResult.catalogCapability, "expected the catalog capability stage to run");
    assert.equal(cycleResult.catalogCapability!.executed, true);
    assert.equal(cycleResult.catalogCapability!.searchResult?.status, "completed");
    assert.equal(searchRequests.length, 1, "the real HTTP search endpoint should have been called exactly once");
    assert.equal(cycleResult.loop?.selectedNextAction?.type, "respond");

    const groundedMessage = cycleResult.loop?.selectedNextAction?.draftMessage ?? "";
    assert.match(groundedMessage, /Jaula de entrenamiento compacta/);

    const executionRows = await queryRows<Record<string, unknown>>(
      "SELECT * FROM crm_capability_executions WHERE correlation_id = ? AND capability_name = 'search_products'",
      [correlationId]
    );
    assert.equal(executionRows.length, 1, "search_products execution should be persisted exactly once");
    assert.equal(executionRows[0].execution_status, "completed");
    assert.equal(executionRows[0].conversation_id, seeded.conversationId);
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

test("when the catalog service is unreachable, the cycle never invents a product and reports a safe, retryable outcome", async () => {
  const seeded = await seedConversation();

  const previousEnv = { ...process.env };
  Object.assign(process.env, CYCLE_ENV, {
    CATALOG_SERVICE_BASE_URL: "http://127.0.0.1:1", // nothing listens here
    CATALOG_SERVICE_API_KEY: "test-key",
    CATALOG_SERVICE_TIMEOUT_MS: "200"
  });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const correlationId = uniqueSuffix("corr-unavailable");
    const cycleResult = await runNativeAutonomousCycle({
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

    assert.equal(cycleResult.catalogCapability!.searchResult?.status, "temporarily_blocked");
    assert.equal(cycleResult.catalogCapability!.searchResult?.retryable, true);
    const groundedMessage = cycleResult.loop?.selectedNextAction?.draftMessage ?? "";
    assert.doesNotMatch(groundedMessage, /Jaula de entrenamiento compacta/);
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows, safeExecute } from "@/lib/db";
import { runAgentToolLoop } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { insertCapabilityExecution } from "@/lib/brain/commercial/capability-gateway/repository";
import { setCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { setShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import type { CommuneResolver } from "@/lib/domains/commune-resolution";
import type { AgentLoopProvider, AgentLoopProviderRequest } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";

/**
 * SALES-AGENT-R3-SHIPPING-CONTEXT-PROJECTION-V1, task section 7/8H. Proves
 * latestShippingQuote reaches the ACTUAL AgentLoopProviderRequest built by
 * buildAgentStepPromptPackage.ts - DB existence alone (see
 * resolveLatestShippingQuoteContext.test.ts) is not sufficient evidence that
 * the model ever sees it. Mirrors selectShippingOptionCapability.test.ts's
 * seeding helpers, never a second implementation of the same fixtures.
 */

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
  DATABASE_URL: ""
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function seedOpportunity(): Promise<number> {
  const key = `shipping-context-projection-prompt-${uniqueSuffix()}`;
  await safeExecute(
    `INSERT INTO crm_opportunities (opportunity_key, requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json)
     VALUES (?, '{}', '[]', '[]', '[]', '[]')`,
    [key]
  );
  const rows = await queryRows<{ id: number }>(`SELECT id FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1`, [key]);
  return rows[0].id;
}

async function seedConversation(): Promise<number> {
  const externalContactId = `scpp-${uniqueSuffix()}`;
  await safeExecute(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id) VALUES (UUID(), 'whatsapp', 'meta', ?, ?)`,
    ["scpp-test-channel", externalContactId]
  );
  const rows = await queryRows<{ id: number }>(`SELECT id FROM conversation WHERE external_contact_id = ? LIMIT 1`, [externalContactId]);
  return rows[0].id;
}

function fakeCommuneResolver(communeId: number, canonicalName: string): CommuneResolver {
  return { async resolve() { return { status: "resolved", communeId, canonicalName, matchedVia: "direct" }; } };
}

async function seedFreshFacts(opportunityId: number): Promise<{ selectionFactId: string; destinationFactId: string }> {
  const lineItems = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "545", combinationId: null, quantity: 2 }] });
  assert.equal(lineItems.ok, true);
  if (!lineItems.ok) throw new Error("seedFreshFacts: commercial_line_items seed failed");

  const destination = await setShippingDestinationForOpportunity({ opportunityId, inputText: "Ñuñoa" }, { resolver: fakeCommuneResolver(99, "Ñuñoa") });
  assert.equal(destination.ok, true);
  if (!destination.ok) throw new Error("seedFreshFacts: shipping_destination seed failed");

  return { selectionFactId: lineItems.selection.factId, destinationFactId: destination.destination.factId };
}

async function seedCompletedCalculateShipping(opportunityId: number, conversationId: number, factIds: { selectionFactId: string; destinationFactId: string }) {
  const now = new Date().toISOString();
  const result = await insertCapabilityExecution({
    correlationId: `corr-${uniqueSuffix()}`,
    capabilityName: "calculate_shipping",
    capabilityVersion: "capability-gateway.v1",
    availabilityStatus: "available",
    executionStatus: "completed",
    retryCount: 0,
    retryable: false,
    errorCode: null,
    requestSummary: {},
    responseSummary: {
      status: "available",
      destination: { communeId: 99, canonicalName: "Ñuñoa" },
      totalWeightKg: 12.5,
      totalBoleta: 29990,
      options: [
        { index: 0, carrierName: "Chilexpress", serviceType: "standard", totalCost: 4990, estimatedDelivery: "3-5 dias habiles" },
        { index: 1, carrierName: "Starken", serviceType: "express", totalCost: 6990, estimatedDelivery: "1-2 dias habiles" }
      ],
      selectionFactId: factIds.selectionFactId,
      destinationFactId: factIds.destinationFactId
    },
    evidence: [],
    opportunityId,
    conversationId,
    startedAt: now,
    completedAt: now
  });
  assert.equal(result.ok, true, result.error ?? undefined);
}

/** Records every request this loop sends the model, then answers with a fixed respond step - never reached in more than one decision for these tests. */
function createRecordingProvider(): { provider: AgentLoopProvider; requests: AgentLoopProviderRequest[] } {
  const requests: AgentLoopProviderRequest[] = [];
  const provider: AgentLoopProvider = {
    name: "recording-fake-provider",
    version: "fake.v1",
    async invoke(request) {
      requests.push(request);
      return {
        rawOutput: { type: "respond", message: "Perfecto, elegiste el envio Starken express." },
        model: "fake-model",
        inputTokens: 10,
        outputTokens: 10,
        providerRequestId: `fake-${requests.length}`,
        finishReason: "stop"
      };
    }
  };
  return { provider, requests };
}

function userPayload(requests: AgentLoopProviderRequest[]): Record<string, unknown> {
  const userMessage = requests[0]?.messages.find((message) => message.role === "user");
  assert.ok(userMessage, "the provider request must include a user message");
  return JSON.parse(userMessage!.content) as Record<string, unknown>;
}

test("H. a fresh calculate_shipping quote reaches the actual provider request as commercialContext.latestShippingQuote", async () => {
  const opportunityId = await seedOpportunity();
  const conversationId = await seedConversation();
  const factIds = await seedFreshFacts(opportunityId);
  await seedCompletedCalculateShipping(opportunityId, conversationId, factIds);

  const { provider, requests } = createRecordingProvider();
  await runAgentToolLoop({
    correlationId: `corr-${uniqueSuffix()}`,
    conversationId,
    opportunityId,
    currentTime: new Date().toISOString(),
    customerMessage: "elige la segunda",
    commercialContextSummary: {
      commercialLineItems: { items: [{ productId: "545", combinationId: null, quantity: 2 }] },
      shippingDestination: { communeId: 99, canonicalName: "Ñuñoa" }
    },
    provider
  });

  const payload = userPayload(requests);
  const commercialContext = payload.commercialContext as Record<string, unknown>;
  assert.deepEqual(commercialContext.latestShippingQuote, {
    sourceExecutionId: (commercialContext.latestShippingQuote as { sourceExecutionId: string }).sourceExecutionId,
    destination: { communeId: 99, canonicalName: "Ñuñoa" },
    totalWeightKg: 12.5,
    totalBoleta: 29990,
    options: [
      { index: 0, carrierName: "Chilexpress", serviceType: "standard", totalCost: 4990, estimatedDelivery: "3-5 dias habiles" },
      { index: 1, carrierName: "Starken", serviceType: "express", totalCost: 6990, estimatedDelivery: "1-2 dias habiles" }
    ]
  });
});

test("a stale quote (selection changed since calculate_shipping ran) never reaches the provider request", async () => {
  const opportunityId = await seedOpportunity();
  const conversationId = await seedConversation();
  const factIds = await seedFreshFacts(opportunityId);
  await seedCompletedCalculateShipping(opportunityId, conversationId, factIds);

  const changed = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "999", combinationId: null, quantity: 1 }] });
  assert.equal(changed.ok, true);

  const { provider, requests } = createRecordingProvider();
  await runAgentToolLoop({
    correlationId: `corr-${uniqueSuffix()}`,
    conversationId,
    opportunityId,
    currentTime: new Date().toISOString(),
    customerMessage: "elige la segunda",
    commercialContextSummary: {},
    provider
  });

  const payload = userPayload(requests);
  const commercialContext = payload.commercialContext as Record<string, unknown>;
  assert.equal(commercialContext.latestShippingQuote, undefined);
});

test("no opportunityId this turn -> no shipping-quote lookup is even attempted, no latestShippingQuote key", async () => {
  const conversationId = await seedConversation();
  const { provider, requests } = createRecordingProvider();

  await runAgentToolLoop({
    correlationId: `corr-${uniqueSuffix()}`,
    conversationId,
    opportunityId: null,
    currentTime: new Date().toISOString(),
    customerMessage: "hola",
    commercialContextSummary: {},
    provider
  });

  const payload = userPayload(requests);
  const commercialContext = payload.commercialContext as Record<string, unknown>;
  assert.equal(commercialContext.latestShippingQuote, undefined);
});

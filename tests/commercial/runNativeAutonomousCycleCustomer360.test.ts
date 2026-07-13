import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import type { SalesAgentProvider, SalesAgentProviderRequest } from "@/lib/brain/commercial/sales-agent/runtimeTypes";
import type { Customer360LoadResult } from "@/lib/domains/customer-360";
import type { ResolveNativeCustomerSessionDependencies } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { CustomerOnboardingService, CustomerOnboardingState } from "@/lib/domains/customer-onboarding";

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

// ACS-R1-04-T06.2. The native WhatsApp inbound no longer resolves a
// provisional customer for an unknown sender (that authority moved to
// Customer Service). Seeding links a real master_customer to the waId
// directly before sending the inbound - mirroring
// tests/native/identity-conflict.test.ts.
async function seedConversation() {
  const waId = `5699${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;

  const customer = await createMasterCustomer({
    firstname: "Cliente",
    lastname: "Customer360",
    email: `customer360-${uniqueSuffix("seed")}@example.com`,
    platformOrigin: "whatsapp"
  });
  assert.ok(customer.ok, customer.ok ? "" : customer.error);
  const customerId = Number(customer.data.id);
  await queryRows(
    `
      INSERT INTO customer_external_identity (customer_id, provider, identity_type, external_id, normalized_value, is_verified, created_at, updated_at)
      VALUES (?, 'whatsapp', 'phone_number', ?, ?, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    `,
    [customerId, waId, waId]
  );

  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("c360-cycle")}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Customer360",
    messageType: "text",
    text: "Hola, tengo una consulta",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.ok(result.conversationId);
  assert.ok(result.conversationPublicId);
  assert.equal(result.customerId, customerId);
  return { ...result, waId, phoneNumberId };
}

function countingLoader(result: Customer360LoadResult | (() => Customer360LoadResult) | (() => never)) {
  const calls: string[] = [];
  return {
    calls,
    async loadCustomer360(customerId: string): Promise<Customer360LoadResult> {
      calls.push(customerId);
      return typeof result === "function" ? (result as () => Customer360LoadResult)() : result;
    }
  };
}

const NOT_FOUND: Customer360LoadResult = { status: "not_found", snapshot: null, warnings: [] };

function notUsedInTest(name: string) {
  return async () => {
    throw new Error(`${name} must not be called in this test`);
  };
}

/**
 * ACS-R1-04-T06 gates the Customer 360 load behind contextAccess (task
 * section 11) - an identified customer alone no longer authorizes a load.
 * These tests care only about Customer 360 loading mechanics, so they inject
 * a fixed "identified customer + active quote onboarding" session (the
 * documented commercial_history case) instead of exercising real identity
 * resolution, which has its own dedicated T06 test coverage.
 */
function commercialHistorySessionDependencies(conversationId: string, customerId: string): ResolveNativeCustomerSessionDependencies {
  // status "completed" (with a customerId matching the identity fake) grants
  // commercial_history without resolveNativeCustomerSession attempting any
  // onboarding transition - keeps the onboardingService fake fully inert.
  const onboardingState: CustomerOnboardingState = {
    id: 1,
    conversationId,
    opportunityId: null,
    status: "completed",
    purpose: "quote",
    collected: {},
    pendingFields: [],
    customerId,
    failedVerificationAttempts: 0,
    version: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString()
  };
  const onboardingService: CustomerOnboardingService = {
    async getState() {
      return onboardingState;
    },
    startOnboarding: notUsedInTest("startOnboarding"),
    collectFields: notUsedInTest("collectFields"),
    markResolving: notUsedInTest("markResolving"),
    completeOnboarding: notUsedInTest("completeOnboarding"),
    markConflict: notUsedInTest("markConflict"),
    markTemporarilyUnavailable: notUsedInTest("markTemporarilyUnavailable"),
    retryResolution: notUsedInTest("retryResolution"),
    recordVerificationFailure: notUsedInTest("recordVerificationFailure")
  };
  return {
    identityService: {
      async resolveIdentity() {
        return { status: "identified", customerId, matchedBy: "phone", confidence: "verified", conflicts: [], warnings: [] };
      }
    },
    onboardingService
  };
}

/** Minimal provider: responds now, requests no tools, so the pipeline completes without HTTP dependencies. */
function createCapturingSalesAgentProvider(onInvoke: (request: SalesAgentProviderRequest) => void): SalesAgentProvider {
  return {
    name: "test-capturing-provider",
    version: "test.v1",
    async invoke(request: SalesAgentProviderRequest) {
      onInvoke(request);
      return {
        rawOutput: {
          runId: request.correlationId ?? "fake-run-id",
          contractVersion: request.contractVersion,
          outcome: "response_proposed",
          analysis: {
            summary: "Consulta general del cliente.",
            qualificationState: "not_started",
            customerReadiness: "browsing",
            productFit: "not_applicable",
            confidence: "medium",
            riskLevel: "low",
            reasonCodes: ["customer_message_present"]
          },
          decision: {
            type: "respond_now",
            reason: "Hay contexto suficiente para responder.",
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
            draftText: "Hola, cuentame en que te puedo ayudar.",
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
              summary: "Mensaje inbound del cliente.",
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
            summary: "Responder con la informacion disponible.",
            evidence: ["Mensaje inbound del cliente."],
            counterEvidence: [],
            assumptions: [],
            riskFlags: [],
            missingInformation: [],
            policyRulesApplied: []
          },
          metadata: {}
        },
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

const LEGACY_ENV = {
  BRAIN_COMMERCIAL_SHADOW_ENABLED: "true",
  BRAIN_COMMERCIAL_RUNTIME_ENABLED: "true",
  BRAIN_COMMERCIAL_POLICY_ENABLED: "true",
  BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER: "true",
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "false",
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false"
};

function withEnv<T>(overrides: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  Object.assign(process.env, overrides);
  return fn().finally(() => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

// ---------------------------------------------------------------------------
// Native cycle (tests 29-36)
// ---------------------------------------------------------------------------

test("native cycle: Customer 360 loads exactly once per turn (legacy runtime)", async () => {
  await withEnv(LEGACY_ENV, async () => {
    const seeded = await seedConversation();
    assert.ok(seeded.customerId, "seeded conversation must have a customer");
    const loader = countingLoader(NOT_FOUND);
    await runNativeAutonomousCycle({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId,
      messageText: "Hola, tengo una consulta",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: loader.loadCustomer360,
      provider: createCapturingSalesAgentProvider(() => {}),
      customerSessionDependencies: commercialHistorySessionDependencies(String(seeded.conversationId), String(seeded.customerId))
    });
    assert.equal(loader.calls.length, 1);
  });
});

test("native cycle: no customerMasterId means zero Customer 360 calls", async () => {
  await withEnv(LEGACY_ENV, async () => {
    const seeded = await seedConversation();
    const loader = countingLoader(NOT_FOUND);
    await runNativeAutonomousCycle({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId,
      messageText: "Hola, tengo una consulta",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: loader.loadCustomer360,
      provider: createCapturingSalesAgentProvider(() => {})
    });
    assert.equal(loader.calls.length, 0);
  });
});

test("native cycle: the legacy runtime receives the reduced Customer 360 projection, never the full snapshot", async () => {
  await withEnv(LEGACY_ENV, async () => {
    const seeded = await seedConversation();
    assert.ok(seeded.customerId, "seeded conversation must have a customer");
    const loader = countingLoader(NOT_FOUND);
    let captured: SalesAgentProviderRequest | null = null;
    await runNativeAutonomousCycle({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId,
      messageText: "Hola, tengo una consulta",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: loader.loadCustomer360,
      provider: createCapturingSalesAgentProvider((request) => {
        captured = request;
      }),
      customerSessionDependencies: commercialHistorySessionDependencies(String(seeded.conversationId), String(seeded.customerId))
    });
    assert.ok(captured, "provider must have been invoked");
    const input = (captured as unknown as SalesAgentProviderRequest).salesAgentInput;
    assert.equal(input.customer360State, "not_found");
    assert.equal(input.customer360, null);
    assert.equal("sections" in (input as unknown as Record<string, unknown>), false);
  });
});

test("native cycle: a Customer 360 failure never stops the cycle", async () => {
  await withEnv(LEGACY_ENV, async () => {
    const seeded = await seedConversation();
    assert.ok(seeded.customerId, "seeded conversation must have a customer");
    const loader = countingLoader(() => {
      throw new Error("customer 360 exploded");
    });
    const result = await runNativeAutonomousCycle({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId,
      messageText: "Hola, tengo una consulta",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: loader.loadCustomer360,
      provider: createCapturingSalesAgentProvider(() => {}),
      customerSessionDependencies: commercialHistorySessionDependencies(String(seeded.conversationId), String(seeded.customerId))
    });
    assert.equal(result.ran, true);
    assert.equal(result.customerContextState, "unavailable");
  });
});

test("native cycle: Customer 360 warnings are visible on the final result", async () => {
  await withEnv(LEGACY_ENV, async () => {
    const seeded = await seedConversation();
    assert.ok(seeded.customerId, "seeded conversation must have a customer");
    const loader = countingLoader(NOT_FOUND);
    const result = await runNativeAutonomousCycle({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId,
      messageText: "Hola, tengo una consulta",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: loader.loadCustomer360,
      provider: createCapturingSalesAgentProvider(() => {}),
      customerSessionDependencies: commercialHistorySessionDependencies(String(seeded.conversationId), String(seeded.customerId))
    });
    assert.ok(result.warnings.includes("customer_360_not_found"));
  });
});

test("native cycle: multi-request and legacy never both execute in the same turn", async () => {
  const seeded = await seedConversation();

  const multiResult = await withEnv({ ...LEGACY_ENV, BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "true", BRAIN_REQUEST_TRACKING_ENABLED: "true", BRAIN_TURN_PLAN_PERSISTENCE_ENABLED: "true" }, () =>
    runNativeAutonomousCycle({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: seeded.customerId ?? null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId,
      messageText: "Cotizame una banca",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: countingLoader(NOT_FOUND).loadCustomer360
    })
  );
  assert.notEqual(multiResult.multiRequest, null);
  assert.equal(multiResult.shadow, null);
  assert.equal(multiResult.loop, null);
  assert.equal(multiResult.bridge, null);
});

test("native cycle: a fully disabled runtime never loads Customer 360", async () => {
  await withEnv(
    {
      BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false",
      BRAIN_SALES_AGENT_ENABLED: "false",
      BRAIN_COMMERCIAL_SHADOW_ENABLED: "false",
      BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "false"
    },
    async () => {
      const seeded = await seedConversation();
      const loader = countingLoader(NOT_FOUND);
      const result = await runNativeAutonomousCycle({
        conversationId: seeded.conversationId!,
        conversationPublicId: seeded.conversationPublicId as string,
        customerMasterId: seeded.customerId ?? null,
        waId: seeded.waId,
        phoneNumberId: seeded.phoneNumberId,
        messageId: seeded.messageId,
        messageText: "Hola",
        correlationId: uniqueSuffix("corr"),
        currentTime: new Date().toISOString(),
        loadCustomer360: loader.loadCustomer360
      });
      assert.equal(result.ran, false);
      assert.equal(loader.calls.length, 0);
    }
  );
});

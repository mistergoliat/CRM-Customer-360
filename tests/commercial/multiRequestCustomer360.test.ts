import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { buildTurnPlanInputHash, runMultiRequestAutonomousCycle } from "@/lib/brain/commercial/multi-request";
import type { TurnPlannerProvider, TurnPlannerProviderInput } from "@/lib/brain/commercial/multi-request";
import type { AutonomousCustomerContext } from "@/lib/brain/commercial/context";

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
  BRAIN_REQUEST_TRACKING_ENABLED: "true",
  BRAIN_TURN_PLAN_PERSISTENCE_ENABLED: "true"
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

function uniqueConversationId() {
  return 900000000 + Math.floor(Math.random() * 99999999);
}

function makeCustomerContext(overrides: Partial<AutonomousCustomerContext> = {}): AutonomousCustomerContext {
  return {
    contractName: "AutonomousCustomerContext",
    schemaVersion: "1.0.0",
    profile: { displayName: "Camila Rojas", emailAvailable: true },
    relationshipSummary: { conversationCount: 1, opportunityCount: 1, quoteCount: 0, orderCount: 0, lastActivityAt: "2026-07-08T12:00:00.000Z" },
    commercialHistory: { recentOpportunities: [], recentNeedProfiles: [], recentQuotes: [] },
    dataQuality: { freshness: "fresh", completeness: "complete", completenessScore: 100, unavailableSections: [] },
    ...overrides
  };
}

function capturingProvider(onPlan: (input: TurnPlannerProviderInput) => void, callCounter: { count: number }): TurnPlannerProvider {
  return {
    name: "test-capturing-turn-planner",
    async plan(input: TurnPlannerProviderInput) {
      callCounter.count += 1;
      onPlan(input);
      return {
        detections: [
          {
            detectionId: `det-${callCounter.count}`,
            rawIntent: "general_question",
            canonicalIntent: "general_question",
            domain: "general",
            confidence: 0.4,
            suggestedOperation: "create_request",
            candidateRequestId: null,
            extractedFacts: []
          }
        ]
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Multi-request (tests 31, 37-42)
// ---------------------------------------------------------------------------

test("multi-request: runMultiRequestAutonomousCycle passes the reduced Customer 360 projection down to the planner", async () => {
  const callCounter = { count: 0 };
  let captured: TurnPlannerProviderInput | null = null;
  const customerContext = makeCustomerContext();

  await runMultiRequestAutonomousCycle({
    conversationId: uniqueConversationId(),
    inboundMessageId: uniqueSuffix("cm"),
    messageText: "Hola, tengo una consulta",
    correlationId: uniqueSuffix("corr"),
    provider: capturingProvider((input) => {
      captured = input;
    }, callCounter),
    customerContext,
    customerContextState: "available"
  });

  assert.ok(captured, "the planner provider must have been invoked");
  assert.deepEqual((captured as unknown as TurnPlannerProviderInput).customerContext, customerContext);
  assert.equal((captured as unknown as TurnPlannerProviderInput).customerContextState, "available");
});

test("TurnPlannerProviderInput carries only the reduced projection, never the full Customer360Snapshot shape", async () => {
  const callCounter = { count: 0 };
  let captured: TurnPlannerProviderInput | null = null;

  await runMultiRequestAutonomousCycle({
    conversationId: uniqueConversationId(),
    inboundMessageId: uniqueSuffix("cm"),
    messageText: "Hola",
    correlationId: uniqueSuffix("corr"),
    provider: capturingProvider((input) => {
      captured = input;
    }, callCounter),
    customerContext: makeCustomerContext(),
    customerContextState: "available"
  });

  const context = (captured as unknown as TurnPlannerProviderInput).customerContext as unknown as Record<string, unknown>;
  assert.equal("sections" in context, false);
  assert.equal("identity" in context, false);
  assert.equal("lifecycle" in context, false);
  assert.equal("customerId" in context, false);
});

test("the deterministic provider still works when it receives (and ignores) a customer context", async () => {
  const conversationId = uniqueConversationId();
  const result = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId: uniqueSuffix("cm"),
    messageText: "Cotizame una banca",
    correlationId: uniqueSuffix("corr"),
    customerContext: makeCustomerContext(),
    customerContextState: "available"
  });
  assert.equal(result.ran, true);
});

test("buildTurnPlanInputHash changes when the customer context changes", () => {
  const base = { messageText: "hola", candidates: [] as const };
  const withoutContext = buildTurnPlanInputHash({ ...base, customerContext: null, customerContextState: "not_requested" });
  const withContext = buildTurnPlanInputHash({ ...base, customerContext: makeCustomerContext(), customerContextState: "available" });
  const withDifferentContext = buildTurnPlanInputHash({
    ...base,
    customerContext: makeCustomerContext({ relationshipSummary: { conversationCount: 9, opportunityCount: 1, quoteCount: 0, orderCount: 0, lastActivityAt: null } }),
    customerContextState: "available"
  });

  assert.notEqual(withoutContext, withContext);
  assert.notEqual(withContext, withDifferentContext);
});

test("buildTurnPlanInputHash does not depend on lastRefreshedAt-like read metadata", () => {
  const base = { messageText: "hola", candidates: [] as const, customerContext: makeCustomerContext(), customerContextState: "available" as const };
  const first = buildTurnPlanInputHash(base);
  // AutonomousCustomerContext has no lastRefreshedAt field at all - re-hashing
  // the identical value at a "later" moment must be byte-for-byte identical.
  const second = buildTurnPlanInputHash({ ...base });
  assert.equal(first, second);
  assert.equal("lastRefreshedAt" in (base.customerContext as unknown as Record<string, unknown>), false);
});

test("a retry of the same inbound reuses the persisted plan and does not call the planner again", async () => {
  const conversationId = uniqueConversationId();
  const inboundMessageId = uniqueSuffix("cm");
  const callCounter = { count: 0 };
  const provider = capturingProvider(() => {}, callCounter);

  const first = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId,
    messageText: "Hola, tengo una consulta",
    correlationId: uniqueSuffix("corr"),
    provider,
    customerContext: makeCustomerContext(),
    customerContextState: "available"
  });
  assert.equal(first.planReused, false);
  assert.equal(callCounter.count, 1);

  // Retry: same inbound, but this time with a DIFFERENT customer context
  // (e.g. Customer 360 became available after the first attempt). The
  // persisted plan still wins - the planner is not invoked a second time.
  const retry = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId,
    messageText: "Hola, tengo una consulta",
    correlationId: uniqueSuffix("corr-retry"),
    provider,
    customerContext: makeCustomerContext({ relationshipSummary: { conversationCount: 42, opportunityCount: 1, quoteCount: 0, orderCount: 0, lastActivityAt: null } }),
    customerContextState: "available"
  });
  assert.equal(retry.planReused, true);
  assert.equal(retry.turnPlan?.turnPlanId, first.turnPlan?.turnPlanId);
  assert.equal(callCounter.count, 1, "the planner must not be called again on retry");
});

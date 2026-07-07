import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import {
  buildDeterministicCandidates,
  createDeterministicTurnPlannerProvider,
  linkRequestsToIntents,
  runMultiRequestAutonomousCycle,
  validateTurnPlan,
  DEFAULT_TURN_PLAN_EXECUTION_BUDGET
} from "@/lib/brain/commercial/multi-request";
import type { DetectedTurnIntent, TurnPlan } from "@/lib/brain/commercial/multi-request";
import { listRequestMessageLinks, loadConversationRequest } from "@/lib/brain/commercial/conversation-request";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle";
import type { RequestCandidate } from "@/lib/brain/commercial/multi-request";

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

function makeCandidate(overrides: Partial<RequestCandidate> = {}): RequestCandidate {
  return {
    requestId: uniqueSuffix("req"),
    intentType: "product_quote",
    intentDomain: "sales",
    status: "active",
    updatedAt: "2026-07-03T12:00:00.000Z",
    ...overrides
  };
}

function makeDetection(overrides: Partial<DetectedTurnIntent> = {}): DetectedTurnIntent {
  return {
    detectionId: uniqueSuffix("det"),
    rawIntent: "product_quote",
    canonicalIntent: "product_quote",
    domain: "sales",
    confidence: 0.8,
    suggestedOperation: "continue_request",
    candidateRequestId: null,
    extractedFacts: [],
    ...overrides
  };
}

// --- Unit: deterministic provider -------------------------------------------------

test("deterministic provider detects multiple intents in one message", async () => {
  const provider = createDeterministicTurnPlannerProvider();
  const output = await provider.plan({
    messageText: "Quiero cotizar una banca, saber cuánto sale la mantención de mi trotadora y revisar dónde está mi pedido",
    candidates: []
  });

  const intents = output.detections.map((detection) => detection.canonicalIntent);
  assert.ok(intents.includes("product_quote"), `expected product_quote in ${intents.join(",")}`);
  assert.ok(intents.includes("maintenance_quote"), `expected maintenance_quote in ${intents.join(",")}`);
  assert.ok(intents.includes("order_status"), `expected order_status in ${intents.join(",")}`);
  assert.equal(new Set(output.detections.map((detection) => detection.detectionId)).size, output.detections.length);
});

test("deterministic provider falls back to general_question and handles empty messages", async () => {
  const provider = createDeterministicTurnPlannerProvider();
  const fallback = await provider.plan({ messageText: "hola buenas tardes", candidates: [] });
  assert.equal(fallback.detections.length, 1);
  assert.equal(fallback.detections[0].canonicalIntent, "general_question");

  const empty = await provider.plan({ messageText: "   ", candidates: [] });
  assert.equal(empty.detections.length, 0);
});

// --- Unit: linker ------------------------------------------------------------------

test("linker honors an explicit candidate reference above everything else", () => {
  const target = makeCandidate({ requestId: "req-explicit", updatedAt: "2026-07-01T00:00:00.000Z" });
  const newer = makeCandidate({ requestId: "req-newer", updatedAt: "2026-07-03T00:00:00.000Z" });
  const detection = makeDetection({ candidateRequestId: "req-explicit" });

  const [operation] = linkRequestsToIntents([detection], [newer, target]);
  assert.equal(operation.operation, "continue");
  assert.equal(operation.requestId, "req-explicit");
  assert.equal(operation.strategy, "explicit_reference");
});

test("linker continues the single active same-intent request and creates when none exists", () => {
  const active = makeCandidate({ requestId: "req-only" });
  const [continued] = linkRequestsToIntents([makeDetection()], [active]);
  assert.equal(continued.operation, "continue");
  assert.equal(continued.requestId, "req-only");
  assert.equal(continued.strategy, "intent_and_fact_match");

  const [created] = linkRequestsToIntents([makeDetection({ suggestedOperation: "create_request" })], []);
  assert.equal(created.operation, "create");
  assert.equal(created.requestId, null);
  assert.equal(created.strategy, "new_request");
});

test("linker defaults ambiguous same-intent matches to the most recent, flagged as such", () => {
  const older = makeCandidate({ requestId: "req-older", updatedAt: "2026-07-01T00:00:00.000Z" });
  const newer = makeCandidate({ requestId: "req-newer", updatedAt: "2026-07-03T00:00:00.000Z" });
  const candidates = buildDeterministicCandidates([
    // buildDeterministicCandidates sorts desc by updatedAt regardless of input order
    { ...older, contractName: "ConversationRequest", schemaVersion: "1.0.0", creationKey: "k1", conversationId: 1, opportunityId: null, priority: "normal", parentRequestId: null, createdFromMessageId: "m", resolution: null, createdAt: older.updatedAt, resolvedAt: null } as never,
    { ...newer, contractName: "ConversationRequest", schemaVersion: "1.0.0", creationKey: "k2", conversationId: 1, opportunityId: null, priority: "normal", parentRequestId: null, createdFromMessageId: "m", resolution: null, createdAt: newer.updatedAt, resolvedAt: null } as never
  ]);

  const [operation] = linkRequestsToIntents([makeDetection()], candidates);
  assert.equal(operation.operation, "continue");
  assert.equal(operation.requestId, "req-newer");
  assert.equal(operation.strategy, "active_recent_request");
  assert.equal(operation.reasonCode, "ambiguous_same_intent_defaulted_to_recent");
});

// --- Unit: plan validation ----------------------------------------------------------

function makeValidPlan(): TurnPlan {
  const detection = makeDetection({ detectionId: "det-a" });
  return {
    contractName: "TurnPlan",
    schemaVersion: "1.0.0",
    detections: [detection],
    requestOperations: [
      {
        detectionId: "det-a",
        operation: "create",
        requestId: null,
        intentType: "product_quote",
        intentDomain: "sales",
        strategy: "new_request",
        confidence: 0.8,
        reasonCode: "no_active_request_for_intent"
      }
    ],
    proposedFacts: [],
    requestPlans: [],
    responseRequirements: [],
    executionBudget: DEFAULT_TURN_PLAN_EXECUTION_BUDGET
  };
}

test("validateTurnPlan accepts a valid plan and rejects structural defects fail-closed", () => {
  assert.equal(validateTurnPlan(makeValidPlan()).valid, true);

  const duplicated = makeValidPlan();
  duplicated.detections = [makeDetection({ detectionId: "det-a" }), makeDetection({ detectionId: "det-a" })];
  assert.equal(validateTurnPlan(duplicated).valid, false);

  const orphanOperation = makeValidPlan();
  orphanOperation.requestOperations[0] = { ...orphanOperation.requestOperations[0], detectionId: "det-ghost" };
  assert.equal(validateTurnPlan(orphanOperation).valid, false);

  const missingRequestId = makeValidPlan();
  missingRequestId.requestOperations[0] = { ...missingRequestId.requestOperations[0], operation: "continue", requestId: null };
  assert.equal(validateTurnPlan(missingRequestId).valid, false);

  const badBudget = makeValidPlan();
  badBudget.executionBudget = { ...badBudget.executionBudget, deadlineMs: 0 };
  assert.equal(validateTurnPlan(badBudget).valid, false);
});

// --- Integration: full cycle against the real DB ------------------------------------

test("multi-intent inbound creates independent requests; a retry reuses the plan without duplicating", async () => {
  const conversationId = uniqueConversationId();
  const inboundMessageId = uniqueSuffix("cm");
  const messageText = "Quiero cotizar una banca, saber cuánto sale la mantención de mi trotadora y revisar dónde está mi pedido";

  const first = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId,
    messageText,
    correlationId: uniqueSuffix("corr")
  });

  assert.equal(first.ran, true);
  assert.equal(first.planReused, false);
  assert.equal(first.turnPlan?.status, "executed");
  const createdIds = first.appliedOperations.filter((op) => op.operation === "create").map((op) => op.requestId);
  assert.equal(createdIds.length, 3);
  assert.equal(first.activeRequests.length, 3);
  // All three definitions demand facts nobody provided yet, so the definition
  // reducer parks each request as waiting_customer after activating it.
  assert.equal(first.activeRequests.every((request) => request.status === "waiting_customer"), true);
  assert.equal(first.reducedStates.filter((state) => state.toStatus === "active").length, 3);
  const intents = new Set(first.activeRequests.map((request) => request.intentType));
  assert.deepEqual([...intents].sort(), ["maintenance_quote", "order_status", "product_quote"]);

  // The cycle drafts ONE consolidated response covering every request; it never sends.
  assert.notEqual(first.responseDraft, null);
  assert.equal(first.responseDraft?.usedFallback, false);
  assert.ok(first.responseDraft!.text.includes("cotización"));
  assert.ok(first.responseDraft!.text.includes("pedido"));
  assert.ok(first.responseDraft!.text.includes("mantención"));
  // And it asks only for what is missing, per request.
  assert.ok(first.responseDraft!.text.includes("Para avanzar"));

  // Every request is linked to the inbound message that created it.
  for (const requestId of createdIds) {
    const links = await listRequestMessageLinks(requestId!);
    assert.equal(links.some((link) => link.messageId === inboundMessageId && link.relationType === "created"), true);
  }

  // Retry of the SAME inbound: plan reused, zero new requests, same request ids.
  const retry = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId,
    messageText,
    correlationId: uniqueSuffix("corr-retry")
  });
  assert.equal(retry.ran, true);
  assert.equal(retry.planReused, true);
  assert.equal(retry.turnPlan?.turnPlanId, first.turnPlan?.turnPlanId);
  assert.equal(retry.activeRequests.length, 3);
  assert.deepEqual(
    retry.activeRequests.map((request) => request.requestId).sort(),
    first.activeRequests.map((request) => request.requestId).sort()
  );
});

test("a later same-intent message continues the existing request instead of creating another", async () => {
  const conversationId = uniqueConversationId();

  const firstTurn = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId: uniqueSuffix("cm"),
    messageText: "Quiero cotizar una banca plana",
    correlationId: uniqueSuffix("corr")
  });
  assert.equal(firstTurn.activeRequests.length, 1);
  const requestId = firstTurn.activeRequests[0].requestId;

  const secondInbound = uniqueSuffix("cm");
  const secondTurn = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId: secondInbound,
    messageText: "Sobre la cotización, ¿me incluyes el despacho?",
    correlationId: uniqueSuffix("corr")
  });

  assert.equal(secondTurn.activeRequests.length, 1);
  assert.equal(secondTurn.activeRequests[0].requestId, requestId);
  const continueOp = secondTurn.appliedOperations.find((op) => op.requestId === requestId);
  assert.equal(continueOp?.operation, "continue");

  const links = await listRequestMessageLinks(requestId);
  assert.equal(links.some((link) => link.messageId === secondInbound && link.relationType === "continued"), true);
});

test("a waiting_customer request reactivates when the customer answers it", async () => {
  const conversationId = uniqueConversationId();
  const firstTurn = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId: uniqueSuffix("cm"),
    messageText: "Necesito cotización de una jaula de potencia",
    correlationId: uniqueSuffix("corr")
  });
  const requestId = firstTurn.activeRequests[0].requestId;

  // The definition reducer already parked it: product_quote misses its
  // required "products" fact, so turn 1 ends in waiting_customer by itself.
  const parked = await loadConversationRequest(requestId);
  assert.equal(parked?.status, "waiting_customer");

  const reply = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId: uniqueSuffix("cm"),
    messageText: "Sí, cotízala con 100 kg de discos",
    correlationId: uniqueSuffix("corr")
  });

  // The reply reactivated the request during the turn; since its required
  // facts are still missing, the definition reducer parks it as
  // waiting_customer again - it never stays stuck in the OLD wait.
  assert.equal(reply.reducedStates.some((state) => state.requestId === requestId && state.toStatus === "active"), true);
  const afterReply = await loadConversationRequest(requestId);
  assert.equal(afterReply?.status, "waiting_customer");
  assert.equal(reply.definitionReductions.some((result) => result.decision.requestId === requestId && result.decision.reasons.some((reason) => reason.startsWith("missing_required_fact:"))), true);
});

test("the native cycle routes to the multi-request runtime when the master flag is on, and never half-activates", async () => {
  process.env.BRAIN_MULTI_REQUEST_RUNTIME_ENABLED = "true";
  try {
    const result = await runNativeAutonomousCycle({
      conversationId: uniqueConversationId(),
      conversationPublicId: uniqueSuffix("conv-pub"),
      customerMasterId: null,
      waId: "56990000001",
      phoneNumberId: "phone-001",
      messageId: uniqueSuffix("cm"),
      messageText: "Cotízame una trotadora",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString()
    });

    assert.equal(result.ran, true);
    // The legacy pipeline never runs in the same turn.
    assert.equal(result.shadow, null);
    assert.equal(result.loop, null);
    assert.equal(result.bridge, null);
    assert.equal(result.multiRequest?.ran, true);
    assert.equal(result.multiRequest?.activeRequests.length, 1);

    // Dependency guard: master flag on but tracking off must refuse to run.
    process.env.BRAIN_REQUEST_TRACKING_ENABLED = "false";
    const refused = await runNativeAutonomousCycle({
      conversationId: uniqueConversationId(),
      conversationPublicId: uniqueSuffix("conv-pub"),
      customerMasterId: null,
      waId: "56990000001",
      phoneNumberId: "phone-001",
      messageId: uniqueSuffix("cm"),
      messageText: "Cotízame una trotadora",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString()
    });
    assert.equal(refused.ran, false);
    assert.equal(refused.reason, "multi_request_dependencies_disabled");
  } finally {
    process.env.BRAIN_MULTI_REQUEST_RUNTIME_ENABLED = "false";
    process.env.BRAIN_REQUEST_TRACKING_ENABLED = "true";
  }
});

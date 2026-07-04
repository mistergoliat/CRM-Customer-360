import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeExecute } from "@/lib/db";
import {
  confirmRequestFact,
  getActiveRequestFact,
  listActiveRequestFacts,
  listRequestFactHistory,
  rejectRequestFact,
  supersedeRequestFact,
  upsertRequestFact,
  verifyRequestFact,
  REQUEST_FACT_TABLE
} from "@/lib/brain/commercial/request-facts";
import { createConversationRequest } from "@/lib/brain/commercial/conversation-request";
import { persistProposedFacts, runMultiRequestAutonomousCycle } from "@/lib/brain/commercial/multi-request";
import type { TurnPlannerProvider } from "@/lib/brain/commercial/multi-request";

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
  BRAIN_TURN_PLAN_PERSISTENCE_ENABLED: "true",
  BRAIN_REQUEST_FACTS_ENABLED: "true"
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

async function makeRequest(conversationId = uniqueConversationId()) {
  const created = await createConversationRequest({
    creationKey: uniqueSuffix("creation"),
    conversationId,
    intentType: "product_quote",
    intentDomain: "sales",
    createdFromMessageId: uniqueSuffix("cm")
  });
  assert.equal(created.ok, true);
  return created.request!;
}

test("upsert versions a fact: the old row is superseded, the new one is active, history keeps both", async () => {
  const request = await makeRequest();

  const first = await upsertRequestFact({ requestId: request.requestId, factKey: "quantity", value: 2, confidence: 0.7 });
  assert.equal(first.ok, true);
  assert.equal(first.status, "created");

  const second = await upsertRequestFact({ requestId: request.requestId, factKey: "quantity", value: 5, confidence: 0.9 });
  assert.equal(second.ok, true);
  assert.equal(second.status, "versioned");
  assert.equal(second.fact?.value, 5);

  const active = await getActiveRequestFact(request.requestId, "quantity");
  assert.equal(active?.value, 5);
  assert.equal(active?.factId, second.fact?.factId);

  const history = await listRequestFactHistory(request.requestId, "quantity");
  assert.equal(history.length, 2);
  assert.equal(history[0].status, "superseded");
  assert.notEqual(history[0].supersededAt, null);
  assert.equal(history[1].status, "inferred");
});

test("the DB itself rejects a second active fact for the same key", async () => {
  const request = await makeRequest();
  await upsertRequestFact({ requestId: request.requestId, factKey: "budget", value: 100000 });

  // Bypass the repository on purpose: a raw duplicate insert must hit the unique key.
  const rawInsert = await safeExecute(
    `INSERT INTO ${REQUEST_FACT_TABLE} (fact_id, request_id, fact_key, value_json, status) VALUES (?, ?, ?, ?, 'inferred')`,
    [uniqueSuffix("fact"), request.requestId, "budget", JSON.stringify(200000)]
  );
  assert.equal(rawInsert.ok, false);
  assert.match(rawInsert.ok ? "" : rawInsert.error, /duplicate/i);
});

test("confirm and verify change status on the active row without touching the value", async () => {
  const request = await makeRequest();
  await upsertRequestFact({ requestId: request.requestId, factKey: "delivery_address_id", value: "addr-1" });

  const confirmed = await confirmRequestFact(request.requestId, "delivery_address_id");
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.fact?.status, "confirmed");
  assert.equal(confirmed.fact?.value, "addr-1");

  const verified = await verifyRequestFact(request.requestId, "delivery_address_id");
  assert.equal(verified.ok, true);
  assert.equal(verified.fact?.status, "verified");

  const history = await listRequestFactHistory(request.requestId, "delivery_address_id");
  assert.equal(history.length, 1);
});

test("reject frees the active slot so a new value can land afterwards", async () => {
  const request = await makeRequest();
  await upsertRequestFact({ requestId: request.requestId, factKey: "equipment_code", value: "TROT-99" });

  const rejected = await rejectRequestFact(request.requestId, "equipment_code");
  assert.equal(rejected.ok, true);
  assert.equal(rejected.fact?.status, "rejected");

  assert.equal(await getActiveRequestFact(request.requestId, "equipment_code"), null);

  const replacement = await upsertRequestFact({ requestId: request.requestId, factKey: "equipment_code", value: "TROT-100" });
  assert.equal(replacement.ok, true);
  assert.equal((await getActiveRequestFact(request.requestId, "equipment_code"))?.value, "TROT-100");
});

test("supersede withdraws a value without replacement; confirming afterwards reports not_found", async () => {
  const request = await makeRequest();
  await upsertRequestFact({ requestId: request.requestId, factKey: "color", value: "rojo" });

  const withdrawn = await supersedeRequestFact(request.requestId, "color");
  assert.equal(withdrawn.ok, true);

  const confirmAfter = await confirmRequestFact(request.requestId, "color");
  assert.equal(confirmAfter.ok, false);
  assert.equal(confirmAfter.status, "not_found");
});

test("facts stay isolated between two requests of the same type in the same conversation", async () => {
  const conversationId = uniqueConversationId();
  const quoteA = await makeRequest(conversationId);
  const quoteB = await makeRequest(conversationId);

  await upsertRequestFact({ requestId: quoteA.requestId, factKey: "delivery_address_id", value: "addr-casa" });

  assert.equal(await getActiveRequestFact(quoteB.requestId, "delivery_address_id"), null);
  assert.equal((await listActiveRequestFacts(quoteB.requestId)).length, 0);

  await upsertRequestFact({ requestId: quoteB.requestId, factKey: "delivery_address_id", value: "addr-bodega" });
  assert.equal((await getActiveRequestFact(quoteA.requestId, "delivery_address_id"))?.value, "addr-casa");
  assert.equal((await getActiveRequestFact(quoteB.requestId, "delivery_address_id"))?.value, "addr-bodega");
});

test("the cycle persists planner-extracted facts per request, idempotently across retries", async () => {
  const conversationId = uniqueConversationId();
  const inboundMessageId = uniqueSuffix("cm");

  const provider: TurnPlannerProvider = {
    name: "fact-extractor",
    async plan() {
      return {
        detections: [
          {
            detectionId: "det-quote",
            rawIntent: "cotizar banca",
            canonicalIntent: "product_quote",
            domain: "sales",
            confidence: 0.9,
            suggestedOperation: "create_request",
            candidateRequestId: null,
            extractedFacts: [
              { factKey: "product_hint", value: "banca plana", confidence: 0.85, sourceMessageId: null },
              { factKey: "quantity", value: 2, confidence: 0.8, sourceMessageId: null }
            ]
          }
        ]
      };
    }
  };

  const first = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId,
    messageText: "Cotízame dos bancas planas",
    correlationId: uniqueSuffix("corr"),
    provider
  });
  assert.equal(first.ran, true);
  assert.equal(first.persistedFacts.length, 2);
  const requestId = first.activeRequests[0].requestId;
  assert.equal((await getActiveRequestFact(requestId, "product_hint"))?.value, "banca plana");
  assert.equal((await getActiveRequestFact(requestId, "quantity"))?.value, 2);

  // Retry of the same turn: plan reused, same facts, no extra versions.
  const retry = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId,
    messageText: "Cotízame dos bancas planas",
    correlationId: uniqueSuffix("corr"),
    provider
  });
  assert.equal(retry.planReused, true);
  assert.equal((await listRequestFactHistory(requestId, "quantity")).length, 1);
  assert.equal((await listRequestFactHistory(requestId, "product_hint")).length, 1);
});

test("persistProposedFacts skips detections without a resolved request", async () => {
  const request = await makeRequest();
  const result = await persistProposedFacts(
    {
      turnPlanId: uniqueSuffix("turnplan"),
      correlationId: "corr",
      conversationId: request.conversationId,
      inboundMessageId: uniqueSuffix("cm"),
      plannerSchemaVersion: "1.0.0",
      inputHash: "hash",
      status: "planned",
      errorCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plan: {
        contractName: "TurnPlan",
        schemaVersion: "1.0.0",
        detections: [
          {
            detectionId: "det-orphan",
            rawIntent: "x",
            canonicalIntent: "product_quote",
            domain: "sales",
            confidence: 0.5,
            suggestedOperation: "create_request",
            candidateRequestId: null,
            extractedFacts: [{ factKey: "quantity", value: 1, confidence: 0.5, sourceMessageId: null }]
          }
        ],
        requestOperations: [],
        proposedFacts: [],
        requestPlans: [],
        responseRequirements: [],
        executionBudget: { maxReadActions: 1, maxMutationActions: 1, maxExternalCalls: 1, deadlineMs: 1000 }
      }
    },
    {}
  );

  assert.equal(result.facts.length, 0);
  assert.equal(result.warnings[0], "fact_without_request:det-orphan");
});

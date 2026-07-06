import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import {
  buildTurnPlanId,
  buildTurnPlanInputHash,
  loadExistingTurnPlan,
  markTurnPlanExecuted,
  markTurnPlanFailed,
  markTurnPlanPartiallyExecuted,
  persistTurnPlan,
  TURN_PLAN_TABLE
} from "@/lib/brain/commercial/multi-request";
import type { PersistTurnPlanInput, TurnPlan } from "@/lib/brain/commercial/multi-request";

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

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function makeTurnPlan(): TurnPlan {
  return {
    contractName: "TurnPlan",
    schemaVersion: "1.0.0",
    detections: [
      {
        detectionId: "det-1",
        rawIntent: "cotizar una banca",
        canonicalIntent: "product_quote",
        domain: "sales",
        confidence: 0.92,
        suggestedOperation: "create_request",
        candidateRequestId: null,
        extractedFacts: [{ factKey: "product_hint", value: "banca", confidence: 0.9, sourceMessageId: "cm-1" }]
      },
      {
        detectionId: "det-2",
        rawIntent: "donde esta mi pedido",
        canonicalIntent: "order_status",
        domain: "order",
        confidence: 0.88,
        suggestedOperation: "create_request",
        candidateRequestId: null,
        extractedFacts: []
      }
    ],
    requestOperations: [],
    proposedFacts: [],
    requestPlans: [],
    responseRequirements: [],
    executionBudget: { maxReadActions: 5, maxMutationActions: 1, maxExternalCalls: 3, deadlineMs: 20000 }
  };
}

function makePersistInput(overrides: Partial<PersistTurnPlanInput> = {}): PersistTurnPlanInput {
  const plan = makeTurnPlan();
  return {
    correlationId: uniqueSuffix("corr"),
    conversationId: 900000000 + Math.floor(Math.random() * 99999999),
    inboundMessageId: uniqueSuffix("cm"),
    inputHash: buildTurnPlanInputHash({ fixture: true }),
    plan,
    ...overrides
  };
}

test("persistTurnPlan creates once; a retry of the same inbound reuses the same plan without a second row", async () => {
  const input = makePersistInput();

  const first = await persistTurnPlan(input);
  assert.equal(first.ok, true);
  assert.equal(first.status, "created");
  assert.equal(first.record?.status, "planned");
  assert.equal(first.record?.plan.detections.length, 2);

  // Retry: same inbound message, same schema version. Even a DIFFERENT plan body
  // must not overwrite the persisted one - the first interpretation wins.
  const retry = await persistTurnPlan({ ...input, correlationId: uniqueSuffix("corr-retry") });
  assert.equal(retry.ok, true);
  assert.equal(retry.status, "duplicate");
  assert.equal(retry.record?.turnPlanId, first.record?.turnPlanId);
  assert.equal(retry.record?.correlationId, first.record?.correlationId);

  const count = await safeQueryRows<{ total: number }>(
    `SELECT COUNT(*) AS total FROM ${TURN_PLAN_TABLE} WHERE inbound_message_id = ?`,
    [input.inboundMessageId]
  );
  assert.equal(Number(count.ok ? count.rows[0]?.total : -1), 1);
});

test("turn_plan_id is deterministic from inbound message + schema version", () => {
  assert.equal(buildTurnPlanId("cm-123", "1.0.0"), buildTurnPlanId("cm-123", "1.0.0"));
  assert.notEqual(buildTurnPlanId("cm-123", "1.0.0"), buildTurnPlanId("cm-124", "1.0.0"));
  assert.notEqual(buildTurnPlanId("cm-123", "1.0.0"), buildTurnPlanId("cm-123", "2.0.0"));
  assert.equal(buildTurnPlanId("cm-123", "1.0.0").startsWith("turnplan-"), true);
});

test("loadExistingTurnPlan hits by message + version and round-trips the TurnPlan contract", async () => {
  const input = makePersistInput();
  await persistTurnPlan(input);

  const found = await loadExistingTurnPlan(input.inboundMessageId);
  assert.notEqual(found, null);
  assert.equal(found?.plan.contractName, "TurnPlan");
  assert.equal(found?.plan.detections[0]?.detectionId, "det-1");
  assert.equal(found?.plan.detections[0]?.extractedFacts[0]?.value, "banca");
  assert.equal(found?.plan.executionBudget.deadlineMs, 20000);

  // A different planner schema version misses on purpose (new contract -> new plan).
  const missed = await loadExistingTurnPlan(input.inboundMessageId, "9.9.9");
  assert.equal(missed, null);
});

test("turn plan status moves by CAS: planned -> partially_executed -> executed; stale moves conflict", async () => {
  const input = makePersistInput();
  const created = await persistTurnPlan(input);
  const turnPlanId = created.record!.turnPlanId;

  const partial = await markTurnPlanPartiallyExecuted(turnPlanId);
  assert.equal(partial.ok, true);
  assert.equal(partial.record?.status, "partially_executed");

  // planned -> partially_executed again is stale: the row is no longer 'planned'.
  const stale = await markTurnPlanPartiallyExecuted(turnPlanId);
  assert.equal(stale.ok, false);
  assert.equal(stale.status, "conflict");

  const executed = await markTurnPlanExecuted(turnPlanId);
  assert.equal(executed.ok, true);
  assert.equal(executed.record?.status, "executed");

  // A terminal plan cannot be failed afterwards.
  const failAfterExecute = await markTurnPlanFailed(turnPlanId, "late_failure");
  assert.equal(failAfterExecute.ok, false);
  assert.equal(failAfterExecute.status, "conflict");
  assert.equal(failAfterExecute.record?.status, "executed");
});

test("markTurnPlanFailed records the error code from planned", async () => {
  const input = makePersistInput();
  const created = await persistTurnPlan(input);

  const failed = await markTurnPlanFailed(created.record!.turnPlanId, "planner_timeout");
  assert.equal(failed.ok, true);
  assert.equal(failed.record?.status, "failed");
  assert.equal(failed.record?.errorCode, "planner_timeout");
});

test("marking a nonexistent turn plan reports not_found", async () => {
  const missing = await markTurnPlanExecuted(buildTurnPlanId(uniqueSuffix("ghost")));
  assert.equal(missing.ok, false);
  assert.equal(missing.status, "not_found");
});

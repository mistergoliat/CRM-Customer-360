import assert from "node:assert/strict";
import test, { after } from "node:test";

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
  DB_WRITE_ENABLED: "true",
  BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
  BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
  BRAIN_EXECUTION_GATE_ENABLED: "true",
  BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
  BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "true",
  BRAIN_AUTONOMOUS_REPLY_ENABLED: "true"
});

import { getPool, queryRows, safeExecute } from "@/lib/db";
import { dispatchFallbackAction, buildContinuityFallbackIdempotencyKey } from "@/lib/brain/commercial/continuity/dispatchFallbackAction";
import { terminalizeBlockedAgentAction } from "@/lib/brain/commercial/continuity/terminalizeBlockedAgentAction";

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

test("ACS-R1-05-T06.2 (A6): dispatchFallbackAction is idempotent under replay - one action row, one outbox row", async () => {
  const waId = `5698${String(Date.now()).slice(-8)}`;
  process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = waId;
  const conversationId = Date.now() % 1000000;
  const inboundMessageId = uniqueSuffix("msg");
  const currentTime = new Date().toISOString();

  const input = {
    conversationId,
    conversationCaseId: conversationId,
    opportunityId: null,
    decisionId: null,
    waId,
    inboundMessageId,
    currentTime,
    fallbackClass: "catalog_unavailable" as const,
    message: "Ya tengo registrado lo que buscas. No pude consultar el catálogo real ahora, sigo apenas pueda.",
    humanOwnerActive: false,
    aiBlocked: false,
    caseStatus: "open"
  };

  const first = await dispatchFallbackAction(input);
  const second = await dispatchFallbackAction(input);

  assert.equal(first.attempted, true);
  assert.equal(second.attempted, true);
  assert.equal(first.action?.actionId, second.action?.actionId, "same idempotency key must resolve to the same action");

  const idempotencyKey = buildContinuityFallbackIdempotencyKey(conversationId, inboundMessageId, "catalog_unavailable");
  const actionRows = await queryRows<Record<string, unknown>>("SELECT * FROM crm_agent_actions WHERE idempotency_key = ?", [idempotencyKey]);
  assert.equal(actionRows.length, 1, "exactly one action row must exist for this idempotency key");

  if (first.outboxWritten) {
    const outboxRows = await queryRows<Record<string, unknown>>(
      "SELECT id FROM brain_message_outbox WHERE id = ?",
      [actionRows[0].outbox_message_id]
    );
    assert.equal(outboxRows.length, 1, "exactly one outbox row must exist for this fallback");
  }
});

test("dispatchFallbackAction: two different fallback classes for the same message never collide", async () => {
  const waId = `5697${String(Date.now()).slice(-8)}`;
  process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = waId;
  const conversationId = (Date.now() + 1) % 1000000;
  const inboundMessageId = uniqueSuffix("msg-classes");
  const currentTime = new Date().toISOString();

  const catalogResult = await dispatchFallbackAction({
    conversationId,
    conversationCaseId: conversationId,
    opportunityId: null,
    decisionId: null,
    waId,
    inboundMessageId,
    currentTime,
    fallbackClass: "catalog_unavailable",
    message: "mensaje catalogo",
    humanOwnerActive: false,
    aiBlocked: false,
    caseStatus: "open"
  });

  const modelResult = await dispatchFallbackAction({
    conversationId,
    conversationCaseId: conversationId,
    opportunityId: null,
    decisionId: null,
    waId,
    inboundMessageId,
    currentTime,
    fallbackClass: "model_unavailable",
    message: "mensaje modelo",
    humanOwnerActive: false,
    aiBlocked: false,
    caseStatus: "open"
  });

  assert.notEqual(catalogResult.action?.actionId, modelResult.action?.actionId);
});

test("ACS-R1-05-T06.2 (A5): terminalizeBlockedAgentAction transitions proposed -> blocked via CAS, never overwrites executed/planned", async () => {
  const waId = `5696${String(Date.now()).slice(-8)}`;
  const conversationId = (Date.now() + 2) % 1000000;

  // Seed a stuck 'proposed' action the same way the real bridge would (via
  // the fallback dispatcher's own builder is not reusable directly here, so
  // insert with a plain fallback dispatch that we intentionally leave at
  // 'proposed' by disabling the gate for this one seed).
  const previousGate = process.env.BRAIN_EXECUTION_GATE_ENABLED;
  process.env.BRAIN_EXECUTION_GATE_ENABLED = "false";
  const seeded = await dispatchFallbackAction({
    conversationId,
    conversationCaseId: conversationId,
    opportunityId: null,
    decisionId: null,
    waId,
    inboundMessageId: uniqueSuffix("stuck"),
    currentTime: new Date().toISOString(),
    fallbackClass: "invalid_model_result",
    message: "mensaje de prueba para quedar en proposed",
    humanOwnerActive: false,
    aiBlocked: false,
    caseStatus: "open"
  });
  process.env.BRAIN_EXECUTION_GATE_ENABLED = previousGate;

  assert.ok(seeded.action?.actionId, "expected a seeded action id");
  const actionId = seeded.action!.actionId;

  const rowsBefore = await queryRows<Record<string, unknown>>("SELECT status FROM crm_agent_actions WHERE action_id = ?", [actionId]);
  assert.equal(rowsBefore[0]?.status, "proposed");

  const result = await terminalizeBlockedAgentAction({ actionId, failureReason: "test_block", blockReasons: ["unsafe_payload"] });
  assert.equal(result.terminalized, true);

  const rowsAfter = await queryRows<Record<string, unknown>>("SELECT status, failure_reason, block_reasons_json FROM crm_agent_actions WHERE action_id = ?", [actionId]);
  assert.equal(rowsAfter[0]?.status, "blocked");

  // A second terminalization attempt must be a no-op CAS (already blocked, not a pre-execution status anymore).
  const secondAttempt = await terminalizeBlockedAgentAction({ actionId, failureReason: "test_block_again", blockReasons: [] });
  assert.equal(secondAttempt.terminalized, false);

  // Simulate a row that already advanced to 'executed' - terminalization must refuse to touch it.
  await safeExecute("UPDATE crm_agent_actions SET status = 'executed', updated_at = CURRENT_TIMESTAMP(3) WHERE action_id = ?", [actionId]);
  const executedAttempt = await terminalizeBlockedAgentAction({ actionId, failureReason: "must_not_apply", blockReasons: [] });
  assert.equal(executedAttempt.terminalized, false);
  const rowsFinal = await queryRows<Record<string, unknown>>("SELECT status FROM crm_agent_actions WHERE action_id = ?", [actionId]);
  assert.equal(rowsFinal[0]?.status, "executed", "an already-executed row must never be overwritten to blocked");
});

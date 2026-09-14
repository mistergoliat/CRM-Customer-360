import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";

// Deliberately no NODE_ENV/DB_*/DATABASE_*/TEST_DATABASE_* here - unlike
// this repo's common real-DB test convention, this file never overrides
// connection env vars. lib/database-config.ts's resolveDatabaseConnectionFromEnv
// refuses to run with NODE_ENV=test unless the resolved database is exactly
// crm_test (`NODE_ENV=test requires crm_test, received ...`); forcing
// NODE_ENV to "development" here would silently disable that guard. Connection
// config is expected to come from whatever the environment already provides
// (a loaded .env, TEST_DATABASE_*/DATABASE_*/DB_* exported in the shell, CI
// secrets, etc.) - only test-specific behavioral flags are set below.
Object.assign(process.env, {
  DB_WRITE_ENABLED: "true",
  BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true",
  BRAIN_WHATSAPP_TEST_MODE_ENABLED: "false",
  BRAIN_COMMERCIAL_WORK_WORKER_ENABLED: "true",
  BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
  BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
  BRAIN_EXECUTION_GATE_ENABLED: "true",
  BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
  BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "true",
  BRAIN_AUTONOMOUS_REPLY_ENABLED: "true"
});

import { getPool, queryRows } from "@/lib/db";
import {
  buildCommercialWorkProjection,
  evaluateAndDispatchAsyncCommercialWorkDelivery,
  getCommercialWorkByPublicId,
  persistCommercialWorkProjection,
  runCommercialWorkTick,
  updateCommercialWorkAggregate,
  type CommercialObjectiveSeed,
  type CommercialWork,
  type CommercialWorkProjectionInput,
  type CommercialWorkTickOptions
} from "@/lib/brain/commercial/work";
import type { CapabilityGatewayResult } from "@/lib/brain/commercial/capability-gateway";
import { setCommercialLineItemsForOpportunity, getActiveCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { setCreatedQuoteForOpportunity } from "@/lib/domains/created-quote";

/**
 * SALES-AGENT-R3 COMMERCIAL WORK ASYNC RESULT DELIVERY V1.
 *
 * commercialWorkRetryWorker.test.ts's own CWRT01 test documented the exact
 * gap this closes: a CommercialWork step completed by the worker (outside
 * any live customer turn) left crm_agent_actions/brain_message_outbox
 * untouched. That was correct pre-existing behavior for a worker that only
 * executed steps - it stays correct here too whenever asyncDeliveryEnabled
 * is left at its default (false), which is why none of that file's
 * assertions needed to change. This file exercises the NEW opt-in seam
 * (runCommercialWorkTick's asyncDeliveryEnabled option / sweepUndeliveredCommercialWorkDeliveries)
 * with create_quote as the primary acceptance scenario (release brief
 * section 7/15).
 */

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

/**
 * runCommercialWorkTick defaults every rollout gate it is not explicitly
 * given to the real, env-backed production reader - in particular
 * isWaIdEligibleForCommercialWork defaults to the real shouldRouteToCommercialWork,
 * which requires BOTH BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED=true AND this
 * suite's random wa_id to be a member of BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS
 * (empty by default) - the unrelated R2 pilot allowlist, never set anywhere
 * in this file. Without this fixture every candidate here was being
 * skipped_r2_ineligible before ever reaching a claim, which is why the
 * suite's failures were consistent with a rollout-gate block rather than a
 * defect in the async-delivery seam itself. Same shape
 * commercialWorkRetryWorker.test.ts's own `isWaIdEligibleForCommercialWork: () => true`
 * already uses for the identical reason - this suite exercises this task's
 * own logic, never the unrelated R2 pilot rollout policy.
 */
const TEST_GATES: Pick<CommercialWorkTickOptions, "workerEnabled" | "autonomousResponsesEnabled" | "whatsAppAccessGate" | "isWaIdEligibleForCommercialWork" | "activationCutoff"> = {
  workerEnabled: true,
  autonomousResponsesEnabled: true,
  whatsAppAccessGate: { testModeEnabled: false, testWaIds: [] },
  isWaIdEligibleForCommercialWork: () => true,
  activationCutoff: null
};

const ROLLOUT_GATE_SKIP_REASONS = new Set(["skipped_autonomy_disabled", "skipped_access_gate", "skipped_r2_ineligible", "skipped_before_activation_cutoff"]);

/** Proves a due step actually reached the claim/execute path, never one of the four named rollout gates. */
function assertNotGateSkipped(tick: { skipped: Array<{ workPublicId: string; stepId: string; reason: string }> }, workPublicId: string) {
  const blocked = tick.skipped.filter((item) => item.workPublicId === workPublicId && ROLLOUT_GATE_SKIP_REASONS.has(item.reason));
  assert.deepEqual(blocked, [], `expected no production rollout-gate skip for ${workPublicId}, got: ${JSON.stringify(blocked)}`);
}

const SWEEP_GATE_SKIP_REASONS = new Set(["skipped_access_gate", "skipped_r2_ineligible", "skipped_before_activation_cutoff"]);

/** Proves the async-delivery sweep actually reached evaluateAndDispatchAsyncCommercialWorkDelivery for this work, never one of its three rollout-gate skips. */
function assertSweepEvaluated(tick: { asyncDelivery: { evaluated: number; skipped: Array<{ workPublicId: string; reason: string }> } }, workPublicId: string) {
  assert.equal(tick.asyncDelivery.evaluated, 1, "expected the async-delivery sweep to actually evaluate this work, not skip it at a rollout gate");
  const blocked = tick.asyncDelivery.skipped.filter((item) => item.workPublicId === workPublicId && SWEEP_GATE_SKIP_REASONS.has(item.reason));
  assert.deepEqual(blocked, [], `expected no rollout-gate skip inside the sweep for ${workPublicId}, got: ${JSON.stringify(blocked)}`);
}

const NOW = "2026-09-14T12:00:00.000Z";
const DUE = "2026-09-14T12:02:00.000Z";
const LATER = "2026-09-14T12:05:00.000Z";
let conversationId = 0;
let waId = "";

before(async () => {
  const seeded = await seedConversation();
  conversationId = seeded.id;
  waId = seeded.waId;
});

function unique(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function seedConversation() {
  const wa = unique("wa");
  const [result] = await getPool().execute(
    `INSERT INTO conversation (
      public_id, channel, provider, channel_account_id, external_contact_id,
      status, owner_type, ai_enabled, human_owner_active
    ) VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [randomUUID(), unique("phone"), wa]
  );
  return { id: Number((result as { insertId: number }).insertId), waId: wa };
}

async function setConversationControl(input: { humanOwnerActive?: boolean; aiEnabled?: boolean }) {
  const sets: string[] = [];
  const params: number[] = [];
  if (input.humanOwnerActive !== undefined) {
    sets.push("human_owner_active = ?");
    params.push(input.humanOwnerActive ? 1 : 0);
  }
  if (input.aiEnabled !== undefined) {
    sets.push("ai_enabled = ?");
    params.push(input.aiEnabled ? 1 : 0);
  }
  params.push(conversationId);
  await getPool().execute(`UPDATE conversation SET ${sets.join(", ")} WHERE id = ?`, params);
}

async function seedOpportunity() {
  const [result] = await getPool().execute(
    `INSERT INTO crm_opportunities (
      opportunity_key, wa_id, channel, primary_intent, status,
      requirements_json, missing_requirements_json, product_interests_json,
      objections_json, signals_json
    ) VALUES (?, ?, 'whatsapp', 'sales', 'open', JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_OBJECT())`,
    [unique("cwad-opportunity"), waId]
  );
  return Number((result as { insertId: number }).insertId);
}

function objectiveSeed(type: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["type"], inputs: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["inputs"] = {}): CommercialObjectiveSeed {
  return { seedId: unique(`seed-${type}`), type, origin: "customer_requested", inputs };
}

function baseInput(opportunityId: number, overrides: Partial<CommercialWorkProjectionInput> = {}): CommercialWorkProjectionInput {
  return {
    trigger: { type: "CUSTOMER_MESSAGE", conversationId, opportunityId, sourceMessageId: Math.floor(Date.now() % 100000000) },
    conversation: { id: conversationId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: opportunityId },
    now: NOW,
    ...overrides
  };
}

async function persist(work: CommercialWork) {
  return persistCommercialWorkProjection({ work, correlationKey: unique("cwad-correlation") });
}

function step(work: CommercialWork, type: string) {
  const found = work.steps.find((item) => item.type === type);
  assert.ok(found, `expected step ${type}`);
  return found;
}

async function seedQuoteWork(opportunityId: number) {
  const selection = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "31", combinationId: null, quantity: 2 }] });
  assert.equal(selection.ok, true);
  const projected = buildCommercialWorkProjection(baseInput(opportunityId, { commercialLineItems: selection.ok ? selection.selection : null, objectiveSeeds: [objectiveSeed("CREATE_QUOTE")] }));
  return persist(projected);
}

function gatewayResult(capability: string, status: CapabilityGatewayResult["status"], data: Record<string, unknown> | null, errorCode: string | null, retryable: boolean): CapabilityGatewayResult {
  return { capability, version: "capability-gateway.v1", availability: "available", status, data, errorCode, retryable, evidence: [], warnings: [], retryCount: 0, startedAt: NOW, completedAt: NOW, executionPublicId: unique(`exec-${capability}`) };
}

function makeQuoteGateway(opportunityId: number, statuses: Record<string, CapabilityGatewayResult["status"]> = {}) {
  const calls: string[] = [];
  const executeCapability = async (capabilityName: string) => {
    calls.push(capabilityName);
    const forced = statuses[capabilityName];
    if (forced === "temporarily_blocked") return gatewayResult(capabilityName, "temporarily_blocked", null, "temporary_failure", true);
    if (forced && forced !== "completed") return gatewayResult(capabilityName, forced, null, "forced_failure", false);
    if (capabilityName === "create_quote") {
      const selection = await getActiveCommercialLineItemsForOpportunity(opportunityId);
      assert.ok(selection);
      await setCreatedQuoteForOpportunity({
        opportunityId,
        quote: {
          quoteId: unique("quote-id"),
          quoteNumber: unique("Q"),
          status: "draft",
          currency: "CLP",
          total: "179980",
          validUntil: "2026-09-21T00:00:00.000Z",
          selectionFactId: selection.factId,
          idempotencyKey: unique("quote-key")
        },
        sourceToolExecutionId: unique("cwad")
      });
      return gatewayResult(capabilityName, "completed", { status: "created" }, null, false);
    }
    return gatewayResult(capabilityName, "failed", null, "unexpected_capability", false);
  };
  return { calls, executeCapability };
}

async function countSideEffects() {
  // The canonical outbound writer normalizes wa_id before persisting
  // brain_message_outbox (e.g. "wa-<ts>-<rand>" fixture values never match
  // the normalized digits actually stored) - matching on the fixture's raw
  // waId here would always read zero regardless of whether delivery
  // happened. crm_agent_actions.outbox_message_id -> brain_message_outbox.id
  // is the real, authoritative relationship executeActionThroughGate
  // establishes (execution-gate/executeActionThroughGate.ts): "this
  // conversation's agent action produced one canonical outbox consequence",
  // not "the transport stored this exact raw fixture string".
  const [actions, outbox] = await Promise.all([
    queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_agent_actions WHERE conversation_case_id = ?", [String(conversationId)]),
    queryRows<{ count: number }>(
      `SELECT COUNT(*) AS count
        FROM brain_message_outbox o
        INNER JOIN crm_agent_actions a ON a.outbox_message_id = o.id
        WHERE a.conversation_case_id = ?`,
      [String(conversationId)]
    )
  ]);
  return { actions: Number(actions[0].count), outbox: Number(outbox[0].count) };
}

async function latestActionMessage(): Promise<string | null> {
  const rows = await queryRows<{ draft_message: string | null }>(
    "SELECT draft_message FROM crm_agent_actions WHERE conversation_case_id = ? ORDER BY id DESC LIMIT 1",
    [String(conversationId)]
  );
  return rows[0]?.draft_message ?? null;
}

test("CWAD-A/H deferred create_quote: no delivery while retryable, one delivery once durable success lands", async () => {
  const opportunityId = await seedOpportunity();
  const created = await seedQuoteWork(opportunityId);
  const before = await countSideEffects();

  const blockedGateway = makeQuoteGateway(opportunityId, { create_quote: "temporarily_blocked" });
  const tick1 = await runCommercialWorkTick({
    ...TEST_GATES,
    batchSize: 1,
    now: NOW,
    workerId: "cwad-a-1",
    workPublicIds: [created.work.publicId],
    executeCapability: blockedGateway.executeCapability,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    asyncDeliveryEnabled: true
  });
  assert.equal(tick1.claimed, 1);
  assertNotGateSkipped(tick1, created.work.publicId);
  const waiting = await getCommercialWorkByPublicId(created.work.publicId);
  assert.equal(step(waiting!, "CREATE_QUOTE").status, "RETRY_SCHEDULED");
  assert.equal(tick1.asyncDelivery.dispatched, 0);
  const afterBlocked = await countSideEffects();
  assert.deepEqual(afterBlocked, before);

  const okGateway = makeQuoteGateway(opportunityId);
  const tick2 = await runCommercialWorkTick({
    ...TEST_GATES,
    batchSize: 1,
    now: DUE,
    workerId: "cwad-a-2",
    workPublicIds: [created.work.publicId],
    executeCapability: okGateway.executeCapability,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    asyncDeliveryEnabled: true
  });
  assert.equal(tick2.claimed, 1);
  assertNotGateSkipped(tick2, created.work.publicId);
  const completed = await getCommercialWorkByPublicId(created.work.publicId);
  assert.equal(completed?.status, "COMPLETED");
  assert.equal(tick2.completed, 1);
  assert.equal(tick2.asyncDelivery.dispatched, 1);

  const afterDelivered = await countSideEffects();
  assert.equal(afterDelivered.actions, before.actions + 1);
  assert.equal(afterDelivered.outbox, before.outbox + 1);

  const message = await latestActionMessage();
  assert.ok(message && /cotizaci.n/i.test(message), `expected a quote-completion message, got: ${message}`);
});

test("CWAD-B/L worker runs again over an already-delivered work: no duplicate action or outbox row", async () => {
  const opportunityId = await seedOpportunity();
  const created = await seedQuoteWork(opportunityId);
  const gateway = makeQuoteGateway(opportunityId);
  const tick1 = await runCommercialWorkTick({
    ...TEST_GATES,
    batchSize: 1,
    now: NOW,
    workerId: "cwad-b-1",
    workPublicIds: [created.work.publicId],
    executeCapability: gateway.executeCapability,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    asyncDeliveryEnabled: true
  });
  assert.equal(tick1.claimed, 1);
  assertNotGateSkipped(tick1, created.work.publicId);
  const afterFirstDelivery = await countSideEffects();

  // No due step remains (work is terminal) - the sweep alone re-evaluates it,
  // simulating the worker waking up again later (or a second process racing
  // the same tick) and re-checking a work it already delivered.
  const tick2 = await runCommercialWorkTick({
    ...TEST_GATES,
    batchSize: 1,
    now: LATER,
    workerId: "cwad-b-2",
    workPublicIds: [created.work.publicId],
    executeCapability: async () => gatewayResult("create_quote", "failed", null, "should_not_call", false),
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    asyncDeliveryEnabled: true
  });
  assert.equal(tick2.claimed, 0);
  assertSweepEvaluated(tick2, created.work.publicId);

  const afterSecondTick = await countSideEffects();
  assert.deepEqual(afterSecondTick, afterFirstDelivery);
});

test("CWAD-C recovery: a work already COMPLETED durably (simulated crash before delivery) is delivered once by the sweep", async () => {
  const opportunityId = await seedOpportunity();
  const created = await seedQuoteWork(opportunityId);
  await setCreatedQuoteForOpportunity({
    opportunityId,
    quote: {
      quoteId: unique("quote-id"),
      quoteNumber: unique("Q"),
      status: "draft",
      currency: "CLP",
      total: "179980",
      validUntil: "2026-09-21T00:00:00.000Z",
      selectionFactId: (await getActiveCommercialLineItemsForOpportunity(opportunityId))!.factId,
      idempotencyKey: unique("quote-key")
    }
  });
  const before = await countSideEffects();

  // Simulate "capability succeeded and was persisted, then the worker
  // process crashed before ever reaching dispatch" by writing the terminal
  // state directly, bypassing executeCommercialWork entirely.
  const quoteStep = step(created.work, "CREATE_QUOTE");
  const crashedWork: CommercialWork = {
    ...created.work,
    status: "COMPLETED",
    objectives: created.work.objectives.map((objective) => ({ ...objective, status: "COMPLETED" })),
    steps: created.work.steps.map((item) => (item.stepId === quoteStep.stepId ? { ...item, status: "COMPLETED" as const } : item))
  };
  await updateCommercialWorkAggregate({ publicId: created.work.publicId, expectedVersion: created.work.version, nextWork: crashedWork });

  const tick = await runCommercialWorkTick({
    ...TEST_GATES,
    batchSize: 1,
    now: NOW,
    workerId: "cwad-c",
    workPublicIds: [created.work.publicId],
    executeCapability: async () => gatewayResult("create_quote", "failed", null, "should_not_call", false),
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    asyncDeliveryEnabled: true
  });
  assert.equal(tick.claimed, 0);
  assertSweepEvaluated(tick, created.work.publicId);
  assert.equal(tick.asyncDelivery.dispatched, 1);

  const after = await countSideEffects();
  assert.equal(after.actions, before.actions + 1);
  assert.equal(after.outbox, before.outbox + 1);
});

test("CWAD-E handoff race: human_owner_active suppresses autonomous delivery, durable state is unaffected", async () => {
  const opportunityId = await seedOpportunity();
  const created = await seedQuoteWork(opportunityId);
  const before = await countSideEffects();

  const quoteStep = step(created.work, "CREATE_QUOTE");
  const completedWork: CommercialWork = {
    ...created.work,
    status: "COMPLETED",
    objectives: created.work.objectives.map((objective) => ({ ...objective, status: "COMPLETED" })),
    steps: created.work.steps.map((item) => (item.stepId === quoteStep.stepId ? { ...item, status: "COMPLETED" as const } : item))
  };
  await updateCommercialWorkAggregate({ publicId: created.work.publicId, expectedVersion: created.work.version, nextWork: completedWork });

  await setConversationControl({ humanOwnerActive: true });
  try {
    const tick = await runCommercialWorkTick({
      ...TEST_GATES,
      batchSize: 1,
      now: NOW,
      workerId: "cwad-e",
      workPublicIds: [created.work.publicId],
      executeCapability: async () => gatewayResult("create_quote", "failed", null, "should_not_call", false),
      // Deliberately NOT loadConversationControl-overridden to false: this
      // test exists to prove evaluateAndDispatchAsyncCommercialWorkDelivery's
      // OWN fresh conversation read (loadFreshDispatchContext) - not a value
      // any caller happened to pass in - is what the execution gate sees.
      asyncDeliveryEnabled: true
    });
    assertSweepEvaluated(tick, created.work.publicId);
    assert.equal(tick.asyncDelivery.dispatched, 0);

    const after = await countSideEffects();
    assert.equal(after.outbox, before.outbox, "no autonomous message may race the human owner");

    const stillCompleted = await getCommercialWorkByPublicId(created.work.publicId);
    assert.equal(stillCompleted?.status, "COMPLETED", "the durable capability success stays recorded even though delivery was suppressed");
  } finally {
    await setConversationControl({ humanOwnerActive: false });
  }
});

test("CWAD-F ai_enabled=false suppresses autonomous delivery", async () => {
  const opportunityId = await seedOpportunity();
  const created = await seedQuoteWork(opportunityId);
  const before = await countSideEffects();

  const quoteStep = step(created.work, "CREATE_QUOTE");
  const completedWork: CommercialWork = {
    ...created.work,
    status: "COMPLETED",
    objectives: created.work.objectives.map((objective) => ({ ...objective, status: "COMPLETED" })),
    steps: created.work.steps.map((item) => (item.stepId === quoteStep.stepId ? { ...item, status: "COMPLETED" as const } : item))
  };
  await updateCommercialWorkAggregate({ publicId: created.work.publicId, expectedVersion: created.work.version, nextWork: completedWork });

  await setConversationControl({ aiEnabled: false });
  try {
    const tick = await runCommercialWorkTick({
      ...TEST_GATES,
      batchSize: 1,
      now: NOW,
      workerId: "cwad-f",
      workPublicIds: [created.work.publicId],
      executeCapability: async () => gatewayResult("create_quote", "failed", null, "should_not_call", false),
      // See CWAD-E: no due step exists to claim here, so loadConversationControl
      // (only read by executeCommercialWork's own claim loop) is irrelevant -
      // the assertion below depends entirely on evaluateAndDispatchAsyncCommercialWorkDelivery's
      // own fresh conversation.ai_enabled read.
      asyncDeliveryEnabled: true
    });
    assertSweepEvaluated(tick, created.work.publicId);
    assert.equal(tick.asyncDelivery.dispatched, 0);
    const after = await countSideEffects();
    assert.equal(after.outbox, before.outbox);
  } finally {
    await setConversationControl({ aiEnabled: true });
  }
});

test("CWAD-G superseded work: current durable truth (SUPERSEDED) suppresses the stale COMPLETED snapshot", async () => {
  const opportunityId = await seedOpportunity();
  const created = await seedQuoteWork(opportunityId);
  const before = await countSideEffects();

  const quoteStep = step(created.work, "CREATE_QUOTE");
  const completedWork: CommercialWork = {
    ...created.work,
    status: "COMPLETED",
    objectives: created.work.objectives.map((objective) => ({ ...objective, status: "COMPLETED" })),
    steps: created.work.steps.map((item) => (item.stepId === quoteStep.stepId ? { ...item, status: "COMPLETED" as const } : item))
  };
  const completed = await updateCommercialWorkAggregate({ publicId: created.work.publicId, expectedVersion: created.work.version, nextWork: completedWork });

  // COMPLETED can only ever transition to SUPERSEDED (transitions.ts) - this
  // is exactly how a later reconciliation round marks a once-completed
  // objective/work stale once fresher durable truth (e.g. the customer
  // changed their selection) supersedes it. Current durable truth for this
  // work is now "overtaken", not "still current" - the sweep's own candidate
  // query already excludes SUPERSEDED (never one of the dispatch-worthy
  // statuses), so this proves the end-to-end guarantee (no delivery) even
  // though it exercises the SQL-filter layer of that guarantee rather than
  // the in-function settle/refetch layer (which a single synchronous test
  // cannot isolate without a genuine scan-vs-evaluate race).
  const superseded: CommercialWork = {
    ...completed,
    status: "SUPERSEDED",
    steps: completed.steps.map((item) => (item.stepId === quoteStep.stepId ? { ...item, status: "SUPERSEDED" as const } : item)),
    objectives: completed.objectives.map((objective) => ({ ...objective, status: "SUPERSEDED" as const }))
  };
  await updateCommercialWorkAggregate({ publicId: completed.publicId, expectedVersion: completed.version, nextWork: superseded });

  // Reaches evaluateAndDispatchAsyncCommercialWorkDelivery directly (not
  // through the sweep's own SQL scan, which excludes SUPERSEDED by
  // construction and would never even surface this row as a candidate) -
  // this is the layer that must actually prove the suppression, per this
  // task's own requirement that the test "reach the async-delivery
  // evaluation" rather than pass because nothing was scanned at all.
  const evaluated = await evaluateAndDispatchAsyncCommercialWorkDelivery({
    workPublicId: created.work.publicId,
    correlationId: unique("cwad-g-direct"),
    currentTime: NOW,
    triggerSource: "recovery_sweep"
  });
  assert.equal(evaluated.status, "SUPERSEDED");
  assert.equal(evaluated.dispatchWorthy, false);
  assert.equal(evaluated.dispatched, false);
  assert.match(evaluated.reason, /^not_dispatch_worthy:SUPERSEDED$/);

  // Secondary, defense-in-depth proof: the sweep's own candidate scan never
  // even selects a SUPERSEDED row in the first place (belt-and-suspenders
  // with the direct-call assertion above) - TEST_GATES applied the same as
  // every other invocation so a rollout-gate skip can never be confused with
  // "correctly found nothing to scan".
  const tick = await runCommercialWorkTick({
    ...TEST_GATES,
    batchSize: 5,
    now: NOW,
    workerId: "cwad-g",
    workPublicIds: [created.work.publicId],
    executeCapability: async () => gatewayResult("create_quote", "failed", null, "should_not_call", false),
    asyncDeliveryEnabled: true
  });
  assert.equal(tick.asyncDelivery.candidates, 0, "SUPERSEDED is never one of the sweep's dispatch-worthy statuses");
  assert.equal(tick.asyncDelivery.dispatched, 0);
  const after = await countSideEffects();
  assert.equal(after.outbox, before.outbox, "a stale completed snapshot must never be announced once current truth moved on");
});

test("CWAD-I permanent failure: async delivery never claims a false success", async () => {
  const opportunityId = await seedOpportunity();
  const created = await seedQuoteWork(opportunityId);
  const before = await countSideEffects();

  const exhaustedWork: CommercialWork = {
    ...created.work,
    status: "WAITING_SYSTEM",
    steps: created.work.steps.map((item) => (item.type === "CREATE_QUOTE" ? { ...item, status: "RETRY_SCHEDULED" as const, attemptCount: 3, maxAttempts: 3, nextAttemptAt: NOW } : item))
  };
  await updateCommercialWorkAggregate({ publicId: created.work.publicId, expectedVersion: created.work.version, nextWork: exhaustedWork });

  const tick = await runCommercialWorkTick({
    ...TEST_GATES,
    batchSize: 1,
    now: NOW,
    workerId: "cwad-i",
    workPublicIds: [created.work.publicId],
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    asyncDeliveryEnabled: true
  });
  assertNotGateSkipped(tick, created.work.publicId);
  const failedWork = await getCommercialWorkByPublicId(created.work.publicId);
  assert.equal(failedWork?.status, "FAILED");
  assert.equal(tick.failed, 1);
  assertSweepEvaluated(tick, created.work.publicId);
  assert.equal(tick.asyncDelivery.dispatched, 1);

  const after = await countSideEffects();
  assert.equal(after.actions, before.actions + 1);
  const message = await latestActionMessage();
  assert.ok(message && !/cotizaci.n qued. creada/i.test(message), `must never claim quote success on permanent failure, got: ${message}`);
});

test("CWAD default-off: asyncDeliveryEnabled unset keeps pre-existing worker behavior (no action/outbox)", async () => {
  const opportunityId = await seedOpportunity();
  const created = await seedQuoteWork(opportunityId);
  const before = await countSideEffects();

  const gateway = makeQuoteGateway(opportunityId);
  const tick = await runCommercialWorkTick({
    ...TEST_GATES,
    batchSize: 1,
    now: NOW,
    workerId: "cwad-default-off",
    workPublicIds: [created.work.publicId],
    executeCapability: gateway.executeCapability,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true })
    // asyncDeliveryEnabled deliberately omitted - proves the seam stays
    // opt-in/off by default even with every rollout gate otherwise open.
  });
  assertNotGateSkipped(tick, created.work.publicId);
  assert.equal(tick.completed, 1);
  assert.equal(tick.asyncDelivery.candidates, 0);

  const after = await countSideEffects();
  assert.deepEqual(after, before);
});

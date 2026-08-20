import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db";
import {
  deriveCommercialWorkMetrics,
  executeCommercialWork,
  getCommercialWorkByPublicId,
  persistCommercialWorkProjection,
  updateCommercialWorkAggregate,
  isCommercialWorkPersistenceVersionConflict,
  claimDueCommercialWorkStep,
  type CommercialWork,
  type ExecuteCommercialWorkInput,
  type DueCommercialWorkStepRow
} from "@/lib/brain/commercial/work";
import type { CapabilityGatewayResult } from "@/lib/brain/commercial/capability-gateway";

/**
 * SALES-AGENT-R2-A09. DB-backed executor-level coverage for the wave
 * mechanism (buildSafeExecutionWave.test.ts covers the pure builder/conflict
 * model in isolation). Real crm_test DB, real executeCommercialWork/
 * updateCommercialWorkAggregate (real optimistic concurrency), fake
 * executeCapability with controllable delay/outcome per step - no live LLM
 * anywhere in this file.
 *
 * The synthetic 3-independent-read work below (three GET_SHIPPING_QUOTE
 * objectives, each with its own CALCULATE_SHIPPING step, no dependencies) is
 * never producible by the real semantic pipeline (deriveCommercialObjectives'
 * own same-family supersession only ever keeps one GET_SHIPPING_QUOTE
 * objective active at a time) - it exists solely to exercise the wave
 * mechanism against a real, already-registered, read_only capability
 * (calculate_shipping) without expanding production capability coverage.
 * See the A09 release doc, Part 8/10, for why today's real production graph
 * has no natural multi-read-only-step scenario.
 */

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

const NOW = "2026-08-20T12:00:00.000Z";
let conversationId = 0;
let opportunityId = 0;

before(async () => {
  conversationId = await seedConversation();
  opportunityId = await seedOpportunity();
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function unique(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function seedConversation(): Promise<number> {
  const [result] = await getPool().execute(
    `INSERT INTO conversation (
      public_id, channel, provider, channel_account_id, external_contact_id,
      status, owner_type, ai_enabled, human_owner_active
    ) VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [randomUUID(), unique("phone"), unique("wa")]
  );
  return Number((result as { insertId: number }).insertId);
}

async function seedOpportunity(): Promise<number> {
  const [result] = await getPool().execute(
    `INSERT INTO crm_opportunities (
      opportunity_key, wa_id, channel, primary_intent, status,
      requirements_json, missing_requirements_json, product_interests_json,
      objections_json, signals_json
    ) VALUES (?, ?, 'whatsapp', 'sales', 'open', JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_OBJECT())`,
    [unique("cwpar-opportunity"), unique("wa")]
  );
  return Number((result as { insertId: number }).insertId);
}

/**
 * Non-null facts so each synthetic step's real FACT_CONFIRMED dependencies
 * (matching what deriveCommercialWorkSteps.ts actually generates for a
 * GET_SHIPPING_QUOTE objective) are satisfied from the start - an empty
 * dependency array would make canAutoActivateStep's "dependency just became
 * satisfied" re-activation pass fire unconditionally and immediately flip a
 * fresh WAITING_CUSTOMER step straight back to READY, which is a test
 * artifact, not real executor behavior.
 */
const SATISFIED_FACTS = {
  commercialLineItems: { factId: "synthetic-line-items", updatedAt: NOW, items: [{ productId: "31", combinationId: null, quantity: 1 }] },
  shippingDestination: { factId: "synthetic-destination", updatedAt: NOW, communeId: 1, canonicalName: "Synthetic", matchedVia: "direct" as const },
  selectedShippingOption: null,
  createdQuote: null
};

/** Three independent GET_SHIPPING_QUOTE objectives / CALCULATE_SHIPPING steps - see file header for why this is synthetic. */
function buildIndependentReadOnlyWork(count = 3): CommercialWork {
  const prefix = unique("wave");
  const objectives = Array.from({ length: count }, (_, i) => ({
    objectiveId: `${prefix}-obj-${i}`,
    type: "GET_SHIPPING_QUOTE" as const,
    status: "READY" as const,
    origin: "customer_requested" as const,
    inputs: {},
    resolvedInputs: {},
    missingRequirements: [],
    supersedesObjectiveIds: [],
    evidence: [],
    blockers: []
  }));
  const steps = objectives.map((objective) => ({
    stepId: `${objective.objectiveId}:step:CALCULATE_SHIPPING`,
    objectiveIds: [objective.objectiveId],
    type: "CALCULATE_SHIPPING" as const,
    status: "READY" as const,
    dependencies: [{ type: "FACT_CONFIRMED" as const, factType: "commercial_line_items" as const }, { type: "FACT_CONFIRMED" as const, factType: "shipping_destination" as const }],
    capabilityName: "calculate_shipping" as const,
    input: {},
    evidence: [],
    blockers: [],
    retryable: false,
    retryCandidate: false,
    idempotencyKey: null,
    attemptCount: 0,
    maxAttempts: null,
    nextAttemptAt: null,
    startedAt: null,
    lastAttemptAt: null,
    lockOwner: null,
    lockUntil: null
  }));
  const withoutMetrics = {
    id: unique("work"),
    projectionVersion: 1 as const,
    opportunityId,
    conversationId,
    sourceMessageId: null,
    sourceSequence: null,
    lastReconciledSequence: null,
    previousWorkPublicId: null,
    supersedesWorkPublicId: null,
    trigger: { type: "SYSTEM_EVENT" as const, eventType: "cwpar_test_seed", correlationId: unique("corr"), conversationId, opportunityId },
    status: "ACTIVE" as const,
    objectives,
    steps,
    blockers: [],
    derivedAt: NOW
  };
  return { ...withoutMetrics, metrics: deriveCommercialWorkMetrics(withoutMetrics) };
}

async function persistIndependentReadOnlyWork(count = 3) {
  return persistCommercialWorkProjection({ work: buildIndependentReadOnlyWork(count), correlationKey: unique("cwpar-correlation") });
}

function gatewayResult(capability: string, status: CapabilityGatewayResult["status"], errorCode: string | null, retryable: boolean): CapabilityGatewayResult {
  return {
    capability,
    version: "capability-gateway.v1",
    availability: "available",
    status,
    data: status === "completed" ? { status: "available" } : null,
    errorCode,
    retryable,
    evidence: [],
    warnings: [],
    retryCount: 0,
    startedAt: NOW,
    completedAt: NOW,
    executionPublicId: unique(`exec-${capability}`)
  };
}

type StepBehavior = { status: CapabilityGatewayResult["status"]; delayMs?: number; throwError?: boolean };

/** Keyed by stepId (passed through as context.actionId, unchanged from the pre-A09 single-step call shape). */
function makeControllableGateway(behaviors: Record<string, StepBehavior>) {
  const calls: Array<{ stepId: string; startedAt: number; finishedAt: number }> = [];
  const executeCapability: ExecuteCommercialWorkInput["executeCapability"] = async (capabilityName, _gwInput, context) => {
    const stepId = context.actionId as string;
    const behavior = behaviors[stepId] ?? { status: "completed" as const };
    const startedAt = Date.now();
    if (behavior.delayMs) await new Promise((resolve) => setTimeout(resolve, behavior.delayMs));
    calls.push({ stepId, startedAt, finishedAt: Date.now() });
    if (behavior.throwError) throw new Error(`simulated_crash:${stepId}`);
    return gatewayResult(capabilityName, behavior.status, behavior.status === "completed" ? null : "forced_outcome", behavior.status === "temporarily_blocked");
  };
  return { calls, executeCapability };
}

function baseExecutionInput(overrides: Partial<ExecuteCommercialWorkInput> = {}): Omit<ExecuteCommercialWorkInput, "workPublicId" | "expectedVersion" | "executeCapability"> {
  return {
    context: { correlationId: unique("corr"), conversationId, opportunityId },
    loadCurrentFacts: async () => SATISFIED_FACTS,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    scheduleRetries: true,
    now: NOW,
    parallelExecutionEnabled: true,
    maxParallelSteps: 3,
    ...overrides
  };
}

test("[CWPAR01/CWPAR19] three independent read_only steps execute concurrently - real wall-clock speedup over sequential", async () => {
  const delayMs = 150;
  const seq = { calls: 0 };
  void seq;

  const parallelCreated = await persistIndependentReadOnlyWork(3);
  const parallelStepIds = parallelCreated.work.steps.map((s) => s.stepId);
  const parallelGateway = makeControllableGateway(Object.fromEntries(parallelStepIds.map((id) => [id, { status: "completed" as const, delayMs }])));
  const parallelStart = Date.now();
  const parallelResult = await executeCommercialWork({
    workPublicId: parallelCreated.work.publicId,
    expectedVersion: parallelCreated.work.version,
    executeCapability: parallelGateway.executeCapability,
    ...baseExecutionInput({ parallelExecutionEnabled: true, maxParallelSteps: 3 })
  });
  const parallelElapsed = Date.now() - parallelStart;

  const sequentialCreated = await persistIndependentReadOnlyWork(3);
  const sequentialStepIds = sequentialCreated.work.steps.map((s) => s.stepId);
  const sequentialGateway = makeControllableGateway(Object.fromEntries(sequentialStepIds.map((id) => [id, { status: "completed" as const, delayMs }])));
  const sequentialStart = Date.now();
  const sequentialResult = await executeCommercialWork({
    workPublicId: sequentialCreated.work.publicId,
    expectedVersion: sequentialCreated.work.version,
    executeCapability: sequentialGateway.executeCapability,
    ...baseExecutionInput({ parallelExecutionEnabled: false })
  });
  const sequentialElapsed = Date.now() - sequentialStart;

  assert.ok(parallelResult.work?.objectives.every((o) => o.status === "COMPLETED"), "all three objectives complete under parallel execution");
  assert.ok(sequentialResult.work?.objectives.every((o) => o.status === "COMPLETED"), "all three objectives complete under sequential execution");
  assert.equal(parallelGateway.calls.length, 3);
  assert.equal(sequentialGateway.calls.length, 3);

  console.log(`[CWPAR19] sequential=${sequentialElapsed}ms parallel=${parallelElapsed}ms speedup=${(sequentialElapsed / parallelElapsed).toFixed(2)}x`);
  // Part 51: 3 independent equal-latency reads, parallel <= 60% of sequential - generous bound, not brittle ms equality.
  assert.ok(parallelElapsed <= sequentialElapsed * 0.6, `expected parallel (${parallelElapsed}ms) <= 60% of sequential (${sequentialElapsed}ms)`);
  assert.ok(parallelElapsed < delayMs * 2, "three concurrent calls of ~150ms each must finish well under 300ms, not ~450ms");
});

test("[CWPAR06] deterministic result application order is wave order (priority/stepId), never completion order", async () => {
  const created = await persistIndependentReadOnlyWork(3);
  const [stepA, stepB, stepC] = [...created.work.steps].sort((a, b) => a.stepId.localeCompare(b.stepId));
  // stepC (last in wave/application order) resolves FASTEST; stepA (first) resolves SLOWEST - if completion order controlled anything, records would come back reversed.
  const gateway = makeControllableGateway({
    [stepA.stepId]: { status: "completed", delayMs: 120 },
    [stepB.stepId]: { status: "completed", delayMs: 60 },
    [stepC.stepId]: { status: "completed", delayMs: 5 }
  });
  const result = await executeCommercialWork({
    workPublicId: created.work.publicId,
    expectedVersion: created.work.version,
    executeCapability: gateway.executeCapability,
    ...baseExecutionInput()
  });
  assert.deepEqual(
    result.records.map((r) => r.stepId),
    [stepA.stepId, stepB.stepId, stepC.stepId],
    "records must be in wave/priority order, not the order calls actually settled"
  );
});

test("[CWPAR07/CWPAR23] one sibling temporarily_blocked schedules its own retry without forcing successful siblings to retry", async () => {
  const created = await persistIndependentReadOnlyWork(3);
  const [stepA, stepB, stepC] = created.work.steps;
  const gateway = makeControllableGateway({
    [stepA.stepId]: { status: "completed" },
    [stepB.stepId]: { status: "temporarily_blocked" },
    [stepC.stepId]: { status: "completed" }
  });
  const result = await executeCommercialWork({
    workPublicId: created.work.publicId,
    expectedVersion: created.work.version,
    executeCapability: gateway.executeCapability,
    ...baseExecutionInput()
  });
  const byId = (id: string) => result.work?.steps.find((s) => s.stepId === id);
  assert.equal(byId(stepA.stepId)?.status, "COMPLETED");
  assert.equal(byId(stepC.stepId)?.status, "COMPLETED");
  assert.ok(byId(stepB.stepId)?.status === "RETRY_SCHEDULED" || byId(stepB.stepId)?.status === "WAITING_SYSTEM");
  assert.equal(byId(stepA.stepId)?.attemptCount, 0, "A never entered a retry cycle");
  assert.equal(byId(stepC.stepId)?.attemptCount, 0, "C never entered a retry cycle");
});

test("[CWPAR08/CWPAR27] one sibling's negative outcome preserves completed sibling evidence, never discarded", async () => {
  // SALES-AGENT-R2-A09 audit finding (pre-existing, unrelated to the wave
  // mechanism - documented in the release doc's "remaining limitations",
  // not fixed here as out of scope): activateUnblockedSteps'
  // canAutoActivateStep treats a bare "WAITING_CUSTOMER" blocker code as
  // always safe to immediately re-activate once dependenciesSatisfied is
  // true - but for a step whose FACT_CONFIRMED dependencies were already
  // satisfied BEFORE the capability call (as calculate_shipping's real
  // dependencies would be for a customer-provided-more-info scenario
  // unrelated to those two facts), that check trivially stays true and the
  // step is reactivated to READY in the very same round, discarding the
  // "waiting_customer" signal. This is identical, pre-existing behavior for
  // a single non-wave step too (same functions, same logic) - not something
  // this task introduces or is in scope to fix. "failed" is used here
  // instead of "missing_information" specifically because FAILED never
  // reaches that reactivation branch, letting this test verify the actually
  // in-scope A09 property: one sibling's negative outcome must never
  // discard another sibling's already-durable completed evidence.
  const created = await persistIndependentReadOnlyWork(3);
  const [stepA, stepB, stepC] = created.work.steps;
  const gateway = makeControllableGateway({
    [stepA.stepId]: { status: "completed" },
    [stepB.stepId]: { status: "failed" },
    [stepC.stepId]: { status: "completed" }
  });
  const result = await executeCommercialWork({
    workPublicId: created.work.publicId,
    expectedVersion: created.work.version,
    executeCapability: gateway.executeCapability,
    ...baseExecutionInput()
  });
  const byId = (id: string) => result.work?.steps.find((s) => s.stepId === id);
  assert.equal(byId(stepA.stepId)?.status, "COMPLETED");
  assert.equal(byId(stepA.stepId)?.evidence.length, 1, "A's completed evidence is not discarded because B failed");
  assert.equal(byId(stepC.stepId)?.status, "COMPLETED");
  assert.equal(byId(stepC.stepId)?.evidence.length, 1, "C's completed evidence is not discarded because B failed");
  assert.equal(byId(stepB.stepId)?.status, "FAILED");
  const objectiveB = result.work?.objectives.find((o) => o.objectiveId === stepB.objectiveIds[0]);
  assert.equal(objectiveB?.status, "FAILED");
  const objectiveA = result.work?.objectives.find((o) => o.objectiveId === stepA.objectiveIds[0]);
  assert.equal(objectiveA?.status, "COMPLETED", "A's objective status is independent of sibling B's failure");
});

test("[CWPAR10/CWPAR17-crash/CWPAR11] a thrown failure mid-wave persists successful siblings and never re-calls them on the next attempt (partial-wave crash recovery, idempotency)", async () => {
  const created = await persistIndependentReadOnlyWork(3);
  const [stepA, stepB, stepC] = created.work.steps;
  const crashingGateway = makeControllableGateway({
    [stepA.stepId]: { status: "completed" },
    [stepB.stepId]: { status: "completed" },
    [stepC.stepId]: { status: "completed", throwError: true }
  });

  await assert.rejects(
    executeCommercialWork({
      workPublicId: created.work.publicId,
      expectedVersion: created.work.version,
      executeCapability: crashingGateway.executeCapability,
      ...baseExecutionInput()
    }),
    /simulated_crash/
  );
  assert.equal(crashingGateway.calls.length, 3, "all three were attempted once");

  const afterCrash = await getCommercialWorkByPublicId(created.work.publicId);
  assert.equal(afterCrash?.steps.find((s) => s.stepId === stepA.stepId)?.status, "COMPLETED", "A's real side effect survives the crash, durably recorded");
  assert.equal(afterCrash?.steps.find((s) => s.stepId === stepB.stepId)?.status, "COMPLETED");
  assert.equal(afterCrash?.steps.find((s) => s.stepId === stepC.stepId)?.status, "READY", "C was never marked as anything - it stays retryable, not silently lost");

  // "Restart": a fresh executeCommercialWork call against the now-current version. C must be the ONLY one attempted again.
  const restartGateway = makeControllableGateway({ [stepC.stepId]: { status: "completed" } });
  const restarted = await executeCommercialWork({
    workPublicId: afterCrash!.publicId,
    expectedVersion: afterCrash!.version,
    executeCapability: restartGateway.executeCapability,
    ...baseExecutionInput()
  });
  assert.deepEqual(restartGateway.calls.map((c) => c.stepId), [stepC.stepId], "duplicate side effects = 0: A and B are never called again after restart");
  assert.ok(restarted.work?.objectives.every((o) => o.status === "COMPLETED"));
});

test("[CWPAR16] version conflict on a stale expectedVersion is rejected before any capability call, wave or not", async () => {
  const created = await persistIndependentReadOnlyWork(3);
  const gateway = makeControllableGateway({});
  const result = await executeCommercialWork({
    workPublicId: created.work.publicId,
    expectedVersion: created.work.version + 1,
    executeCapability: gateway.executeCapability,
    ...baseExecutionInput()
  });
  assert.equal(result.outcome, "version_conflict");
  assert.equal(gateway.calls.length, 0);
});

test("[CWPAR12/CWPAR13/CWPAR14/CWPAR15] a wave in flight never becomes authoritative once a concurrent writer (stale-turn/correction/cancellation/handoff, all modeled the same way at this layer: a version-bumping commit) lands first", async () => {
  // This is exactly the real production shape: any newer commercial trigger
  // (a newer customer turn via reconciliation.ts, a scoped cancellation, a
  // handoff) reaches the SAME updateCommercialWorkAggregate optimistic-
  // concurrency gate this test exercises directly - A09 adds no new
  // mechanism here, it only proves the wave path does not weaken it. The
  // wave's own external capability calls may still complete for real (their
  // results remain historical/auditable per Part 17) - what must never
  // happen is the stale wave's persist silently overwriting the newer state.
  const created = await persistIndependentReadOnlyWork(2);
  const gateway = makeControllableGateway(Object.fromEntries(created.work.steps.map((s) => [s.stepId, { status: "completed" as const, delayMs: 150 }])));

  const wavePromise = executeCommercialWork({
    workPublicId: created.work.publicId,
    expectedVersion: created.work.version,
    executeCapability: gateway.executeCapability,
    ...baseExecutionInput()
  });

  // Let the wave read its version/facts and start its (artificially slow)
  // concurrent capability calls before the concurrent writer commits.
  await new Promise((resolve) => setTimeout(resolve, 30));

  // Simulate a newer commercial trigger landing first (handoff, in this
  // instance - ACTIVE -> HANDOFF is a real, valid transition): commits
  // against the SAME expectedVersion the wave already captured, bumping the
  // DB version out from under it.
  const concurrentWrite = await updateCommercialWorkAggregate({
    publicId: created.work.publicId,
    expectedVersion: created.work.version,
    nextWork: { ...created.work, status: "HANDOFF", blockers: [{ code: "HUMAN_OWNER_ACTIVE", source: "conversation" }] }
  });
  assert.equal(concurrentWrite.status, "HANDOFF");
  assert.equal(concurrentWrite.version, created.work.version + 1);

  await assert.rejects(wavePromise, (error: unknown) => isCommercialWorkPersistenceVersionConflict(error));
  assert.equal(gateway.calls.length, 2, "the external calls still happened for real (historical/auditable, Part 17) - only the persist was rejected");

  const final = await getCommercialWorkByPublicId(created.work.publicId);
  assert.equal(final?.status, "HANDOFF", "the concurrent writer's state is authoritative");
  assert.equal(final?.version, created.work.version + 1, "the stale wave never bumped the version a second time");
  assert.ok(final?.steps.every((s) => s.status === "READY"), "the stale wave's COMPLETED results were never applied to durable state");
});

test("[CWPAR09] two racing claims for the same worker-owned step never both succeed, and the loser makes zero capability calls", async () => {
  const created = await persistIndependentReadOnlyWork(1);
  const step = created.work.steps[0];
  const candidate: DueCommercialWorkStepRow = {
    work_public_id: created.work.publicId,
    work_version: created.work.version,
    opportunity_id: opportunityId,
    conversation_id: conversationId,
    step_id: step.stepId,
    step_type: step.type,
    step_status: step.status,
    attempt_count: step.attemptCount,
    max_attempts: step.maxAttempts,
    next_attempt_at: step.nextAttemptAt,
    lock_owner: step.lockOwner,
    lock_until: step.lockUntil
  };

  const [claimedByWorker1, claimedByWorker2] = await Promise.all([
    claimDueCommercialWorkStep(candidate, { workerId: "worker-1", now: NOW, lockSeconds: 60 }),
    claimDueCommercialWorkStep(candidate, { workerId: "worker-2", now: NOW, lockSeconds: 60 })
  ]);
  assert.equal([claimedByWorker1, claimedByWorker2].filter(Boolean).length, 1, "exactly one worker wins the CAS claim");

  const afterClaim = await getCommercialWorkByPublicId(created.work.publicId);
  const claimedStep = afterClaim?.steps.find((s) => s.stepId === step.stepId);
  assert.equal(claimedStep?.status, "RUNNING");
  const winnerId = claimedByWorker1 ? "worker-1" : "worker-2";
  assert.equal(claimedStep?.lockOwner, winnerId);

  const gateway = makeControllableGateway({ [step.stepId]: { status: "completed" } });
  const executed = await executeCommercialWork({
    workPublicId: afterClaim!.publicId,
    expectedVersion: afterClaim!.version,
    executeCapability: gateway.executeCapability,
    claimedStepId: step.stepId,
    workerId: winnerId,
    ...baseExecutionInput()
  });
  assert.equal(gateway.calls.length, 1, "only the winner's executeCommercialWork call ever executes the capability - no duplicate execution");
  assert.equal(executed.work?.steps.find((s) => s.stepId === step.stepId)?.status, "COMPLETED");
});

test("[CWPAR18] parallelExecutionEnabled=false against a multi-read-eligible work executes exactly one step per round (unchanged sequential behavior)", async () => {
  const created = await persistIndependentReadOnlyWork(3);
  const stepIds = created.work.steps.map((s) => s.stepId);
  const gateway = makeControllableGateway(Object.fromEntries(stepIds.map((id) => [id, { status: "completed" as const }])));
  const result = await executeCommercialWork({
    workPublicId: created.work.publicId,
    expectedVersion: created.work.version,
    executeCapability: gateway.executeCapability,
    ...baseExecutionInput({ parallelExecutionEnabled: false, maxSteps: 10 })
  });
  assert.ok(result.work?.objectives.every((o) => o.status === "COMPLETED"));
  assert.equal(result.waveDecisions.filter((d) => d.decision === "primary_step").length, 3, "three separate single-step rounds, never one multi-step wave");
  assert.equal(result.records.length, 3, "one capability call per round, exactly like pre-A09 sequential execution");
});

test("[CWPAR25] a fresh executeCommercialWork call reloads wave state strictly from the DB, never from in-memory leftovers", async () => {
  const created = await persistIndependentReadOnlyWork(3);
  const stepIds = created.work.steps.map((s) => s.stepId);
  const gateway = makeControllableGateway(Object.fromEntries(stepIds.map((id) => [id, { status: "completed" as const }])));
  await executeCommercialWork({
    workPublicId: created.work.publicId,
    expectedVersion: created.work.version,
    executeCapability: gateway.executeCapability,
    ...baseExecutionInput()
  });

  const reloaded = await getCommercialWorkByPublicId(created.work.publicId);
  assert.ok(reloaded);
  assert.ok(reloaded!.objectives.every((o) => o.status === "COMPLETED"));
  // A completely independent call, no shared in-memory state with the call above, sees the same durable result.
  const secondGateway = makeControllableGateway({});
  const secondPass = await executeCommercialWork({
    workPublicId: reloaded!.publicId,
    expectedVersion: reloaded!.version,
    executeCapability: secondGateway.executeCapability,
    ...baseExecutionInput()
  });
  assert.equal(secondGateway.calls.length, 0, "nothing left to execute - state came from the DB, not a stale in-process wave");
  assert.equal(secondPass.outcome, "terminal", "the work is durably COMPLETED in the DB - a fresh call sees that immediately, not a re-derived ready-step scan");
});

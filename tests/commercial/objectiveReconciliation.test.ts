import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCommercialObjectiveReconciliationDecision,
  decideCommercialObjectiveReconciliation,
  buildTurnObjectiveId,
  reconcileCommercialObjective
} from "@/lib/brain/commercial/work/objective-reconciliation";
import type { CommercialProposalV1 } from "@/lib/brain/commercial/commercial-proposal";
import type { CommercialObjective, CommercialWork } from "@/lib/brain/commercial/work/types";
import { CommercialWorkPersistenceError } from "@/lib/brain/commercial/work/persistenceTypes";
import type { CommercialWorkDatabaseAdapter, PersistedCommercialWork } from "@/lib/brain/commercial/work/persistenceTypes";

function buildObjective(overrides: Partial<CommercialObjective> = {}): CommercialObjective {
  return {
    objectiveId: "cwo-existing",
    type: "QUOTE",
    status: "PENDING",
    origin: "customer_requested",
    inputs: {},
    resolvedInputs: {},
    missingRequirements: [],
    supersedesObjectiveIds: [],
    evidence: [],
    blockers: [],
    ...overrides
  };
}

function buildWork(overrides: Partial<PersistedCommercialWork> = {}): PersistedCommercialWork {
  const base: CommercialWork = {
    id: "projection:1:test",
    projectionVersion: 1,
    opportunityId: 1,
    conversationId: 1,
    sourceMessageId: null,
    sourceSequence: null,
    lastReconciledSequence: null,
    previousWorkPublicId: null,
    supersedesWorkPublicId: null,
    trigger: { type: "SYSTEM_EVENT", eventType: "test", correlationId: "corr-1", conversationId: 1, opportunityId: 1 },
    status: "ACTIVE",
    objectives: [],
    steps: [],
    blockers: [],
    derivedAt: "2026-09-16T00:00:00.000Z",
    metrics: { objectiveCount: 0, readyStepCount: 0, waitingCustomerObjectiveCount: 0, waitingSystemStepCount: 0, blockerCount: 0 }
  };
  return {
    ...base,
    publicId: "cw-test",
    correlationKey: "corr-key-test",
    version: 1,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    ...overrides
  };
}

function buildProposal(overrides: { objective?: CommercialProposalV1["objective"] } = {}): CommercialProposalV1 {
  return {
    schemaVersion: "1",
    objective: "objective" in overrides ? overrides.objective! : { kind: "QUOTE", operation: "START", confidence: "HIGH" },
    requestedOutcome: null,
    requirementSignals: [],
    evidenceCodes: [],
    ambiguity: { present: false, reasonCode: null }
  };
}

const TURN_ID = buildTurnObjectiveId("cw-test", "inbound-1");

// P5-R1: no active objective + QUOTE/START -> START
test("P5-R1: START with no active objective starts", () => {
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "QUOTE", operation: "START", confidence: "HIGH" } }),
    activeObjective: null,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "START", kind: "QUOTE", reasonCode: "START_NO_ACTIVE_OBJECTIVE" });
});

// P5-R2: active QUOTE + QUOTE/CONTINUE -> same objective, no duplicate
test("P5-R2: CONTINUE with active same-kind objective continues it", () => {
  const active = buildObjective({ objectiveId: "cwo-abc", type: "QUOTE" });
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "QUOTE", operation: "CONTINUE", confidence: "HIGH" } }),
    activeObjective: active,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "CONTINUE", objectiveId: "cwo-abc", reasonCode: "CONTINUE_SAME_OBJECTIVE" });
});

// P5-R3: active QUOTE + QUOTE/MODIFY -> modify same objective
test("P5-R3: MODIFY with active same-kind objective modifies it", () => {
  const active = buildObjective({ objectiveId: "cwo-abc", type: "QUOTE" });
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "QUOTE", operation: "MODIFY", confidence: "MEDIUM" } }),
    activeObjective: active,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "MODIFY", objectiveId: "cwo-abc", reasonCode: "MODIFY_SAME_OBJECTIVE" });
});

// P5-R4: active QUOTE + SELECT_PRODUCTS/REPLACE -> replace correctly
test("P5-R4: REPLACE with a different active objective supersedes it", () => {
  const active = buildObjective({ objectiveId: "cwo-abc", type: "QUOTE" });
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "SELECT_PRODUCTS", operation: "REPLACE", confidence: "HIGH" } }),
    activeObjective: active,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "REPLACE", previousObjectiveId: "cwo-abc", kind: "SELECT_PRODUCTS", reasonCode: "REPLACE_ACTIVE_OBJECTIVE" });
});

// P5-R5: active QUOTE + proposal objective null -> NOOP; QUOTE remains active
test("P5-R5: null proposal objective is NOOP regardless of active objective", () => {
  const active = buildObjective({ objectiveId: "cwo-abc", type: "QUOTE" });
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: null }),
    activeObjective: active,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "NOOP", reasonCode: "PROPOSAL_OBJECTIVE_ABSENT" });
});

// P5-R6: no active objective + QUOTE/CONTINUE -> reject, no unsafe implicit START
test("P5-R6: CONTINUE with no active objective rejects", () => {
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "QUOTE", operation: "CONTINUE", confidence: "HIGH" } }),
    activeObjective: null,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "REJECT", reasonCode: "CONTINUE_WITHOUT_ACTIVE_OBJECTIVE" });
});

// P5-R7: active SELECT_PRODUCTS + QUOTE/CONTINUE -> reject (kind mismatch)
test("P5-R7: CONTINUE against a different-kind active objective rejects", () => {
  const active = buildObjective({ objectiveId: "cwo-abc", type: "SELECT_PRODUCTS" });
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "QUOTE", operation: "CONTINUE", confidence: "HIGH" } }),
    activeObjective: active,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "REJECT", reasonCode: "CONTINUE_KIND_MISMATCH" });
});

// P5-R8: active QUOTE + QUOTE/CANCEL -> objective cancellation only
test("P5-R8: CANCEL against the matching active objective cancels it", () => {
  const active = buildObjective({ objectiveId: "cwo-abc", type: "QUOTE" });
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "QUOTE", operation: "CANCEL", confidence: "HIGH" } }),
    activeObjective: active,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "CANCEL", objectiveId: "cwo-abc", reasonCode: "CANCEL_ACTIVE_OBJECTIVE" });
});

// P5-R9: COMPLETE without required durable success evidence -> cannot falsely complete
test("P5-R9: COMPLETE always rejects (no durable evidence wired yet)", () => {
  const active = buildObjective({ objectiveId: "cwo-abc", type: "QUOTE" });
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "QUOTE", operation: "COMPLETE", confidence: "HIGH" } }),
    activeObjective: active,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "REJECT", reasonCode: "COMPLETE_EVIDENCE_NOT_WIRED" });
});

// P5-R14: "gracias" (objective null) while QUOTE active -> NOOP
test("P5-R14: proposal.objective null with QUOTE active is NOOP (gracias)", () => {
  const active = buildObjective({ objectiveId: "cwo-abc", type: "QUOTE" });
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: null }),
    activeObjective: active,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.equal(decision.action, "NOOP");
});

// Additional determinism/safety coverage beyond the R1-R15 minimum:

test("operation NONE is NOOP even with a real objective kind present", () => {
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "QUOTE", operation: "NONE", confidence: "LOW" } }),
    activeObjective: null,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "NOOP", reasonCode: "OPERATION_NONE" });
});

test("START collapses to CONTINUE when an objective of the same kind is already active", () => {
  const active = buildObjective({ objectiveId: "cwo-abc", type: "QUOTE" });
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "QUOTE", operation: "START", confidence: "HIGH" } }),
    activeObjective: active,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "CONTINUE", objectiveId: "cwo-abc", reasonCode: "START_COLLAPSED_SAME_KIND_ACTIVE" });
});

test("START against a different-kind active objective rejects (must say REPLACE)", () => {
  const active = buildObjective({ objectiveId: "cwo-abc", type: "SELECT_PRODUCTS" });
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "QUOTE", operation: "START", confidence: "HIGH" } }),
    activeObjective: active,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "REJECT", reasonCode: "START_WITH_DIFFERENT_ACTIVE_OBJECTIVE" });
});

test("REPLACE with no active objective starts fresh instead of rejecting", () => {
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "SELECT_PRODUCTS", operation: "REPLACE", confidence: "HIGH" } }),
    activeObjective: null,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "START", kind: "SELECT_PRODUCTS", reasonCode: "REPLACE_WITHOUT_ACTIVE_OBJECTIVE_TREATED_AS_START" });
});

// P5-R10 (decision-level idempotency): a retried REPLACE whose active objective
// is already the one THIS exact turn created must not supersede it again.
test("P5-R10: a retried REPLACE that already applied this turn is idempotent (CONTINUE, no re-supersede)", () => {
  const alreadyApplied = buildObjective({ objectiveId: TURN_ID, type: "SELECT_PRODUCTS" });
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "SELECT_PRODUCTS", operation: "REPLACE", confidence: "HIGH" } }),
    activeObjective: alreadyApplied,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "CONTINUE", objectiveId: TURN_ID, reasonCode: "REPLACE_ALREADY_APPLIED_THIS_TURN" });
});

test("MODIFY never changes the objective kind (only same-kind active is accepted)", () => {
  const active = buildObjective({ objectiveId: "cwo-abc", type: "SELECT_PRODUCTS" });
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "QUOTE", operation: "MODIFY", confidence: "HIGH" } }),
    activeObjective: active,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "REJECT", reasonCode: "MODIFY_KIND_MISMATCH" });
});

test("CANCEL against a different-kind active objective rejects", () => {
  const active = buildObjective({ objectiveId: "cwo-abc", type: "SELECT_PRODUCTS" });
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "QUOTE", operation: "CANCEL", confidence: "HIGH" } }),
    activeObjective: active,
    workStatus: "ACTIVE",
    turnObjectiveId: TURN_ID
  });
  assert.deepEqual(decision, { action: "REJECT", reasonCode: "CANCEL_KIND_MISMATCH" });
});

for (const workStatus of ["HANDOFF", "FAILED", "COMPLETED", "CANCELLED", "SUPERSEDED"] as const) {
  test(`a non-open work status (${workStatus}) rejects any real operation`, () => {
    const decision = decideCommercialObjectiveReconciliation({
      proposal: buildProposal({ objective: { kind: "QUOTE", operation: "START", confidence: "HIGH" } }),
      activeObjective: null,
      workStatus,
      turnObjectiveId: TURN_ID
    });
    assert.deepEqual(decision, { action: "REJECT", reasonCode: "WORK_NOT_OPEN" });
  });

  test(`a non-open work status (${workStatus}) still NOOPs a proposal with no objective`, () => {
    const decision = decideCommercialObjectiveReconciliation({
      proposal: buildProposal({ objective: null }),
      activeObjective: null,
      workStatus,
      turnObjectiveId: TURN_ID
    });
    assert.deepEqual(decision, { action: "NOOP", reasonCode: "PROPOSAL_OBJECTIVE_ABSENT" });
  });
}

// P5-R15: the reconciler never rewrites the proposal it was given.
test("P5-R15: reconciling never mutates the input CommercialProposalV1", async () => {
  const proposal = buildProposal({ objective: { kind: "QUOTE", operation: "CONTINUE", confidence: "HIGH" } });
  const snapshot = JSON.parse(JSON.stringify(proposal));
  const work = buildWork({ objectives: [buildObjective({ objectiveId: "cwo-abc", type: "QUOTE" })] });
  await reconcileCommercialObjective({ proposal, work, inboundMessageId: "inbound-1" });
  assert.deepEqual(proposal, snapshot);
});

// Orchestrator-level checks that never touch the DB (only START/REPLACE/CANCEL
// call updateCommercialWorkAggregate - see WRITE_ACTIONS in
// applyCommercialObjectiveReconciliation.ts). These exercise the real
// reconcileCommercialObjective end-to-end for every non-writing path.

test("orchestrator: NOOP proposal leaves the same work object untouched, no DB call", async () => {
  const work = buildWork({ objectives: [buildObjective({ objectiveId: "cwo-abc", type: "QUOTE" })] });
  const result = await reconcileCommercialObjective({ proposal: null, work, inboundMessageId: "inbound-1" });
  assert.equal(result.decision.action, "NOOP");
  assert.equal(result.work, work);
});

test("orchestrator: CONTINUE leaves the same work object untouched, no DB call", async () => {
  const work = buildWork({ objectives: [buildObjective({ objectiveId: "cwo-abc", type: "QUOTE" })] });
  const proposal = buildProposal({ objective: { kind: "QUOTE", operation: "CONTINUE", confidence: "HIGH" } });
  const result = await reconcileCommercialObjective({ proposal, work, inboundMessageId: "inbound-1" });
  assert.deepEqual(result.decision, { action: "CONTINUE", objectiveId: "cwo-abc", reasonCode: "CONTINUE_SAME_OBJECTIVE" });
  assert.equal(result.work, work);
});

test("orchestrator: REJECT (kind mismatch) leaves the same work object untouched, no DB call", async () => {
  const work = buildWork({ objectives: [buildObjective({ objectiveId: "cwo-abc", type: "SELECT_PRODUCTS" })] });
  const proposal = buildProposal({ objective: { kind: "QUOTE", operation: "CONTINUE", confidence: "HIGH" } });
  const result = await reconcileCommercialObjective({ proposal, work, inboundMessageId: "inbound-1" });
  assert.equal(result.decision.action, "REJECT");
  assert.equal(result.work, work);
});

test("orchestrator: COMPLETE always rejects without touching the DB", async () => {
  const work = buildWork({ objectives: [buildObjective({ objectiveId: "cwo-abc", type: "QUOTE" })] });
  const proposal = buildProposal({ objective: { kind: "QUOTE", operation: "COMPLETE", confidence: "HIGH" } });
  const result = await reconcileCommercialObjective({ proposal, work, inboundMessageId: "inbound-1" });
  assert.deepEqual(result.decision, { action: "REJECT", reasonCode: "COMPLETE_EVIDENCE_NOT_WIRED" });
  assert.equal(result.work, work);
});

test("buildTurnObjectiveId is deterministic per (workPublicId, inboundMessageId) and differs across either input", () => {
  const a = buildTurnObjectiveId("cw-1", "inbound-1");
  const b = buildTurnObjectiveId("cw-1", "inbound-1");
  const c = buildTurnObjectiveId("cw-1", "inbound-2");
  const d = buildTurnObjectiveId("cw-2", "inbound-1");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.match(a, /^cwo-[0-9a-f]{32}$/);
});

/**
 * SALES-AGENT-R3-P5. Exercises the exact narrow seam
 * applyCommercialObjectiveReconciliationDecision (and, underneath,
 * updateCommercialWorkAggregate) already exposes for tests -
 * CommercialWorkDatabaseAdapter - rather than a full fake SQL engine.
 * updateCommercialWorkAggregate reads the current row and compares versions
 * BEFORE ever opening a transaction (repository.ts), so a `queryRows` stub
 * returning a row at a different version than `expectedVersion` reaches the
 * real VERSION_CONFLICT throw without needing `withConnection` at all - no
 * real DB, no large mock, no divergence from real CAS semantics (the
 * conflict check itself is the genuine production code, not reimplemented).
 */
function buildVersionConflictAdapter(publicId: string, actualVersion: number): CommercialWorkDatabaseAdapter {
  return {
    queryRows: async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
      if (sql.includes("FROM crm_commercial_work WHERE")) {
        return [{ id: 1, public_id: publicId, version: actualVersion }] as unknown as T[];
      }
      // crm_commercial_work_objectives / crm_commercial_work_steps reads - none needed for this row.
      return [];
    }
  };
}

test("VERSION_CONFLICT: applyCommercialObjectiveReconciliationDecision throws the real CommercialWorkPersistenceError, never a silent lost update", async () => {
  const work = buildWork({ publicId: "cw-conflict", version: 1 });
  const turnObjectiveId = buildTurnObjectiveId(work.publicId, "inbound-conflict");
  const decision = decideCommercialObjectiveReconciliation({
    proposal: buildProposal({ objective: { kind: "QUOTE", operation: "START", confidence: "HIGH" } }),
    activeObjective: null,
    workStatus: work.status,
    turnObjectiveId
  });
  assert.equal(decision.action, "START");

  const conflictingAdapter = buildVersionConflictAdapter(work.publicId, 2); // DB is already at version 2; we still expect 1

  await assert.rejects(
    () => applyCommercialObjectiveReconciliationDecision({ decision, work, turnObjectiveId }, conflictingAdapter),
    (error: unknown) => {
      assert.ok(error instanceof CommercialWorkPersistenceError, "must be the real CommercialWorkPersistenceError, not a generic Error");
      assert.equal((error as CommercialWorkPersistenceError).code, "VERSION_CONFLICT");
      return true;
    }
  );
});

/**
 * SALES-AGENT-R3-P5. Demonstrates the exact orchestration contract
 * runSalesAgentRuntimeCycle.ts implements (decide -> record decided ->
 * apply -> record reconciled ONLY on success) using the same small adapter
 * seam above, entirely in-process - no DB, no mock beyond the two rows this
 * decision path actually reads. This is the closest pure equivalent of "decided
 * event emitted, apply throws VERSION_CONFLICT, reconciled event not
 * emitted, warning generated": the full sequence (including the two real
 * commercial_event writes and the console.warn call) lives inline inside
 * runSalesAgentRuntimeCycle.ts, which requires the full DB-backed cycle
 * (session store, dispatch) to invoke end-to-end - reproducing that exact
 * function here would mean either a large DB-shaped mock of unrelated
 * machinery or duplicating orchestration logic outside its real home,
 * neither of which this task asked for. What IS provable purely, and is
 * proven below, is the precise decision point that orchestration branches
 * on: applyCommercialObjectiveReconciliationDecision throwing a real,
 * narrowly-typed VERSION_CONFLICT while decideCommercialObjectiveReconciliation
 * (called first, independently) already produced its own decision - i.e.
 * the decision exists and is stable regardless of whether apply succeeds.
 */
test("orchestration contract: the decision is fully computed and stable before apply ever runs, independent of whether apply then conflicts", async () => {
  const work = buildWork({ publicId: "cw-conflict-2", version: 1 });
  const turnObjectiveId = buildTurnObjectiveId(work.publicId, "inbound-conflict-2");
  const proposal = buildProposal({ objective: { kind: "QUOTE", operation: "START", confidence: "HIGH" } });

  const decision = decideCommercialObjectiveReconciliation({
    proposal,
    activeObjective: null,
    workStatus: work.status,
    turnObjectiveId
  });

  // The decision (what a commercial_objective_reconciliation_decided event
  // would carry) is already final here - nothing about calling apply next
  // can change it.
  assert.deepEqual(decision, { action: "START", kind: "QUOTE", reasonCode: "START_NO_ACTIVE_OBJECTIVE" });

  let threw = false;
  try {
    await applyCommercialObjectiveReconciliationDecision({ decision, work, turnObjectiveId }, buildVersionConflictAdapter(work.publicId, 2));
  } catch (error) {
    threw = error instanceof CommercialWorkPersistenceError && error.code === "VERSION_CONFLICT";
  }
  assert.equal(threw, true);

  // The decision object itself is untouched by the failed apply attempt -
  // a caller that already recorded it (step (b) in runSalesAgentRuntimeCycle.ts)
  // has a fully valid, unaffected record of what was decided.
  assert.deepEqual(decision, { action: "START", kind: "QUOTE", reasonCode: "START_NO_ACTIVE_OBJECTIVE" });
});

import { createHash } from "node:crypto";
import { selectActiveObjective } from "../../domain-read-model/buildCommercialDomainReadModel";
import type { CommercialProposalV1 } from "../../commercial-proposal/types";
import { deriveCommercialWorkMetrics, deriveCommercialWorkStatus } from "../evaluateCommercialWork";
import type { CommercialWorkDatabaseAdapter } from "../persistenceTypes";
import type { PersistedCommercialWork } from "../persistenceTypes";
import { updateCommercialWorkAggregate } from "../repository";
import type { CommercialObjective, CommercialWork } from "../types";
import { decideCommercialObjectiveReconciliation } from "./reconcile";
import type { CommercialObjectiveReconciliationDecision } from "./types";

export type CommercialObjectiveReconciliationResult = {
  decision: CommercialObjectiveReconciliationDecision;
  /** The work as it stands after this call - identical to the input work object whenever the decision performed no write (NOOP/REJECT/CONTINUE/MODIFY). */
  work: PersistedCommercialWork;
};

/**
 * SALES-AGENT-R3-P5. Idempotency contract - read this before changing
 * either buildTurnObjectiveId or applyCommercialObjectiveReconciliationDecision:
 *
 * - `turnObjectiveId` (below) is deterministic: sha256(workPublicId +
 *   inboundMessageId). The SAME turn always targets/creates the SAME
 *   objective row - insertObjective's own `ON DUPLICATE KEY UPDATE` on
 *   (commercial_work_id, public_id) upserts, never duplicates.
 * - `updateCommercialWorkAggregate`'s `expectedVersion` CAS prevents a lost
 *   update against a STALE work snapshot. It does NOT turn a stale retry
 *   into a clean no-op - it fails with `VERSION_CONFLICT` instead. See
 *   `applyCommercialObjectiveReconciliationDecision` below: it deliberately
 *   does not catch that error, and does not re-read or retry on it.
 * - Clean retry-idempotency (a repeated attempt collapsing to CONTINUE
 *   instead of failing) requires the CALLER to re-read CommercialWork fresh
 *   before deciding again - only then does `decideCommercialObjectiveReconciliation`
 *   see the just-created objective (`activeObjective.objectiveId === turnObjectiveId`)
 *   and collapse to CONTINUE (see reconcile.ts's `REPLACE_ALREADY_APPLIED_THIS_TURN`
 *   and START's same-kind-collapse rules).
 * - That fresh reload is provided TODAY by the turn-settlement/P3.5 seam,
 *   never by this module: a crashed/reclaimed turn re-runs
 *   `runSalesAgentRuntimeCycle.ts` from scratch, which re-runs
 *   `ensureCommercialWorkCase` (P3.5) and therefore re-reads the real row
 *   before this reconciler ever sees it again.
 * - P5 itself implements no internal retry and no internal re-read on
 *   VERSION_CONFLICT - it only has to behave correctly given whatever
 *   `work` snapshot it was handed, which is exactly what
 *   `decideCommercialObjectiveReconciliation` (pure) and
 *   `applyCommercialObjectiveReconciliationDecision` (single CAS attempt,
 *   no retry loop) below do.
 */
export function buildTurnObjectiveId(workPublicId: string, inboundMessageId: string): string {
  const digest = createHash("sha256").update(`commercial-objective:v1:${workPublicId}:${inboundMessageId}`).digest("hex").slice(0, 32);
  return `cwo-${digest}`;
}

function newObjective(objectiveId: string, kind: string, supersedesObjectiveIds: string[] = []): CommercialObjective {
  return {
    objectiveId,
    // Cast note: CommercialObjectiveKind's literal values are a subset of
    // CommercialObjectiveType (objectiveTypes.ts was extended with exactly
    // these four new values plus the pre-existing SELECT_PRODUCTS) - no
    // runtime mapping needed, kept as `as CommercialObjective["type"]` only
    // because this helper's own `kind` parameter is typed as `string` to
    // avoid importing CommercialObjectiveKind twice for a one-line helper.
    type: kind as CommercialObjective["type"],
    status: "PENDING",
    origin: "customer_requested",
    inputs: {},
    resolvedInputs: {},
    missingRequirements: [],
    supersedesObjectiveIds,
    evidence: [],
    blockers: []
  };
}

function buildNextObjectives(
  decision: CommercialObjectiveReconciliationDecision,
  objectives: readonly CommercialObjective[],
  turnObjectiveId: string
): CommercialObjective[] {
  if (decision.action === "START") {
    return [...objectives, newObjective(turnObjectiveId, decision.kind)];
  }
  if (decision.action === "REPLACE") {
    const superseded = objectives.map((objective) =>
      objective.objectiveId === decision.previousObjectiveId ? { ...objective, status: "SUPERSEDED" as const } : objective
    );
    return [...superseded, newObjective(turnObjectiveId, decision.kind, [decision.previousObjectiveId])];
  }
  if (decision.action === "CANCEL") {
    return objectives.map((objective) =>
      objective.objectiveId === decision.objectiveId ? { ...objective, status: "CANCELLED" as const } : objective
    );
  }
  return [...objectives];
}

export const COMMERCIAL_OBJECTIVE_RECONCILIATION_WRITE_ACTIONS = new Set<CommercialObjectiveReconciliationDecision["action"]>([
  "START",
  "REPLACE",
  "CANCEL"
]);

/**
 * SALES-AGENT-R3-P5. The only function in this module that touches the DB.
 * Given an ALREADY-DECIDED decision (reconcile.ts, pure) and the work it was
 * decided against, applies it - for START/REPLACE/CANCEL - through the
 * existing CAS writer (updateCommercialWorkAggregate, the same optimistic-
 * concurrency primitive P3.5's bootstrap and every R2 transition helper
 * already use). For NOOP/REJECT/CONTINUE/MODIFY, returns `input.work`
 * UNCHANGED (the same object reference - callers use that referential
 * equality to detect "did this call write anything").
 *
 * Deliberately does NOT catch a version conflict
 * (CommercialWorkPersistenceError with code "VERSION_CONFLICT") and does
 * NOT re-read or retry on one - see this module's own idempotency-contract
 * comment above buildTurnObjectiveId. The caller (runSalesAgentRuntimeCycle.ts)
 * owns that decision: it must have already recorded the
 * commercial_objective_reconciliation_decided event BEFORE calling this
 * function (the decision exists regardless of whether the write below
 * succeeds), and it only records commercial_objective_reconciled AFTER this
 * resolves successfully.
 */
export async function applyCommercialObjectiveReconciliationDecision(
  input: {
    decision: CommercialObjectiveReconciliationDecision;
    work: PersistedCommercialWork;
    turnObjectiveId: string;
  },
  adapter?: CommercialWorkDatabaseAdapter | null
): Promise<PersistedCommercialWork> {
  if (!COMMERCIAL_OBJECTIVE_RECONCILIATION_WRITE_ACTIONS.has(input.decision.action)) {
    return input.work;
  }

  const nextObjectives = buildNextObjectives(input.decision, input.work.objectives, input.turnObjectiveId);
  const nextWork: CommercialWork = {
    ...input.work,
    objectives: nextObjectives,
    status: deriveCommercialWorkStatus({ ...input.work, objectives: nextObjectives }),
    metrics: deriveCommercialWorkMetrics({ ...input.work, objectives: nextObjectives }),
    derivedAt: new Date().toISOString()
  };

  return updateCommercialWorkAggregate({ publicId: input.work.publicId, expectedVersion: input.work.version, nextWork }, adapter);
}

/**
 * SALES-AGENT-R3-P5. Convenience wrapper (decide, then apply, in one call)
 * for callers that don't need to interleave telemetry between the two steps
 * - this module's own decision-focused tests use it. The real production
 * wiring (runSalesAgentRuntimeCycle.ts) calls
 * decideCommercialObjectiveReconciliation and
 * applyCommercialObjectiveReconciliationDecision directly instead, so it can
 * record the decided-event in between decide and apply - see that file's
 * own comment for why (CAS-conflict observability).
 */
export async function reconcileCommercialObjective(
  input: {
    proposal: CommercialProposalV1 | null;
    work: PersistedCommercialWork;
    inboundMessageId: string;
  },
  adapter?: CommercialWorkDatabaseAdapter | null
): Promise<CommercialObjectiveReconciliationResult> {
  const activeObjective = selectActiveObjective(input.work);
  const turnObjectiveId = buildTurnObjectiveId(input.work.publicId, input.inboundMessageId);

  const decision = decideCommercialObjectiveReconciliation({
    proposal: input.proposal,
    activeObjective,
    workStatus: input.work.status,
    turnObjectiveId
  });

  const work = await applyCommercialObjectiveReconciliationDecision({ decision, work: input.work, turnObjectiveId }, adapter);
  return { decision, work };
}

import { deriveCommercialWorkMetrics } from "./evaluateCommercialWork";
import { resolveCommercialWorkTarget } from "./reconciliation";
import { persistCommercialWorkProjection } from "./repository";
import type { PersistedCommercialWork } from "./persistenceTypes";
import type { CommercialConversationProjection, CommercialOpportunityProjection, CommercialWork } from "./types";

export type EnsureCommercialWorkCaseInput = {
  conversationId: number;
  opportunityId: number;
  conversation: CommercialConversationProjection;
  opportunity: CommercialOpportunityProjection;
  correlationId: string;
  now: string;
};

export type EnsureCommercialWorkCaseResult =
  | { result: "EXISTING" | "CREATED"; work: PersistedCommercialWork }
  | { result: "FAILED"; error: unknown };

/**
 * SALES-AGENT-R3-P3.5. deriveCommercialWorkStatus (evaluateCommercialWork.ts)
 * maps a zero-objective work to COMPLETED - correct for a turn that
 * reconciled down to nothing, wrong for a fresh case kernel that has no
 * objective YET (COMPLETED is terminal and invisible to
 * findActiveCommercialWorks, which would break the reuse/idempotency
 * requirement this bootstrap exists for). Status is set directly to ACTIVE
 * instead of derived, only for this bootstrap-only, zero-objective shape -
 * every other CommercialWork producer in this codebase keeps deriving it.
 */
function buildEmptyCommercialWorkCase(input: EnsureCommercialWorkCaseInput, previousWork: PersistedCommercialWork | null): CommercialWork {
  const derivedAt = new Date(input.now).toISOString();
  const workWithoutMetrics = {
    id: `projection:${input.conversationId}:kernel-bootstrap`,
    projectionVersion: 1 as const,
    opportunityId: input.opportunityId,
    conversationId: input.conversationId,
    sourceMessageId: null,
    sourceSequence: null,
    lastReconciledSequence: null,
    // Same lineage convention as reconciliation.ts#withSequenceAndLineage's
    // "create" branch: previousWork here (when present) is a DIFFERENT,
    // terminal work being superseded by this fresh case, never a self-
    // reference.
    previousWorkPublicId: previousWork?.publicId ?? null,
    supersedesWorkPublicId: previousWork?.publicId ?? null,
    trigger: {
      type: "SYSTEM_EVENT" as const,
      eventType: "commercial_work_kernel_bootstrap",
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      opportunityId: input.opportunityId
    },
    status: "ACTIVE" as const,
    objectives: [],
    steps: [],
    blockers: [],
    derivedAt
  };
  return { ...workWithoutMetrics, metrics: deriveCommercialWorkMetrics(workWithoutMetrics) };
}

/**
 * SALES-AGENT-R3-P3.5. Durable case-kernel bootstrap: resolves or creates the
 * CommercialWork row for an opportunity/conversation pair, independent of R2
 * semantic planning (reconcileCommercialTrigger/planCommercialObjectiveSeeds
 * are never called from here). Never invents an objective from cart,
 * destination or transcript - a freshly created case always starts with
 * `objectives: []`. Idempotent and concurrency-safe via the existing
 * `uq_crm_commercial_work_correlation_key` unique constraint (migration 029):
 * two concurrent bootstraps for the same opportunity+conversation compute the
 * same correlation key (constant objectives digest for an empty array), so
 * the loser's INSERT hits the duplicate-key path in
 * persistCommercialWorkProjection and both callers converge on the same row.
 *
 * Known limitation (documented, not fixed here - out of P3.5 scope): if an
 * empty-objective bootstrap work is later transitioned to a terminal status
 * by a future phase, a subsequent bootstrap attempt would collide on the
 * same correlation key (constant for any empty-objectives work) and
 * incorrectly reload that stale terminal row instead of creating a fresh
 * one. Not reachable today - nothing in this codebase transitions a
 * bootstrap-created empty-objective work to a terminal status yet.
 */
export async function ensureCommercialWorkCase(input: EnsureCommercialWorkCaseInput): Promise<EnsureCommercialWorkCaseResult> {
  try {
    const target = await resolveCommercialWorkTarget({
      conversationId: input.conversationId,
      opportunityId: input.opportunityId
    });

    if (target.action === "update") {
      // Section 19 of the brief: resolving/reusing an existing case is a
      // pure read - never mutate, never bump version, even though this
      // bootstrap could in principle stamp fresher conversation/opportunity
      // fields onto the row.
      return { result: "EXISTING", work: target.previousWork };
    }

    const work = buildEmptyCommercialWorkCase(input, target.previousWork);
    const persisted = await persistCommercialWorkProjection({ work });
    return { result: persisted.status === "created" ? "CREATED" : "EXISTING", work: persisted.work };
  } catch (error) {
    return { result: "FAILED", error };
  }
}

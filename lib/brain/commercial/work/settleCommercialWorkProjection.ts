import { executeGovernedCapability } from "@/lib/brain/commercial/capability-gateway";
import { buildCommercialWorkProjection } from "./buildCommercialWorkProjection";
import { reconcileCommercialObjectives } from "./reconciliation";
import { executeCommercialWork, defaultLoadFacts, defaultLoadConversationControl } from "./commercialWorkExecutor";
import { updateCommercialWorkAggregate } from "./repository";
import type { PersistedCommercialWork, CommercialWorkDatabaseAdapter } from "./persistenceTypes";

export type SettleCommercialWorkProjectionInput = {
  work: PersistedCommercialWork;
  conversationId: number;
  opportunityId: number;
  correlationId: string;
  now?: Date;
  adapter?: CommercialWorkDatabaseAdapter | null;
  executeCapability?: typeof executeGovernedCapability;
  scheduleRetries?: boolean;
  maxRounds?: number;
};

/**
 * SALES-AGENT-R2-A08.5. Promoted unchanged (in behavior) from
 * work/benchmark/runR2Scenario.ts's local settleProjection - its own comment
 * already documented this as "exactly the reconciliation a real production
 * caller integrating this architecture would need to perform after a
 * same-turn cascade": commercialWorkExecutor.ts's activateUnblockedSteps only
 * refreshes a step when its dependencies become FULLY satisfied (READY),
 * never when they go from "nothing satisfied" to "some satisfied" (e.g.
 * selection just completed, destination still missing - the step should read
 * WAITING_CUSTOMER with MISSING_DESTINATION, not a stale earlier blocker).
 * Re-runs the SAME, unmodified, pure projector (buildCommercialWorkProjection)
 * with fresh durable facts and the work's own currently-active objectives
 * re-seeded, executing any newly-READY step and repeating up to maxRounds.
 *
 * Unlike the benchmark version, this reloads REAL conversation control
 * (defaultLoadConversationControl) instead of hardcoding
 * humanOwnerActive:false/aiEnabled:true - a production caller cannot assume
 * a benchmark's always-unblocked fixture conversation.
 */
export async function settleCommercialWorkProjection(input: SettleCommercialWorkProjectionInput): Promise<PersistedCommercialWork> {
  let work = input.work;
  const now = input.now ?? new Date();
  const maxRounds = input.maxRounds ?? 3;

  for (let round = 0; round < maxRounds; round += 1) {
    const [facts, control] = await Promise.all([defaultLoadFacts(work), defaultLoadConversationControl(work)]);
    const reprojected = buildCommercialWorkProjection({
      trigger: { type: "SYSTEM_EVENT", eventType: "commercial_work_settle", correlationId: input.correlationId, conversationId: input.conversationId, opportunityId: input.opportunityId },
      conversation: { id: input.conversationId, humanOwnerActive: control.humanOwnerActive, aiEnabled: control.aiEnabled },
      opportunity: { id: input.opportunityId },
      objectiveSeeds: reconcileCommercialObjectives({ previousWork: work, newSemanticObjectives: [] }),
      commercialLineItems: facts.commercialLineItems,
      shippingDestination: facts.shippingDestination,
      selectedShippingOption: facts.selectedShippingOption,
      createdQuote: facts.createdQuote,
      now
    });

    const statusChanged =
      reprojected.status !== work.status ||
      reprojected.steps.some((step) => {
        const previous = work.steps.find((item) => item.stepId === step.stepId);
        return !previous || previous.status !== step.status;
      });
    if (!statusChanged) return work;

    try {
      work = await updateCommercialWorkAggregate({ publicId: work.publicId, expectedVersion: work.version, nextWork: reprojected }, input.adapter);
    } catch {
      return work;
    }

    if (!work.steps.some((step) => step.status === "READY")) return work;

    const executed = await executeCommercialWork({
      workPublicId: work.publicId,
      expectedVersion: work.version,
      context: { correlationId: input.correlationId, conversationId: input.conversationId, opportunityId: input.opportunityId },
      executeCapability: input.executeCapability,
      scheduleRetries: input.scheduleRetries ?? true,
      now,
      adapter: input.adapter
    });
    if (executed.work) work = executed.work;
  }
  return work;
}

import { randomUUID } from "node:crypto";
import type { AgentLoopProvider } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import type { AgentLoopInferenceRecord } from "@/lib/brain/commercial/agent-loop/agentStepTypes";
import {
  buildCommercialWorkProjection,
  persistCommercialWorkProjection,
  updateCommercialWorkAggregate,
  executeCommercialWork,
  runCommercialWorkTick,
  getCommercialWorkByPublicId,
  reconcileCommercialObjectives,
  settleCommercialWorkProjection
} from "@/lib/brain/commercial/work";
import type { CommercialObjectiveSeed, CommercialWorkProjectionInput } from "@/lib/brain/commercial/work/types";
import type { PersistedCommercialWork } from "@/lib/brain/commercial/work/persistenceTypes";
import { getActiveCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { getActiveShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import { getActiveSelectedShippingOptionForOpportunity } from "@/lib/domains/selected-shipping-option";
import { getActiveCreatedQuoteForOpportunity } from "@/lib/domains/created-quote";
import { planCommercialObjectiveSeeds } from "../semanticIntentAdapter";
import { buildR2ExecuteCapability } from "./capabilityGateway";
import { seedBenchmarkSelection, seedBenchmarkShippingDestination, setConversationControl, type R2BenchmarkEnvironment } from "./environment";
import type { R2ArchitectureScenario, R2ScenarioRunOutcome } from "./types";
import type { CommercialWorkStatus } from "@/lib/brain/commercial/work/statuses";
import type { CommercialWorkTickOptions } from "@/lib/brain/commercial/work/worker/commercialWorkWorker";

/**
 * SALES-AGENT-R2-A11. This offline scenario harness drives runCommercialWorkTick
 * directly to simulate a real worker process recovering RETRY_SCHEDULED/crashed
 * work (R2-05/R2-06) - it is testing A05/A06 retry/crash-recovery mechanics, not
 * A11's own new gates. Explicitly opens all three worker-level A11 gates so this
 * pre-A11 harness keeps exercising exactly what it always exercised, matching the
 * same pattern applied to the direct test files that call runCommercialWorkTick.
 */
const BENCHMARK_WORKER_GATES_OPEN: Pick<CommercialWorkTickOptions, "workerEnabled" | "autonomousResponsesEnabled" | "whatsAppAccessGate" | "isWaIdEligibleForCommercialWork"> = {
  workerEnabled: true,
  autonomousResponsesEnabled: true,
  whatsAppAccessGate: { testModeEnabled: false, testWaIds: [] },
  isWaIdEligibleForCommercialWork: () => true
};

const TERMINAL_WORK_STATUSES = new Set<CommercialWorkStatus>(["COMPLETED", "CANCELLED", "SUPERSEDED", "HANDOFF", "FAILED"]);

/**
 * SALES-AGENT-R2-A07.5. Orchestrates one full scenario run against the real
 * R2 pieces end to end - never a second, ad-hoc executor. Per turn: semantic
 * adapter (LLM) -> carry-forward of the prior turn's still-active objectives
 * (see carryForwardActiveObjectives below - a real gap this benchmark had to
 * work around, documented in the deliverable doc's audit) -> projection ->
 * persist/continue -> execution (direct for a normal turn, via the A06
 * worker tick when the scenario injects a fault, since only the worker's own
 * claim path ever puts a step through a real RUNNING lease).
 */

type DurableFacts = {
  commercialLineItems: Awaited<ReturnType<typeof getActiveCommercialLineItemsForOpportunity>>;
  shippingDestination: Awaited<ReturnType<typeof getActiveShippingDestinationForOpportunity>>;
  selectedShippingOption: Awaited<ReturnType<typeof getActiveSelectedShippingOptionForOpportunity>>;
  createdQuote: Awaited<ReturnType<typeof getActiveCreatedQuoteForOpportunity>>;
};

async function loadDurableFacts(opportunityId: number): Promise<DurableFacts> {
  const [commercialLineItems, shippingDestination, selectedShippingOption, createdQuote] = await Promise.all([
    getActiveCommercialLineItemsForOpportunity(opportunityId),
    getActiveShippingDestinationForOpportunity(opportunityId),
    getActiveSelectedShippingOptionForOpportunity(opportunityId),
    getActiveCreatedQuoteForOpportunity(opportunityId)
  ]);
  return { commercialLineItems, shippingDestination, selectedShippingOption, createdQuote };
}

function buildCommercialContextSummary(facts: DurableFacts): Record<string, unknown> {
  return {
    ...(facts.commercialLineItems ? { commercialLineItems: { items: facts.commercialLineItems.items } } : {}),
    ...(facts.shippingDestination ? { shippingDestination: { communeId: facts.shippingDestination.communeId, canonicalName: facts.shippingDestination.canonicalName } } : {})
  };
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export type RunR2ScenarioInput = {
  scenario: R2ArchitectureScenario;
  env: R2BenchmarkEnvironment;
  provider: AgentLoopProvider;
  runIndex: number;
  startedAt?: Date;
};

export async function runR2Scenario(input: RunR2ScenarioInput): Promise<R2ScenarioRunOutcome> {
  const { scenario, env } = input;
  const startedAt = input.startedAt ?? new Date();
  const llmCalls: AgentLoopInferenceRecord[] = [];
  const { executeCapability, callLog } = buildR2ExecuteCapability({ faultPlan: scenario.faultPlan });

  if (scenario.preSeededDurableState?.selectionItems) {
    await seedBenchmarkSelection(env.opportunityId, scenario.preSeededDurableState.selectionItems);
  }
  if (scenario.preSeededDurableState?.destinationText) {
    await seedBenchmarkShippingDestination(env.opportunityId, scenario.preSeededDurableState.destinationText);
  }

  let work: PersistedCommercialWork | null = null;
  let turnNow = startedAt;
  const turnStartMs = Date.now();

  for (const [turnIndex, turn] of scenario.customerTurns.entries()) {
    turnNow = addMinutes(turnNow, turnIndex === 0 ? 0 : 1);
    const facts = await loadDurableFacts(env.opportunityId);
    const commercialContextSummary = buildCommercialContextSummary(facts);
    const correlationId = `r2-${scenario.scenarioId}-run${input.runIndex}-turn${turnIndex}-${randomUUID()}`;

    let turnSeeds: CommercialObjectiveSeed[];
    if (turn.directObjectiveSeeds) {
      turnSeeds = turn.directObjectiveSeeds;
    } else {
      const planned = await planCommercialObjectiveSeeds({
        opportunityId: env.opportunityId,
        correlationId,
        customerMessage: turn.customerMessage,
        commercialContextSummary,
        recentCatalogContext: turn.recentCatalogContext ?? null,
        provider: input.provider,
        deadline: Date.now() + 20_000,
        currentTime: turnNow.toISOString()
      });
      llmCalls.push(...planned.llmCalls);

      if (planned.kind !== "planned") {
        return {
          scenarioId: scenario.scenarioId,
          runIndex: input.runIndex,
          blocked: null,
          finalWork: work,
          capabilityCalls: callLog,
          llmCallCount: llmCalls.length,
          turnLatencyMs: Date.now() - turnStartMs,
          commercialCompletionLatencyMs: null,
          followUpScheduled: false,
          followUpSent: false,
          followUpCancelled: false,
          handoffOccurred: false,
          retryOccurred: false,
          restartRecoveryOccurred: false,
          runFailureClassification: planned.failureClassification
        };
      }
      turnSeeds = planned.seeds;
    }

    const seeds = reconcileCommercialObjectives({ previousWork: work, newSemanticObjectives: turnSeeds });
    const projectionInput: CommercialWorkProjectionInput = {
      trigger: { type: "CUSTOMER_MESSAGE", conversationId: env.conversationId, opportunityId: env.opportunityId, sourceMessageId: turnIndex + 1 },
      conversation: { id: env.conversationId, humanOwnerActive: false, aiEnabled: true },
      opportunity: { id: env.opportunityId },
      objectiveSeeds: seeds,
      commercialLineItems: facts.commercialLineItems,
      shippingDestination: facts.shippingDestination,
      selectedShippingOption: facts.selectedShippingOption,
      createdQuote: facts.createdQuote,
      now: turnNow
    };
    const projected = buildCommercialWorkProjection(projectionInput);

    // WORK_TRANSITIONS (transitions.ts) treats COMPLETED/CANCELLED/SUPERSEDED/
    // HANDOFF/FAILED as terminal - COMPLETED can only ever move to SUPERSEDED,
    // never back to ACTIVE. A correction turn after the prior work already
    // completed (R2-08) is genuinely NEW work, not a reopening of the old
    // one - carryForwardActiveObjectives still gives the new objective a
    // correct supersedesObjectiveIds lineage, it just lands in a new
    // CommercialWork row rather than an update of the terminal one. This is
    // a real, sensible constraint of the state machine, not a bug worked
    // around here.
    const priorIsTerminal = work ? TERMINAL_WORK_STATUSES.has(work.status) : false;
    if (!work || priorIsTerminal) {
      const persistedResult = await persistCommercialWorkProjection({ work: projected });
      work = persistedResult.work;
    } else {
      work = await updateCommercialWorkAggregate({ publicId: work.publicId, expectedVersion: work.version, nextWork: projected });
    }

    if (turnIndex === scenario.customerTurns.length - 1 && scenario.conversationControlBeforeExecution) {
      await setConversationControl(env.conversationId, scenario.conversationControlBeforeExecution);
    }

    const isLastTurn = turnIndex === scenario.customerTurns.length - 1;
    const shouldDriveViaWorker = isLastTurn && Boolean(scenario.faultPlan);
    if (shouldDriveViaWorker) {
      // A real worker process crashing mid-tick (R2-06's injected fault) is
      // simulated by the fault wrapper throwing out of executeCapability -
      // runCommercialWorkTick has no internal catch around that call (by
      // design, matching the real worker), so the "crash" is a real thrown
      // exception here too. Caught, never rethrown: the scenario continues
      // to its recovery pass exactly like a real restarted worker process.
      await runCommercialWorkTick({ now: turnNow, workPublicIds: [work.publicId], executeCapability, context: { correlationId }, ...BENCHMARK_WORKER_GATES_OPEN }).catch(() => null);
      const reloaded = await getCommercialWorkByPublicId(work.publicId);
      if (reloaded) work = reloaded;
    } else {
      const executed = await executeCommercialWork({
        workPublicId: work.publicId,
        expectedVersion: work.version,
        context: { correlationId, conversationId: env.conversationId, opportunityId: env.opportunityId },
        executeCapability,
        scheduleRetries: true,
        now: turnNow
      });
      if (executed.work) work = executed.work;
      work = await settleCommercialWorkProjection({
        work,
        conversationId: env.conversationId,
        opportunityId: env.opportunityId,
        correlationId,
        now: turnNow,
        executeCapability
      });
    }
  }

  const turnLatencyMs = Date.now() - turnStartMs;
  let commercialCompletionLatencyMs: number | null = turnLatencyMs;
  let retryOccurred = false;
  let restartRecoveryOccurred = false;

  if (work && scenario.faultPlan) {
    retryOccurred = Boolean(scenario.faultPlan.temporarilyBlockOnce?.length);
    restartRecoveryOccurred = Boolean(scenario.faultPlan.crashAfterSideEffect?.length);

    const stillPendingRecovery = work.steps.some((step) => step.status === "RETRY_SCHEDULED" || step.status === "RUNNING");
    if (stillPendingRecovery) {
      const recoveryNow = addMinutes(turnNow, 10);
      const recoveryCorrelationId = `r2-${scenario.scenarioId}-run${input.runIndex}-recovery-${randomUUID()}`;
      await runCommercialWorkTick({ now: recoveryNow, workPublicIds: [work.publicId], executeCapability, context: { correlationId: recoveryCorrelationId }, ...BENCHMARK_WORKER_GATES_OPEN }).catch(() => null);
      const reloaded = await getCommercialWorkByPublicId(work.publicId);
      if (reloaded) work = reloaded;
      commercialCompletionLatencyMs = Date.now() - turnStartMs;
    }
  }

  return {
    scenarioId: scenario.scenarioId,
    runIndex: input.runIndex,
    blocked: null,
    finalWork: work,
    capabilityCalls: callLog,
    llmCallCount: llmCalls.length,
    turnLatencyMs,
    commercialCompletionLatencyMs,
    followUpScheduled: false,
    followUpSent: false,
    followUpCancelled: false,
    handoffOccurred: work?.status === "HANDOFF",
    retryOccurred,
    restartRecoveryOccurred,
    runFailureClassification: null
  };
}

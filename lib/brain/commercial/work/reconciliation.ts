import { buildCommercialWorkProjection } from "./buildCommercialWorkProjection";
import { commercialObjectiveSupersessionFamily } from "./deriveCommercialObjectives";
import { findActiveCommercialWorks, persistCommercialWorkProjection, updateCommercialWorkAggregate } from "./repository";
import type { CommercialWorkStatus } from "./statuses";
import type { PersistedCommercialWork } from "./persistenceTypes";
import type { CommercialObjective, CommercialObjectiveSeed, CommercialWork, CommercialWorkProjectionInput } from "./types";
import { getTriggerCommercialSequence } from "./sequencing";

const TERMINAL_WORK_STATUSES = new Set<CommercialWorkStatus>(["COMPLETED", "CANCELLED", "SUPERSEDED", "HANDOFF", "FAILED"]);

type ObjectiveSeed = Exclude<CommercialObjectiveSeed, { kind: "cancel" }>;
type CancellationSeed = Extract<CommercialObjectiveSeed, { kind: "cancel" }>;
type SupersessionFamily = ReturnType<typeof commercialObjectiveSupersessionFamily>;

export type CommercialWorkTarget =
  | { action: "create"; previousWork: PersistedCommercialWork | null; reason: "no_work" | "terminal_work" }
  | { action: "update"; previousWork: PersistedCommercialWork; reason: "active_compatible_work" };

export type ReconcileCommercialObjectivesInput = {
  previousWork?: PersistedCommercialWork | null;
  newSemanticObjectives: readonly CommercialObjectiveSeed[];
};

export type ReconcileCommercialTriggerInput = Omit<CommercialWorkProjectionInput, "objectiveSeeds"> & {
  semanticObjectives: readonly CommercialObjectiveSeed[];
  previousWork?: PersistedCommercialWork | null;
};

export type ReconcileCommercialTriggerResult =
  | { status: "created" | "updated"; target: CommercialWorkTarget; work: PersistedCommercialWork }
  | { status: "stale_ignored"; target: CommercialWorkTarget; work: PersistedCommercialWork; reason: "superseded_by_newer_sequence" };

function objectiveSeedFromPersisted(objective: CommercialObjective): ObjectiveSeed {
  return {
    seedId: objective.objectiveId,
    type: objective.type,
    origin: objective.origin,
    inputs: objective.inputs,
    carriedStatus: objective.status
  };
}

export function reconcileCommercialObjectives(input: ReconcileCommercialObjectivesInput): CommercialObjectiveSeed[] {
  const previous = input.previousWork;
  if (!previous) return [...input.newSemanticObjectives];
  const carried = previous.objectives
    .filter((objective) => objective.status !== "CANCELLED" && objective.status !== "SUPERSEDED")
    .map(objectiveSeedFromPersisted);
  return [...carried, ...input.newSemanticObjectives];
}

export async function resolveCommercialWorkTarget(input: {
  conversationId: number;
  opportunityId?: number | null;
  previousWork?: PersistedCommercialWork | null;
}): Promise<CommercialWorkTarget> {
  const previousWork =
    input.previousWork ??
    (
      await findActiveCommercialWorks({
        conversationId: input.conversationId,
        opportunityId: input.opportunityId,
        limit: 1
      })
    )[0] ??
    null;

  if (!previousWork) return { action: "create", previousWork: null, reason: "no_work" };
  if (TERMINAL_WORK_STATUSES.has(previousWork.status)) return { action: "create", previousWork, reason: "terminal_work" };
  return { action: "update", previousWork, reason: "active_compatible_work" };
}

function cancelTargetFamily(seed: CancellationSeed): SupersessionFamily | "all" {
  switch (seed.targetType) {
    case undefined:
      return "all";
    case "selection":
      return "selection";
    case "destination":
      return "destination";
    case "shipping":
      return "shipping";
    case "quote":
      return "quote";
    default:
      return commercialObjectiveSupersessionFamily(seed.targetType);
  }
}

function familiesAffectedBy(seeds: readonly CommercialObjectiveSeed[]): Set<SupersessionFamily | "all"> {
  const families = new Set<SupersessionFamily | "all">();
  for (const seed of seeds) {
    if (seed.kind === "cancel") {
      families.add(cancelTargetFamily(seed));
      continue;
    }
    const family = commercialObjectiveSupersessionFamily(seed.type);
    if (family !== "other") families.add(family);
  }
  return families;
}

function normalizedInputs(seed: ObjectiveSeed | CommercialObjective): string {
  return JSON.stringify(seed.inputs ?? {});
}

function isStaleSupersededInput(input: {
  previousWork: PersistedCommercialWork;
  incomingSequence: number | null;
  newSemanticObjectives: readonly CommercialObjectiveSeed[];
}): boolean {
  const latestSequence = input.previousWork.lastReconciledSequence ?? input.previousWork.sourceSequence;
  if (!input.incomingSequence || !latestSequence || input.incomingSequence >= latestSequence) return false;

  const affected = familiesAffectedBy(input.newSemanticObjectives);
  if (affected.size === 0) return false;
  if (affected.has("all")) return true;

  for (const seed of input.newSemanticObjectives) {
    if (seed.kind === "cancel") continue;
    const seedFamily = commercialObjectiveSupersessionFamily(seed.type);
    if (!affected.has(seedFamily)) continue;
    const existing = input.previousWork.objectives.find(
      (objective) =>
        objective.status !== "CANCELLED" &&
        objective.status !== "SUPERSEDED" &&
        commercialObjectiveSupersessionFamily(objective.type) === seedFamily
    );
    if (existing && (existing.type !== seed.type || normalizedInputs(existing) !== normalizedInputs(seed))) return true;
  }

  return false;
}

function withSequenceAndLineage(work: CommercialWork, input: { target: CommercialWorkTarget; incomingSequence: number | null }): CommercialWork {
  const previous = input.target.previousWork;
  const previousLatest = previous ? (previous.lastReconciledSequence ?? previous.sourceSequence ?? null) : null;
  const lastReconciledSequence =
    input.incomingSequence && previousLatest ? Math.max(input.incomingSequence, previousLatest) : input.incomingSequence ?? previousLatest;
  const supersedesWorkPublicId = input.target.action === "create" && previous ? previous.publicId : null;
  return {
    ...work,
    sourceSequence: input.incomingSequence,
    lastReconciledSequence,
    previousWorkPublicId: previous?.publicId ?? null,
    supersedesWorkPublicId
  };
}

export async function reconcileCommercialTrigger(input: ReconcileCommercialTriggerInput): Promise<ReconcileCommercialTriggerResult> {
  const target = await resolveCommercialWorkTarget({
    conversationId: input.conversation.id,
    opportunityId: input.opportunity?.id ?? null,
    previousWork: input.previousWork
  });

  const incomingSequence = getTriggerCommercialSequence(input.trigger);
  if (
    target.previousWork &&
    isStaleSupersededInput({
      previousWork: target.previousWork,
      incomingSequence,
      newSemanticObjectives: input.semanticObjectives
    })
  ) {
    return { status: "stale_ignored", target, work: target.previousWork, reason: "superseded_by_newer_sequence" };
  }

  const objectiveSeeds = reconcileCommercialObjectives({
    previousWork: target.previousWork,
    newSemanticObjectives: input.semanticObjectives
  });
  const projected = withSequenceAndLineage(
    buildCommercialWorkProjection({
      ...input,
      objectiveSeeds
    }),
    { target, incomingSequence }
  );

  if (target.action === "update") {
    const work = await updateCommercialWorkAggregate({
      publicId: target.previousWork.publicId,
      expectedVersion: target.previousWork.version,
      nextWork: projected
    });
    return { status: "updated", target, work };
  }

  const persisted = await persistCommercialWorkProjection({ work: projected });
  return { status: "created", target, work: persisted.work };
}

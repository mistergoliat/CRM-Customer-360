import type { PendingCommercialIntentRecord } from "../multi-intent/types";
import type {
  CommercialObjectiveSeed,
  CommercialObjective,
  CommercialObjectiveOrigin
} from "./types";
import type { CommercialObjectiveType } from "./objectiveTypes";
import { canTransitionObjectiveStatus } from "./transitions";

function normalizeTargetType(targetType: CommercialObjectiveSeed & { kind: "cancel" }): CommercialObjectiveType | null {
  switch (targetType.targetType) {
    case "selection":
      return "SELECT_PRODUCTS";
    case "destination":
      return "SET_DESTINATION";
    case "shipping":
      return "GET_SHIPPING_QUOTE";
    case "quote":
      return "CREATE_QUOTE";
    case undefined:
      return null;
    default:
      return targetType.targetType;
  }
}

export function commercialObjectiveSupersessionFamily(type: CommercialObjectiveType): "selection" | "destination" | "shipping" | "quote" | "other" {
  if (type === "SELECT_PRODUCTS" || type === "CHANGE_QUANTITY") return "selection";
  if (type === "SET_DESTINATION") return "destination";
  if (type === "GET_SHIPPING_QUOTE" || type === "SELECT_SHIPPING_OPTION") return "shipping";
  if (type === "CREATE_QUOTE" || type === "WAIT_FOR_QUOTE_APPROVAL") return "quote";
  return "other";
}

function objectiveIdFor(seedIdPrefix: string, index: number, type: CommercialObjectiveType) {
  return `${seedIdPrefix}:objective:${index}:${type}`;
}

function baseObjective(input: {
  objectiveId: string;
  type: CommercialObjectiveType;
  origin: CommercialObjectiveOrigin;
  seed: Extract<CommercialObjectiveSeed, { kind?: "objective" }>;
}): CommercialObjective {
  return {
    objectiveId: input.objectiveId,
    type: input.type,
    status: "PENDING",
    origin: input.origin,
    inputs: input.seed.inputs ?? {},
    resolvedInputs: {},
    missingRequirements: [],
    supersedesObjectiveIds: [],
    evidence: [],
    blockers: []
  };
}

export function objectiveSeedsFromPendingIntents(records: readonly PendingCommercialIntentRecord[] | undefined): CommercialObjectiveSeed[] {
  return (records ?? []).flatMap((record): CommercialObjectiveSeed[] => {
    if (record.intent.type === "select_products") {
      return [
        {
          type: "SELECT_PRODUCTS",
          origin: "customer_requested",
          inputs: {
            productReference: record.intent.productReference,
            quantity: record.intent.quantity
          }
        }
      ];
    }
    if (record.intent.type === "get_shipping_quote") {
      return [
        {
          type: "GET_SHIPPING_QUOTE",
          origin: "customer_requested",
          inputs: { destinationText: record.intent.destination }
        }
      ];
    }
    // SALES-AGENT-R2-A08.6, Part 9. create_quote can pend on PRODUCT_SELECTION
    // (e.g. "cotizame esto" before any selection exists) - re-emitted
    // unchanged once a later turn resolves that. cancel never reaches this
    // function: it always resolves "ready" (requirementResolver.ts), so it is
    // never saved as a pending intent in the first place.
    if (record.intent.type === "create_quote") {
      return [{ type: "CREATE_QUOTE", origin: "customer_requested" }];
    }
    return [];
  });
}

export function deriveCommercialObjectives(input: {
  seeds: readonly CommercialObjectiveSeed[];
  pendingCommercialIntents?: readonly PendingCommercialIntentRecord[];
  seedIdPrefix: string;
}): CommercialObjective[] {
  const seeds = [...objectiveSeedsFromPendingIntents(input.pendingCommercialIntents), ...input.seeds];
  const objectives: CommercialObjective[] = [];

  // SALES-AGENT-R2-A08.6, Part 3 (post-audit fix). Every freshly-derived
  // CommercialObjective starts at "PENDING" (baseObjective) regardless of
  // what it is carrying forward, so objective.status alone can never tell
  // the cancel handling below what the objective's real, already-persisted
  // status is - only reconciliation.ts's objectiveSeedFromPersisted knows
  // that (carriedStatus), for a carried (non-fresh) objective specifically.
  const carriedStatusById = new Map(
    seeds
      .filter((seed): seed is Extract<CommercialObjectiveSeed, { kind?: "objective" }> => seed.kind !== "cancel" && Boolean(seed.seedId) && Boolean(seed.carriedStatus))
      .map((seed) => [seed.seedId as string, seed.carriedStatus!])
  );

  for (const [index, seed] of seeds.entries()) {
    if (seed.kind === "cancel") {
      const target = normalizeTargetType(seed);
      for (const objective of objectives) {
        if (!target || objective.type === target || commercialObjectiveSupersessionFamily(objective.type) === commercialObjectiveSupersessionFamily(target)) {
          // A COMPLETED objective's own state machine (transitions.ts) only
          // allows COMPLETED -> SUPERSEDED, never -> CANCELLED - the
          // calculation already happened, it cannot be un-calculated, only
          // retired. objective.status itself is still "PENDING" at this
          // point unless something earlier in this same pass already moved
          // it (a real prior state to respect) - carriedStatusById is the
          // only way to see the persisted status for anything untouched so
          // far. The CANCELLED blocker is still pushed unconditionally so
          // buildCommercialWorkFinalizerMessage.ts's cancelledFamilyClauses
          // (keyed off this blocker, not the literal status) still credits
          // the customer's cancellation request even when the objective
          // lands SUPERSEDED instead of CANCELLED.
          const effectiveStatus = objective.status !== "PENDING" ? objective.status : (carriedStatusById.get(objective.objectiveId) ?? objective.status);
          objective.status = canTransitionObjectiveStatus(effectiveStatus, "CANCELLED") ? "CANCELLED" : "SUPERSEDED";
          objective.blockers.push({ code: "CANCELLED", source: "objective", objectiveId: objective.objectiveId });
        }
      }
      continue;
    }

    const type = seed.type;
    const objective = baseObjective({
      objectiveId: seed.seedId ?? objectiveIdFor(input.seedIdPrefix, index, type),
      type,
      origin: seed.origin ?? "projection_seed",
      seed
    });

    const family = commercialObjectiveSupersessionFamily(type);
    if (family !== "other") {
      for (const previous of objectives) {
        if (previous.status !== "CANCELLED" && previous.status !== "SUPERSEDED" && commercialObjectiveSupersessionFamily(previous.type) === family) {
          previous.status = "SUPERSEDED";
          previous.blockers.push({ code: "SUPERSEDED", source: "objective", objectiveId: previous.objectiveId });
          objective.supersedesObjectiveIds.push(previous.objectiveId);
        }
      }
    }

    objectives.push(objective);
  }

  return objectives;
}

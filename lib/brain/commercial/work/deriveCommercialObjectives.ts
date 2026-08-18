import type { PendingCommercialIntentRecord } from "../multi-intent/types";
import type {
  CommercialObjectiveSeed,
  CommercialObjective,
  CommercialObjectiveOrigin
} from "./types";
import type { CommercialObjectiveType } from "./objectiveTypes";

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

  for (const [index, seed] of seeds.entries()) {
    if (seed.kind === "cancel") {
      const target = normalizeTargetType(seed);
      for (const objective of objectives) {
        if (!target || objective.type === target || commercialObjectiveSupersessionFamily(objective.type) === commercialObjectiveSupersessionFamily(target)) {
          objective.status = "CANCELLED";
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

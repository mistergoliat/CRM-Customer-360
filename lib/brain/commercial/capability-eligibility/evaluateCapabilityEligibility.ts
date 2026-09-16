import type { CommercialDomainReadModel } from "../domain-read-model";
import { selectActiveObjective } from "../domain-read-model";
import type { PersistedCommercialWork } from "../work/persistenceTypes";
import { isIdentityLevelAtLeast } from "../identity/commercial-identity-requirement/evaluate";
import { CAPABILITY_ELIGIBILITY_METADATA_VERSION, resolveCapabilityEligibilityDefinitions } from "./definitions";
import type {
  CapabilityEligibilityEntry,
  CapabilityEligibilityReasonCode,
  CapabilityEligibilitySnapshot,
  ResolvedCapabilityEligibilityDefinition
} from "./types";

export type EvaluateCapabilityEligibilityInput = {
  readonly domainReadModel: CommercialDomainReadModel;
  /** Same-turn work wins over a pre-reconciliation DRM objective without rebuilding the DRM. */
  readonly work?: Pick<PersistedCommercialWork, "publicId" | "version" | "objectives"> | null;
  readonly evaluatedAt: string;
};

function currentSelectionReasonCodes(readModel: CommercialDomainReadModel): CapabilityEligibilityReasonCode[] {
  if (readModel.cart.factId === null || readModel.cart.items.length === 0) return ["MISSING_SELECTION"];
  return readModel.cart.freshness.state === "CURRENT" ? [] : ["SELECTION_NOT_CURRENT"];
}

function currentDestinationReasonCodes(readModel: CommercialDomainReadModel): CapabilityEligibilityReasonCode[] {
  if (readModel.destination === null) return ["MISSING_DESTINATION"];
  return readModel.destination.freshness.state === "CURRENT" ? [] : ["DESTINATION_NOT_CURRENT"];
}

function currentQuoteReasonCodes(readModel: CommercialDomainReadModel): CapabilityEligibilityReasonCode[] {
  if (readModel.quote === null) return ["MISSING_QUOTE"];
  return readModel.quote.freshness.state === "CURRENT" ? [] : ["QUOTE_NOT_CURRENT"];
}

function identityReasonCodes(definition: ResolvedCapabilityEligibilityDefinition, readModel: CommercialDomainReadModel): CapabilityEligibilityReasonCode[] {
  const requirement = definition.identityRequirement;
  if (requirement.kind === "NONE") return [];
  if (requirement.kind === "MINIMUM_LEVEL") {
    const currentLevel = readModel.customer.identityLevel;
    return currentLevel !== null && isIdentityLevelAtLeast(currentLevel, requirement.level) ? [] : ["IDENTITY_LEVEL_INSUFFICIENT"];
  }
  // definitions.ts rejects ENTITY_VERIFICATION because the complete
  // entity-scoped projection is intentionally outside P6.2's scope.
  return ["IDENTITY_LEVEL_INSUFFICIENT"];
}

function evaluateDefinition(
  definition: ResolvedCapabilityEligibilityDefinition,
  readModel: CommercialDomainReadModel,
  objectiveType: string | null
): CapabilityEligibilityEntry {
  const reasonCodes: CapabilityEligibilityReasonCode[] = [];

  if (definition.supportedObjectives !== null) {
    if (objectiveType === null) reasonCodes.push("OBJECTIVE_REQUIRED");
    else if (!(definition.supportedObjectives as readonly string[]).includes(objectiveType)) reasonCodes.push("OBJECTIVE_INCOMPATIBLE");
  }

  if (reasonCodes.length === 0) {
    reasonCodes.push(...identityReasonCodes(definition, readModel));
    for (const prerequisite of definition.prerequisites) {
      if (prerequisite === "CURRENT_SELECTION") reasonCodes.push(...currentSelectionReasonCodes(readModel));
      if (prerequisite === "CURRENT_DESTINATION") reasonCodes.push(...currentDestinationReasonCodes(readModel));
      if (prerequisite === "CURRENT_QUOTE") reasonCodes.push(...currentQuoteReasonCodes(readModel));
    }
  }

  return {
    capability: definition.capability,
    status: reasonCodes.length === 0 ? "ELIGIBLE" : "BLOCKED",
    reasonCodes,
    executionClass: definition.executionClass
  };
}

/**
 * Pure structural evaluator: no Gateway execution, capability execution,
 * port access, database access, HTTP, LLM or CommercialWork mutation.
 * A result is never an authorization or a runtime-availability guarantee.
 */
export function evaluateCapabilityEligibility(input: EvaluateCapabilityEligibilityInput): CapabilityEligibilitySnapshot {
  const objective = input.work === undefined ? input.domainReadModel.objective : selectActiveObjective(input.work as PersistedCommercialWork | null);
  const entries = resolveCapabilityEligibilityDefinitions().map((definition) => evaluateDefinition(definition, input.domainReadModel, objective?.type ?? null));
  return {
    schemaVersion: "1",
    workId: input.work === undefined ? input.domainReadModel.case.workId : input.work?.publicId ?? null,
    workVersion: input.work === undefined ? input.domainReadModel.case.workVersion : input.work?.version ?? null,
    objectiveId: objective?.objectiveId ?? null,
    objectiveType: objective?.type ?? null,
    evaluatedAt: input.evaluatedAt,
    eligible: entries.filter((entry) => entry.status === "ELIGIBLE"),
    blocked: entries.filter((entry) => entry.status === "BLOCKED"),
    metadataVersion: CAPABILITY_ELIGIBILITY_METADATA_VERSION
  };
}

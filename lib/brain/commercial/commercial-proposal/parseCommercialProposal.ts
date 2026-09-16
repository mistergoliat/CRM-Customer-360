import {
  COMMERCIAL_OBJECTIVE_KINDS,
  COMMERCIAL_OBJECTIVE_OPERATIONS,
  COMMERCIAL_PROPOSAL_CONFIDENCES,
  COMMERCIAL_PROPOSAL_SCHEMA_VERSION,
  COMMERCIAL_REQUESTED_OUTCOMES,
  COMMERCIAL_REQUIREMENTS,
  COMMERCIAL_REQUIREMENT_SIGNALS,
  type CommercialObjectiveKind,
  type CommercialObjectiveOperation,
  type CommercialProposalConfidence,
  type CommercialProposalRequirementSignal,
  type CommercialProposalV1,
  type CommercialRequestedOutcome,
  type CommercialRequirement,
  type CommercialRequirementSignal
} from "./types";

const MAX_REQUIREMENT_SIGNALS = 12;
const MAX_EVIDENCE_CODES = 20;
const MAX_CODE_LENGTH = 100;
const MAX_AMBIGUITY_REASON_LENGTH = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends readonly string[]>(
  value: unknown,
  values: T
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function parseObjective(
  raw: unknown
): CommercialProposalV1["objective"] | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;

  if (!isOneOf(raw.kind, COMMERCIAL_OBJECTIVE_KINDS)) return undefined;
  if (!isOneOf(raw.operation, COMMERCIAL_OBJECTIVE_OPERATIONS)) return undefined;
  if (!isOneOf(raw.confidence, COMMERCIAL_PROPOSAL_CONFIDENCES)) return undefined;

  return {
    kind: raw.kind as CommercialObjectiveKind,
    operation: raw.operation as CommercialObjectiveOperation,
    confidence: raw.confidence as CommercialProposalConfidence
  };
}

function parseRequestedOutcome(
  raw: unknown
): CommercialRequestedOutcome | null | undefined {
  if (raw === null) return null;
  if (!isOneOf(raw, COMMERCIAL_REQUESTED_OUTCOMES)) return undefined;
  return raw as CommercialRequestedOutcome;
}

function parseRequirementSignals(
  raw: unknown
): CommercialProposalRequirementSignal[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const parsed: CommercialProposalRequirementSignal[] = [];

  for (const item of raw.slice(0, MAX_REQUIREMENT_SIGNALS)) {
    if (!isRecord(item)) return undefined;
    if (!isOneOf(item.requirement, COMMERCIAL_REQUIREMENTS)) return undefined;
    if (!isOneOf(item.signal, COMMERCIAL_REQUIREMENT_SIGNALS)) return undefined;

    parsed.push({
      requirement: item.requirement as CommercialRequirement,
      signal: item.signal as CommercialRequirementSignal
    });
  }

  return parsed;
}

function parseEvidenceCodes(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const codes: string[] = [];

  for (const value of raw.slice(0, MAX_EVIDENCE_CODES)) {
    if (typeof value !== "string") return undefined;

    const normalized = value.trim();

    if (!normalized || normalized.length > MAX_CODE_LENGTH) return undefined;

    /*
     * Deliberately accepts only bounded machine-style labels.
     * No spaces/free prose/customer text.
     */
    if (!/^[A-Z0-9_]+$/.test(normalized)) return undefined;

    codes.push(normalized);
  }

  return codes;
}

function parseAmbiguity(
  raw: unknown
): CommercialProposalV1["ambiguity"] | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.present !== "boolean") return undefined;

  let reasonCode: string | null;

  if (raw.reasonCode === null) {
    reasonCode = null;
  } else if (
    typeof raw.reasonCode === "string" &&
    raw.reasonCode.trim().length > 0 &&
    raw.reasonCode.trim().length <= MAX_AMBIGUITY_REASON_LENGTH &&
    /^[A-Z0-9_]+$/.test(raw.reasonCode.trim())
  ) {
    reasonCode = raw.reasonCode.trim();
  } else {
    return undefined;
  }

  return {
    present: raw.present,
    reasonCode
  };
}

/**
 * Shadow-safe parser.
 *
 * Invalid proposal => undefined.
 * It must never make an otherwise valid AgentStep invalid during P4.
 */
export function parseCommercialProposalV1(
  raw: unknown
): CommercialProposalV1 | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.schemaVersion !== COMMERCIAL_PROPOSAL_SCHEMA_VERSION) return undefined;

  const objective = parseObjective(raw.objective);
  if (objective === undefined) return undefined;

  const requestedOutcome = parseRequestedOutcome(raw.requestedOutcome);
  if (requestedOutcome === undefined) return undefined;

  const requirementSignals = parseRequirementSignals(raw.requirementSignals);
  if (requirementSignals === undefined) return undefined;

  const evidenceCodes = parseEvidenceCodes(raw.evidenceCodes);
  if (evidenceCodes === undefined) return undefined;

  const ambiguity = parseAmbiguity(raw.ambiguity);
  if (ambiguity === undefined) return undefined;

  return {
    schemaVersion: COMMERCIAL_PROPOSAL_SCHEMA_VERSION,
    objective,
    requestedOutcome,
    requirementSignals,
    evidenceCodes,
    ambiguity
  };
}

// SALES-AGENT-R3-V1.8.2-B (Open Turn Execution Core), hardened by
// V1.8.2-B1 (Evidence Fingerprint Hardening). Deterministic, in-memory,
// per-turn progress tracking for open-turn mode
// (BRAIN_R3_OPEN_TURN_EXECUTION_ENABLED). No schema, no LLM-judged
// equivalence, no per-tool business logic. Evidence fingerprints are
// structural only: tool name + status + a generic result-shape
// classification + cardinality + canonical relevant entity ids (when the
// response carries any, generically extracted - never raw argument text,
// never price/stock/free text/timestamps). Two differently-worded
// zero-result searches still fingerprint identically ("materially the same
// dead end" - no ids exist either way, so this falls back to the original
// resultClass+cardinality behavior); two result sets of the SAME
// cardinality but carrying DIFFERENT entities (V1.8.2-B1's own motivating
// case: search A -> [31,415,983] vs search B -> [603,604,605]) no longer
// collapse to the same fingerprint.
//
// See docs/releases/SALES-AGENT-R3-V1.8.2-A-HARNESS-ALIGNED-TURN-SEMANTICS-CONTRACT-AUDIT.md
// Deliverable 10 ("Progress"/"No-progress") for the contract this implements,
// and docs/releases/SALES-AGENT-R3-V1.8.2-B-OPEN-TURN-EXECUTION-CORE.md's
// own "Evidence Fingerprint Hardening" section for this specific change.

import type { ToolObservation } from "./agentStepTypes";

export type OpenTurnToolExecutionClass = "read" | "mutation";

export type OpenTurnProgressState = {
  acceptedStepCount: number;
  providerCallCount: number;
  readToolExecutionCount: number;
  mutationToolExecutionCount: number;
  assimilationCycleCount: number;
  /** Current streak - what the no-progress guard actually compares against a threshold. Resets on any real progress. */
  consecutiveNoProgressSteps: number;
  /** Cumulative total of no-progress increments this turn - observability only, never reset. */
  noProgressCycleCount: number;
  terminalCheckpointContinueCount: number;
  emergencyCeilingReached: boolean;
  /** Turn-scoped only - never persisted, never compared across turns. */
  seenEvidenceFingerprints: Set<string>;
};

export function createOpenTurnProgressState(): OpenTurnProgressState {
  return {
    acceptedStepCount: 0,
    providerCallCount: 0,
    readToolExecutionCount: 0,
    mutationToolExecutionCount: 0,
    assimilationCycleCount: 0,
    consecutiveNoProgressSteps: 0,
    noProgressCycleCount: 0,
    terminalCheckpointContinueCount: 0,
    emergencyCeilingReached: false,
    seenEvidenceFingerprints: new Set()
  };
}

/**
 * Real field names this exact tool pool's own capabilities already use for
 * their list-shaped results (search_products -> items, explore_catalog ->
 * products, recommend_catalog_products -> recommendations,
 * calculate_shipping -> options, search_company_knowledge/select_products
 * results-shaped payloads -> results/candidates) - a fixed, order-independent
 * scan, never a tool-name -> field-name mapping, so this stays structural
 * (what shape came back) rather than commercial (what the result means).
 */
const KNOWN_LIST_FIELDS = ["items", "products", "recommendations", "results", "options", "candidates"] as const;

/** Real field names this tool pool's own observations already use for a single entity's identity, singular or per-item. */
const KNOWN_ID_FIELDS = ["id", "productId"] as const;

/** A flat array of ids already carried at the top level (e.g. a candidateProductIds-shaped field), never nested. */
const KNOWN_FLAT_ID_LIST_FIELDS = ["candidateProductIds"] as const;

function computeCardinalityFromShape(data: unknown): number {
  if (data === null || data === undefined) return 0;
  if (Array.isArray(data)) return data.length;
  if (typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const field of KNOWN_LIST_FIELDS) {
      const value = record[field];
      if (Array.isArray(value)) return value.length;
    }
    // No known list field - a single resolved entity (e.g. get_product_details), cardinality 1, unless genuinely empty.
    return Object.keys(record).length > 0 ? 1 : 0;
  }
  return 1;
}

/** A number/non-empty string id, normalized to a trimmed string - never a boolean/object/empty value. */
function normalizeId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * V1.8.2-B1. Generic extraction only - reads a fixed, small set of already-
 * established structural field names (never a tool-name -> field-name
 * table, never business logic about what a given tool's ids "mean").
 * Deliberately excludes price/stock/name/description/timestamps: those
 * fields are never consulted here, by construction (only KNOWN_ID_FIELDS/
 * KNOWN_FLAT_ID_LIST_FIELDS are ever read). Order of discovery does not
 * matter - callers sort+dedupe the result.
 */
function extractRelevantIds(data: unknown): string[] {
  if (data === null || data === undefined || typeof data !== "object" || Array.isArray(data)) return [];
  const record = data as Record<string, unknown>;
  const ids: string[] = [];

  for (const field of KNOWN_FLAT_ID_LIST_FIELDS) {
    const value = record[field];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      const id = normalizeId(entry);
      if (id) ids.push(id);
    }
  }

  for (const field of KNOWN_ID_FIELDS) {
    const id = normalizeId(record[field]);
    if (id) ids.push(id);
  }

  for (const field of KNOWN_LIST_FIELDS) {
    const value = record[field];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const itemRecord = item as Record<string, unknown>;
      for (const idField of KNOWN_ID_FIELDS) {
        const id = normalizeId(itemRecord[idField]);
        if (id) {
          ids.push(id);
          break; // one id per item - never both "id" and "productId" for the same entry
        }
      }
    }
  }

  return ids;
}

function dedupeSortIds(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort();
}

/**
 * V1.8.2-B1. The canonical, JSON-serialized payload behind buildEvidenceFingerprint
 * - exported so tests can assert on structure directly instead of parsing a
 * string. Field order is fixed (object literals below, never reordered) so
 * JSON.stringify is itself deterministic; relevantIds is already
 * deduplicated and sorted before this returns, so two equivalent result
 * sets always produce byte-identical payloads regardless of upstream
 * ordering or incidental duplication.
 */
export type EvidenceFingerprintPayload = {
  tool: string;
  status: ToolObservation["status"];
  resultClass: string;
  cardinality: number;
  relevantIds: string[];
};

/**
 * Generic, per-tool-agnostic evidence class. Non-"completed" observations
 * fingerprint by status+reason (so a duplicate-blocked retry repeats, but a
 * DIFFERENT block reason - or a different tool - never counts as the same
 * dead end; ids are never extracted from a non-completed observation, since
 * a blocked/failed/skipped call carries no real result entities). A
 * "completed" observation fingerprints by whether it carried results AND,
 * when relevant ids are present, exactly which entities they were -
 * cardinality itself is then derived from the deduplicated id count (so a
 * response that happens to repeat one entity twice fingerprints identically
 * to one that lists it once - requirement: "duplicate IDs => same canonical
 * fingerprint"). When no ids exist at all (e.g. a tool whose payload shape
 * this module does not recognize), cardinality falls back to the original
 * shape-based count - the exact pre-hardening behavior, never weakened.
 */
export function buildEvidenceFingerprintPayload(tool: string, observation: ToolObservation): EvidenceFingerprintPayload {
  if (observation.status !== "completed") {
    return { tool, status: observation.status, resultClass: observation.errorCode ?? observation.reason ?? "unknown", cardinality: 0, relevantIds: [] };
  }

  const relevantIds = dedupeSortIds(extractRelevantIds(observation.data));
  const cardinality = relevantIds.length > 0 ? relevantIds.length : computeCardinalityFromShape(observation.data);
  return { tool, status: "completed", resultClass: cardinality > 0 ? "has_results" : "no_match", cardinality, relevantIds };
}

export function buildEvidenceFingerprint(tool: string, observation: ToolObservation): string {
  return JSON.stringify(buildEvidenceFingerprintPayload(tool, observation));
}

export function recordAcceptedStep(progress: OpenTurnProgressState): void {
  progress.acceptedStepCount += 1;
}

export function recordProviderCall(progress: OpenTurnProgressState): void {
  progress.providerCallCount += 1;
}

/** New durable input IS progress (task Section 11) - always resets the no-progress streak, never consumes emergency budget on its own. */
export function recordAssimilationProgress(progress: OpenTurnProgressState): void {
  progress.assimilationCycleCount += 1;
  progress.consecutiveNoProgressSteps = 0;
}

/**
 * A respond/handoff candidate the terminal checkpoint declined to accept is
 * a real cognitive cycle (see turnStoppingCheckpoint.ts) but, absent any new
 * tool evidence or new customer input, is also not demonstrated progress -
 * counts toward the no-progress streak the same way a repeated dead-end tool
 * call does.
 */
export function recordTerminalCheckpointContinue(progress: OpenTurnProgressState): void {
  progress.terminalCheckpointContinueCount += 1;
  progress.consecutiveNoProgressSteps += 1;
  progress.noProgressCycleCount += 1;
}

/**
 * A committed mutation is always real, durable progress regardless of
 * evidence-fingerprint repetition - mutation idempotency/evidence gates
 * already prevent a genuine duplicate mutation at the Gateway layer (see
 * capability-gateway/executeCapability.ts), so this function never needs to
 * (and must never) second-guess that.
 */
export function recordToolExecution(
  progress: OpenTurnProgressState,
  input: { tool: string; toolClass: OpenTurnToolExecutionClass; observation: ToolObservation; executed: boolean }
): void {
  if (input.executed) {
    if (input.toolClass === "read") progress.readToolExecutionCount += 1;
    else progress.mutationToolExecutionCount += 1;
  }
  if (input.executed && input.toolClass === "mutation") {
    progress.consecutiveNoProgressSteps = 0;
    return;
  }

  const fingerprint = buildEvidenceFingerprint(input.tool, input.observation);
  const isNewEvidence = !progress.seenEvidenceFingerprints.has(fingerprint);
  progress.seenEvidenceFingerprints.add(fingerprint);
  if (isNewEvidence) {
    progress.consecutiveNoProgressSteps = 0;
  } else {
    progress.consecutiveNoProgressSteps += 1;
    progress.noProgressCycleCount += 1;
  }
}

export function isNoProgressGuardTriggered(progress: OpenTurnProgressState, threshold: number): boolean {
  return progress.consecutiveNoProgressSteps >= threshold;
}

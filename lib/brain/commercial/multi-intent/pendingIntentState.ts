import { getActiveRequestFact, upsertRequestFact } from "../request-facts";
import { parseCommercialIntent } from "./parseCommercialIntentPlan";
import { COMMERCIAL_REQUIREMENT_TYPES } from "./types";
import type { CommercialIntent, CommercialIntentCancel, CommercialIntentCancelScope, CommercialRequirementType, PendingCommercialIntentRecord } from "./types";

/**
 * LLM-R1-T09A, Part 11 (Pending Intent State). Reuses the existing
 * crm_request_facts versioned fact store - the same mechanism
 * shipping-destination and commercial-line-items already use to persist
 * durable per-opportunity state (see lib/domains/shipping-destination/constants.ts) -
 * rather than a new table. It is a clean semantic fit: a pending intent is
 * exactly "a fact about this opportunity's conversation, superseded whenever
 * it changes", the same shape crm_request_facts already models. Anchored by
 * `opportunity:${opportunityId}` (buildAnchor below), the same anchor
 * convention shipping-destination/commercial-line-items already use, so all
 * three durable commercial facts live under one consistent identity scheme.
 */

export const PENDING_COMMERCIAL_INTENTS_FACT_KEY = "pending_commercial_intents";
const MAX_PENDING_INTENT_RECORDS = 6;

function buildPendingIntentAnchor(opportunityId: number): string {
  return `opportunity:${opportunityId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequirementType(value: unknown): value is CommercialRequirementType {
  return typeof value === "string" && (COMMERCIAL_REQUIREMENT_TYPES as readonly string[]).includes(value);
}

function parsePendingIntentRecord(raw: unknown): PendingCommercialIntentRecord | null {
  if (!isRecord(raw) || !Array.isArray(raw.missingRequirements) || typeof raw.savedAt !== "string") return null;
  const intent = parseCommercialIntent(raw.intent);
  const missingRequirements = raw.missingRequirements.filter(isRequirementType);
  return { intent, missingRequirements, savedAt: raw.savedAt };
}

/** Never throws: a read failure or malformed durable value degrades to "no pending intents" (fail-open on READ only - the resolver then simply asks the customer to restate, never worse than before this feature existed). */
export async function loadPendingCommercialIntents(opportunityId: number | null): Promise<PendingCommercialIntentRecord[]> {
  if (!opportunityId) return [];
  try {
    const fact = await getActiveRequestFact(buildPendingIntentAnchor(opportunityId), PENDING_COMMERCIAL_INTENTS_FACT_KEY);
    if (!fact || !Array.isArray(fact.value)) return [];
    return fact.value
      .slice(0, MAX_PENDING_INTENT_RECORDS)
      .map(parsePendingIntentRecord)
      .filter((record): record is PendingCommercialIntentRecord => record !== null);
  } catch {
    return [];
  }
}

/**
 * Part 12 (continuation). Called once per turn with the FULL current set of
 * still-pending intents (never a delta) - an empty array supersedes any
 * prior pending state (everything this turn either completed or was dropped
 * as stale), mirroring select_products' own "replaces the entire previous
 * selection" discipline.
 */
export async function savePendingCommercialIntents(input: {
  opportunityId: number;
  records: PendingCommercialIntentRecord[];
  sourceMessageId?: string | null;
}): Promise<{ ok: boolean; warning?: string }> {
  const result = await upsertRequestFact({
    requestId: buildPendingIntentAnchor(input.opportunityId),
    factKey: PENDING_COMMERCIAL_INTENTS_FACT_KEY,
    value: input.records.slice(0, MAX_PENDING_INTENT_RECORDS),
    status: "inferred",
    sourceMessageId: input.sourceMessageId ?? null
  });
  return result.ok ? { ok: true } : { ok: false, warning: result.warning };
}

/**
 * Part 12 (continuation). Combines last turn's still-open intents with this
 * turn's freshly planned ones. A pending intent whose TYPE this turn's own
 * plan already addresses again (the expected case: the planner, informed of
 * the pending intent in its own prompt, re-emits it with the missing field
 * now filled in from the customer's short reply) is replaced by that fresh
 * entry, never duplicated. A pending intent this turn's message did not
 * touch at all is carried forward unchanged, so it is never silently
 * forgotten just because the customer asked about something else this turn.
 *
 * SALES-AGENT-R2-A08.6, Part 3 (post-audit fix). A cancel intent is the one
 * exception to "carried forward unchanged": "olvidalo"/"olvida el despacho"
 * is the customer explicitly withdrawing something still in flight, so a
 * pending intent the cancel's own scope targets must be dropped here, not
 * re-surfaced alongside it - otherwise a withdrawn "la classic" selection
 * would keep re-emitting a SELECT_PRODUCTS seed turn after turn even though
 * the customer asked to forget it, fighting deriveCommercialObjectives.ts's
 * own cancel handling for the same objective.
 */
const CANCEL_SCOPE_INTENT_TYPES: Record<Exclude<CommercialIntentCancelScope, "all">, CommercialIntent["type"]> = {
  selection: "select_products",
  destination: "get_shipping_quote",
  shipping: "get_shipping_quote",
  quote: "create_quote"
};

function cancelDiscardsIntentType(cancel: CommercialIntentCancel, intentType: CommercialIntent["type"]): boolean {
  if (cancel.scope === "all") return true;
  return CANCEL_SCOPE_INTENT_TYPES[cancel.scope] === intentType;
}

export function mergeCommercialIntents(pendingRecords: PendingCommercialIntentRecord[], newIntents: CommercialIntent[]): CommercialIntent[] {
  const newTypes = new Set(newIntents.filter((intent) => intent.type !== "unsupported").map((intent) => intent.type));
  const cancelIntents = newIntents.filter((intent): intent is CommercialIntentCancel => intent.type === "cancel");
  const carriedForward = pendingRecords
    .map((record) => record.intent)
    .filter((intent) => intent.type !== "unsupported" && !newTypes.has(intent.type))
    .filter((intent) => !cancelIntents.some((cancel) => cancelDiscardsIntentType(cancel, intent.type)));
  return [...carriedForward, ...newIntents];
}

import { getActiveRequestFact, upsertRequestFact } from "@/lib/brain/commercial/request-facts";
import type { RequestFact } from "@/lib/brain/commercial/request-facts";
import { buildCreatedQuoteRequestAnchor, CREATED_QUOTE_FACT_KEY } from "./constants";
import type { CreatedQuote, CreatedQuoteDependencies, CreatedQuoteFactValue, SetCreatedQuoteInput, SetCreatedQuoteResult } from "./types";

function isCreatedQuoteFactValue(value: unknown): value is CreatedQuoteFactValue {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.quoteId === "string" &&
    typeof record.quoteNumber === "string" &&
    typeof record.status === "string" &&
    typeof record.currency === "string" &&
    typeof record.total === "string" &&
    typeof record.validUntil === "string" &&
    typeof record.selectionFactId === "string" &&
    typeof record.idempotencyKey === "string" &&
    typeof record.createdAt === "string"
  );
}

function toCreatedQuote(fact: RequestFact): CreatedQuote | null {
  if (!isCreatedQuoteFactValue(fact.value)) return null;
  return { ...fact.value, factId: fact.factId, updatedAt: fact.updatedAt };
}

/**
 * The single write path for an opportunity's most recently created Quote
 * Service quote. Each call REPLACES the active reference - same
 * explicit-replacement policy as the sibling durable facts
 * (commercial_line_items/shipping_destination/selected_shipping_option).
 * This function always writes what it is given: WHETHER a new Quote Service
 * call (and therefore a new write here) is warranted is the caller's
 * decision (createQuoteCapability.ts), based on whether the opportunity's
 * active commercial_line_items.factId still matches the existing quote's
 * selectionFactId.
 */
export async function setCreatedQuoteForOpportunity(
  input: SetCreatedQuoteInput,
  deps: CreatedQuoteDependencies = {}
): Promise<SetCreatedQuoteResult> {
  const upsertFact = deps.upsertFact ?? upsertRequestFact;
  const now = deps.now ?? (() => new Date());

  const anchor = buildCreatedQuoteRequestAnchor(input.opportunityId);
  const value: CreatedQuoteFactValue = { ...input.quote, createdAt: now().toISOString() };

  const upserted = await upsertFact({
    requestId: anchor,
    factKey: CREATED_QUOTE_FACT_KEY,
    value,
    status: "confirmed",
    sourceToolExecutionId: input.sourceToolExecutionId ?? null
  });

  if (!upserted.ok) {
    return { ok: false, status: "persistence_failed", warning: upserted.warning };
  }

  const quote = toCreatedQuote(upserted.fact);
  if (!quote) {
    return { ok: false, status: "persistence_failed", warning: "created_quote_fact_reload_malformed" };
  }

  return { ok: true, status: "created", quote };
}

/** Rehydration: read-only, durable-state-first. Null whenever no quote has been created yet for this opportunity. */
export async function getActiveCreatedQuoteForOpportunity(opportunityId: number, deps: CreatedQuoteDependencies = {}): Promise<CreatedQuote | null> {
  const getActiveFact = deps.getActiveFact ?? getActiveRequestFact;
  const anchor = buildCreatedQuoteRequestAnchor(opportunityId);
  const fact = await getActiveFact(anchor, CREATED_QUOTE_FACT_KEY);
  if (!fact || fact.status !== "confirmed") return null;
  return toCreatedQuote(fact);
}

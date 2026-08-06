import type { CustomerHistoryCommercialSignal } from "./commercial-signals";

/**
 * CP-R1-T12D (spec section 13). Fixed priority when more signals qualify
 * than `maxSignals` allows - lower number wins. `HISTORY_UNAVAILABLE` first
 * (the model must never claim zero purchases while it is merely
 * unavailable), then the most specific match evidence, then the weaker
 * hypotheses, generic history-presence facts last (they are suppressed by
 * default anyway - see `shouldExposeCustomerHistorySignalToModel`).
 */
const SIGNAL_PRIORITY: Record<CustomerHistoryCommercialSignal["type"], number> = {
  HISTORY_UNAVAILABLE: 0,
  VARIANT_PREVIOUSLY_PURCHASED: 1,
  PRODUCT_PREVIOUSLY_PURCHASED: 2,
  POSSIBLE_REORDER: 3,
  POSSIBLE_COMPLEMENT: 4,
  RECENT_PURCHASE_RELEVANT: 5,
  PRODUCT_PURCHASE_REPEATED: 6,
  CUSTOMER_HAS_PURCHASE_HISTORY: 7,
  CUSTOMER_HAS_NO_PURCHASE_HISTORY: 7
};

export type CustomerHistorySignalTurnContext = {
  /** productIds this turn's own evidence (recommendationHistoryMatches) actually matched - see filterRelevantCustomerHistorySignals, which derives this itself so callers never have to. */
  readonly matchedProductIds: ReadonlySet<number>;
};

/**
 * CP-R1-T12D (spec section 13). Pure, single-signal decision. Defaults
 * exactly as specified: a bare history-presence/absence fact is never
 * exposed on its own (history exists without relevance -> no exponer); any
 * product/variant match, its reorder hypothesis, its recency, and a
 * Catalog-backed complement are always exposed (relevance is already baked
 * into why that signal exists at all); a repeated-purchase signal is exposed
 * only when the same productId also matched this turn's own request;
 * `HISTORY_UNAVAILABLE` is always exposed - never as a customer-facing
 * claim, only as the internal constraint that stops the model from
 * inventing "zero purchases".
 */
export function shouldExposeCustomerHistorySignalToModel(signal: CustomerHistoryCommercialSignal, turnContext: CustomerHistorySignalTurnContext): boolean {
  switch (signal.type) {
    case "CUSTOMER_HAS_PURCHASE_HISTORY":
    case "CUSTOMER_HAS_NO_PURCHASE_HISTORY":
      return false;
    case "HISTORY_UNAVAILABLE":
    case "PRODUCT_PREVIOUSLY_PURCHASED":
    case "VARIANT_PREVIOUSLY_PURCHASED":
    case "POSSIBLE_REORDER":
    case "RECENT_PURCHASE_RELEVANT":
    case "POSSIBLE_COMPLEMENT":
      return true;
    case "PRODUCT_PURCHASE_REPEATED":
      return turnContext.matchedProductIds.has(signal.productId);
    default:
      return false;
  }
}

function signalIdentityKey(signal: CustomerHistoryCommercialSignal): string {
  return JSON.stringify(signal);
}

/**
 * CP-R1-T12D. The practical entry point wiring calls: computes
 * `matchedProductIds` from the signals themselves (no external turn context
 * needed - match-derived signals already encode "this matched a current
 * candidate" by construction), applies `shouldExposeCustomerHistorySignalToModel`,
 * deduplicates, and caps at `maxSignals` in a fixed, deterministic order.
 * Never mutates `signals` - builds a new array throughout.
 */
export function filterRelevantCustomerHistorySignals(signals: readonly CustomerHistoryCommercialSignal[], maxSignals: number): CustomerHistoryCommercialSignal[] {
  const matchedProductIds = new Set<number>();
  for (const signal of signals) {
    if (signal.type === "PRODUCT_PREVIOUSLY_PURCHASED" || signal.type === "VARIANT_PREVIOUSLY_PURCHASED" || signal.type === "POSSIBLE_REORDER") {
      matchedProductIds.add(signal.productId);
    }
  }

  const exposed = signals.filter((signal) => shouldExposeCustomerHistorySignalToModel(signal, { matchedProductIds }));

  const deduped: CustomerHistoryCommercialSignal[] = [];
  const seenKeys = new Set<string>();
  for (const signal of exposed) {
    const key = signalIdentityKey(signal);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(signal);
  }

  return deduped.sort((a, b) => SIGNAL_PRIORITY[a.type] - SIGNAL_PRIORITY[b.type]).slice(0, maxSignals);
}

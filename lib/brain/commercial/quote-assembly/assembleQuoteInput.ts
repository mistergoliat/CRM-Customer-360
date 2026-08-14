/**
 * SALES-AGENT-R1-T2. Deterministic Quote Input Assembler.
 *
 * Catalog Service identifies + prices. CRM (commercial_line_items) selects.
 * This module hydrates. Quote Service snapshots (T3, not here).
 *
 * Reads only - no DB writes, no Quote Service calls, no capability
 * execution, no runtime/prompt/LLM involvement. See
 * docs/integrations/quote-input-assembly.md for the full contract.
 */
import { createCatalogPort } from "@/lib/catalog";
import type { CatalogPort, CatalogProduct } from "@/lib/catalog";
import { getActiveCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import type { CommercialLineItem } from "@/lib/domains/commercial-line-items";
import { getActiveShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import { checkShippingSelectionFreshness, getActiveSelectedShippingOptionForOpportunity } from "@/lib/domains/selected-shipping-option";
import { getMasterCustomerById } from "@/lib/integrations/customer-master/customer-repository";
import type { QuoteServiceCreateQuoteInput, QuoteServiceCustomerSnapshotInput, QuoteServiceLineInput } from "@/lib/domains/quote-service";
import { getOpportunityCoreForQuoteAssembly } from "./opportunityCore";
import { assemblyError, type AssembleQuoteInputResult } from "./errors";
import type { AssembleQuoteInputDependencies, AssembleQuoteInputInput, OpportunityCoreForQuoteAssembly } from "./types";

/** Only value Quote Service's real contract accepts today (QUOTE_SERVICE_SUPPORTED_CURRENCIES / z.literal("CLP")) - never assumed, always checked against what Catalog actually reports per line. */
const EXPECTED_CURRENCY = "CLP" as const;

/** Same 5-day policy already approved and hardcoded into Quote Service's own email template copy (docs/integrations/quote-service-adapter.md / MS-pesaschile-quote-service README "T07A") - not invented here. */
const DEFAULT_QUOTE_VALIDITY_DAYS = 5;

const CATALOG_SOURCE = "catalog_service" as const;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Pure passthrough - never rounds/computes. Guards against scientific notation, which would violate Quote Service's DECIMAL_STRING_PATTERN. */
function toDecimalStringOrNull(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const text = String(value);
  return /^-?(0|[1-9]\d*)(\.\d+)?$/.test(text) ? text : null;
}

function batchKey(productId: string, combinationId: string | null): string {
  return `${productId}:${combinationId ?? ""}`;
}

/**
 * Deterministic, real-data-only description (task section 14) - never LLM
 * copy. Concatenates two Catalog-sourced fields exactly as returned, same
 * discipline as Quote Service's own document rendering (e.g. "SKU {sku}"
 * pattern in quote-email-template).
 */
function buildLineDescription(product: CatalogProduct): string {
  const variantLabel = product.selectedVariant?.label?.trim();
  return variantLabel ? `${product.name} - ${variantLabel}` : product.name;
}

async function resolveCatalogLine(
  item: CommercialLineItem,
  product: CatalogProduct
): Promise<{ ok: true; line: QuoteServiceLineInput } | { ok: false; error: ReturnType<typeof assemblyError> }> {
  const price = product.price;

  if (!price || price.amount === null) {
    return {
      ok: false,
      error: assemblyError("catalog_price_missing", "Catalog Service did not report a resolvable price for this product.", {
        productId: item.productId,
        combinationId: item.combinationId
      })
    };
  }

  // Task section 11 - the fail-closed enforcement T1.1 prepared for and deliberately did not implement.
  if (price.taxIncluded !== true || price.taxRate === null) {
    return {
      ok: false,
      error: assemblyError("catalog_tax_metadata_missing", "Catalog Service did not report complete tax metadata (taxIncluded=true and a non-null taxRate are both required for a formal quote line).", {
        productId: item.productId,
        combinationId: item.combinationId,
        taxIncluded: price.taxIncluded,
        taxRateAvailable: price.taxRate !== null
      })
    };
  }

  if (price.currency !== EXPECTED_CURRENCY) {
    return {
      ok: false,
      error: assemblyError("currency_mismatch", `Catalog Service reported currency "${price.currency ?? "null"}", but this Quote request requires "${EXPECTED_CURRENCY}".`, {
        productId: item.productId,
        combinationId: item.combinationId,
        reportedCurrency: price.currency
      })
    };
  }

  const unitPrice = toDecimalStringOrNull(price.amount);
  const taxRate = toDecimalStringOrNull(price.taxRate);
  if (unitPrice === null || taxRate === null) {
    return {
      ok: false,
      error: assemblyError("catalog_price_missing", "Catalog Service reported a price/taxRate that cannot be represented as a valid decimal string.", {
        productId: item.productId,
        combinationId: item.combinationId
      })
    };
  }

  return {
    ok: true,
    line: {
      type: "product",
      externalSource: CATALOG_SOURCE,
      externalItemId: item.productId,
      externalVariantId: item.combinationId,
      sku: product.sku,
      description: buildLineDescription(product),
      quantity: String(item.quantity),
      unitPrice,
      taxIncluded: true,
      taxRate
    }
  };
}

async function resolveCustomerSnapshot(
  opportunity: OpportunityCoreForQuoteAssembly,
  getMasterCustomer: NonNullable<AssembleQuoteInputDependencies["getMasterCustomer"]>
): Promise<{ ok: true; snapshot: QuoteServiceCustomerSnapshotInput; customerId: string } | { ok: false; error: ReturnType<typeof assemblyError> }> {
  if (!opportunity.customerMasterId) {
    return { ok: false, error: assemblyError("customer_snapshot_incomplete", "This opportunity has no resolved customer identity yet (customer_master_id is null).") };
  }

  const customer = await getMasterCustomer(opportunity.customerMasterId);
  if (!customer) {
    return { ok: false, error: assemblyError("customer_snapshot_incomplete", "The opportunity's customer_master_id does not resolve to a real master_customer row.") };
  }

  const name = `${customer.firstname} ${customer.lastname}`.trim();
  if (!name) {
    // Structurally unreachable (both columns are NOT NULL in master_customer) - defense in depth, never a placeholder like "Cliente WhatsApp".
    return { ok: false, error: assemblyError("customer_snapshot_incomplete", "The resolved master_customer row has no usable name.") };
  }

  return {
    ok: true,
    customerId: String(customer.id),
    snapshot: {
      name,
      email: customer.email,
      // wa_id is the same phone-equivalent identity already used across this
      // codebase (trustedInbound.normalizedPhone, opportunity lookups) -
      // never a fabricated placeholder. Omitted (not sent as null) when absent.
      ...(opportunity.waId ? { phone: opportunity.waId } : {})
      // address/district/region: no real source exists in master_customer
      // today (confirmed: no such columns) - deliberately omitted rather
      // than guessed from an unrelated shipping address.
    }
  };
}

export async function assembleQuoteInput(input: AssembleQuoteInputInput, deps: AssembleQuoteInputDependencies = {}): Promise<AssembleQuoteInputResult> {
  const getCommercialLineItems = deps.getCommercialLineItems ?? getActiveCommercialLineItemsForOpportunity;
  const getShippingDestination = deps.getShippingDestination ?? getActiveShippingDestinationForOpportunity;
  const getSelectedShippingOption = deps.getSelectedShippingOption ?? getActiveSelectedShippingOptionForOpportunity;
  const getCatalogPort = deps.getCatalogPort ?? createCatalogPort;
  const getOpportunityCore = deps.getOpportunityCore ?? getOpportunityCoreForQuoteAssembly;
  const getMasterCustomer = deps.getMasterCustomer ?? (async (id: string) => {
    const result = await getMasterCustomerById(id);
    return result.ok ? result.data : null;
  });
  const now = deps.now ?? (() => new Date());

  const opportunity = await getOpportunityCore(input.opportunityId);
  if (!opportunity) {
    return assemblyError("missing_opportunity", "No opportunity found for the supplied opportunityId.", { opportunityId: input.opportunityId });
  }

  // Section 6/14/16: shipping requirement is checked before any Catalog/
  // customer work - failing fast here avoids spending a real Catalog batch
  // call on a request that cannot succeed. SALES-AGENT-R1-T2.1 closed half
  // of this gap (a real durable selected_shipping_option now exists,
  // evidence-gated and staleness-checked) but a second, independent gap
  // remains real and unresolved: Carrier MS provides no tax metadata for any
  // shipping option, and Quote Service has no shipping line-item
  // representation at all yet - so even a valid, fresh selection can never
  // become part of a QuoteServiceCreateRequest without fabricating data,
  // which never happens here. See docs/integrations/quote-input-assembly.md
  // "Shipping tax gap" for the full evidence trail.
  if (input.requireShipping) {
    const selectedOption = await getSelectedShippingOption(input.opportunityId);
    if (!selectedOption) {
      return assemblyError(
        "shipping_selection_missing",
        "A formal quote with shipping was requested, but no shipping option has been selected for this opportunity yet.",
        { opportunityId: input.opportunityId }
      );
    }

    const freshness = await checkShippingSelectionFreshness(input.opportunityId, selectedOption, { getCommercialLineItems, getShippingDestination });
    if (!freshness.fresh) {
      return assemblyError(
        "shipping_selection_stale",
        "The selected shipping option no longer matches the opportunity's current product selection or destination - it must be recalculated and re-selected, never silently reused.",
        { opportunityId: input.opportunityId, reason: freshness.reason }
      );
    }

    return assemblyError(
      "shipping_tax_metadata_missing",
      "A shipping option is selected and current, but Carrier MS reports no tax metadata for it and Quote Service has no shipping line-item representation yet - a Quote with shipping cannot be assembled without fabricating data.",
      { opportunityId: input.opportunityId, carrierName: selectedOption.carrierName, serviceType: selectedOption.serviceType }
    );
  }

  const selection = await getCommercialLineItems(input.opportunityId);
  if (!selection || selection.items.length === 0) {
    return assemblyError("no_commercial_line_items", "This opportunity has no confirmed commercial product selection.", { opportunityId: input.opportunityId });
  }

  // Section 9 - defense in depth. commercial_line_items already enforces
  // this at write time (setCommercialLineItemsForOpportunity); re-checked
  // here in case the durable state was ever written by a path that skipped
  // that validation. Also guards against a corrupted selection carrying two
  // entries for the same (productId, combinationId) - setCommercialLineItemsForOpportunity
  // already merges those at write time, so seeing one here means the durable
  // state was written by a path that bypassed that merge - fail closed
  // rather than silently produce two identical Quote lines.
  const seenKeys = new Set<string>();
  for (const item of selection.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return assemblyError("invalid_quantity", "A durable commercial line item has a non-positive or non-integer quantity.", {
        productId: item.productId,
        combinationId: item.combinationId,
        quantity: item.quantity
      });
    }
    const key = batchKey(item.productId, item.combinationId);
    if (seenKeys.has(key)) {
      return assemblyError("invalid_quantity", "The durable commercial selection has two entries for the same product/variant - the state is corrupt.", {
        productId: item.productId,
        combinationId: item.combinationId
      });
    }
    seenKeys.add(key);
  }

  const catalogPort: CatalogPort | null = getCatalogPort();
  if (!catalogPort) {
    return assemblyError("catalog_unavailable", "Catalog Service is not configured.", { opportunityId: input.opportunityId });
  }

  const batchResult = await catalogPort.batchGetProducts(
    { items: selection.items.map((item) => ({ productId: item.productId, ...(item.combinationId ? { combinationId: item.combinationId } : {}), quantity: item.quantity })) },
    { correlationId: input.correlationId }
  );
  if (!batchResult.ok) {
    return assemblyError("catalog_unavailable", "Catalog Service batch lookup failed.", { reason: batchResult.error.code });
  }

  const resultsByKey = new Map(batchResult.value.items.map((result) => [batchKey(result.input.productId, result.input.combinationId ?? null), result]));

  // Section 25 - order is always the durable selection's own order, never
  // the batch response's order (which is not contractually guaranteed to
  // match the request order).
  const lines: QuoteServiceLineInput[] = [];
  for (const item of selection.items) {
    const result = resultsByKey.get(batchKey(item.productId, item.combinationId));
    if (!result) {
      // Defensive only: every batch item was built 1:1 from selection.items - should be unreachable.
      return assemblyError("catalog_product_not_found", "Catalog Service response did not include a result for a requested item.", {
        productId: item.productId,
        combinationId: item.combinationId
      });
    }

    if (!result.ok) {
      const notFoundCode = item.combinationId ? "catalog_variant_not_found" : "catalog_product_not_found";
      const code = result.error.code === "not_found" ? notFoundCode : "catalog_unavailable";
      return assemblyError(code, "Catalog Service could not resolve this product.", {
        productId: item.productId,
        combinationId: item.combinationId,
        reason: result.error.code
      });
    }

    const lineResult = await resolveCatalogLine(item, result.product);
    if (!lineResult.ok) return lineResult.error;
    lines.push(lineResult.line);
  }

  const customerResult = await resolveCustomerSnapshot(opportunity, getMasterCustomer);
  if (!customerResult.ok) return customerResult.error;

  const resolvedAt = now();
  const validUntil = addDays(resolvedAt, DEFAULT_QUOTE_VALIDITY_DAYS).toISOString();

  const request: QuoteServiceCreateQuoteInput = {
    opportunityId: String(input.opportunityId),
    customerId: customerResult.customerId,
    ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
    actor: input.actor,
    source: input.source,
    currency: EXPECTED_CURRENCY,
    customerSnapshot: customerResult.snapshot,
    items: lines,
    validUntil
  };

  return {
    ok: true,
    request,
    evidence: {
      opportunityId: input.opportunityId,
      correlationId: input.correlationId,
      conversationId: input.conversationId ?? null,
      customerId: customerResult.customerId,
      selection: { factId: selection.factId, updatedAt: selection.updatedAt, itemCount: selection.items.length },
      catalog: { resolvedAt: resolvedAt.toISOString(), currency: EXPECTED_CURRENCY },
      shipping: { requested: Boolean(input.requireShipping), resolved: false, reason: input.requireShipping ? "no_shipping_line_item_contract" : null }
    }
  };
}

/**
 * Exposed separately so a future caller (T3+) can check shipping readiness
 * without paying for a full assembly attempt. Always reports `ready: false`
 * today (SALES-AGENT-R1-T2.1): a missing/stale selection is reported as
 * such, and even a valid, fresh one is reported blocked - Carrier MS's real
 * contract has no tax metadata for any option, and Quote Service has no
 * shipping line-item representation yet, so no selection can ever complete
 * a Quote today regardless of how correct the selection itself is. Never
 * chooses a carrier (task section 16: "NO elegir... sin decisión explícita
 * de negocio/cliente").
 */
export async function checkShippingSelectionReadiness(
  opportunityId: number,
  deps: Pick<AssembleQuoteInputDependencies, "getShippingDestination" | "getCommercialLineItems" | "getSelectedShippingOption"> = {}
): Promise<
  | { ready: false; reason: "no_selection"; destinationConfirmed: boolean }
  | { ready: false; reason: "selection_stale"; staleReason: "selection_changed" | "destination_changed" }
  | { ready: false; reason: "shipping_tax_metadata_missing"; carrierName: string; serviceType: string }
> {
  const getShippingDestination = deps.getShippingDestination ?? getActiveShippingDestinationForOpportunity;
  const getCommercialLineItems = deps.getCommercialLineItems ?? getActiveCommercialLineItemsForOpportunity;
  const getSelectedShippingOption = deps.getSelectedShippingOption ?? getActiveSelectedShippingOptionForOpportunity;

  const selectedOption = await getSelectedShippingOption(opportunityId);
  if (!selectedOption) {
    const destination = await getShippingDestination(opportunityId);
    return { ready: false, reason: "no_selection", destinationConfirmed: destination !== null };
  }

  const freshness = await checkShippingSelectionFreshness(opportunityId, selectedOption, { getCommercialLineItems, getShippingDestination });
  if (!freshness.fresh) {
    return { ready: false, reason: "selection_stale", staleReason: freshness.reason };
  }

  return { ready: false, reason: "shipping_tax_metadata_missing", carrierName: selectedOption.carrierName, serviceType: selectedOption.serviceType };
}

import { createCatalogPort, type CatalogPort, type CatalogProduct } from "@/lib/catalog";
import { getActiveCommercialLineItemsForOpportunity, type CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import { getActiveCreatedQuoteForOpportunity, type CreatedQuote } from "@/lib/domains/created-quote";
import { getActiveSelectedShippingOptionForOpportunity, type SelectedShippingOption } from "@/lib/domains/selected-shipping-option";
import { getActiveShippingDestinationForOpportunity, type ShippingDestination } from "@/lib/domains/shipping-destination";
import { createQuoteServicePort } from "@/lib/integrations/quote-service";
import type { QuoteServicePort, QuoteServiceQuote } from "@/lib/domains/quote-service";
import { loadRecentCommercialCapabilityExecutions } from "../work/capabilityExecutionReader";
import { findActiveCommercialWorks, getCommercialWorkByPublicId } from "../work/repository";
import type { CommercialCapabilityExecutionProjection } from "../work/types";
import type { PersistedCommercialWork } from "../work/persistenceTypes";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session/types";
import { makeCommercialFreshness, type CommercialFreshness } from "./freshness";
import type {
  BuildCommercialDomainReadModelInput,
  CommercialCartItemProjection,
  CommercialCartProjection,
  CommercialCatalogProductProjection,
  CommercialCaseProjection,
  CommercialCustomerProfileProjection,
  CommercialCustomerProjection,
  CommercialDestinationProjection,
  CommercialDomainReadModel,
  CommercialDomainReadModelDependencies,
  CommercialObjectiveProjection,
  CommercialQuoteProjection,
  CommercialReadEvidence,
  CommercialReadFailure,
  CommercialReaderResult,
  CommercialShippingCalculationProjection,
  CommercialShippingProjection,
  CommercialShippingSelectionProjection
} from "./types";

const TERMINAL_OBJECTIVE_STATUSES = new Set(["COMPLETED", "CANCELLED", "SUPERSEDED", "FAILED"]);
const SOURCE_CASE = "crm_commercial_work";
const SOURCE_CART = "crm_request_facts:commercial_line_items";
const SOURCE_DESTINATION = "crm_request_facts:shipping_destination";
const SOURCE_SELECTION = "crm_request_facts:selected_shipping_option";
const SOURCE_QUOTE_LOCATOR = "crm_request_facts:created_quote";
const SOURCE_SHIPPING = "crm_capability_executions:calculate_shipping";
const SOURCE_CATALOG = "catalog_service";
const SOURCE_QUOTE = "quote_service";
const SOURCE_CUSTOMER = "trusted_customer_session";

function isReadFailure<T>(value: CommercialReaderResult<T>): value is CommercialReadFailure {
  return Boolean(value && typeof value === "object" && "ok" in value && (value as { ok?: unknown }).ok === false);
}

function addEvidence(
  evidence: CommercialReadEvidence[],
  input: Omit<CommercialReadEvidence, "summary"> & { summary?: string }
): void {
  evidence.push({ ...input, summary: input.summary ?? input.kind });
}

function anchor(name: string, value: string | number | null | undefined): { name: string; value: string } | null {
  if (value === null || value === undefined || value === "") return null;
  return { name, value: String(value) };
}

function anchors(...values: Array<{ name: string; value: string } | null>): { name: string; value: string }[] {
  return values.filter((value): value is { name: string; value: string } => value !== null);
}

function failureReason<T>(value: CommercialReaderResult<T>): string | null {
  return isReadFailure(value) ? value.reason : null;
}

function knownAbsenceFreshness(source: string, opportunityId: number | null): CommercialFreshness {
  return makeCommercialFreshness({
    state: "CURRENT",
    source,
    anchors: anchors(anchor("opportunityId", opportunityId)),
    reason: "no_active_fact"
  });
}

function unknownFreshness(source: string, reason: string, opportunityId?: number | null): CommercialFreshness {
  return makeCommercialFreshness({
    state: "UNKNOWN",
    source,
    anchors: anchors(anchor("opportunityId", opportunityId)),
    reason
  });
}

function factFreshness(source: string, fact: { factId: string; updatedAt: string }, opportunityId: number): CommercialFreshness {
  return makeCommercialFreshness({
    state: "CURRENT",
    source,
    capturedAt: fact.updatedAt,
    sourceVersion: fact.factId,
    anchors: anchors(anchor("opportunityId", opportunityId), anchor("factId", fact.factId))
  });
}

function selectActiveObjective(work: PersistedCommercialWork | null): PersistedCommercialWork["objectives"][number] | null {
  if (!work) return null;
  return [...work.objectives]
    .filter((objective) => !TERMINAL_OBJECTIVE_STATUSES.has(objective.status))
    .sort((left, right) => left.objectiveId.localeCompare(right.objectiveId))[0] ?? null;
}

async function defaultReadCommercialWork(input: BuildCommercialDomainReadModelInput): Promise<PersistedCommercialWork | null> {
  if (input.workPublicId) return getCommercialWorkByPublicId(input.workPublicId);
  const works = await findActiveCommercialWorks({ opportunityId: input.opportunityId, conversationId: input.conversationId, limit: 20 });
  return [...works]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.publicId.localeCompare(left.publicId))[0] ?? null;
}

async function readWork(input: BuildCommercialDomainReadModelInput, dependencies: CommercialDomainReadModelDependencies): Promise<CommercialReaderResult<PersistedCommercialWork>> {
  if (input.commercialWork !== undefined) return input.commercialWork;
  try {
    if (dependencies.readCommercialWork) {
      return await dependencies.readCommercialWork({
        conversationId: input.conversationId,
        opportunityId: input.opportunityId ?? null,
        workPublicId: input.workPublicId ?? null
      });
    }
    if (input.workPublicId && dependencies.commercialWorkRepository?.getByPublicId) {
      return await dependencies.commercialWorkRepository.getByPublicId(input.workPublicId);
    }
    if (dependencies.commercialWorkRepository?.findActive) {
      const works = await dependencies.commercialWorkRepository.findActive({ opportunityId: input.opportunityId, conversationId: input.conversationId, limit: 20 });
      return [...works].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.publicId.localeCompare(left.publicId))[0] ?? null;
    }
    return await defaultReadCommercialWork(input);
  } catch {
    return { ok: false, reason: "commercial_work_read_failed" };
  }
}

async function readFact<T>(reader: (() => Promise<CommercialReaderResult<T>>) | null): Promise<CommercialReaderResult<T>> {
  if (!reader) return { ok: false, reason: "opportunity_unavailable" };
  try {
    return await reader();
  } catch {
    return { ok: false, reason: "domain_read_failed" };
  }
}

function mapCatalogProduct(product: CatalogProduct): CommercialCatalogProductProjection {
  const productFreshness = makeCommercialFreshness({
    state: "CURRENT",
    source: SOURCE_CATALOG,
    capturedAt: product.provenance.retrievedAt,
    sourceVersion: null,
    anchors: anchors(anchor("productId", product.productId), anchor("sku", product.sku)),
    reason: product.provenance.cached ? "served_from_catalog_cache" : null
  });
  return {
    productId: product.productId,
    name: product.name,
    sku: product.sku,
    price: product.price ? { ...product.price } : null,
    availability: product.availability,
    stockQuantity: product.stockQuantity,
    weightKg: product.weightKg,
    retrievedAt: product.provenance.retrievedAt,
    provenance: { ...product.provenance },
    freshness: productFreshness
  };
}

function sortCartItems(selection: CommercialLineItemSelection): CommercialLineItemSelection["items"] {
  return [...selection.items].sort((left, right) => {
    const leftKey = `${left.productId}:${left.combinationId ?? ""}`;
    const rightKey = `${right.productId}:${right.combinationId ?? ""}`;
    return leftKey.localeCompare(rightKey) || left.quantity - right.quantity;
  });
}

async function hydrateCartItems(
  selection: CommercialLineItemSelection | null,
  catalogPort: CatalogPort | null,
  correlationId: string,
  evidence: CommercialReadEvidence[]
): Promise<CommercialCartItemProjection[]> {
  if (!selection) return [];
  const items = sortCartItems(selection);
  const hydrated = await Promise.all(
    items.map(async (item) => {
      const itemAnchors = anchors(anchor("productId", item.productId), anchor("combinationId", item.combinationId));
      if (!catalogPort) {
        const freshness = makeCommercialFreshness({ state: "UNKNOWN", source: SOURCE_CATALOG, anchors: itemAnchors, reason: "catalog_unavailable" });
        return { item: { ...item, product: null, freshness }, evidence: { kind: "catalog_hydration", status: freshness.state, source: SOURCE_CATALOG, capturedAt: null, reference: item.productId, summary: "catalog_unavailable" } };
      }

      try {
        const result = await catalogPort.getProductDetails(
          { productId: item.productId, ...(item.combinationId ? { combinationId: item.combinationId } : {}) },
          { correlationId }
        );
        if (!result.ok || !result.value) {
          const reason = result.ok ? "catalog_product_not_found" : `catalog_${result.error.code}`;
          const freshness = makeCommercialFreshness({ state: "UNKNOWN", source: SOURCE_CATALOG, anchors: itemAnchors, reason });
          return { item: { ...item, product: null, freshness }, evidence: { kind: "catalog_hydration", status: freshness.state, source: SOURCE_CATALOG, capturedAt: null, reference: item.productId, summary: reason } };
        }
        const product = mapCatalogProduct(result.value);
        return { item: { ...item, product, freshness: product.freshness }, evidence: { kind: "catalog_product", status: product.freshness.state, source: SOURCE_CATALOG, capturedAt: product.retrievedAt, reference: product.productId, summary: "catalog_product_hydrated" } };
      } catch {
        const freshness = makeCommercialFreshness({ state: "UNKNOWN", source: SOURCE_CATALOG, anchors: itemAnchors, reason: "catalog_read_failed" });
        return { item: { ...item, product: null, freshness }, evidence: { kind: "catalog_hydration", status: freshness.state, source: SOURCE_CATALOG, capturedAt: null, reference: item.productId, summary: "catalog_read_failed" } };
      }
    })
  );
  for (const result of hydrated) addEvidence(evidence, result.evidence);
  return hydrated.map((result) => result.item);
}

function parseShippingAnchors(execution: CommercialCapabilityExecutionProjection | null): { selectionFactId: string | null; destinationFactId: string | null } {
  const payload = execution?.responseSummaryJson;
  if (!payload) return { selectionFactId: null, destinationFactId: null };
  return {
    selectionFactId: typeof payload.selectionFactId === "string" ? payload.selectionFactId : null,
    destinationFactId: typeof payload.destinationFactId === "string" ? payload.destinationFactId : null
  };
}

function latestShippingExecution(executions: readonly CommercialCapabilityExecutionProjection[]): CommercialCapabilityExecutionProjection | null {
  return [...executions]
    .filter((execution) => execution.capabilityName === "calculate_shipping")
    .sort((left, right) => {
      const leftTime = left.completedAt ? Date.parse(left.completedAt) : Number.NEGATIVE_INFINITY;
      const rightTime = right.completedAt ? Date.parse(right.completedAt) : Number.NEGATIVE_INFINITY;
      return rightTime - leftTime || String(right.publicId || right.id || "").localeCompare(String(left.publicId || left.id || ""));
    })[0] ?? null;
}

function mapShippingCalculation(execution: CommercialCapabilityExecutionProjection | null): CommercialShippingCalculationProjection | null {
  if (!execution) return null;
  const parsed = parseShippingAnchors(execution);
  const state = execution.executionStatus === "completed" && parsed.selectionFactId && parsed.destinationFactId ? "CURRENT" : "UNKNOWN";
  return {
    executionId: execution.publicId || (execution.id === undefined ? null : String(execution.id)),
    executionStatus: execution.executionStatus,
    selectionFactId: parsed.selectionFactId,
    destinationFactId: parsed.destinationFactId,
    completedAt: execution.completedAt ?? null,
    freshness: makeCommercialFreshness({
      state,
      source: SOURCE_SHIPPING,
      capturedAt: execution.completedAt ?? null,
      sourceVersion: null,
      anchors: anchors(anchor("executionId", execution.publicId || execution.id)),
      reason: state === "UNKNOWN" ? "shipping_calculation_not_usable" : null
    })
  };
}

function mapSelection(selection: SelectedShippingOption): CommercialShippingSelectionProjection {
  return {
    factId: selection.factId,
    shippingQuoteExecutionId: selection.shippingQuoteExecutionId,
    selectionFactId: selection.selectionFactId,
    destinationFactId: selection.destinationFactId,
    optionIndex: selection.optionIndex,
    carrierName: selection.carrierName,
    serviceType: selection.serviceType,
    totalCost: selection.totalCost,
    estimatedDelivery: selection.estimatedDelivery,
    calculatedAt: selection.calculatedAt,
    selectedAt: selection.selectedAt
  };
}

function projectShipping(input: {
  selected: CommercialReaderResult<SelectedShippingOption>;
  calculations: CommercialReaderResult<readonly CommercialCapabilityExecutionProjection[]>;
  cart: CommercialReaderResult<CommercialLineItemSelection>;
  destination: CommercialReaderResult<ShippingDestination>;
  opportunityId: number | null;
  evidence: CommercialReadEvidence[];
}): CommercialShippingProjection {
  const selected = isReadFailure(input.selected) ? null : input.selected;
  const calculations = isReadFailure(input.calculations) ? [] : input.calculations ?? [];
  const latest = latestShippingExecution(calculations);
  const calculation = mapShippingCalculation(latest);
  const calculationReadFailed = isReadFailure(input.calculations);
  const selectionReadFailed = isReadFailure(input.selected);
  const cartReadFailed = isReadFailure(input.cart);
  const destinationReadFailed = isReadFailure(input.destination);
  const selection = selected ? mapSelection(selected) : null;
  const currentCart = isReadFailure(input.cart) ? null : input.cart;
  const currentDestination = isReadFailure(input.destination) ? null : input.destination;

  let state: CommercialShippingProjection["state"];
  let reason: string | null = null;
  if (calculationReadFailed || selectionReadFailed || cartReadFailed || destinationReadFailed) {
    state = "UNKNOWN";
    reason = "shipping_read_failed";
  } else if (!selection) {
    state = "MISSING";
    reason = latest ? "shipping_selection_missing" : "shipping_calculation_missing";
  } else if (!currentCart || !currentDestination) {
    state = "STALE";
    reason = !currentCart ? "cart_anchor_changed" : "destination_anchor_changed";
  } else if (selection.selectionFactId !== currentCart.factId) {
    state = "STALE";
    reason = "selection_changed";
  } else if (selection.destinationFactId !== currentDestination.factId) {
    state = "STALE";
    reason = "destination_changed";
  } else {
    state = "CURRENT";
  }

  const freshness = makeCommercialFreshness({
    state: state === "MISSING" ? "UNKNOWN" : state,
    source: SOURCE_SELECTION,
    capturedAt: selected?.updatedAt ?? calculation?.completedAt ?? null,
    sourceVersion: selected?.factId ?? null,
    anchors: anchors(
      anchor("opportunityId", input.opportunityId),
      anchor("selectionFactId", selection?.selectionFactId),
      anchor("destinationFactId", selection?.destinationFactId),
      anchor("currentCartFactId", currentCart?.factId),
      anchor("currentDestinationFactId", currentDestination?.factId)
    ),
    reason
  });
  addEvidence(input.evidence, {
    kind: "shipping",
    status: freshness.state,
    source: SOURCE_SELECTION,
    capturedAt: freshness.capturedAt,
    reference: selection?.factId ?? calculation?.executionId ?? null,
    summary: state === "CURRENT" ? "shipping_current" : state === "STALE" ? "shipping_stale" : state === "MISSING" ? "shipping_missing" : "shipping_unknown"
  });
  return { state, selection, calculation, freshness };
}

function quoteFromFact(quote: CreatedQuote): CommercialQuoteProjection {
  return {
    quoteId: quote.quoteId,
    quoteNumber: quote.quoteNumber,
    status: quote.status,
    currency: quote.currency,
    total: quote.total,
    validUntil: quote.validUntil,
    version: null,
    selectionFactId: quote.selectionFactId,
    freshness: unknownFreshness(SOURCE_QUOTE_LOCATOR, "quote_service_unavailable"),
    grounding: "UNKNOWN"
  };
}

function quoteFromService(quote: QuoteServiceQuote, selectionFactId: string | null, freshness: CommercialFreshness, grounding: CommercialQuoteProjection["grounding"]): CommercialQuoteProjection {
  return {
    quoteId: quote.quoteId,
    quoteNumber: quote.quoteNumber,
    status: quote.status,
    currency: quote.currency,
    total: quote.pricing.total,
    validUntil: quote.validUntil,
    version: quote.version,
    selectionFactId,
    freshness,
    grounding
  };
}

async function projectQuote(input: {
  createdQuote: CommercialReaderResult<CreatedQuote>;
  cart: CommercialReaderResult<CommercialLineItemSelection>;
  quoteServicePort: QuoteServicePort | null;
  evidence: CommercialReadEvidence[];
  opportunityId: number | null;
}): Promise<CommercialQuoteProjection | null> {
  if (isReadFailure(input.createdQuote) || !input.createdQuote) {
    if (isReadFailure(input.createdQuote)) {
      addEvidence(input.evidence, { kind: "quote", status: "UNKNOWN", source: SOURCE_QUOTE_LOCATOR, capturedAt: null, reference: null, summary: "created_quote_locator_read_failed" });
    }
    return null;
  }

  const locator = input.createdQuote;
  let projected = quoteFromFact(locator);
  let serviceStatus: "available" | "unavailable" = "unavailable";
  const currentCart = !isReadFailure(input.cart) ? input.cart : null;
  if (input.quoteServicePort) {
    try {
      const result = await input.quoteServicePort.getQuote(locator.quoteId);
      if (result.ok && result.value.quoteId === locator.quoteId) {
        serviceStatus = "available";
        const cartAvailable = Boolean(currentCart);
        const selectionMatches = cartAvailable && result.value.quoteId === locator.quoteId && locator.selectionFactId === currentCart?.factId;
        const freshness = makeCommercialFreshness({
          state: selectionMatches ? "CURRENT" : cartAvailable ? "STALE" : "UNKNOWN",
          source: SOURCE_QUOTE,
          capturedAt: result.value.timestamps.updatedAt,
          sourceVersion: result.value.version,
          anchors: anchors(anchor("quoteId", result.value.quoteId), anchor("selectionFactId", locator.selectionFactId), anchor("currentCartFactId", currentCart?.factId)),
          reason: selectionMatches ? "current_for_known_anchors" : cartAvailable ? "selection_changed" : "cart_anchor_unavailable"
        });
        projected = quoteFromService(result.value, locator.selectionFactId, freshness, selectionMatches ? "CURRENT_FOR_KNOWN_ANCHORS" : cartAvailable ? "STALE" : "UNKNOWN");
      }
    } catch {
      // The locator remains useful, but the Quote Service read is unknown.
    }
  }
  if (serviceStatus === "unavailable") {
    projected = { ...projected, freshness: unknownFreshness(SOURCE_QUOTE, "quote_service_unavailable", input.opportunityId), grounding: "UNKNOWN" };
  }
  addEvidence(input.evidence, {
    kind: "quote",
    status: projected.freshness.state,
    source: projected.freshness.source,
    capturedAt: projected.freshness.capturedAt,
    reference: projected.quoteId,
    summary: projected.grounding === "CURRENT_FOR_KNOWN_ANCHORS" ? "quote_current_for_known_anchors" : projected.grounding === "STALE" ? "quote_stale" : "quote_unknown"
  });
  return projected;
}

function projectCustomer(input: {
  trustedCustomerSession: NativeCustomerSessionExecutionContext | null | undefined;
  profile: CommercialCustomerProfileProjection | null;
}): CommercialCustomerProjection {
  const session = input.trustedCustomerSession;
  if (!session) {
    return { status: "unknown", identityLevel: null, hasResolvedCustomer: false, verificationRequired: false, profile: input.profile };
  }
  return {
    status: session.identity.status,
    identityLevel: session.runtimeIdentity.identityLevel,
    hasResolvedCustomer: session.identity.customerId !== null || session.runtimeIdentity.masterCustomerId !== null,
    verificationRequired: session.runtimeIdentity.verificationRequired,
    profile: input.profile
  };
}

async function projectProfile(input: BuildCommercialDomainReadModelInput, dependencies: CommercialDomainReadModelDependencies): Promise<CommercialCustomerProfileProjection | null> {
  if (dependencies.customerProfile !== undefined) return dependencies.customerProfile;
  if (!dependencies.readCustomerProfile) return null;
  try {
    const result = await dependencies.readCustomerProfile({ trustedCustomerSession: input.trustedCustomerSession, correlationId: input.correlationId });
    if (isReadFailure(result)) return { status: "UNAVAILABLE", retrievedAt: null, relationshipSummary: null };
    if (result === null) return null;
    return result;
  } catch {
    return { status: "UNAVAILABLE", retrievedAt: null, relationshipSummary: null };
  }
}

function buildCase(input: BuildCommercialDomainReadModelInput, work: PersistedCommercialWork | null, workReadFailure: string | null, evidence: CommercialReadEvidence[]): CommercialCaseProjection {
  const opportunityId = input.opportunityId ?? work?.opportunityId ?? null;
  if (!work) {
    const freshness = unknownFreshness(SOURCE_CASE, workReadFailure ?? "commercial_work_not_found", opportunityId);
    addEvidence(evidence, { kind: "case", status: freshness.state, source: SOURCE_CASE, capturedAt: null, reference: null, summary: workReadFailure ?? "commercial_work_not_found" });
    return {
      caseId: `conversation:${input.conversationId}`,
      conversationId: input.conversationId,
      opportunityId,
      workId: null,
      workVersion: null,
      status: "NOT_CREATED",
      blockers: [],
      freshness
    };
  }
  const freshness = makeCommercialFreshness({
    state: "CURRENT",
    source: SOURCE_CASE,
    capturedAt: work.updatedAt,
    sourceVersion: work.version,
    anchors: anchors(anchor("workId", work.publicId), anchor("conversationId", work.conversationId), anchor("opportunityId", work.opportunityId)),
    reason: null
  });
  addEvidence(evidence, { kind: "case", status: freshness.state, source: SOURCE_CASE, capturedAt: work.updatedAt, reference: work.publicId, summary: "commercial_work_current" });
  return {
    caseId: work.id,
    conversationId: work.conversationId,
    opportunityId: work.opportunityId,
    workId: work.publicId,
    workVersion: work.version,
    status: work.status,
    blockers: [...work.blockers],
    freshness
  };
}

function buildObjective(work: PersistedCommercialWork | null, evidence: CommercialReadEvidence[]): CommercialObjectiveProjection | null {
  const objective = selectActiveObjective(work);
  if (!objective || !work) return null;
  const freshness = makeCommercialFreshness({
    state: "CURRENT",
    source: SOURCE_CASE,
    capturedAt: work.updatedAt,
    sourceVersion: work.version,
    anchors: anchors(anchor("workId", work.publicId), anchor("objectiveId", objective.objectiveId)),
    reason: null
  });
  addEvidence(evidence, { kind: "objective", status: freshness.state, source: SOURCE_CASE, capturedAt: work.updatedAt, reference: objective.objectiveId, summary: "commercial_objective_current" });
  return {
    objectiveId: objective.objectiveId,
    type: objective.type,
    status: objective.status,
    missingRequirements: [...objective.missingRequirements],
    blockers: [...objective.blockers],
    freshness
  };
}

function buildCart(
  input: CommercialReaderResult<CommercialLineItemSelection>,
  hydratedItems: CommercialCartItemProjection[],
  opportunityId: number | null,
  evidence: CommercialReadEvidence[]
): CommercialCartProjection {
  if (isReadFailure(input)) {
    const freshness = unknownFreshness(SOURCE_CART, input.reason, opportunityId);
    addEvidence(evidence, { kind: "cart", status: freshness.state, source: SOURCE_CART, capturedAt: null, reference: null, summary: input.reason });
    return { factId: null, updatedAt: null, items: [], freshness };
  }
  if (!input) {
    const freshness = knownAbsenceFreshness(SOURCE_CART, opportunityId);
    addEvidence(evidence, { kind: "cart", status: freshness.state, source: SOURCE_CART, capturedAt: null, reference: null, summary: "cart_empty" });
    return { factId: null, updatedAt: null, items: [], freshness };
  }
  const freshness = factFreshness(SOURCE_CART, input, opportunityId ?? 0);
  addEvidence(evidence, { kind: "cart", status: freshness.state, source: SOURCE_CART, capturedAt: input.updatedAt, reference: input.factId, summary: input.items.length > 0 ? "cart_current" : "cart_empty" });
  return { factId: input.factId, updatedAt: input.updatedAt, items: hydratedItems, freshness };
}

function buildDestination(input: CommercialReaderResult<ShippingDestination>, opportunityId: number | null, evidence: CommercialReadEvidence[]): CommercialDestinationProjection | null {
  if (isReadFailure(input)) {
    addEvidence(evidence, { kind: "destination", status: "UNKNOWN", source: SOURCE_DESTINATION, capturedAt: null, reference: null, summary: input.reason });
    return null;
  }
  if (!input) {
    addEvidence(evidence, { kind: "destination", status: "CURRENT", source: SOURCE_DESTINATION, capturedAt: null, reference: null, summary: "destination_missing" });
    return null;
  }
  const freshness = factFreshness(SOURCE_DESTINATION, input, opportunityId ?? 0);
  addEvidence(evidence, { kind: "destination", status: freshness.state, source: SOURCE_DESTINATION, capturedAt: input.updatedAt, reference: input.factId, summary: "destination_current" });
  return { factId: input.factId, communeId: input.communeId, canonicalName: input.canonicalName, updatedAt: input.updatedAt, freshness };
}

function makeEmptyFacts(opportunityId: number | null): {
  cart: CommercialReaderResult<CommercialLineItemSelection>;
  destination: CommercialReaderResult<ShippingDestination>;
  selected: CommercialReaderResult<SelectedShippingOption>;
  createdQuote: CommercialReaderResult<CreatedQuote>;
  calculations: CommercialReaderResult<readonly CommercialCapabilityExecutionProjection[]>;
} {
  if (opportunityId !== null) return { cart: null, destination: null, selected: null, createdQuote: null, calculations: [] };
  const unavailable = { ok: false as const, reason: "opportunity_unavailable" };
  return { cart: unavailable, destination: unavailable, selected: unavailable, createdQuote: unavailable, calculations: unavailable };
}

async function readCommercialFacts(input: BuildCommercialDomainReadModelInput, dependencies: CommercialDomainReadModelDependencies, opportunityId: number | null) {
  if (opportunityId === null) return makeEmptyFacts(opportunityId);
  const [cart, destination, selected, createdQuote, calculations] = await Promise.all([
    readFact(dependencies.readCart ? () => dependencies.readCart!(opportunityId) : () => getActiveCommercialLineItemsForOpportunity(opportunityId)),
    readFact(dependencies.readDestination ? () => dependencies.readDestination!(opportunityId) : () => getActiveShippingDestinationForOpportunity(opportunityId)),
    readFact(dependencies.readSelectedShipping ? () => dependencies.readSelectedShipping!(opportunityId) : () => getActiveSelectedShippingOptionForOpportunity(opportunityId)),
    readFact(dependencies.readCreatedQuote ? () => dependencies.readCreatedQuote!(opportunityId) : () => getActiveCreatedQuoteForOpportunity(opportunityId)),
    readFact(
      dependencies.readShippingCalculations
        ? () => dependencies.readShippingCalculations!(opportunityId)
        : () => loadRecentCommercialCapabilityExecutions({ opportunityId, capabilityNames: ["calculate_shipping"], limit: 20 })
    )
  ]);
  return { cart, destination, selected, createdQuote, calculations };
}

export async function buildCommercialDomainReadModel(input: BuildCommercialDomainReadModelInput): Promise<CommercialDomainReadModel> {
  const dependencies = input.dependencies ?? {};
  const workResult = await readWork(input, dependencies);
  const work = isReadFailure(workResult) ? null : workResult;
  const opportunityId = input.opportunityId ?? work?.opportunityId ?? null;
  const evidence: CommercialReadEvidence[] = [];
  const facts = await readCommercialFacts(input, dependencies, opportunityId);
  const catalogPort = dependencies.catalogPort !== undefined ? dependencies.catalogPort : createCatalogPort();
  const cartSelection = isReadFailure(facts.cart) ? null : facts.cart;
  const hydratedItems = await hydrateCartItems(cartSelection, catalogPort, input.correlationId, evidence);
  const cart = buildCart(facts.cart, hydratedItems, opportunityId, evidence);
  const destination = buildDestination(facts.destination, opportunityId, evidence);
  const shipping = projectShipping({ selected: facts.selected, calculations: facts.calculations, cart: facts.cart, destination: facts.destination, opportunityId, evidence });
  const quoteServicePort = dependencies.quoteServicePort !== undefined ? dependencies.quoteServicePort : createQuoteServicePort();
  const quote = await projectQuote({ createdQuote: facts.createdQuote, cart: facts.cart, quoteServicePort, evidence, opportunityId });
  const profile = await projectProfile(input, dependencies);
  if (profile) {
    addEvidence(evidence, { kind: "customer_profile", status: profile.status === "AVAILABLE" ? "CURRENT" : "UNKNOWN", source: "customer_profile", capturedAt: profile.retrievedAt, reference: null, summary: `customer_profile_${profile.status.toLowerCase()}` });
  }
  const customer = projectCustomer({ trustedCustomerSession: input.trustedCustomerSession, profile });
  addEvidence(evidence, { kind: "customer_identity", status: input.trustedCustomerSession ? "CURRENT" : "UNKNOWN", source: SOURCE_CUSTOMER, capturedAt: null, reference: null, summary: input.trustedCustomerSession ? "trusted_identity_context" : "trusted_identity_unavailable" });
  const caseProjection = buildCase(input, work, failureReason(workResult), evidence);
  const objective = buildObjective(work, evidence);
  return {
    case: caseProjection,
    objective,
    cart,
    destination,
    shipping,
    quote,
    customer,
    conversation: { conversationId: input.conversationId, sessionVersion: input.sessionVersion ?? null },
    evidence
  };
}

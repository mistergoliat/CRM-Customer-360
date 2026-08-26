import type { CommercialLineItem } from "@/lib/domains/commercial-line-items";
import type { CommercialObjective, CommercialWork, CommercialWorkBlocker, CommercialWorkProjectionInput, CommercialCapabilityExecutionProjection, CommercialEvidenceRef } from "./types";
import type { CommercialObjectiveStatus } from "./statuses";
import { deriveCommercialObjectives, carriedObjectiveStatusById } from "./deriveCommercialObjectives";
import { deriveCommercialWorkSteps } from "./deriveCommercialWorkSteps";
import { applyCommercialIdentityGate } from "./commercialIdentityGate";
import { matchShippingOptionReference } from "./matchShippingOptionReference";
import type { ShippingOptionCandidate } from "./matchShippingOptionReference";
import { collectCommercialWorkBlockers, deriveCommercialWorkMetrics, deriveCommercialWorkStatus } from "./evaluateCommercialWork";

function toIso(value: string | Date | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return new Date().toISOString();
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}

function normalizeItems(items: readonly CommercialLineItem[] | undefined): CommercialLineItem[] {
  return [...(items ?? [])]
    .map((item) => ({ productId: item.productId, combinationId: item.combinationId ?? null, quantity: item.quantity }))
    .sort((a, b) => `${a.productId}:${a.combinationId ?? ""}`.localeCompare(`${b.productId}:${b.combinationId ?? ""}`));
}

function sameItems(a: readonly CommercialLineItem[] | undefined, b: readonly CommercialLineItem[] | undefined): boolean {
  const left = normalizeItems(a);
  const right = normalizeItems(b);
  return JSON.stringify(left) === JSON.stringify(right);
}

function requestFactEvidence(factType: NonNullable<CommercialEvidenceRef["factType"]>, id: string | number | undefined): CommercialEvidenceRef[] {
  return id ? [{ kind: "request_fact", factType, id }] : [];
}

function capabilityEvidence(execution: CommercialCapabilityExecutionProjection, stale = false, reason?: string): CommercialEvidenceRef {
  return {
    kind: "capability_execution",
    id: execution.publicId || execution.id,
    capabilityName: execution.capabilityName,
    status: execution.executionStatus,
    stale,
    reason
  };
}

function blocker(code: CommercialWorkBlocker["code"], source: CommercialWorkBlocker["source"], objectiveId?: string): CommercialWorkBlocker {
  return { code, source, ...(objectiveId ? { objectiveId } : {}) };
}

function latestCalculateShippingExecution(executions: readonly CommercialCapabilityExecutionProjection[] | undefined): CommercialCapabilityExecutionProjection | null {
  const candidates = (executions ?? []).filter((execution) => execution.capabilityName === "calculate_shipping");
  return candidates.sort((a, b) => {
    const left = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const right = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return right - left;
  })[0] ?? null;
}

/**
 * SALES-AGENT-R2-A11.4. Extracts the real options[] a calculate_shipping
 * execution returned (calculateShippingCapability.ts's completed() payload)
 * for matchShippingOptionReference - never fabricates an entry, an item
 * missing a required field is silently dropped rather than guessed.
 */
function parseShippingOptionCandidates(execution: CommercialCapabilityExecutionProjection | null): ShippingOptionCandidate[] {
  const payload = execution?.responseSummaryJson;
  const rawOptions = payload && Array.isArray(payload.options) ? payload.options : [];
  const candidates: ShippingOptionCandidate[] = [];
  rawOptions.forEach((raw: unknown, fallbackIndex: number) => {
    if (typeof raw !== "object" || raw === null) return;
    const item = raw as Record<string, unknown>;
    const index = typeof item.index === "number" ? item.index : fallbackIndex;
    const carrierName = typeof item.carrierName === "string" ? item.carrierName : "";
    const serviceType = typeof item.serviceType === "string" ? item.serviceType : "";
    const totalCost = typeof item.totalCost === "number" ? item.totalCost : null;
    const estimatedDelivery = typeof item.estimatedDelivery === "string" ? item.estimatedDelivery : "";
    if (totalCost === null) return;
    candidates.push({ index, carrierName, serviceType, totalCost, estimatedDelivery });
  });
  return candidates;
}

/**
 * SALES-AGENT-R2-A11.1, Part 2. Matched on the ORIGINAL request query text
 * (requestSummaryJson, populated unconditionally by executeCapability.ts's
 * `requestSummary = definition.buildRequestSummary ? ... : input`, even on
 * failure) rather than the response payload - a failed/temporarily-blocked
 * search has no responseSummaryJson (executeCapability.ts persists
 * responseSummary: null on every non-execute() early return), so matching on
 * the response would make a real catalog outage invisible to this objective
 * and leave it stuck re-deriving READY -> re-searching forever instead of
 * reaching WAITING_SYSTEM.
 */
function latestSearchProductsExecution(
  executions: readonly CommercialCapabilityExecutionProjection[] | undefined,
  productReference: string | undefined
): CommercialCapabilityExecutionProjection | null {
  if (!productReference) return null;
  const wantedQuery = normalizeText(productReference);
  const candidates = (executions ?? []).filter((execution) => {
    if (execution.capabilityName !== "search_products") return false;
    const requestQuery = execution.requestSummaryJson && typeof execution.requestSummaryJson.query === "string" ? execution.requestSummaryJson.query : null;
    return requestQuery !== null && normalizeText(requestQuery) === wantedQuery;
  });
  return candidates.sort((a, b) => {
    const left = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const right = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return right - left;
  })[0] ?? null;
}

type SearchProductsCandidate = { productId: string; combinationId?: string; name: string; price?: { amount: number; currency: string } | null };

type SearchProductsResolution =
  | { status: "resolved"; sourceProduct: { productId: string; combinationId?: string } }
  | { status: "clarification_required" | "no_match" };

/**
 * SALES-AGENT-R2-A11.2-C. Parses `productIntent` (the raw T12 result the
 * search_products capability now persists verbatim - registry.ts's
 * searchProductsCapabilityDataFromProductIntent) out of a completed
 * execution's responseSummaryJson. Replaces the old candidate-counting
 * logic (0/1/N) with the real resolution.status T12 already computed - see
 * docs/audits/SALES-AGENT-R2-A11.2-catalog-service-integration-audit.md
 * Parte 6/11. Returns null for anything structurally unrecognizable (a
 * contract violation, or - pre-A11.2-C - a legacy items-only payload with no
 * productIntent field at all), which applyObjectiveState treats as a
 * technical failure rather than guessing.
 */
function parseProductIntentResolution(raw: unknown): { resolution: SearchProductsResolution; candidates: SearchProductsCandidate[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const resolutionRaw = record.resolution;
  if (!resolutionRaw || typeof resolutionRaw !== "object") return null;
  const status = (resolutionRaw as Record<string, unknown>).status;
  if (status !== "resolved" && status !== "clarification_required" && status !== "no_match") return null;

  const candidatesRaw = Array.isArray(record.candidates) ? record.candidates : [];
  const candidates: SearchProductsCandidate[] = [];
  for (const entry of candidatesRaw) {
    if (!entry || typeof entry !== "object") continue;
    const product = (entry as Record<string, unknown>).product;
    if (!product || typeof product !== "object") continue;
    const productRecord = product as Record<string, unknown>;
    const productId = typeof productRecord.productId === "string" ? productRecord.productId : null;
    const name = typeof productRecord.name === "string" ? productRecord.name : null;
    if (!productId || !name) continue;
    const combinationId = typeof productRecord.combinationId === "string" ? productRecord.combinationId : undefined;
    const priceRaw = productRecord.price;
    const price =
      priceRaw === null
        ? null
        : priceRaw && typeof priceRaw === "object" && typeof (priceRaw as Record<string, unknown>).amount === "number" && typeof (priceRaw as Record<string, unknown>).currency === "string"
          ? { amount: (priceRaw as Record<string, unknown>).amount as number, currency: (priceRaw as Record<string, unknown>).currency as string }
          : undefined;
    candidates.push({ productId, ...(combinationId ? { combinationId } : {}), name, ...(price !== undefined ? { price } : {}) });
  }

  if (status === "resolved") {
    const sourceProductRaw = (resolutionRaw as Record<string, unknown>).sourceProduct;
    if (!sourceProductRaw || typeof sourceProductRaw !== "object") return null;
    const productId = typeof (sourceProductRaw as Record<string, unknown>).productId === "string" ? ((sourceProductRaw as Record<string, unknown>).productId as string) : null;
    if (!productId) return null;
    const combinationId = typeof (sourceProductRaw as Record<string, unknown>).combinationId === "string" ? ((sourceProductRaw as Record<string, unknown>).combinationId as string) : undefined;
    return { resolution: { status: "resolved", sourceProduct: { productId, ...(combinationId ? { combinationId } : {}) } }, candidates };
  }
  return { resolution: { status }, candidates };
}

function executionAnchorStatus(input: {
  execution: CommercialCapabilityExecutionProjection | null;
  selectionFactId: string | null;
  destinationFactId: string | null;
}): { status: "fresh" | "stale" | "retryable_failure" | "failed" | "absent"; evidence: CommercialEvidenceRef[]; staleReason?: string } {
  if (!input.execution) return { status: "absent", evidence: [] };
  const payload = input.execution.responseSummaryJson ?? {};
  const selectionFactId = typeof payload.selectionFactId === "string" ? payload.selectionFactId : null;
  const destinationFactId = typeof payload.destinationFactId === "string" ? payload.destinationFactId : null;

  if (input.execution.executionStatus === "completed" && payload.status === "available" && selectionFactId && destinationFactId) {
    if (selectionFactId !== input.selectionFactId) {
      return { status: "stale", evidence: [capabilityEvidence(input.execution, true, "selection_changed")], staleReason: "selection_changed" };
    }
    if (destinationFactId !== input.destinationFactId) {
      return { status: "stale", evidence: [capabilityEvidence(input.execution, true, "destination_changed")], staleReason: "destination_changed" };
    }
    return { status: "fresh", evidence: [capabilityEvidence(input.execution)] };
  }

  if (input.execution.retryable || input.execution.executionStatus === "temporarily_blocked") {
    return { status: "retryable_failure", evidence: [capabilityEvidence(input.execution, false, input.execution.errorCode ?? undefined)] };
  }
  if (input.execution.executionStatus === "failed") return { status: "failed", evidence: [capabilityEvidence(input.execution, false, input.execution.errorCode ?? undefined)] };
  return { status: "absent", evidence: [capabilityEvidence(input.execution)] };
}

function destinationMatches(input: CommercialWorkProjectionInput, objective: CommercialObjective): boolean {
  const destination = input.shippingDestination;
  if (!destination) return false;
  const expectedCommuneId = objective.inputs.communeId;
  if (typeof expectedCommuneId === "number") return destination.communeId === expectedCommuneId;
  const expectedName = objective.inputs.canonicalDestinationName ?? objective.inputs.destinationText;
  if (expectedName) return normalizeText(destination.canonicalName) === normalizeText(expectedName);
  return true;
}

/**
 * SALES-AGENT-R2-A10, Part 12/13. True only for a CARRIED objective (same
 * objectiveId, never a fresh/superseding one - a genuinely new semantic seed
 * never carries a status) whose last known real status was WAITING_CUSTOMER.
 * A carried objective's inputs are copied verbatim by
 * reconciliation.ts#objectiveSeedFromPersisted, so "still WAITING_CUSTOMER"
 * here means no new same-family customer input has arrived since - the
 * structural-presence checks below (items.length, destinationText, a
 * selectionFactId) cannot tell "never attempted" apart from "already
 * attempted, capability explicitly asked the customer for more" on their
 * own, since both look identical structurally. Reused across every branch
 * below that would otherwise fall through to READY on structural presence
 * alone.
 */
function stillWaitingOnCustomer(carriedStatus: CommercialObjectiveStatus | undefined): boolean {
  return carriedStatus === "WAITING_CUSTOMER";
}

/**
 * SALES-AGENT-R2-ID-R2-A11. Extracted, unchanged in behavior, from the
 * SELECT_PRODUCTS/CHANGE_QUANTITY case below (Part 2/3 of A11.1's own
 * needsSearch/resolution logic) so REPEAT_PURCHASE can reuse the exact same
 * catalog-resolution/ambiguity/not-found/technical-failure state machine
 * once purchase history resolves a productReference - never a second,
 * parallel implementation of "resolve a free-text product reference against
 * the real catalog".
 */
function resolveProductSelectionState(objective: CommercialObjective, input: CommercialWorkProjectionInput, carriedStatus: CommercialObjectiveStatus | undefined) {
  const requestedItems = objective.inputs.items;
      if (requestedItems && input.commercialLineItems && sameItems(requestedItems, input.commercialLineItems.items)) {
        objective.status = "COMPLETED";
        objective.resolvedInputs.commercialLineItemsFactId = input.commercialLineItems.factId;
        objective.evidence.push(...requestFactEvidence("commercial_line_items", input.commercialLineItems.factId));
        return;
      }
      if (!requestedItems || requestedItems.length === 0) {
        if (!objective.inputs.productReference) {
          objective.status = "WAITING_CUSTOMER";
          objective.missingRequirements.push("PRODUCT");
          objective.blockers.push(blocker("MISSING_PRODUCT", "objective", objective.objectiveId));
          return;
        }
        if (typeof objective.inputs.quantity !== "number") {
          objective.status = "WAITING_CUSTOMER";
          objective.missingRequirements.push("QUANTITY");
          objective.blockers.push(blocker("MISSING_QUANTITY", "objective", objective.objectiveId));
          return;
        }
        // SALES-AGENT-R2-A11.1, Part 2/3. A productReference with no
        // resolved items is not automatically a customer question anymore -
        // it is a SYSTEM-OWNED gap first: has search_products actually been
        // asked about THIS reference yet? Only a REAL search outcome (0/1/N
        // candidates, or a technical failure) may turn this into
        // WAITING_CUSTOMER/WAITING_SYSTEM/FAILED - "never searched" always
        // becomes READY so deriveCommercialWorkSteps.ts can derive and run a
        // SEARCH_PRODUCTS step. This replaces the old
        // productEvidenceAvailable-based short-circuit, which conflated
        // "the system never looked" with "the customer must clarify" - see
        // docs/releases/SALES-AGENT-R2-A11.1-*.md, Part 1/2 for the root
        // cause this fixes (WA01 live bug).
        // R2-07 (SALES-AGENT-R2-A07.5 architecture corpus): the semantic
        // layer's own requirementResolver.ts may already carry real
        // candidates from RecentCatalogContext (a search already done this
        // conversation, via the legacy loop) - semanticIntentAdapter.ts
        // attaches these as productCandidates. That is real evidence too;
        // asking search_products again would be a redundant network call
        // for information already in hand.
        if (objective.inputs.productCandidates?.length) {
          objective.status = "WAITING_CUSTOMER";
          objective.missingRequirements.push("PRODUCT_AMBIGUOUS");
          objective.blockers.push(blocker("PRODUCT_AMBIGUOUS", "objective", objective.objectiveId), blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
          return;
        }
        const searchExecution = latestSearchProductsExecution(input.recentCapabilityExecutions, objective.inputs.productReference);
        if (!searchExecution) {
          objective.status = "READY";
          return;
        }
        if (searchExecution.executionStatus === "completed") {
          const parsed = parseProductIntentResolution(searchExecution.responseSummaryJson?.productIntent);
          objective.evidence.push(capabilityEvidence(searchExecution));
          if (!parsed) {
            // T12 always returns a well-formed resolution for a "completed"
            // execution (Part 12/13: no_match/clarification_required are
            // business outcomes, never technical failures) - an
            // unrecognizable payload here means a real contract violation,
            // not a customer question. System-owned, never WAITING_CUSTOMER.
            objective.status = "FAILED";
            return;
          }
          if (parsed.resolution.status === "resolved") {
            const match = parsed.resolution.sourceProduct;
            objective.inputs = { ...objective.inputs, items: [{ productId: match.productId, combinationId: match.combinationId ?? null, quantity: objective.inputs.quantity }] };
            objective.status = "READY";
            return;
          }
          if (parsed.resolution.status === "clarification_required") {
            objective.status = "WAITING_CUSTOMER";
            objective.missingRequirements.push("PRODUCT_AMBIGUOUS");
            objective.inputs = { ...objective.inputs, productCandidates: parsed.candidates.slice(0, 5) };
            objective.blockers.push(blocker("PRODUCT_AMBIGUOUS", "objective", objective.objectiveId), blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
            return;
          }
          objective.status = "WAITING_CUSTOMER";
          objective.missingRequirements.push("PRODUCT_NOT_FOUND");
          objective.blockers.push(blocker("PRODUCT_NOT_FOUND", "objective", objective.objectiveId), blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
          return;
        }
        // Technical failure (catalog unavailable, invalid_arguments, etc.) -
        // system-owned, never WAITING_CUSTOMER (Part 3/12: catalog failure is
        // never treated as a customer question).
        objective.evidence.push(capabilityEvidence(searchExecution, false, searchExecution.errorCode ?? undefined));
        if (searchExecution.retryable) {
          objective.status = "WAITING_SYSTEM";
          objective.blockers.push(blocker("WAITING_SYSTEM", "objective", objective.objectiveId));
          return;
        }
        objective.status = "FAILED";
        return;
      }
      // A10 Part 12/13: items (and quantity/evidence) are structurally
      // present - normally READY - but if this exact carried objective was
      // already WAITING_CUSTOMER (the capability itself rejected these same
      // items as missing_information last round), structural presence alone
      // is not new evidence. Stay WAITING_CUSTOMER until a genuinely new
      // same-family customer input supersedes this objective instead.
      if (stillWaitingOnCustomer(carriedStatus)) {
        objective.status = "WAITING_CUSTOMER";
        objective.blockers.push(blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
        return;
      }
      objective.status = "READY";
}

type PurchaseHistoryProduct = { historicalName: string; historicalProductId?: string; quantity?: number; lastPurchasedAt?: string };

/**
 * SALES-AGENT-R2-ID-R2-A11. Defensive parse of get_customer_purchase_history's
 * own minimized response (getCustomerPurchaseHistoryCapability.ts's
 * RepeatPurchaseHistoryResult) - mirrors parseProductIntentResolution's
 * discipline: an unrecognizable payload is a real contract violation
 * (system-owned FAILED), never guessed into a customer question.
 */
function parsePurchaseHistoryResult(raw: unknown): { status: "AVAILABLE" | "NO_PURCHASE_HISTORY"; previousProducts: PurchaseHistoryProduct[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const status = record.status;
  if (status !== "AVAILABLE" && status !== "NO_PURCHASE_HISTORY") return null;
  const rawProducts = Array.isArray(record.previousProducts) ? record.previousProducts : [];
  const previousProducts: PurchaseHistoryProduct[] = [];
  for (const entry of rawProducts) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const historicalName = typeof item.historicalName === "string" ? item.historicalName : null;
    if (!historicalName) continue;
    const historicalProductId = typeof item.historicalProductId === "string" ? item.historicalProductId : undefined;
    const quantity = typeof item.quantity === "number" && Number.isSafeInteger(item.quantity) && item.quantity > 0 ? item.quantity : undefined;
    const lastPurchasedAt = typeof item.lastPurchasedAt === "string" ? item.lastPurchasedAt : undefined;
    previousProducts.push({ historicalName, ...(historicalProductId ? { historicalProductId } : {}), ...(quantity !== undefined ? { quantity } : {}), ...(lastPurchasedAt ? { lastPurchasedAt } : {}) });
  }
  return { status, previousProducts };
}

/**
 * SALES-AGENT-R2-ID-R2-A11. Only ever consulted for get_customer_purchase_history
 * - unlike search_products (matched by query text, since the same customer
 * turn can search different queries) or calculate_shipping (matched by
 * freshness against selection/destination facts), a purchase-history lookup
 * takes no variable input at all: "this customer's history" never changes
 * within one objective's lifecycle, so the single most recent execution of
 * this capability is always the right one - same simple pattern
 * latestCalculateShippingExecution already uses.
 */
function latestPurchaseHistoryExecution(executions: readonly CommercialCapabilityExecutionProjection[] | undefined): CommercialCapabilityExecutionProjection | null {
  const candidates = (executions ?? []).filter((execution) => execution.capabilityName === "get_customer_purchase_history");
  return candidates.sort((a, b) => {
    const left = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const right = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return right - left;
  })[0] ?? null;
}

/** Simple normalized substring match, same discipline as requirementResolver.ts's matchProductReference - never a fuzzy/semantic match this codebase does not already rely on elsewhere. */
function filterPurchaseHistoryByHint(products: readonly PurchaseHistoryProduct[], hint: string): PurchaseHistoryProduct[] {
  const normalizedHint = normalizeText(hint);
  if (!normalizedHint) return [...products];
  const matches = products.filter((product) => normalizeText(product.historicalName).includes(normalizedHint));
  return matches.length > 0 ? matches : [...products];
}

/**
 * SALES-AGENT-R2-ID-R2-A11. PARTE PRINCIPIO CENTRAL: this function only ever
 * turns purchase history into a productReference (a HISTORICAL FACT) - it
 * never assumes that reference is still sellable. Once resolved, control
 * passes to resolveProductSelectionState, the exact same catalog-resolution
 * chain a fresh product request already uses, so a discontinued/renamed
 * historical product is re-validated against the live catalog exactly like
 * any other product reference, never trusted on its own (PARTE 9/10).
 */
function applyRepeatPurchaseObjectiveState(objective: CommercialObjective, input: CommercialWorkProjectionInput, carriedStatus: CommercialObjectiveStatus | undefined) {
  // A prior round already resolved history into a productReference (or the
  // shared resolver already resolved catalog items) - defer entirely to the
  // shared chain, never re-run history resolution once a reference exists.
  if (objective.inputs.productReference || objective.inputs.items?.length) {
    resolveProductSelectionState(objective, input, carriedStatus);
    return;
  }

  const historyExecution = latestPurchaseHistoryExecution(input.recentCapabilityExecutions);
  if (!historyExecution) {
    // Never searched yet this objective - READY so deriveCommercialWorkSteps.ts
    // derives a LOAD_PURCHASE_HISTORY step, same discipline as the
    // SELECT_PRODUCTS needsSearch branch above for search_products.
    objective.status = "READY";
    return;
  }

  if (historyExecution.executionStatus !== "completed") {
    // Technical failure (Customer Profile unavailable, etc.) - system-owned,
    // never WAITING_CUSTOMER (PARTE 14: identity stays LEVEL_3, this is a
    // profile-service failure, not an identity failure).
    objective.evidence.push(capabilityEvidence(historyExecution, false, historyExecution.errorCode ?? undefined));
    if (historyExecution.retryable) {
      objective.status = "WAITING_SYSTEM";
      objective.blockers.push(blocker("WAITING_SYSTEM", "objective", objective.objectiveId));
      return;
    }
    objective.status = "FAILED";
    return;
  }

  objective.evidence.push(capabilityEvidence(historyExecution));
  const parsed = parsePurchaseHistoryResult(historyExecution.responseSummaryJson);
  if (!parsed) {
    // A completed execution with an unrecognizable payload is a real
    // contract violation, not a customer question (same discipline as
    // parseProductIntentResolution's own unrecognizable-payload branch).
    objective.status = "FAILED";
    return;
  }

  // PARTE 13: LEVEL_3 valid + Customer Profile AVAILABLE + no history is a
  // terminal, successful "nothing to repeat" outcome - COMPLETED, never
  // WAITING_CUSTOMER, never re-triggered onboarding. The finalizer
  // distinguishes this from a real completed selection by items being empty.
  if (parsed.previousProducts.length === 0) {
    objective.status = "COMPLETED";
    return;
  }

  const candidates = objective.inputs.productHint ? filterPurchaseHistoryByHint(parsed.previousProducts, objective.inputs.productHint) : parsed.previousProducts;

  if (candidates.length === 1) {
    const match = candidates[0];
    objective.inputs = { ...objective.inputs, productReference: match.historicalName, quantity: objective.inputs.quantity ?? match.quantity };
    resolveProductSelectionState(objective, input, carriedStatus);
    return;
  }

  // PARTE 8/9: 2+ distinct previous purchases remain - never choose
  // arbitrarily. Asks a grounded question; resolution relies on supersession
  // (the customer naming one product becomes an ordinary select_products
  // intent/objective, which supersedes this one via the shared "selection"
  // family - see deriveCommercialObjectives.ts), never a bespoke
  // disambiguation-reply parser.
  objective.status = "WAITING_CUSTOMER";
  objective.missingRequirements.push("REPEAT_PURCHASE_AMBIGUOUS");
  objective.inputs = { ...objective.inputs, historicalPurchaseCandidates: candidates.slice(0, 5) };
  objective.blockers.push(blocker("REPEAT_PURCHASE_AMBIGUOUS", "objective", objective.objectiveId), blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
}

function applyObjectiveState(objective: CommercialObjective, input: CommercialWorkProjectionInput, carriedStatus?: CommercialObjectiveStatus) {
  if (objective.status === "CANCELLED" || objective.status === "SUPERSEDED") return;

  switch (objective.type) {
    case "DISCOVER_PRODUCTS":
    case "COMPARE_PRODUCTS":
    case "RECOMMEND_PRODUCTS":
      objective.status = "READY";
      break;
    case "SELECT_PRODUCTS":
    case "CHANGE_QUANTITY":
      resolveProductSelectionState(objective, input, carriedStatus);
      break;
    case "REPEAT_PURCHASE":
      applyRepeatPurchaseObjectiveState(objective, input, carriedStatus);
      break;
    case "SET_DESTINATION":
      if (destinationMatches(input, objective)) {
        objective.status = "COMPLETED";
        objective.resolvedInputs.shippingDestinationFactId = input.shippingDestination?.factId;
        objective.evidence.push(...requestFactEvidence("shipping_destination", input.shippingDestination?.factId));
      } else if (objective.inputs.destinationText || objective.inputs.canonicalDestinationName || typeof objective.inputs.communeId === "number") {
        // Same rationale as SELECT_PRODUCTS/CHANGE_QUANTITY above.
        if (stillWaitingOnCustomer(carriedStatus)) {
          objective.status = "WAITING_CUSTOMER";
          objective.blockers.push(blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
          return;
        }
        objective.status = "READY";
      } else {
        objective.status = "WAITING_CUSTOMER";
        objective.missingRequirements.push("DESTINATION");
        objective.blockers.push(blocker("MISSING_DESTINATION", "objective", objective.objectiveId), blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
      }
      break;
    case "GET_SHIPPING_QUOTE": {
      const selectionFactId = input.commercialLineItems?.factId ?? null;
      const destinationFactId = input.shippingDestination?.factId ?? null;
      if (!selectionFactId) {
        objective.status = "BLOCKED";
        objective.missingRequirements.push("SELECTION");
        objective.blockers.push(blocker("MISSING_SELECTION", "objective", objective.objectiveId));
        return;
      }
      objective.resolvedInputs.commercialLineItemsFactId = selectionFactId;
      if (!destinationFactId) {
        objective.missingRequirements.push("DESTINATION");
        if (objective.inputs.destinationText || objective.inputs.canonicalDestinationName || typeof objective.inputs.communeId === "number") {
          objective.status = "BLOCKED";
          objective.blockers.push(blocker("MISSING_DESTINATION", "objective", objective.objectiveId));
        } else {
          objective.status = "WAITING_CUSTOMER";
          objective.blockers.push(blocker("MISSING_DESTINATION", "objective", objective.objectiveId), blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
        }
        return;
      }
      objective.resolvedInputs.shippingDestinationFactId = destinationFactId;
      const shipping = executionAnchorStatus({
        execution: latestCalculateShippingExecution(input.recentCapabilityExecutions),
        selectionFactId,
        destinationFactId
      });
      objective.evidence.push(...shipping.evidence);
      if (shipping.status === "fresh") {
        objective.status = "COMPLETED";
        objective.resolvedInputs.shippingCalculationExecutionId = String(shipping.evidence[0]?.id ?? "");
      } else if (shipping.status === "retryable_failure") {
        objective.status = "WAITING_SYSTEM";
        objective.blockers.push(blocker("WAITING_SYSTEM", "objective", objective.objectiveId));
      } else if (shipping.status === "failed") {
        objective.status = "FAILED";
      } else {
        if (shipping.status === "stale") objective.blockers.push(blocker("STALE_EVIDENCE", "objective", objective.objectiveId));
        objective.status = "READY";
      }
      break;
    }
    case "SELECT_SHIPPING_OPTION": {
      if (input.selectedShippingOption && input.commercialLineItems && input.shippingDestination && input.selectedShippingOption.selectionFactId === input.commercialLineItems.factId && input.selectedShippingOption.destinationFactId === input.shippingDestination.factId) {
        objective.status = "COMPLETED";
        objective.resolvedInputs.selectedShippingOptionFactId = input.selectedShippingOption.factId;
        objective.evidence.push(...requestFactEvidence("selected_shipping_option", input.selectedShippingOption.factId));
        break;
      }

      const selectionFactId = input.commercialLineItems?.factId ?? null;
      const destinationFactId = input.shippingDestination?.factId ?? null;
      if (!selectionFactId) {
        objective.status = "BLOCKED";
        objective.missingRequirements.push("SELECTION");
        objective.blockers.push(blocker("MISSING_SELECTION", "objective", objective.objectiveId));
        break;
      }
      if (!destinationFactId) {
        objective.status = "BLOCKED";
        objective.missingRequirements.push("DESTINATION");
        objective.blockers.push(blocker("MISSING_DESTINATION", "objective", objective.objectiveId));
        break;
      }

      const shippingExecution = latestCalculateShippingExecution(input.recentCapabilityExecutions);
      const shipping = executionAnchorStatus({ execution: shippingExecution, selectionFactId, destinationFactId });

      if (shipping.status === "fresh") {
        objective.evidence.push(...shipping.evidence);
        const candidates = parseShippingOptionCandidates(shippingExecution);
        const match = matchShippingOptionReference(objective.inputs.optionReference, candidates);
        if (match.status === "resolved") {
          // SALES-AGENT-R2-A11.4. A position-based reference ("la segunda")
          // only means something relative to the exact list the customer was
          // looking at - if this fresh evidence is the direct result of a
          // recalculation that just ran (carriedStatus was BLOCKED, which
          // MISSING_SHIPPING below is the only thing that sets), the same
          // index in the NEW list may be a different real option than the
          // one the customer meant. Never auto-select in that case - ask
          // again against the refreshed list. Carrier/cheapest references
          // resolve by what the option IS, so they stay safe either way.
          if (match.matchKind === "position" && carriedStatus === "BLOCKED") {
            objective.status = "WAITING_CUSTOMER";
            objective.missingRequirements.push("SHIPPING_OPTION_RECALCULATED");
            objective.inputs.shippingOptionCandidates = candidates;
            objective.blockers.push(blocker("SHIPPING_OPTION_RECALCULATED", "objective", objective.objectiveId), blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
          } else {
            objective.status = "READY";
            objective.inputs.optionIndex = match.index;
            objective.resolvedInputs.shippingCalculationExecutionId = String(shippingExecution?.publicId ?? "");
          }
        } else if (match.status === "ambiguous") {
          objective.status = "WAITING_CUSTOMER";
          objective.missingRequirements.push("SHIPPING_OPTION_AMBIGUOUS");
          objective.inputs.shippingOptionCandidates = match.candidates;
          objective.blockers.push(blocker("SHIPPING_OPTION_AMBIGUOUS", "objective", objective.objectiveId), blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
        } else {
          objective.status = "WAITING_CUSTOMER";
          objective.missingRequirements.push("SHIPPING_OPTION_NOT_FOUND");
          objective.blockers.push(blocker("SHIPPING_OPTION_NOT_FOUND", "objective", objective.objectiveId), blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
        }
      } else if (shipping.status === "retryable_failure") {
        objective.status = "WAITING_SYSTEM";
        objective.evidence.push(...shipping.evidence);
        objective.blockers.push(blocker("WAITING_SYSTEM", "objective", objective.objectiveId));
      } else if (shipping.status === "failed") {
        objective.status = "FAILED";
        objective.evidence.push(...shipping.evidence);
      } else {
        // stale or absent (no calculate_shipping execution matches current
        // facts yet) - needs a fresh calculation. deriveCommercialWorkSteps.ts
        // reads this exact BLOCKED+MISSING_SHIPPING combination to derive a
        // CALCULATE_SHIPPING step ahead of this one, mirroring SELECT_PRODUCTS'
        // needsSearch chain - never a dead end, the next reprojection round
        // re-evaluates this same objective against the fresh result.
        objective.status = "BLOCKED";
        objective.missingRequirements.push("SHIPPING");
        objective.blockers.push(blocker("MISSING_SHIPPING", "objective", objective.objectiveId));
      }
      break;
    }
    case "CREATE_QUOTE": {
      const selectionFactId = input.commercialLineItems?.factId ?? null;
      if (!selectionFactId) {
        objective.status = "BLOCKED";
        objective.missingRequirements.push("SELECTION");
        objective.blockers.push(blocker("MISSING_SELECTION", "objective", objective.objectiveId));
        return;
      }
      objective.resolvedInputs.commercialLineItemsFactId = selectionFactId;
      if (input.createdQuote && input.createdQuote.selectionFactId === selectionFactId) {
        objective.status = "COMPLETED";
        objective.resolvedInputs.createdQuoteFactId = input.createdQuote.factId;
        objective.evidence.push(...requestFactEvidence("created_quote", input.createdQuote.factId));
      } else {
        if (input.createdQuote && input.createdQuote.selectionFactId !== selectionFactId) {
          objective.evidence.push({ kind: "request_fact", factType: "created_quote", id: input.createdQuote.factId, stale: true, reason: "selection_changed" });
          objective.blockers.push(blocker("STALE_EVIDENCE", "objective", objective.objectiveId));
        } else if (stillWaitingOnCustomer(carriedStatus)) {
          // Same rationale as SELECT_PRODUCTS/CHANGE_QUANTITY/SET_DESTINATION
          // above: selection is present but no created_quote fact landed -
          // if that is because create_quote itself already asked the
          // customer for more information, do not silently retry it.
          objective.status = "WAITING_CUSTOMER";
          objective.blockers.push(blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
          break;
        }
        objective.status = "READY";
      }
      break;
    }
    case "HANDOFF":
      objective.status = "COMPLETED";
      objective.evidence.push({ kind: "conversation_state", status: "handoff" });
      break;
  }
}

function applyConversationAutonomy(input: CommercialWorkProjectionInput, objectives: CommercialObjective[]): CommercialWorkBlocker[] {
  const blockers: CommercialWorkBlocker[] = [];
  if (input.conversation.humanOwnerActive) blockers.push({ code: "HUMAN_OWNER_ACTIVE", source: "conversation", evidence: [{ kind: "conversation_state", id: input.conversation.id, status: "human_owner_active" }] });
  if (!input.conversation.aiEnabled) blockers.push({ code: "AI_DISABLED", source: "conversation", evidence: [{ kind: "conversation_state", id: input.conversation.id, status: "ai_disabled" }] });
  if (blockers.length === 0) return blockers;

  for (const objective of objectives) {
    if (objective.status !== "COMPLETED" && objective.status !== "CANCELLED" && objective.status !== "SUPERSEDED") {
      objective.status = "BLOCKED";
      objective.blockers.push(...blockers.map((item) => ({ ...item, source: "objective" as const, objectiveId: objective.objectiveId })));
    }
  }
  return blockers;
}

function applyPendingMutationInvalidations(objectives: CommercialObjective[]) {
  const pendingSelectionMutation = objectives.some(
    (objective) =>
      (objective.type === "SELECT_PRODUCTS" || objective.type === "CHANGE_QUANTITY") &&
      (objective.status === "READY" || objective.status === "WAITING_CUSTOMER" || objective.status === "BLOCKED")
  );
  const pendingDestinationMutation = objectives.some(
    (objective) =>
      objective.type === "SET_DESTINATION" &&
      (objective.status === "READY" || objective.status === "WAITING_CUSTOMER" || objective.status === "BLOCKED")
  );

  if (!pendingSelectionMutation && !pendingDestinationMutation) return;

  for (const objective of objectives) {
    if (objective.type !== "GET_SHIPPING_QUOTE" || objective.status === "CANCELLED" || objective.status === "SUPERSEDED") continue;
    if (pendingSelectionMutation) {
      objective.status = "BLOCKED";
      if (!objective.missingRequirements.includes("SELECTION")) objective.missingRequirements.push("SELECTION");
      objective.blockers.push({ code: "STALE_EVIDENCE", source: "objective", objectiveId: objective.objectiveId });
      objective.blockers.push({ code: "MISSING_SELECTION", source: "objective", objectiveId: objective.objectiveId });
    } else if (pendingDestinationMutation) {
      objective.status = "BLOCKED";
      if (!objective.missingRequirements.includes("DESTINATION")) objective.missingRequirements.push("DESTINATION");
      objective.blockers.push({ code: "STALE_EVIDENCE", source: "objective", objectiveId: objective.objectiveId });
      objective.blockers.push({ code: "MISSING_DESTINATION", source: "objective", objectiveId: objective.objectiveId });
    }
  }
}

function sequenceFromTrigger(trigger: CommercialWorkProjectionInput["trigger"]): number | null {
  const commercialSequence = "commercialSequence" in trigger ? trigger.commercialSequence : null;
  if (typeof commercialSequence === "number" && Number.isSafeInteger(commercialSequence) && commercialSequence > 0) return commercialSequence;
  if (trigger.type === "CUSTOMER_MESSAGE" && typeof trigger.sourceMessageSequence === "number" && Number.isSafeInteger(trigger.sourceMessageSequence) && trigger.sourceMessageSequence > 0) {
    return trigger.sourceMessageSequence;
  }
  return null;
}

export function buildCommercialWorkProjection(input: CommercialWorkProjectionInput): CommercialWork {
  const derivedAt = toIso(input.now);
  const sourceMessageId = input.trigger.type === "CUSTOMER_MESSAGE" ? input.trigger.sourceMessageId : null;
  const sourceSequence = sequenceFromTrigger(input.trigger);
  const opportunityId = input.opportunity?.id ?? (input.trigger.type === "CUSTOMER_MESSAGE" ? input.trigger.opportunityId : null);
  const id = `projection:${input.conversation.id}:${sourceMessageId ?? "no-message"}`;
  const objectives = deriveCommercialObjectives({
    seeds: input.objectiveSeeds ?? [],
    pendingCommercialIntents: input.pendingCommercialIntents,
    seedIdPrefix: id
  });

  const carriedStatuses = carriedObjectiveStatusById(input.objectiveSeeds ?? []);
  for (const objective of objectives) applyObjectiveState(objective, input, carriedStatuses.get(objective.objectiveId));
  // SALES-AGENT-R2-ID-R2-A07. Runs after every objective's structural
  // readiness is decided, before conversation-autonomy's own override pass -
  // an identity-insufficient operation never reaches READY, but a human
  // owner/AI-disabled block still takes precedence over it below, same as it
  // already does over every other blocker in this file.
  applyCommercialIdentityGate(objectives, input.runtimeIdentity);
  applyPendingMutationInvalidations(objectives);
  const conversationBlockers = applyConversationAutonomy(input, objectives);
  const steps = deriveCommercialWorkSteps(objectives);
  if (conversationBlockers.length > 0) {
    for (const step of steps) {
      if (step.status !== "COMPLETED" && step.status !== "CANCELLED" && step.status !== "SUPERSEDED") {
        step.status = "BLOCKED";
        step.blockers.push(...conversationBlockers.map((item) => ({ ...item, source: "step" as const, stepId: step.stepId })));
      }
    }
  }

  const partial = { objectives, steps };
  const blockers = collectCommercialWorkBlockers(partial, conversationBlockers);
  const status = deriveCommercialWorkStatus({ objectives, steps, blockers });
  const workWithoutMetrics = {
    id,
    projectionVersion: 1 as const,
    opportunityId,
    conversationId: input.conversation.id,
    sourceMessageId,
    sourceSequence,
    lastReconciledSequence: sourceSequence,
    previousWorkPublicId: null,
    supersedesWorkPublicId: null,
    trigger: input.trigger,
    status,
    objectives,
    steps,
    blockers,
    derivedAt,
    metrics: { objectiveCount: 0, readyStepCount: 0, waitingCustomerObjectiveCount: 0, waitingSystemStepCount: 0, blockerCount: 0 }
  };
  return { ...workWithoutMetrics, metrics: deriveCommercialWorkMetrics(workWithoutMetrics) };
}

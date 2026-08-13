import type { RecentCatalogContext } from "../agent-loop/recentCatalogContext";
import type { CommercialIntent, RequirementResolution, ResolvedIntent, ResolvedIntentStatus, ResolvedProductCandidate } from "./types";

/**
 * LLM-R1-T09A, Part 4/5/6 (CommercialRequirementResolver). Deterministic, no
 * LLM call - resolves each intent's requirements strictly from already-loaded
 * sources (CommercialContextSnapshot's own reduced summary + RecentCatalogContext),
 * never re-derived from free text and never invented. Part 5's fixed,
 * ordered sources per requirement:
 *
 *   PRODUCT:      1. RecentCatalogContext (fuzzy name match on productReference)
 *                 2. durable commercialLineItems, only when productReference is
 *                    absent and exactly one durable item exists (an implicit
 *                    "it"/"the" reference to the customer's one active selection)
 *                 3. unresolved
 *   QUANTITY:     1. intent explicit (never inferred/defaulted)
 *                 2. unresolved
 *   DESTINATION:  1. intent explicit (free text, resolved to a real commune only
 *                    later, by set_shipping_destination itself)
 *                 2. durable shippingDestination
 *                 3. unresolved
 *   PRODUCT_SELECTION (get_shipping_quote only):
 *                 1. a same-turn select_products intent that itself resolves "ready"
 *                 2. durable commercialLineItems (non-empty)
 *                 3. unresolved
 *
 * No Customer Identity / Email / Address resolution exists here (Part 5:
 * "dejar explicitamente fuera de ejecucion") - those requirement types are
 * declared in types.ts for future intents only.
 */

export type RequirementResolverContext = {
  /** The same reduced, sanitized summary runAgentToolLoop.ts's caller builds (buildCommercialContextSummary) - read-only, never mutated. */
  commercialContextSummary: Record<string, unknown>;
  recentCatalogContext: RecentCatalogContext | null;
};

/** Bare deictic/pronoun references the planner should have already resolved into a real product name - if one reaches here unresolved, treat PRODUCT as missing rather than guessing which product "it" means. */
const UNRESOLVED_PRODUCT_REFERENCE_WORDS = new Set([
  "esa", "ese", "eso", "esta", "este", "esto", "aquella", "aquel", "aquello",
  "ella", "el", "la", "lo", "la anterior", "el anterior", "la misma", "el mismo"
]);

const MIN_PRODUCT_REFERENCE_LENGTH = 3;
const MAX_AMBIGUOUS_CANDIDATES = 5;

/**
 * LLM-R1-T09B (real bug found live during the WhatsApp smoke - WA01: the
 * planner returned productReference "la classic" for the customer message
 * "quiero 2 de la classic"; neither "la classic" nor "barra olimpica classic
 * 20kg" is a substring of the other, so the previously pure-substring match
 * missed a real, unambiguous product). The planner is instructed to name the
 * product "as specifically as the customer did" (buildIntentPlannerPromptPackage.ts),
 * which correctly and often includes the customer's own leading Spanish
 * article - relying on prompt compliance alone to never include one would be
 * probabilistic, not deterministic. Stripped as whole leading words only
 * (never mid-string, so a real product literally named e.g. "La Roca" is
 * never mangled) before the fuzzy match below.
 */
const LEADING_FILLER_WORDS = new Set(["la", "el", "los", "las", "un", "una", "unos", "unas", "de", "del"]);

function stripLeadingFillerWords(normalized: string): string {
  const words = normalized.split(/\s+/).filter(Boolean);
  while (words.length > 1 && LEADING_FILLER_WORDS.has(words[0])) words.shift();
  return words.join(" ");
}

/** Diacritic combining marks (Unicode block 0x0300-0x036F) stripped by code point, not by regex literal, to keep this ASCII-only source file free of embedded combining characters. */
const COMBINING_MARK_RANGE_START = 0x0300;
const COMBINING_MARK_RANGE_END = 0x036f;

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code < COMBINING_MARK_RANGE_START || code > COMBINING_MARK_RANGE_END;
    })
    .join("")
    .toLowerCase()
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * LLM-R1-T09B (real bug found live during the WhatsApp smoke - WA03/WA05:
 * the Catalog Service's search results carry combinationId 0 for a product
 * with no specific variant selected, PrestaShop's own "no combination"
 * sentinel - see environment.ts's searchItemPayload/BENCHMARK products). "0"
 * is a non-empty, truthy string, so it was being carried forward as if it
 * were a real, specific variant id - persisted into commercial_line_items,
 * then sent back to the Catalog Service's batch endpoint on calculate_shipping,
 * where it does not round-trip identically and calculateShippingCapability.ts's
 * own defensive "this should be unreachable" mismatch guard fired for real.
 * Normalized once here, the single place catalog evidence turns into a
 * ResolvedProductCandidate - every downstream consumer (matching, the
 * resolved PRODUCT value, the select_products arguments the executor builds)
 * never sees a "0" combinationId again.
 */
function normalizeCombinationId(value: string | null | undefined): string | undefined {
  return value && value !== "0" ? value : undefined;
}

function collectCatalogCandidates(recentCatalogContext: RecentCatalogContext | null): ResolvedProductCandidate[] {
  const candidates: ResolvedProductCandidate[] = [];
  const seen = new Set<string>();
  for (const interaction of recentCatalogContext?.interactions ?? []) {
    for (const product of interaction.products) {
      const combinationId = normalizeCombinationId(product.combinationId);
      const key = `${product.productId}:${combinationId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ productId: product.productId, ...(combinationId ? { combinationId } : {}), name: product.name });
    }
  }
  return candidates;
}

function matchProductReference(reference: string, candidates: ResolvedProductCandidate[]): ResolvedProductCandidate[] {
  const normalizedRef = normalizeText(reference);
  if (normalizedRef.length < MIN_PRODUCT_REFERENCE_LENGTH || UNRESOLVED_PRODUCT_REFERENCE_WORDS.has(normalizedRef)) return [];
  const strippedRef = stripLeadingFillerWords(normalizedRef);
  if (strippedRef.length < MIN_PRODUCT_REFERENCE_LENGTH) return [];
  return candidates.filter((candidate) => {
    const normalizedName = normalizeText(candidate.name);
    return normalizedName.includes(strippedRef) || strippedRef.includes(normalizedName);
  });
}

/** Exported so runCommercialMultiIntentLoop.ts can build the planner prompt's durableState hints from the same reader, never a second, drifted copy. */
export function readDurableCommercialLineItems(commercialContextSummary: Record<string, unknown>): Array<{ productId: string; combinationId: string | null; quantity: number }> {
  const raw = commercialContextSummary.commercialLineItems;
  if (!isRecord(raw) || !Array.isArray(raw.items)) return [];
  return raw.items.filter(
    (item): item is { productId: string; combinationId: string | null; quantity: number } =>
      isRecord(item) && typeof item.productId === "string" && typeof item.quantity === "number"
  );
}

/** Exported so runCommercialMultiIntentLoop.ts can build the planner prompt's durableState hints from the same reader, never a second, drifted copy. */
export function readDurableShippingDestination(commercialContextSummary: Record<string, unknown>): { communeId: number; canonicalName: string } | null {
  const raw = commercialContextSummary.shippingDestination;
  if (!isRecord(raw) || typeof raw.communeId !== "number" || typeof raw.canonicalName !== "string") return null;
  return { communeId: raw.communeId, canonicalName: raw.canonicalName };
}

function resolveProductRequirement(intent: { productReference?: string }, context: RequirementResolverContext): RequirementResolution {
  const candidates = collectCatalogCandidates(context.recentCatalogContext);

  if (intent.productReference) {
    const matches = matchProductReference(intent.productReference, candidates);
    if (matches.length === 1) return { type: "PRODUCT", status: "resolved", source: "recent_catalog_context", value: matches[0] };
    if (matches.length > 1) return { type: "PRODUCT", status: "ambiguous", candidates: matches.slice(0, MAX_AMBIGUOUS_CANDIDATES) };
    return { type: "PRODUCT", status: "missing" };
  }

  // No reference given at all: an implicit "it" only resolves when exactly one
  // durable selection exists - two or more is genuinely ambiguous which one
  // the customer means, never silently picked (Part 6).
  const durableItems = readDurableCommercialLineItems(context.commercialContextSummary);
  if (durableItems.length === 1) {
    const item = durableItems[0];
    const combinationId = normalizeCombinationId(item.combinationId);
    return {
      type: "PRODUCT",
      status: "resolved",
      source: "durable_state",
      value: { productId: item.productId, ...(combinationId ? { combinationId } : {}) }
    };
  }

  return { type: "PRODUCT", status: "missing" };
}

function resolveQuantityRequirement(intent: { quantity?: number }): RequirementResolution {
  if (intent.quantity !== undefined) return { type: "QUANTITY", status: "resolved", source: "explicit", value: intent.quantity };
  return { type: "QUANTITY", status: "missing" };
}

function resolveDestinationRequirement(intent: { destination?: string }, context: RequirementResolverContext): RequirementResolution {
  if (intent.destination) return { type: "DESTINATION", status: "resolved", source: "explicit", value: intent.destination };
  const durable = readDurableShippingDestination(context.commercialContextSummary);
  if (durable) return { type: "DESTINATION", status: "resolved", source: "durable_state", value: durable };
  return { type: "DESTINATION", status: "missing" };
}

function resolveProductSelectionRequirement(context: RequirementResolverContext, sameTurnSelectProductsReady: boolean): RequirementResolution {
  if (sameTurnSelectProductsReady) return { type: "PRODUCT_SELECTION", status: "resolved", source: "same_turn_intent", value: true };
  const durableItems = readDurableCommercialLineItems(context.commercialContextSummary);
  if (durableItems.length > 0) return { type: "PRODUCT_SELECTION", status: "resolved", source: "durable_state", value: true };
  return { type: "PRODUCT_SELECTION", status: "missing" };
}

function overallStatus(requirements: RequirementResolution[]): ResolvedIntentStatus {
  if (requirements.some((requirement) => requirement.status === "ambiguous")) return "needs_clarification";
  if (requirements.some((requirement) => requirement.status === "missing")) return "waiting_for_information";
  return "ready";
}

/**
 * Part 4/7. Resolves every intent's requirements. select_products is
 * resolved first so get_shipping_quote's PRODUCT_SELECTION requirement can
 * see whether a same-turn selection will actually be ready (Part 8's
 * dependency ordering starts here, before any capability ever runs).
 */
export function resolveCommercialIntentPlan(intents: CommercialIntent[], context: RequirementResolverContext): ResolvedIntent[] {
  const results: (ResolvedIntent | undefined)[] = new Array(intents.length);

  intents.forEach((intent, intentIndex) => {
    if (intent.type === "select_products") {
      const requirements = [resolveProductRequirement(intent, context), resolveQuantityRequirement(intent)];
      results[intentIndex] = { intentIndex, intent, requirements, status: overallStatus(requirements) };
    } else if (intent.type === "unsupported") {
      results[intentIndex] = { intentIndex, intent, requirements: [], status: "needs_clarification" };
    }
  });

  const sameTurnSelectProductsReady = intents.some(
    (intent, index) => intent.type === "select_products" && results[index]?.status === "ready"
  );

  intents.forEach((intent, intentIndex) => {
    if (intent.type === "get_shipping_quote") {
      const requirements = [resolveProductSelectionRequirement(context, sameTurnSelectProductsReady), resolveDestinationRequirement(intent, context)];
      results[intentIndex] = { intentIndex, intent, requirements, status: overallStatus(requirements) };
    }
  });

  return results as ResolvedIntent[];
}

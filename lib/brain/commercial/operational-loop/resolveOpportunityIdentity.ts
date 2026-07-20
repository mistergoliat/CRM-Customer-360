import type { BrainContextResolveResponse } from "../../context/types";
import type { CommercialContextBuilderResult, CommercialContextSourceSummary, CommercialIntent, CommercialChannelReference } from "../types";
import { COMMERCIAL_INTENTS } from "../constants";
import type { BrainNormalizedProcessInboundRequest } from "../../inbound/types";
import type { CommercialOperationalIdentityHints, CommercialOperationalLoadStateResult, CommercialOperationalOpportunityIdentityResolution, CommercialOperationalState } from "./types";
import type { CommercialOperationalLoopWarning } from "./constants";

export type CommercialOperationalIdentityResolutionInput = {
  inboundMessage: BrainNormalizedProcessInboundRequest;
  brainContext: BrainContextResolveResponse;
  commercialContext: CommercialContextBuilderResult | null;
  loadResult: CommercialOperationalLoadStateResult | null;
  currentTime: string | Date;
  correlationId: string;
  metadata?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  return null;
}

function hasCommercialSignal(sourceSummary: CommercialContextSourceSummary | null) {
  if (!sourceSummary) return false;
  return Boolean(
    sourceSummary.hasLatestCustomerMessage ||
      sourceSummary.hasLatestOutboundMessage ||
      sourceSummary.hasCustomerCandidate ||
      sourceSummary.hasCustomerReference ||
      sourceSummary.hasConversationHistory ||
      sourceSummary.hasCommercialEntity ||
      sourceSummary.orderContextAvailable ||
      sourceSummary.productServiceContextAvailable
  );
}

export function normalizeCommercialIntent(value: unknown, fallback: CommercialIntent = "unknown"): CommercialIntent {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if ((COMMERCIAL_INTENTS as readonly string[]).includes(normalized)) return normalized as CommercialIntent;
    if (normalized.includes("price") || normalized.includes("precio")) return "price_request";
    if (normalized.includes("stock") || normalized.includes("inventario")) return "stock_request";
    if (normalized.includes("quote") || normalized.includes("cotiz")) return "quote_request";
    if (normalized.includes("delivery") || normalized.includes("despach") || normalized.includes("shipping")) return "delivery_request";
    if (normalized.includes("discount") || normalized.includes("descuento")) return "discount_request";
    if (normalized.includes("bulk") || normalized.includes("wholesale")) return "bulk_purchase";
    if (normalized.includes("equipment") || normalized.includes("project")) return "equipment_project";
    if (normalized.includes("maintenance")) return "maintenance_request";
    if (normalized.includes("assembly")) return "assembly_request";
    if (normalized.includes("post") && normalized.includes("sale")) return "post_sale_request";
    if (normalized.includes("recommend")) return "product_recommendation";
    if (normalized.includes("product")) return "product_inquiry";
    if (normalized.includes("general")) return "general_information";
  }
  return fallback;
}

export function buildCommercialIdentityHints(input: {
  inboundMessage: BrainNormalizedProcessInboundRequest;
  brainContext: BrainContextResolveResponse;
  commercialContext: CommercialContextBuilderResult | null;
}): CommercialOperationalIdentityHints {
  const salesAgentInput = input.commercialContext?.salesAgentInput ?? null;
  const sourceSummary = input.commercialContext?.sourceSummary ?? null;
  const identity = salesAgentInput?.identity ?? null;
  const commercial = salesAgentInput?.commercial ?? null;

  const customerCandidate = identity?.customerCandidate ?? null;
  const customerCandidateId = isRecord(customerCandidate)
    ? asId(customerCandidate.id ?? customerCandidate.customerCandidateId ?? customerCandidate.customer_candidate_id)
    : null;
  const customerMasterId = asId(input.brainContext.customer_context?.id_customer ?? input.brainContext.customer_context?.active_case_id ?? null);
  const leadId = isRecord(commercial?.lead) ? asId((commercial.lead as Record<string, unknown>).id ?? (commercial.lead as Record<string, unknown>).leadId) : null;
  const opportunityId = isRecord(commercial?.opportunity)
    ? asId((commercial.opportunity as Record<string, unknown>).id ?? (commercial.opportunity as Record<string, unknown>).opportunityId)
    : null;
  const waId = asText(identity?.waId ?? sourceSummary?.waId ?? input.inboundMessage.waId ?? input.brainContext.customer_context?.wa_id ?? null);
  const conversationCaseId = asId(identity?.conversationCaseId ?? sourceSummary?.conversationCaseId ?? input.inboundMessage.conversationCaseId ?? input.brainContext.customer_context?.active_case_id ?? input.brainContext.case_context?.active_case?.conversation_case_id ?? null);
  const channel = (sourceSummary?.channel ?? input.inboundMessage.channel ?? "unknown") as CommercialChannelReference["channel"];
  const primaryIntent = normalizeCommercialIntent(sourceSummary?.commercialIntentLegacy ?? commercial?.commercialIntentLegacy ?? input.brainContext.case_context?.active_case?.service_code ?? input.brainContext.service_context?.service_code ?? null);
  const threadKey = [
    customerCandidateId ?? waId ?? conversationCaseId ?? leadId ?? opportunityId ?? "unknown",
    channel,
    conversationCaseId ?? "no_case",
    primaryIntent
  ]
    .map((value) => String(value ?? ""))
    .join("|");

  return {
    customerCandidateId,
    customerMasterId,
    leadId,
    conversationCaseId,
    waId,
    channel,
    primaryIntent,
    threadKey,
    hasCommercialSignal: hasCommercialSignal(sourceSummary),
    hasExplicitCommercialState: Boolean(commercial?.lead || commercial?.opportunity || sourceSummary?.hasCommercialEntity),
    sourceSummary
  };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

export function buildOpportunityKey(hints: CommercialOperationalIdentityHints) {
  const anchor =
    hints.customerCandidateId ??
    hints.waId ??
    hints.customerMasterId ??
    hints.leadId ??
    hints.conversationCaseId ??
    "unknown";
  return uniqueStrings([
    "opportunity",
    String(anchor),
    hints.primaryIntent,
    hints.channel,
    hints.threadKey
  ]).join(":");
}

function isTerminalOpportunityStatus(status: string) {
  return status === "won" || status === "lost" || status === "cancelled" || status === "archived";
}

/**
 * ACS-R1-05.1-T02 hardening. `CommercialIntent` (constants.ts) has no member
 * for "new commercial need" or "terminal/exit" - every value except
 * `"unknown"`/`"general_information"` describes either a pre-purchase
 * acquisition move or a post-purchase service move. That split is real,
 * independently confirmed by the legacy queue routing this repo already had
 * before this task (`context/adapters.ts#commercialIntentLegacy`'s
 * `postventa_queue`/`mantenciones_queue` sources, distinct from the general
 * sales queue) - not invented for this fix. A sales opportunity and a
 * service/post-sale request are functionally incompatible commercial paths:
 * an active quote must never silently absorb a maintenance ticket, and a
 * maintenance/post-sale action must never silently masquerade as a sale.
 */
type CommercialIntentFamily = "sales" | "service" | "neutral";

const SALES_FAMILY_INTENTS: ReadonlySet<CommercialIntent> = new Set([
  "product_inquiry",
  "product_recommendation",
  "price_request",
  "stock_request",
  "quote_request",
  "delivery_request",
  "discount_request",
  "bulk_purchase",
  "equipment_project"
]);

const SERVICE_FAMILY_INTENTS: ReadonlySet<CommercialIntent> = new Set([
  "maintenance_request",
  "assembly_request",
  "post_sale_request"
]);

function commercialIntentFamily(intent: CommercialIntent): CommercialIntentFamily {
  if (SALES_FAMILY_INTENTS.has(intent)) return "sales";
  if (SERVICE_FAMILY_INTENTS.has(intent)) return "service";
  // "unknown" (no restated topic) and "general_information" (not
  // acquisition- or service-specific) never force a cross-domain exclusion.
  return "neutral";
}

function areIntentFamiliesCompatible(a: CommercialIntentFamily, b: CommercialIntentFamily): boolean {
  if (a === "neutral" || b === "neutral") return true;
  return a === b;
}

/**
 * An "unknown" intent hint means this turn did not restate the topic (most
 * continuation messages) - any identity match stays relevant. A specific,
 * known intent narrows relevance to opportunities that share it, so a
 * terminal opportunity from a DIFFERENT topic can never be reused just
 * because it happens to be the most recent row. Only used for TERMINAL
 * candidates (reopen candidacy) - see selectActiveCandidatesForIdentity for
 * non-terminal ("active") candidates, where intent is a tie-breaker, not a
 * filter (ACS-R1-05.1-T02).
 */
function selectRelevantCandidates(
  candidates: CommercialOperationalState[],
  primaryIntent: CommercialIntent
): CommercialOperationalState[] {
  if (primaryIntent === "unknown") return candidates;
  return candidates.filter((candidate) => candidate.primaryIntent === primaryIntent);
}

/**
 * ACS-R1-05.1-T02: non-terminal candidates for this identity, i.e. the set a
 * turn may continue. primaryIntent is frozen on an opportunity at creation
 * (reduceCommercialState.ts never updates it again) and a normal
 * within-purchase conversation naturally drifts across
 * product_inquiry/price_request/stock_request/etc turn to turn - so intent
 * can only ever act as a tie-breaker among two or more ACTIVE candidates for
 * the same identity, never as a rigid filter that could exclude the only
 * ongoing opportunity for this contact/project.
 *
 * Cross-domain (sales vs service/post-sale) is a harder boundary, checked
 * first: a candidate whose family is incompatible with this turn's family is
 * never eligible for silent reuse, even when it is the only active candidate
 * - excluding it here lets the existing create_new/no-candidate path decide
 * (never "mutating" a sales opportunity into a post-sale one, or vice versa).
 * If every active candidate is cross-domain-incompatible, the result is an
 * empty set (behaves exactly like no active history at all - unambiguous
 * create_new via the pre-existing contract, not a new "ambiguous" case).
 *
 * Within a family-compatible set, intent narrows a 2+ candidate set as a
 * tie-breaker only: narrows to exactly one -> unambiguous; narrows to zero or
 * still leaves two or more -> ambiguity still applies - never guess between
 * multiple live opportunities.
 */
export function selectActiveCandidatesForIdentity(
  candidates: CommercialOperationalState[],
  primaryIntent: CommercialIntent
): CommercialOperationalState[] {
  const nonTerminal = candidates.filter((candidate) => !isTerminalOpportunityStatus(candidate.status));
  if (nonTerminal.length === 0) return nonTerminal;

  const turnFamily = commercialIntentFamily(primaryIntent);
  const familyCompatible = nonTerminal.filter((candidate) => areIntentFamiliesCompatible(turnFamily, commercialIntentFamily(candidate.primaryIntent)));
  if (familyCompatible.length <= 1 || primaryIntent === "unknown") return familyCompatible;

  const matched = familyCompatible.filter((candidate) => candidate.primaryIntent === primaryIntent);
  return matched.length > 0 ? matched : familyCompatible;
}

function deriveSelectedState(loadResult: CommercialOperationalLoadStateResult | null, hints: CommercialOperationalIdentityHints) {
  if (!loadResult) return { selectedState: null as CommercialOperationalState | null, reopenCandidate: null as CommercialOperationalState | null, relevantCount: 0 };
  const activeCandidates = selectActiveCandidatesForIdentity(loadResult.candidates, hints.primaryIntent);
  // ACS-R1-05.1-T02 hardening: 2+ active candidates is a governed ambiguity,
  // never a "pick one anyway" situation. The previous version fell back to
  // .find(...) ?? activeCandidates[0], which - since isAmbiguous only gates
  // resolveOpportunityIdentity's OWN early return - still leaked an
  // arbitrarily-chosen candidate into `selectedState` on the ambiguous
  // response object. That field is not just informational:
  // runCommercialOperationalLoop.ts reads identityResolution.selectedState
  // directly as its `previousState` fallback, so an arbitrary candidate's
  // summary/requirements/opportunityId could bleed into the turn even though
  // the identity itself was never resolved. Verified end-to-end against real
  // MariaDB (Caso 5 in tests/e2e/opportunityContinuity.e2e.test.ts): before
  // this fix, a governed-ambiguous turn's fallback handoff action still
  // carried one of the two candidates' opportunity_id.
  const selectedState = activeCandidates.length === 1 ? activeCandidates[0] : null;
  // A candidate only counts as a reopen prospect when no active candidate
  // was found for this intent - it must never override a live opportunity.
  // (Never reached when ambiguous: resolveOpportunityIdentity returns at the
  // isAmbiguous branch first, before any reopenCandidate check.)
  const reopenCandidate = selectedState
    ? null
    : selectRelevantCandidates(loadResult.candidates, hints.primaryIntent).find((candidate) => isTerminalOpportunityStatus(candidate.status)) ?? null;
  return { selectedState, reopenCandidate, relevantCount: activeCandidates.length };
}

export function resolveOpportunityIdentity(input: CommercialOperationalIdentityResolutionInput): CommercialOperationalOpportunityIdentityResolution {
  const hints = buildCommercialIdentityHints({
    inboundMessage: input.inboundMessage,
    brainContext: input.brainContext,
    commercialContext: input.commercialContext
  });
  const loadResult = input.loadResult;
  const candidateOpportunityIds = uniqueStrings(
    (loadResult?.candidates ?? [])
      .map((candidate) => candidate.opportunityId)
      .filter((value): value is string | number => value !== null && value !== undefined)
      .map((value) => String(value))
  );
  const { selectedState, reopenCandidate, relevantCount } = deriveSelectedState(loadResult, hints);
  const opportunityKey = buildOpportunityKey(hints);
  // Ambiguity and reopen candidacy are computed over relevant (intent-matched
  // when the intent is known, non-terminal) candidates only - a closed
  // opportunity, or one about an unrelated topic, must never inflate the
  // ambiguity count nor be silently reused as the active state.
  const isAmbiguous = relevantCount > 1;
  const hasCommercialSignal = hints.hasCommercialSignal;
  const isNewOpportunity = !selectedState && !reopenCandidate && hasCommercialSignal;

  if (loadResult?.status === "error") {
    return {
      status: "blocked",
      opportunityKey,
      opportunityId: null,
      candidateOpportunityIds,
      selectedOpportunityId: null,
      selectedState,
      primaryIntent: hints.primaryIntent,
      channel: hints.channel,
      reason: "Commercial state lookup failed and cannot be trusted for identity resolution.",
      isNewOpportunity: false,
      isAmbiguous: false,
      isTerminal: false,
      requiresHumanReview: true,
      warnings: ["commercial_state_conflict"],
      metadata: {
        threadKey: hints.threadKey,
        sourceSummary: hints.sourceSummary,
        loadStatus: loadResult.status
      }
    };
  }

  if (!hasCommercialSignal) {
    return {
      status: "no_commercial_signal",
      opportunityKey,
      opportunityId: null,
      candidateOpportunityIds,
      selectedOpportunityId: null,
      selectedState,
      primaryIntent: hints.primaryIntent,
      channel: hints.channel,
      reason: "No explicit commercial signal was found in the current input.",
      isNewOpportunity: false,
      isAmbiguous: false,
      isTerminal: false,
      requiresHumanReview: false,
      warnings: ["commercial_state_missing"],
      metadata: {
        threadKey: hints.threadKey,
        sourceSummary: hints.sourceSummary
      }
    };
  }

  if (isAmbiguous) {
    return {
      status: "ambiguous",
      opportunityKey,
      opportunityId: null,
      candidateOpportunityIds,
      selectedOpportunityId: null,
      selectedState,
      primaryIntent: hints.primaryIntent,
      channel: hints.channel,
      reason: "Multiple active commercial opportunities matched the same identity hints.",
      isNewOpportunity: false,
      isAmbiguous: true,
      isTerminal: false,
      requiresHumanReview: true,
      warnings: ["commercial_state_ambiguous"],
      metadata: {
        threadKey: hints.threadKey,
        sourceSummary: hints.sourceSummary
      }
    };
  }

  if (reopenCandidate) {
    return {
      status: "possible_reopen",
      opportunityKey,
      opportunityId: null,
      candidateOpportunityIds,
      selectedOpportunityId: null,
      // Deliberately null: a terminal opportunity is never auto-selected as the
      // active state, even when it shares this turn's intent - only an explicit
      // decision (human or, later, the multi-request linker) may reopen it.
      selectedState: null,
      primaryIntent: hints.primaryIntent,
      channel: hints.channel,
      reason: `Opportunity ${reopenCandidate.opportunityKey} is terminal and shares this intent; it was not reopened automatically.`,
      isNewOpportunity: false,
      isAmbiguous: false,
      isTerminal: true,
      requiresHumanReview: true,
      warnings: ["commercial_state_terminal"],
      metadata: {
        threadKey: hints.threadKey,
        sourceSummary: hints.sourceSummary,
        reopenCandidateOpportunityId: reopenCandidate.opportunityId,
        reopenCandidateOpportunityKey: reopenCandidate.opportunityKey
      }
    };
  }

  if (selectedState) {
    return {
      status: "continue_existing",
      opportunityKey: selectedState.opportunityKey,
      opportunityId: selectedState.opportunityId,
      candidateOpportunityIds,
      selectedOpportunityId: selectedState.opportunityId,
      selectedState,
      primaryIntent: selectedState.primaryIntent ?? hints.primaryIntent,
      channel: selectedState.channel,
      reason: "A compatible active commercial opportunity was found.",
      isNewOpportunity: false,
      isAmbiguous: false,
      isTerminal: false,
      requiresHumanReview: Boolean(selectedState.humanOwnerActive || selectedState.aiBlocked),
      warnings: uniqueStrings([
        ...(selectedState.humanOwnerActive ? ["commercial_state_human_owner_active"] : []),
        ...(selectedState.aiBlocked ? ["commercial_state_ai_blocked"] : [])
      ]) as CommercialOperationalLoopWarning[],
      metadata: {
        threadKey: hints.threadKey,
        sourceSummary: hints.sourceSummary
      }
    };
  }

    return {
      status: "create_new",
      opportunityKey,
      opportunityId: null,
      candidateOpportunityIds,
    selectedOpportunityId: null,
    selectedState: null,
    primaryIntent: hints.primaryIntent,
    channel: hints.channel,
    reason: "No compatible active commercial opportunity was found. A new operational opportunity can be created.",
      isNewOpportunity,
    isAmbiguous: false,
    isTerminal: false,
    requiresHumanReview: false,
    warnings: [],
    metadata: {
      threadKey: hints.threadKey,
      sourceSummary: hints.sourceSummary
    }
  };
}

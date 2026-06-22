"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCommercialIntent = normalizeCommercialIntent;
exports.buildCommercialIdentityHints = buildCommercialIdentityHints;
exports.buildOpportunityKey = buildOpportunityKey;
exports.resolveOpportunityIdentity = resolveOpportunityIdentity;
const constants_1 = require("../constants");
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asText(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number" && Number.isFinite(value))
        return String(value);
    if (typeof value === "bigint")
        return value.toString();
    return null;
}
function asId(value) {
    if (value === null || value === undefined || value === "")
        return null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    if (typeof value === "bigint")
        return value.toString();
    return null;
}
function hasCommercialSignal(sourceSummary) {
    if (!sourceSummary)
        return false;
    return Boolean(sourceSummary.hasLatestCustomerMessage ||
        sourceSummary.hasLatestOutboundMessage ||
        sourceSummary.hasCustomerCandidate ||
        sourceSummary.hasCustomerReference ||
        sourceSummary.hasConversationHistory ||
        sourceSummary.hasCommercialEntity ||
        sourceSummary.orderContextAvailable ||
        sourceSummary.productServiceContextAvailable);
}
function normalizeCommercialIntent(value, fallback = "unknown") {
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (constants_1.COMMERCIAL_INTENTS.includes(normalized))
            return normalized;
        if (normalized.includes("price") || normalized.includes("precio"))
            return "price_request";
        if (normalized.includes("stock") || normalized.includes("inventario"))
            return "stock_request";
        if (normalized.includes("quote") || normalized.includes("cotiz"))
            return "quote_request";
        if (normalized.includes("delivery") || normalized.includes("despach") || normalized.includes("shipping"))
            return "delivery_request";
        if (normalized.includes("discount") || normalized.includes("descuento"))
            return "discount_request";
        if (normalized.includes("bulk") || normalized.includes("wholesale"))
            return "bulk_purchase";
        if (normalized.includes("equipment") || normalized.includes("project"))
            return "equipment_project";
        if (normalized.includes("maintenance"))
            return "maintenance_request";
        if (normalized.includes("assembly"))
            return "assembly_request";
        if (normalized.includes("post") && normalized.includes("sale"))
            return "post_sale_request";
        if (normalized.includes("recommend"))
            return "product_recommendation";
        if (normalized.includes("product"))
            return "product_inquiry";
        if (normalized.includes("general"))
            return "general_information";
    }
    return fallback;
}
function buildCommercialIdentityHints(input) {
    const salesAgentInput = input.commercialContext?.salesAgentInput ?? null;
    const sourceSummary = input.commercialContext?.sourceSummary ?? null;
    const identity = salesAgentInput?.identity ?? null;
    const commercial = salesAgentInput?.commercial ?? null;
    const customerCandidate = identity?.customerCandidate ?? null;
    const customerCandidateId = isRecord(customerCandidate)
        ? asId(customerCandidate.id ?? customerCandidate.customerCandidateId ?? customerCandidate.customer_candidate_id)
        : null;
    const customerMasterId = asId(input.brainContext.customer_context?.id_customer ?? input.brainContext.customer_context?.active_case_id ?? null);
    const leadId = isRecord(commercial?.lead) ? asId(commercial.lead.id ?? commercial.lead.leadId) : null;
    const opportunityId = isRecord(commercial?.opportunity)
        ? asId(commercial.opportunity.id ?? commercial.opportunity.opportunityId)
        : null;
    const waId = asText(identity?.waId ?? sourceSummary?.waId ?? input.inboundMessage.waId ?? input.brainContext.customer_context?.wa_id ?? null);
    const conversationCaseId = asId(identity?.conversationCaseId ?? sourceSummary?.conversationCaseId ?? input.inboundMessage.conversationCaseId ?? input.brainContext.customer_context?.active_case_id ?? input.brainContext.case_context?.active_case?.conversation_case_id ?? null);
    const channel = (sourceSummary?.channel ?? input.inboundMessage.channel ?? "unknown");
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
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}
function buildOpportunityKey(hints) {
    const anchor = hints.customerCandidateId ??
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
function deriveSelectedState(loadResult) {
    if (!loadResult)
        return null;
    if (loadResult.activeState)
        return loadResult.activeState;
    return loadResult.candidates[0] ?? null;
}
function resolveOpportunityIdentity(input) {
    const hints = buildCommercialIdentityHints({
        inboundMessage: input.inboundMessage,
        brainContext: input.brainContext,
        commercialContext: input.commercialContext
    });
    const loadResult = input.loadResult;
    const candidateOpportunityIds = uniqueStrings((loadResult?.candidates ?? [])
        .map((candidate) => candidate.opportunityId)
        .filter((value) => value !== null && value !== undefined)
        .map((value) => String(value)));
    const selectedState = deriveSelectedState(loadResult);
    const opportunityKey = buildOpportunityKey(hints);
    const isTerminal = Boolean(selectedState && ["won", "lost", "cancelled", "archived"].includes(selectedState.status));
    const isAmbiguous = candidateOpportunityIds.length > 1;
    const hasCommercialSignal = hints.hasCommercialSignal;
    const isNewOpportunity = !selectedState && hasCommercialSignal;
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
    if (isTerminal && selectedState) {
        return {
            status: "terminal",
            opportunityKey,
            opportunityId: selectedState.opportunityId,
            candidateOpportunityIds,
            selectedOpportunityId: selectedState.opportunityId,
            selectedState,
            primaryIntent: hints.primaryIntent,
            channel: hints.channel,
            reason: `Opportunity ${selectedState.opportunityKey} is terminal and must not be reopened automatically.`,
            isNewOpportunity: false,
            isAmbiguous: false,
            isTerminal: true,
            requiresHumanReview: true,
            warnings: ["commercial_state_terminal"],
            metadata: {
                threadKey: hints.threadKey,
                sourceSummary: hints.sourceSummary
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
            ]),
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

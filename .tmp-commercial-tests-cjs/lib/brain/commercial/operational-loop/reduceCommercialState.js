"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reduceCommercialState = reduceCommercialState;
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}
function normalizeChannel(value) {
    if (value === "whatsapp" || value === "email" || value === "web" || value === "phone" || value === "pos" || value === "hub" || value === "campaign" || value === "legacy" || value === "unknown") {
        return value;
    }
    return "unknown";
}
function toIsoString(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
function toComparable(value) {
    try {
        return JSON.stringify(value) ?? "";
    }
    catch {
        return String(value);
    }
}
function diffArray(previous, next) {
    const previousSet = new Set(previous.map((item) => toComparable(item)));
    const nextSet = new Set(next.map((item) => toComparable(item)));
    return {
        added: next.filter((item) => !previousSet.has(toComparable(item))),
        removed: previous.filter((item) => !nextSet.has(toComparable(item)))
    };
}
function deriveStructuralSignals(input) {
    const sourceSummary = input.commercialContext?.sourceSummary ?? null;
    const signals = new Set();
    for (const signal of input.previousState?.signals ?? [])
        signals.add(signal);
    if (sourceSummary?.hasLatestCustomerMessage)
        signals.add("replied");
    if (sourceSummary?.orderContextAvailable)
        signals.add("shares_requirements");
    if (sourceSummary?.productServiceContextAvailable)
        signals.add("shares_requirements");
    if (sourceSummary?.humanOwnershipActive)
        signals.add("human_requested");
    if (sourceSummary?.aiBlocked)
        signals.add("rejection_explicit");
    if (sourceSummary?.manualReplyActive)
        signals.add("replied");
    if (input.salesAgentResult?.shouldRequestHuman)
        signals.add("human_requested");
    if (input.salesAgentResult?.shouldRequestTool)
        signals.add("shares_requirements");
    if (input.salesAgentResult?.shouldRespondNow)
        signals.add("replied");
    if (input.salesAgentResult?.decision.type === "wait_for_customer" || input.salesAgentResult?.outcome === "waiting_for_customer")
        signals.add("conversation_inactive");
    if (input.salesAgentResult?.decision.type === "blocked_by_policy" || input.salesAgentResult?.outcome === "blocked_by_policy")
        signals.add("rejection_explicit");
    return [...signals];
}
function derivePriority(previousState, signals) {
    if (previousState && previousState.priority !== "normal")
        return previousState.priority;
    if (signals.includes("human_requested"))
        return "high";
    if (signals.includes("purchase_confirmed"))
        return "urgent";
    return "normal";
}
function deriveTemperature(previousState, signals) {
    if (previousState)
        return previousState.temperature;
    if (signals.includes("purchase_confirmed"))
        return "hot";
    if (signals.includes("human_requested"))
        return "warm";
    if (signals.includes("rejection_explicit"))
        return "cold";
    return "unknown";
}
function deriveStatus(previousState, input, signals) {
    if (previousState && ["won", "lost", "cancelled", "archived"].includes(previousState.status)) {
        return previousState.status;
    }
    if (input.commercialPolicyResult?.status === "blocked" || input.commercialPolicyResult?.requiresApproval === "blocked") {
        return previousState?.status ?? "stalled";
    }
    if (previousState?.aiBlocked || previousState?.humanOwnerActive || input.commercialContext?.sourceSummary?.humanOwnershipActive || input.commercialContext?.sourceSummary?.aiBlocked) {
        return previousState?.status === "new" ? "stalled" : previousState?.status ?? "stalled";
    }
    if (signals.includes("rejection_explicit")) {
        return "stalled";
    }
    if (!previousState) {
        if (signals.includes("human_requested"))
            return "stalled";
        if (signals.includes("replied"))
            return "engaged";
        return "new";
    }
    if (previousState.status === "new" && signals.includes("replied"))
        return "engaged";
    if (previousState.status === "engaged" && (signals.includes("human_requested") || input.salesAgentResult?.outcome === "tool_required" || input.salesAgentResult?.decision.type === "request_tool"))
        return "qualifying";
    if (previousState.status === "qualifying" && (input.salesAgentResult?.outcome === "tool_required" || input.salesAgentResult?.decision.type === "request_tool"))
        return "quote_pending";
    if (previousState.status === "qualifying" && (input.salesAgentResult?.outcome === "waiting_for_customer" || input.salesAgentResult?.decision.type === "wait_for_customer"))
        return "waiting_customer";
    if (previousState.status === "quote_pending" && (input.salesAgentResult?.outcome === "waiting_for_customer" || input.salesAgentResult?.decision.type === "wait_for_customer"))
        return "waiting_customer";
    if (previousState.status === "waiting_customer" && signals.includes("replied"))
        return "engaged";
    if (previousState.status === "stalled" && signals.includes("replied"))
        return "engaged";
    return previousState.status;
}
function deriveStage(status) {
    if (status === "new" || status === "engaged" || status === "stalled")
        return "discovery";
    if (status === "qualifying")
        return "qualification";
    if (status === "quote_pending" || status === "quote_ready_for_review" || status === "quote_sent")
        return "quotation";
    if (status === "waiting_customer" || status === "followup_scheduled")
        return "solution_fit";
    if (status === "negotiation")
        return "negotiation";
    if (status === "won" || status === "lost" || status === "cancelled" || status === "archived")
        return "closing";
    return null;
}
function buildBaseState(input, previousState, signals) {
    const now = toIsoString(input.currentTime);
    const summary = input.salesAgentResult?.analysis.summary ??
        input.commercialPolicyResult?.summary.notes[0] ??
        previousState?.currentSummary ??
        null;
    const opportunityId = previousState?.opportunityId ?? input.identityResolution.selectedOpportunityId ?? input.identityResolution.opportunityId ?? null;
    return {
        opportunityId,
        opportunityKey: input.identityResolution.opportunityKey,
        customerCandidateId: previousState?.customerCandidateId ?? input.identityResolution.selectedState?.customerCandidateId ?? null,
        customerMasterId: previousState?.customerMasterId ?? input.identityResolution.selectedState?.customerMasterId ?? null,
        leadId: previousState?.leadId ?? input.identityResolution.selectedState?.leadId ?? null,
        conversationCaseId: previousState?.conversationCaseId ?? input.identityResolution.selectedState?.conversationCaseId ?? null,
        waId: previousState?.waId ?? input.identityResolution.selectedState?.waId ?? input.brainContext.customer_context?.wa_id ?? null,
        channel: previousState?.channel ??
            input.identityResolution.selectedState?.channel ??
            normalizeChannel(input.commercialContext?.sourceSummary?.channel) ??
            normalizeChannel(input.inboundMessage.channel),
        primaryIntent: previousState?.primaryIntent ?? input.identityResolution.primaryIntent,
        status: previousState?.status ?? "new",
        stage: previousState?.stage ?? null,
        temperature: previousState?.temperature ?? "unknown",
        priority: previousState?.priority ?? "normal",
        currentSummary: summary,
        requirements: [...(previousState?.requirements ?? [])],
        missingRequirements: [...(previousState?.missingRequirements ?? [])],
        productInterests: [...(previousState?.productInterests ?? [])],
        objections: [...(previousState?.objections ?? [])],
        signals,
        lastCustomerMessageId: input.inboundMessage.messageId ?? previousState?.lastCustomerMessageId ?? null,
        lastAgentDecisionId: input.salesAgentResult?.runId ?? previousState?.lastAgentDecisionId ?? null,
        waitingFor: previousState?.waitingFor ?? null,
        nextActionType: previousState?.nextActionType ?? null,
        nextActionDueAt: previousState?.nextActionDueAt ?? null,
        humanOwnerActive: Boolean(previousState?.humanOwnerActive ??
            input.commercialContext?.sourceSummary?.humanOwnershipActive ??
            input.brainContext.case_context?.manual_operator_lock ??
            false),
        aiBlocked: Boolean(previousState?.aiBlocked ??
            input.commercialContext?.sourceSummary?.aiBlocked ??
            input.brainContext.case_context?.active_case?.ai_blocked ??
            false),
        version: (previousState?.version ?? 0) + 1,
        createdAt: previousState?.createdAt ?? now,
        updatedAt: now,
        lastActivityAt: input.commercialContext?.sourceSummary.latestInboundAt ?? input.commercialContext?.sourceSummary.latestOutboundAt ?? now,
        closedAt: previousState?.closedAt ?? null,
        previousDecision: input.loadResult.latestDecision
            ? {
                decisionId: input.loadResult.latestDecision.decisionId,
                decisionStatus: input.loadResult.latestDecision.decisionStatus,
                createdAt: input.loadResult.latestDecision.createdAt
            }
            : previousState?.previousDecision ?? null
    };
}
function buildStateDiff(previousState, resultingState) {
    const previousSignals = previousState?.signals ?? [];
    const nextSignals = resultingState.signals;
    const previousRequirements = previousState?.requirements ?? [];
    const nextRequirements = resultingState.requirements;
    const previousObjections = previousState?.objections ?? [];
    const nextObjections = resultingState.objections;
    const signalDiff = diffArray(previousSignals, nextSignals);
    const requirementDiff = diffArray(previousRequirements, nextRequirements);
    const objectionDiff = diffArray(previousObjections, nextObjections);
    const changedFields = uniqueStrings([
        previousState?.status === resultingState.status ? null : "status",
        previousState?.stage === resultingState.stage ? null : "stage",
        previousState?.currentSummary === resultingState.currentSummary ? null : "currentSummary",
        previousState?.waitingFor === resultingState.waitingFor ? null : "waitingFor",
        previousState?.nextActionType === resultingState.nextActionType ? null : "nextActionType",
        previousState?.priority === resultingState.priority ? null : "priority",
        previousState?.temperature === resultingState.temperature ? null : "temperature",
        previousState?.humanOwnerActive === resultingState.humanOwnerActive ? null : "humanOwnerActive",
        previousState?.aiBlocked === resultingState.aiBlocked ? null : "aiBlocked",
        previousState?.version === resultingState.version ? null : "version"
    ]);
    return {
        opportunityKey: resultingState.opportunityKey,
        previousStatus: previousState?.status ?? null,
        nextStatus: resultingState.status,
        previousStage: previousState?.stage ?? null,
        nextStage: resultingState.stage,
        statusChanged: previousState?.status !== resultingState.status,
        stageChanged: previousState?.stage !== resultingState.stage,
        summaryChanged: previousState?.currentSummary !== resultingState.currentSummary,
        waitingForChanged: previousState?.waitingFor !== resultingState.waitingFor,
        nextActionChanged: previousState?.nextActionType !== resultingState.nextActionType,
        changedFields,
        addedSignals: signalDiff.added,
        removedSignals: signalDiff.removed,
        addedRequirements: requirementDiff.added.map((item) => toComparable(item)),
        removedRequirements: requirementDiff.removed.map((item) => toComparable(item)),
        addedObjections: objectionDiff.added.map((item) => toComparable(item)),
        removedObjections: objectionDiff.removed.map((item) => toComparable(item))
    };
}
function reduceCommercialState(input) {
    const previousState = input.previousState ?? null;
    const signals = deriveStructuralSignals(input);
    const baseState = buildBaseState(input, previousState, signals);
    const derivedStatus = deriveStatus(previousState, input, signals);
    const resultingState = {
        ...baseState,
        status: derivedStatus,
        stage: deriveStage(derivedStatus),
        temperature: deriveTemperature(previousState, signals),
        priority: derivePriority(previousState, signals),
        waitingFor: input.commercialPolicyResult?.status === "blocked" || input.commercialPolicyResult?.requiresApproval === "blocked"
            ? "operator_review"
            : previousState?.waitingFor ?? null
    };
    const stateDiff = buildStateDiff(previousState, resultingState);
    const warnings = uniqueStrings([
        previousState?.humanOwnerActive || resultingState.humanOwnerActive ? "commercial_state_human_owner_active" : null,
        previousState?.aiBlocked || resultingState.aiBlocked ? "commercial_state_ai_blocked" : null,
        input.commercialPolicyResult?.status === "blocked" ? "commercial_state_policy_blocked" : null,
        input.commercialPolicyResult?.status === "requires_review" ? "commercial_state_conflict" : null,
        signals.includes("rejection_explicit") ? "commercial_state_transition_blocked" : null
    ]);
    const reason = input.commercialPolicyResult?.status === "blocked"
        ? "Commercial policy blocked the state reduction."
        : previousState && previousState.status === resultingState.status && previousState.stage === resultingState.stage
            ? "Commercial state remained stable."
            : `Reduced commercial state to ${resultingState.status}.`;
    return {
        resultingState,
        stateDiff,
        warnings,
        reason
    };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBotEligibility = buildBotEligibility;
const POSITIVE_AMBIGUOUS_TERMS = ["si", "sí", "dale", "ok", "okay", "perfecto", "me interesa", "vamos", "va", "confirmo"];
function normalizeText(value) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}
function hasAny(text, terms) {
    const normalized = normalizeText(text);
    return terms.some((term) => normalized.includes(normalizeText(term)));
}
function isRecent(timestamp, hours) {
    if (!timestamp)
        return false;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime()))
        return false;
    const diff = Date.now() - date.getTime();
    return diff >= 0 && diff <= hours * 60 * 60 * 1000;
}
function pickFirstReason(reasons) {
    return reasons[0] ?? "Bot eligibility evaluated with current context.";
}
function isManualOperatorLock(caseContext) {
    return caseContext.manual_operator_lock;
}
function isRecentManualReply(conversationContext) {
    return isRecent(conversationContext.last_manual_reply_at, 24);
}
function isAmbiguousPositiveReplyWithServiceContext(messageText, serviceContext) {
    const ambiguousPositive = hasAny(messageText, POSITIVE_AMBIGUOUS_TERMS);
    return ambiguousPositive && serviceContext.primary_service !== "unknown";
}
function buildBotEligibility(input) {
    const manualOperatorLock = isManualOperatorLock(input.caseContext) || input.customerContext.suppression_active || input.customerContext.hard_suppression;
    const activeHumanCase = input.caseContext.waiting_human_case;
    const suppressionActive = input.customerContext.suppression_active || input.customerContext.hard_suppression;
    const recentManualReply = isRecentManualReply(input.conversationContext);
    const openCaseWaitingHuman = input.caseContext.waiting_human_case;
    const closedOrRejectedCase = input.caseContext.closed_or_rejected_case;
    const ambiguousPositiveReplyWithServiceContext = isAmbiguousPositiveReplyWithServiceContext(input.messageText, input.serviceContext);
    const blockers = [];
    if (manualOperatorLock)
        blockers.push("manual_operator_lock");
    if (activeHumanCase)
        blockers.push("active_human_case");
    if (suppressionActive)
        blockers.push("suppression_active");
    if (recentManualReply)
        blockers.push("recent_manual_reply");
    if (openCaseWaitingHuman)
        blockers.push("open_case_waiting_human");
    if (closedOrRejectedCase)
        blockers.push("closed_or_rejected_case");
    const eligible = blockers.length === 0;
    const recommendedMode = blockers.length > 0 ? "human" : ambiguousPositiveReplyWithServiceContext ? "review" : "bot";
    const confidence = eligible ? (ambiguousPositiveReplyWithServiceContext ? 0.6 : 0.85) : 0.15;
    const reasons = [
        manualOperatorLock ? "manual/operator lock active" : null,
        activeHumanCase ? "case already waiting human" : null,
        suppressionActive ? "suppression active" : null,
        recentManualReply ? "recent manual reply" : null,
        openCaseWaitingHuman ? "open case waiting human" : null,
        closedOrRejectedCase ? "closed or rejected case" : null,
        ambiguousPositiveReplyWithServiceContext ? "ambiguous positive reply with service context" : null
    ].filter(Boolean);
    return {
        eligible,
        recommended_mode: recommendedMode,
        confidence,
        reason: pickFirstReason(reasons),
        blockers,
        can_auto_reply: eligible && recommendedMode === "bot",
        can_human_handoff: !suppressionActive && !closedOrRejectedCase,
        can_case_mutation: eligible && !suppressionActive && !closedOrRejectedCase,
        signals: {
            manual_operator_lock: manualOperatorLock,
            active_human_case: activeHumanCase,
            suppression_active: suppressionActive,
            recent_manual_reply: recentManualReply,
            open_case_waiting_human: openCaseWaitingHuman,
            closed_or_rejected_case: closedOrRejectedCase,
            ambiguous_positive_reply_with_service_context: ambiguousPositiveReplyWithServiceContext
        }
    };
}

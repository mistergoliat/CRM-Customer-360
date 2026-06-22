"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAiSdrOperatorPilotViewModel = buildAiSdrOperatorPilotViewModel;
const MAX_TEXT_LENGTH = 1200;
const MAX_DRAFT_LENGTH = 900;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asRecord(value) {
    return isRecord(value) ? value : null;
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))];
}
function sanitizeDisplayText(value, maxLength = MAX_TEXT_LENGTH) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean")
        return String(value);
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const sanitized = trimmed
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
        .replace(/\b(sk-[A-Za-z0-9_-]+)\b/gi, "[redacted]")
        .replace(/\b(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]");
    return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength)}...` : sanitized;
}
function toIsoString(value) {
    if (value === null || value === undefined || value === "")
        return null;
    if (value instanceof Date)
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    const parsed = new Date(typeof value === "bigint" ? Number(value) : value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function asNumber(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
function readFirstText(...values) {
    for (const value of values) {
        const text = sanitizeDisplayText(value);
        if (text)
            return text;
    }
    return null;
}
function readFirstNumber(...values) {
    for (const value of values) {
        const num = asNumber(value);
        if (num !== null)
            return num;
    }
    return null;
}
function humanizeKey(value) {
    const normalized = value.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
    if (!normalized)
        return value;
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
function normalizeList(values, maxItems = 12) {
    if (!Array.isArray(values))
        return [];
    return uniqueStrings(values.map((value) => sanitizeDisplayText(value, 400))).slice(0, maxItems);
}
function extractCandidate(input) {
    const topLevelCandidates = [
        input.commercialOperationalResult,
        input.caseRow?.commercial_operational_result,
        input.caseRow?.commercialOperationalResult,
        input.caseRow?.commercial_operational_loop,
        input.caseRow?.commercialOperationalLoop,
        input.caseRow?.commercial_operational_loop_result,
        input.caseRow?.commercialOperationalLoopResult,
        input.caseRow?.operational_result,
        input.caseRow?.operationalResult
    ];
    const metadata = asRecord(input.caseRow?.metadata);
    const metadataCandidates = [
        metadata?.commercial_operational_result,
        metadata?.commercialOperationalResult,
        metadata?.commercial_operational_loop,
        metadata?.commercialOperationalLoop,
        metadata?.commercial_operational_loop_result,
        metadata?.commercialOperationalLoopResult,
        metadata?.operational_result,
        metadata?.operationalResult
    ];
    for (const candidate of [...topLevelCandidates, ...metadataCandidates]) {
        if (candidate === null || candidate === undefined)
            continue;
        const parsed = typeof candidate === "string"
            ? (() => {
                try {
                    const value = JSON.parse(candidate);
                    return isRecord(value) ? value : null;
                }
                catch {
                    return null;
                }
            })()
            : asRecord(candidate);
        if (!parsed)
            continue;
        const status = sanitizeDisplayText(parsed.status)?.toLowerCase() ?? null;
        const hasResultState = isRecord(parsed.resultingState) || isRecord(parsed.commercialState) || isRecord(parsed.state);
        const hasDecision = isRecord(parsed.selectedNextAction) || isRecord(parsed.nextAction) || isRecord(parsed.decisionRecord) || isRecord(parsed.decision_record);
        if (status || hasResultState || hasDecision) {
            return parsed;
        }
    }
    return null;
}
function resolveStatus(input, candidate) {
    if (candidate) {
        const status = sanitizeDisplayText(candidate.status)?.toLowerCase() ?? null;
        const skipReason = sanitizeDisplayText(candidate.skipReason ?? candidate.skip_reason)?.toLowerCase() ?? null;
        if (status === "completed" || status === "available")
            return { status: "available", reason: null };
        if (status === "skipped" && skipReason === "skipped_by_flag")
            return { status: "disabled", reason: "commercial_operational_loop_disabled" };
        if (status === "skipped")
            return { status: "waiting_for_operational_loop", reason: "commercial_operational_result_skipped" };
        if (status === "disabled")
            return { status: "disabled", reason: "commercial_operational_loop_disabled" };
        if (status === "failed_safe" || status === "blocked" || status === "persistence_failed" || status === "timeout" || status === "cancelled" || status === "invalid_input") {
            return { status: "error", reason: "commercial_operational_result_failed_safe" };
        }
        if (status === "not_found")
            return { status: "not_found", reason: "commercial_operational_result_missing" };
        return { status: "available", reason: null };
    }
    if (input.commercialShadowReview.status === "available") {
        return { status: "waiting_for_operational_loop", reason: "commercial_operational_result_missing" };
    }
    if (input.commercialShadowReview.status === "disabled") {
        return { status: "disabled", reason: "commercial_shadow_disabled" };
    }
    if (input.commercialShadowReview.status === "error") {
        return { status: "error", reason: "commercial_shadow_error" };
    }
    return { status: "not_found", reason: "commercial_operational_result_missing" };
}
function extractResultState(candidate) {
    return asRecord(candidate.resultingState) ?? asRecord(candidate.commercialState) ?? asRecord(candidate.state);
}
function extractSelectedNextAction(candidate) {
    const decisionRecord = asRecord(candidate.decisionRecord) ?? asRecord(candidate.decision_record);
    return asRecord(candidate.selectedNextAction) ?? asRecord(candidate.nextAction) ?? asRecord(decisionRecord?.nextAction);
}
function buildCommercialState(candidate, status, review) {
    if (status !== "available") {
        if (review.status !== "available")
            return null;
        return {
            status: "waiting_for_operational_loop",
            stage: null,
            temperature: null,
            priority: null,
            summary: readFirstText(review.summary?.governedResponse, review.summary?.proposedResponse),
            waitingFor: review.summary?.governedShouldRespondNow === false ? "operator_review" : "operational_loop_persisted"
        };
    }
    const resultingState = extractResultState(candidate);
    return {
        status: readFirstText(resultingState?.status, candidate.status),
        stage: readFirstText(resultingState?.stage, candidate.stage, candidate.nextStage, candidate.next_stage),
        temperature: readFirstText(resultingState?.temperature, candidate.temperature),
        priority: readFirstText(resultingState?.priority, candidate.priority),
        summary: readFirstText(resultingState?.currentSummary, resultingState?.summary, candidate.currentSummary, candidate.summary, candidate.governedResponse, candidate.proposedResponse),
        waitingFor: readFirstText(resultingState?.waitingFor, candidate.waitingFor, candidate.waiting_for)
    };
}
function buildKnownInformation(input, status, candidate) {
    const review = input.commercialShadowReview;
    const items = [];
    const push = (label, value, source, confidence) => {
        const text = sanitizeDisplayText(value, 2000);
        if (!text)
            return;
        items.push({ label, value: text, confidence, source });
    };
    if (candidate && status === "available") {
        const resultingState = extractResultState(candidate);
        const selectedNextAction = extractSelectedNextAction(candidate);
        const decisionRecord = asRecord(candidate.decisionRecord) ?? asRecord(candidate.decision_record);
        push("Estado comercial", resultingState?.status ?? candidate.status, "commercial_operational_result", 1);
        push("Etapa", resultingState?.stage ?? candidate.stage, "commercial_operational_result", 1);
        push("Temperatura", resultingState?.temperature ?? candidate.temperature, "commercial_operational_result", 1);
        push("Prioridad", resultingState?.priority ?? candidate.priority, "commercial_operational_result", 1);
        push("Resumen", resultingState?.currentSummary ?? resultingState?.summary ?? candidate.summary, "commercial_operational_result", 1);
        push("Esperando por", resultingState?.waitingFor ?? candidate.waitingFor, "commercial_operational_result", 1);
        push("Decision", decisionRecord?.decisionStatus ?? candidate.decisionStatus, "commercial_operational_result", 1);
        push("Next action", selectedNextAction?.type ?? candidate.nextActionType, "commercial_operational_result", 1);
        return items.slice(0, 8);
    }
    if (review.status === "available") {
        push("Estado shadow", review.status, "commercial_shadow_review", 0.7);
        push("Outcome gobernado", review.summary?.governedOutcome, "commercial_shadow_review", 0.7);
        push("Policy status", review.summary?.policyStatus, "commercial_shadow_review", 0.7);
        push("Risk level", review.summary?.riskLevel, "commercial_shadow_review", 0.7);
        push("Approval requirement", review.summary?.approvalRequirement, "commercial_shadow_review", 0.7);
        push("Respuesta gobernada", review.summary?.governedResponse ?? review.summary?.proposedResponse, "commercial_shadow_review", 0.7);
        push("Correlation ID", review.identifiers.correlationId, "commercial_shadow_review", 0.7);
        push("Process inbound run ID", review.identifiers.processInboundRunId, "commercial_shadow_review", 0.7);
        push("Sales Agent run ID", review.identifiers.salesAgentRunId, "commercial_shadow_review", 0.7);
        return items.slice(0, 9);
    }
    if (review.status === "disabled") {
        push("Estado review", "disabled", "commercial_shadow_review", 0.5);
        return items.slice(0, 1);
    }
    if (review.status === "error") {
        push("Estado review", "error", "commercial_shadow_review", 0.5);
        return items.slice(0, 1);
    }
    if (review.status === "not_found") {
        push("Estado review", "not_found", "commercial_shadow_review", 0.5);
        return items.slice(0, 1);
    }
    return items.slice(0, 8);
}
function buildMissingInformation(input, status, candidate) {
    const review = input.commercialShadowReview;
    const items = [];
    const push = (key, label, reason, requiredFor) => {
        items.push({
            key,
            label,
            reason: sanitizeDisplayText(reason, 400) ?? null,
            requiredFor: sanitizeDisplayText(requiredFor, 400) ?? null
        });
    };
    if (candidate && status === "available") {
        const resultingState = extractResultState(candidate);
        const selectedNextAction = extractSelectedNextAction(candidate);
        const requiredInformation = normalizeList(selectedNextAction?.requiredInformation ?? candidate.requiredInformation);
        const missingRequirements = normalizeList(resultingState?.missingRequirements ?? candidate.missingRequirements);
        const requiredForText = readFirstText(selectedNextAction?.label, selectedNextAction?.type, "next_action");
        const missingForText = readFirstText(selectedNextAction?.label, "operational_loop");
        for (const item of requiredInformation.slice(0, 8)) {
            push(item, humanizeKey(item), "Requerido por la proxima accion gobernada.", requiredForText);
        }
        for (const item of missingRequirements.slice(0, 8)) {
            push(item, humanizeKey(item), "Requerimiento comercial faltante en el estado operacional.", missingForText);
        }
        return items.slice(0, 8);
    }
    if (review.status === "available") {
        push("operational_result", "Resultado operacional persistido", "Todavia no existe un resultado operacional duradero para este caso; la vista usa la observacion shadow como referencia parcial.", "AI SDR Operator Pilot");
        const shadowActionLabel = review.summary?.governedShouldRespondNow === false ? "Revision operativa" : "Loop operacional";
        if (review.summary?.approvalRequirement && review.summary.approvalRequirement !== "none") {
            push("approval_requirement", "Approval requirement", "La observacion shadow sugiere que el siguiente paso todavia requiere gobernanza o revision humana.", shadowActionLabel);
        }
        return items.slice(0, 8);
    }
    if (status === "disabled") {
        push("operational_result", "Resultado operacional", "El piloto operativo esta deshabilitado para esta corrida.", "AI SDR Operator Pilot");
    }
    else if (status === "error") {
        push("operational_result", "Resultado operacional", "La lectura del piloto operativo fallo de forma segura.", "AI SDR Operator Pilot");
    }
    else if (status === "not_found") {
        push("operational_result", "Resultado operacional", "No existe una observacion operacional o shadow vinculable para este caso.", "AI SDR Operator Pilot");
    }
    return items.slice(0, 8);
}
function humanizeNextActionType(value) {
    const normalized = value.trim().toLowerCase();
    const mapping = {
        respond: "Responder",
        ask_clarifying_question: "Pedir contexto",
        qualify: "Calificar",
        recommend_products: "Recomendar productos",
        prepare_quote: "Preparar cotizacion",
        wait_for_customer: "Esperar al cliente",
        propose_followup: "Proponer seguimiento",
        escalate_to_operator: "Escalar al operador",
        pause: "Pausar",
        close_as_lost_candidate: "Cerrar como perdido",
        no_action: "Sin accion"
    };
    return mapping[normalized] ?? humanizeKey(value);
}
function buildFallbackNextAction(input, candidate, status) {
    const review = input.commercialShadowReview;
    if (candidate && status === "available") {
        const selectedNextAction = extractSelectedNextAction(candidate);
        const responseProposal = asRecord(candidate.responseProposal);
        const reason = readFirstText(selectedNextAction?.reason, candidate.reason, candidate.rationale, candidate.summary, candidate.governedResponse, candidate.proposedResponse);
        const type = readFirstText(selectedNextAction?.type, candidate.nextActionType, candidate.next_action_type) ?? "no_action";
        const blockedReasons = normalizeList(selectedNextAction?.blockedReasons ?? candidate.blockedReasons, 6);
        const draftMessage = sanitizeDisplayText(selectedNextAction?.draftMessage ?? candidate.draftMessage ?? candidate.responseDraft ?? responseProposal?.draftText ?? responseProposal?.text, MAX_DRAFT_LENGTH);
        return {
            type,
            label: humanizeNextActionType(type),
            reason: reason ?? "Accion operacional no persistida.",
            confidence: readFirstNumber(selectedNextAction?.confidence, candidate.confidence),
            riskLevel: readFirstText(selectedNextAction?.riskLevel, candidate.riskLevel),
            approvalRequirement: readFirstText(selectedNextAction?.approvalRequirement, candidate.approvalRequirement),
            recommendedChannel: readFirstText(selectedNextAction?.recommendedChannel, candidate.recommendedChannel, input.caseRow?.channel, input.sourceQueue?.canal_derivacion, "whatsapp"),
            draftMessage,
            executable: false,
            blockedReasons
        };
    }
    if (review.status !== "available")
        return null;
    const summary = review.summary;
    const baseOutcome = readFirstText(summary?.governedOutcome, summary?.proposedOutcome) ?? "no_action";
    let type = "no_action";
    let label = humanizeNextActionType(type);
    let reason = readFirstText(summary?.overallDecision, summary?.policyStatus) ?? "La observacion shadow aun no tiene una accion operacional persistida.";
    if (summary?.policyStatus === "blocked") {
        type = "pause";
        label = humanizeNextActionType(type);
        reason = "Commercial Policy bloqueo la propuesta observada en shadow.";
    }
    else if (baseOutcome === "waiting_for_customer") {
        type = "wait_for_customer";
        label = humanizeNextActionType(type);
        reason = "La observacion shadow indica que la siguiente respuesta debe esperar al cliente.";
    }
    else if (baseOutcome === "tool_required") {
        type = "ask_clarifying_question";
        label = humanizeNextActionType(type);
        reason = "Falta evidencia o una herramienta para completar la siguiente accion.";
    }
    else if (summary?.governedShouldRespondNow) {
        type = "respond";
        label = humanizeNextActionType(type);
        reason = "La observacion shadow sugiere una respuesta gobernada.";
    }
    else if ((summary?.policyStatus === "requires_review" || summary?.overallDecision === "allow_with_approval") || (summary?.approvalRequirement && summary.approvalRequirement !== "none")) {
        type = "escalate_to_operator";
        label = humanizeNextActionType(type);
        reason = "La observacion shadow requiere revision humana.";
    }
    else if (summary?.governedResponse?.includes("?") || summary?.proposedResponse?.includes("?")) {
        type = "ask_clarifying_question";
        label = humanizeNextActionType(type);
        reason = "La respuesta sugerida pide mas contexto.";
    }
    const blockedReasons = uniqueStrings([
        summary?.policyStatus === "blocked" ? "policy_blocked" : null,
        summary?.riskLevel === "blocked" ? "risk_blocked" : null,
        summary?.approvalRequirement && summary.approvalRequirement !== "none" ? "approval_required" : null
    ]);
    return {
        type,
        label,
        reason,
        confidence: readFirstNumber(summary?.governedConfidence, summary?.proposedConfidence),
        riskLevel: readFirstText(summary?.riskLevel),
        approvalRequirement: readFirstText(summary?.approvalRequirement),
        recommendedChannel: readFirstText(input.caseRow?.channel, input.caseRow?.platform, input.sourceQueue?.channel, input.sourceQueue?.canal_derivacion, "whatsapp"),
        draftMessage: sanitizeDisplayText(summary?.governedResponse ?? summary?.proposedResponse, MAX_DRAFT_LENGTH),
        executable: false,
        blockedReasons
    };
}
function buildControls(status) {
    return {
        canApprove: false,
        canReject: false,
        canEditDraft: false,
        canTakeOver: false,
        disabledReason: status === "disabled"
            ? "Piloto controlado: esta corrida estaba deshabilitada."
            : "Piloto controlado: estas acciones todavia no ejecutan cambios ni envian mensajes."
    };
}
function buildDiagnosticsLink() {
    return {
        available: true,
        label: "Ver diagnostico tecnico"
    };
}
function buildInvariants() {
    return {
        outboundExecuted: false,
        toolsExecuted: 0,
        followupScheduled: false,
        quoteCreated: false,
        leadCreated: false,
        opportunityCreatedFromUi: false,
        caseMutated: false,
        approvalPersisted: false,
        nextActionExecuted: false
    };
}
function buildWarnings(review, status, sourceReason) {
    return uniqueStrings([
        ...review.warnings,
        review.error?.code ?? null,
        sourceReason,
        status === "waiting_for_operational_loop" ? "operational_result_missing" : null,
        status === "disabled" ? "operational_loop_disabled" : null,
        status === "error" ? "operational_result_error" : null
    ]);
}
function buildError(review, status, sourceReason) {
    if (status !== "error")
        return null;
    return sanitizeDisplayText(review.error?.message ?? sourceReason ?? "No fue posible construir una vista operacional segura para este caso.", 1200);
}
function buildAiSdrOperatorPilotViewModel(input) {
    const candidate = extractCandidate(input);
    const { status, reason } = resolveStatus(input, candidate);
    const observedAt = toIsoString(input.observedAt ?? candidate?.observedAt ?? candidate?.observed_at ?? input.commercialShadowReview.observedAt);
    const commercialState = buildCommercialState(candidate ?? {}, status, input.commercialShadowReview);
    const knownInformation = buildKnownInformation(input, status, candidate);
    const missingInformation = buildMissingInformation(input, status, candidate);
    const nextAction = buildFallbackNextAction(input, candidate, status);
    const controls = buildControls(status);
    const diagnosticsLink = buildDiagnosticsLink();
    const warnings = buildWarnings(input.commercialShadowReview, status, reason);
    const error = buildError(input.commercialShadowReview, status, reason);
    return {
        status,
        caseId: String(input.caseId),
        observedAt,
        commercialState,
        knownInformation,
        missingInformation,
        nextAction,
        operatorControls: controls,
        diagnosticsLink,
        invariants: buildInvariants(),
        warnings,
        error
    };
}

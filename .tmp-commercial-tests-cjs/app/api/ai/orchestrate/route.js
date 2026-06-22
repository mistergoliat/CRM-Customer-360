"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const node_crypto_1 = __importDefault(require("node:crypto"));
const auth_1 = require("@/lib/auth");
const shadow_log_1 = require("@/lib/ai/orchestration/shadow-log");
const validation_1 = require("@/lib/ai/orchestration/validation");
exports.dynamic = "force-dynamic";
const AGENT_NAME = "AI_ORCHESTRATOR_MOCK";
const AGENT_VERSION = "0.1.0";
const VALIDATOR_VERSION = "0.1.0";
function normalizeText(value) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}
function hasAny(text, terms) {
    return terms.some((term) => text.includes(term));
}
function makeDecisionId(request) {
    const hash = node_crypto_1.default
        .createHash("sha256")
        .update(`${request.source}:${request.contextMode}:${request.messageId}:${request.messageText}`)
        .digest("hex")
        .slice(0, 16);
    return `mock-${hash}`;
}
function makeError(code, message, retryable = false, details) {
    return { code, message, retryable, details };
}
function classifyMockDecision(request) {
    const text = normalizeText(request.messageText);
    const recoveryMode = request.contextMode === "recovery";
    if (hasAny(text, ["no gracias", "no necesito", "no me interesa", "cancel", "cerrar", "cierra", "rechazo"])) {
        return {
            intent: "close_request",
            department: "Postventa",
            caseTopic: "rechazo",
            commercialStatus: "post_sale",
            customerSignal: "decline",
            finalAction: "close_case",
            requiresHuman: false,
            shouldReply: false,
            replyText: "",
            summaryForOperator: "Cliente indica que no desea continuar. Candidato a cierre.",
            nextAction: "close_case",
            confidence: 0.9,
            reasonSummary: "Regla mock detecto senal explicita de cierre o rechazo."
        };
    }
    if (hasAny(text, ["reclamo", "problema", "despacho", "pedido", "no lleg", "atras", "mala experiencia", "devolucion"])) {
        return {
            intent: "sac",
            department: "SAC",
            caseTopic: hasAny(text, ["despacho", "pedido", "no lleg", "atras"]) ? "pedido_despacho" : "reclamo",
            commercialStatus: "not_applicable",
            customerSignal: "complaint",
            finalAction: "handoff_to_human",
            requiresHuman: true,
            shouldReply: false,
            replyText: "",
            summaryForOperator: "Mensaje con senal SAC o problema operacional. Requiere revision humana.",
            nextAction: "assign_human",
            confidence: 0.88,
            reasonSummary: "Regla mock prioriza SAC ante reclamo, problema, despacho o pedido."
        };
    }
    if (hasAny(text, ["postventa", "armado", "armar", "instalacion", "mantencion", "mantencion", "garantia", "tecnico"])) {
        const canReply = request.featureFlags.allowAutoReply && !recoveryMode;
        return {
            intent: "postventa",
            department: "Postventa",
            caseTopic: hasAny(text, ["mantencion", "tecnico"]) ? "mantencion" : "armado_garantia",
            commercialStatus: "post_sale",
            customerSignal: "post_sale_help",
            finalAction: canReply ? "reply" : "handoff_to_human",
            requiresHuman: !canReply,
            shouldReply: canReply,
            replyText: canReply
                ? "Para ayudarte con postventa, indicanos el producto, la comuna y una breve descripcion de lo que necesitas revisar."
                : "",
            summaryForOperator: "Mensaje asociado a postventa. El mock evita prometer agenda o resolucion final.",
            nextAction: canReply ? "send_reply" : "assign_human",
            confidence: 0.84,
            reasonSummary: recoveryMode
                ? "Modo recovery bloquea autonomia y deriva a humano."
                : "Regla mock detecto armado, mantencion, garantia o postventa."
        };
    }
    if (hasAny(text, ["precio", "stock", "producto", "cotiz", "comprar", "valor", "disponible", "catalogo"])) {
        const canReply = request.featureFlags.allowAutoReply && !recoveryMode;
        return {
            intent: "sales",
            department: "Ventas",
            caseTopic: "cotizacion",
            commercialStatus: "quote_requested",
            customerSignal: hasAny(text, ["stock", "disponible"]) ? "asks_stock" : "asks_price",
            finalAction: canReply ? "reply" : "human_required",
            requiresHuman: !canReply,
            shouldReply: canReply,
            replyText: canReply
                ? "Tenemos opciones disponibles. Para orientarte mejor, indicanos el producto que buscas y tu comuna."
                : "",
            summaryForOperator: "Consulta comercial detectada por regla mock.",
            nextAction: canReply ? "send_reply" : "mark_human_required",
            confidence: 0.86,
            reasonSummary: recoveryMode
                ? "Modo recovery bloquea auto-reply comercial."
                : "Regla mock detecto precio, stock, producto o cotizacion."
        };
    }
    if (hasAny(text, ["seguimiento", "recordar", "mas tarde", "manana", "mañana"])) {
        return {
            intent: "followup",
            department: "Ventas",
            caseTopic: "seguimiento",
            commercialStatus: "followup_needed",
            customerSignal: "continue",
            finalAction: "followup_needed",
            requiresHuman: false,
            shouldReply: false,
            replyText: "",
            summaryForOperator: "Mensaje sugiere seguimiento futuro. No agenda nada en el mock.",
            nextAction: "schedule_followup",
            confidence: 0.78,
            reasonSummary: "Regla mock detecto senal de seguimiento."
        };
    }
    return {
        intent: "consulta_general",
        department: "Unknown",
        caseTopic: "unknown",
        commercialStatus: "unknown",
        customerSignal: "no_signal",
        finalAction: "no_action",
        requiresHuman: false,
        shouldReply: false,
        replyText: "",
        summaryForOperator: "El mock no detecto una accion clara.",
        nextAction: "noop",
        confidence: 0.72,
        reasonSummary: "No hubo match deterministico con reglas de venta, postventa, SAC, cierre o seguimiento."
    };
}
function buildEnvelope(request, decision, decisionId, warnings) {
    return {
        decisionId,
        agentName: AGENT_NAME,
        agentVersion: AGENT_VERSION,
        source: request.source,
        intent: decision.intent,
        department: decision.department,
        caseTopic: decision.caseTopic,
        commercialStatus: decision.commercialStatus,
        customerSignal: decision.customerSignal,
        finalAction: decision.finalAction,
        requiresHuman: decision.requiresHuman,
        shouldReply: decision.shouldReply,
        replyText: decision.replyText,
        summaryForOperator: decision.summaryForOperator,
        nextAction: decision.nextAction,
        nextActionAt: decision.finalAction === "followup_needed" ? new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString() : null,
        confidence: decision.confidence,
        reasonSummary: decision.reasonSummary,
        safetyFlags: {
            invalidOutput: false,
            timeout: false,
            contextExceeded: false,
            lowConfidence: decision.confidence < 0.7,
            featureDisabled: warnings.some((warning) => warning.includes("disabled")),
            modelUnavailable: false
        },
        metadata: {
            contextMode: request.contextMode,
            modelProvider: "mock",
            modelName: "deterministic-rules",
            promptVersion: "none",
            validatorVersion: VALIDATOR_VERSION,
            dryRun: request.featureFlags.dryRun,
            generatedAt: new Date().toISOString(),
            warnings
        }
    };
}
function planAction(type, flags, allowed, reason) {
    if (!allowed) {
        return { type, status: "blocked", enabled: false, reason };
    }
    if (flags.dryRun) {
        return { type, status: "planned", enabled: false, reason: `dryRun=true: ${reason}` };
    }
    return { type, status: "planned", enabled: true, reason };
}
function planActions(envelope, flags) {
    const errors = [];
    if (envelope.finalAction === "reply") {
        const allowed = flags.allowAutoReply;
        if (!allowed)
            errors.push(makeError("FEATURE_DISABLED", "allowAutoReply=false blocked reply action.", false));
        return {
            actions: [planAction("send_whatsapp_reply", flags, allowed, "Mock planned WhatsApp reply. Endpoint did not send it.")],
            errors
        };
    }
    if (envelope.finalAction === "handoff_to_human" || envelope.finalAction === "human_required") {
        const handoffAllowed = flags.allowHumanHandoff;
        const mutationAllowed = flags.allowCaseMutation;
        if (!handoffAllowed)
            errors.push(makeError("FEATURE_DISABLED", "allowHumanHandoff=false blocked handoff action.", false));
        if (!mutationAllowed)
            errors.push(makeError("FEATURE_DISABLED", "allowCaseMutation=false blocked case update.", false));
        return {
            actions: [
                planAction("assign_human", flags, handoffAllowed, "Mock planned human handoff. Endpoint did not assign."),
                planAction("update_case", flags, mutationAllowed, "Mock planned human_required case update. Endpoint did not write DB.")
            ],
            errors
        };
    }
    if (envelope.finalAction === "close_case") {
        const allowed = flags.allowCaseMutation;
        if (!allowed)
            errors.push(makeError("FEATURE_DISABLED", "allowCaseMutation=false blocked close_case action.", false));
        return {
            actions: [planAction("close_case", flags, allowed, "Mock planned case close. Endpoint did not write DB.")],
            errors
        };
    }
    if (envelope.finalAction === "followup_needed") {
        const allowed = flags.allowFollowup && flags.allowCaseMutation;
        if (!flags.allowFollowup)
            errors.push(makeError("FEATURE_DISABLED", "allowFollowup=false blocked follow-up action.", false));
        if (!flags.allowCaseMutation)
            errors.push(makeError("FEATURE_DISABLED", "allowCaseMutation=false blocked follow-up case mutation.", false));
        return {
            actions: [planAction("schedule_followup", flags, allowed, "Mock planned follow-up. Endpoint did not schedule.")],
            errors
        };
    }
    return { actions: [planAction("noop", flags, true, "No action required.")], errors };
}
function buildUsage(request, startedAt, outputChars = 0) {
    return {
        inputChars: request?.messageText.length ?? 0,
        contextChars: request ? Math.min(request.messageText.length, request.limits.maxContextChars) : 0,
        outputChars,
        historyMessages: 0,
        elapsedMs: Date.now() - startedAt
    };
}
function shouldWriteShadowLog(request) {
    return (request.featureFlags.dryRun === true &&
        request.featureFlags.shadowLog === true &&
        process.env.AI_ORCHESTRATOR_SHADOW_LOG_ENABLED === "true");
}
async function writeShadowLogIfEnabled(request, response, startedAt, rawRequest) {
    if (!shouldWriteShadowLog(request))
        return null;
    const writeResult = await (0, shadow_log_1.writeAiOrchestratorShadowLog)({
        waId: request.waId,
        phoneNumberId: request.phoneNumberId,
        messageId: request.messageId,
        conversationCaseId: request.conversationCaseId,
        backendDecisionId: response.decisionId,
        backendIntent: response.envelope?.intent,
        backendDepartment: response.envelope?.department,
        backendFinalAction: response.envelope?.finalAction,
        backendRequiresHuman: response.envelope?.requiresHuman,
        backendShouldReply: response.envelope?.shouldReply,
        backendConfidence: response.envelope?.confidence,
        backendOk: response.ok,
        backendError: response.errors.map((item) => `${item.code}: ${item.message}`).join(" | ") || null,
        latencyMs: Date.now() - startedAt,
        rawRequestJson: rawRequest,
        rawResponseJson: response
    });
    return writeResult.ok ? null : makeError("UNHANDLED_ERROR", `Shadow log failed: ${writeResult.error}`, true);
}
function buildInvalidRequestResponse(input, errors, startedAt) {
    const record = typeof input === "object" && input !== null && !Array.isArray(input) ? input : {};
    const source = record.source === "n8n_meta_webhook" || record.source === "hub_preview" || record.source === "system_job" ? record.source : "manual_test";
    const contextMode = record.contextMode === "standard" || record.contextMode === "recovery" ? record.contextMode : "minimal";
    const messageId = typeof record.messageId === "string" && record.messageId.trim() ? record.messageId.trim() : "invalid-request";
    const messageText = typeof record.messageText === "string" ? record.messageText : "";
    const fallbackRequest = {
        source,
        contextMode,
        waId: typeof record.waId === "string" ? record.waId : "unknown",
        phoneNumberId: typeof record.phoneNumberId === "string" ? record.phoneNumberId : "unknown",
        messageId,
        messageText,
        limits: {
            maxHistoryMessages: 0,
            maxContextChars: Math.max(1000, messageText.length),
            maxOutputTokens: 100,
            timeoutMs: 1000
        },
        featureFlags: {
            allowAutoReply: false,
            allowCaseMutation: false,
            allowHumanHandoff: true,
            allowCaseClose: false,
            allowFollowup: false,
            shadowLog: false,
            dryRun: true
        }
    };
    const envelope = (0, validation_1.buildSafeFallbackEnvelope)(fallbackRequest, errors[0]?.code ?? "INVALID_INPUT", "Request invalido; mock fallo cerrado.");
    const retryableErrors = errors.map((item) => ({
        ...item,
        retryable: item.code === "INVALID_INPUT" || item.code === "CONTEXT_EXCEEDED" ? true : item.retryable
    }));
    return {
        ok: false,
        decisionId: envelope.decisionId,
        envelope: { ...envelope, finalAction: "no_action", nextAction: "noop", requiresHuman: true },
        actions: [{ type: "noop", status: "blocked", enabled: false, reason: "Invalid request; no action planned." }],
        usage: buildUsage(fallbackRequest, startedAt),
        errors: retryableErrors
    };
}
async function POST(request) {
    const auth = await (0, auth_1.requireAiOrchestrationAccess)(request);
    if (!auth.ok)
        return auth.response;
    const startedAt = Date.now();
    let body;
    try {
        body = await request.json();
    }
    catch {
        const response = {
            ok: false,
            decisionId: null,
            envelope: null,
            actions: [{ type: "noop", status: "blocked", enabled: false, reason: "Invalid JSON; no action planned." }],
            usage: { inputChars: 0, contextChars: 0, outputChars: 0, historyMessages: 0, elapsedMs: Date.now() - startedAt },
            errors: [makeError("INVALID_INPUT", "Request body must be valid JSON.", true)]
        };
        return Response.json(response);
    }
    const requestResult = (0, validation_1.validateAiOrchestrationRequest)(body);
    if (!requestResult.ok) {
        return Response.json(buildInvalidRequestResponse(body, requestResult.errors, startedAt));
    }
    const orchestrationRequest = requestResult.value;
    const warnings = ["mock endpoint: no LLM, no DB writes, no WhatsApp send"];
    const decision = classifyMockDecision(orchestrationRequest);
    const decisionId = makeDecisionId(orchestrationRequest);
    const envelope = buildEnvelope(orchestrationRequest, decision, decisionId, warnings);
    const planned = planActions(envelope, orchestrationRequest.featureFlags);
    const response = {
        ok: true,
        decisionId,
        envelope,
        actions: planned.actions,
        usage: buildUsage(orchestrationRequest, startedAt, JSON.stringify(envelope).length),
        errors: planned.errors
    };
    const responseValidation = (0, validation_1.validateAiOrchestrationResponse)(response, orchestrationRequest.featureFlags);
    if (!responseValidation.ok) {
        const fallback = (0, validation_1.buildSafeFallbackEnvelope)(orchestrationRequest, "INVALID_OUTPUT", "Mock response failed contract validation.");
        return Response.json({
            ok: false,
            decisionId: fallback.decisionId,
            envelope: fallback,
            actions: [{ type: "noop", status: "blocked", enabled: false, reason: "Response validation failed; no action planned." }],
            usage: buildUsage(orchestrationRequest, startedAt, JSON.stringify(fallback).length),
            errors: responseValidation.errors
        });
    }
    const validatedResponse = responseValidation.value;
    const shadowLogError = await writeShadowLogIfEnabled(orchestrationRequest, validatedResponse, startedAt, body);
    if (shadowLogError) {
        validatedResponse.errors.push(shadowLogError);
        if (validatedResponse.envelope) {
            validatedResponse.envelope.metadata.warnings.push(shadowLogError.message);
        }
    }
    return Response.json(validatedResponse);
}

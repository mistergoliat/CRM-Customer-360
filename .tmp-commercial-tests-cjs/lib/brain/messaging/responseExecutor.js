"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeBrainExecuteRequest = normalizeBrainExecuteRequest;
exports.evaluateBrainExecution = evaluateBrainExecution;
exports.resolveBrainExecution = resolveBrainExecution;
const metaPayload_1 = require("./metaPayload");
const metaSendAdapter_1 = require("./metaSendAdapter");
const outbox_1 = require("./outbox");
const dedupe_1 = require("./dedupe");
const MAX_MESSAGE_TEXT_CHARS = 24000;
const BRAIN_EXECUTE_RESPONSE_VERSION = "brain.response-executor.v1";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function asOptionalStringOrNumber(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    if (typeof value === "string" || typeof value === "number")
        return value;
    return undefined;
}
function asBoolean(value, fallback) {
    if (typeof value === "boolean")
        return value;
    if (value === 1 || value === "1" || String(value).toLowerCase() === "true")
        return true;
    if (value === 0 || value === "0" || String(value).toLowerCase() === "false")
        return false;
    return fallback;
}
function error(message, details) {
    return {
        code: "INVALID_INPUT",
        message,
        retryable: true,
        details
    };
}
function blockReason(code, message, retryable = false, details) {
    return {
        code,
        message,
        retryable,
        details
    };
}
function normalizeSource(value) {
    return value === "brain" || value === "n8n" || value === "operator" ? value : null;
}
function normalizeActionType(value) {
    return value === "send_whatsapp_message" || value === "update_case" || value === "handoff" || value === "close_case" || value === "no_action"
        ? value
        : null;
}
function pickBoolean(...values) {
    for (const value of values) {
        if (typeof value === "boolean")
            return value;
    }
    return undefined;
}
function normalizeActionPolicy(input) {
    if (!isRecord(input))
        return undefined;
    return {
        allowedToAutoReply: pickBoolean(input.allowedToAutoReply, input.can_auto_reply, input.canAutoReply),
        can_auto_reply: pickBoolean(input.can_auto_reply, input.allowedToAutoReply, input.canAutoReply),
        requiresHuman: pickBoolean(input.requiresHuman, input.requires_human),
        requires_human: pickBoolean(input.requires_human, input.requiresHuman),
        blockedReasons: Array.isArray(input.blockedReasons) ? input.blockedReasons.filter((item) => typeof item === "string") : undefined,
        blocked_reasons: Array.isArray(input.blocked_reasons) ? input.blocked_reasons.filter((item) => typeof item === "string") : undefined,
        canAutoReply: pickBoolean(input.canAutoReply, input.allowedToAutoReply, input.can_auto_reply),
        canHumanHandoff: pickBoolean(input.canHumanHandoff, input.can_human_handoff),
        canCaseMutation: pickBoolean(input.canCaseMutation, input.can_case_mutation),
        continueLegacyFlow: pickBoolean(input.continueLegacyFlow, input.continue_legacy_flow),
        reason: asString(input.reason) ?? undefined
    };
}
function normalizeBotEligibility(input) {
    if (!isRecord(input))
        return undefined;
    return {
        canAutoReply: pickBoolean(input.canAutoReply, input.can_auto_reply),
        can_auto_reply: pickBoolean(input.can_auto_reply, input.canAutoReply),
        requiresHuman: pickBoolean(input.requiresHuman, input.requires_human),
        requires_human: pickBoolean(input.requires_human, input.requiresHuman),
        blockedReasons: Array.isArray(input.blockedReasons) ? input.blockedReasons.filter((item) => typeof item === "string") : undefined,
        blocked_reasons: Array.isArray(input.blocked_reasons) ? input.blocked_reasons.filter((item) => typeof item === "string") : undefined,
        suppressionActive: pickBoolean(input.suppressionActive, input.suppression_active),
        suppression_active: pickBoolean(input.suppression_active, input.suppressionActive),
        recentManualReply: pickBoolean(input.recentManualReply, input.recent_manual_reply),
        recent_manual_reply: pickBoolean(input.recent_manual_reply, input.recentManualReply),
        activeHumanLock: pickBoolean(input.activeHumanLock, input.active_human_lock, input.manualOperatorLock, input.manual_operator_lock),
        active_human_lock: pickBoolean(input.active_human_lock, input.activeHumanLock, input.manual_operator_lock, input.manualOperatorLock),
        manualOperatorLock: pickBoolean(input.manualOperatorLock, input.manual_operator_lock),
        manual_operator_lock: pickBoolean(input.manual_operator_lock, input.manualOperatorLock),
        activeHumanCase: pickBoolean(input.activeHumanCase, input.active_human_case),
        active_human_case: pickBoolean(input.active_human_case, input.activeHumanCase),
        openCaseWaitingHuman: pickBoolean(input.openCaseWaitingHuman, input.open_case_waiting_human),
        open_case_waiting_human: pickBoolean(input.open_case_waiting_human, input.openCaseWaitingHuman),
        activeCaseId: asOptionalStringOrNumber(input.activeCaseId)
    };
}
function normalizeContext(input) {
    if (!isRecord(input))
        return undefined;
    return {
        waId: asString(input.waId) ?? asString(input.wa_id) ?? undefined,
        phoneNumberId: asString(input.phoneNumberId) ?? asString(input.phone_number_id) ?? undefined,
        messageId: asString(input.messageId) ?? asString(input.message_id) ?? undefined,
        conversationCaseId: asOptionalStringOrNumber(input.conversationCaseId) ?? asOptionalStringOrNumber(input.conversation_case_id),
        messageText: asString(input.messageText) ?? asString(input.message_text) ?? undefined,
        sourceWorkflow: asString(input.sourceWorkflow) ?? asString(input.source_workflow) ?? undefined,
        sourceNode: asString(input.sourceNode) ?? asString(input.source_node) ?? undefined
    };
}
function normalizeOptions(input) {
    if (!isRecord(input))
        return undefined;
    return {
        dryRun: asBoolean(input.dryRun, true),
        executeActions: asBoolean(input.executeActions, false),
        persistOutboxPlan: asBoolean(input.persistOutboxPlan, false)
    };
}
function makeValidationError(message, details) {
    return error(message, details);
}
function validationReasonCode(error) {
    const field = typeof error.details?.field === "string" ? error.details.field : null;
    if (field === "dryRun")
        return "dry_run_required";
    if (field === "executeActions")
        return "execute_actions_disabled";
    if (field === "source")
        return "source_required";
    if (field === "action.type")
        return "action_type_required";
    if (field === "context.waId")
        return "wa_id_required";
    if (field === "context.phoneNumberId")
        return "phone_number_id_required";
    if (field === "context.messageText") {
        return error.message.includes("maximum allowed length") ? "message_text_too_long" : "message_text_required";
    }
    return "invalid_input";
}
function collectPolicyBlockedReasons(policy) {
    const reasons = new Set();
    const raw = policy?.blockedReasons ?? policy?.blocked_reasons ?? [];
    for (const reason of raw)
        reasons.add(reason);
    return reasons;
}
function collectEligibilityBlockedReasons(botEligibility) {
    const reasons = new Set();
    const raw = botEligibility?.blockedReasons ?? botEligibility?.blocked_reasons ?? [];
    for (const reason of raw)
        reasons.add(reason);
    if (botEligibility?.suppressionActive || botEligibility?.suppression_active)
        reasons.add("suppression_active");
    if (botEligibility?.recentManualReply || botEligibility?.recent_manual_reply)
        reasons.add("recent_manual_reply");
    if (botEligibility?.activeHumanLock || botEligibility?.active_human_lock || botEligibility?.manualOperatorLock || botEligibility?.manual_operator_lock) {
        reasons.add("manual_operator_lock");
    }
    if (botEligibility?.activeHumanCase || botEligibility?.active_human_case)
        reasons.add("active_human_case");
    if (botEligibility?.openCaseWaitingHuman || botEligibility?.open_case_waiting_human)
        reasons.add("open_case_waiting_human");
    return reasons;
}
function buildInvalidPlan(request, reason, blockedReasons, requiresHuman, status, actionType = request.action.type) {
    return {
        type: actionType,
        status,
        executable: false,
        requires_human: requiresHuman,
        reason,
        source: request.source,
        blocked_reasons: blockedReasons,
        block_reasons: blockedReasons.map((code) => blockReason(code, code, code !== "dry_run_only")),
        meta_payload_preview: null,
        outbox_preview: null
    };
}
function canAutoReply(policy, botEligibility) {
    return Boolean(policy?.allowedToAutoReply ??
        policy?.can_auto_reply ??
        policy?.canAutoReply ??
        botEligibility?.canAutoReply ??
        botEligibility?.can_auto_reply);
}
function canHumanHandoff(policy, botEligibility) {
    return Boolean(policy?.canHumanHandoff ?? botEligibility?.requiresHuman === false);
}
function canCaseMutation(policy) {
    return Boolean(policy?.canCaseMutation);
}
function buildValidationErrors(request) {
    const errors = [];
    const context = request.context ?? {};
    if (!request.dryRun) {
        errors.push(makeValidationError("dryRun=true is required by the Response Executor foundation.", { field: "dryRun" }));
    }
    if (request.executeActions) {
        errors.push(makeValidationError("executeActions=true is not allowed.", { field: "executeActions" }));
    }
    if (request.action.type === "send_whatsapp_message") {
        if (!context.waId) {
            errors.push(makeValidationError("waId is required for send_whatsapp_message.", { field: "context.waId" }));
        }
        if (!context.phoneNumberId) {
            errors.push(makeValidationError("phoneNumberId is required for send_whatsapp_message.", { field: "context.phoneNumberId" }));
        }
        if (!context.messageText || !context.messageText.trim()) {
            errors.push(makeValidationError("messageText is required for send_whatsapp_message.", { field: "context.messageText" }));
        }
        else if (context.messageText.trim().length > MAX_MESSAGE_TEXT_CHARS) {
            errors.push(makeValidationError("messageText exceeds the maximum allowed length.", {
                field: "context.messageText",
                maxMessageTextChars: MAX_MESSAGE_TEXT_CHARS
            }));
        }
    }
    return errors;
}
function buildActionBlockedReasons(request) {
    const blockedReasons = new Set();
    const policyReasons = collectPolicyBlockedReasons(request.actionPolicy);
    const eligibilityReasons = collectEligibilityBlockedReasons(request.botEligibility);
    if (request.action.type === "send_whatsapp_message") {
        if (!canAutoReply(request.actionPolicy, request.botEligibility))
            blockedReasons.add("auto_reply_not_allowed");
        if (request.botEligibility?.requiresHuman || request.botEligibility?.requires_human || request.actionPolicy?.requiresHuman || request.actionPolicy?.requires_human) {
            blockedReasons.add("requires_human");
        }
        for (const reason of eligibilityReasons)
            blockedReasons.add(reason);
        for (const reason of policyReasons)
            blockedReasons.add(reason);
    }
    else if (request.action.type === "update_case" || request.action.type === "handoff" || request.action.type === "close_case") {
        if (!canCaseMutation(request.actionPolicy))
            blockedReasons.add("case_mutation_disabled");
        if (request.action.type === "handoff" && !canHumanHandoff(request.actionPolicy, request.botEligibility))
            blockedReasons.add("human_handoff_disabled");
        if (request.action.type === "close_case" && !canCaseMutation(request.actionPolicy))
            blockedReasons.add("case_close_disabled");
        for (const reason of eligibilityReasons)
            blockedReasons.add(reason);
        for (const reason of policyReasons)
            blockedReasons.add(reason);
        blockedReasons.add("dry_run_only");
    }
    return [...blockedReasons];
}
function buildPlanReason(request, blockedReasons, errors) {
    if (errors.length > 0)
        return errors[0]?.message ?? "Invalid execution request.";
    if (request.action.type === "no_action")
        return "no_action";
    if (request.action.type === "send_whatsapp_message" && blockedReasons.length === 0)
        return "dry_run_only";
    if (blockedReasons.length > 0)
        return blockedReasons[0] ?? "action_blocked";
    return "dry_run_only";
}
function buildMetaPreview(request) {
    const context = request.context ?? {};
    if (request.action.type !== "send_whatsapp_message")
        return null;
    const text = asString(request.action.payload?.messageText) ?? context.messageText ?? "";
    const waId = asString(request.action.payload?.waId) ?? context.waId ?? "";
    if (!waId || !text.trim())
        return null;
    return (0, metaPayload_1.buildMetaWhatsAppTextPayloadPreview)({ waId, messageText: text });
}
function buildResponseFromRequest(request, startedAt = Date.now()) {
    const errors = buildValidationErrors(request);
    const validationBlockedReasons = errors.map(validationReasonCode);
    const blockedReasons = [...new Set([...validationBlockedReasons, ...buildActionBlockedReasons(request)])];
    const hasMeaningfulBlock = blockedReasons.some((reason) => reason !== "dry_run_only");
    const requiresHuman = request.action.type === "no_action" ||
        errors.length > 0 ||
        Boolean(request.botEligibility?.requiresHuman || request.botEligibility?.requires_human || request.actionPolicy?.requiresHuman || request.actionPolicy?.requires_human) ||
        hasMeaningfulBlock;
    const invalidRequest = errors.length > 0;
    const noAction = request.action.type === "no_action";
    const dryRunOnly = request.dryRun && !request.executeActions;
    const canPreviewSend = request.action.type === "send_whatsapp_message" && !invalidRequest && blockedReasons.length === 0 && dryRunOnly;
    const metaPayloadPreview = canPreviewSend ? buildMetaPreview(request) : null;
    const dedupeCheck = (0, dedupe_1.checkDuplicateNoop)({
        source: request.source,
        actionType: request.action.type,
        waId: request.context?.waId,
        phoneNumberId: request.context?.phoneNumberId,
        messageId: request.context?.messageId,
        conversationCaseId: request.context?.conversationCaseId,
        messageText: request.context?.messageText
    });
    const outboxPreview = request.action.type === "send_whatsapp_message" && !invalidRequest
        ? (0, outbox_1.buildOutboxPreview)({
            actionType: request.action.type,
            status: canPreviewSend ? "planned" : blockedReasons.length > 0 ? "blocked" : noAction ? "noop" : "planned",
            dedupeCheck,
            reason: canPreviewSend ? "dry_run_only" : buildPlanReason(request, blockedReasons, errors)
        })
        : null;
    const planStatus = invalidRequest
        ? noAction
            ? "noop"
            : "blocked"
        : noAction
            ? "noop"
            : blockedReasons.length > 0
                ? "blocked"
                : "planned";
    const executionPlan = invalidRequest && request.action.type === "send_whatsapp_message"
        ? buildInvalidPlan(request, buildPlanReason(request, blockedReasons, errors), blockedReasons.length > 0 ? blockedReasons : validationBlockedReasons, true, "noop", "no_action")
        : request.action.type === "send_whatsapp_message"
            ? {
                type: request.action.type,
                status: planStatus,
                executable: false,
                requires_human: requiresHuman,
                reason: buildPlanReason(request, blockedReasons, errors),
                source: request.source,
                blocked_reasons: blockedReasons,
                block_reasons: blockedReasons.map((code) => blockReason(code, code, code !== "dry_run_only")),
                meta_payload_preview: metaPayloadPreview,
                outbox_preview: outboxPreview
            }
            : buildInvalidPlan(request, request.action.type === "no_action" ? "no_action" : blockedReasons[0] ?? "dry_run_only", blockedReasons, requiresHuman, planStatus);
    const warnings = [...new Set([
            ...(request.actionPolicy ? [] : ["actionPolicy missing; conservative defaults applied."]),
            ...(request.botEligibility ? [] : ["botEligibility missing; conservative defaults applied."]),
            ...(errors.length > 0 ? errors.map((item) => item.message) : [])
        ])];
    return {
        ok: errors.length === 0,
        dryRun: request.dryRun,
        executable: false,
        requires_human: requiresHuman,
        execution_plan: executionPlan,
        outbox_result: null,
        blocked_reasons: blockedReasons,
        block_reasons: executionPlan.block_reasons,
        meta_payload_preview: metaPayloadPreview,
        outbox_preview: outboxPreview,
        warnings,
        errors,
        metadata: {
            version: BRAIN_EXECUTE_RESPONSE_VERSION,
            generatedAt: new Date().toISOString(),
            processingMs: Date.now() - startedAt,
            source: request.source,
            dryRun: request.dryRun,
            executeActions: request.executeActions,
            send_adapter_status: (0, metaSendAdapter_1.getMetaSendAdapterStatus)()
        }
    };
}
function normalizeBrainExecuteRequest(input) {
    if (!isRecord(input)) {
        return {
            ok: false,
            value: null,
            errors: [makeValidationError("Request body must be an object.")]
        };
    }
    const actionInput = isRecord(input.action) ? input.action : null;
    const source = normalizeSource(input.source);
    const actionType = actionInput ? normalizeActionType(actionInput.type) : normalizeActionType(input.actionType);
    const context = normalizeContext(input.context ?? input.payload ?? input);
    const options = normalizeOptions(input);
    const actionPolicy = normalizeActionPolicy(input.actionPolicy ?? input.action_policy);
    const botEligibility = normalizeBotEligibility(input.botEligibility ?? input.bot_eligibility);
    const errors = [];
    if (!source)
        errors.push(makeValidationError("source must be one of brain, n8n or operator.", { field: "source" }));
    if (!actionType)
        errors.push(makeValidationError("action.type is required and must be valid.", { field: "action.type" }));
    if (!options?.dryRun)
        errors.push(makeValidationError("dryRun=true is required.", { field: "dryRun" }));
    if (options?.executeActions)
        errors.push(makeValidationError("executeActions=true is not allowed.", { field: "executeActions" }));
    if (actionType === "send_whatsapp_message") {
        if (!context?.waId)
            errors.push(makeValidationError("context.waId is required.", { field: "context.waId" }));
        if (!context?.phoneNumberId)
            errors.push(makeValidationError("context.phoneNumberId is required.", { field: "context.phoneNumberId" }));
        if (!context?.messageText || !context.messageText.trim()) {
            errors.push(makeValidationError("context.messageText is required.", { field: "context.messageText" }));
        }
        else if (context.messageText.trim().length > MAX_MESSAGE_TEXT_CHARS) {
            errors.push(makeValidationError("context.messageText exceeds the maximum allowed length.", {
                field: "context.messageText",
                maxMessageTextChars: MAX_MESSAGE_TEXT_CHARS
            }));
        }
    }
    if (errors.length > 0 || !source || !actionType || !options) {
        return { ok: false, value: null, errors };
    }
    return {
        ok: true,
        value: {
            requestId: asString(input.requestId) ?? undefined,
            source,
            dryRun: options.dryRun,
            executeActions: options.executeActions,
            action: {
                type: actionType,
                payload: actionInput && isRecord(actionInput.payload) ? actionInput.payload : isRecord(input.payload) ? input.payload : undefined,
                source: normalizeSource((actionInput && actionInput.source) ?? input.source) ?? "brain"
            },
            actionPolicy,
            botEligibility,
            context,
            metadata: isRecord(input.metadata) ? input.metadata : {},
            warnings: Array.isArray(input.warnings) ? input.warnings.filter((item) => typeof item === "string") : undefined
        },
        errors: []
    };
}
function evaluateBrainExecution(request, startedAt = Date.now()) {
    return buildResponseFromRequest(request, startedAt);
}
function buildPersistedOutboxPayload(request, response, sourceRequestId) {
    const actionPayload = isRecord(request.action.payload) ? request.action.payload : null;
    const messageText = request.context?.messageText ?? asString(actionPayload?.messageText) ?? "";
    const waId = request.context?.waId ?? asString(actionPayload?.waId) ?? null;
    const phoneNumberId = request.context?.phoneNumberId ?? asString(actionPayload?.phoneNumberId) ?? null;
    const conversationCaseId = request.context?.conversationCaseId ?? asOptionalStringOrNumber(actionPayload?.conversationCaseId) ?? null;
    const sourceAgentName = isRecord(request.metadata) ? asString(request.metadata.source_agent_name) : null;
    const sourceAgentVersion = isRecord(request.metadata) ? asString(request.metadata.source_agent_version) : null;
    const dedupeKey = (0, dedupe_1.buildDedupeKey)({
        source: request.source,
        actionType: request.action.type,
        channel: "whatsapp",
        waId: waId ?? undefined,
        phoneNumberId: phoneNumberId ?? undefined,
        conversationCaseId: conversationCaseId ?? undefined,
        messageText,
        sourceRequestId
    });
    return {
        dedupe_key: dedupeKey,
        channel: "whatsapp",
        direction: "outbound",
        status: response.execution_plan.status === "blocked" ? "blocked" : "planned",
        source: request.source,
        source_request_id: sourceRequestId ?? null,
        source_agent_name: sourceAgentName,
        source_agent_version: sourceAgentVersion,
        wa_id: waId,
        phone_number_id: phoneNumberId,
        conversation_case_id: conversationCaseId,
        message_text: messageText || null,
        meta_payload_json: {
            model_version: BRAIN_EXECUTE_RESPONSE_VERSION,
            execution_plan: {
                type: response.execution_plan.type,
                status: response.execution_plan.status,
                reason: response.execution_plan.reason,
                source: response.execution_plan.source,
                blocked_reasons: response.execution_plan.blocked_reasons
            },
            meta_payload_preview: response.meta_payload_preview ?? null,
            outbox_preview: response.outbox_preview ?? null
        },
        provider_message_id: null,
        error_code: response.execution_plan.status === "blocked" ? "PLAN_BLOCKED" : null,
        error_message: response.execution_plan.status === "blocked" ? response.execution_plan.reason : null
    };
}
async function maybePersistOutboxPlan(request, response) {
    if (!request.persistOutboxPlan)
        return null;
    if (request.action.type !== "send_whatsapp_message")
        return null;
    if (response.execution_plan.status === "noop")
        return null;
    if (response.errors.length > 0)
        return null;
    const sourceRequestId = request.requestId ?? (isRecord(request.metadata) ? asString(request.metadata.source_request_id) ?? asString(request.metadata.request_id) : null);
    const payload = buildPersistedOutboxPayload(request, response, sourceRequestId);
    return (0, outbox_1.createOutboxPlannedRecord)({
        dedupeKeyInput: {
            source: request.source,
            actionType: request.action.type,
            channel: "whatsapp",
            waId: payload.wa_id ?? undefined,
            phoneNumberId: payload.phone_number_id ?? undefined,
            conversationCaseId: payload.conversation_case_id ?? undefined,
            messageText: payload.message_text ?? undefined,
            sourceRequestId
        },
        status: response.execution_plan.status === "blocked" ? "blocked" : "planned",
        source: payload.source,
        sourceRequestId,
        sourceAgentName: payload.source_agent_name,
        sourceAgentVersion: payload.source_agent_version,
        waId: payload.wa_id,
        phoneNumberId: payload.phone_number_id,
        conversationCaseId: payload.conversation_case_id,
        messageText: payload.message_text,
        metaPayloadJson: payload.meta_payload_json,
        providerMessageId: payload.provider_message_id,
        errorCode: payload.error_code,
        errorMessage: payload.error_message
    });
}
async function resolveBrainExecution(input, startedAt = Date.now()) {
    const normalizedResult = normalizeBrainExecuteRequest(input);
    if (!normalizedResult.ok) {
        const blockedReasons = normalizedResult.errors.map(validationReasonCode);
        const fallbackRequest = {
            requestId: undefined,
            source: "brain",
            dryRun: false,
            executeActions: false,
            action: {
                type: "no_action",
                source: "brain"
            },
            context: {},
            metadata: {}
        };
        const response = buildResponseFromRequest(fallbackRequest, startedAt);
        return {
            ...response,
            ok: false,
            execution_plan: buildInvalidPlan(fallbackRequest, normalizedResult.errors[0]?.message ?? "Invalid execution request.", blockedReasons.length > 0 ? blockedReasons : ["invalid_input"], true, "noop"),
            blocked_reasons: blockedReasons.length > 0 ? blockedReasons : ["invalid_input"],
            block_reasons: normalizedResult.errors.map((item) => blockReason(item.code, item.message, item.retryable, item.details)),
            warnings: normalizedResult.errors.map((item) => item.message),
            errors: normalizedResult.errors
        };
    }
    const request = normalizedResult.value;
    const response = evaluateBrainExecution(request, startedAt);
    const sourceRequestId = request.requestId ?? (isRecord(request.metadata) ? asString(request.metadata.source_request_id) ?? asString(request.metadata.request_id) : null);
    const persistedPreview = buildPersistedOutboxPayload(request, response, sourceRequestId);
    const outboxResult = await maybePersistOutboxPlan(request, response);
    return {
        ...response,
        outbox_result: outboxResult === null
            ? null
            : outboxResult.ok
                ? {
                    persisted: outboxResult.persisted,
                    existing: outboxResult.existing,
                    status: outboxResult.row.status,
                    dedupe_key: outboxResult.row.dedupe_key,
                    outbox_id: outboxResult.row.id ?? null,
                    warning: outboxResult.warning
                }
                : {
                    persisted: false,
                    existing: false,
                    status: response.execution_plan.status === "blocked" ? "blocked" : "planned",
                    dedupe_key: persistedPreview.dedupe_key,
                    outbox_id: null,
                    warning: outboxResult.warning,
                    error: outboxResult.warning
                },
        warnings: outboxResult?.warning ? [...response.warnings, outboxResult.warning] : response.warnings
    };
}

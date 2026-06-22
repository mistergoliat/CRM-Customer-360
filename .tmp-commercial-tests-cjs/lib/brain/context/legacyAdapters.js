"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_CASE_MANUAL_LOCK_STATUSES = exports.LEGACY_CASE_WAITING_HUMAN_STATUSES = exports.LEGACY_CASE_CLOSED_STATUSES = void 0;
exports.normalizeLegacyStatus = normalizeLegacyStatus;
exports.buildOptionalBrainError = buildOptionalBrainError;
exports.normalizeBrainContextResolveRequest = normalizeBrainContextResolveRequest;
exports.adaptBrainInboundToContextRequest = adaptBrainInboundToContextRequest;
exports.normalizeLegacyCaseRow = normalizeLegacyCaseRow;
exports.normalizeLegacyMessageRow = normalizeLegacyMessageRow;
exports.normalizeLegacyAgentRunRow = normalizeLegacyAgentRunRow;
exports.normalizeLegacySuppressionRow = normalizeLegacySuppressionRow;
exports.normalizeLegacyOrderRow = normalizeLegacyOrderRow;
exports.normalizeLegacyQueueRow = normalizeLegacyQueueRow;
exports.buildInputEvent = buildInputEvent;
exports.buildResolverIdentity = buildResolverIdentity;
exports.buildCustomerContext = buildCustomerContext;
exports.buildCustomerCandidateContextRequest = buildCustomerCandidateContextRequest;
exports.buildCaseContext = buildCaseContext;
exports.buildConversationContext = buildConversationContext;
exports.buildBusinessContext = buildBusinessContext;
exports.buildServiceContext = buildServiceContext;
exports.summarizeBotSignals = summarizeBotSignals;
exports.buildFallbackCustomerContext = buildFallbackCustomerContext;
exports.LEGACY_CASE_CLOSED_STATUSES = ["closed", "resolved", "done", "archived", "rejected", "rechazado", "cancelled", "canceled"];
exports.LEGACY_CASE_WAITING_HUMAN_STATUSES = ["waiting_human", "human_required", "waiting_company", "pending", "escalated"];
exports.LEGACY_CASE_MANUAL_LOCK_STATUSES = ["waiting_human", "human_required", "waiting_company", "manual_lock", "operator_lock"];
function normalizeLegacyStatus(value) {
    return String(value ?? "").toLowerCase();
}
function hasAnyLegacyStatus(values, candidates) {
    return values.some((value) => candidates.includes(normalizeLegacyStatus(value)));
}
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
function asBoolean(value, fallback = false) {
    if (typeof value === "boolean")
        return value;
    if (value === 1 || value === "1" || String(value).toLowerCase() === "true")
        return true;
    if (value === 0 || value === "0" || String(value).toLowerCase() === "false")
        return false;
    return fallback;
}
function boundedInt(value, fallback, min, max) {
    const numberValue = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numberValue))
        return fallback;
    return Math.min(max, Math.max(min, Math.floor(numberValue)));
}
function buildOptionalBrainError(message, details) {
    return {
        code: "CONTEXT_UNAVAILABLE",
        message,
        retryable: true,
        details
    };
}
function normalizeBrainContextResolveRequest(input) {
    if (!isRecord(input)) {
        return {
            ok: false,
            value: null,
            errors: [buildOptionalBrainError("Request body must be an object.")]
        };
    }
    const errors = [];
    const channel = asString(input.channel) === "whatsapp" ? "whatsapp" : null;
    const source = asString(input.source);
    const waId = asString(input.waId);
    const phoneNumberId = asString(input.phoneNumberId);
    const messageId = asString(input.messageId);
    const messageText = asString(input.messageText);
    if (!channel)
        errors.push(buildOptionalBrainError("channel must be whatsapp."));
    if (!source)
        errors.push(buildOptionalBrainError("source is required."));
    if (!waId)
        errors.push(buildOptionalBrainError("waId is required."));
    if (!phoneNumberId)
        errors.push(buildOptionalBrainError("phoneNumberId is required."));
    if (!messageId)
        errors.push(buildOptionalBrainError("messageId is required."));
    if (!messageText)
        errors.push(buildOptionalBrainError("messageText is required."));
    if (errors.length > 0) {
        return { ok: false, value: null, errors };
    }
    const optionsInput = isRecord(input.options) ? input.options : {};
    const options = {
        dryRun: asBoolean(optionsInput.dryRun, true),
        maxMessages: boundedInt(optionsInput.maxMessages, 12, 1, 30),
        maxAgentRuns: boundedInt(optionsInput.maxAgentRuns, 5, 1, 20),
        maxCases: boundedInt(optionsInput.maxCases, 5, 1, 20),
        includePostventa: asBoolean(optionsInput.includePostventa, true),
        includeAgentRuns: asBoolean(optionsInput.includeAgentRuns, true),
        debug: asBoolean(optionsInput.debug, false)
    };
    return {
        ok: true,
        value: {
            channel: channel,
            source: source,
            waId: waId,
            phoneNumberId: phoneNumberId,
            messageId: messageId,
            messageText: messageText,
            conversationCaseId: asOptionalStringOrNumber(input.conversationCaseId),
            idOrder: asOptionalStringOrNumber(input.idOrder),
            idCustomer: asOptionalStringOrNumber(input.idCustomer),
            invoiceNumber: asOptionalStringOrNumber(input.invoiceNumber),
            email: asString(input.email) ?? undefined,
            phone: asString(input.phone) ?? undefined,
            sourceWorkflow: asString(input.sourceWorkflow) ?? undefined,
            sourceNode: asString(input.sourceNode) ?? undefined,
            customerRef: isRecord(input.customerRef)
                ? {
                    waId: asString(input.customerRef.waId) ?? undefined,
                    phoneNumberId: asString(input.customerRef.phoneNumberId) ?? undefined,
                    idCustomer: asOptionalStringOrNumber(input.customerRef.idCustomer),
                    idOrder: asOptionalStringOrNumber(input.customerRef.idOrder),
                    invoiceNumber: asOptionalStringOrNumber(input.customerRef.invoiceNumber),
                    email: asString(input.customerRef.email) ?? undefined,
                    phone: asString(input.customerRef.phone) ?? undefined,
                    contactId: asOptionalStringOrNumber(input.customerRef.contactId)
                }
                : undefined,
            options
        },
        errors: []
    };
}
function adaptBrainInboundToContextRequest(request) {
    return {
        channel: request.channel,
        source: request.source,
        waId: request.waId,
        phoneNumberId: request.phoneNumberId,
        messageId: request.messageId,
        messageText: request.messageText,
        conversationCaseId: request.conversationCaseId,
        idOrder: request.customerRef?.idOrder,
        idCustomer: request.customerRef?.idCustomer,
        invoiceNumber: request.customerRef?.invoiceNumber,
        email: request.customerRef?.email,
        phone: request.customerRef?.phone,
        sourceWorkflow: request.sourceWorkflow,
        sourceNode: request.sourceNode,
        customerRef: request.customerRef,
        options: {
            dryRun: request.options.dryRun,
            maxMessages: 12,
            maxAgentRuns: 5,
            maxCases: 5,
            includePostventa: true,
            includeAgentRuns: true,
            debug: request.options.debug
        }
    };
}
function toNullableString(value) {
    if (value === undefined || value === null || value === "")
        return null;
    return String(value);
}
function toNullableNumber(value) {
    if (value === undefined || value === null || value === "")
        return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function toNullableStringOrNumber(value) {
    if (value === undefined || value === null || value === "")
        return null;
    if (typeof value === "string" || typeof value === "number")
        return value;
    return String(value);
}
function toNullableBool(value) {
    if (value === undefined || value === null || value === "")
        return false;
    return asBoolean(value, false);
}
function toNullableConfidence(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function includesAny(text, terms) {
    const normalized = normalizeLegacyStatus(text);
    return terms.some((term) => normalized.includes(term));
}
function normalizeLegacyCaseRow(row, sourceTable) {
    return {
        conversation_case_id: toNullableNumber(row.conversation_case_id ?? row.case_id ?? row.id),
        active_case_key: toNullableString(row.active_case_key),
        status: toNullableString(row.status),
        lifecycle_status: toNullableString(row.lifecycle_status),
        department: toNullableString(row.department),
        service_code: toNullableString(row.service_code),
        priority: toNullableString(row.priority),
        requires_human: toNullableBool(row.requires_human),
        bot_replied: toNullableBool(row.bot_replied),
        final_action: toNullableString(row.final_action),
        ai_blocked: toNullableBool(row.ai_blocked ?? row.block_ai ?? row.ai_autoreply_blocked ?? row.auto_reply_blocked ?? row.disable_ai ?? row.disable_autoreply ?? row.bot_blocked ?? row.human_lock),
        wa_id: toNullableString(row.wa_id ?? row.phone_normalized),
        phone_number_id: toNullableString(row.phone_number_id),
        id_order: toNullableNumber(row.id_order),
        id_customer: toNullableNumber(row.id_customer),
        invoice_number: toNullableNumber(row.invoice_number),
        source_table: sourceTable,
        source_id: toNullableNumber(row.source_id ?? row.id),
        whatsapp_window_open: row.whatsapp_window_open === undefined ? null : toNullableBool(row.whatsapp_window_open),
        last_message_at: toNullableString(row.last_message_at),
        created_at: toNullableString(row.created_at),
        updated_at: toNullableString(row.updated_at),
        closed_at: toNullableString(row.closed_at),
        raw_status: toNullableString(row.status)
    };
}
function normalizeLegacyMessageRow(row, sourceTable) {
    const direction = String(row.direction ?? row.message_direction ?? "").toLowerCase();
    const normalizedDirection = direction === "inbound" || direction === "outbound" || direction === "manual" ? direction : null;
    const statusText = normalizeLegacyStatus(row.status ?? row.message_status ?? row.processing_status);
    const finalActionText = normalizeLegacyStatus(row.final_action ?? row.last_message_final_action);
    const messageTypeText = normalizeLegacyStatus(row.message_type);
    const inferredDirection = normalizedDirection ??
        (sourceTable === "n8n_wa_inbound_messages"
            ? "inbound"
            : includesAny(`${statusText} ${finalActionText} ${messageTypeText}`, ["manual", "reply", "operator"])
                ? "manual"
                : includesAny(`${statusText} ${finalActionText} ${messageTypeText}`, ["outbound", "sent", "delivered", "read", "failed", "system"])
                    ? "outbound"
                    : "system");
    return {
        message_id: toNullableStringOrNumber(row.id ?? row.message_id ?? row.provider_message_id),
        conversation_case_id: toNullableNumber(row.conversation_case_id),
        wa_id: toNullableString(row.wa_id),
        phone_number_id: toNullableString(row.phone_number_id),
        direction: inferredDirection,
        message_type: toNullableString(row.message_type),
        message_text: toNullableString(row.message_text ?? row.text ?? row.body ?? row.message ?? row.content ?? row.raw_text ?? row.last_message),
        final_action: toNullableString(row.final_action ?? row.last_message_final_action),
        status: toNullableString(row.status ?? row.message_status ?? row.processing_status),
        intent: toNullableString(row.intent ?? row.last_message_intent),
        department: toNullableString(row.department ?? row.last_message_department),
        occurred_at: toNullableString(row.occurred_at ?? row.message_at ?? row.sent_at ?? row.received_at),
        created_at: toNullableString(row.created_at),
        updated_at: toNullableString(row.updated_at),
        source_table: sourceTable,
        source_id: toNullableStringOrNumber(row.source_id ?? row.id),
        technical_origin: toNullableString(row.source_table ?? row.processing_route ?? sourceTable)
    };
}
function normalizeLegacyAgentRunRow(row, sourceTable) {
    return {
        agent_name: toNullableString(row.agent_name),
        agent_version: toNullableString(row.agent_version),
        status: toNullableString(row.status),
        intent: toNullableString(row.intent),
        confidence: toNullableConfidence(row.confidence),
        risk_level: toNullableString(row.risk_level),
        requires_human: row.requires_human === undefined ? null : toNullableBool(row.requires_human),
        target_agent: toNullableString(row.target_agent),
        source_table: sourceTable,
        source_id: toNullableStringOrNumber(row.source_id ?? row.id),
        customer_id: toNullableStringOrNumber(row.customer_id),
        case_id: toNullableStringOrNumber(row.case_id),
        conversation_message_id: toNullableStringOrNumber(row.conversation_message_id),
        created_at: toNullableString(row.created_at),
        updated_at: toNullableString(row.updated_at)
    };
}
function normalizeLegacySuppressionRow(row, sourceTable) {
    return {
        wa_id: toNullableString(row.wa_id ?? row.phone_normalized),
        phone_number_id: toNullableString(row.phone_number_id),
        contact_id: toNullableStringOrNumber(row.contact_id),
        id_customer: toNullableStringOrNumber(row.id_customer),
        id_order: toNullableStringOrNumber(row.id_order),
        invoice_number: toNullableStringOrNumber(row.invoice_number),
        suppression_active: toNullableBool(row.suppression_active ?? row.active ?? row.blocked ?? row.hard_suppression),
        hard_suppression: toNullableBool(row.hard_suppression),
        suppression_reason: toNullableString(row.suppression_reason ?? row.reason),
        blocked_until: toNullableString(row.blocked_until),
        created_at: toNullableString(row.created_at),
        updated_at: toNullableString(row.updated_at),
        source_table: sourceTable
    };
}
function normalizeLegacyOrderRow(row, sourceTable) {
    return {
        id_order: toNullableStringOrNumber(row.id_order ?? row.order_id ?? row.id),
        id_customer: toNullableStringOrNumber(row.id_customer),
        invoice_number: toNullableStringOrNumber(row.invoice_number),
        reference: toNullableString(row.reference ?? row.reference_code),
        status: toNullableString(row.status ?? row.current_state),
        total_paid: toNullableStringOrNumber(row.total_paid ?? row.total),
        customer_name: toNullableString(row.customer_name ?? row.firstname ?? row.lastname),
        payment: toNullableString(row.payment),
        created_at: toNullableString(row.created_at ?? row.date_add),
        updated_at: toNullableString(row.updated_at ?? row.date_upd),
        source_table: sourceTable
    };
}
function normalizeLegacyQueueRow(row, sourceTable, sourceDomain) {
    return {
        source_table: sourceTable,
        source_domain: sourceDomain,
        source_id: toNullableStringOrNumber(row.id ?? row.source_id),
        id_order: toNullableStringOrNumber(row.id_order),
        id_customer: toNullableStringOrNumber(row.id_customer),
        invoice_number: toNullableStringOrNumber(row.invoice_number),
        phone_normalized: toNullableString(row.phone_normalized),
        status: toNullableString(row.status),
        estado_caso: toNullableString(row.estado_caso),
        last_intent: toNullableString(row.last_intent),
        requires_human: row.requires_human === undefined ? null : toNullableBool(row.requires_human),
        canal_derivacion: toNullableString(row.canal_derivacion),
        last_inbound_text: toNullableString(row.last_inbound_text),
        last_inbound_at: toNullableString(row.last_inbound_at),
        created_at: toNullableString(row.created_at),
        updated_at: toNullableString(row.updated_at)
    };
}
function buildInputEvent(request) {
    return {
        channel: request.channel,
        source: request.source,
        wa_id: request.waId,
        phone_number_id: request.phoneNumberId,
        message_id: request.messageId,
        message_text: request.messageText,
        conversation_case_id: request.conversationCaseId,
        id_order: request.idOrder,
        id_customer: request.idCustomer,
        invoice_number: request.invoiceNumber,
        source_workflow: request.sourceWorkflow,
        source_node: request.sourceNode,
        dry_run: request.options.dryRun
    };
}
function firstMeaningfulCase(cases) {
    if (cases.length === 0)
        return null;
    const active = cases.find((row) => !exports.LEGACY_CASE_CLOSED_STATUSES.includes(normalizeLegacyStatus(row.status ?? row.lifecycle_status)));
    return active ?? cases[0] ?? null;
}
function buildResolverIdentity(request, cases, orders, queues) {
    const primaryCase = firstMeaningfulCase(cases);
    const primaryOrder = orders[0] ?? null;
    const primaryQueue = queues.find(Boolean) ?? null;
    const identityType = request.conversationCaseId != null
        ? "conversation_case_id"
        : request.idOrder != null
            ? "id_order"
            : request.idCustomer != null
                ? "id_customer"
                : request.invoiceNumber != null
                    ? "invoice_number"
                    : primaryCase
                        ? "wa_id"
                        : "unknown";
    const confidence = identityType === "conversation_case_id" ? 0.95 : identityType === "id_order" || identityType === "id_customer" ? 0.9 : identityType === "invoice_number" ? 0.84 : primaryCase ? 0.8 : 0.55;
    const notes = [
        primaryCase ? `case=${primaryCase.conversation_case_id ?? primaryCase.active_case_key ?? "unknown"}` : "no_case_match",
        primaryOrder ? `order=${primaryOrder.id_order ?? "unknown"}` : "no_order_match",
        primaryQueue ? `queue=${primaryQueue.source_table ?? "unknown"}` : "no_queue_match"
    ];
    return {
        provisional: true,
        identity_type: identityType,
        identity_key: `${request.waId}:${request.phoneNumberId}:${request.conversationCaseId ?? request.idOrder ?? request.idCustomer ?? request.invoiceNumber ?? "wa"}`,
        confidence,
        wa_id: request.waId,
        phone_number_id: request.phoneNumberId,
        conversation_case_id: request.conversationCaseId ?? primaryCase?.conversation_case_id ?? null,
        id_order: request.idOrder ?? primaryOrder?.id_order ?? null,
        id_customer: request.idCustomer ?? primaryOrder?.id_customer ?? null,
        invoice_number: request.invoiceNumber ?? primaryOrder?.invoice_number ?? null,
        notes
    };
}
function buildCustomerContext(request, suppression, cases, inboundMessages, outboundMessages, customerCandidate = null) {
    const latestCase = cases[0] ?? null;
    const activeCase = firstMeaningfulCase(cases);
    const lastInbound = inboundMessages[0] ?? null;
    const lastOutbound = outboundMessages[0] ?? null;
    const lastManualReply = outboundMessages.find((row) => normalizeLegacyStatus(row.direction) === "manual" || normalizeLegacyStatus(row.final_action) === "manual_operator_reply") ?? null;
    return {
        wa_id: request.waId,
        phone_number_id: request.phoneNumberId,
        contact_name: null,
        email: request.email ?? request.customerRef?.email ?? null,
        contact_id: null,
        id_customer: request.idCustomer ?? activeCase?.id_customer ?? null,
        id_order: request.idOrder ?? activeCase?.id_order ?? null,
        invoice_number: request.invoiceNumber ?? activeCase?.invoice_number ?? null,
        suppression_active: suppression?.suppression_active ?? false,
        hard_suppression: suppression?.hard_suppression ?? false,
        suppression_reason: suppression?.suppression_reason ?? null,
        blocked_until: suppression?.blocked_until ?? null,
        last_inbound_at: lastInbound?.occurred_at ?? null,
        last_outbound_at: lastOutbound?.occurred_at ?? null,
        last_manual_reply_at: lastManualReply?.occurred_at ?? null,
        open_cases_count: cases.filter((row) => !exports.LEGACY_CASE_CLOSED_STATUSES.includes(normalizeLegacyStatus(row.status ?? row.lifecycle_status))).length,
        active_case_id: activeCase?.conversation_case_id ?? null,
        active_case_status: activeCase?.status ?? null,
        latest_case_status: latestCase?.status ?? null,
        customer_candidate: customerCandidate
    };
}
function buildCustomerCandidateContextRequest(request) {
    const rawInvoiceNumber = request.invoiceNumber ?? request.customerRef?.invoiceNumber ?? null;
    const source = request.source === "n8n_meta_webhook"
        ? "n8n"
        : request.source === "hub_preview" || request.source === "manual_test"
            ? "hub_operator"
            : request.source === "system_job"
                ? "brain"
                : "unknown";
    return {
        waId: request.waId,
        email: request.email ?? request.customerRef?.email ?? undefined,
        phone: request.phone ?? request.customerRef?.phone ?? undefined,
        idCustomer: request.idCustomer ?? request.customerRef?.idCustomer ?? null,
        idOrder: request.idOrder ?? request.customerRef?.idOrder ?? null,
        invoiceNumber: rawInvoiceNumber == null ? null : String(rawInvoiceNumber),
        conversationCaseId: request.conversationCaseId ?? null,
        messageId: request.messageId,
        source,
        options: {
            readOnly: true,
            allowProvisional: true,
            debug: request.options.debug
        }
    };
}
function buildCaseContext(cases) {
    const latestCase = cases[0] ?? null;
    const activeCase = firstMeaningfulCase(cases);
    const closedOrRejectedCase = cases.some((row) => hasAnyLegacyStatus([row.status, row.lifecycle_status, row.final_action], exports.LEGACY_CASE_CLOSED_STATUSES));
    const waitingHumanCase = cases.some((row) => hasAnyLegacyStatus([row.lifecycle_status, row.status, row.final_action], exports.LEGACY_CASE_WAITING_HUMAN_STATUSES));
    const manualOperatorLock = cases.some((row) => row.ai_blocked ||
        hasAnyLegacyStatus([row.status, row.lifecycle_status, row.final_action], exports.LEGACY_CASE_MANUAL_LOCK_STATUSES));
    return {
        active_case: activeCase,
        latest_case: latestCase,
        open_cases: cases.filter((row) => !hasAnyLegacyStatus([row.status, row.lifecycle_status, row.final_action], exports.LEGACY_CASE_CLOSED_STATUSES)),
        case_count: cases.length,
        waiting_human_case: waitingHumanCase,
        closed_or_rejected_case: closedOrRejectedCase,
        manual_operator_lock: manualOperatorLock,
        last_case_status: latestCase?.status ?? null,
        last_case_final_action: latestCase?.final_action ?? null
    };
}
function buildConversationContext(messages, agentRuns, limits) {
    const recentInboundMessages = messages.filter((row) => normalizeLegacyStatus(row.direction) === "inbound").slice(0, limits.maxMessages);
    const recentOutboundMessages = messages.filter((row) => normalizeLegacyStatus(row.direction) === "outbound").slice(0, limits.maxMessages);
    const recentManualReplies = messages
        .filter((row) => normalizeLegacyStatus(row.direction) === "manual" || normalizeLegacyStatus(row.final_action) === "manual_operator_reply")
        .slice(0, limits.maxMessages);
    return {
        recent_messages: messages.slice(0, limits.maxMessages),
        recent_inbound_messages: recentInboundMessages,
        recent_outbound_messages: recentOutboundMessages,
        recent_manual_replies: recentManualReplies,
        recent_agent_runs: agentRuns.slice(0, limits.maxAgentRuns),
        message_count: messages.length,
        last_inbound_at: recentInboundMessages[0]?.occurred_at ?? null,
        last_outbound_at: recentOutboundMessages[0]?.occurred_at ?? null,
        last_manual_reply_at: recentManualReplies[0]?.occurred_at ?? null
    };
}
function buildBusinessContext(request, postventaQueue, mantencionesQueue, orders, includePostventa, includeAgentRuns) {
    return {
        ps_orders: orders,
        postventa_queue: includePostventa ? postventaQueue : null,
        mantenciones_queue: includePostventa ? mantencionesQueue : null,
        context_mode: request.options.dryRun ? "dry_run" : "live",
        dry_run: request.options.dryRun,
        include_postventa: includePostventa,
        include_agent_runs: includeAgentRuns
    };
}
function buildServiceContext(request, caseContext, businessContext) {
    const queue = businessContext.mantenciones_queue ?? businessContext.postventa_queue;
    const activeCase = caseContext.active_case;
    const primaryService = queue?.source_domain === "postventa_armado" || String(activeCase?.service_code ?? queue?.estado_caso ?? queue?.last_intent ?? "").toLowerCase().includes("armado")
        ? "postventa_armado"
        : queue?.source_domain === "postventa_mantencion" || String(activeCase?.service_code ?? queue?.estado_caso ?? queue?.last_intent ?? "").toLowerCase().includes("mantencion")
            ? "postventa_mantencion"
            : String(activeCase?.service_code ?? queue?.estado_caso ?? queue?.last_intent ?? "").toLowerCase().includes("sac") ||
                normalizeLegacyStatus(activeCase?.department) === "sac"
                ? "sac"
                : String(activeCase?.service_code ?? queue?.estado_caso ?? queue?.last_intent ?? "").toLowerCase().includes("quote") ||
                    String(activeCase?.service_code ?? queue?.estado_caso ?? queue?.last_intent ?? "").toLowerCase().includes("sales") ||
                    normalizeLegacyStatus(activeCase?.department) === "ventas"
                    ? "sales"
                    : String(activeCase?.service_code ?? queue?.estado_caso ?? queue?.last_intent ?? "").toLowerCase().includes("knowledge")
                        ? "knowledge"
                        : String(activeCase?.service_code ?? queue?.estado_caso ?? queue?.last_intent ?? "").toLowerCase().includes("campaign")
                            ? "campaign"
                            : activeCase?.department
                                ? normalizeLegacyStatus(activeCase.department) === "postventa"
                                    ? "postventa_general"
                                    : normalizeLegacyStatus(activeCase.department) === "sac"
                                        ? "sac"
                                        : normalizeLegacyStatus(activeCase.department) === "ventas"
                                            ? "sales"
                                            : "unknown"
                                : "unknown";
    const sourceDomain = queue?.source_domain ?? null;
    const sourceTable = queue?.source_table ?? activeCase?.source_table ?? null;
    const sourceId = queue?.source_id ?? activeCase?.source_id ?? null;
    const sourceStatus = queue?.status ?? activeCase?.status ?? null;
    const sourcePriority = activeCase?.priority ?? null;
    let suggestedAgent = null;
    const signals = [];
    const serviceCode = String(activeCase?.service_code ?? queue?.estado_caso ?? queue?.last_intent ?? "").toLowerCase();
    if (primaryService === "postventa_armado") {
        suggestedAgent = "AI_AGENT_Postventa";
        signals.push("postventa_armado");
    }
    else if (primaryService === "postventa_mantencion") {
        suggestedAgent = "AI_AGENT_Postventa";
        signals.push("postventa_mantencion");
    }
    else if (primaryService === "sac") {
        suggestedAgent = "AI_AGENT_SAC";
        signals.push("sac_case");
    }
    else if (primaryService === "sales") {
        suggestedAgent = "AI_AGENT_Sales";
        signals.push("sales_case");
    }
    else if (primaryService === "knowledge") {
        suggestedAgent = "AI_AGENT_Knowledge";
        signals.push("knowledge");
    }
    else if (primaryService === "campaign") {
        suggestedAgent = "AI_AGENT_Campaign";
        signals.push("campaign");
    }
    else if (primaryService === "postventa_general") {
        suggestedAgent = "AI_AGENT_Postventa";
    }
    if (request.idOrder || request.invoiceNumber) {
        signals.push("commerce_identity_available");
        if (primaryService === "unknown") {
            suggestedAgent = "AI_AGENT_Sales";
            signals.push("sales_fallback");
        }
    }
    if (primaryService === "unknown" && activeCase?.department) {
        const department = normalizeLegacyStatus(activeCase.department);
        if (department === "sac") {
            suggestedAgent = "AI_AGENT_SAC";
        }
        else if (department === "ventas") {
            suggestedAgent = "AI_AGENT_Sales";
        }
        else if (department === "postventa") {
            suggestedAgent = "AI_AGENT_Postventa";
        }
    }
    return {
        primary_service: primaryService,
        service_code: serviceCode || "unknown",
        source_domain: sourceDomain,
        source_table: sourceTable,
        source_id: sourceId,
        source_status: sourceStatus,
        source_priority: sourcePriority,
        suggested_agent: suggestedAgent,
        signals
    };
}
function summarizeBotSignals(signals) {
    return Object.entries(signals)
        .filter(([, value]) => value)
        .map(([key]) => key);
}
function buildFallbackCustomerContext(request) {
    return {
        wa_id: request.waId,
        phone_number_id: request.phoneNumberId,
        contact_name: null,
        email: request.email ?? request.customerRef?.email ?? null,
        contact_id: null,
        id_customer: request.idCustomer ?? null,
        id_order: request.idOrder ?? null,
        invoice_number: request.invoiceNumber ?? null,
        suppression_active: false,
        hard_suppression: false,
        suppression_reason: null,
        blocked_until: null,
        last_inbound_at: null,
        last_outbound_at: null,
        last_manual_reply_at: null,
        open_cases_count: 0,
        active_case_id: null,
        active_case_status: null,
        latest_case_status: null,
        customer_candidate: null
    };
}

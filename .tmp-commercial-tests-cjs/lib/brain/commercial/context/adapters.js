"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeCommercialObject = sanitizeCommercialObject;
exports.normalizeCommercialBrainContext = normalizeCommercialBrainContext;
exports.normalizeCommercialInboundMessage = normalizeCommercialInboundMessage;
exports.normalizeCommercialPolicyContext = normalizeCommercialPolicyContext;
exports.buildCommercialStructuralSignals = buildCommercialStructuralSignals;
exports.hasStaleCommercialContext = hasStaleCommercialContext;
exports.buildCommercialSourceSummary = buildCommercialSourceSummary;
exports.buildCommercialIdentityContext = buildCommercialIdentityContext;
exports.buildCommercialMessageContext = buildCommercialMessageContext;
exports.buildCommercialCaseContext = buildCommercialCaseContext;
exports.buildCommercialCommercialContext = buildCommercialCommercialContext;
exports.collectCommercialTimestampSignals = collectCommercialTimestampSignals;
exports.normalizeCommercialCurrentTime = normalizeCommercialCurrentTime;
exports.buildCommercialMetadata = buildCommercialMetadata;
const constants_1 = require("../constants");
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getValue(value, path) {
    let cursor = value;
    for (const key of path) {
        if (Array.isArray(cursor) && typeof key === "number") {
            cursor = cursor[key];
            continue;
        }
        if (!isRecord(cursor))
            return undefined;
        cursor = cursor[key];
    }
    return cursor;
}
function getRecord(value, path) {
    const record = getValue(value, path);
    return isRecord(record) ? record : null;
}
function asString(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number" || typeof value === "bigint") {
        return String(value);
    }
    return null;
}
function toSerializableId(value) {
    if (value === undefined || value === null || value === "")
        return null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "bigint")
        return value.toString();
    if (typeof value === "number")
        return Number.isSafeInteger(value) ? value : String(value);
    return String(value);
}
function normalizeIsoTimestamp(value) {
    if (value === undefined || value === null || value === "")
        return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
        const parsed = new Date(typeof value === "bigint" ? Number(value) : value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    return null;
}
function normalizeDirection(value) {
    const text = asString(value)?.toLowerCase() ?? "";
    if (text === "inbound" || text === "outbound" || text === "manual" || text === "system")
        return text;
    return null;
}
function isSensitiveKey(key) {
    const normalized = key.toLowerCase();
    return (normalized.includes("authorization") ||
        normalized.includes("token") ||
        normalized.includes("secret") ||
        normalized.includes("password") ||
        normalized.includes("credential") ||
        normalized.includes("cookie") ||
        normalized.includes("header") ||
        normalized.includes("payload") ||
        normalized.includes("webhook") ||
        normalized.includes("session"));
}
function sanitizeValue(value, state) {
    if (value === null)
        return null;
    if (value === undefined)
        return undefined;
    if (typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return Number.isFinite(value) ? value : String(value);
    if (typeof value === "bigint") {
        state.applied = true;
        state.removedKeys.push("bigint");
        return value.toString();
    }
    if (typeof value === "function" || typeof value === "symbol") {
        state.applied = true;
        state.removedKeys.push(typeof value);
        return undefined;
    }
    if (value instanceof Date) {
        state.applied = true;
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        return value
            .map((item) => sanitizeValue(item, state))
            .filter((item) => item !== undefined);
    }
    if (!isRecord(value)) {
        state.applied = true;
        state.removedKeys.push("non_json_value");
        return String(value);
    }
    if (state.seen.has(value)) {
        state.applied = true;
        state.removedKeys.push("circular_reference");
        return undefined;
    }
    state.seen.add(value);
    const output = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        if (isSensitiveKey(key)) {
            state.applied = true;
            state.removedKeys.push(key);
            continue;
        }
        const sanitizedNestedValue = sanitizeValue(nestedValue, state);
        if (sanitizedNestedValue !== undefined) {
            output[key] = sanitizedNestedValue;
        }
    }
    return output;
}
function sanitizeCommercialObject(value) {
    const state = { applied: false, seen: new WeakSet(), removedKeys: [] };
    const sanitized = sanitizeValue(value, state);
    if (!isRecord(sanitized)) {
        return {
            value: null,
            applied: state.applied,
            sanitizedFields: [...new Set(state.removedKeys)]
        };
    }
    return {
        value: sanitized,
        applied: state.applied,
        sanitizedFields: [...new Set(state.removedKeys)]
    };
}
function sanitizePolicyContext(policyContext) {
    const sanitized = sanitizeCommercialObject(policyContext);
    return sanitized.value ? sanitized.value : undefined;
}
function normalizeMessage(input, fallbackDirection = null) {
    if (!isRecord(input)) {
        if (typeof input === "string") {
            return {
                message: {
                    id: null,
                    direction: fallbackDirection,
                    text: input.trim() || null,
                    occurredAt: null,
                    createdAt: null,
                    updatedAt: null,
                    messageType: null,
                    finalAction: null,
                    status: null,
                    intent: null,
                    department: null,
                    channel: null,
                    platform: null,
                    waId: null,
                    phoneNumberId: null,
                    conversationCaseId: null,
                    source: null
                },
                sanitizationApplied: false
            };
        }
        return { message: null, sanitizationApplied: false };
    }
    const sanitized = sanitizeCommercialObject(input);
    if (!sanitized.value) {
        return { message: null, sanitizationApplied: sanitized.applied };
    }
    const record = sanitized.value;
    const direction = normalizeDirection(record.direction ?? record.message_direction) ?? fallbackDirection;
    const text = asString(record.text) ??
        asString(record.message_text) ??
        asString(record.body) ??
        asString(record.content) ??
        asString(record.message) ??
        asString(record.raw_text) ??
        asString(record.last_message);
    return {
        message: {
            id: toSerializableId(record.id ?? record.message_id ?? record.provider_message_id),
            direction,
            text,
            occurredAt: normalizeIsoTimestamp(record.occurred_at ?? record.message_at ?? record.sent_at ?? record.received_at),
            createdAt: normalizeIsoTimestamp(record.created_at),
            updatedAt: normalizeIsoTimestamp(record.updated_at),
            messageType: asString(record.message_type),
            finalAction: asString(record.final_action ?? record.last_message_final_action),
            status: asString(record.status ?? record.message_status ?? record.processing_status),
            intent: asString(record.intent ?? record.last_message_intent),
            department: asString(record.department ?? record.last_message_department),
            channel: asString(record.channel),
            platform: asString(record.platform),
            waId: asString(record.wa_id ?? record.waId),
            phoneNumberId: asString(record.phone_number_id ?? record.phoneNumberId),
            conversationCaseId: toSerializableId(record.conversation_case_id ?? record.conversationCaseId ?? record.case_id),
            source: asString(record.source ?? record.source_table ?? record.technical_origin)
        },
        sanitizationApplied: sanitized.applied
    };
}
function normalizeMessageArray(messages) {
    if (!Array.isArray(messages)) {
        return { messages: [], sanitizationApplied: false, sanitizedFields: [] };
    }
    const output = [];
    let sanitizationApplied = false;
    const sanitizedFields = [];
    for (const item of messages) {
        const normalized = normalizeMessage(item);
        sanitizationApplied ||= normalized.sanitizationApplied;
        if (normalized.sanitizationApplied) {
            sanitizedFields.push("recent_message");
        }
        if (normalized.message) {
            output.push(normalized.message);
        }
    }
    return { messages: output, sanitizationApplied, sanitizedFields: [...new Set(sanitizedFields)] };
}
function sortMessagesDescending(messages) {
    return messages.slice().sort((left, right) => {
        const leftStamp = new Date(left.occurredAt ?? left.updatedAt ?? left.createdAt ?? 0).getTime();
        const rightStamp = new Date(right.occurredAt ?? right.updatedAt ?? right.createdAt ?? 0).getTime();
        return rightStamp - leftStamp;
    });
}
function pickFirstString(...values) {
    for (const value of values) {
        const text = asString(value);
        if (text)
            return text;
    }
    return null;
}
function pickFirstId(...values) {
    for (const value of values) {
        const id = toSerializableId(value);
        if (id !== null)
            return id;
    }
    return null;
}
function hasSupportableContextShape(input) {
    if (!isRecord(input))
        return false;
    return Boolean(input.customer_context ||
        input.case_context ||
        input.conversation_context ||
        input.business_context ||
        input.service_context ||
        input.customer_candidate ||
        input.customerCandidate ||
        input.latest_message ||
        input.latestInboundMessage ||
        input.messages ||
        input.recent_messages);
}
function extractCustomerCandidate(context) {
    const candidate = context ? (context.customer_candidate ?? context.customerCandidate ?? getValue(context, ["customer_context", "customer_candidate"])) : null;
    const sanitized = sanitizeCommercialObject(candidate);
    return {
        value: sanitized.value,
        applied: sanitized.applied,
        sanitizedFields: sanitized.sanitizedFields
    };
}
function normalizeCommercialContext(input) {
    const warnings = [];
    const supportedContextShape = hasSupportableContextShape(input);
    if (!supportedContextShape)
        warnings.push("unsupported_context_shape");
    const root = isRecord(input) ? input : null;
    const customerContext = root ? (getRecord(root, ["customer_context"]) ?? root) : null;
    const caseContext = root ? getRecord(root, ["case_context"]) : null;
    const conversationContext = root ? getRecord(root, ["conversation_context"]) : null;
    const businessContext = root ? getRecord(root, ["business_context"]) : null;
    const serviceContext = root ? getRecord(root, ["service_context"]) : null;
    const customerCandidate = extractCustomerCandidate(root);
    const orderContext = sanitizeCommercialObject(getValue(root, ["business_context", "ps_orders", 0]) ??
        getValue(root, ["order_context"]) ??
        getValue(root, ["orderContext"]) ??
        getValue(root, ["order"]) ??
        null);
    const productServiceContext = sanitizeCommercialObject(serviceContext ?? getValue(root, ["serviceContext"]) ?? getValue(root, ["commercial_context"]) ?? null);
    const recentMessageSource = getValue(conversationContext ?? root, ["recent_messages"]) ??
        getValue(conversationContext ?? root, ["recentMessages"]) ??
        getValue(root, ["messages"]) ??
        [];
    const normalizedRecentMessages = normalizeMessageArray(recentMessageSource);
    const latestInboundMessage = normalizeMessage(getValue(root, ["latestInboundMessage"])).message ??
        normalizeMessage(getValue(root, ["latest_inbound_message"])).message ??
        normalizeMessage(getValue(root, ["latest_message"])).message ??
        normalizeMessage(getValue(conversationContext, ["latest_inbound_message"])).message ??
        normalizeMessage(getValue(conversationContext, ["last_inbound_message"])).message ??
        null;
    const latestOutboundMessage = normalizeMessage(getValue(root, ["latestOutboundMessage"]), "outbound").message ??
        normalizeMessage(getValue(root, ["latest_outbound_message"]), "outbound").message ??
        normalizeMessage(getValue(conversationContext, ["latest_outbound_message"]), "outbound").message ??
        normalizeMessage(getValue(conversationContext, ["last_outbound_message"]), "outbound").message ??
        normalizedRecentMessages.messages.find((message) => message.direction === "outbound" || message.direction === "manual") ??
        null;
    const latestInboundAt = latestInboundMessage?.occurredAt ?? latestInboundMessage?.createdAt ?? latestInboundMessage?.updatedAt ?? null;
    const latestOutboundAt = latestOutboundMessage?.occurredAt ?? latestOutboundMessage?.createdAt ?? latestOutboundMessage?.updatedAt ?? null;
    const waId = pickFirstString(getValue(customerContext, ["wa_id"]), getValue(customerContext, ["waId"]), latestInboundMessage?.waId, latestOutboundMessage?.waId);
    const phoneNumberId = pickFirstString(getValue(customerContext, ["phone_number_id"]), getValue(customerContext, ["phoneNumberId"]), latestInboundMessage?.phoneNumberId, latestOutboundMessage?.phoneNumberId);
    const email = pickFirstString(getValue(customerContext, ["email"]), getValue(customerCandidate.value, ["email"]), getValue(root, ["email"]));
    const phone = pickFirstString(getValue(customerContext, ["phone"]), getValue(customerContext, ["phone_number"]), getValue(root, ["phone"]), getValue(root, ["mobile"]));
    const idCustomer = pickFirstId(getValue(customerContext, ["id_customer"]), getValue(customerContext, ["idCustomer"]), getValue(customerCandidate.value, ["id_customer"]), getValue(customerCandidate.value, ["idCustomer"]));
    const idOrder = pickFirstId(getValue(customerContext, ["id_order"]), getValue(customerContext, ["idOrder"]), getValue(customerCandidate.value, ["id_order"]), getValue(customerCandidate.value, ["idOrder"]));
    const invoiceNumber = pickFirstId(getValue(customerContext, ["invoice_number"]), getValue(customerContext, ["invoiceNumber"]), getValue(customerCandidate.value, ["invoice_number"]), getValue(customerCandidate.value, ["invoiceNumber"]));
    const contactId = pickFirstId(getValue(customerContext, ["contact_id"]), getValue(customerContext, ["contactId"]), getValue(customerCandidate.value, ["contact_id"]), getValue(customerCandidate.value, ["contactId"]));
    const caseStatus = pickFirstString(getValue(caseContext, ["status"]), getValue(caseContext, ["raw_status"]), getValue(caseContext, ["lifecycle_status"]));
    const caseLifecycleStatus = pickFirstString(getValue(caseContext, ["lifecycle_status"]), getValue(caseContext, ["status"]));
    const department = pickFirstString(getValue(caseContext, ["department"]), getValue(conversationContext, ["department"]), getValue(serviceContext, ["department"]));
    const humanOwnershipActive = Boolean(caseContext &&
        (getValue(caseContext, ["requires_human"]) === true ||
            getValue(caseContext, ["manual_operator_lock"]) === true ||
            getValue(caseContext, ["human_owner_active"]) === true ||
            getValue(caseContext, ["owner_type"]) === "human"));
    const aiBlocked = Boolean(caseContext &&
        (getValue(caseContext, ["ai_blocked"]) === true ||
            getValue(caseContext, ["block_ai"]) === true ||
            getValue(caseContext, ["disable_ai"]) === true ||
            getValue(caseContext, ["auto_reply_blocked"]) === true));
    const manualReplyActive = Boolean(caseContext &&
        (getValue(caseContext, ["bot_replied"]) === true ||
            getValue(caseContext, ["final_action"]) === "manual_operator_reply" ||
            getValue(caseContext, ["final_action"]) === "manual_reply"));
    const commercialIntentLegacy = pickFirstString(getValue(caseContext, ["commercial_intent_legacy"]), getValue(caseContext, ["service_code"]), getValue(caseContext, ["final_action"]), latestInboundMessage?.intent, latestOutboundMessage?.intent, getValue(serviceContext, ["service_code"]), getValue(serviceContext, ["primary_service"]), getValue(businessContext, ["postventa_queue", "estado_caso"]), getValue(businessContext, ["mantenciones_queue", "estado_caso"]));
    const lead = sanitizeCommercialObject(getValue(root, ["lead"]) ?? getValue(root, ["lead_context"]) ?? null).value ?? undefined;
    const opportunity = sanitizeCommercialObject(getValue(root, ["opportunity"]) ?? getValue(root, ["opportunity_context"]) ?? null).value ?? undefined;
    const metadataResult = sanitizeCommercialObject(getValue(root, ["metadata"]) ?? null);
    const recentMessages = sortMessagesDescending([
        ...(latestInboundMessage ? [latestInboundMessage] : []),
        ...normalizedRecentMessages.messages,
        ...(latestOutboundMessage ? [latestOutboundMessage] : [])
    ]);
    const limitedRecentMessages = recentMessages.slice(0, constants_1.COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES);
    const hasCustomerCandidate = Boolean(customerCandidate.value);
    const hasCustomerReference = Boolean(waId || phoneNumberId || email || phone || idCustomer || idOrder || invoiceNumber || contactId);
    const hasCommercialEntity = Boolean(lead || opportunity || orderContext.value || productServiceContext.value || commercialIntentLegacy);
    const hasConversationHistory = normalizedRecentMessages.messages.length > 0;
    const sanitizedFields = [
        ...new Set([
            ...customerCandidate.sanitizedFields,
            ...orderContext.sanitizedFields,
            ...productServiceContext.sanitizedFields,
            ...normalizedRecentMessages.sanitizedFields,
            ...metadataResult.sanitizedFields
        ])
    ];
    return {
        warnings,
        context: {
            sourceShape: supportedContextShape ? "brain_context" : "unsupported",
            supportedContextShape,
            sanitizationApplied: sanitizedFields.length > 0,
            sanitizedFields,
            channel: pickFirstString(getValue(root, ["channel"]), getValue(root, ["input_event", "channel"]), latestInboundMessage?.channel),
            platform: pickFirstString(getValue(root, ["platform"]), getValue(root, ["input_event", "platform"]), latestInboundMessage?.platform),
            department,
            conversationCaseId: pickFirstId(getValue(root, ["conversation_case_id"]), getValue(root, ["conversationCaseId"]), getValue(caseContext, ["conversation_case_id"]), latestInboundMessage?.conversationCaseId),
            waId,
            phoneNumberId,
            email,
            phone,
            idCustomer,
            idOrder,
            invoiceNumber,
            contactId,
            caseStatus,
            caseLifecycleStatus,
            humanOwnershipActive,
            aiBlocked,
            manualReplyActive,
            customerCandidate: customerCandidate.value,
            orderContext: orderContext.value,
            productServiceContext: productServiceContext.value,
            lead,
            opportunity,
            commercialIntentLegacy,
            latestInboundMessage,
            latestOutboundMessage,
            recentMessages: limitedRecentMessages,
            latestInboundAt,
            latestOutboundAt,
            hasCustomerCandidate,
            hasCustomerReference,
            hasCommercialEntity,
            hasConversationHistory,
            metadata: metadataResult.value ?? {}
        }
    };
}
function normalizeCommercialBrainContext(input) {
    return normalizeCommercialContext(input);
}
function normalizeCommercialInboundMessage(input) {
    const normalized = normalizeMessage(input, "inbound");
    const sanitized = isRecord(input) ? sanitizeCommercialObject(input) : { value: null, applied: false, sanitizedFields: [] };
    return {
        sourceShape: typeof input === "string" ? "string_message" : isRecord(input) ? "inbound_message" : "unsupported",
        supportedShape: typeof input === "string" || isRecord(input),
        sanitizationApplied: normalized.sanitizationApplied || sanitized.applied,
        sanitizedFields: sanitized.sanitizedFields,
        message: normalized.message,
        metadata: sanitized.value ?? {}
    };
}
function normalizeCommercialPolicyContext(input) {
    return sanitizePolicyContext(input);
}
function buildCommercialStructuralSignals(input) {
    const signals = [];
    if (input.hasLatestCustomerMessage)
        signals.push("customer_message_present");
    if (input.hasCustomerCandidate)
        signals.push("customer_candidate_available");
    if (input.hasCustomerReference)
        signals.push("customer_reference_available");
    if (input.hasOrderReference)
        signals.push("order_reference_available");
    if (input.hasProductServiceContext)
        signals.push("product_service_context_available");
    if (input.hasConversationHistory)
        signals.push("conversation_history_available");
    if (input.humanOwnershipActive)
        signals.push("human_owner_active");
    if (input.aiBlocked)
        signals.push("ai_blocked");
    if (input.manualReplyActive)
        signals.push("manual_reply_active");
    if (input.hasCommercialEntity)
        signals.push("commercial_entity_available");
    return signals;
}
function hasStaleCommercialContext(currentTimeIso, timestamps) {
    const currentTimeMs = new Date(currentTimeIso).getTime();
    if (!Number.isFinite(currentTimeMs))
        return false;
    const times = timestamps
        .map((timestamp) => (timestamp ? new Date(timestamp).getTime() : Number.NaN))
        .filter((timestamp) => Number.isFinite(timestamp));
    if (times.length === 0)
        return false;
    const latest = Math.max(...times);
    return currentTimeMs - latest > constants_1.COMMERCIAL_CONTEXT_STALE_THRESHOLD_MS;
}
function buildCommercialSourceSummary(input) {
    return input;
}
function buildCommercialIdentityContext(input) {
    return {
        conversationCaseId: input.conversationCaseId,
        waId: input.waId,
        phoneNumberId: input.phoneNumberId,
        email: input.email,
        phone: input.phone,
        idCustomer: input.idCustomer,
        idOrder: input.idOrder,
        invoiceNumber: input.invoiceNumber,
        contactId: input.contactId,
        customerCandidate: input.customerCandidate
    };
}
function buildCommercialMessageContext(input) {
    return {
        latestInboundMessage: input.latestInboundMessage,
        latestOutboundMessage: input.latestOutboundMessage,
        recentMessages: input.recentMessages,
        latestInboundAt: input.latestInboundAt,
        latestOutboundAt: input.latestOutboundAt
    };
}
function buildCommercialCaseContext(input) {
    return {
        status: input.caseStatus,
        lifecycleStatus: input.caseLifecycleStatus,
        department: input.department,
        humanOwnershipActive: input.humanOwnershipActive,
        aiBlocked: input.aiBlocked,
        manualReplyActive: input.manualReplyActive
    };
}
function buildCommercialCommercialContext(input) {
    return {
        commercialIntentLegacy: input.commercialIntentLegacy,
        orderContext: input.orderContext,
        productServiceContext: input.productServiceContext,
        lead: input.lead,
        opportunity: input.opportunity
    };
}
function collectCommercialTimestampSignals(input) {
    return [
        input.latestInboundAt,
        input.latestOutboundAt,
        input.caseUpdatedAt ?? null,
        input.customerCandidateUpdatedAt ?? null,
        input.orderUpdatedAt ?? null,
        input.productServiceUpdatedAt ?? null
    ];
}
function normalizeCommercialCurrentTime(currentTime) {
    return normalizeIsoTimestamp(currentTime);
}
function buildCommercialMetadata(input) {
    return {
        version: constants_1.COMMERCIAL_CONTEXT_VERSION,
        generatedAt: input.currentTime,
        currentTime: input.currentTime,
        timezone: input.timezone,
        requestedMode: input.requestedMode,
        availableCapabilities: [...input.availableCapabilities],
        recentMessagesLimit: constants_1.COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES,
        sanitized: input.sanitized,
        sanitizedFields: [...input.sanitizedFields],
        sourceShape: input.sourceShape,
        safeMetadata: input.safeMetadata
    };
}

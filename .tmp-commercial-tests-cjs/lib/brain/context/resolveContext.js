"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBrainContext = resolveBrainContext;
exports.resolveBackendBrainContext = resolveBackendBrainContext;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("../../db");
const instructions_1 = require("../instructions");
const botEligibility_1 = require("./botEligibility");
const contextPacks_1 = require("./contextPacks");
const customer_identity_1 = require("../../customer-identity");
const legacyAdapters_1 = require("./legacyAdapters");
const BRAIN_CONTEXT_VERSION = "brain.context.v1";
function makeContextRequestId(request) {
    return node_crypto_1.default
        .createHash("sha256")
        .update([
        request.source,
        request.waId,
        request.phoneNumberId,
        request.messageId,
        request.conversationCaseId ?? "",
        request.idOrder ?? "",
        request.idCustomer ?? "",
        request.invoiceNumber ?? ""
    ].join(":"))
        .digest("hex")
        .slice(0, 16);
}
function contextError(message, details) {
    return {
        code: "CONTEXT_UNAVAILABLE",
        message,
        retryable: true,
        details
    };
}
async function resolveCustomerCandidateSafely(request) {
    try {
        const result = await (0, customer_identity_1.resolveCustomerCandidate)((0, legacyAdapters_1.buildCustomerCandidateContextRequest)(request));
        return {
            result,
            warnings: result.warnings
        };
    }
    catch (error) {
        const warning = error instanceof Error ? error.message : String(error);
        return {
            result: null,
            warnings: [`customer_candidate resolution failed: ${warning}`]
        };
    }
}
function normalizePhoneLikeId(value) {
    if (value === undefined || value === null)
        return undefined;
    const text = String(value);
    const digits = text.replace(/\D+/g, "");
    return digits.length > 0 ? digits : text;
}
function pickOrderColumn(columns, candidates) {
    return candidates.find((candidate) => columns.includes(candidate)) ?? null;
}
function buildIdentityGroups(request, kind) {
    const waIdDigits = normalizePhoneLikeId(request.waId);
    const contactId = request.customerRef?.contactId;
    const sharedGroups = [
        { value: request.conversationCaseId, columns: ["conversation_case_id", "case_id", "conversation_id", "id"] },
        { value: request.waId, columns: ["wa_id"] },
        { value: waIdDigits, columns: ["phone_normalized", "phone"] },
        { value: request.phoneNumberId, columns: ["phone_number_id", "phone_id"] },
        { value: request.idOrder, columns: ["id_order", "order_id"] },
        { value: request.idCustomer, columns: ["id_customer", "customer_id"] },
        { value: request.invoiceNumber, columns: ["invoice_number", "invoice_no"] },
        { value: contactId, columns: ["contact_id", "id_contact"] }
    ];
    if (kind === "message") {
        sharedGroups.unshift({
            value: request.messageId,
            columns: ["message_id", "provider_message_id", "wa_message_id"]
        });
    }
    if (kind === "agent_run") {
        sharedGroups.push({ value: request.messageId, columns: ["conversation_message_id", "message_id"] }, { value: request.customerRef?.contactId, columns: ["contact_id"] });
    }
    if (kind === "order") {
        sharedGroups.length = 0;
        sharedGroups.push({ value: request.idOrder, columns: ["id_order", "order_id"] }, { value: request.idCustomer, columns: ["id_customer", "customer_id"] }, { value: request.invoiceNumber, columns: ["invoice_number", "invoice_no"] }, { value: request.customerRef?.email, columns: ["email"] });
    }
    if (kind === "queue") {
        sharedGroups.push({ value: request.customerRef?.email, columns: ["email"] });
    }
    return sharedGroups;
}
function buildWhereClause(columns, groups) {
    const clauses = [];
    const params = [];
    for (const group of groups) {
        if (group.value === undefined || group.value === null || group.value === "")
            continue;
        const matches = group.columns.filter((column) => columns.includes(column));
        if (matches.length === 0)
            continue;
        clauses.push(`(${matches.map((column) => `\`${column}\` = ?`).join(" OR ")})`);
        for (let index = 0; index < matches.length; index += 1) {
            params.push(group.value);
        }
    }
    if (clauses.length === 0)
        return { whereSql: "", params: [] };
    return { whereSql: `WHERE ${clauses.join(" OR ")}`, params };
}
async function fetchLegacyRows(tableName, request, kind, limit, orderCandidates, normalize) {
    const columns = await (0, db_1.getColumns)(tableName);
    if (columns.length === 0) {
        return {
            rows: [],
            warnings: [`${tableName} unavailable or missing in current database connection.`],
            errors: []
        };
    }
    const { whereSql, params } = buildWhereClause(columns, buildIdentityGroups(request, kind));
    if (!whereSql) {
        return {
            rows: [],
            warnings: [`${tableName} skipped because no usable identity columns were available.`],
            errors: []
        };
    }
    const orderColumn = pickOrderColumn(columns, orderCandidates);
    const sql = `SELECT * FROM \`${tableName}\` ${whereSql}${orderColumn ? ` ORDER BY \`${orderColumn}\` DESC` : ""} LIMIT ?`;
    const result = await (0, db_1.safeQueryRows)(sql, [...params, Math.min(Math.max(limit, 1), 50)]);
    if (!result.ok) {
        return {
            rows: [],
            warnings: [`${tableName} query failed: ${result.error}`],
            errors: [contextError(`${tableName} query failed`, { tableName, error: result.error })]
        };
    }
    return {
        rows: result.rows.map((row) => normalize(row, tableName)),
        warnings: [],
        errors: []
    };
}
function mergeRowsDescending(rows) {
    return rows.slice().sort((left, right) => {
        const leftStamp = new Date(left.updated_at ?? left.created_at ?? left.occurred_at ?? 0).getTime();
        const rightStamp = new Date(right.updated_at ?? right.created_at ?? right.occurred_at ?? 0).getTime();
        return rightStamp - leftStamp;
    });
}
function buildFallbackResponse(request, startedAt, warnings, errors) {
    const emptyCases = [];
    const emptyMessages = [];
    const emptyAgentRuns = [];
    const emptyOrders = [];
    const inputEvent = (0, legacyAdapters_1.buildInputEvent)(request);
    const customerContext = (0, legacyAdapters_1.buildFallbackCustomerContext)(request);
    const caseContext = (0, legacyAdapters_1.buildCaseContext)(emptyCases);
    const businessContext = (0, legacyAdapters_1.buildBusinessContext)(request, null, null, emptyOrders, request.options.includePostventa, request.options.includeAgentRuns);
    const serviceContext = (0, legacyAdapters_1.buildServiceContext)(request, caseContext, businessContext);
    const botEligibility = (0, botEligibility_1.buildBotEligibility)({
        messageText: request.messageText,
        customerContext,
        caseContext,
        conversationContext: (0, legacyAdapters_1.buildConversationContext)(emptyMessages, emptyAgentRuns, {
            maxMessages: request.options.maxMessages,
            maxAgentRuns: request.options.maxAgentRuns
        }),
        serviceContext
    });
    const contextPacks = (0, contextPacks_1.buildContextPacks)({
        serviceContext,
        botEligible: botEligibility.eligible,
        serviceSignals: serviceContext.signals,
        relatedCaseId: null,
        relatedOrderId: null,
        hasPostventaQueue: false,
        hasMaintenanceQueue: false,
        hasKnowledgeSignals: false,
        hasCampaignSignals: false
    });
    return {
        ok: false,
        request_id: makeContextRequestId(request),
        partial_context: true,
        input_event: inputEvent,
        resolver_identity: (0, legacyAdapters_1.buildResolverIdentity)(request, emptyCases, emptyOrders, [null, null]),
        customer_context: customerContext,
        case_context: caseContext,
        conversation_context: (0, legacyAdapters_1.buildConversationContext)(emptyMessages, emptyAgentRuns, {
            maxMessages: request.options.maxMessages,
            maxAgentRuns: request.options.maxAgentRuns
        }),
        business_context: businessContext,
        service_context: serviceContext,
        bot_eligibility: botEligibility,
        context_packs: contextPacks,
        warnings,
        errors,
        metadata: {
            version: BRAIN_CONTEXT_VERSION,
            generatedAt: new Date().toISOString(),
            processingMs: Date.now() - startedAt,
            dryRun: request.options.dryRun,
            maxMessages: request.options.maxMessages,
            maxAgentRuns: request.options.maxAgentRuns,
            maxCases: request.options.maxCases,
            includePostventa: request.options.includePostventa,
            includeAgentRuns: request.options.includeAgentRuns,
            sourceWorkflow: request.sourceWorkflow,
            sourceNode: request.sourceNode
        }
    };
}
function resolveBrainContext(request) {
    const context = {
        status: "noop",
        source: request.source,
        contextMode: request.contextMode,
        traceId: (0, instructions_1.makeBrainTraceId)(request),
        waId: request.waId,
        phoneNumberId: request.phoneNumberId,
        messageId: request.messageId,
        conversationCaseId: request.conversationCaseId,
        customerRef: request.customerRef,
        sourceWorkflow: request.sourceWorkflow,
        sourceNode: request.sourceNode,
        confidence: 0,
        notes: [
            "Context resolution is a noop skeleton in P1D.",
            "No DB lookup is performed yet.",
            "Identity remains provisional and migratable."
        ],
        warnings: []
    };
    return {
        ...context,
        notes: (0, instructions_1.summarizeBrainContext)(context).notes
    };
}
async function resolveBackendBrainContext(request, startedAt = Date.now()) {
    const warnings = [];
    const errors = [];
    const customerCandidatePromise = resolveCustomerCandidateSafely(request);
    try {
        const [casesResult, inboundMessagesResult, conversationMessagesResult, suppressionResult, agentRunsResult, postventaQueueResult, mantencionesQueueResult, ordersResult] = await Promise.all([
            fetchLegacyRows("n8n_conversation_cases", request, "case", request.options.maxCases, ["updated_at", "created_at", "closed_at", "last_message_at", "id"], legacyAdapters_1.normalizeLegacyCaseRow),
            fetchLegacyRows("n8n_wa_inbound_messages", request, "message", request.options.maxMessages, ["occurred_at", "created_at", "updated_at", "id"], legacyAdapters_1.normalizeLegacyMessageRow),
            fetchLegacyRows("n8n_conversation_messages", request, "message", request.options.maxMessages, ["occurred_at", "created_at", "updated_at", "id"], legacyAdapters_1.normalizeLegacyMessageRow),
            fetchLegacyRows("n8n_wa_contact_suppression", request, "suppression", 1, ["updated_at", "created_at", "id"], legacyAdapters_1.normalizeLegacySuppressionRow),
            request.options.includeAgentRuns
                ? fetchLegacyRows("n8n_agent_runs", request, "agent_run", request.options.maxAgentRuns, ["created_at", "updated_at", "id"], legacyAdapters_1.normalizeLegacyAgentRunRow)
                : Promise.resolve({ rows: [], warnings: [], errors: [] }),
            request.options.includePostventa
                ? fetchLegacyRows("n8n_postventa_queue", request, "queue", request.options.maxCases, ["updated_at", "created_at", "last_inbound_at", "id"], (row, sourceTable) => (0, legacyAdapters_1.normalizeLegacyQueueRow)(row, sourceTable, "postventa_armado"))
                : Promise.resolve({ rows: [], warnings: [], errors: [] }),
            request.options.includePostventa
                ? fetchLegacyRows("n8n_mantenciones_cardio_queue", request, "queue", request.options.maxCases, ["updated_at", "created_at", "last_inbound_at", "id"], (row, sourceTable) => (0, legacyAdapters_1.normalizeLegacyQueueRow)(row, sourceTable, "postventa_mantencion"))
                : Promise.resolve({ rows: [], warnings: [], errors: [] }),
            fetchLegacyRows("ps_orders", request, "order", request.options.maxCases, ["date_upd", "updated_at", "created_at", "id"], legacyAdapters_1.normalizeLegacyOrderRow)
        ]);
        warnings.push(...casesResult.warnings, ...inboundMessagesResult.warnings, ...conversationMessagesResult.warnings, ...suppressionResult.warnings);
        warnings.push(...agentRunsResult.warnings, ...postventaQueueResult.warnings, ...mantencionesQueueResult.warnings, ...ordersResult.warnings);
        errors.push(...casesResult.errors, ...inboundMessagesResult.errors, ...conversationMessagesResult.errors, ...suppressionResult.errors);
        errors.push(...agentRunsResult.errors, ...postventaQueueResult.errors, ...mantencionesQueueResult.errors, ...ordersResult.errors);
        const customerCandidateResult = await customerCandidatePromise;
        warnings.push(...customerCandidateResult.warnings);
        const cases = mergeRowsDescending(casesResult.rows);
        const inboundMessages = mergeRowsDescending(inboundMessagesResult.rows);
        const conversationMessages = mergeRowsDescending(conversationMessagesResult.rows);
        const allMessages = mergeRowsDescending([...inboundMessages, ...conversationMessages]).slice(0, request.options.maxMessages);
        const agentRuns = mergeRowsDescending(agentRunsResult.rows);
        const suppression = suppressionResult.rows[0] ?? null;
        const postventaQueue = postventaQueueResult.rows[0] ?? null;
        const mantencionesQueue = mantencionesQueueResult.rows[0] ?? null;
        const orders = mergeRowsDescending(ordersResult.rows).slice(0, request.options.maxCases);
        const inputEvent = (0, legacyAdapters_1.buildInputEvent)(request);
        const resolverIdentity = (0, legacyAdapters_1.buildResolverIdentity)(request, cases, orders, [postventaQueue, mantencionesQueue]);
        const customerContext = (0, legacyAdapters_1.buildCustomerContext)(request, suppression, cases, inboundMessages, conversationMessages, customerCandidateResult.result);
        const caseContext = (0, legacyAdapters_1.buildCaseContext)(cases);
        const conversationContext = (0, legacyAdapters_1.buildConversationContext)(allMessages, agentRuns, {
            maxMessages: request.options.maxMessages,
            maxAgentRuns: request.options.maxAgentRuns
        });
        const businessContext = (0, legacyAdapters_1.buildBusinessContext)(request, postventaQueue, mantencionesQueue, orders, request.options.includePostventa, request.options.includeAgentRuns);
        const serviceContext = (0, legacyAdapters_1.buildServiceContext)(request, caseContext, businessContext);
        const botEligibility = (0, botEligibility_1.buildBotEligibility)({
            messageText: request.messageText,
            customerContext,
            caseContext,
            conversationContext,
            serviceContext
        });
        const contextPacks = (0, contextPacks_1.buildContextPacks)({
            serviceContext,
            botEligible: botEligibility.eligible,
            serviceSignals: serviceContext.signals,
            relatedCaseId: resolverIdentity.conversation_case_id,
            relatedOrderId: resolverIdentity.id_order,
            hasPostventaQueue: Boolean(postventaQueue),
            hasMaintenanceQueue: Boolean(mantencionesQueue),
            hasKnowledgeSignals: serviceContext.primary_service === "knowledge" || serviceContext.signals.includes("knowledge"),
            hasCampaignSignals: serviceContext.primary_service === "campaign" || serviceContext.signals.includes("campaign")
        });
        const partialContext = warnings.length > 0 || errors.length > 0;
        return {
            ok: true,
            request_id: makeContextRequestId(request),
            partial_context: partialContext,
            input_event: inputEvent,
            resolver_identity: resolverIdentity,
            customer_context: customerContext,
            case_context: caseContext,
            conversation_context: conversationContext,
            business_context: businessContext,
            service_context: serviceContext,
            bot_eligibility: botEligibility,
            context_packs: contextPacks,
            warnings,
            errors,
            metadata: {
                version: BRAIN_CONTEXT_VERSION,
                generatedAt: new Date().toISOString(),
                processingMs: Date.now() - startedAt,
                dryRun: request.options.dryRun,
                maxMessages: request.options.maxMessages,
                maxAgentRuns: request.options.maxAgentRuns,
                maxCases: request.options.maxCases,
                includePostventa: request.options.includePostventa,
                includeAgentRuns: request.options.includeAgentRuns,
                sourceWorkflow: request.sourceWorkflow,
                sourceNode: request.sourceNode
            }
        };
    }
    catch (error) {
        const fallbackWarning = error instanceof Error ? error.message : String(error);
        warnings.push("Context engine failed closed and returned fallback data.");
        errors.push(contextError("Context engine failed.", { error: fallbackWarning }));
        return buildFallbackResponse(request, startedAt, warnings, errors);
    }
}

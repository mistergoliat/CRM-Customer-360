"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCustomerCandidate = resolveCustomerCandidate;
const constants_1 = require("./constants");
const normalize_1 = require("./normalize");
const sourceReaders_1 = require("./sourceReaders");
const CUSTOMER_RESOLVER_VERSION = "p1j-001-readonly-1";
const CUSTOMER_RESOLUTION_MODE = "read_only_composite";
const CUSTOMER_STRONG_IDENTITY_TYPE_SET = new Set(constants_1.CUSTOMER_STRONG_IDENTITY_TYPES);
const CUSTOMER_PROVISIONAL_IDENTITY_TYPE_SET = new Set(constants_1.CUSTOMER_PROVISIONAL_IDENTITY_TYPES);
const CUSTOMER_NO_WRITE_POLICY = {
    canCreateCustomerMaster: false,
    canAttachIdentity: false,
    canAppendTimelineEvent: false,
    canMerge: false,
    reason: "read_only_composite",
};
function cleanText(value) {
    if (value === null || value === undefined)
        return null;
    const text = String(value).trim();
    return text.length > 0 ? text : null;
}
function uniqueStrings(values) {
    return Array.from(new Set(values.filter((value) => Boolean(value))));
}
function normalizeInput(input) {
    return {
        waId: (0, normalize_1.normalizeWaId)(input.waId),
        email: (0, normalize_1.normalizeEmail)(input.email),
        phone: (0, normalize_1.normalizePhoneChile)(input.phone),
        idCustomer: (0, normalize_1.normalizeIdentityValue)("prestashop_customer_id", input.idCustomer),
        idOrder: (0, normalize_1.normalizeIdentityValue)("order_id", input.idOrder),
        invoiceNumber: (0, normalize_1.normalizeIdentityValue)("invoice_number", input.invoiceNumber),
        conversationCaseId: cleanText(input.conversationCaseId),
        messageId: cleanText(input.messageId),
    };
}
function observationKey(observation) {
    return [
        observation.source,
        observation.table,
        String(observation.sourceRecordId ?? ""),
        observation.matchedBy,
        observation.identityType ?? "",
        observation.identityValue ?? "",
        observation.customerKey ?? "",
    ].join("|");
}
function bucketKey(observation) {
    return (observation.customerKey ?? [observation.source, observation.table, String(observation.sourceRecordId ?? ""), observation.matchedBy].join(":"));
}
function rankConfidence(confidence) {
    if (confidence === "high")
        return 3;
    if (confidence === "medium")
        return 2;
    return 1;
}
function rankIdentityType(type) {
    if (!type)
        return 0;
    const index = constants_1.CUSTOMER_IDENTITY_PRECEDENCE.findIndex((candidate) => candidate === type);
    return index === -1 ? 0 : constants_1.CUSTOMER_IDENTITY_PRECEDENCE.length - index;
}
function rankSource(source) {
    switch (source) {
        case "prestashop":
            return 5;
        case "hub_operator":
            return 4;
        case "whatsapp":
        case "brain":
        case "mariadb":
            return 3;
        case "n8n":
        case "import":
            return 2;
        case "appsheet":
            return 1;
        case "unknown":
        default:
            return 0;
    }
}
function observationRank(observation) {
    return rankConfidence(observation.confidence) * 100 + rankIdentityType(observation.identityType) * 10 + rankSource(observation.source);
}
function isStrongObservation(observation) {
    return (observation.source === "prestashop" &&
        observation.confidence === "high" &&
        observation.identityType !== null &&
        CUSTOMER_STRONG_IDENTITY_TYPE_SET.has(observation.identityType));
}
function isProvisionalObservation(observation) {
    return (observation.identityType !== null &&
        CUSTOMER_PROVISIONAL_IDENTITY_TYPE_SET.has(observation.identityType));
}
function buildSyntheticCustomerKey(input) {
    if (input.idCustomer)
        return `candidate:prestashop:${input.idCustomer}`;
    if (input.email)
        return `candidate:email:${input.email}`;
    if (input.waId)
        return `candidate:wa_id:${input.waId}`;
    if (input.phone)
        return `candidate:phone:${input.phone}`;
    if (input.idOrder)
        return `candidate:order:${input.idOrder}`;
    if (input.invoiceNumber)
        return `candidate:invoice:${input.invoiceNumber}`;
    if (input.conversationCaseId)
        return `candidate:case:${input.conversationCaseId}`;
    if (input.messageId)
        return `candidate:message:${input.messageId}`;
    return null;
}
function buildSyntheticObservation(input) {
    const customerKey = buildSyntheticCustomerKey(input);
    if (!customerKey)
        return null;
    const identityType = input.email
        ? "email"
        : input.idCustomer
            ? "prestashop_customer_id"
            : input.idOrder
                ? "order_id"
                : input.invoiceNumber
                    ? "invoice_number"
                    : input.phone
                        ? "phone"
                        : input.waId
                            ? "wa_id"
                            : null;
    if (!identityType)
        return null;
    const identityValue = identityType === "email"
        ? input.email
        : identityType === "prestashop_customer_id"
            ? input.idCustomer
            : identityType === "order_id"
                ? input.idOrder
                : identityType === "invoice_number"
                    ? input.invoiceNumber
                    : identityType === "phone"
                        ? input.phone
                        : input.waId;
    return {
        source: "unknown",
        table: "customer_candidate_input",
        sourceRecordId: input.messageId ?? input.conversationCaseId ?? input.idCustomer ?? input.idOrder ?? input.invoiceNumber ?? input.waId ?? input.email ?? input.phone,
        matchedBy: identityType,
        identityType,
        identityValue,
        confidence: input.email || input.idCustomer || input.idOrder || input.invoiceNumber ? "high" : "medium",
        customerKey,
        notes: ["Synthetic read-only candidate derived from input signal."],
        timelineSeed: null,
    };
}
function buildTimelineSeed(observation, fallbackEventType, confidence) {
    if (!observation)
        return null;
    if (observation.timelineSeed)
        return observation.timelineSeed;
    const refId = observation.sourceRecordId ??
        observation.identityValue ??
        observation.customerKey ??
        null;
    if (refId === null || refId === undefined)
        return null;
    return {
        eventType: fallbackEventType,
        eventSource: observation.source,
        eventRefType: observation.identityType === "order_id"
            ? "order_id"
            : observation.identityType === "invoice_number"
                ? "invoice_number"
                : observation.matchedBy === "conversation_case_id"
                    ? "conversation_case_id"
                    : observation.matchedBy === "message_id"
                        ? "message_id"
                        : "identity",
        eventRefId: refId,
        confidence,
        payload: {
            matchedBy: observation.matchedBy,
            identityType: observation.identityType,
            identityValue: observation.identityValue,
            customerKey: observation.customerKey,
        },
    };
}
function buildSourceMatches(observations) {
    const seen = new Set();
    const matches = [];
    for (const observation of observations) {
        const key = observationKey(observation);
        if (seen.has(key))
            continue;
        seen.add(key);
        matches.push({
            source: observation.source,
            matchedBy: observation.matchedBy,
            confidence: observation.confidence,
            sourceRecordId: observation.sourceRecordId,
            identityType: observation.identityType,
            identityValue: observation.identityValue,
            customerKey: observation.customerKey,
            notes: observation.notes,
        });
    }
    return matches;
}
function buildIdentities(customerKey, observations) {
    const seen = new Set();
    const identities = [];
    for (const observation of observations) {
        if (!observation.identityType || !observation.identityValue)
            continue;
        const key = `${observation.identityType}:${observation.identityValue}:${observation.source}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        identities.push({
            customerIdentityId: `${customerKey}:${key}`,
            customerMasterId: customerKey,
            identityType: observation.identityType,
            identityValue: observation.identityValue,
            isPrimary: identities.length === 0,
            isVerified: observation.source === "prestashop" && observation.confidence === "high",
            confidence: observation.confidence,
            source: observation.source,
            sourceRecordId: observation.sourceRecordId,
            lifecycleStage: observation.source === "n8n" ? "lead" : "provisional",
            createdAt: null,
            updatedAt: null,
        });
    }
    return identities;
}
function buildCustomer(customerKey, observation, stage, identityState, reviewState, confidence) {
    const primaryIdentityType = observation?.identityType ?? null;
    const primaryIdentityValue = observation?.identityValue ?? observation?.sourceRecordId?.toString() ?? null;
    return {
        customerMasterId: customerKey,
        primaryIdentityType,
        primaryIdentityValue,
        lifecycleStage: stage,
        identityState,
        mergeState: reviewState === "needs_review" ? "conflict" : "none",
        reviewState,
        confidence,
        sourceSystem: observation?.source ?? constants_1.CUSTOMER_DEFAULT_IDENTITY_SOURCE,
        createdAt: null,
        updatedAt: null,
    };
}
function choosePrimaryObservation(observations) {
    return [...observations].sort((left, right) => observationRank(right) - observationRank(left))[0] ?? null;
}
function detectConflictReasons(observations) {
    const reasons = new Set();
    const strongEmails = uniqueStrings(observations
        .filter((observation) => observation.identityType === "email" && observation.confidence === "high")
        .map((observation) => observation.identityValue));
    if (strongEmails.length > 1)
        reasons.add("emails_distinct_strong");
    const strongCustomerIds = uniqueStrings(observations
        .filter((observation) => observation.identityType === "prestashop_customer_id" && observation.confidence === "high")
        .map((observation) => observation.identityValue));
    if (strongCustomerIds.length > 1)
        reasons.add("prestashop_customer_id_distinct");
    const strongOrders = uniqueStrings(observations
        .filter((observation) => observation.identityType === "order_id" && observation.confidence === "high")
        .map((observation) => observation.identityValue));
    const strongInvoices = uniqueStrings(observations
        .filter((observation) => observation.identityType === "invoice_number" && observation.confidence === "high")
        .map((observation) => observation.identityValue));
    if (strongOrders.length > 1 || strongInvoices.length > 1)
        reasons.add("invoice_or_order_assigned_elsewhere");
    const ambiguousSignals = observations.filter((observation) => {
        if (observation.identityType !== "wa_id" && observation.identityType !== "phone")
            return false;
        return observation.confidence !== "high";
    });
    if (ambiguousSignals.length > 1)
        reasons.add("phone_or_wa_id_ambiguous");
    return Array.from(reasons);
}
function buildWarnings(baseWarnings, observations, extras) {
    return uniqueStrings([...baseWarnings, ...observations.flatMap((observation) => observation.notes), ...extras]);
}
function dedupeObservations(observations) {
    const seen = new Set();
    const result = [];
    for (const observation of observations) {
        const key = observationKey(observation);
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(observation);
    }
    return result;
}
function bucketObservations(observations) {
    const map = new Map();
    for (const observation of observations) {
        const key = bucketKey(observation);
        const bucket = map.get(key);
        if (bucket) {
            bucket.observations.push(observation);
        }
        else {
            map.set(key, { key, observations: [observation] });
        }
    }
    return Array.from(map.values());
}
function bestBucket(buckets) {
    return [...buckets].sort((left, right) => {
        const leftBest = choosePrimaryObservation(left.observations);
        const rightBest = choosePrimaryObservation(right.observations);
        return (rightBest ? observationRank(rightBest) : 0) - (leftBest ? observationRank(leftBest) : 0);
    })[0] ?? null;
}
function createInputObservation(input) {
    return buildSyntheticObservation(input);
}
async function resolveCustomerCandidate(input) {
    const normalizedInput = normalizeInput(input);
    const readOnlyRequested = input.options?.readOnly !== false;
    const allowProvisional = input.options?.allowProvisional ?? constants_1.CUSTOMER_DEFAULT_READ_ONLY_OPTIONS.allowProvisional;
    const readerResults = await Promise.all([
        (0, sourceReaders_1.readPrestashopCustomerCandidate)(input),
        (0, sourceReaders_1.readPrestashopAddressCandidate)(input),
        (0, sourceReaders_1.readPrestashopOrderCandidate)(input),
        (0, sourceReaders_1.readLegacyConversationCandidate)(input),
        (0, sourceReaders_1.readLegacyInboundCandidate)(input),
    ]);
    const readerWarnings = readerResults.flatMap((result) => result.warnings);
    const mergedObservations = dedupeObservations(readerResults.flatMap((result) => result.observations));
    const syntheticObservation = createInputObservation(normalizedInput);
    const allObservations = syntheticObservation ? dedupeObservations([...mergedObservations, syntheticObservation]) : mergedObservations;
    const conflictReasons = detectConflictReasons(allObservations);
    const buckets = bucketObservations(allObservations);
    const strongBuckets = buckets.filter((bucket) => bucket.observations.some(isStrongObservation));
    const provisionalBuckets = buckets.filter((bucket) => bucket.observations.some(isProvisionalObservation));
    const selectedBucket = conflictReasons.length > 0 && strongBuckets.length > 1
        ? null
        : bestBucket(strongBuckets.length > 0 ? strongBuckets : provisionalBuckets);
    const selectedObservation = selectedBucket ? choosePrimaryObservation(selectedBucket.observations) : null;
    const hasStrong = strongBuckets.length > 0;
    const hasProvisional = provisionalBuckets.length > 0 || Boolean(syntheticObservation);
    const candidateCustomerIds = uniqueStrings([
        ...buckets.map((bucket) => bucket.key),
        buildSyntheticCustomerKey(normalizedInput),
    ]);
    let status;
    if (conflictReasons.length > 0 && strongBuckets.length > 1) {
        status = "conflict_needs_review";
    }
    else if (hasStrong) {
        status = selectedBucket && selectedBucket.observations.length > 1 ? "linked_identity" : "resolved_existing";
    }
    else if (allowProvisional && hasProvisional) {
        status = "created_provisional";
    }
    else {
        status = "not_enough_identity";
    }
    if (!readOnlyRequested && status !== "not_enough_identity" && status !== "conflict_needs_review") {
        status = "skipped_read_only";
    }
    const confidence = status === "conflict_needs_review"
        ? "low"
        : status === "resolved_existing" || status === "linked_identity"
            ? "high"
            : status === "created_provisional" || status === "skipped_read_only"
                ? "medium"
                : constants_1.CUSTOMER_DEFAULT_IDENTITY_CONFIDENCE;
    const reason = status === "resolved_existing" || status === "linked_identity"
        ? "strong_match"
        : status === "created_provisional"
            ? "provisional_candidate"
            : status === "skipped_read_only"
                ? "read_only"
                : status === "conflict_needs_review"
                    ? "conflict"
                    : "insufficient_identity";
    const customerKey = status === "conflict_needs_review"
        ? null
        : selectedBucket?.key ?? buildSyntheticCustomerKey(normalizedInput);
    const customer = customerKey && status !== "not_enough_identity"
        ? buildCustomer(customerKey, selectedObservation ?? syntheticObservation, status === "created_provisional" || status === "skipped_read_only"
            ? (normalizedInput.waId ? "lead" : "provisional")
            : "customer", status === "conflict_needs_review"
            ? "conflicted"
            : status === "created_provisional" || status === "skipped_read_only"
                ? "provisional"
                : "resolved", status === "conflict_needs_review" ? "needs_review" : "clear", confidence)
        : null;
    const identities = customerKey && status !== "conflict_needs_review"
        ? buildIdentities(customerKey, selectedBucket?.observations ?? (syntheticObservation ? [syntheticObservation] : []))
        : [];
    const timelineSeed = buildTimelineSeed(selectedObservation ?? syntheticObservation, status === "created_provisional"
        ? "customer_candidate_created"
        : status === "linked_identity"
            ? "customer_identity_linked"
            : "customer_candidate_resolved", confidence);
    const warnings = buildWarnings(readerWarnings, allObservations, [
        ...(readOnlyRequested ? [] : ["write_requested_but_unavailable"]),
        ...(status === "conflict_needs_review" ? conflictReasons : []),
        ...(!allowProvisional && hasProvisional ? ["provisional_candidate_not_allowed"] : []),
    ]);
    const sourceMatches = buildSourceMatches(allObservations);
    const metadata = {
        resolverVersion: CUSTOMER_RESOLVER_VERSION,
        resolutionMode: CUSTOMER_RESOLUTION_MODE,
        readOnly: true,
        allowProvisional,
        source: selectedObservation?.source ?? input.source ?? constants_1.CUSTOMER_DEFAULT_IDENTITY_SOURCE,
        matchedBy: selectedObservation?.identityType ?? syntheticObservation?.identityType ?? null,
        candidateCount: candidateCustomerIds.length,
        syntheticCustomerId: customerKey,
        sourceMatchesCount: sourceMatches.length,
        resolvedAt: new Date().toISOString(),
        notes: uniqueStrings([
            `read_only_requested=${String(readOnlyRequested)}`,
            `reader_warnings=${String(readerWarnings.length)}`,
            ...(status === "conflict_needs_review" ? conflictReasons : []),
        ]),
    };
    const resolution = {
        status,
        confidence,
        needsReview: status === "conflict_needs_review",
        readOnly: true,
        reason,
        matchedBy: selectedObservation?.identityType ?? syntheticObservation?.identityType ?? null,
        conflictReasons: status === "conflict_needs_review" ? conflictReasons : [],
        candidateCustomerIds,
    };
    return {
        customer,
        identities,
        resolution,
        timelineSeed,
        warnings,
        metadata,
        sourceMatches,
        writePolicy: CUSTOMER_NO_WRITE_POLICY,
    };
}

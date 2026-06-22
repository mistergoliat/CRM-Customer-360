"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyEvaluationMessage = classifyEvaluationMessage;
exports.buildEvaluationCaseId = buildEvaluationCaseId;
exports.buildEvaluationCaseHash = buildEvaluationCaseHash;
exports.buildExpectedCustomerReferenceHash = buildExpectedCustomerReferenceHash;
exports.buildCustomerReferenceHash = buildCustomerReferenceHash;
exports.analyzeEvaluationCase = analyzeEvaluationCase;
exports.classifyEvaluation = classifyEvaluation;
exports.summarizeEvaluation = summarizeEvaluation;
exports.sanitizeCaseResult = sanitizeCaseResult;
exports.sanitizeReport = sanitizeReport;
exports.getNormalizedPhoneState = getNormalizedPhoneState;
const node_crypto_1 = __importDefault(require("node:crypto"));
const normalize_1 = require("./normalize");
function shortHash(value) {
    return node_crypto_1.default.createHash("sha256").update(value).digest("hex").slice(0, 12);
}
function isPositiveStatus(status) {
    return status === "resolved_existing" || status === "linked_identity" || status === "created_provisional";
}
function countByKey(entries) {
    const counts = {};
    for (const entry of entries) {
        counts[entry] = (counts[entry] ?? 0) + 1;
    }
    return counts;
}
function percentile(values, p) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[rank] ?? 0;
}
function parseStructuredWarning(raw) {
    const parts = raw.split("|").map((part) => part.trim());
    if (parts.length < 3)
        return null;
    const [code, source, severity] = parts;
    if (!code || !source || !severity)
        return null;
    if (severity !== "informational" && severity !== "warning" && severity !== "error")
        return null;
    return {
        code,
        source: source,
        severity,
    };
}
function classifyEvaluationMessage(raw) {
    const structured = parseStructuredWarning(raw);
    if (structured)
        return structured;
    const text = raw.toLowerCase();
    if (text.includes("table not found") || text.includes("table_missing") || text.includes("unavailable or missing")) {
        return { code: "table_not_found", source: "unknown", severity: "warning" };
    }
    if (text.includes("column") && text.includes("missing")) {
        return { code: "column_not_found", source: "unknown", severity: "warning" };
    }
    if (text.includes("skipped because no usable identity columns")) {
        return { code: "source_not_configured", source: "unknown", severity: "warning" };
    }
    if (text.includes("query failed")) {
        return { code: "query_failed", source: "unknown", severity: "error" };
    }
    if (text.includes("schema drift")) {
        return { code: "schema_drift", source: "unknown", severity: "warning" };
    }
    if (text.includes("ambiguous")) {
        return { code: "ambiguous_match", source: "unknown", severity: "warning" };
    }
    if (text.includes("no match")) {
        return { code: "no_match", source: "unknown", severity: "informational" };
    }
    return { code: "unknown_warning", source: "unknown", severity: "warning" };
}
function buildEvaluationCaseId(input) {
    if (input.caseId && input.caseId.trim())
        return input.caseId.trim();
    const fingerprint = [
        input.source ?? "unknown",
        input.waId ?? "",
        input.email ?? "",
        input.phone ?? "",
        String(input.idCustomer ?? ""),
        String(input.idOrder ?? ""),
        String(input.invoiceNumber ?? ""),
        String(input.conversationCaseId ?? ""),
        String(input.messageId ?? ""),
    ].join("|");
    return `case_${shortHash(fingerprint)}`;
}
function buildEvaluationCaseHash(input) {
    const fingerprint = [
        buildEvaluationCaseId(input),
        input.source ?? "unknown",
        input.waId ?? "",
        input.email ?? "",
        input.phone ?? "",
        String(input.idCustomer ?? ""),
        String(input.idOrder ?? ""),
        String(input.invoiceNumber ?? ""),
        String(input.conversationCaseId ?? ""),
        String(input.messageId ?? ""),
    ].join("|");
    return shortHash(fingerprint);
}
function buildExpectedCustomerReferenceHash(value) {
    if (!value || !value.trim())
        return null;
    return shortHash(value.trim());
}
function buildCustomerReferenceHash(result) {
    const candidate = result.metadata.syntheticCustomerId ?? result.resolution.candidateCustomerIds[0] ?? null;
    if (!candidate)
        return null;
    return shortHash(candidate);
}
function analyzeEvaluationCase(input, result, latencyMs, telemetry = {}) {
    const caseId = buildEvaluationCaseId(input);
    const caseHash = buildEvaluationCaseHash(input);
    const reviewedByHuman = input.reviewedByHuman === true;
    const reviewNote = input.reviewNote ?? null;
    const sourceCategories = input.sourceCategories ?? [];
    const expected = reviewedByHuman ? input.expectedResolution ?? null : null;
    const expectedCustomerReference = reviewedByHuman ? buildExpectedCustomerReferenceHash(input.expectedCustomerReference) : null;
    const sourceMessages = result.warnings.map(classifyEvaluationMessage);
    const syntheticMessages = [];
    const phoneNormalized = input.phone !== null && input.phone !== undefined && Boolean((0, normalize_1.normalizePhoneChile)(input.phone));
    if (input.phone && !phoneNormalized) {
        syntheticMessages.push({ code: "invalid_phone", source: input.source ?? "unknown", severity: "warning" });
    }
    if (!reviewedByHuman && result.resolution.status === "not_enough_identity") {
        syntheticMessages.push({ code: "no_match", source: input.source ?? "unknown", severity: "informational" });
    }
    const messages = [...sourceMessages, ...syntheticMessages];
    const warningMessages = messages.filter((message) => message.severity === "warning");
    const errorMessages = messages.filter((message) => message.severity === "error");
    const informationalMessages = messages.filter((message) => message.severity === "informational");
    const sourceMatchCountBySource = countByKey(result.sourceMatches.map((match) => match.source));
    const actualReferenceHash = buildCustomerReferenceHash(result);
    const exactMatch = reviewedByHuman &&
        expected !== null &&
        (expected.status === undefined || expected.status === result.resolution.status) &&
        (expected.confidence === undefined || expected.confidence === result.resolution.confidence) &&
        (expected.needsReview === undefined || expected.needsReview === result.resolution.needsReview) &&
        (expected.readOnly === undefined || expected.readOnly === result.resolution.readOnly) &&
        (expected.matchedBy === undefined || expected.matchedBy === result.resolution.matchedBy) &&
        (expectedCustomerReference === null || expectedCustomerReference === actualReferenceHash);
    const expectedPositive = reviewedByHuman && expected?.status ? isPositiveStatus(expected.status) : false;
    const actualPositive = isPositiveStatus(result.resolution.status);
    const falsePositive = reviewedByHuman &&
        expected !== null &&
        ((expectedPositive && actualPositive && expectedCustomerReference !== null && expectedCustomerReference !== actualReferenceHash) ||
            (!expectedPositive && actualPositive));
    const falseNegative = reviewedByHuman &&
        expected !== null &&
        ((expectedPositive && !actualPositive) || (expected.status === "conflict_needs_review" && result.resolution.status !== "conflict_needs_review"));
    const conflictDetected = result.resolution.status === "conflict_needs_review";
    return {
        caseId,
        caseHash,
        source: input.source ?? "unknown",
        sourceCategories,
        reviewedByHuman,
        reviewNote,
        signals: {
            waId: Boolean(input.waId),
            email: Boolean(input.email),
            phone: Boolean(input.phone),
            idCustomer: input.idCustomer !== null && input.idCustomer !== undefined && String(input.idCustomer).trim() !== "",
            idOrder: input.idOrder !== null && input.idOrder !== undefined && String(input.idOrder).trim() !== "",
            invoiceNumber: Boolean(input.invoiceNumber),
            conversationCaseId: input.conversationCaseId !== null && input.conversationCaseId !== undefined && String(input.conversationCaseId).trim() !== "",
            messageId: Boolean(input.messageId),
        },
        actual: {
            status: result.resolution.status,
            confidence: result.resolution.confidence,
            needsReview: result.resolution.needsReview,
            readOnly: result.resolution.readOnly,
            matchedBy: result.resolution.matchedBy,
            customerReferenceHash: actualReferenceHash,
        },
        phoneNormalized,
        expected,
        expectedCustomerReference,
        exactMatch,
        falsePositive,
        falseNegative,
        conflictDetected,
        latencyMs,
        estimatedReaderCount: telemetry.estimatedReaderCount ?? 0,
        estimatedQueryCount: telemetry.estimatedQueryCount ?? 0,
        readerLatencyMsByReader: telemetry.readerLatencyMsByReader ?? {},
        messageCount: messages.length,
        informationalCount: informationalMessages.length,
        warningCount: warningMessages.length,
        errorCount: errorMessages.length,
        messageCountBySeverity: {
            informational: informationalMessages.length,
            warning: warningMessages.length,
            error: errorMessages.length,
        },
        warningCountByCode: countByKey(warningMessages.map((message) => message.code)),
        warningCountBySource: countByKey(warningMessages.map((message) => message.source)),
        sourceMatchCountBySource,
    };
}
function classifyEvaluation(summaryInput) {
    if (summaryInput.fatalErrors > 0)
        return "fail";
    if (summaryInput.errorCount > 0)
        return "fail";
    if (summaryInput.reviewedFalsePositiveCount > 0)
        return "fail";
    if (summaryInput.reviewedFalseNegativeRate > 0.15)
        return "fail";
    if (summaryInput.reviewedCases > 0 && summaryInput.reviewedExactMatchCount < summaryInput.casesWithExpectations)
        return "warning";
    if (summaryInput.reviewedCases === 0 && summaryInput.casesWithExpectations === 0)
        return "warning";
    if (summaryInput.reviewedFalseNegativeRate > 0)
        return "warning";
    if (summaryInput.warningCount > 0)
        return "warning";
    return "pass";
}
function summariseReaderLatencies(caseResults) {
    const perReader = {};
    for (const result of caseResults) {
        for (const [reader, latency] of Object.entries(result.readerLatencyMsByReader)) {
            if (!perReader[reader])
                perReader[reader] = [];
            perReader[reader].push(latency);
        }
    }
    const summary = {};
    for (const [reader, latencies] of Object.entries(perReader)) {
        summary[reader] = {
            count: latencies.length,
            averageLatencyMs: latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
            p50LatencyMs: percentile(latencies, 50),
            p95LatencyMs: percentile(latencies, 95),
            maxLatencyMs: Math.max(...latencies),
        };
    }
    return summary;
}
function summarizeEvaluation(caseResults, options) {
    const totalCases = caseResults.length;
    const reviewedCases = caseResults.filter((result) => result.reviewedByHuman).length;
    const unreviewedCases = totalCases - reviewedCases;
    const totals = {
        resolved_existing: caseResults.filter((result) => result.actual.status === "resolved_existing").length,
        linked_identity: caseResults.filter((result) => result.actual.status === "linked_identity").length,
        created_provisional: caseResults.filter((result) => result.actual.status === "created_provisional").length,
        conflict_needs_review: caseResults.filter((result) => result.actual.status === "conflict_needs_review").length,
        not_enough_identity: caseResults.filter((result) => result.actual.status === "not_enough_identity").length,
        skipped_read_only: caseResults.filter((result) => result.actual.status === "skipped_read_only").length,
    };
    const phoneNormalizationSuccessCount = caseResults.filter((result) => result.phoneNormalized).length;
    const totalPhoneCases = caseResults.filter((result) => result.signals.phone).length;
    const reviewedCasesWithExpectations = caseResults.filter((result) => result.reviewedByHuman && result.expected !== null);
    const reviewedExactMatches = reviewedCasesWithExpectations.filter((result) => result.exactMatch);
    const reviewedFalsePositives = reviewedCasesWithExpectations.filter((result) => result.falsePositive);
    const reviewedFalseNegatives = reviewedCasesWithExpectations.filter((result) => result.falseNegative);
    const reviewedConflictExpected = reviewedCasesWithExpectations.filter((result) => result.expected?.status === "conflict_needs_review");
    const reviewedConflictDetected = reviewedConflictExpected.filter((result) => result.conflictDetected).length;
    const warningMessages = caseResults.flatMap((result) => Object.entries(result.warningCountByCode).flatMap(([code, count]) => Array.from({ length: count }, () => code)));
    const warningSources = caseResults.flatMap((result) => Object.entries(result.warningCountBySource).flatMap(([source, count]) => Array.from({ length: count }, () => source)));
    const severityMessages = caseResults.flatMap((result) => Object.entries(result.messageCountBySeverity).flatMap(([severity, count]) => Array.from({ length: count }, () => severity)));
    const sourceMatches = caseResults.flatMap((result) => Object.entries(result.sourceMatchCountBySource).flatMap(([source, count]) => Array.from({ length: count }, () => source)));
    const latencies = caseResults.map((result) => result.latencyMs);
    const readerCounts = caseResults.map((result) => result.estimatedReaderCount);
    const queryCounts = caseResults.map((result) => result.estimatedQueryCount);
    const totalMessages = caseResults.reduce((sum, result) => sum + result.messageCount, 0);
    const informationalCount = caseResults.reduce((sum, result) => sum + result.informationalCount, 0);
    const warningCount = caseResults.reduce((sum, result) => sum + result.warningCount, 0);
    const errorCount = caseResults.reduce((sum, result) => sum + result.errorCount, 0);
    const fatalErrors = (options.errors?.length ?? 0) + errorCount;
    const reviewedExactMatchCount = reviewedExactMatches.length;
    const reviewedFalsePositiveCount = reviewedFalsePositives.length;
    const reviewedFalseNegativeCount = reviewedFalseNegatives.length;
    const reviewedConflictDetectionAccuracy = reviewedConflictExpected.length > 0 ? reviewedConflictDetected / reviewedConflictExpected.length : null;
    const reviewedExactMatchRate = reviewedCasesWithExpectations.length > 0 ? reviewedExactMatchCount / reviewedCasesWithExpectations.length : 0;
    const reviewedFalsePositiveRate = reviewedCasesWithExpectations.length > 0 ? reviewedFalsePositiveCount / reviewedCasesWithExpectations.length : 0;
    const reviewedFalseNegativeRate = reviewedCasesWithExpectations.length > 0 ? reviewedFalseNegativeCount / reviewedCasesWithExpectations.length : 0;
    const summaryBase = {
        totalCases,
        reviewedCases,
        unreviewedCases,
        casesWithExpectations: reviewedCasesWithExpectations.length,
        totalMessages,
        informationalCount,
        warningCount,
        errorCount,
        fatalErrors,
        resolvedExistingCount: totals.resolved_existing,
        linkedIdentityCount: totals.linked_identity,
        createdProvisionalCount: totals.created_provisional,
        conflictNeedsReviewCount: totals.conflict_needs_review,
        notEnoughIdentityCount: totals.not_enough_identity,
        skippedReadOnlyCount: totals.skipped_read_only,
        resolvedExistingRate: totalCases > 0 ? totals.resolved_existing / totalCases : 0,
        linkedIdentityRate: totalCases > 0 ? totals.linked_identity / totalCases : 0,
        createdProvisionalRate: totalCases > 0 ? totals.created_provisional / totalCases : 0,
        conflictNeedsReviewRate: totalCases > 0 ? totals.conflict_needs_review / totalCases : 0,
        notEnoughIdentityRate: totalCases > 0 ? totals.not_enough_identity / totalCases : 0,
        skippedReadOnlyRate: totalCases > 0 ? totals.skipped_read_only / totalCases : 0,
        phoneNormalizationSuccessRate: totalPhoneCases > 0 ? phoneNormalizationSuccessCount / totalPhoneCases : 0,
        averageLatencyMs: latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0,
        p50LatencyMs: percentile(latencies, 50),
        p95LatencyMs: percentile(latencies, 95),
        maxLatencyMs: latencies.length > 0 ? Math.max(...latencies) : 0,
        averageEstimatedReaderCount: readerCounts.length > 0 ? readerCounts.reduce((sum, value) => sum + value, 0) / readerCounts.length : 0,
        averageEstimatedQueryCount: queryCounts.length > 0 ? queryCounts.reduce((sum, value) => sum + value, 0) / queryCounts.length : 0,
        readerLatencySummaryByReader: summariseReaderLatencies(caseResults),
        reviewedExactMatchCount,
        reviewedExactMatchRate,
        reviewedFalsePositiveCount,
        reviewedFalsePositiveRate,
        reviewedFalseNegativeCount,
        reviewedFalseNegativeRate,
        reviewedConflictDetectionAccuracy,
        exactMatchCount: reviewedExactMatchCount,
        exactMatchRate: reviewedExactMatchRate,
        falsePositiveCount: reviewedFalsePositiveCount,
        falsePositiveRate: reviewedFalsePositiveRate,
        falseNegativeCount: reviewedFalseNegativeCount,
        falseNegativeRate: reviewedFalseNegativeRate,
        conflictDetectionAccuracy: reviewedConflictDetectionAccuracy,
        warningCountByCode: countByKey(warningMessages),
        warningCountBySource: countByKey(warningSources),
        messageCountBySeverity: {
            informational: severityMessages.filter((severity) => severity === "informational").length,
            warning: severityMessages.filter((severity) => severity === "warning").length,
            error: severityMessages.filter((severity) => severity === "error").length,
        },
        sourceMatchCountBySource: countByKey(sourceMatches),
        errors: options.errors ?? [],
        sampleMode: options.sampleMode,
    };
    const classification = classifyEvaluation(summaryBase);
    return {
        ...summaryBase,
        classification,
    };
}
function sanitizeCaseResult(result) {
    return {
        caseId: result.caseId,
        caseHash: result.caseHash,
        source: result.source,
        sourceCategories: result.sourceCategories,
        reviewedByHuman: result.reviewedByHuman,
        reviewNote: result.reviewNote,
        actual: result.actual,
        expected: result.expected,
        expectedCustomerReference: result.expectedCustomerReference,
        exactMatch: result.exactMatch,
        falsePositive: result.falsePositive,
        falseNegative: result.falseNegative,
        conflictDetected: result.conflictDetected,
        latencyMs: result.latencyMs,
        estimatedReaderCount: result.estimatedReaderCount,
        estimatedQueryCount: result.estimatedQueryCount,
        readerLatencyMsByReader: result.readerLatencyMsByReader,
        messageCount: result.messageCount,
        informationalCount: result.informationalCount,
        warningCount: result.warningCount,
        errorCount: result.errorCount,
        messageCountBySeverity: result.messageCountBySeverity,
        warningCountByCode: result.warningCountByCode,
        warningCountBySource: result.warningCountBySource,
        sourceMatchCountBySource: result.sourceMatchCountBySource,
        phoneNormalized: result.phoneNormalized,
        signals: result.signals,
    };
}
function sanitizeReport(report) {
    return {
        summary: report.summary,
        cases: report.cases.map(sanitizeCaseResult),
    };
}
function getNormalizedPhoneState(input) {
    return {
        hasPhone: Boolean(input.phone),
        normalizedPhone: (0, normalize_1.normalizePhoneChile)(input.phone),
    };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateSalesAgentOutput = validateSalesAgentOutput;
const validationTypes_1 = require("./validationTypes");
const salesAgentConstants_1 = require("../salesAgentConstants");
const validationTypes_2 = require("./validationTypes");
const createFailedSafeResult_1 = require("./createFailedSafeResult");
const sanitizeSalesAgentOutput_1 = require("./sanitizeSalesAgentOutput");
const CONFIDENCE_SET = new Set(salesAgentConstants_1.SALES_AGENT_CONFIDENCE_LEVELS);
const RISK_SET = new Set(salesAgentConstants_1.SALES_AGENT_RISK_LEVELS);
const APPROVAL_SET = new Set(salesAgentConstants_1.SALES_AGENT_APPROVAL_REQUIREMENTS);
const OUTCOME_SET = new Set(salesAgentConstants_1.SALES_AGENT_OUTCOMES);
const DECISION_SET = new Set(salesAgentConstants_1.SALES_AGENT_DECISION_TYPES);
const ACTION_SET = new Set(salesAgentConstants_1.SALES_AGENT_ACTION_TYPES);
const TOOL_SET = new Set(salesAgentConstants_1.SALES_AGENT_TOOL_NAMES);
const TOOL_STATUS_SET = new Set(salesAgentConstants_1.SALES_AGENT_TOOL_REQUEST_STATUSES);
const MESSAGE_INTENT_SET = new Set(salesAgentConstants_1.SALES_AGENT_MESSAGE_INTENTS);
const CLAIM_SET = new Set(salesAgentConstants_1.SALES_AGENT_CLAIM_TYPES);
const SENSITIVE_CLAIM_SET = new Set(salesAgentConstants_1.SALES_AGENT_SENSITIVE_CLAIMS);
const EVIDENCE_SET = new Set(salesAgentConstants_1.SALES_AGENT_EVIDENCE_SOURCES);
const QUALIFICATION_SET = new Set(salesAgentConstants_1.QUALIFICATION_STATES);
const READINESS_SET = new Set(salesAgentConstants_1.CUSTOMER_READINESS_LEVELS);
const FIT_SET = new Set(salesAgentConstants_1.PRODUCT_FIT_ASSESSMENTS);
const ERROR_CODE_SET = new Set(salesAgentConstants_1.SALES_AGENT_ERROR_CODES);
const ALLOWED_LEAD_KEY_SET = new Set(salesAgentConstants_1.SALES_AGENT_ALLOWED_LEAD_PROPOSED_CHANGE_KEYS);
const ALLOWED_OPPORTUNITY_KEY_SET = new Set(salesAgentConstants_1.SALES_AGENT_ALLOWED_OPPORTUNITY_PROPOSED_CHANGE_KEYS);
const BLOCKED_ACTION_SET = new Set(salesAgentConstants_1.SALES_AGENT_BLOCKED_ACTIONS);
const FATAL_CODE_SET = new Set(validationTypes_2.SALES_AGENT_OUTPUT_VALIDATION_FATAL_CODES);
const SENSORIALLY_SAFE_STRING = /^[\s\S]*$/;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function issue(code, message, path, details, level) {
    const issueLevel = level ??
        (FATAL_CODE_SET.has(code)
            ? "fatal"
            : code === "excessive_string_length" || code === "excessive_array_length" || code === "unsafe_metadata"
                ? "warning"
                : "error");
    return {
        code,
        level: issueLevel,
        message,
        path,
        details
    };
}
function pushIssue(state, next) {
    state.issues.push(next);
    if (next.level === "warning" && next.code) {
        state.warnings.push(next.code);
    }
}
function isFatalIssue(next) {
    return next.level === "fatal" || FATAL_CODE_SET.has(next.code);
}
function sanitizeRootMetadata(metadata) {
    const wrapped = (0, sanitizeSalesAgentOutput_1.sanitizeSalesAgentOutput)({ metadata: metadata ?? {} });
    if (!wrapped.value || !isRecord(wrapped.value.metadata)) {
        return {
            metadata: {},
            issues: wrapped.issues,
            bytes: 0,
            sanitized: wrapped.sanitized
        };
    }
    return {
        metadata: wrapped.value.metadata,
        issues: wrapped.issues,
        bytes: JSON.stringify(wrapped.value.metadata).length,
        sanitized: wrapped.sanitized
    };
}
function normalizeString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || !SENSORIALLY_SAFE_STRING.test(trimmed))
        return null;
    return trimmed.length > validationTypes_2.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH ? trimmed.slice(0, validationTypes_2.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH) : trimmed;
}
function normalizeRequiredString(value, path, state, fieldName, maxLength = validationTypes_2.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH) {
    if (typeof value !== "string") {
        pushIssue(state, issue("missing_required_field", `${fieldName} is required.`, path));
        return null;
    }
    let trimmed = value.trim();
    if (!trimmed) {
        pushIssue(state, issue("missing_required_field", `${fieldName} is required.`, path));
        return null;
    }
    if (trimmed.length > maxLength) {
        pushIssue(state, issue("excessive_string_length", `${fieldName} exceeded the maximum length and was trimmed.`, path, { maxLength }, "warning"));
        trimmed = trimmed.slice(0, maxLength);
        state.sanitizedFields.add(path.join("."));
    }
    return trimmed;
}
function normalizeOptionalString(value, path, state, maxLength = validationTypes_2.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== "string") {
        pushIssue(state, issue("invalid_field_type", "Expected a string field.", path));
        return null;
    }
    let trimmed = value.trim();
    if (!trimmed)
        return null;
    if (trimmed.length > maxLength) {
        pushIssue(state, issue("excessive_string_length", "String exceeded the maximum length and was trimmed.", path, { maxLength }, "warning"));
        trimmed = trimmed.slice(0, maxLength);
        state.sanitizedFields.add(path.join("."));
    }
    return trimmed;
}
function normalizeBoolean(value, path, state, fieldName) {
    if (typeof value === "boolean")
        return value;
    pushIssue(state, issue("invalid_field_type", `${fieldName} must be a boolean.`, path));
    return null;
}
function normalizeEnumValue(value, allowed, path, state, fieldName, code = "invalid_enum_value") {
    const normalized = normalizeString(value);
    if (normalized && allowed.has(normalized))
        return normalized;
    pushIssue(state, issue(code, `${fieldName} contains an unsupported value.`, path, { received: value }));
    return null;
}
function normalizeStringList(value, path, state, fieldName, options = {
    maxItems: validationTypes_2.SALES_AGENT_OUTPUT_MAX_ARRAY_LENGTH,
    itemMaxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH
}) {
    if (value === undefined || value === null) {
        return options.required ? (pushIssue(state, issue("missing_required_field", `${fieldName} is required.`, path)), null) : [];
    }
    if (!Array.isArray(value)) {
        pushIssue(state, issue("invalid_field_type", `${fieldName} must be an array.`, path));
        return null;
    }
    const trimmed = value.slice(0, options.maxItems);
    if (trimmed.length !== value.length) {
        pushIssue(state, issue("excessive_array_length", `${fieldName} exceeded the maximum length and was trimmed.`, path, { maxLength: options.maxItems }, options.warnOnly ? "warning" : "error"));
        state.sanitizedFields.add(path.join("."));
    }
    const output = [];
    for (let index = 0; index < trimmed.length; index += 1) {
        const item = trimmed[index];
        if (typeof item !== "string") {
            pushIssue(state, issue("invalid_field_type", `${fieldName} entries must be strings.`, [...path, String(index)]));
            continue;
        }
        const normalized = item.trim();
        if (!normalized)
            continue;
        const itemMaxLength = options.itemMaxLength ?? validationTypes_2.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH;
        const finalValue = normalized.length > itemMaxLength ? normalized.slice(0, itemMaxLength) : normalized;
        if (finalValue.length !== normalized.length) {
            pushIssue(state, issue("excessive_string_length", `${fieldName} entry exceeded the maximum length and was trimmed.`, [...path, String(index)], { maxLength: itemMaxLength }, "warning"));
            state.sanitizedFields.add([...path, String(index)].join("."));
        }
        output.push(finalValue);
    }
    return output;
}
function normalizeDateString(value, path, state, fieldName) {
    if (value === undefined || value === null)
        return null;
    if (typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime()))
            return parsed.toISOString();
    }
    if (value instanceof Date && !Number.isNaN(value.getTime()))
        return value.toISOString();
    pushIssue(state, issue("invalid_field_type", `${fieldName} must be a valid ISO date string.`, path));
    return null;
}
function normalizePlainObject(value, path, state, fieldName, required = false) {
    if (value === undefined || value === null) {
        if (required) {
            pushIssue(state, issue("missing_required_field", `${fieldName} is required.`, path));
            return null;
        }
        return {};
    }
    if (!isRecord(value)) {
        pushIssue(state, issue("invalid_field_type", `${fieldName} must be an object.`, path));
        return null;
    }
    return value;
}
function normalizeRequiredArray(value, path, state, fieldName) {
    if (!Array.isArray(value)) {
        pushIssue(state, issue("missing_required_field", `${fieldName} is required.`, path));
        return null;
    }
    return value;
}
function normalizeRequiredRecord(value, path, state, fieldName) {
    if (!isRecord(value)) {
        pushIssue(state, issue("missing_required_field", `${fieldName} is required.`, path));
        return null;
    }
    return value;
}
function validateConfidence(value, path, state, fieldName) {
    return normalizeEnumValue(value, CONFIDENCE_SET, path, state, fieldName);
}
function validateRiskLevel(value, path, state, fieldName) {
    return normalizeEnumValue(value, RISK_SET, path, state, fieldName);
}
function validateApprovalRequirement(value, path, state, fieldName) {
    return normalizeEnumValue(value, APPROVAL_SET, path, state, fieldName);
}
function validateOutcome(value, path, state) {
    return normalizeEnumValue(value, OUTCOME_SET, path, state, "outcome");
}
function validateDecisionType(value, path, state) {
    return normalizeEnumValue(value, DECISION_SET, path, state, "decision.type");
}
function validateActionType(value, path, state) {
    return normalizeEnumValue(value, ACTION_SET, path, state, "proposedActions.type");
}
function validateToolName(value, path, state) {
    return normalizeEnumValue(value, TOOL_SET, path, state, "toolRequests.tool");
}
function validateToolStatus(value, path, state) {
    return normalizeEnumValue(value, TOOL_STATUS_SET, path, state, "toolRequests.status");
}
function validateMessageIntent(value, path, state) {
    return normalizeEnumValue(value, MESSAGE_INTENT_SET, path, state, "responseProposal.messageIntent");
}
function validateClaimType(value, path, state) {
    return normalizeEnumValue(value, CLAIM_SET, path, state, "claims.type");
}
function validateEvidenceSource(value, path, state, fieldName) {
    return normalizeEnumValue(value, EVIDENCE_SET, path, state, fieldName);
}
function validateQualificationState(value, path, state, fieldName) {
    return normalizeEnumValue(value, QUALIFICATION_SET, path, state, fieldName);
}
function validateReadiness(value, path, state, fieldName) {
    return normalizeEnumValue(value, READINESS_SET, path, state, fieldName);
}
function validateProductFit(value, path, state, fieldName) {
    return normalizeEnumValue(value, FIT_SET, path, state, fieldName);
}
function validateErrorCode(value, path, state, fieldName) {
    if (value === undefined || value === null)
        return null;
    return normalizeEnumValue(value, ERROR_CODE_SET, path, state, fieldName);
}
function validateReasonCodes(value, path, state, fieldName) {
    return normalizeStringList(value, path, state, fieldName, {
        maxItems: validationTypes_2.SALES_AGENT_OUTPUT_MAX_REASON_CODES,
        itemMaxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH,
        warnOnly: false,
        required: false
    });
}
function validateQuestions(value, path, state, fieldName) {
    return normalizeStringList(value, path, state, fieldName, {
        maxItems: validationTypes_2.SALES_AGENT_OUTPUT_MAX_QUESTIONS,
        itemMaxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH,
        warnOnly: true,
        required: false
    });
}
function validateWarnings(value, path, state) {
    return normalizeStringList(value, path, state, "warnings", {
        maxItems: validationTypes_2.SALES_AGENT_OUTPUT_MAX_WARNINGS,
        itemMaxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH,
        warnOnly: true,
        required: true
    });
}
function validateEvidenceList(value, path, state) {
    const array = normalizeRequiredArray(value, path, state, "evidence");
    if (!array)
        return null;
    const limited = array.slice(0, validationTypes_2.SALES_AGENT_OUTPUT_MAX_EVIDENCE);
    if (limited.length !== array.length) {
        pushIssue(state, issue("excessive_array_length", "evidence exceeded the maximum length and was trimmed.", path, { maxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_EVIDENCE }, "error"));
        state.sanitizedFields.add(path.join("."));
    }
    const output = [];
    for (let index = 0; index < limited.length; index += 1) {
        const itemPath = [...path, String(index)];
        const entry = normalizeRequiredRecord(limited[index], itemPath, state, "evidence entry");
        if (!entry)
            continue;
        const source = validateEvidenceSource(entry.source, [...itemPath, "source"], state, "evidence.source");
        const summary = normalizeRequiredString(entry.summary, [...itemPath, "summary"], state, "evidence.summary");
        const verified = normalizeBoolean(entry.verified, [...itemPath, "verified"], state, "evidence.verified");
        const confidence = validateConfidence(entry.confidence, [...itemPath, "confidence"], state, "evidence.confidence");
        const reference = normalizeOptionalString(entry.reference, [...itemPath, "reference"], state);
        const capturedAt = normalizeDateString(entry.capturedAt, [...itemPath, "capturedAt"], state, "evidence.capturedAt");
        const expiresAt = normalizeDateString(entry.expiresAt, [...itemPath, "expiresAt"], state, "evidence.expiresAt");
        if (!source || !summary || verified === null || !confidence) {
            continue;
        }
        output.push({
            source,
            summary,
            verified,
            confidence,
            reference,
            capturedAt,
            expiresAt
        });
    }
    return output;
}
function validateClaims(value, path, state, evidence) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value)) {
        pushIssue(state, issue("invalid_field_type", "claims must be an array.", path));
        return null;
    }
    const limited = value.slice(0, validationTypes_2.SALES_AGENT_OUTPUT_MAX_CLAIMS);
    if (limited.length !== value.length) {
        pushIssue(state, issue("excessive_array_length", "claims exceeded the maximum length and was trimmed.", path, { maxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_CLAIMS }, "error"));
        state.sanitizedFields.add(path.join("."));
    }
    const output = [];
    for (let index = 0; index < limited.length; index += 1) {
        const itemPath = [...path, String(index)];
        const entry = normalizeRequiredRecord(limited[index], itemPath, state, "claim");
        if (!entry)
            continue;
        const type = validateClaimType(entry.type, [...itemPath, "type"], state);
        const claimValue = normalizeRequiredString(entry.value, [...itemPath, "value"], state, "claim.value");
        const evidenceSource = validateEvidenceSource(entry.evidenceSource, [...itemPath, "evidenceSource"], state, "claim.evidenceSource");
        const evidenceSummary = normalizeRequiredString(entry.evidenceSummary, [...itemPath, "evidenceSummary"], state, "claim.evidenceSummary");
        const evidenceReference = normalizeOptionalString(entry.evidenceReference, [...itemPath, "evidenceReference"], state);
        const verified = normalizeBoolean(entry.verified, [...itemPath, "verified"], state, "claim.verified");
        const confidence = validateConfidence(entry.confidence, [...itemPath, "confidence"], state, "claim.confidence");
        const expiresAt = normalizeDateString(entry.expiresAt, [...itemPath, "expiresAt"], state, "claim.expiresAt");
        if (!type || !claimValue || !evidenceSource || !evidenceSummary || verified === null || !confidence) {
            continue;
        }
        const sensitive = SENSITIVE_CLAIM_SET.has(type);
        if (sensitive) {
            const evidenceLooksSufficient = Boolean(evidenceSummary.trim()) &&
                verified === true &&
                confidence !== null &&
                (evidenceReference !== null || evidence.length > 0);
            const volatileRequiresExpiry = true;
            if (!evidenceLooksSufficient || (volatileRequiresExpiry && !expiresAt)) {
                pushIssue(state, issue("sensitive_claim_without_evidence", "Sensitive claim requires evidence, verification and expiry when volatile.", [...itemPath, "type"], { claimType: type }, "fatal"));
                continue;
            }
        }
        output.push({
            type,
            value: claimValue,
            evidenceSource,
            evidenceSummary,
            evidenceReference,
            verified,
            confidence,
            expiresAt
        });
    }
    return output;
}
function validateResponseProposal(value, path, state, evidence) {
    const record = normalizeRequiredRecord(value, path, state, "responseProposal");
    if (!record)
        return null;
    const messageIntent = validateMessageIntent(record.messageIntent, [...path, "messageIntent"], state);
    const draftText = normalizeOptionalString(record.draftText, [...path, "draftText"], state, validationTypes_2.SALES_AGENT_OUTPUT_MAX_DRAFT_LENGTH);
    const language = normalizeRequiredString(record.language, [...path, "language"], state, "responseProposal.language");
    const tone = normalizeRequiredString(record.tone, [...path, "tone"], state, "responseProposal.tone");
    const questions = validateQuestions(record.questions, [...path, "questions"], state, "questions");
    const claims = validateClaims(record.claims, [...path, "claims"], state, evidence);
    const disclaimers = normalizeStringList(record.disclaimers, [...path, "disclaimers"], state, "disclaimers", {
        maxItems: validationTypes_2.SALES_AGENT_OUTPUT_MAX_ARRAY_LENGTH,
        itemMaxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH,
        warnOnly: true,
        required: true
    });
    const requiresApproval = validateApprovalRequirement(record.requiresApproval, [...path, "requiresApproval"], state, "responseProposal.requiresApproval");
    const blockedClaimsSource = normalizeRequiredArray(record.blockedClaims, [...path, "blockedClaims"], state, "blockedClaims");
    const confidence = validateConfidence(record.confidence, [...path, "confidence"], state, "responseProposal.confidence");
    if (!messageIntent ||
        !language ||
        !tone ||
        questions === null ||
        claims === null ||
        disclaimers === null ||
        !requiresApproval ||
        !blockedClaimsSource ||
        !confidence) {
        return null;
    }
    const blockedClaimsLimited = blockedClaimsSource.slice(0, validationTypes_2.SALES_AGENT_OUTPUT_MAX_CLAIMS);
    if (blockedClaimsLimited.length !== blockedClaimsSource.length) {
        pushIssue(state, issue("excessive_array_length", "blockedClaims exceeded the maximum length and was trimmed.", [...path, "blockedClaims"], { maxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_CLAIMS }, "error"));
    }
    const blockedClaimsNormalized = [];
    for (let index = 0; index < blockedClaimsLimited.length; index += 1) {
        const item = blockedClaimsLimited[index];
        const normalized = normalizeString(item);
        if (!normalized || !CLAIM_SET.has(normalized)) {
            pushIssue(state, issue("invalid_enum_value", "blockedClaims contains an unsupported value.", [...path, "blockedClaims", String(index)], { received: item }));
            continue;
        }
        blockedClaimsNormalized.push(normalized);
    }
    return {
        messageIntent,
        draftText,
        language,
        tone,
        questions,
        claims,
        disclaimers,
        requiresApproval,
        blockedClaims: blockedClaimsNormalized,
        confidence
    };
}
function validateDecision(value, path, state) {
    const record = normalizeRequiredRecord(value, path, state, "decision");
    if (!record)
        return null;
    const type = validateDecisionType(record.type, [...path, "type"], state);
    const reason = normalizeRequiredString(record.reason, [...path, "reason"], state, "decision.reason");
    const confidence = validateConfidence(record.confidence, [...path, "confidence"], state, "decision.confidence");
    const riskLevel = validateRiskLevel(record.riskLevel, [...path, "riskLevel"], state, "decision.riskLevel");
    const requiresApproval = validateApprovalRequirement(record.requiresApproval, [...path, "requiresApproval"], state, "decision.requiresApproval");
    const errorCode = validateErrorCode(record.errorCode, [...path, "errorCode"], state, "decision.errorCode");
    const reasonCodes = validateReasonCodes(record.reasonCodes, [...path, "reasonCodes"], state, "reasonCodes");
    const policyTags = normalizeStringList(record.policyTags, [...path, "policyTags"], state, "policyTags", {
        maxItems: validationTypes_2.SALES_AGENT_OUTPUT_MAX_ARRAY_LENGTH,
        itemMaxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH,
        warnOnly: true,
        required: true
    });
    if (!type || !reason || !confidence || !riskLevel || !requiresApproval || reasonCodes === null || policyTags === null) {
        return null;
    }
    return {
        type,
        reason,
        confidence,
        riskLevel,
        requiresApproval,
        errorCode,
        reasonCodes,
        policyTags
    };
}
function validateAnalysis(value, path, state) {
    const record = normalizeRequiredRecord(value, path, state, "analysis");
    if (!record)
        return null;
    const summary = normalizeRequiredString(record.summary, [...path, "summary"], state, "analysis.summary");
    const qualificationState = validateQualificationState(record.qualificationState, [...path, "qualificationState"], state, "analysis.qualificationState");
    const customerReadiness = validateReadiness(record.customerReadiness, [...path, "customerReadiness"], state, "analysis.customerReadiness");
    const productFit = validateProductFit(record.productFit, [...path, "productFit"], state, "analysis.productFit");
    const confidence = validateConfidence(record.confidence, [...path, "confidence"], state, "analysis.confidence");
    const riskLevel = validateRiskLevel(record.riskLevel, [...path, "riskLevel"], state, "analysis.riskLevel");
    const reasonCodes = validateReasonCodes(record.reasonCodes, [...path, "reasonCodes"], state, "analysis.reasonCodes");
    if (!summary || !qualificationState || !customerReadiness || !productFit || !confidence || !riskLevel || reasonCodes === null) {
        return null;
    }
    return {
        summary,
        qualificationState,
        customerReadiness,
        productFit,
        confidence,
        riskLevel,
        reasonCodes
    };
}
function validateProposedActions(value, path, state) {
    const array = normalizeRequiredArray(value, path, state, "proposedActions");
    if (!array)
        return null;
    const limited = array.slice(0, validationTypes_2.SALES_AGENT_OUTPUT_MAX_ACTIONS);
    if (limited.length !== array.length) {
        pushIssue(state, issue("excessive_array_length", "proposedActions exceeded the maximum length and was trimmed.", path, { maxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_ACTIONS }, "error"));
        state.sanitizedFields.add(path.join("."));
    }
    const output = [];
    for (let index = 0; index < limited.length; index += 1) {
        const itemPath = [...path, String(index)];
        const entry = normalizeRequiredRecord(limited[index], itemPath, state, "proposedAction");
        if (!entry)
            continue;
        const type = validateActionType(entry.type, [...itemPath, "type"], state);
        const priority = normalizeEnumValue(entry.priority, new Set(["low", "medium", "high"]), [...itemPath, "priority"], state, "proposedActions.priority");
        const confidence = validateConfidence(entry.confidence, [...itemPath, "confidence"], state, "proposedActions.confidence");
        const riskLevel = validateRiskLevel(entry.riskLevel, [...itemPath, "riskLevel"], state, "proposedActions.riskLevel");
        const requiresApproval = validateApprovalRequirement(entry.requiresApproval, [...itemPath, "requiresApproval"], state, "proposedActions.requiresApproval");
        const reason = normalizeRequiredString(entry.reason, [...itemPath, "reason"], state, "proposedActions.reason");
        const payload = normalizePlainObject(entry.payload, [...itemPath, "payload"], state, "proposedActions.payload", true);
        const dependencies = validateReasonCodes(entry.dependencies, [...itemPath, "dependencies"], state, "dependencies");
        const policyTags = normalizeStringList(entry.policyTags, [...itemPath, "policyTags"], state, "policyTags", {
            maxItems: validationTypes_2.SALES_AGENT_OUTPUT_MAX_ARRAY_LENGTH,
            itemMaxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH,
            warnOnly: true,
            required: true
        });
        const expiresAt = normalizeDateString(entry.expiresAt, [...itemPath, "expiresAt"], state, "proposedActions.expiresAt");
        const idempotencyHint = normalizeOptionalString(entry.idempotencyHint, [...itemPath, "idempotencyHint"], state);
        if (!type || !priority || !confidence || !riskLevel || !requiresApproval || !reason || payload === null || dependencies === null || policyTags === null) {
            continue;
        }
        if (BLOCKED_ACTION_SET.has(type)) {
            pushIssue(state, issue("hard_blocked_action", "Hard-blocked action types are not allowed in SalesAgentOutput.", [...itemPath, "type"], { actionType: type }, "fatal"));
            continue;
        }
        output.push({
            type,
            priority,
            confidence,
            riskLevel,
            requiresApproval,
            reason,
            payload,
            dependencies,
            policyTags,
            expiresAt,
            idempotencyHint
        });
    }
    return output;
}
function validateToolRequests(value, path, state, allowedCapabilities, outcome) {
    const array = normalizeRequiredArray(value, path, state, "toolRequests");
    if (!array)
        return null;
    const limited = array.slice(0, validationTypes_2.SALES_AGENT_OUTPUT_MAX_TOOL_REQUESTS);
    if (limited.length !== array.length) {
        pushIssue(state, issue("excessive_array_length", "toolRequests exceeded the maximum length and was trimmed.", path, { maxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_TOOL_REQUESTS }, "error"));
        state.sanitizedFields.add(path.join("."));
    }
    const output = [];
    for (let index = 0; index < limited.length; index += 1) {
        const itemPath = [...path, String(index)];
        const entry = normalizeRequiredRecord(limited[index], itemPath, state, "toolRequest");
        if (!entry)
            continue;
        const tool = validateToolName(entry.tool, [...itemPath, "tool"], state);
        const purpose = normalizeRequiredString(entry.purpose, [...itemPath, "purpose"], state, "toolRequests.purpose");
        const status = validateToolStatus(entry.status, [...itemPath, "status"], state);
        const requiredInputs = normalizePlainObject(entry.requiredInputs, [...itemPath, "requiredInputs"], state, "toolRequests.requiredInputs", true);
        const optionalInputs = entry.optionalInputs === undefined || entry.optionalInputs === null ? null : normalizePlainObject(entry.optionalInputs, [...itemPath, "optionalInputs"], state, "toolRequests.optionalInputs", false);
        const urgency = normalizeEnumValue(entry.urgency, new Set(["low", "medium", "high"]), [...itemPath, "urgency"], state, "toolRequests.urgency");
        const blocking = normalizeBoolean(entry.blocking, [...itemPath, "blocking"], state, "toolRequests.blocking");
        const reason = normalizeRequiredString(entry.reason, [...itemPath, "reason"], state, "toolRequests.reason");
        const expectedEvidence = validateReasonCodes(entry.expectedEvidence, [...itemPath, "expectedEvidence"], state, "expectedEvidence");
        const fallbackDecision = entry.fallbackDecision === undefined || entry.fallbackDecision === null ? null : validateDecisionType(entry.fallbackDecision, [...itemPath, "fallbackDecision"], state);
        const confidence = entry.confidence === undefined || entry.confidence === null ? null : validateConfidence(entry.confidence, [...itemPath, "confidence"], state, "toolRequests.confidence");
        const riskLevel = entry.riskLevel === undefined || entry.riskLevel === null ? null : validateRiskLevel(entry.riskLevel, [...itemPath, "riskLevel"], state, "toolRequests.riskLevel");
        if (!tool || !purpose || !status || requiredInputs === null || !urgency || blocking === null || !reason || expectedEvidence === null) {
            continue;
        }
        if (!allowedCapabilities.has(tool)) {
            pushIssue(state, issue("invalid_tool_request", "Tool request references a capability outside allowedCapabilities.", [...itemPath, "tool"], { tool }, blocking ? "fatal" : "error"));
            if (blocking || outcome === "tool_required") {
                continue;
            }
            continue;
        }
        output.push({
            tool,
            purpose,
            status,
            requiredInputs,
            optionalInputs,
            urgency,
            blocking,
            reason,
            expectedEvidence,
            fallbackDecision,
            confidence: confidence ?? undefined,
            riskLevel: riskLevel ?? undefined
        });
    }
    return output;
}
function validateEntityProposals(value, path, state) {
    const array = normalizeRequiredArray(value, path, state, "entityProposals");
    if (!array)
        return null;
    const limited = array.slice(0, validationTypes_2.SALES_AGENT_OUTPUT_MAX_ENTITY_PROPOSALS);
    if (limited.length !== array.length) {
        pushIssue(state, issue("excessive_array_length", "entityProposals exceeded the maximum length and was trimmed.", path, { maxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_ENTITY_PROPOSALS }, "error"));
        state.sanitizedFields.add(path.join("."));
    }
    const output = [];
    for (let index = 0; index < limited.length; index += 1) {
        const itemPath = [...path, String(index)];
        const entry = normalizeRequiredRecord(limited[index], itemPath, state, "entityProposal");
        if (!entry)
            continue;
        const entityType = normalizeEnumValue(entry.entityType, new Set(["lead", "opportunity"]), [...itemPath, "entityType"], state, "entityProposals.entityType");
        const proposedChanges = normalizePlainObject(entry.proposedChanges, [...itemPath, "proposedChanges"], state, "entityProposals.proposedChanges", true);
        const evidence = validateEvidenceList(entry.evidence, [...itemPath, "evidence"], state);
        const confidence = validateConfidence(entry.confidence, [...itemPath, "confidence"], state, "entityProposals.confidence");
        const requiresApproval = validateApprovalRequirement(entry.requiresApproval, [...itemPath, "requiresApproval"], state, "entityProposals.requiresApproval");
        const reason = normalizeRequiredString(entry.reason, [...itemPath, "reason"], state, "entityProposals.reason");
        const policyTags = normalizeStringList(entry.policyTags, [...itemPath, "policyTags"], state, "policyTags", {
            maxItems: validationTypes_2.SALES_AGENT_OUTPUT_MAX_ARRAY_LENGTH,
            itemMaxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH,
            warnOnly: true,
            required: true
        });
        const expiresAt = normalizeDateString(entry.expiresAt, [...itemPath, "expiresAt"], state, "entityProposals.expiresAt");
        const idempotencyHint = normalizeOptionalString(entry.idempotencyHint, [...itemPath, "idempotencyHint"], state);
        if (!entityType || proposedChanges === null || evidence === null || !confidence || !requiresApproval || !reason || policyTags === null) {
            continue;
        }
        const allowedKeys = entityType === "lead" ? ALLOWED_LEAD_KEY_SET : ALLOWED_OPPORTUNITY_KEY_SET;
        const rejectedKeys = Object.keys(proposedChanges).filter((key) => !allowedKeys.has(key));
        if (rejectedKeys.length > 0) {
            pushIssue(state, issue("invalid_entity_proposal", "entityProposals.proposedChanges contains fields outside the allowed contract.", [...itemPath, "proposedChanges"], { rejectedKeys }, "error"));
            continue;
        }
        output.push({
            entityType,
            proposedChanges,
            evidence,
            confidence,
            requiresApproval,
            reason,
            policyTags,
            expiresAt,
            idempotencyHint
        });
    }
    return output;
}
function validateRationale(value, path, state) {
    const record = normalizeRequiredRecord(value, path, state, "rationale");
    if (!record)
        return null;
    const summary = normalizeRequiredString(record.summary, [...path, "summary"], state, "rationale.summary");
    const evidence = validateReasonCodes(record.evidence, [...path, "evidence"], state, "evidence");
    const counterEvidence = validateReasonCodes(record.counterEvidence, [...path, "counterEvidence"], state, "counterEvidence");
    const assumptions = validateReasonCodes(record.assumptions, [...path, "assumptions"], state, "assumptions");
    const riskFlags = validateReasonCodes(record.riskFlags, [...path, "riskFlags"], state, "riskFlags");
    const missingInformation = validateReasonCodes(record.missingInformation, [...path, "missingInformation"], state, "missingInformation");
    const policyRulesApplied = validateReasonCodes(record.policyRulesApplied, [...path, "policyRulesApplied"], state, "policyRulesApplied");
    if (!summary || evidence === null || counterEvidence === null || assumptions === null || riskFlags === null || missingInformation === null || policyRulesApplied === null) {
        return null;
    }
    return {
        summary,
        evidence,
        counterEvidence,
        assumptions,
        riskFlags,
        missingInformation,
        policyRulesApplied
    };
}
function sanitizeMetadataBytes(metadata) {
    return JSON.stringify(metadata).length;
}
function toIsoTimestamp(value) {
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}
function buildWarnings(issues) {
    const warnings = issues.filter((issue) => issue.level === "warning").map((issue) => issue.code);
    return [...new Set(warnings)].slice(0, validationTypes_2.SALES_AGENT_OUTPUT_MAX_WARNINGS);
}
function validateTopLevelBooleans(value, path, state) {
    const shouldRespondNow = normalizeBoolean(value.shouldRespondNow, [...path, "shouldRespondNow"], state, "shouldRespondNow");
    const shouldRequestTool = normalizeBoolean(value.shouldRequestTool, [...path, "shouldRequestTool"], state, "shouldRequestTool");
    const shouldRequestHuman = normalizeBoolean(value.shouldRequestHuman, [...path, "shouldRequestHuman"], state, "shouldRequestHuman");
    const shouldEvaluateFollowUp = normalizeBoolean(value.shouldEvaluateFollowUp, [...path, "shouldEvaluateFollowUp"], state, "shouldEvaluateFollowUp");
    return { shouldRespondNow, shouldRequestTool, shouldRequestHuman, shouldEvaluateFollowUp };
}
function gatherValidationMetadata(context, sanitized, safeMetadata, issues) {
    return {
        contractVersion: context.contractVersion ?? validationTypes_1.SALES_AGENT_OUTPUT_CONTRACT_VERSION,
        currentTime: toIsoTimestamp(context.currentTime),
        validatedAt: toIsoTimestamp(context.currentTime),
        strictMode: context.strictMode,
        expectedRunId: context.expectedRunId ?? null,
        requestedMode: context.requestedMode ?? null,
        allowedCapabilities: [...context.allowedCapabilities],
        issueCount: issues.length,
        warningCount: issues.filter((issue) => issue.level === "warning").length,
        fatalCount: issues.filter((issue) => issue.level === "fatal").length,
        sanitized: sanitized.sanitized || sanitized.issues.length > 0 || Object.keys(safeMetadata).length > 0,
        sanitizedFields: sanitized.sanitizedFields,
        rootType: sanitized.rootType,
        outputBytes: sanitized.outputBytes,
        metadataBytes: sanitizeMetadataBytes(safeMetadata),
        commercialContextSummary: context.commercialContextSummary ?? null,
        safeMetadata
    };
}
function hasCriticalContradiction(result, issues) {
    const issueCodes = new Set(issues.map((issue) => issue.code));
    if (issueCodes.has("run_id_mismatch") || issueCodes.has("unsupported_contract_version") || issueCodes.has("forbidden_key") || issueCodes.has("hard_blocked_action") || issueCodes.has("sensitive_claim_without_evidence")) {
        return true;
    }
    if (result.outcome === "tool_required" && result.toolRequests.length === 0)
        return true;
    if (result.outcome === "response_proposed" && result.responseProposal === null)
        return true;
    if (result.outcome === "waiting_for_customer" && result.shouldRespondNow)
        return true;
    if (result.outcome === "blocked_by_policy" && !result.policyAssessment.blocked)
        return true;
    if (result.outcome === "no_commercial_action" && result.proposedActions.some((action) => action.type !== "no_action"))
        return true;
    if (result.outcome === "failed_safe" && (result.proposedActions.length > 0 || result.toolRequests.length > 0 || result.entityProposals.length > 0))
        return true;
    if (result.shouldRequestTool && result.toolRequests.length === 0)
        return true;
    if (result.shouldRequestHuman && !["operator_review", "handoff", "blocked", "review"].includes(result.decision.requiresApproval))
        return true;
    if (result.shouldEvaluateFollowUp && result.outcome === "no_commercial_action")
        return true;
    return false;
}
function buildWarningList(issues) {
    return buildWarnings(issues);
}
function buildResult(root, context, state) {
    const runId = normalizeRequiredString(root.runId, ["runId"], state, "runId");
    const contractVersion = normalizeRequiredString(root.contractVersion, ["contractVersion"], state, "contractVersion");
    const outcome = validateOutcome(root.outcome, ["outcome"], state);
    const analysis = validateAnalysis(root.analysis, ["analysis"], state);
    const decision = validateDecision(root.decision, ["decision"], state);
    const proposedActions = validateProposedActions(root.proposedActions, ["proposedActions"], state);
    const toolRequests = validateToolRequests(root.toolRequests, ["toolRequests"], state, new Set(context.allowedCapabilities), outcome ?? "no_commercial_action");
    const entityProposals = validateEntityProposals(root.entityProposals, ["entityProposals"], state);
    const evidence = validateEvidenceList(root.evidence, ["evidence"], state);
    const rationale = validateRationale(root.rationale, ["rationale"], state);
    const warnings = validateWarnings(root.warnings, ["warnings"], state);
    const topLevelBooleans = validateTopLevelBooleans(root, [], state);
    const responseProposal = root.responseProposal === undefined || root.responseProposal === null
        ? null
        : validateResponseProposal(root.responseProposal, ["responseProposal"], state, evidence ?? []);
    const policyAssessmentRecord = normalizeRequiredRecord(root.policyAssessment, ["policyAssessment"], state, "policyAssessment");
    const outputMetadataRecord = normalizeRequiredRecord(root.metadata, ["metadata"], state, "metadata");
    if (!runId || !contractVersion || !outcome || !analysis || !decision || !proposedActions || !toolRequests || !entityProposals || !evidence || !rationale || warnings === null || !policyAssessmentRecord || !outputMetadataRecord) {
        return null;
    }
    const policyStatus = normalizeEnumValue(policyAssessmentRecord.status, new Set(["allowed", "blocked", "review"]), ["policyAssessment", "status"], state, "policyAssessment.status");
    const policyBlocked = normalizeBoolean(policyAssessmentRecord.blocked, ["policyAssessment", "blocked"], state, "policyAssessment.blocked");
    const policyReason = normalizeRequiredString(policyAssessmentRecord.reason, ["policyAssessment", "reason"], state, "policyAssessment.reason");
    const policyConfidence = validateConfidence(policyAssessmentRecord.confidence, ["policyAssessment", "confidence"], state, "policyAssessment.confidence");
    const policyRiskLevel = validateRiskLevel(policyAssessmentRecord.riskLevel, ["policyAssessment", "riskLevel"], state, "policyAssessment.riskLevel");
    const policyApproval = validateApprovalRequirement(policyAssessmentRecord.approvalRequirement, ["policyAssessment", "approvalRequirement"], state, "policyAssessment.approvalRequirement");
    const policyErrorCode = validateErrorCode(policyAssessmentRecord.errorCode, ["policyAssessment", "errorCode"], state, "policyAssessment.errorCode");
    const policyReasonCodes = validateReasonCodes(policyAssessmentRecord.reasonCodes, ["policyAssessment", "reasonCodes"], state, "policyAssessment.reasonCodes");
    const policyTags = normalizeStringList(policyAssessmentRecord.policyTags, ["policyAssessment", "policyTags"], state, "policyAssessment.policyTags", {
        maxItems: validationTypes_2.SALES_AGENT_OUTPUT_MAX_ARRAY_LENGTH,
        itemMaxLength: validationTypes_2.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH,
        warnOnly: true,
        required: true
    });
    if (!policyStatus ||
        policyBlocked === null ||
        !policyReason ||
        !policyConfidence ||
        !policyRiskLevel ||
        !policyApproval ||
        policyReasonCodes === null ||
        policyTags === null) {
        return null;
    }
    const outputMetadataSanitized = sanitizeRootMetadata(outputMetadataRecord);
    for (const next of outputMetadataSanitized.issues) {
        pushIssue(state, next);
    }
    const outputMetadataBytes = sanitizeMetadataBytes(outputMetadataSanitized.metadata);
    if (outputMetadataBytes > validationTypes_2.SALES_AGENT_OUTPUT_MAX_METADATA_BYTES) {
        pushIssue(state, issue("unsafe_metadata", "metadata exceeded the maximum serialized size and was cleared.", ["metadata"], { maxBytes: validationTypes_2.SALES_AGENT_OUTPUT_MAX_METADATA_BYTES, receivedBytes: outputMetadataBytes }, context.strictMode ? "fatal" : "error"));
        if (context.strictMode) {
            return null;
        }
    }
    const outputMetadata = outputMetadataBytes > validationTypes_2.SALES_AGENT_OUTPUT_MAX_METADATA_BYTES ? {} : outputMetadataSanitized.metadata;
    const result = {
        runId,
        contractVersion,
        outcome,
        analysis,
        decision,
        shouldRespondNow: topLevelBooleans.shouldRespondNow ?? false,
        shouldRequestTool: topLevelBooleans.shouldRequestTool ?? false,
        shouldRequestHuman: topLevelBooleans.shouldRequestHuman ?? false,
        shouldEvaluateFollowUp: topLevelBooleans.shouldEvaluateFollowUp ?? false,
        proposedActions,
        toolRequests,
        entityProposals,
        responseProposal,
        evidence,
        policyAssessment: {
            status: policyStatus,
            blocked: policyBlocked,
            reason: policyReason,
            confidence: policyConfidence,
            riskLevel: policyRiskLevel,
            approvalRequirement: policyApproval,
            errorCode: policyErrorCode,
            reasonCodes: policyReasonCodes,
            policyTags
        },
        warnings: warnings ?? [],
        rationale,
        metadata: outputMetadata
    };
    if (context.expectedRunId && runId !== context.expectedRunId) {
        pushIssue(state, issue("run_id_mismatch", "runId does not match the expectedRunId.", ["runId"], { expectedRunId: context.expectedRunId, receivedRunId: runId }, "fatal"));
        return null;
    }
    if (contractVersion !== (context.contractVersion ?? validationTypes_1.SALES_AGENT_OUTPUT_CONTRACT_VERSION)) {
        pushIssue(state, issue("unsupported_contract_version", "contractVersion does not match the expected version.", ["contractVersion"], { expectedContractVersion: context.contractVersion ?? validationTypes_1.SALES_AGENT_OUTPUT_CONTRACT_VERSION, receivedContractVersion: contractVersion }, "fatal"));
        return null;
    }
    if (outcome === "tool_required" && toolRequests.length === 0) {
        pushIssue(state, issue("contract_incomplete", "outcome=tool_required requires at least one valid toolRequest.", ["toolRequests"], {}, "fatal"));
        return null;
    }
    if (outcome === "response_proposed" && responseProposal === null) {
        pushIssue(state, issue("contract_incomplete", "outcome=response_proposed requires a valid responseProposal.", ["responseProposal"], {}, "fatal"));
        return null;
    }
    if (outcome === "waiting_for_customer" && result.shouldRespondNow) {
        pushIssue(state, issue("contradictory_decision", "waiting_for_customer cannot request an immediate response.", ["shouldRespondNow"], {}, "fatal"));
        return null;
    }
    if (outcome === "blocked_by_policy" && !policyBlocked) {
        pushIssue(state, issue("contradictory_decision", "blocked_by_policy requires policyAssessment.blocked=true.", ["policyAssessment", "blocked"], {}, "fatal"));
        return null;
    }
    if (outcome === "no_commercial_action" && proposedActions.some((action) => action.type !== "no_action")) {
        pushIssue(state, issue("contradictory_decision", "no_commercial_action cannot expose executable proposedActions.", ["proposedActions"], {}, "fatal"));
        return null;
    }
    if (outcome === "failed_safe" && (proposedActions.length > 0 || toolRequests.length > 0 || entityProposals.length > 0 || (responseProposal?.claims.length ?? 0) > 0)) {
        pushIssue(state, issue("contradictory_decision", "failed_safe cannot expose executable proposals or sensitive claims.", ["outcome"], {}, "fatal"));
        return null;
    }
    if (result.shouldRequestTool && toolRequests.length === 0) {
        pushIssue(state, issue("contract_incomplete", "shouldRequestTool=true requires a valid tool request.", ["toolRequests"], {}, "fatal"));
        return null;
    }
    if (result.shouldRequestHuman && !["operator_review", "handoff", "blocked", "review"].includes(result.decision.requiresApproval)) {
        pushIssue(state, issue("contradictory_decision", "shouldRequestHuman=true must align with approval or handoff intent.", ["decision", "requiresApproval"], {}, "fatal"));
        return null;
    }
    if (result.shouldEvaluateFollowUp && result.outcome === "no_commercial_action") {
        pushIssue(state, issue("contradictory_decision", "shouldEvaluateFollowUp=true must align with a commercial action.", ["shouldEvaluateFollowUp"], {}, "fatal"));
        return null;
    }
    if (hasCriticalContradiction(result, state.issues)) {
        return null;
    }
    return result;
}
function buildValidationMetadata(context, sanitized, safeMetadata, issues) {
    return gatherValidationMetadata(context, sanitized, safeMetadata, issues);
}
function validateSalesAgentOutput(value, context) {
    const sanitized = (0, sanitizeSalesAgentOutput_1.sanitizeSalesAgentOutput)(value);
    const state = {
        issues: [...sanitized.issues],
        warnings: [],
        sanitizedFields: new Set(sanitized.sanitizedFields)
    };
    const safeMetadataResult = sanitizeRootMetadata(context.metadata ?? {});
    let safeMetadata = safeMetadataResult.metadata;
    for (const next of safeMetadataResult.issues) {
        pushIssue(state, next);
    }
    if (safeMetadataResult.bytes > validationTypes_2.SALES_AGENT_OUTPUT_MAX_METADATA_BYTES) {
        pushIssue(state, issue("unsafe_metadata", "Validation context metadata exceeded the maximum serialized size.", ["metadata"], { maxBytes: validationTypes_2.SALES_AGENT_OUTPUT_MAX_METADATA_BYTES, receivedBytes: safeMetadataResult.bytes }, context.strictMode ? "fatal" : "error"));
        if (context.strictMode) {
            const failedSafe = (0, createFailedSafeResult_1.createFailedSafeResult)(context, {
                issues: state.issues,
                reason: state.issues[0]?.message
            });
            return {
                status: "failed_safe",
                result: failedSafe,
                warnings: buildWarningList(state.issues),
                issues: state.issues,
                metadata: buildValidationMetadata(context, sanitized, {}, state.issues)
            };
        }
        safeMetadata = {};
    }
    const validationMetadata = buildValidationMetadata(context, sanitized, safeMetadata, state.issues);
    if (!sanitized.value) {
        const issues = state.issues.length > 0 ? state.issues : [issue("invalid_root", "SalesAgentOutput root must be a plain object.", [], {}, "fatal")];
        const failedSafe = (0, createFailedSafeResult_1.createFailedSafeResult)(context, {
            issues,
            reason: issues[0]?.message
        });
        return {
            status: "failed_safe",
            result: failedSafe,
            warnings: buildWarningList(issues),
            issues,
            metadata: validationMetadata
        };
    }
    const root = sanitized.value;
    if (!isRecord(root)) {
        const issues = [...state.issues, issue("invalid_root", "SalesAgentOutput root must be a plain object.", [], {}, "fatal")];
        const failedSafe = (0, createFailedSafeResult_1.createFailedSafeResult)(context, {
            issues,
            reason: issues[0]?.message
        });
        return {
            status: "failed_safe",
            result: failedSafe,
            warnings: buildWarningList(issues),
            issues,
            metadata: buildValidationMetadata(context, sanitized, safeMetadata, issues)
        };
    }
    const result = buildResult(root, context, state);
    const issues = state.issues;
    const warnings = buildWarningList(issues);
    const hasFatal = issues.some(isFatalIssue);
    const hasError = issues.some((next) => next.level === "error");
    if (hasFatal || (context.strictMode && hasError)) {
        const failedSafe = (0, createFailedSafeResult_1.createFailedSafeResult)(context, {
            issues,
            reason: issues[0]?.message
        });
        return {
            status: "failed_safe",
            result: failedSafe,
            warnings,
            issues,
            metadata: buildValidationMetadata(context, sanitized, safeMetadata, issues)
        };
    }
    if (hasError) {
        return {
            status: "invalid",
            result: null,
            warnings,
            issues,
            metadata: buildValidationMetadata(context, sanitized, safeMetadata, issues)
        };
    }
    if (!result) {
        const failedSafe = (0, createFailedSafeResult_1.createFailedSafeResult)(context, {
            issues,
            reason: issues[0]?.message
        });
        return {
            status: "failed_safe",
            result: failedSafe,
            warnings,
            issues,
            metadata: buildValidationMetadata(context, sanitized, safeMetadata, issues)
        };
    }
    return {
        status: "valid",
        result,
        warnings,
        issues,
        metadata: buildValidationMetadata(context, sanitized, safeMetadata, issues)
    };
}

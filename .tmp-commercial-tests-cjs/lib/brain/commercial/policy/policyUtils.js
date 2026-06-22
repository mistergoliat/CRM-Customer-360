"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlainRecord = isPlainRecord;
exports.buildPolicyIssue = buildPolicyIssue;
exports.uniqueStrings = uniqueStrings;
exports.rankApproval = rankApproval;
exports.rankRisk = rankRisk;
exports.maxApproval = maxApproval;
exports.maxRisk = maxRisk;
exports.toIsoString = toIsoString;
exports.parseTime = parseTime;
exports.sanitizePolicyRecord = sanitizePolicyRecord;
exports.cloneSalesAgentResult = cloneSalesAgentResult;
exports.stableStringifyJson = stableStringifyJson;
exports.claimVolatilityForType = claimVolatilityForType;
exports.isSensitiveClaimType = isSensitiveClaimType;
exports.isStrongEvidenceSource = isStrongEvidenceSource;
exports.isTerminalOpportunityStatus = isTerminalOpportunityStatus;
exports.hasSensitiveBlockedText = hasSensitiveBlockedText;
exports.uniqueRuleIds = uniqueRuleIds;
exports.maxPolicyStatus = maxPolicyStatus;
exports.buildAssessmentCounts = buildAssessmentCounts;
const policyConstants_1 = require("./policyConstants");
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SENSITIVE_KEY_PATTERN = /authorization|api[-_]?key|token|secret|password|cookie|webhook|header/i;
function isPlainRecord(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function toIssue(code, message, path, ruleId, details, level = "warning") {
    return {
        code: policyConstants_1.COMMERCIAL_POLICY_ISSUE_CODES.includes(code) ? code : "unknown_issue",
        level,
        message,
        path,
        ruleId: ruleId ?? null,
        details: details ?? null
    };
}
function buildPolicyIssue(code, message, path, ruleId, details, level = "warning") {
    return toIssue(code, message, path, ruleId, details, level);
}
function uniqueStrings(values) {
    return [...new Set(values)];
}
function rankApproval(value) {
    const index = policyConstants_1.COMMERCIAL_POLICY_APPROVAL_REQUIREMENTS.indexOf(value);
    return index < 0 ? 0 : index;
}
function rankRisk(value) {
    const index = policyConstants_1.COMMERCIAL_POLICY_RISK_LEVELS.indexOf(value);
    return index < 0 ? 0 : index;
}
function maxApproval(left, right) {
    return rankApproval(left) >= rankApproval(right) ? left : right;
}
function maxRisk(left, right) {
    return rankRisk(left) >= rankRisk(right) ? left : right;
}
function toIsoString(value, fallback) {
    if (value === null || value === undefined)
        return fallback;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}
function parseTime(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? 0 : value.getTime();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}
function sanitizeRecursive(value, state) {
    if (value === null || typeof value === "boolean" || typeof value === "string") {
        return value;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "bigint") {
        state.issues.push(buildPolicyIssue("invalid_input", "BigInt values are not allowed in commercial policy metadata and were converted to string.", state.path, "POLICY-GOVERNANCE-FAIL-CLOSED", { receivedType: "bigint" }, "warning"));
        state.sanitizedFields.push(state.path.join("."));
        return value.toString();
    }
    if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
        state.issues.push(buildPolicyIssue("invalid_input", "Non-serializable values are not allowed in commercial policy metadata.", state.path, "POLICY-GOVERNANCE-FAIL-CLOSED", { receivedType: typeof value }, "warning"));
        state.sanitizedFields.push(state.path.join("."));
        return undefined;
    }
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            state.issues.push(buildPolicyIssue("invalid_input", "Invalid Date values are not allowed in commercial policy metadata.", state.path, "POLICY-GOVERNANCE-FAIL-CLOSED", { receivedType: "Date" }, "warning"));
            state.sanitizedFields.push(state.path.join("."));
            return undefined;
        }
        state.issues.push(buildPolicyIssue("invalid_input", "Date values were normalized to ISO strings in commercial policy metadata.", state.path, "POLICY-GOVERNANCE-FAIL-CLOSED", { receivedType: "Date" }, "warning"));
        state.sanitizedFields.push(state.path.join("."));
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        if (state.seen.has(value)) {
            state.issues.push(buildPolicyIssue("invalid_input", "Circular references are not allowed in commercial policy metadata.", state.path, "POLICY-GOVERNANCE-FAIL-CLOSED", { receivedType: "circular_reference" }, "warning"));
            state.sanitizedFields.push(state.path.join("."));
            return undefined;
        }
        state.seen.add(value);
        const output = [];
        for (let index = 0; index < value.length; index += 1) {
            const next = sanitizeRecursive(value[index], {
                ...state,
                path: [...state.path, String(index)]
            });
            if (next !== undefined)
                output.push(next);
        }
        return output;
    }
    if (!isPlainRecord(value)) {
        state.issues.push(buildPolicyIssue("invalid_input", "Only plain JSON objects are allowed in commercial policy metadata.", state.path, "POLICY-GOVERNANCE-FAIL-CLOSED", { receivedType: Object.prototype.toString.call(value) }, "warning"));
        state.sanitizedFields.push(state.path.join("."));
        return undefined;
    }
    if (state.seen.has(value)) {
        state.issues.push(buildPolicyIssue("invalid_input", "Circular references are not allowed in commercial policy metadata.", state.path, "POLICY-GOVERNANCE-FAIL-CLOSED", { receivedType: "circular_reference" }, "warning"));
        state.sanitizedFields.push(state.path.join("."));
        return undefined;
    }
    state.seen.add(value);
    const output = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key)) {
            state.issues.push(buildPolicyIssue("invalid_input", "Forbidden key encountered in commercial policy metadata.", [...state.path, key], "POLICY-GOVERNANCE-FAIL-CLOSED", { key }, "warning"));
            state.sanitizedFields.push([...state.path, key].join("."));
            continue;
        }
        if (SENSITIVE_KEY_PATTERN.test(key)) {
            state.issues.push(buildPolicyIssue("invalid_input", "Sensitive key was removed from commercial policy metadata.", [...state.path, key], "POLICY-GOVERNANCE-FAIL-CLOSED", { key }, "warning"));
            state.sanitizedFields.push([...state.path, key].join("."));
            continue;
        }
        const next = sanitizeRecursive(nestedValue, {
            ...state,
            path: [...state.path, key]
        });
        if (next !== undefined) {
            output[key] = next;
        }
    }
    return output;
}
function sanitizePolicyRecord(value) {
    const state = {
        path: [],
        issues: [],
        sanitizedFields: [],
        seen: new WeakSet()
    };
    if (!isPlainRecord(value)) {
        return {
            value: {},
            issues: [
                buildPolicyIssue("invalid_input", "Commercial policy metadata must be a plain object.", [], "POLICY-GOVERNANCE-FAIL-CLOSED", { receivedType: Array.isArray(value) ? "array" : value === null ? "null" : typeof value }, "warning")
            ],
            sanitizedFields: [],
            sanitized: true,
            bytes: 2
        };
    }
    const sanitized = sanitizeRecursive(value, state);
    const record = isPlainRecord(sanitized) ? sanitized : {};
    const bytes = JSON.stringify(record).length;
    return {
        value: record,
        issues: state.issues,
        sanitizedFields: [...new Set(state.sanitizedFields)],
        sanitized: state.issues.length > 0,
        bytes
    };
}
function cloneSalesAgentResult(result) {
    return JSON.parse(JSON.stringify(result));
}
function stableStringifyJson(value) {
    const seen = new WeakSet();
    const serialize = (input) => {
        if (input === null || typeof input === "boolean" || typeof input === "number" || typeof input === "string") {
            return input;
        }
        if (typeof input === "bigint")
            return input.toString();
        if (typeof input === "undefined" || typeof input === "function" || typeof input === "symbol")
            return null;
        if (input instanceof Date)
            return input.toISOString();
        if (Array.isArray(input))
            return input.map((item) => serialize(item));
        if (!isPlainRecord(input))
            return null;
        if (seen.has(input))
            return null;
        seen.add(input);
        const output = {};
        for (const key of Object.keys(input).sort()) {
            if (FORBIDDEN_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key))
                continue;
            output[key] = serialize(input[key]);
        }
        return output;
    };
    return JSON.stringify(serialize(value));
}
function claimVolatilityForType(claimType) {
    switch (claimType) {
        case "price":
        case "promotion":
            return "volatile";
        case "stock":
        case "delivery":
        case "dispatch":
        case "order_status":
            return "highly_volatile";
        case "service_availability":
            return "semi_volatile";
        case "warranty":
            return "semi_volatile";
        default:
            return "stable";
    }
}
function isSensitiveClaimType(claimType) {
    return claimType === "price" || claimType === "stock" || claimType === "delivery" || claimType === "dispatch" || claimType === "order_status" || claimType === "service_availability" || claimType === "promotion" || claimType === "warranty";
}
function isStrongEvidenceSource(source) {
    return source === "tool_result" || source === "operator_input" || source === "policy_context" || source === "order_context" || source === "product_service_context";
}
function isTerminalOpportunityStatus(value) {
    return typeof value === "string" && (value === "won" || value === "lost" || value === "closed_won" || value === "closed_lost");
}
function hasSensitiveBlockedText(text) {
    return /executed|execution|completed|sent|enviado|ejecutado|ejecutada|completado|completada|realizado|realizada|done|already\s+done|already\s+executed|ya\s+ejecutado|ya\s+ejecutada/i.test(text);
}
function uniqueRuleIds(ruleIds) {
    return [...new Set(ruleIds)];
}
function maxPolicyStatus(current, next) {
    const order = ["allowed", "allowed_with_restrictions", "requires_review", "blocked", "failed_safe"];
    return order.indexOf(current) >= order.indexOf(next) ? current : next;
}
function buildAssessmentCounts(items, predicate) {
    return items.reduce((count, item) => (predicate(item) ? count + 1 : count), 0);
}

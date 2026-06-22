"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRecord = isRecord;
exports.toIsoString = toIsoString;
exports.uniqueStrings = uniqueStrings;
exports.sum = sum;
exports.average = average;
exports.percentile = percentile;
exports.createCounter = createCounter;
exports.incrementCounter = incrementCounter;
exports.buildTopEntries = buildTopEntries;
exports.safeJsonStringify = safeJsonStringify;
exports.sanitizeEvaluationValue = sanitizeEvaluationValue;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function toIsoString(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}
function sum(values) {
    return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}
function average(values) {
    if (values.length === 0)
        return null;
    return sum(values) / values.length;
}
function percentile(values, rank) {
    if (values.length === 0)
        return null;
    const sorted = [...values].filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
    if (sorted.length === 0)
        return null;
    const clampedRank = Math.min(1, Math.max(0, rank));
    const index = Math.max(0, Math.ceil(clampedRank * sorted.length) - 1);
    return sorted[index] ?? sorted[sorted.length - 1] ?? null;
}
function createCounter(keys) {
    return keys.reduce((accumulator, key) => {
        accumulator[key] = 0;
        return accumulator;
    }, {});
}
function incrementCounter(counter, key, amount = 1) {
    counter[key] = (counter[key] ?? 0) + amount;
}
function buildTopEntries(counter, labelKey, limit = 5) {
    return Object.entries(counter)
        .filter(([, count]) => count > 0)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, limit)
        .map(([label, count]) => ({
        [labelKey]: label,
        count
    }));
}
function safeJsonStringify(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return null;
    }
}
function isDangerousKey(key) {
    const normalized = key.toLowerCase();
    return (normalized === "__proto__" ||
        normalized === "prototype" ||
        normalized === "constructor" ||
        normalized.includes("authorization") ||
        normalized.includes("api_key") ||
        normalized.includes("apikey") ||
        normalized.includes("api-key") ||
        normalized.includes("token") ||
        normalized.includes("secret") ||
        normalized.includes("password") ||
        normalized.includes("cookie"));
}
function sanitizeEvaluationValue(value, options, state) {
    const currentState = state ??
        {
            seen: new WeakSet(),
            depth: 0,
            sanitized: false,
            sanitizedFields: []
        };
    const sanitizeString = (input) => {
        if (input.length <= options.maxStringLength)
            return input;
        currentState.sanitized = true;
        currentState.sanitizedFields.push("string_truncated");
        return input.slice(0, options.maxStringLength);
    };
    const visit = (candidate, depth) => {
        if (candidate === null)
            return null;
        if (typeof candidate === "string")
            return sanitizeString(candidate);
        if (typeof candidate === "number")
            return Number.isFinite(candidate) ? candidate : String(candidate);
        if (typeof candidate === "boolean")
            return candidate;
        if (typeof candidate === "bigint") {
            currentState.sanitized = true;
            currentState.sanitizedFields.push("bigint");
            return candidate.toString();
        }
        if (typeof candidate === "undefined" || typeof candidate === "function" || typeof candidate === "symbol") {
            currentState.sanitized = true;
            currentState.sanitizedFields.push(typeof candidate);
            return undefined;
        }
        if (candidate instanceof Date) {
            currentState.sanitized = true;
            currentState.sanitizedFields.push("date");
            return Number.isNaN(candidate.getTime()) ? null : candidate.toISOString();
        }
        if (candidate instanceof Map) {
            currentState.sanitized = true;
            currentState.sanitizedFields.push("map");
            return Array.from(candidate.entries()).map(([key, entryValue]) => [visit(key, depth + 1) ?? null, visit(entryValue, depth + 1) ?? null]);
        }
        if (candidate instanceof Set) {
            currentState.sanitized = true;
            currentState.sanitizedFields.push("set");
            return Array.from(candidate.values()).map((entryValue) => visit(entryValue, depth + 1) ?? null);
        }
        if (Array.isArray(candidate)) {
            if (depth >= options.maxDepth) {
                currentState.sanitized = true;
                currentState.sanitizedFields.push("max_depth");
                return [];
            }
            const output = [];
            for (const item of candidate) {
                const nested = visit(item, depth + 1);
                if (nested !== undefined) {
                    output.push(nested);
                }
            }
            return output;
        }
        if (typeof candidate === "object") {
            if (currentState.seen.has(candidate)) {
                currentState.sanitized = true;
                currentState.sanitizedFields.push("circular_reference");
                return undefined;
            }
            if (depth >= options.maxDepth) {
                currentState.sanitized = true;
                currentState.sanitizedFields.push("max_depth");
                return {};
            }
            currentState.seen.add(candidate);
            const record = candidate;
            const output = {};
            for (const [key, nestedValue] of Object.entries(record)) {
                if (isDangerousKey(key)) {
                    currentState.sanitized = true;
                    currentState.sanitizedFields.push(key);
                    continue;
                }
                const nested = visit(nestedValue, depth + 1);
                if (nested !== undefined) {
                    output[key] = nested;
                }
            }
            return output;
        }
        currentState.sanitized = true;
        currentState.sanitizedFields.push("unknown_value");
        return undefined;
    };
    const valueResult = visit(value, currentState.depth);
    const outputValue = valueResult ?? null;
    const outputString = safeJsonStringify(outputValue);
    const outputBytes = outputString?.length ?? 0;
    if (outputBytes > options.maxBytes) {
        return {
            value: {
                truncated: true,
                sanitizedBytes: outputBytes
            },
            sanitized: true,
            sanitizedFields: uniqueStrings([...currentState.sanitizedFields, "max_bytes"]),
            bytes: outputBytes
        };
    }
    return {
        value: outputValue,
        sanitized: currentState.sanitized,
        sanitizedFields: uniqueStrings(currentState.sanitizedFields),
        bytes: outputBytes
    };
}

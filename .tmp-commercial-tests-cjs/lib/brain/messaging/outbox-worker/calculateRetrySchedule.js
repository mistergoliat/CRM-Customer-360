"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateOutboxRetrySchedule = calculateOutboxRetrySchedule;
const constants_1 = require("./constants");
function normalizePositiveInteger(value, fallback = 0) {
    if (!Number.isFinite(value))
        return fallback;
    const normalized = Math.floor(value);
    return normalized > 0 ? normalized : fallback;
}
function calculateOutboxRetrySchedule(input) {
    const now = (0, constants_1.normalizeIsoTimestamp)(input.now);
    if (!now) {
        return { retryAt: null, delaySeconds: null, exhausted: true };
    }
    const expiresAt = (0, constants_1.normalizeIsoTimestamp)(input.expiresAt);
    const attemptCount = normalizePositiveInteger(input.attemptCount, 0);
    const maxAttempts = normalizePositiveInteger(input.maxAttempts, 0);
    const baseRetrySeconds = normalizePositiveInteger(input.baseRetrySeconds, 0);
    const maxRetrySeconds = normalizePositiveInteger(input.maxRetrySeconds, 0);
    const retryAfterSeconds = normalizePositiveInteger(input.retryAfterSeconds ?? 0, 0);
    if (maxAttempts > 0 && attemptCount >= maxAttempts) {
        return { retryAt: null, delaySeconds: null, exhausted: true };
    }
    const exponentialDelay = baseRetrySeconds * (attemptCount > 0 ? 2 ** Math.max(0, attemptCount - 1) : 0);
    const candidateDelay = Math.max(exponentialDelay, retryAfterSeconds);
    const delaySeconds = Math.min(candidateDelay > 0 ? candidateDelay : baseRetrySeconds, maxRetrySeconds > 0 ? maxRetrySeconds : candidateDelay);
    const normalizedDelaySeconds = delaySeconds > 0 ? delaySeconds : null;
    if (normalizedDelaySeconds === null) {
        return { retryAt: null, delaySeconds: null, exhausted: true };
    }
    const retryAt = (0, constants_1.addSecondsToIso)(now, normalizedDelaySeconds);
    if (expiresAt && retryAt > expiresAt) {
        return { retryAt: null, delaySeconds: null, exhausted: true };
    }
    return {
        retryAt,
        delaySeconds: normalizedDelaySeconds,
        exhausted: false
    };
}

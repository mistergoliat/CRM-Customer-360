"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeFollowUpSchedule = computeFollowUpSchedule;
exports.calculateNextSchedule = calculateNextSchedule;
const validateFollowUpCandidate_1 = require("./validateFollowUpCandidate");
function parseIso(iso) {
    if (iso === null || iso === undefined)
        return null;
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}
function toIso(ms) {
    return new Date(ms).toISOString();
}
function addMinutes(iso, minutes) {
    const ms = parseIso(iso);
    if (ms === null)
        return iso;
    return toIso(ms + Math.max(0, minutes) * 60_000);
}
function addDays(ms, days) {
    return ms + days * 86_400_000;
}
function mergeReasons(...groups) {
    const output = [];
    for (const group of groups) {
        for (const reason of group) {
            if (!output.includes(reason)) {
                output.push(reason);
            }
        }
    }
    return output;
}
function getLocalParts(instantMs, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    });
    const parts = formatter.formatToParts(new Date(instantMs));
    const map = new Map(parts.map((part) => [part.type, part.value]));
    const weekdayText = map.get("weekday") ?? "Sun";
    const weekdayMap = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6
    };
    return {
        year: Number(map.get("year") ?? 1970),
        month: Number(map.get("month") ?? 1),
        day: Number(map.get("day") ?? 1),
        hour: Number(map.get("hour") ?? 0),
        minute: Number(map.get("minute") ?? 0),
        second: Number(map.get("second") ?? 0),
        weekday: weekdayMap[weekdayText] ?? 0
    };
}
function zonedLocalToUtcMs(timeZone, local) {
    const targetMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    let guessMs = targetMs;
    for (let i = 0; i < 8; i += 1) {
        const parts = getLocalParts(guessMs, timeZone);
        const formattedMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
        const delta = formattedMs - targetMs;
        if (delta === 0)
            return guessMs;
        guessMs -= delta;
    }
    return guessMs;
}
function findNextBusinessWindowStart(referenceMs, candidateMs, input) {
    const { businessTimezone, businessDays, businessStartHour, businessEndHour, maxFutureDays } = input.policy;
    const referenceParts = getLocalParts(referenceMs, businessTimezone);
    const referenceDate = new Date(Date.UTC(referenceParts.year, referenceParts.month - 1, referenceParts.day));
    const referenceDay = referenceDate.getUTCDay();
    const withinBusinessDay = businessDays.includes(referenceDay);
    if (withinBusinessDay && referenceParts.hour < businessStartHour) {
        const sameDayStart = zonedLocalToUtcMs(businessTimezone, {
            year: referenceParts.year,
            month: referenceParts.month,
            day: referenceParts.day,
            hour: businessStartHour,
            minute: 0,
            second: 0
        });
        if (sameDayStart >= candidateMs)
            return sameDayStart;
    }
    if (withinBusinessDay &&
        referenceParts.hour >= businessStartHour &&
        referenceParts.hour < businessEndHour &&
        candidateMs <= referenceMs) {
        return referenceMs;
    }
    for (let dayOffset = 0; dayOffset <= maxFutureDays; dayOffset += 1) {
        const localDate = new Date(Date.UTC(referenceParts.year, referenceParts.month - 1, referenceParts.day + dayOffset));
        const dayIndex = localDate.getUTCDay();
        if (!businessDays.includes(dayIndex))
            continue;
        const startMs = zonedLocalToUtcMs(businessTimezone, {
            year: localDate.getUTCFullYear(),
            month: localDate.getUTCMonth() + 1,
            day: localDate.getUTCDate(),
            hour: businessStartHour,
            minute: 0,
            second: 0
        });
        if (startMs >= candidateMs)
            return startMs;
    }
    return null;
}
function isBusinessHoursCandidate(instantMs, input) {
    if (!input.policy.businessHoursEnabled)
        return true;
    const local = getLocalParts(instantMs, input.policy.businessTimezone);
    const dayAllowed = input.policy.businessDays.includes(local.weekday);
    if (!dayAllowed)
        return false;
    return local.hour >= input.policy.businessStartHour && local.hour < input.policy.businessEndHour;
}
function maxNullable(values) {
    const filtered = values.filter((value) => value !== null);
    if (filtered.length === 0)
        return null;
    return Math.max(...filtered);
}
function computeFollowUpSchedule(input, candidate) {
    if (!candidate.scheduledFor) {
        return {
            originalScheduledFor: null,
            effectiveScheduledFor: null,
            cooldownUntil: null,
            outsideBusinessHours: false,
            reasons: [],
            scheduleChanged: false,
            scheduleImpossible: true
        };
    }
    const originalMs = candidate.scheduledForMs ?? parseIso(candidate.scheduledFor);
    if (originalMs === null) {
        return {
            originalScheduledFor: candidate.scheduledFor,
            effectiveScheduledFor: null,
            cooldownUntil: null,
            outsideBusinessHours: false,
            reasons: ["action_expired"],
            scheduleChanged: false,
            scheduleImpossible: true
        };
    }
    const inboundCooldownUntil = candidate.activity.lastInboundAt ? addMinutes(candidate.activity.lastInboundAt, input.policy.cooldownMinutesAfterInbound) : null;
    const outboundCooldownUntil = candidate.activity.lastOutboundAt ? addMinutes(candidate.activity.lastOutboundAt, input.policy.cooldownMinutesAfterOutbound) : null;
    const cooldownUntil = maxNullable([parseIso(inboundCooldownUntil), parseIso(outboundCooldownUntil)]);
    const cooldownUntilIso = cooldownUntil === null ? null : toIso(cooldownUntil);
    const cooldownReasons = [];
    let candidateMs = Math.max(originalMs, cooldownUntil ?? originalMs);
    if (cooldownUntil !== null) {
        if (parseIso(inboundCooldownUntil) !== null && parseIso(inboundCooldownUntil) > originalMs) {
            cooldownReasons.push("replanned_after_cooldown");
        }
        if (parseIso(outboundCooldownUntil) !== null && parseIso(outboundCooldownUntil) > originalMs) {
            cooldownReasons.push("replanned_after_recent_outbound");
        }
    }
    let outsideBusinessHours = false;
    if (input.policy.businessHoursEnabled) {
        if (!isBusinessHoursCandidate(candidateMs, input)) {
            const nextWindow = findNextBusinessWindowStart(candidate.nowMs, candidateMs, input);
            if (nextWindow === null) {
                return {
                    originalScheduledFor: candidate.scheduledFor,
                    effectiveScheduledFor: null,
                    cooldownUntil: cooldownUntilIso,
                    outsideBusinessHours: true,
                    reasons: ["replanned_for_business_hours"],
                    scheduleChanged: true,
                    scheduleImpossible: true
                };
            }
            outsideBusinessHours = true;
            candidateMs = nextWindow;
        }
    }
    const maxFutureMs = addDays(candidate.nowMs, input.policy.maxFutureDays);
    if (candidateMs > maxFutureMs) {
        return {
            originalScheduledFor: candidate.scheduledFor,
            effectiveScheduledFor: null,
            cooldownUntil: cooldownUntilIso,
            outsideBusinessHours,
            reasons: mergeReasons(cooldownReasons, outsideBusinessHours ? ["replanned_for_business_hours"] : []),
            scheduleChanged: candidateMs !== originalMs,
            scheduleImpossible: true
        };
    }
    if (candidate.expiresAtMs !== null && candidateMs > candidate.expiresAtMs) {
        return {
            originalScheduledFor: candidate.scheduledFor,
            effectiveScheduledFor: null,
            cooldownUntil: cooldownUntilIso,
            outsideBusinessHours,
            reasons: mergeReasons(cooldownReasons, outsideBusinessHours ? ["replanned_for_business_hours"] : []),
            scheduleChanged: candidateMs !== originalMs,
            scheduleImpossible: true
        };
    }
    return {
        originalScheduledFor: candidate.scheduledFor,
        effectiveScheduledFor: toIso(candidateMs),
        cooldownUntil: cooldownUntilIso,
        outsideBusinessHours,
        reasons: mergeReasons(cooldownReasons, outsideBusinessHours ? ["replanned_for_business_hours"] : []),
        scheduleChanged: candidateMs !== originalMs,
        scheduleImpossible: false
    };
}
function calculateNextSchedule(input) {
    const validated = (0, validateFollowUpCandidate_1.validateFollowUpCandidate)(input);
    if (!validated.valid || !validated.candidate)
        return null;
    return computeFollowUpSchedule(input, validated.candidate).effectiveScheduledFor;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateFollowUpSchedule = evaluateFollowUpSchedule;
const constants_1 = require("./constants");
const buildFollowUpDecision_1 = require("./buildFollowUpDecision");
const calculateNextSchedule_1 = require("./calculateNextSchedule");
const validateFollowUpCandidate_1 = require("./validateFollowUpCandidate");
function lowerText(value) {
    if (typeof value !== "string")
        return "";
    return value.trim().toLowerCase();
}
function includesText(values, value) {
    return values.includes(value);
}
function isBlockedPolicyStatus(value) {
    const status = lowerText(value);
    return ["blocked", "block", "denied", "rejected", "restricted"].includes(status);
}
function isAllowedActionType(actionType, allowedActionTypes) {
    return allowedActionTypes.length === 0 ? false : allowedActionTypes.includes(actionType);
}
function isCaseClosed(caseStatus, lifecycleStatus) {
    const status = lowerText(caseStatus);
    const lifecycle = lowerText(lifecycleStatus);
    return [status, lifecycle].some((item) => includesText(constants_1.FOLLOW_UP_SCHEDULING_CASE_CLOSED_STATUSES, item));
}
function isOpportunityClosed(opportunityStatus) {
    return includesText(constants_1.FOLLOW_UP_SCHEDULING_OPPORTUNITY_CLOSED_STATUSES, lowerText(opportunityStatus));
}
function isOpportunityPaused(opportunityStatus) {
    return includesText(constants_1.FOLLOW_UP_SCHEDULING_OPPORTUNITY_PAUSED_STATUSES, lowerText(opportunityStatus));
}
function isAllowedRisk(riskLevel, maxRiskLevel) {
    const risk = lowerText(riskLevel);
    const limit = lowerText(maxRiskLevel);
    if (!risk || !limit)
        return false;
    if (risk === "unknown" || limit === "unknown")
        return false;
    const riskScore = constants_1.FOLLOW_UP_SCHEDULING_RISK_SEVERITY[risk];
    const limitScore = constants_1.FOLLOW_UP_SCHEDULING_RISK_SEVERITY[limit];
    if (riskScore === undefined || limitScore === undefined)
        return false;
    return riskScore <= limitScore;
}
function isApprovalSatisfied(status, approvalRequirement) {
    const normalizedStatus = lowerText(status);
    const normalizedRequirement = lowerText(approvalRequirement);
    if (!constants_1.FOLLOW_UP_SCHEDULING_APPROVAL_REQUIREMENTS.includes(normalizedRequirement)) {
        return false;
    }
    if (normalizedRequirement === "blocked")
        return false;
    if (normalizedRequirement === "none")
        return true;
    return normalizedStatus === "approved" || normalizedStatus === "scheduled";
}
function hasStaleContext(candidate) {
    if (!candidate?.context.opportunityStageChangedAtMs)
        return false;
    return candidate.context.opportunityStageChangedAtMs > candidate.createdAtMs;
}
function isCustomerReplyAfterActionCreation(candidate) {
    if (!candidate || candidate.activity.lastInboundAtMs === null || candidate.activity.lastInboundAtMs === undefined)
        return false;
    return candidate.activity.lastInboundAtMs > candidate.createdAtMs;
}
function makeInvalidResult(input, reason, warnings = []) {
    return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
        decision: "invalid",
        actionId: input.action?.actionId ? String(input.action.actionId).trim() : "",
        reasons: [reason],
        warnings,
        originalScheduledFor: null,
        effectiveScheduledFor: null,
        nextScheduledFor: null,
        timing: {
            evaluatedAt: input.now,
            due: false,
            expired: false,
            cooldownUntil: null,
            outsideBusinessHours: false
        },
        retry: {
            attemptCount: Number.isFinite(input.action?.attemptCount) ? Math.max(0, Math.trunc(input.action.attemptCount)) : 0,
            maxAttempts: Number.isFinite(input.action?.maxAttempts) ? Math.max(0, Math.trunc(input.action.maxAttempts)) : 0,
            attemptsRemaining: 0
        }
    });
}
function evaluateFollowUpSchedule(input) {
    const validated = (0, validateFollowUpCandidate_1.validateFollowUpCandidate)(input);
    if (!validated.valid || !validated.candidate) {
        return makeInvalidResult(input, validated.reason, validated.warnings);
    }
    const candidate = validated.candidate;
    const originalScheduledFor = candidate.scheduledFor;
    if (!input.policy.followUpEnabled) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "cancel",
            actionId: candidate.actionId,
            reasons: ["follow_up_not_allowed"],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (!isAllowedActionType(candidate.actionType, candidate.policy.allowedActionTypes)) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "cancel",
            actionId: candidate.actionId,
            reasons: ["follow_up_not_allowed"],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (isBlockedPolicyStatus(candidate.context.policyStatus)) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "block",
            actionId: candidate.actionId,
            reasons: ["policy_blocked"],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (!isAllowedRisk(candidate.riskLevel, candidate.policy.maxRiskLevel)) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "block",
            actionId: candidate.actionId,
            reasons: ["risk_too_high"],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (!isApprovalSatisfied(candidate.status, candidate.approvalRequirement)) {
        const approvalReason = lowerText(candidate.approvalRequirement) === "blocked" ? "policy_blocked" : "approval_required";
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "block",
            actionId: candidate.actionId,
            reasons: [approvalReason],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (candidate.context.humanOwnerActive) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "cancel",
            actionId: candidate.actionId,
            reasons: ["human_owner_active"],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (candidate.context.aiBlocked) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "block",
            actionId: candidate.actionId,
            reasons: ["ai_blocked"],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (candidate.context.requiresHuman) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "block",
            actionId: candidate.actionId,
            reasons: ["case_requires_human"],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (isCaseClosed(candidate.context.caseStatus, candidate.context.lifecycleStatus)) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "cancel",
            actionId: candidate.actionId,
            reasons: ["case_closed"],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (isOpportunityClosed(candidate.context.opportunityStatus)) {
        const reason = lowerText(candidate.context.opportunityStatus) === "won" ? "opportunity_closed_won" : "opportunity_closed_lost";
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "cancel",
            actionId: candidate.actionId,
            reasons: [reason],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (isOpportunityPaused(candidate.context.opportunityStatus)) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "block",
            actionId: candidate.actionId,
            reasons: ["opportunity_paused"],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (isCustomerReplyAfterActionCreation(candidate)) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "cancel",
            actionId: candidate.actionId,
            reasons: ["customer_replied_after_action_created"],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (candidate.context.duplicateActionExists) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "cancel",
            actionId: candidate.actionId,
            reasons: ["duplicate_action"],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (candidate.context.conflictingActionExists) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "block",
            actionId: candidate.actionId,
            reasons: ["conflicting_action"],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (candidate.attemptCount >= candidate.maxAttempts) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "expire",
            actionId: candidate.actionId,
            reasons: ["max_attempts_reached"],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: true,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: 0
            }
        });
    }
    if (candidate.policy.requireExpiry && !candidate.expiresAt) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "invalid",
            actionId: candidate.actionId,
            reasons: ["missing_expiry"],
            originalScheduledFor,
            effectiveScheduledFor: originalScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (candidate.expiresAt !== null && candidate.expiresAtMs !== null && candidate.nowMs >= candidate.expiresAtMs) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "expire",
            actionId: candidate.actionId,
            reasons: ["action_expired"],
            originalScheduledFor,
            effectiveScheduledFor: candidate.expiresAt,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: true,
                expired: true,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (!candidate.scheduledFor) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "invalid",
            actionId: candidate.actionId,
            reasons: ["missing_schedule"],
            originalScheduledFor: null,
            effectiveScheduledFor: null,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: null,
                outsideBusinessHours: false
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    const schedule = (0, calculateNextSchedule_1.computeFollowUpSchedule)(input, candidate);
    if (schedule.scheduleImpossible) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "expire",
            actionId: candidate.actionId,
            reasons: schedule.reasons.length > 0 ? schedule.reasons : ["action_expired"],
            originalScheduledFor,
            effectiveScheduledFor: null,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: true,
                cooldownUntil: schedule.cooldownUntil,
                outsideBusinessHours: schedule.outsideBusinessHours
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    const effectiveScheduledFor = schedule.effectiveScheduledFor;
    const effectiveScheduledForMs = effectiveScheduledFor ? new Date(effectiveScheduledFor).getTime() : null;
    const due = effectiveScheduledForMs !== null && candidate.nowMs >= effectiveScheduledForMs;
    const staleContext = hasStaleContext(candidate);
    const replanReasons = [...schedule.reasons];
    if (staleContext) {
        replanReasons.unshift("stale_action_context");
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "replan",
            actionId: candidate.actionId,
            reasons: replanReasons,
            originalScheduledFor,
            effectiveScheduledFor,
            nextScheduledFor: effectiveScheduledFor,
            timing: {
                evaluatedAt: candidate.now,
                due,
                expired: false,
                cooldownUntil: schedule.cooldownUntil,
                outsideBusinessHours: schedule.outsideBusinessHours
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (schedule.scheduleChanged && !due) {
        if (schedule.outsideBusinessHours && candidate.policy.businessHoursEnabled && !candidate.policy.replanOutsideBusinessHours) {
            return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
                decision: "wait",
                actionId: candidate.actionId,
                reasons: ["outside_business_hours"],
                originalScheduledFor,
                effectiveScheduledFor,
                nextScheduledFor: null,
                timing: {
                    evaluatedAt: candidate.now,
                    due,
                    expired: false,
                    cooldownUntil: schedule.cooldownUntil,
                    outsideBusinessHours: true
                },
                retry: {
                    attemptCount: candidate.attemptCount,
                    maxAttempts: candidate.maxAttempts,
                    attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
                }
            });
        }
        if (schedule.cooldownUntil !== null && !candidate.policy.replanAfterCooldown) {
            return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
                decision: "wait",
                actionId: candidate.actionId,
                reasons: ["cooldown_active"],
                originalScheduledFor,
                effectiveScheduledFor,
                nextScheduledFor: null,
                timing: {
                    evaluatedAt: candidate.now,
                    due,
                    expired: false,
                    cooldownUntil: schedule.cooldownUntil,
                    outsideBusinessHours: schedule.outsideBusinessHours
                },
                retry: {
                    attemptCount: candidate.attemptCount,
                    maxAttempts: candidate.maxAttempts,
                    attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
                }
            });
        }
        if (schedule.reasons.length > 0) {
            return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
                decision: "replan",
                actionId: candidate.actionId,
                reasons: schedule.reasons,
                originalScheduledFor,
                effectiveScheduledFor,
                nextScheduledFor: effectiveScheduledFor,
                timing: {
                    evaluatedAt: candidate.now,
                    due,
                    expired: false,
                    cooldownUntil: schedule.cooldownUntil,
                    outsideBusinessHours: schedule.outsideBusinessHours
                },
                retry: {
                    attemptCount: candidate.attemptCount,
                    maxAttempts: candidate.maxAttempts,
                    attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
                }
            });
        }
    }
    if (due) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "ready",
            actionId: candidate.actionId,
            reasons: ["scheduled_time_reached"],
            originalScheduledFor,
            effectiveScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: true,
                expired: false,
                cooldownUntil: schedule.cooldownUntil,
                outsideBusinessHours: schedule.outsideBusinessHours
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (schedule.outsideBusinessHours && candidate.policy.businessHoursEnabled && !candidate.policy.replanOutsideBusinessHours) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "wait",
            actionId: candidate.actionId,
            reasons: ["outside_business_hours"],
            originalScheduledFor,
            effectiveScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: schedule.cooldownUntil,
                outsideBusinessHours: true
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (schedule.cooldownUntil !== null && !candidate.policy.replanAfterCooldown) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "wait",
            actionId: candidate.actionId,
            reasons: ["cooldown_active"],
            originalScheduledFor,
            effectiveScheduledFor,
            nextScheduledFor: null,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: schedule.cooldownUntil,
                outsideBusinessHours: schedule.outsideBusinessHours
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    if (schedule.reasons.length > 0 && (candidate.policy.replanAfterCooldown || candidate.policy.replanOutsideBusinessHours)) {
        return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
            decision: "replan",
            actionId: candidate.actionId,
            reasons: schedule.reasons,
            originalScheduledFor,
            effectiveScheduledFor,
            nextScheduledFor: effectiveScheduledFor,
            timing: {
                evaluatedAt: candidate.now,
                due: false,
                expired: false,
                cooldownUntil: schedule.cooldownUntil,
                outsideBusinessHours: schedule.outsideBusinessHours
            },
            retry: {
                attemptCount: candidate.attemptCount,
                maxAttempts: candidate.maxAttempts,
                attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
            }
        });
    }
    return (0, buildFollowUpDecision_1.buildFollowUpDecision)({
        decision: "wait",
        actionId: candidate.actionId,
        reasons: ["scheduled_time_not_reached"],
        originalScheduledFor,
        effectiveScheduledFor,
        nextScheduledFor: null,
        timing: {
            evaluatedAt: candidate.now,
            due: false,
            expired: false,
            cooldownUntil: schedule.cooldownUntil,
            outsideBusinessHours: schedule.outsideBusinessHours
        },
        retry: {
            attemptCount: candidate.attemptCount,
            maxAttempts: candidate.maxAttempts,
            attemptsRemaining: Math.max(0, candidate.maxAttempts - candidate.attemptCount)
        }
    });
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const follow_up_scheduling_1 = require("../../lib/brain/commercial/follow-up-scheduling");
const FIXED_NOW = "2026-06-17T12:00:00.000Z";
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
function shiftIso(iso, days) {
    return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}
function findIsoWithUtcDay(iso, targetDay) {
    let cursor = iso;
    for (let i = 0; i < 14; i += 1) {
        if (new Date(cursor).getUTCDay() === targetDay) {
            return cursor;
        }
        cursor = shiftIso(cursor, 1);
    }
    throw new Error(`Unable to find UTC day ${targetDay}.`);
}
function makeInput(overrides = {}) {
    const base = {
        now: FIXED_NOW,
        action: {
            actionId: "action-001",
            idempotencyKey: "sched:test-001",
            actionType: "schedule_followup",
            status: "proposed",
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: null,
            scheduledFor: "2026-06-17T13:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 0,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            blockReasons: [],
            cancelReason: null
        },
        activity: {
            lastInboundAt: null,
            lastOutboundAt: null,
            lastHumanMessageAt: null,
            lastAiMessageAt: null
        },
        context: {
            caseStatus: "open",
            lifecycleStatus: "open",
            humanOwnerActive: false,
            aiBlocked: false,
            requiresHuman: false,
            opportunityStatus: "open",
            opportunityStage: "qualifying",
            opportunityStageChangedAt: null,
            policyStatus: "allowed",
            conflictingActionExists: false,
            duplicateActionExists: false
        },
        policy: {
            followUpEnabled: true,
            allowedActionTypes: ["schedule_followup", "send_followup_message", "request_more_context"],
            maxRiskLevel: "high",
            cooldownMinutesAfterInbound: 0,
            cooldownMinutesAfterOutbound: 0,
            businessHoursEnabled: false,
            businessTimezone: "UTC",
            businessDays: [1, 2, 3, 4, 5],
            businessStartHour: 9,
            businessEndHour: 17,
            replanOutsideBusinessHours: false,
            replanAfterCooldown: false,
            requireExpiry: false,
            maxFutureDays: 30
        }
    };
    const hasOverride = (key) => Object.prototype.hasOwnProperty.call(overrides, key);
    return {
        ...base,
        ...overrides,
        action: hasOverride("action") ? { ...base.action, ...(overrides.action ?? {}) } : base.action,
        activity: hasOverride("activity") ? { ...base.activity, ...(overrides.activity ?? {}) } : base.activity,
        context: hasOverride("context") ? { ...base.context, ...(overrides.context ?? {}) } : base.context,
        policy: hasOverride("policy") ? { ...base.policy, ...(overrides.policy ?? {}) } : base.policy
    };
}
function expectDecision(result, decision, reason) {
    strict_1.default.equal(result.decision, decision);
    strict_1.default.equal(result.reasons.includes(reason), true);
}
function readSchedulingSources() {
    const folder = (0, node_path_1.resolve)(process.cwd(), "lib/brain/commercial/follow-up-scheduling");
    const files = (0, node_fs_1.readdirSync)(folder).filter((file) => file.endsWith(".ts"));
    const testFile = (0, node_path_1.resolve)(process.cwd(), "tests/commercial/followUpScheduling.test.ts");
    return [...files.map((file) => (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(folder, file), "utf8")), (0, node_fs_1.readFileSync)(testFile, "utf8")].join("\n");
}
function hasForbiddenSourceText(source) {
    const pattern = new RegExp([
        "D" + "ate\\.now",
        "set" + "Timeout",
        "set" + "Interval",
        "my" + "sql2",
        "from ['\"]" + "pg" + "['\"]",
        "supa" + "base",
        "IN" + "SERT ",
        "UP" + "DATE ",
        "DE" + "LETE ",
        "send" + "WhatsApp",
        "graph\\.facebook",
        "brain_" + "message_" + "outbox"
    ].join("|"), "");
    return pattern.test(source);
}
(0, node_test_1.default)("missing action id is invalid", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ action: { actionId: "" } }));
    expectDecision(result, "invalid", "missing_action_id");
});
(0, node_test_1.default)("missing idempotency key is invalid", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ action: { idempotencyKey: null } }));
    expectDecision(result, "invalid", "missing_idempotency_key");
});
(0, node_test_1.default)("unsupported action type is invalid", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ action: { actionType: "send_whatsapp_reply" } }));
    expectDecision(result, "invalid", "unsupported_action_type");
});
(0, node_test_1.default)("status not allowed is invalid", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ action: { status: "draft" } }));
    expectDecision(result, "invalid", "invalid_action_status");
});
(0, node_test_1.default)("terminal action never becomes ready", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ action: { status: "executed" } }));
    expectDecision(result, "invalid", "invalid_action_status");
});
(0, node_test_1.default)("follow-up disabled cancels the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ policy: { followUpEnabled: false } }));
    expectDecision(result, "cancel", "follow_up_not_allowed");
});
(0, node_test_1.default)("risk too high blocks the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ action: { riskLevel: "critical" } }));
    expectDecision(result, "block", "risk_too_high");
});
(0, node_test_1.default)("approval required blocks the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ action: { status: "proposed", approvalRequirement: "operator_review" } }));
    expectDecision(result, "block", "approval_required");
});
(0, node_test_1.default)("human owner active cancels the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ context: { humanOwnerActive: true } }));
    expectDecision(result, "cancel", "human_owner_active");
});
(0, node_test_1.default)("ai blocked blocks the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ context: { aiBlocked: true } }));
    expectDecision(result, "block", "ai_blocked");
});
(0, node_test_1.default)("requires human blocks the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ context: { requiresHuman: true } }));
    expectDecision(result, "block", "case_requires_human");
});
(0, node_test_1.default)("closed case cancels the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        context: {
            caseStatus: "closed",
            lifecycleStatus: "closed"
        }
    }));
    expectDecision(result, "cancel", "case_closed");
});
(0, node_test_1.default)("opportunity won cancels the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ context: { opportunityStatus: "won" } }));
    expectDecision(result, "cancel", "opportunity_closed_won");
});
(0, node_test_1.default)("opportunity lost cancels the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ context: { opportunityStatus: "lost" } }));
    expectDecision(result, "cancel", "opportunity_closed_lost");
});
(0, node_test_1.default)("opportunity paused blocks the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ context: { opportunityStatus: "paused" } }));
    expectDecision(result, "block", "opportunity_paused");
});
(0, node_test_1.default)("customer reply after action creation cancels the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        activity: {
            lastInboundAt: "2026-06-17T10:30:00.000Z"
        }
    }));
    expectDecision(result, "cancel", "customer_replied_after_action_created");
});
(0, node_test_1.default)("duplicate action cancels the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ context: { duplicateActionExists: true } }));
    expectDecision(result, "cancel", "duplicate_action");
});
(0, node_test_1.default)("conflicting action blocks the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ context: { conflictingActionExists: true } }));
    expectDecision(result, "block", "conflicting_action");
});
(0, node_test_1.default)("max attempts reached expires the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ action: { attemptCount: 3, maxAttempts: 3 } }));
    expectDecision(result, "expire", "max_attempts_reached");
});
(0, node_test_1.default)("expired action expires before ready", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        action: {
            scheduledFor: "2026-06-17T11:30:00.000Z",
            expiresAt: "2026-06-17T11:45:00.000Z"
        }
    }));
    expectDecision(result, "expire", "action_expired");
});
(0, node_test_1.default)("missing schedule is invalid", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({ action: { scheduledFor: null } }));
    expectDecision(result, "invalid", "missing_schedule");
});
(0, node_test_1.default)("scheduled time not reached waits", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        action: {
            scheduledFor: "2026-06-17T13:30:00.000Z"
        }
    }));
    expectDecision(result, "wait", "scheduled_time_not_reached");
    strict_1.default.equal(result.nextScheduledFor, null);
});
(0, node_test_1.default)("scheduled time reached becomes ready", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        action: {
            scheduledFor: "2026-06-17T11:30:00.000Z",
            status: "scheduled"
        }
    }));
    expectDecision(result, "ready", "scheduled_time_reached");
    strict_1.default.equal(result.actionable, true);
});
(0, node_test_1.default)("inbound cooldown waits when replanning is off", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        action: {
            createdAt: "2026-06-17T11:55:00.000Z",
            scheduledFor: "2026-06-17T12:30:00.000Z"
        },
        activity: {
            lastInboundAt: "2026-06-17T11:50:00.000Z"
        },
        policy: {
            cooldownMinutesAfterInbound: 60,
            replanAfterCooldown: false
        }
    }));
    expectDecision(result, "wait", "cooldown_active");
    strict_1.default.equal(result.effectiveScheduledFor, "2026-06-17T12:50:00.000Z");
});
(0, node_test_1.default)("inbound cooldown replans when enabled", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        action: {
            createdAt: "2026-06-17T11:55:00.000Z",
            scheduledFor: "2026-06-17T12:30:00.000Z"
        },
        activity: {
            lastInboundAt: "2026-06-17T11:50:00.000Z"
        },
        policy: {
            cooldownMinutesAfterInbound: 60,
            replanAfterCooldown: true
        }
    }));
    expectDecision(result, "replan", "replanned_after_cooldown");
    strict_1.default.equal(result.nextScheduledFor, "2026-06-17T12:50:00.000Z");
});
(0, node_test_1.default)("outbound cooldown waits when replanning is off", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        action: {
            scheduledFor: "2026-06-17T12:30:00.000Z"
        },
        activity: {
            lastOutboundAt: "2026-06-17T11:50:00.000Z"
        },
        policy: {
            cooldownMinutesAfterOutbound: 60,
            replanAfterCooldown: false
        }
    }));
    expectDecision(result, "wait", "cooldown_active");
    strict_1.default.equal(result.effectiveScheduledFor, "2026-06-17T12:50:00.000Z");
});
(0, node_test_1.default)("outbound cooldown replans when enabled", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        action: {
            scheduledFor: "2026-06-17T12:30:00.000Z"
        },
        activity: {
            lastOutboundAt: "2026-06-17T11:50:00.000Z"
        },
        policy: {
            cooldownMinutesAfterOutbound: 60,
            replanAfterCooldown: true
        }
    }));
    expectDecision(result, "replan", "replanned_after_recent_outbound");
    strict_1.default.equal(result.nextScheduledFor, "2026-06-17T12:50:00.000Z");
});
(0, node_test_1.default)("outside business hours waits when replanning is off", () => {
    const saturday = findIsoWithUtcDay(FIXED_NOW, 6);
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        now: saturday,
        action: {
            scheduledFor: "2026-06-20T20:00:00.000Z",
            expiresAt: "2026-06-25T12:00:00.000Z"
        },
        policy: {
            businessHoursEnabled: true,
            businessTimezone: "UTC",
            businessDays: [1, 2, 3, 4, 5],
            businessStartHour: 9,
            businessEndHour: 17,
            replanOutsideBusinessHours: false
        }
    }));
    expectDecision(result, "wait", "outside_business_hours");
});
(0, node_test_1.default)("outside business hours replans when enabled", () => {
    const saturday = findIsoWithUtcDay(FIXED_NOW, 6);
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        now: saturday,
        action: {
            scheduledFor: "2026-06-20T20:00:00.000Z",
            expiresAt: "2026-06-25T12:00:00.000Z"
        },
        policy: {
            businessHoursEnabled: true,
            businessTimezone: "UTC",
            businessDays: [1, 2, 3, 4, 5],
            businessStartHour: 9,
            businessEndHour: 17,
            replanOutsideBusinessHours: true
        }
    }));
    expectDecision(result, "replan", "replanned_for_business_hours");
    strict_1.default.equal(result.nextScheduledFor?.endsWith("09:00:00.000Z"), true);
});
(0, node_test_1.default)("weekend replans to the next business day", () => {
    const saturday = findIsoWithUtcDay(FIXED_NOW, 6);
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        now: saturday,
        action: {
            scheduledFor: "2026-06-20T20:00:00.000Z",
            expiresAt: "2026-06-25T12:00:00.000Z"
        },
        policy: {
            businessHoursEnabled: true,
            businessTimezone: "UTC",
            businessDays: [1, 2, 3, 4, 5],
            businessStartHour: 9,
            businessEndHour: 17,
            replanOutsideBusinessHours: true
        }
    }));
    expectDecision(result, "replan", "replanned_for_business_hours");
    strict_1.default.equal(new Date(result.nextScheduledFor ?? "").getUTCDay(), 1);
});
(0, node_test_1.default)("next business day is computed deterministically", () => {
    const saturday = findIsoWithUtcDay(FIXED_NOW, 6);
    const input = makeInput({
        now: saturday,
        action: {
            scheduledFor: "2026-06-20T20:00:00.000Z",
            expiresAt: "2026-06-25T12:00:00.000Z"
        },
        policy: {
            businessHoursEnabled: true,
            businessTimezone: "UTC",
            businessDays: [1, 2, 3, 4, 5],
            businessStartHour: 9,
            businessEndHour: 17,
            replanOutsideBusinessHours: true
        }
    });
    strict_1.default.equal((0, follow_up_scheduling_1.calculateNextSchedule)(input), "2026-06-22T09:00:00.000Z");
});
(0, node_test_1.default)("next schedule does not exceed expiry", () => {
    const saturday = findIsoWithUtcDay(FIXED_NOW, 6);
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        now: saturday,
        action: {
            scheduledFor: "2026-06-20T20:00:00.000Z",
            expiresAt: "2026-06-22T10:00:00.000Z"
        },
        policy: {
            businessHoursEnabled: true,
            businessTimezone: "UTC",
            businessDays: [1, 2, 3, 4, 5],
            businessStartHour: 9,
            businessEndHour: 17,
            replanOutsideBusinessHours: true
        }
    }));
    strict_1.default.equal(result.decision, "replan");
    strict_1.default.equal(result.nextScheduledFor, "2026-06-22T09:00:00.000Z");
    strict_1.default.equal(new Date(result.nextScheduledFor ?? "").getTime() <= new Date("2026-06-22T10:00:00.000Z").getTime(), true);
});
(0, node_test_1.default)("expiry wins over ready", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        action: {
            scheduledFor: "2026-06-17T11:00:00.000Z",
            expiresAt: "2026-06-17T12:00:00.000Z"
        }
    }));
    expectDecision(result, "expire", "action_expired");
});
(0, node_test_1.default)("stale opportunity stage replans the action", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        action: {
            scheduledFor: "2026-06-17T13:00:00.000Z"
        },
        context: {
            opportunityStageChangedAt: "2026-06-17T11:30:00.000Z"
        }
    }));
    expectDecision(result, "replan", "stale_action_context");
});
(0, node_test_1.default)("proposed eligible action becomes ready", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        action: {
            status: "proposed",
            scheduledFor: "2026-06-17T11:30:00.000Z"
        }
    }));
    expectDecision(result, "ready", "scheduled_time_reached");
});
(0, node_test_1.default)("scheduled eligible action becomes ready", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        action: {
            status: "scheduled",
            scheduledFor: "2026-06-17T11:30:00.000Z"
        }
    }));
    expectDecision(result, "ready", "scheduled_time_reached");
});
(0, node_test_1.default)("deterministic result", () => {
    const input = makeInput({
        action: {
            scheduledFor: "2026-06-17T11:30:00.000Z"
        }
    });
    const first = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(input);
    const second = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(cloneJson(input));
    strict_1.default.deepEqual(first, second);
});
(0, node_test_1.default)("input is not mutated", () => {
    const input = makeInput({
        action: {
            scheduledFor: "2026-06-17T11:30:00.000Z"
        }
    });
    const before = JSON.stringify(input);
    (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(input);
    strict_1.default.equal(JSON.stringify(input), before);
});
(0, node_test_1.default)("side effects are always false", () => {
    const result = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(makeInput({
        action: {
            scheduledFor: "2026-06-17T11:30:00.000Z"
        }
    }));
    strict_1.default.deepEqual(result.sideEffects, {
        actionUpdated: false,
        actionInserted: false,
        outboxWritten: false,
        messageSent: false,
        workerTriggered: false
    });
});
(0, node_test_1.default)("source stays free of forbidden integration and runtime strings", () => {
    const source = readSchedulingSources();
    strict_1.default.equal(hasForbiddenSourceText(source), false);
});

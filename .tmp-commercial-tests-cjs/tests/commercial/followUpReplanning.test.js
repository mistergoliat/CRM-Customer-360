"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const follow_up_replanning_1 = require("../../lib/brain/commercial/follow-up-replanning");
const FIXED_NOW = "2026-06-17T12:00:00.000Z";
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
function makeSchedulingResult(overrides = {}) {
    return {
        decision: "replan",
        actionable: false,
        actionId: "action-001",
        reasons: ["replanned_after_cooldown"],
        warnings: [],
        originalScheduledFor: "2026-06-17T13:00:00.000Z",
        effectiveScheduledFor: "2026-06-17T13:00:00.000Z",
        nextScheduledFor: "2026-06-17T14:00:00.000Z",
        timing: {
            evaluatedAt: FIXED_NOW,
            due: false,
            expired: false,
            cooldownUntil: null,
            outsideBusinessHours: false
        },
        retry: {
            attemptCount: 1,
            maxAttempts: 3,
            attemptsRemaining: 2
        },
        sideEffects: {
            actionUpdated: false,
            actionInserted: false,
            outboxWritten: false,
            messageSent: false,
            workerTriggered: false
        },
        ...overrides
    };
}
function makeInput(overrides = {}) {
    const base = {
        now: FIXED_NOW,
        originalAction: {
            rowId: 1,
            actionId: "action-001",
            idempotencyKey: "idem-action-001",
            actionType: "schedule_followup",
            status: "planned",
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: null,
            scheduledFor: "2026-06-17T13:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 1,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            draftMessage: "Hola, te escribo para dar seguimiento.",
            finalMessage: null,
            blockReasons: [],
            cancelReason: null,
            parentActionId: null,
            supersededByActionId: null,
            lifecycleVersion: "brain.commercial.action-lifecycle.v1",
            policyVersion: "brain.commercial.follow-up-scheduling.v1",
            runtimeVersion: null
        },
        schedulingResult: makeSchedulingResult(),
        currentContext: {
            caseStatus: "open",
            lifecycleStatus: "open",
            humanOwnerActive: false,
            aiBlocked: false,
            requiresHuman: false,
            opportunityStatus: "open",
            opportunityStage: "qualifying",
            opportunityStageChangedAt: null,
            policyStatus: "allowed",
            lastInboundAt: null,
            lastOutboundAt: null,
            conflictingActionId: null,
            duplicateActionId: null
        },
        policy: {
            allowReplacementOnReplan: true,
            allowInPlaceScheduleUpdate: true,
            preserveOriginalAction: false,
            requireAuditEvent: true,
            resetAttemptsOnStageChange: true,
            incrementGenerationOnReplacement: true
        }
    };
    return {
        ...base,
        ...overrides,
        originalAction: {
            ...base.originalAction,
            ...(overrides.originalAction ?? {})
        },
        schedulingResult: (overrides.schedulingResult ?? base.schedulingResult),
        currentContext: {
            ...base.currentContext,
            ...(overrides.currentContext ?? {})
        },
        policy: {
            ...base.policy,
            ...(overrides.policy ?? {})
        }
    };
}
function buildPlan(overrides = {}) {
    return (0, follow_up_replanning_1.buildFollowUpMutationPlan)(makeInput(overrides));
}
function getOriginalActionIds(plan) {
    const update = plan.operations.find((operation) => operation.type === "update_existing_action");
    const replacement = plan.operations.find((operation) => operation.type === "create_replacement_action");
    const audit = plan.operations.find((operation) => operation.type === "append_audit_event");
    return {
        update,
        replacement,
        audit
    };
}
function makeState(actions, appliedPlanKeys = []) {
    return {
        actions: cloneJson(actions),
        auditEvents: [],
        appliedPlanKeys: [...appliedPlanKeys]
    };
}
function sourceText() {
    const folder = (0, node_path_1.resolve)(process.cwd(), "lib/brain/commercial/follow-up-replanning");
    const files = (0, node_fs_1.readdirSync)(folder).filter((file) => file.endsWith(".ts"));
    const testFile = (0, node_path_1.resolve)(process.cwd(), "tests/commercial/followUpReplanning.test.ts");
    return [...files.map((file) => (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(folder, file), "utf8")), (0, node_fs_1.readFileSync)(testFile, "utf8")].join("\n");
}
function assertNoForbiddenSourceText(value) {
    const pattern = new RegExp([
        "D" + "ate\\.now",
        "random" + "UUID",
        "Math\\.random",
        "set" + "Timeout",
        "set" + "Interval",
        "pro" + "cess\\.env",
        "my" + "sql2",
        "from ['\"]" + "pg" + "['\"]",
        "supa" + "base",
        "SE" + "LECT ",
        "IN" + "SERT ",
        "UP" + "DATE ",
        "DE" + "LETE ",
        "brain_" + "message_" + "outbox",
        "send" + "WhatsApp",
        "graph\\.facebook"
    ].join("|"), "");
    strict_1.default.equal(pattern.test(value), false);
}
(0, node_test_1.default)("wait produces no_change", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "wait", reasons: ["scheduled_time_not_reached"], nextScheduledFor: null, actionable: false })
    });
    strict_1.default.equal(plan.planType, "no_change");
    strict_1.default.equal(plan.operations.length, 0);
    strict_1.default.equal(plan.replacementActionId, null);
});
(0, node_test_1.default)("ready produces no_change", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "ready", reasons: ["scheduled_time_reached"], actionable: true })
    });
    strict_1.default.equal(plan.planType, "no_change");
    strict_1.default.equal(plan.operations.length, 0);
});
(0, node_test_1.default)("customer reply cancels", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "cancel", reasons: ["customer_replied_after_action_created"] }),
        currentContext: { lastInboundAt: "2026-06-17T11:00:00.000Z" }
    });
    strict_1.default.equal(plan.planType, "cancel_action");
    strict_1.default.equal(plan.reasons.includes("customer_replied_after_action_created"), true);
});
(0, node_test_1.default)("human owner cancels", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "cancel", reasons: ["human_owner_active"] }),
        currentContext: { humanOwnerActive: true }
    });
    strict_1.default.equal(plan.planType, "cancel_action");
    strict_1.default.equal(plan.reasons.includes("human_owner_active"), true);
});
(0, node_test_1.default)("case closed cancels", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "cancel", reasons: ["case_closed"] }),
        currentContext: { caseStatus: "closed", lifecycleStatus: "closed" }
    });
    strict_1.default.equal(plan.planType, "cancel_action");
    strict_1.default.equal(plan.reasons.includes("case_closed"), true);
});
(0, node_test_1.default)("opportunity won cancels", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "cancel", reasons: ["opportunity_closed_won"] }),
        currentContext: { opportunityStatus: "won" }
    });
    strict_1.default.equal(plan.planType, "cancel_action");
});
(0, node_test_1.default)("opportunity lost cancels", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "cancel", reasons: ["opportunity_closed_lost"] }),
        currentContext: { opportunityStatus: "lost" }
    });
    strict_1.default.equal(plan.planType, "cancel_action");
});
(0, node_test_1.default)("duplicate action cancels", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "cancel", reasons: ["duplicate_action"] }),
        currentContext: { duplicateActionId: "action-duplicate" }
    });
    strict_1.default.equal(plan.planType, "cancel_action");
    strict_1.default.equal(plan.reasons.includes("duplicate_action"), true);
});
(0, node_test_1.default)("expiry expires", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "expire", reasons: ["action_expired"] })
    });
    strict_1.default.equal(plan.planType, "expire_action");
    strict_1.default.equal(plan.reasons.includes("action_expired"), true);
});
(0, node_test_1.default)("max attempts expires", () => {
    const plan = buildPlan({
        originalAction: { attemptCount: 3, maxAttempts: 3 },
        schedulingResult: makeSchedulingResult({ decision: "expire", reasons: ["max_attempts_reached"] })
    });
    strict_1.default.equal(plan.planType, "expire_action");
    strict_1.default.equal(plan.reasons.includes("max_attempts_reached"), true);
});
(0, node_test_1.default)("AI blocked blocks", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "block", reasons: ["ai_blocked"] }),
        currentContext: { aiBlocked: true }
    });
    strict_1.default.equal(plan.planType, "block_action");
});
(0, node_test_1.default)("opportunity paused blocks", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "block", reasons: ["opportunity_paused"] }),
        currentContext: { opportunityStatus: "paused" }
    });
    strict_1.default.equal(plan.planType, "block_action");
});
(0, node_test_1.default)("policy blocked blocks", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "block", reasons: ["policy_blocked"] }),
        currentContext: { policyStatus: "blocked" }
    });
    strict_1.default.equal(plan.planType, "block_action");
});
(0, node_test_1.default)("risk high blocks", () => {
    const plan = buildPlan({
        originalAction: { riskLevel: "high" },
        schedulingResult: makeSchedulingResult({ decision: "block", reasons: ["risk_too_high"] })
    });
    strict_1.default.equal(plan.planType, "block_action");
});
(0, node_test_1.default)("approval required blocks", () => {
    const plan = buildPlan({
        originalAction: { approvalRequirement: "operator_review" },
        schedulingResult: makeSchedulingResult({ decision: "block", reasons: ["approval_required"] })
    });
    strict_1.default.equal(plan.planType, "block_action");
});
(0, node_test_1.default)("conflict blocks", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "block", reasons: ["conflicting_action"] }),
        currentContext: { conflictingActionId: "action-conflict" }
    });
    strict_1.default.equal(plan.planType, "block_action");
    strict_1.default.equal(plan.reasons.includes("conflicting_action"), true);
});
(0, node_test_1.default)("cooldown replans in place", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_after_cooldown"], nextScheduledFor: "2026-06-17T15:00:00.000Z" })
    });
    strict_1.default.equal(plan.planType, "replan_action");
    strict_1.default.equal(plan.replacementActionId, null);
    strict_1.default.equal(plan.operations.some((operation) => operation.type === "update_existing_action"), true);
});
(0, node_test_1.default)("business-hours replans in place", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_for_business_hours"], nextScheduledFor: "2026-06-17T15:00:00.000Z" })
    });
    strict_1.default.equal(plan.planType, "replan_action");
    strict_1.default.equal(plan.replacementActionId, null);
});
(0, node_test_1.default)("recent outbound replans in place", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_after_recent_outbound"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { lastOutboundAt: "2026-06-17T11:45:00.000Z" }
    });
    strict_1.default.equal(plan.planType, "replan_action");
    strict_1.default.equal(plan.replacementActionId, null);
});
(0, node_test_1.default)("stage change supersedes", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
    });
    strict_1.default.equal(plan.planType, "supersede_action");
    strict_1.default.notEqual(plan.replacementActionId, null);
});
(0, node_test_1.default)("preserve original creates replacement", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" },
        policy: { preserveOriginalAction: true }
    });
    strict_1.default.equal(plan.planType, "cancel_and_create_replacement");
    strict_1.default.notEqual(plan.replacementActionId, null);
});
(0, node_test_1.default)("replacement links parent", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
    });
    const replacement = getOriginalActionIds(plan).replacement;
    strict_1.default.equal(replacement?.type, "create_replacement_action");
    strict_1.default.equal(replacement?.action.parentActionId, "action-001");
});
(0, node_test_1.default)("original links supersededBy", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
    });
    const update = getOriginalActionIds(plan).update;
    strict_1.default.equal(update?.type, "update_existing_action");
    strict_1.default.equal(update?.patch.supersededByActionId, plan.replacementActionId);
});
(0, node_test_1.default)("attempts reset on stage change", () => {
    const plan = buildPlan({
        originalAction: { attemptCount: 2 },
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" },
        policy: { resetAttemptsOnStageChange: true }
    });
    const replacement = getOriginalActionIds(plan).replacement;
    strict_1.default.equal(replacement?.type, "create_replacement_action");
    strict_1.default.equal(replacement?.action.attemptCount, 0);
});
(0, node_test_1.default)("attempts preserved when configured", () => {
    const plan = buildPlan({
        originalAction: { attemptCount: 2 },
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" },
        policy: { resetAttemptsOnStageChange: false }
    });
    const replacement = getOriginalActionIds(plan).replacement;
    strict_1.default.equal(replacement?.action.attemptCount, 2);
});
(0, node_test_1.default)("replacement generation increments", () => {
    const plan = buildPlan({
        originalAction: { attemptCount: 2 },
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
    });
    const replacement = getOriginalActionIds(plan).replacement;
    strict_1.default.equal(replacement?.action.generation, 3);
});
(0, node_test_1.default)("replacement ID deterministic", () => {
    const first = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
    });
    const second = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
    });
    strict_1.default.equal(first.replacementActionId, second.replacementActionId);
});
(0, node_test_1.default)("plan ID deterministic", () => {
    const first = buildPlan();
    const second = buildPlan();
    strict_1.default.equal(first.planId, second.planId);
});
(0, node_test_1.default)("plan key deterministic", () => {
    const first = buildPlan();
    const second = buildPlan();
    strict_1.default.equal(first.idempotency.planKey, second.idempotency.planKey);
});
(0, node_test_1.default)("audit event deterministic", () => {
    const first = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_after_cooldown"], nextScheduledFor: "2026-06-17T15:00:00.000Z" })
    });
    const second = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_after_cooldown"], nextScheduledFor: "2026-06-17T15:00:00.000Z" })
    });
    const firstAudit = getOriginalActionIds(first).audit;
    const secondAudit = getOriginalActionIds(second).audit;
    strict_1.default.equal(firstAudit?.type, "append_audit_event");
    strict_1.default.equal(firstAudit && "event" in firstAudit ? firstAudit.event.eventId : null, secondAudit && "event" in secondAudit ? secondAudit.event.eventId : null);
});
(0, node_test_1.default)("same input same output", () => {
    const first = buildPlan();
    const second = buildPlan();
    strict_1.default.deepEqual(first, second);
});
(0, node_test_1.default)("input not mutated", () => {
    const input = makeInput();
    const before = cloneJson(input);
    (0, follow_up_replanning_1.buildFollowUpMutationPlan)(input);
    strict_1.default.deepEqual(input, before);
});
(0, node_test_1.default)("terminal cancelled action immutable", () => {
    const plan = buildPlan({
        originalAction: { status: "cancelled" }
    });
    strict_1.default.equal(plan.planType, "no_change");
    strict_1.default.equal(plan.reasons.includes("terminal_action_immutable"), true);
});
(0, node_test_1.default)("terminal expired action immutable", () => {
    const plan = buildPlan({
        originalAction: { status: "expired" }
    });
    strict_1.default.equal(plan.planType, "no_change");
    strict_1.default.equal(plan.reasons.includes("terminal_action_immutable"), true);
});
(0, node_test_1.default)("terminal executed action immutable", () => {
    const plan = buildPlan({
        originalAction: { status: "executed" }
    });
    strict_1.default.equal(plan.planType, "no_change");
    strict_1.default.equal(plan.reasons.includes("terminal_action_immutable"), true);
});
(0, node_test_1.default)("missing next schedule invalid", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_after_cooldown"], nextScheduledFor: null })
    });
    strict_1.default.equal(plan.planType, "no_change");
    strict_1.default.equal(plan.reasons.includes("missing_next_schedule"), true);
});
(0, node_test_1.default)("replan beyond expiry becomes expire", () => {
    const plan = buildPlan({
        originalAction: { expiresAt: "2026-06-17T13:30:00.000Z" },
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_after_cooldown"], nextScheduledFor: "2026-06-17T14:00:00.000Z" })
    });
    strict_1.default.equal(plan.planType, "expire_action");
    strict_1.default.equal(plan.reasons.includes("replacement_would_exceed_expiry"), true);
});
(0, node_test_1.default)("replacement cannot equal original ID", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
    });
    strict_1.default.notEqual(plan.replacementActionId, plan.actionId);
});
(0, node_test_1.default)("replacement idempotency unique", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
    });
    const replacement = getOriginalActionIds(plan).replacement;
    strict_1.default.equal(replacement?.type, "create_replacement_action");
    strict_1.default.notEqual(replacement?.action.idempotencyKey, "idem-action-001");
});
(0, node_test_1.default)("in-memory apply success", () => {
    const plan = buildPlan();
    const state = makeState([
        {
            rowId: 1,
            actionId: "action-001",
            idempotencyKey: "idem-action-001",
            actionType: "schedule_followup",
            status: "planned",
            scheduledFor: "2026-06-17T13:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 1,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            draftMessage: "Hola, te escribo para dar seguimiento.",
            finalMessage: null,
            blockReasons: [],
            cancelReason: null,
            supersededByActionId: null,
            parentActionId: null,
            generation: 1,
            lifecycleVersion: "brain.commercial.action-lifecycle.v1",
            policyVersion: "brain.commercial.follow-up-scheduling.v1",
            runtimeVersion: null,
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: null
        }
    ]);
    const result = (0, follow_up_replanning_1.applyFollowUpMutationPlanInMemory)(state, plan);
    strict_1.default.equal(result.applied, true);
    strict_1.default.equal(result.conflict, false);
    strict_1.default.equal(result.duplicate, false);
    strict_1.default.equal(result.nextState.actions[0].status, "scheduled");
    strict_1.default.equal(result.nextState.appliedPlanKeys.includes(plan.idempotency.planKey), true);
});
(0, node_test_1.default)("in-memory retry duplicate", () => {
    const plan = buildPlan();
    const state = makeState([
        {
            rowId: 1,
            actionId: "action-001",
            idempotencyKey: "idem-action-001",
            actionType: "schedule_followup",
            status: "planned",
            scheduledFor: "2026-06-17T13:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 1,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            draftMessage: "Hola, te escribo para dar seguimiento.",
            finalMessage: null,
            blockReasons: [],
            cancelReason: null,
            supersededByActionId: null,
            parentActionId: null,
            generation: 1,
            lifecycleVersion: "brain.commercial.action-lifecycle.v1",
            policyVersion: "brain.commercial.follow-up-scheduling.v1",
            runtimeVersion: null,
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: null
        }
    ], [plan.idempotency.planKey]);
    const result = (0, follow_up_replanning_1.applyFollowUpMutationPlanInMemory)(state, plan);
    strict_1.default.equal(result.duplicate, true);
    strict_1.default.equal(result.applied, false);
});
(0, node_test_1.default)("optimistic status conflict", () => {
    const plan = buildPlan();
    const state = makeState([
        {
            rowId: 1,
            actionId: "action-001",
            idempotencyKey: "idem-action-001",
            actionType: "schedule_followup",
            status: "approved",
            scheduledFor: "2026-06-17T13:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 1,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            draftMessage: "Hola, te escribo para dar seguimiento.",
            finalMessage: null,
            blockReasons: [],
            cancelReason: null,
            supersededByActionId: null,
            parentActionId: null,
            generation: 1,
            lifecycleVersion: "brain.commercial.action-lifecycle.v1",
            policyVersion: "brain.commercial.follow-up-scheduling.v1",
            runtimeVersion: null,
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: null
        }
    ]);
    const result = (0, follow_up_replanning_1.applyFollowUpMutationPlanInMemory)(state, plan);
    strict_1.default.equal(result.conflict, true);
    strict_1.default.equal(result.rolledBack, true);
    strict_1.default.equal(result.nextState.actions[0].status, "approved");
});
(0, node_test_1.default)("duplicate action ID rollback", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
    });
    const replacement = getOriginalActionIds(plan).replacement;
    const state = makeState([
        {
            rowId: 1,
            actionId: "action-001",
            idempotencyKey: "idem-action-001",
            actionType: "schedule_followup",
            status: "planned",
            scheduledFor: "2026-06-17T13:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 1,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            draftMessage: "Hola, te escribo para dar seguimiento.",
            finalMessage: null,
            blockReasons: [],
            cancelReason: null,
            supersededByActionId: null,
            parentActionId: null,
            generation: 1,
            lifecycleVersion: "brain.commercial.action-lifecycle.v1",
            policyVersion: "brain.commercial.follow-up-scheduling.v1",
            runtimeVersion: null,
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: null
        },
        {
            rowId: 2,
            actionId: replacement?.action.actionId ?? "replacement-dupe",
            idempotencyKey: "other",
            actionType: "schedule_followup",
            status: "planned",
            scheduledFor: "2026-06-17T16:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 0,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            draftMessage: null,
            finalMessage: null,
            blockReasons: [],
            cancelReason: null,
            supersededByActionId: null,
            parentActionId: null,
            generation: 1,
            lifecycleVersion: null,
            policyVersion: null,
            runtimeVersion: null,
            createdAt: "2026-06-17T11:00:00.000Z",
            updatedAt: null
        }
    ]);
    const result = (0, follow_up_replanning_1.applyFollowUpMutationPlanInMemory)(state, plan);
    strict_1.default.equal(result.duplicate, true);
    strict_1.default.equal(result.rolledBack, true);
});
(0, node_test_1.default)("duplicate idempotency rollback", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
    });
    const replacement = getOriginalActionIds(plan).replacement;
    const state = makeState([
        {
            rowId: 1,
            actionId: "action-001",
            idempotencyKey: "idem-action-001",
            actionType: "schedule_followup",
            status: "planned",
            scheduledFor: "2026-06-17T13:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 1,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            draftMessage: "Hola, te escribo para dar seguimiento.",
            finalMessage: null,
            blockReasons: [],
            cancelReason: null,
            supersededByActionId: null,
            parentActionId: null,
            generation: 1,
            lifecycleVersion: "brain.commercial.action-lifecycle.v1",
            policyVersion: "brain.commercial.follow-up-scheduling.v1",
            runtimeVersion: null,
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: null
        },
        {
            rowId: 2,
            actionId: "other",
            idempotencyKey: replacement?.action.idempotencyKey ?? "duplicate-idem",
            actionType: "schedule_followup",
            status: "planned",
            scheduledFor: "2026-06-17T16:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 0,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            draftMessage: null,
            finalMessage: null,
            blockReasons: [],
            cancelReason: null,
            supersededByActionId: null,
            parentActionId: null,
            generation: 1,
            lifecycleVersion: null,
            policyVersion: null,
            runtimeVersion: null,
            createdAt: "2026-06-17T11:00:00.000Z",
            updatedAt: null
        }
    ]);
    const result = (0, follow_up_replanning_1.applyFollowUpMutationPlanInMemory)(state, plan);
    strict_1.default.equal(result.duplicate, true);
    strict_1.default.equal(result.rolledBack, true);
});
(0, node_test_1.default)("failed second operation rolls back first", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
    });
    const state = makeState([
        {
            rowId: 1,
            actionId: "action-001",
            idempotencyKey: "idem-action-001",
            actionType: "schedule_followup",
            status: "planned",
            scheduledFor: "2026-06-17T13:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 1,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            draftMessage: "Hola, te escribo para dar seguimiento.",
            finalMessage: null,
            blockReasons: [],
            cancelReason: null,
            supersededByActionId: null,
            parentActionId: null,
            generation: 1,
            lifecycleVersion: "brain.commercial.action-lifecycle.v1",
            policyVersion: "brain.commercial.follow-up-scheduling.v1",
            runtimeVersion: null,
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: null
        },
        {
            rowId: 2,
            actionId: plan.replacementActionId ?? "replacement-action",
            idempotencyKey: "different-idem",
            actionType: "schedule_followup",
            status: "planned",
            scheduledFor: "2026-06-17T16:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 0,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            draftMessage: null,
            finalMessage: null,
            blockReasons: [],
            cancelReason: null,
            supersededByActionId: null,
            parentActionId: null,
            generation: 1,
            lifecycleVersion: null,
            policyVersion: null,
            runtimeVersion: null,
            createdAt: "2026-06-17T11:00:00.000Z",
            updatedAt: null
        }
    ]);
    const result = (0, follow_up_replanning_1.applyFollowUpMutationPlanInMemory)(state, plan);
    strict_1.default.equal(result.applied, false);
    strict_1.default.equal(result.rolledBack, true);
    strict_1.default.equal(result.nextState.actions[0].status, "planned");
});
(0, node_test_1.default)("no partial state", () => {
    const plan = buildPlan({
        schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
        currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
    });
    const state = makeState([
        {
            rowId: 1,
            actionId: "action-001",
            idempotencyKey: "idem-action-001",
            actionType: "schedule_followup",
            status: "planned",
            scheduledFor: "2026-06-17T13:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 1,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            draftMessage: "Hola, te escribo para dar seguimiento.",
            finalMessage: null,
            blockReasons: [],
            cancelReason: null,
            supersededByActionId: null,
            parentActionId: null,
            generation: 1,
            lifecycleVersion: "brain.commercial.action-lifecycle.v1",
            policyVersion: "brain.commercial.follow-up-scheduling.v1",
            runtimeVersion: null,
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: null
        },
        {
            rowId: 2,
            actionId: plan.replacementActionId ?? "followup-replacement:action-001:g2:duplicate",
            idempotencyKey: "other",
            actionType: "schedule_followup",
            status: "planned",
            scheduledFor: "2026-06-17T16:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 0,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            draftMessage: null,
            finalMessage: null,
            blockReasons: [],
            cancelReason: null,
            supersededByActionId: null,
            parentActionId: null,
            generation: 1,
            lifecycleVersion: null,
            policyVersion: null,
            runtimeVersion: null,
            createdAt: "2026-06-17T11:00:00.000Z",
            updatedAt: null
        }
    ]);
    const result = (0, follow_up_replanning_1.applyFollowUpMutationPlanInMemory)(state, plan);
    strict_1.default.deepEqual(result.nextState, result.previousState);
});
(0, node_test_1.default)("audit event appended", () => {
    const plan = buildPlan();
    const state = makeState([
        {
            rowId: 1,
            actionId: "action-001",
            idempotencyKey: "idem-action-001",
            actionType: "schedule_followup",
            status: "planned",
            scheduledFor: "2026-06-17T13:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 1,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            draftMessage: "Hola, te escribo para dar seguimiento.",
            finalMessage: null,
            blockReasons: [],
            cancelReason: null,
            supersededByActionId: null,
            parentActionId: null,
            generation: 1,
            lifecycleVersion: "brain.commercial.action-lifecycle.v1",
            policyVersion: "brain.commercial.follow-up-scheduling.v1",
            runtimeVersion: null,
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: null
        }
    ]);
    const result = (0, follow_up_replanning_1.applyFollowUpMutationPlanInMemory)(state, plan);
    strict_1.default.equal(result.nextState.auditEvents.length, 1);
});
(0, node_test_1.default)("audit disabled produces no event", () => {
    const plan = buildPlan({ policy: { requireAuditEvent: false } });
    const state = makeState([
        {
            rowId: 1,
            actionId: "action-001",
            idempotencyKey: "idem-action-001",
            actionType: "schedule_followup",
            status: "planned",
            scheduledFor: "2026-06-17T13:00:00.000Z",
            expiresAt: "2026-06-18T12:00:00.000Z",
            attemptCount: 1,
            maxAttempts: 3,
            riskLevel: "low",
            approvalRequirement: "none",
            opportunityId: "opp-001",
            conversationCaseId: "case-001",
            waId: "56912345678",
            draftMessage: "Hola, te escribo para dar seguimiento.",
            finalMessage: null,
            blockReasons: [],
            cancelReason: null,
            supersededByActionId: null,
            parentActionId: null,
            generation: 1,
            lifecycleVersion: "brain.commercial.action-lifecycle.v1",
            policyVersion: "brain.commercial.follow-up-scheduling.v1",
            runtimeVersion: null,
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: null
        }
    ]);
    const result = (0, follow_up_replanning_1.applyFollowUpMutationPlanInMemory)(state, plan);
    strict_1.default.equal(result.nextState.auditEvents.length, 0);
});
(0, node_test_1.default)("no DB", () => {
    assertNoForbiddenSourceText(sourceText());
});
(0, node_test_1.default)("no SQL", () => {
    assertNoForbiddenSourceText(sourceText());
});
(0, node_test_1.default)("no outbox", () => {
    assertNoForbiddenSourceText(sourceText());
});
(0, node_test_1.default)("no send", () => {
    assertNoForbiddenSourceText(sourceText());
});
(0, node_test_1.default)("no Meta", () => {
    assertNoForbiddenSourceText(sourceText());
});
(0, node_test_1.default)("no worker", () => {
    assertNoForbiddenSourceText(sourceText());
});
(0, node_test_1.default)("side effects always false", () => {
    const plan = buildPlan();
    strict_1.default.deepEqual(plan.sideEffects, {
        databaseWritten: false,
        actionMutated: false,
        actionInserted: false,
        outboxWritten: false,
        messageSent: false,
        workerTriggered: false
    });
});
(0, node_test_1.default)("validator accepts generated plans", () => {
    const plans = [
        buildPlan(),
        (0, follow_up_replanning_1.buildCancellationPlan)(makeInput({ schedulingResult: makeSchedulingResult({ decision: "cancel", reasons: ["human_owner_active"] }) })),
        (0, follow_up_replanning_1.buildExpirationPlan)(makeInput({ schedulingResult: makeSchedulingResult({ decision: "expire", reasons: ["action_expired"] }) })),
        (0, follow_up_replanning_1.buildBlockingPlan)(makeInput({ schedulingResult: makeSchedulingResult({ decision: "block", reasons: ["policy_blocked"] }) })),
        (0, follow_up_replanning_1.buildReplanningPlan)(makeInput({ schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_after_cooldown"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }) }))
    ];
    for (const plan of plans) {
        const validation = (0, follow_up_replanning_1.validateFollowUpMutationPlan)(plan);
        strict_1.default.equal(validation.valid, true, plan.planType);
    }
});
(0, node_test_1.default)("helpers are deterministic", () => {
    strict_1.default.equal((0, follow_up_replanning_1.buildFollowUpMutationPlanId)({
        actionId: "action-001",
        planType: "cancel_action",
        createdAt: FIXED_NOW,
        reasons: ["human_owner_active"],
        operations: []
    }), (0, follow_up_replanning_1.buildFollowUpMutationPlanId)({
        actionId: "action-001",
        planType: "cancel_action",
        createdAt: FIXED_NOW,
        reasons: ["human_owner_active"],
        operations: []
    }));
    strict_1.default.equal((0, follow_up_replanning_1.buildReplacementActionId)({
        originalActionId: "action-001",
        generation: 2,
        nextScheduledFor: "2026-06-17T15:00:00.000Z",
        reason: "stale_action_context"
    }), (0, follow_up_replanning_1.buildReplacementActionId)({
        originalActionId: "action-001",
        generation: 2,
        nextScheduledFor: "2026-06-17T15:00:00.000Z",
        reason: "stale_action_context"
    }));
    strict_1.default.equal((0, follow_up_replanning_1.buildReplacementIdempotencyKey)({
        originalActionId: "action-001",
        generation: 2,
        nextScheduledFor: "2026-06-17T15:00:00.000Z",
        reason: "stale_action_context"
    }), (0, follow_up_replanning_1.buildReplacementIdempotencyKey)({
        originalActionId: "action-001",
        generation: 2,
        nextScheduledFor: "2026-06-17T15:00:00.000Z",
        reason: "stale_action_context"
    }));
    strict_1.default.equal((0, follow_up_replanning_1.buildFollowUpAuditEventId)({
        actionId: "action-001",
        eventType: "follow_up_replanned",
        reason: "cooldown_replan",
        createdAt: FIXED_NOW,
        replacementActionId: null
    }), (0, follow_up_replanning_1.buildFollowUpAuditEventId)({
        actionId: "action-001",
        eventType: "follow_up_replanned",
        reason: "cooldown_replan",
        createdAt: FIXED_NOW,
        replacementActionId: null
    }));
});
(0, node_test_1.default)("source scan rejects forbidden patterns", () => {
    assertNoForbiddenSourceText(sourceText());
});

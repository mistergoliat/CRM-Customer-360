"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const action_lifecycle_1 = require("../../lib/brain/commercial/action-lifecycle");
(0, node_test_1.default)("exposes the lifecycle contract constants", () => {
    strict_1.default.ok(action_lifecycle_1.COMMERCIAL_ACTION_TYPES.includes("send_whatsapp_reply"));
    strict_1.default.ok(action_lifecycle_1.COMMERCIAL_ACTION_TYPES.includes("no_action"));
    strict_1.default.ok(action_lifecycle_1.COMMERCIAL_ACTION_STATUSES.includes("draft"));
    strict_1.default.ok(action_lifecycle_1.COMMERCIAL_ACTION_STATUSES.includes("executed"));
    strict_1.default.ok(action_lifecycle_1.OPERATOR_REVIEW_DECISIONS.includes("approve"));
    strict_1.default.ok(action_lifecycle_1.OPERATOR_REVIEW_DECISIONS.includes("mark_not_useful"));
    strict_1.default.ok(action_lifecycle_1.COMMERCIAL_ACTION_APPROVAL_REQUIREMENTS.includes("manager_review"));
    strict_1.default.ok(action_lifecycle_1.COMMERCIAL_ACTION_RISK_LEVELS.includes("critical"));
    strict_1.default.ok(action_lifecycle_1.COMMERCIAL_ACTION_CHANNELS.includes("internal"));
    strict_1.default.ok(action_lifecycle_1.COMMERCIAL_ACTION_LIFECYCLE_ALLOWED_TRANSITIONS.includes("draft->proposed"));
});
function makeProposedAction(overrides = {}) {
    return {
        actionId: "action-001",
        decisionId: "decision-001",
        opportunityId: "opp-001",
        caseId: "case-001",
        messageId: "msg-001",
        type: "send_whatsapp_reply",
        status: "proposed",
        channel: "whatsapp",
        riskLevel: "low",
        approvalRequirement: "operator_review",
        draftPayload: {
            text: "Hola, te ayudamos."
        },
        finalPayload: null,
        reason: "Proposal requires human review.",
        blockedReasons: [],
        idempotencyKey: "idem-action-001",
        executable: false,
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: null,
        ...overrides
    };
}
function makeReviewDraft(overrides = {}) {
    return {
        reviewId: "review-001",
        actionId: "action-001",
        decision: "approve",
        editedPayload: null,
        comment: "Looks good.",
        reviewerId: "operator-001",
        createdAt: "2026-06-17T12:00:00.000Z",
        persisted: false,
        ...overrides
    };
}
function makeCommandPreview(overrides = {}) {
    return {
        commandId: "command-001",
        actionId: "action-001",
        commandType: "send_whatsapp_reply",
        payloadPreview: {
            text: "Hola, te ayudamos."
        },
        target: {
            channel: "whatsapp",
            recipient: "56912345678"
        },
        canExecute: false,
        blockedReasons: [],
        ...overrides
    };
}
(0, node_test_1.default)("validates a proposed action and preserves executable=false", () => {
    const result = (0, action_lifecycle_1.validateCommercialProposedAction)(makeProposedAction());
    strict_1.default.equal(result.valid, true);
    strict_1.default.equal(result.value?.executable, false);
    strict_1.default.equal(JSON.stringify(result.value).includes("action-001"), true);
});
(0, node_test_1.default)("rejects a proposed action without idempotency key", () => {
    const result = (0, action_lifecycle_1.validateCommercialProposedAction)(makeProposedAction({ idempotencyKey: "" }));
    strict_1.default.equal(result.valid, false);
    strict_1.default.equal(result.code, "missing_idempotency_key");
});
(0, node_test_1.default)("validates a review draft and keeps persisted=false", () => {
    const result = (0, action_lifecycle_1.validateCommercialOperatorReviewDraft)(makeReviewDraft());
    strict_1.default.equal(result.valid, true);
    strict_1.default.equal(result.value?.persisted, false);
});
(0, node_test_1.default)("validates a command preview and keeps canExecute=false", () => {
    const result = (0, action_lifecycle_1.validateCommercialExecutableCommandPreview)(makeCommandPreview());
    strict_1.default.equal(result.valid, true);
    strict_1.default.equal(result.value?.canExecute, false);
});
(0, node_test_1.default)("validates a decision and keeps the embedded next action non executable", () => {
    const result = (0, action_lifecycle_1.validateCommercialActionDecision)({
        decisionId: "decision-001",
        opportunityId: "opp-001",
        caseId: "case-001",
        messageId: "msg-001",
        nextAction: makeProposedAction({
            status: "requires_review",
            approvalRequirement: "operator_review"
        }),
        rationale: "Operational decision recorded.",
        createdAt: "2026-06-17T12:00:00.000Z"
    });
    strict_1.default.equal(result.valid, true);
    strict_1.default.equal(result.value?.nextAction.executable, false);
});
(0, node_test_1.default)("allows the contractual lifecycle transitions", () => {
    const allowedPairs = [
        ["draft", "proposed"],
        ["proposed", "requires_review"],
        ["requires_review", "approved"],
        ["requires_review", "rejected"],
        ["requires_review", "edited"],
        ["edited", "approved"],
        ["proposed", "planned"],
        ["approved", "planned"],
        ["planned", "scheduled"],
        ["scheduled", "scheduled"],
        ["proposed", "blocked"],
        ["approved", "blocked"],
        ["planned", "blocked"],
        ["scheduled", "blocked"],
        ["proposed", "cancelled"],
        ["approved", "cancelled"],
        ["planned", "cancelled"],
        ["scheduled", "cancelled"],
        ["proposed", "expired"],
        ["approved", "expired"],
        ["planned", "expired"],
        ["scheduled", "expired"]
    ];
    for (const [fromStatus, toStatus] of allowedPairs) {
        const result = (0, action_lifecycle_1.validateActionLifecycleTransition)({
            fromStatus,
            toStatus,
            actionType: "send_whatsapp_reply",
            reviewDecision: "approve",
            currentTime: "2026-06-17T12:00:00.000Z",
            metadata: { caseId: "case-001" }
        });
        strict_1.default.equal(result.allowed, true, `${fromStatus} -> ${toStatus} should be allowed`);
        strict_1.default.equal(result.code, "valid");
    }
});
(0, node_test_1.default)("blocks direct execution and returns the P1K-011A execution reason", () => {
    const blockedPairs = [
        ["proposed", "executed"],
        ["requires_review", "executed"],
        ["approved", "executing"],
        ["planned", "executing"],
        ["executing", "executed"],
        ["executing", "failed"]
    ];
    for (const [fromStatus, toStatus] of blockedPairs) {
        const result = (0, action_lifecycle_1.validateActionLifecycleTransition)({
            fromStatus,
            toStatus,
            actionType: "send_whatsapp_reply",
            reviewDecision: "approve",
            currentTime: "2026-06-17T12:00:00.000Z",
            metadata: {}
        });
        strict_1.default.equal(result.allowed, false, `${fromStatus} -> ${toStatus} should be blocked`);
        strict_1.default.equal(result.reason, "execution_not_enabled_in_p1k_011a");
    }
});
(0, node_test_1.default)("blocks protected terminal statuses from moving forward", () => {
    const blockedPairs = [
        ["rejected", "approved"],
        ["blocked", "approved"],
        ["executed", "edited"],
        ["cancelled", "executed"],
        ["expired", "executed"]
    ];
    for (const [fromStatus, toStatus] of blockedPairs) {
        const result = (0, action_lifecycle_1.validateActionLifecycleTransition)({
            fromStatus,
            toStatus,
            actionType: "send_whatsapp_reply",
            reviewDecision: "approve",
            currentTime: "2026-06-17T12:00:00.000Z",
            metadata: {}
        });
        strict_1.default.equal(result.allowed, false, `${fromStatus} -> ${toStatus} should be blocked`);
        strict_1.default.equal(result.code, "terminal_status_protected");
    }
});
(0, node_test_1.default)("rejects invalid lifecycle inputs safely", () => {
    const statusResult = (0, action_lifecycle_1.validateActionLifecycleTransition)({
        fromStatus: "draft",
        toStatus: "not-a-status",
        currentTime: "2026-06-17T12:00:00.000Z",
        metadata: {}
    });
    const rootResult = (0, action_lifecycle_1.validateCommercialProposedAction)(null);
    strict_1.default.equal(statusResult.allowed, false);
    strict_1.default.equal(statusResult.code, "invalid_status");
    strict_1.default.equal(rootResult.valid, false);
    strict_1.default.equal(rootResult.code, "invalid_root");
});
(0, node_test_1.default)("is JSON serializable and deterministic", () => {
    const action = (0, action_lifecycle_1.validateCommercialProposedAction)(makeProposedAction()).value;
    const first = (0, action_lifecycle_1.validateActionLifecycleTransition)({
        fromStatus: "draft",
        toStatus: "proposed",
        actionType: "send_whatsapp_reply",
        reviewDecision: "approve",
        currentTime: "2026-06-17T12:00:00.000Z",
        metadata: { nested: { ok: true } }
    });
    const second = (0, action_lifecycle_1.validateActionLifecycleTransition)({
        fromStatus: "draft",
        toStatus: "proposed",
        actionType: "send_whatsapp_reply",
        reviewDecision: "approve",
        currentTime: "2026-06-17T12:00:00.000Z",
        metadata: { nested: { ok: true } }
    });
    strict_1.default.doesNotThrow(() => JSON.stringify(action));
    strict_1.default.doesNotThrow(() => JSON.stringify(first));
    strict_1.default.deepEqual(first, second);
});

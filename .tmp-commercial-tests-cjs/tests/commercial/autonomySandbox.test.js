"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const react_1 = require("react");
const server_1 = require("react-dom/server");
const ActionQueueItemCard_1 = require("../../components/cases/ai-sdr/action-queue/ActionQueueItemCard");
const autonomy_sandbox_1 = require("../../lib/brain/commercial/autonomy-sandbox");
const FIXED_TIME = "2026-06-17T12:00:00.000Z";
function makeConfig(overrides = {}) {
    return (0, autonomy_sandbox_1.buildSandboxAutonomyConfig)({
        sandboxEnabled: true,
        autonomousReplyEnabled: true,
        whitelistedWaIds: ["56911111111"],
        allowedActionTypes: ["send_whatsapp_reply", "request_more_context"],
        maxRiskLevel: "low",
        ...overrides
    });
}
function makeContext(overrides = {}) {
    return {
        now: FIXED_TIME,
        caseId: "case-001",
        caseStatus: "open",
        lifecycleStatus: "open",
        humanOwnerActive: false,
        aiBlocked: false,
        requiresHuman: false,
        policyStatus: "allowed",
        conflictingActionExists: false,
        ...overrides
    };
}
function makeAction(overrides = {}) {
    return {
        id: null,
        actionId: "sandbox-action-001",
        idempotencyKey: "sandbox:test-001",
        opportunityId: "opp-001",
        decisionId: "decision-001",
        decisionRowId: 1,
        conversationCaseId: "case-001",
        messageId: "msg-001",
        waId: "56911111111",
        channel: "whatsapp",
        actionType: "send_whatsapp_reply",
        status: "proposed",
        riskLevel: "low",
        approvalRequirement: "none",
        draftPayload: null,
        finalPayload: null,
        executionPayload: null,
        draftMessage: "Hola, te ayudamos con tu consulta.",
        finalMessage: null,
        scheduledFor: null,
        expiresAt: "2026-06-20T12:00:00.000Z",
        attemptNumber: 1,
        maxAttempts: 3,
        blockReasons: [],
        cancelReason: null,
        failureReason: null,
        policyStatus: "allowed",
        policyNotes: [],
        source: "ai_sdr",
        createdBy: "ai",
        approvedBy: null,
        approvedAt: null,
        executedAt: null,
        cancelledAt: null,
        outboxMessageId: null,
        lifecycleVersion: "brain.commercial.action-queue.v1",
        policyVersion: "brain.commercial.policy.v1",
        runtimeVersion: "brain.commercial.runtime.v1",
        createdAt: FIXED_TIME,
        updatedAt: FIXED_TIME,
        ...overrides
    };
}
function evaluate(overrides = {}) {
    return (0, autonomy_sandbox_1.evaluateAgentActionForSandbox)(makeAction(overrides.action), makeContext(overrides.context), makeConfig(overrides.config));
}
function scanSources() {
    const files = [
        "lib/brain/commercial/autonomy-sandbox/types.ts",
        "lib/brain/commercial/autonomy-sandbox/constants.ts",
        "lib/brain/commercial/autonomy-sandbox/parseWhitelist.ts",
        "lib/brain/commercial/autonomy-sandbox/validateAutonomousReplyCandidate.ts",
        "lib/brain/commercial/autonomy-sandbox/buildSandboxExecutionPreview.ts",
        "lib/brain/commercial/autonomy-sandbox/evaluateSandboxAutonomy.ts",
        "lib/brain/commercial/autonomy-sandbox/index.ts",
        "components/cases/ai-sdr/action-queue/ActionQueuePanel.tsx",
        "components/cases/ai-sdr/action-queue/ActionQueueItemCard.tsx"
    ];
    return files.map((file) => (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(process.cwd(), file), "utf8")).join("\n");
}
(0, node_test_1.default)("sandbox disabled blocks by sandbox flag", () => {
    const result = evaluate({
        config: {
            sandboxEnabled: false
        }
    });
    strict_1.default.equal(result.status, "disabled");
    strict_1.default.equal(result.eligible, false);
    strict_1.default.ok(result.blockReasons.includes("sandbox_disabled"));
});
(0, node_test_1.default)("autonomous reply disabled blocks by reply flag", () => {
    const result = evaluate({
        config: {
            autonomousReplyEnabled: false
        }
    });
    strict_1.default.equal(result.status, "disabled");
    strict_1.default.ok(result.blockReasons.includes("autonomous_reply_disabled"));
});
(0, node_test_1.default)("recipient missing is invalid", () => {
    const result = evaluate({
        action: {
            waId: null
        }
    });
    strict_1.default.equal(result.status, "invalid");
    strict_1.default.ok(result.blockReasons.includes("missing_recipient"));
});
(0, node_test_1.default)("recipient not authorized is blocked", () => {
    const result = evaluate({
        config: {
            whitelistedWaIds: ["56922222222"]
        }
    });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("recipient_not_whitelisted"));
});
(0, node_test_1.default)("exact whitelist match is eligible", () => {
    const result = evaluate();
    strict_1.default.equal(result.status, "eligible");
    strict_1.default.equal(result.eligible, true);
    strict_1.default.equal(result.blockReasons.length, 0);
});
(0, node_test_1.default)("partial whitelist match does not pass", () => {
    const result = evaluate({
        action: {
            waId: "5691111111"
        },
        config: {
            whitelistedWaIds: ["56911111111"]
        }
    });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("recipient_not_whitelisted"));
});
(0, node_test_1.default)("wa_id normalization works across formatting", () => {
    const result = evaluate({
        action: {
            waId: "+56 9 1111 1111"
        },
        config: {
            whitelistedWaIds: ["56911111111"]
        }
    });
    strict_1.default.equal(result.status, "eligible");
});
(0, node_test_1.default)("duplicate whitelist entries are deduped by parser", () => {
    const parsed = (0, autonomy_sandbox_1.parseAutonomousTestWaIds)("56911111111, 56911111111, 56922222222");
    strict_1.default.deepEqual(parsed, ["56911111111", "56922222222"]);
    const result = evaluate({
        config: {
            whitelistedWaIds: parsed
        }
    });
    strict_1.default.equal(result.status, "eligible");
});
(0, node_test_1.default)("unsupported channel is blocked", () => {
    const result = evaluate({
        action: {
            channel: "email"
        }
    });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("unsupported_channel"));
});
(0, node_test_1.default)("unsupported action type is blocked", () => {
    const result = evaluate({
        action: {
            actionType: "schedule_followup"
        }
    });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("unsupported_action_type"));
});
(0, node_test_1.default)("medium risk is blocked", () => {
    const result = evaluate({
        action: {
            riskLevel: "medium"
        }
    });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("risk_too_high"));
});
(0, node_test_1.default)("high risk is blocked", () => {
    const result = evaluate({
        action: {
            riskLevel: "high"
        }
    });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("risk_too_high"));
});
(0, node_test_1.default)("approval requirement moves the action to review", () => {
    const result = evaluate({
        action: {
            approvalRequirement: "operator_review"
        }
    });
    strict_1.default.equal(result.status, "requires_review");
    strict_1.default.ok(result.blockReasons.includes("approval_required"));
});
(0, node_test_1.default)("human owner active blocks autonomy", () => {
    const result = evaluate({
        context: {
            humanOwnerActive: true
        }
    });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("human_owner_active"));
});
(0, node_test_1.default)("ai blocked blocks autonomy", () => {
    const result = evaluate({
        context: {
            aiBlocked: true
        }
    });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("ai_blocked"));
});
(0, node_test_1.default)("closed case blocks autonomy", () => {
    const result = evaluate({
        context: {
            caseStatus: "closed"
        }
    });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("case_closed"));
});
(0, node_test_1.default)("expired action is expired", () => {
    const result = evaluate({
        action: {
            expiresAt: "2026-06-16T12:00:00.000Z"
        }
    });
    strict_1.default.equal(result.status, "expired");
    strict_1.default.ok(result.blockReasons.includes("action_expired"));
});
(0, node_test_1.default)("missing idempotency key blocks autonomy", () => {
    const result = evaluate({
        action: {
            idempotencyKey: ""
        }
    });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("missing_idempotency_key"));
});
(0, node_test_1.default)("unsafe message blocks autonomy", () => {
    const result = evaluate({
        action: {
            draftMessage: "Hay stock asegurado para hoy.",
            finalMessage: null
        }
    });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("unsafe_message"));
});
(0, node_test_1.default)("unresolved placeholder blocks autonomy", () => {
    const result = evaluate({
        action: {
            draftMessage: "Hola {{name}}",
            finalMessage: null
        }
    });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("unsafe_payload"));
});
(0, node_test_1.default)("conflicting action blocks autonomy", () => {
    const result = evaluate({
        context: {
            conflictingActionExists: true
        }
    });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("duplicate_or_conflicting_action"));
});
(0, node_test_1.default)("eligible low-risk reply stays eligible", () => {
    const result = evaluate();
    strict_1.default.equal(result.status, "eligible");
    strict_1.default.equal(result.eligible, true);
    strict_1.default.equal(result.executionPreview.canExecute, false);
});
(0, node_test_1.default)("planned low-risk reply stays eligible", () => {
    const result = evaluate({
        action: {
            status: "planned",
            outboxMessageId: null
        }
    });
    strict_1.default.equal(result.status, "eligible");
    strict_1.default.equal(result.executionPreview.canExecute, false);
});
(0, node_test_1.default)("eligible request_more_context stays eligible", () => {
    const result = evaluate({
        action: {
            actionType: "request_more_context",
            draftMessage: "Necesito tu comuna para continuar.",
            waId: "56911111111"
        }
    });
    strict_1.default.equal(result.status, "eligible");
    strict_1.default.equal(result.executionPreview.canExecute, false);
});
(0, node_test_1.default)("eligible sandbox actions still render with canExecute false", () => {
    const result = evaluate({
        action: {
            actionType: "request_more_context",
            draftMessage: "Necesito tu comuna para continuar.",
            waId: "56911111111"
        }
    });
    const markup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(ActionQueueItemCard_1.ActionQueueItemCard, {
        item: {
            actionId: result.actionId,
            actionType: result.actionType,
            status: "eligible",
            riskLevel: result.riskLevel,
            approvalRequirement: result.approvalRequirement,
            draftMessage: result.executionPreview.messagePreview,
            scheduledFor: null,
            blockReasons: result.blockReasons,
            cancelReason: null,
            rationale: "Sandbox preview only.",
            idempotencyKey: result.executionPreview.idempotencyKey,
            persisted: false,
            executable: false,
            source: "next_action_json",
            sandboxAutonomy: result
        }
    }));
    strict_1.default.equal(result.executionPreview.canExecute, false);
    strict_1.default.ok(markup.includes("Sandbox eligibility"));
    strict_1.default.ok(markup.includes("Recipient"));
    strict_1.default.ok(markup.includes("Whitelist"));
    strict_1.default.ok(markup.includes("Execution"));
    strict_1.default.ok(markup.includes("disabled in current milestone"));
});
(0, node_test_1.default)("recipient masking keeps the number hidden", () => {
    strict_1.default.equal((0, autonomy_sandbox_1.maskWaId)("56912345678"), "569*****678");
});
(0, node_test_1.default)("sandbox integration files do not add DB, outbox, send, Meta or n8n code", () => {
    const source = scanSources();
    strict_1.default.equal(/INSERT INTO|queryRows|PoolConnection|safeQueryRows/i.test(source), false);
    strict_1.default.equal(/brain_message_outbox|outboxMessageId/i.test(source), false);
    strict_1.default.equal(/sendWhatsApp|sendMessage|fetch\(.*graph\.facebook/i.test(source), false);
    strict_1.default.equal(/Meta send|graph\.facebook/i.test(source), false);
    strict_1.default.equal(/n8n_/i.test(source), false);
});

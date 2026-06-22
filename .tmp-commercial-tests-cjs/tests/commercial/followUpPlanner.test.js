"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const follow_up_planner_1 = require("../../lib/brain/commercial/follow-up-planner");
const FIXED_TIME = "2026-06-17T12:00:00.000Z";
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
function makeInput(overrides = {}) {
    const base = {
        now: FIXED_TIME,
        timezone: "America/Santiago",
        opportunity: {
            id: "opp-001",
            status: "qualifying",
            stage: "qualification",
            temperature: "warm",
            priority: "high",
            primaryIntent: "product_inquiry",
            currentSummary: "Cliente consulta por producto.",
            missingRequirements: [],
            productInterests: ["banca"],
            objections: [],
            signals: ["customer_message_present"],
            lastActivityAt: "2026-06-17T11:10:00.000Z",
            lastCustomerMessageId: "msg-001",
            lastAgentDecisionId: "decision-001",
            nextActionType: null,
            humanOwnerActive: false,
            aiBlocked: false,
            closedAt: null
        },
        caseContext: {
            caseId: "case-001",
            status: "open",
            lifecycleStatus: "open",
            department: "ventas",
            priority: "medium",
            requiresHuman: false,
            lastMessageAt: "2026-06-17T11:55:00.000Z",
            closedAt: null
        },
        conversation: {
            waId: "56912345678",
            channel: "whatsapp",
            lastCustomerMessageAt: "2026-06-17T10:50:00.000Z",
            lastAgentMessageAt: "2026-06-17T11:00:00.000Z",
            lastInboundText: "Hola, quiero saber mas del producto.",
            lastOutboundText: "Perfecto, te ayudo."
        },
        lastDecision: null,
        policy: {
            maxAttempts: 3,
            cooldownHours: 0,
            defaultDelayHours: 2,
            requireOperatorReview: false,
            allowLowRiskAutoApprovalPreview: true
        }
    };
    const hasOverride = (key) => Object.prototype.hasOwnProperty.call(overrides, key);
    return {
        ...base,
        ...overrides,
        opportunity: hasOverride("opportunity") ? (overrides.opportunity ?? null) : base.opportunity,
        caseContext: hasOverride("caseContext") ? (overrides.caseContext ?? null) : base.caseContext,
        conversation: hasOverride("conversation") ? (overrides.conversation ?? null) : base.conversation,
        lastDecision: hasOverride("lastDecision") ? (overrides.lastDecision ?? null) : base.lastDecision,
        policy: hasOverride("policy") ? (overrides.policy ?? null) : base.policy
    };
}
function makeOpportunity(overrides = {}) {
    return {
        id: "opp-001",
        status: "qualifying",
        stage: "qualification",
        temperature: "warm",
        priority: "high",
        primaryIntent: "product_inquiry",
        currentSummary: "Cliente consulta por producto.",
        missingRequirements: [],
        productInterests: ["banca"],
        objections: [],
        signals: ["customer_message_present"],
        lastActivityAt: "2026-06-17T11:10:00.000Z",
        lastCustomerMessageId: "msg-001",
        lastAgentDecisionId: "decision-001",
        nextActionType: null,
        humanOwnerActive: false,
        aiBlocked: false,
        closedAt: null,
        ...overrides
    };
}
(0, node_test_1.default)("returns not_needed when there is no opportunity", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        opportunity: null
    }));
    strict_1.default.equal(plan.status, "not_needed");
    strict_1.default.equal(plan.intent, "no_followup");
    strict_1.default.equal(plan.executable, false);
    strict_1.default.equal(plan.persisted, false);
});
(0, node_test_1.default)("blocks a closed case", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        caseContext: {
            caseId: "case-001",
            status: "closed",
            lifecycleStatus: "closed",
            department: "ventas",
            priority: "medium",
            requiresHuman: false,
            lastMessageAt: "2026-06-17T11:55:00.000Z",
            closedAt: "2026-06-17T11:59:00.000Z"
        }
    }));
    strict_1.default.equal(plan.status, "blocked");
    strict_1.default.equal(plan.blockReasons.includes("case_closed"), true);
    strict_1.default.equal(plan.cancelReason, null);
});
(0, node_test_1.default)("blocks when AI is blocked", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        opportunity: {
            ...makeOpportunity(),
            aiBlocked: true
        }
    }));
    strict_1.default.equal(plan.status, "blocked");
    strict_1.default.equal(plan.blockReasons.includes("ai_blocked"), true);
});
(0, node_test_1.default)("requires operator review when human ownership is active and policy requires review", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        opportunity: {
            ...makeOpportunity(),
            humanOwnerActive: true
        },
        policy: {
            maxAttempts: 3,
            cooldownHours: 1,
            defaultDelayHours: 2,
            requireOperatorReview: true,
            allowLowRiskAutoApprovalPreview: false
        }
    }));
    strict_1.default.equal(plan.status, "requires_operator_review");
    strict_1.default.equal(plan.approvalRequirement, "operator_review");
    strict_1.default.equal(plan.scheduledFor !== null, true);
});
(0, node_test_1.default)("blocks when human ownership is active and policy does not require review", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        opportunity: {
            ...makeOpportunity(),
            humanOwnerActive: true
        },
        policy: {
            maxAttempts: 3,
            cooldownHours: 1,
            defaultDelayHours: 2,
            requireOperatorReview: false,
            allowLowRiskAutoApprovalPreview: true
        }
    }));
    strict_1.default.equal(plan.status, "blocked");
    strict_1.default.equal(plan.blockReasons.includes("human_owner_active"), true);
});
(0, node_test_1.default)("cancels follow-up when the customer replied after the last agent message", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        conversation: {
            waId: "56912345678",
            channel: "whatsapp",
            lastCustomerMessageAt: "2026-06-17T11:59:30.000Z",
            lastAgentMessageAt: "2026-06-17T11:55:00.000Z",
            lastInboundText: "Volvi a escribir.",
            lastOutboundText: "Te dejo el seguimiento."
        }
    }));
    strict_1.default.equal(plan.status, "cancelled");
    strict_1.default.equal(plan.cancelReason, "customer_replied");
    strict_1.default.equal(plan.blockReasons.includes("customer_replied_after_last_agent_message"), true);
    strict_1.default.equal(plan.executable, false);
    strict_1.default.equal(plan.persisted, false);
});
(0, node_test_1.default)("marks follow-up as expired when the previous decision expired", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        lastDecision: {
            decisionId: "decision-expired",
            nextActionJson: {
                status: "expired"
            },
            policyStatus: "blocked",
            riskLevel: "low",
            approvalRequirement: "blocked",
            decisionStatus: "expired",
            createdAt: "2026-06-17T10:00:00.000Z"
        }
    }));
    strict_1.default.equal(plan.status, "expired");
    strict_1.default.equal(plan.cancelReason, "expired");
    strict_1.default.equal(plan.blockReasons.includes("outside_policy_window"), true);
});
(0, node_test_1.default)("blocks when the cooldown window is active", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        conversation: {
            waId: "56912345678",
            channel: "whatsapp",
            lastCustomerMessageAt: "2026-06-17T11:00:00.000Z",
            lastAgentMessageAt: "2026-06-17T11:40:00.000Z",
            lastInboundText: "Hola, sigo atento.",
            lastOutboundText: "Te respondo pronto."
        },
        policy: {
            maxAttempts: 3,
            cooldownHours: 2,
            defaultDelayHours: 2,
            requireOperatorReview: false,
            allowLowRiskAutoApprovalPreview: true
        }
    }));
    strict_1.default.equal(plan.status, "blocked");
    strict_1.default.equal(plan.blockReasons.includes("cooldown_active"), true);
    strict_1.default.equal(plan.scheduledFor, "2026-06-17T13:40:00.000Z");
});
(0, node_test_1.default)("blocks high-risk intents", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        conversation: {
            waId: "56912345678",
            channel: "whatsapp",
            lastCustomerMessageAt: "2026-06-17T11:50:00.000Z",
            lastAgentMessageAt: "2026-06-17T11:55:00.000Z",
            lastInboundText: "Quiero hacer una devolucion y reclamo.",
            lastOutboundText: "Entiendo."
        }
    }));
    strict_1.default.equal(plan.status, "blocked");
    strict_1.default.ok(plan.blockReasons.includes("complaint_or_warranty") || plan.blockReasons.includes("high_risk_intent"));
});
(0, node_test_1.default)("blocks WhatsApp follow-up when waId is missing", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        conversation: {
            waId: null,
            channel: "whatsapp",
            lastCustomerMessageAt: "2026-06-17T11:50:00.000Z",
            lastAgentMessageAt: "2026-06-17T11:55:00.000Z",
            lastInboundText: "Hola, quiero saber mas del producto.",
            lastOutboundText: "Perfecto."
        }
    }));
    strict_1.default.equal(plan.status, "blocked");
    strict_1.default.equal(plan.blockReasons.includes("missing_customer_identity"), true);
});
(0, node_test_1.default)("blocks when the channel is missing", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        conversation: {
            waId: "56912345678",
            channel: "unknown",
            lastCustomerMessageAt: "2026-06-17T11:50:00.000Z",
            lastAgentMessageAt: "2026-06-17T11:55:00.000Z",
            lastInboundText: "Hola, quiero saber mas del producto.",
            lastOutboundText: "Perfecto."
        }
    }));
    strict_1.default.equal(plan.status, "blocked");
    strict_1.default.equal(plan.blockReasons.includes("missing_channel"), true);
});
(0, node_test_1.default)("recommends follow-up for a warm commercial opportunity", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        opportunity: {
            ...makeOpportunity(),
            primaryIntent: "product_inquiry",
            missingRequirements: [],
            nextActionType: null
        },
        policy: {
            maxAttempts: 3,
            cooldownHours: 0,
            defaultDelayHours: 2,
            requireOperatorReview: false,
            allowLowRiskAutoApprovalPreview: true
        }
    }));
    strict_1.default.equal(plan.status, "recommended");
    strict_1.default.equal(plan.executable, false);
    strict_1.default.equal(plan.persisted, false);
    strict_1.default.ok(plan.draftMessage);
});
(0, node_test_1.default)("quote follow-up generates a safe draft", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        opportunity: {
            ...makeOpportunity(),
            primaryIntent: "quote_request",
            currentSummary: "Cliente pide cotizacion formal.",
            missingRequirements: [],
            nextActionType: null
        }
    }));
    strict_1.default.equal(plan.intent, "quote_followup");
    strict_1.default.equal(plan.status === "recommended" || plan.status === "requires_operator_review", true);
    strict_1.default.ok((plan.draftMessage ?? "").toLowerCase().includes("cotizacion"));
    strict_1.default.equal((plan.draftMessage ?? "").toLowerCase().includes("precio"), false);
    strict_1.default.equal((plan.draftMessage ?? "").toLowerCase().includes("stock"), false);
    strict_1.default.equal((plan.draftMessage ?? "").toLowerCase().includes("descuento"), false);
});
(0, node_test_1.default)("missing information follow-up generates a safe draft", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        opportunity: {
            ...makeOpportunity(),
            primaryIntent: "general_information",
            currentSummary: "Falta producto y comuna.",
            missingRequirements: ["producto", "comuna"],
            nextActionType: "ask_clarifying_question"
        }
    }));
    strict_1.default.equal(plan.intent, "missing_information_followup");
    strict_1.default.ok((plan.draftMessage ?? "").toLowerCase().includes("falta"));
    strict_1.default.ok((plan.draftMessage ?? "").toLowerCase().includes("producto"));
    strict_1.default.equal((plan.draftMessage ?? "").toLowerCase().includes("precio"), false);
});
(0, node_test_1.default)("limits attempts and blocks when the maximum is reached", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        lastDecision: {
            decisionId: "decision-attempts",
            nextActionJson: {
                attemptNumber: 3
            },
            policyStatus: "allowed",
            riskLevel: "low",
            approvalRequirement: "none",
            decisionStatus: "recorded",
            createdAt: "2026-06-17T11:00:00.000Z"
        },
        policy: {
            maxAttempts: 2,
            cooldownHours: 0,
            defaultDelayHours: 2,
            requireOperatorReview: false,
            allowLowRiskAutoApprovalPreview: true
        }
    }));
    strict_1.default.equal(plan.status, "blocked");
    strict_1.default.equal(plan.blockReasons.includes("max_attempts_reached"), true);
});
(0, node_test_1.default)("returns a stable idempotency key and JSON serializable output", () => {
    const input = makeInput();
    const before = JSON.stringify(input);
    const first = (0, follow_up_planner_1.planCommercialFollowUp)(input);
    const second = (0, follow_up_planner_1.planCommercialFollowUp)(cloneJson(input));
    strict_1.default.equal(before, JSON.stringify(input));
    strict_1.default.equal(first.idempotencyKey, second.idempotencyKey);
    strict_1.default.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
    strict_1.default.doesNotThrow(() => JSON.stringify(first));
});
(0, node_test_1.default)("validates the plan and keeps the proposed action non executable", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput());
    const validation = (0, follow_up_planner_1.validateFollowUpPlan)(plan);
    const preview = (0, follow_up_planner_1.toProposedActionPreview)(plan);
    strict_1.default.equal(validation.valid, true);
    strict_1.default.equal(preview.type, "schedule_followup");
    strict_1.default.equal(preview.executable, false);
    strict_1.default.equal(preview.finalPayload, null);
    strict_1.default.ok(preview.draftPayload);
});
(0, node_test_1.default)("does not invent price, stock or discounts in the draft", () => {
    const plan = (0, follow_up_planner_1.planCommercialFollowUp)(makeInput({
        opportunity: {
            ...makeOpportunity(),
            primaryIntent: "quote_request",
            currentSummary: "Cliente pide cotizacion.",
            missingRequirements: [],
            nextActionType: null
        }
    }));
    const draft = (plan.draftMessage ?? "").toLowerCase();
    strict_1.default.equal(draft.includes("precio"), false);
    strict_1.default.equal(draft.includes("stock"), false);
    strict_1.default.equal(draft.includes("descuento"), false);
    strict_1.default.equal(draft.includes("garantia"), false);
});

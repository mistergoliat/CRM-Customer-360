"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTONOMOUS_LOOP_FIXTURE_WAID = exports.AUTONOMOUS_LOOP_FIXTURE_CORRELATION = exports.AUTONOMOUS_LOOP_FIXTURE_TENANT = exports.AUTONOMOUS_LOOP_FIXTURE_NOW = void 0;
exports.lowRiskPriceQuestionFixture = lowRiskPriceQuestionFixture;
exports.requestMoreContextFixture = requestMoreContextFixture;
exports.humanHandoffFixture = humanHandoffFixture;
exports.complaintBlockedFixture = complaintBlockedFixture;
exports.customerReplyCancelsFollowUpFixture = customerReplyCancelsFollowUpFixture;
exports.temporaryTransportFailureFixture = temporaryTransportFailureFixture;
exports.rateLimitedTransportFixture = rateLimitedTransportFixture;
exports.permanentTransportFailureFixture = permanentTransportFailureFixture;
exports.duplicateInboundFixture = duplicateInboundFixture;
exports.duplicateExecutionFixture = duplicateExecutionFixture;
exports.closedCaseFixture = closedCaseFixture;
exports.aiBlockedFixture = aiBlockedFixture;
exports.opportunityWonFixture = opportunityWonFixture;
exports.buildAutonomousLoopFixtureRunId = buildAutonomousLoopFixtureRunId;
const constants_1 = require("./constants");
exports.AUTONOMOUS_LOOP_FIXTURE_NOW = "2026-06-17T12:00:00.000Z";
exports.AUTONOMOUS_LOOP_FIXTURE_TENANT = "tenant-autonomous-loop";
exports.AUTONOMOUS_LOOP_FIXTURE_CORRELATION = "corr-autonomous-loop";
exports.AUTONOMOUS_LOOP_FIXTURE_WAID = "56911111111";
function baseInput() {
    return {
        now: exports.AUTONOMOUS_LOOP_FIXTURE_NOW,
        mode: "execute_fake",
        correlationId: exports.AUTONOMOUS_LOOP_FIXTURE_CORRELATION,
        tenantId: exports.AUTONOMOUS_LOOP_FIXTURE_TENANT,
        inbound: {
            messageId: "msg-autonomous-loop",
            providerMessageId: "wamid-autonomous-loop",
            waId: exports.AUTONOMOUS_LOOP_FIXTURE_WAID,
            contactName: "Cliente de prueba",
            text: "Hola, necesito el precio del servicio.",
            receivedAt: exports.AUTONOMOUS_LOOP_FIXTURE_NOW,
            channel: "whatsapp"
        },
        caseContext: {
            caseId: 101,
            status: "open",
            lifecycleStatus: "open",
            department: "sales",
            priority: "normal",
            humanOwnerActive: false,
            aiBlocked: false,
            requiresHuman: false
        },
        commercialContext: {
            opportunityId: 202,
            opportunityKey: "opp-autonomous-loop",
            opportunityStatus: "open",
            opportunityStage: "discovery",
            opportunityStageChangedAt: null,
            lastInboundAt: exports.AUTONOMOUS_LOOP_FIXTURE_NOW,
            lastOutboundAt: null,
            lastHumanMessageAt: null,
            lastAiMessageAt: null
        },
        configuration: {
            operationalLoopEnabled: true,
            sandboxAutonomyEnabled: true,
            autonomousReplyEnabled: true,
            whitelistedWaIds: [exports.AUTONOMOUS_LOOP_FIXTURE_WAID],
            executionGateEnabled: true,
            outboxBridgeEnabled: true,
            outboxWorkerEnabled: true,
            messageTransportEnabled: true,
            followUpEnabled: true,
            sandboxRequired: true
        },
        scenario: {
            transportScenario: "accepted"
        }
    };
}
function createSnapshot(input) {
    return {
        opportunities: [],
        decisions: [],
        actions: [],
        outbox: [],
        deliveryResults: [],
        followUpMutationPlans: [],
        auditEvents: [],
        processedCorrelationIds: [],
        processedProviderMessageIds: [],
        updatedAt: null
    };
}
function withOverrides(overrides, runtime) {
    const input = structuredClone(baseInput());
    deepMerge(input, overrides);
    return {
        input,
        snapshot: runtime ? deepMerge(createSnapshot(input), runtime) : createSnapshot(input)
    };
}
function deepMerge(target, source) {
    if (source === null || source === undefined)
        return target;
    for (const [key, value] of Object.entries(source)) {
        if (value === undefined)
            continue;
        const current = target[key];
        if (Array.isArray(value)) {
            target[key] = [...value];
            continue;
        }
        if (value && typeof value === "object" && !Array.isArray(value)) {
            target[key] = deepMerge(current && typeof current === "object" ? structuredClone(current) : {}, value);
            continue;
        }
        target[key] = value;
    }
    return target;
}
function lowRiskPriceQuestionFixture() {
    return withOverrides({
        inbound: {
            messageId: "msg-low-risk",
            providerMessageId: "wamid-low-risk",
            waId: exports.AUTONOMOUS_LOOP_FIXTURE_WAID,
            contactName: "Cliente de prueba",
            text: "Cual es el precio?",
            receivedAt: exports.AUTONOMOUS_LOOP_FIXTURE_NOW,
            channel: "whatsapp"
        },
        scenario: {
            transportScenario: "accepted",
            forceActionType: "send_whatsapp_reply",
            forceRiskLevel: "low",
            forceApprovalRequirement: "none",
            forceDecision: "respond_now"
        }
    });
}
function requestMoreContextFixture() {
    return withOverrides({
        inbound: {
            messageId: "msg-request-more-context",
            providerMessageId: "wamid-request-more-context",
            waId: exports.AUTONOMOUS_LOOP_FIXTURE_WAID,
            contactName: "Cliente de prueba",
            text: "Necesito mas contexto para decidir.",
            receivedAt: exports.AUTONOMOUS_LOOP_FIXTURE_NOW,
            channel: "whatsapp"
        },
        scenario: {
            transportScenario: "accepted",
            forceActionType: "request_more_context",
            forceRiskLevel: "low",
            forceApprovalRequirement: "none",
            forceDecision: "respond_now"
        }
    });
}
function humanHandoffFixture() {
    return withOverrides({
        caseContext: {
            caseId: 101,
            status: "open",
            lifecycleStatus: "open",
            department: "sales",
            priority: "high",
            humanOwnerActive: true,
            aiBlocked: false,
            requiresHuman: true
        },
        scenario: {
            transportScenario: "accepted",
            forceDecision: "request_human",
            forceActionType: "take_over_case",
            forceRiskLevel: "low",
            forceApprovalRequirement: "operator_review"
        }
    });
}
function complaintBlockedFixture() {
    return withOverrides({
        inbound: {
            messageId: "msg-complaint",
            providerMessageId: "wamid-complaint",
            waId: exports.AUTONOMOUS_LOOP_FIXTURE_WAID,
            contactName: "Cliente de prueba",
            text: "Esto es una queja y no quiero mas mensajes.",
            receivedAt: exports.AUTONOMOUS_LOOP_FIXTURE_NOW,
            channel: "whatsapp"
        },
        caseContext: {
            caseId: 101,
            status: "open",
            lifecycleStatus: "open",
            department: "sales",
            priority: "high",
            humanOwnerActive: false,
            aiBlocked: true,
            requiresHuman: false
        },
        scenario: {
            transportScenario: "accepted",
            forceDecision: "blocked",
            forceActionType: "send_whatsapp_reply",
            forceRiskLevel: "high",
            forceApprovalRequirement: "blocked"
        }
    });
}
function customerReplyCancelsFollowUpFixture() {
    return withOverrides({
        commercialContext: {
            opportunityId: 202,
            opportunityKey: "opp-autonomous-loop",
            opportunityStatus: "open",
            opportunityStage: "qualification",
            opportunityStageChangedAt: null,
            lastInboundAt: "2026-06-17T14:00:00.000Z",
            lastOutboundAt: null,
            lastHumanMessageAt: null,
            lastAiMessageAt: null
        },
        scenario: {
            transportScenario: "accepted",
            forceDecision: "no_commercial_action",
            forceActionType: "schedule_followup",
            forceRiskLevel: "low",
            forceApprovalRequirement: "none"
        }
    });
}
function temporaryTransportFailureFixture() {
    return withOverrides({
        scenario: {
            transportScenario: "temporary_failure",
            forceActionType: "send_whatsapp_reply",
            forceRiskLevel: "low",
            forceApprovalRequirement: "none",
            forceDecision: "respond_now"
        }
    });
}
function rateLimitedTransportFixture() {
    return withOverrides({
        scenario: {
            transportScenario: "rate_limited",
            forceActionType: "send_whatsapp_reply",
            forceRiskLevel: "low",
            forceApprovalRequirement: "none",
            forceDecision: "respond_now"
        }
    });
}
function permanentTransportFailureFixture() {
    return withOverrides({
        scenario: {
            transportScenario: "permanent_failure",
            forceActionType: "send_whatsapp_reply",
            forceRiskLevel: "low",
            forceApprovalRequirement: "none",
            forceDecision: "respond_now"
        }
    });
}
function duplicateInboundFixture() {
    const fixture = withOverrides({});
    fixture.snapshot.processedCorrelationIds.push(fixture.input.correlationId);
    fixture.snapshot.processedProviderMessageIds.push(fixture.input.inbound.providerMessageId ?? fixture.input.inbound.messageId);
    return fixture;
}
function duplicateExecutionFixture() {
    return withOverrides({
        scenario: {
            transportScenario: "duplicate_accepted",
            forceActionType: "send_whatsapp_reply",
            forceRiskLevel: "low",
            forceApprovalRequirement: "none",
            forceDecision: "respond_now"
        }
    });
}
function closedCaseFixture() {
    return withOverrides({
        caseContext: {
            caseId: 101,
            status: "closed",
            lifecycleStatus: "closed",
            department: "sales",
            priority: "normal",
            humanOwnerActive: false,
            aiBlocked: false,
            requiresHuman: false
        }
    });
}
function aiBlockedFixture() {
    return withOverrides({
        caseContext: {
            caseId: 101,
            status: "open",
            lifecycleStatus: "open",
            department: "sales",
            priority: "normal",
            humanOwnerActive: false,
            aiBlocked: true,
            requiresHuman: false
        }
    });
}
function opportunityWonFixture() {
    return withOverrides({
        commercialContext: {
            opportunityId: 202,
            opportunityKey: "opp-autonomous-loop",
            opportunityStatus: "won",
            opportunityStage: "closing",
            opportunityStageChangedAt: null,
            lastInboundAt: exports.AUTONOMOUS_LOOP_FIXTURE_NOW,
            lastOutboundAt: null,
            lastHumanMessageAt: null,
            lastAiMessageAt: null
        }
    });
}
function buildAutonomousLoopFixtureRunId(input) {
    return (0, constants_1.buildAutonomousLoopRunId)({
        tenantId: input.tenantId,
        correlationId: input.correlationId,
        messageId: input.inbound.messageId,
        now: input.now
    });
}

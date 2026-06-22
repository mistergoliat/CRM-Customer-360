"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateAutonomousLoop = evaluateAutonomousLoop;
exports.evaluateAutonomousLoopPreview = evaluateAutonomousLoopPreview;
exports.evaluateImmediateTransportResult = evaluateImmediateTransportResult;
const action_queue_1 = require("../action-queue");
const autonomy_sandbox_1 = require("../autonomy-sandbox");
const execution_gate_1 = require("../execution-gate");
const follow_up_replanning_1 = require("../follow-up-replanning");
const follow_up_scheduling_1 = require("../follow-up-scheduling");
const operational_loop_1 = require("../operational-loop");
const buildAutonomousLoopContext_1 = require("./buildAutonomousLoopContext");
const buildAutonomousAuditTrail_1 = require("./buildAutonomousAuditTrail");
const constants_1 = require("./constants");
const inMemoryAutonomousRuntime_1 = require("./inMemoryAutonomousRuntime");
const outbox_worker_1 = require("../../messaging/outbox-worker");
const whatsapp_transport_1 = require("../../messaging/whatsapp-transport");
const IMMEDIATE_ACTION_TYPES = new Set(["send_whatsapp_reply", "request_more_context"]);
const FOLLOW_UP_ACTION_TYPES = new Set(["schedule_followup"]);
function asText(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number" && Number.isFinite(value))
        return String(value);
    if (typeof value === "bigint")
        return value.toString();
    return null;
}
function isIsoTimestamp(value) {
    if (typeof value !== "string")
        return false;
    return !Number.isNaN(new Date(value).getTime());
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}
function safeError(stage, code, messageSafe, retryable) {
    return {
        stage,
        code,
        messageSafe: messageSafe
            .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
            .replace(/\b(?:\+?\d[\d\s-]{6,}\d)\b/g, "[redacted]")
            .trim(),
        retryable
    };
}
function validateInput(input) {
    if (!isIsoTimestamp(input.now))
        return safeError("context", "invalid_timestamp", "Invalid evaluation timestamp.", false);
    if (!asText(input.correlationId))
        return safeError("context", "invalid_input", "Missing correlation id.", false);
    if (!asText(input.tenantId))
        return safeError("context", "invalid_input", "Missing tenant id.", false);
    if (!asText(input.inbound.messageId))
        return safeError("context", "invalid_input", "Missing inbound message id.", false);
    if (!asText(input.inbound.waId))
        return safeError("context", "invalid_input", "Missing inbound waId.", false);
    if (!asText(input.inbound.text))
        return safeError("context", "invalid_input", "Missing inbound text.", false);
    if (!isIsoTimestamp(input.inbound.receivedAt))
        return safeError("context", "invalid_timestamp", "Invalid inbound timestamp.", false);
    if (input.inbound.channel !== "whatsapp")
        return safeError("context", "invalid_input", "Unsupported inbound channel.", false);
    if (!input.configuration.operationalLoopEnabled)
        return safeError("context", "operational_loop_disabled", "Operational loop is disabled.", false);
    if (!Array.isArray(input.configuration.whitelistedWaIds) || input.configuration.whitelistedWaIds.length === 0) {
        return safeError("context", "invalid_input", "Missing recipient whitelist.", false);
    }
    return null;
}
function buildCrmActionContext(input) {
    return {
        currentTime: input.now,
        timezone: "America/Santiago",
        opportunityId: input.commercialContext.opportunityId,
        decisionId: null,
        decisionRowId: null,
        conversationCaseId: input.caseContext.caseId,
        messageId: input.inbound.messageId,
        waId: input.inbound.waId,
        channel: "whatsapp",
        scheduledFor: input.now,
        expiresAt: null,
        source: "ai_sdr",
        createdBy: "ai",
        policyStatus: "allowed",
        policyVersion: "brain.commercial.policy.v1",
        runtimeVersion: "brain.commercial.sales-agent.runtime.v1",
        lifecycleVersion: "brain.commercial.action-lifecycle.v1",
        approvedBy: null,
        approvedAt: null,
        attemptNumber: 1,
        maxAttempts: 3
    };
}
function cloneSnapshot(snapshot) {
    return (0, constants_1.cloneDeep)(snapshot);
}
function getSnapshotOrEmpty(snapshot) {
    return snapshot ? cloneSnapshot(snapshot) : (0, inMemoryAutonomousRuntime_1.createEmptyAutonomousLoopRuntimeSnapshot)();
}
function buildAction(input, operationalResult) {
    if (!operationalResult.selectedNextAction)
        return null;
    const action = (0, action_queue_1.buildAgentActionFromNextAction)({
        nextAction: operationalResult.selectedNextAction,
        context: buildCrmActionContext(input)
    });
    if (input.scenario.forceActionType)
        action.actionType = input.scenario.forceActionType;
    if (input.scenario.forceRiskLevel)
        action.riskLevel = input.scenario.forceRiskLevel;
    if (input.scenario.forceApprovalRequirement)
        action.approvalRequirement = input.scenario.forceApprovalRequirement;
    if (input.scenario.forceDecision === "request_human") {
        action.actionType = "take_over_case";
        action.status = "blocked";
    }
    if (input.scenario.forceDecision === "blocked")
        action.status = "blocked";
    if (input.scenario.forceDecision === "no_commercial_action") {
        action.actionType = "no_action";
        action.status = "blocked";
    }
    if (action.actionType === "schedule_followup") {
        action.status = action.status === "requires_review" ? "requires_review" : "planned";
    }
    else if (action.actionType === "send_whatsapp_reply" || action.actionType === "request_more_context") {
        action.status = action.status === "requires_review" ? "requires_review" : "proposed";
    }
    return action;
}
function buildFollowUpState(action) {
    return {
        actions: [
            {
                rowId: action.id,
                actionId: action.actionId,
                idempotencyKey: action.idempotencyKey,
                actionType: action.actionType,
                status: action.status,
                scheduledFor: action.scheduledFor,
                expiresAt: action.expiresAt,
                attemptCount: action.attemptNumber,
                maxAttempts: action.maxAttempts,
                riskLevel: action.riskLevel,
                approvalRequirement: action.approvalRequirement,
                opportunityId: action.opportunityId,
                conversationCaseId: action.conversationCaseId,
                waId: action.waId,
                draftMessage: action.draftMessage,
                finalMessage: action.finalMessage,
                blockReasons: [...action.blockReasons],
                cancelReason: action.cancelReason,
                supersededByActionId: null,
                parentActionId: null,
                generation: 1,
                lifecycleVersion: action.lifecycleVersion,
                policyVersion: action.policyVersion,
                runtimeVersion: action.runtimeVersion,
                createdAt: action.createdAt ?? "",
                updatedAt: action.updatedAt
            }
        ],
        auditEvents: [],
        appliedPlanKeys: []
    };
}
function buildFollowUpSchedulingInput(input, action) {
    return {
        now: input.now,
        action: {
            actionId: action.actionId,
            idempotencyKey: action.idempotencyKey,
            actionType: action.actionType,
            status: action.status,
            createdAt: action.createdAt ?? input.now,
            updatedAt: action.updatedAt,
            scheduledFor: action.scheduledFor,
            expiresAt: action.expiresAt,
            attemptCount: action.attemptNumber,
            maxAttempts: action.maxAttempts,
            riskLevel: action.riskLevel,
            approvalRequirement: action.approvalRequirement,
            opportunityId: action.opportunityId,
            conversationCaseId: action.conversationCaseId,
            waId: action.waId,
            blockReasons: [...action.blockReasons],
            cancelReason: action.cancelReason
        },
        activity: {
            lastInboundAt: input.commercialContext.lastInboundAt,
            lastOutboundAt: input.commercialContext.lastOutboundAt,
            lastHumanMessageAt: input.commercialContext.lastHumanMessageAt,
            lastAiMessageAt: input.commercialContext.lastAiMessageAt
        },
        context: {
            caseStatus: input.caseContext.status,
            lifecycleStatus: input.caseContext.lifecycleStatus,
            humanOwnerActive: input.caseContext.humanOwnerActive,
            aiBlocked: input.caseContext.aiBlocked,
            requiresHuman: input.caseContext.requiresHuman,
            opportunityStatus: input.commercialContext.opportunityStatus,
            opportunityStage: input.commercialContext.opportunityStage,
            opportunityStageChangedAt: input.commercialContext.opportunityStageChangedAt,
            policyStatus: "allowed",
            conflictingActionExists: false,
            duplicateActionExists: false
        },
        policy: {
            followUpEnabled: input.configuration.followUpEnabled,
            allowedActionTypes: ["schedule_followup", "send_followup_message", "request_more_context"],
            maxRiskLevel: "low",
            cooldownMinutesAfterInbound: 30,
            cooldownMinutesAfterOutbound: 30,
            businessHoursEnabled: false,
            businessTimezone: "America/Santiago",
            businessDays: [1, 2, 3, 4, 5],
            businessStartHour: 9,
            businessEndHour: 18,
            replanOutsideBusinessHours: true,
            replanAfterCooldown: true,
            requireExpiry: false,
            maxFutureDays: 7
        }
    };
}
function buildFollowUpInput(input, action, schedulingResult) {
    return {
        now: input.now,
        originalAction: {
            rowId: action.id,
            actionId: action.actionId,
            idempotencyKey: action.idempotencyKey,
            actionType: action.actionType,
            status: action.status,
            createdAt: action.createdAt ?? input.now,
            updatedAt: action.updatedAt,
            scheduledFor: action.scheduledFor,
            expiresAt: action.expiresAt,
            attemptCount: action.attemptNumber,
            maxAttempts: action.maxAttempts,
            riskLevel: action.riskLevel,
            approvalRequirement: action.approvalRequirement,
            opportunityId: action.opportunityId,
            conversationCaseId: action.conversationCaseId,
            waId: action.waId,
            draftMessage: action.draftMessage,
            finalMessage: action.finalMessage,
            blockReasons: [...action.blockReasons],
            cancelReason: action.cancelReason,
            parentActionId: null,
            supersededByActionId: null,
            lifecycleVersion: action.lifecycleVersion,
            policyVersion: action.policyVersion,
            runtimeVersion: action.runtimeVersion
        },
        schedulingResult,
        currentContext: {
            caseStatus: input.caseContext.status,
            lifecycleStatus: input.caseContext.lifecycleStatus,
            humanOwnerActive: input.caseContext.humanOwnerActive,
            aiBlocked: input.caseContext.aiBlocked,
            requiresHuman: input.caseContext.requiresHuman,
            opportunityStatus: input.commercialContext.opportunityStatus,
            opportunityStage: input.commercialContext.opportunityStage,
            opportunityStageChangedAt: input.commercialContext.opportunityStageChangedAt,
            policyStatus: "allowed",
            lastInboundAt: input.commercialContext.lastInboundAt,
            lastOutboundAt: input.commercialContext.lastOutboundAt,
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
}
function buildDescriptors(input) {
    const descriptors = [
        {
            stage: "context",
            eventType: "loop_started",
            entityType: "runtime",
            entityId: input.autonomousInput.correlationId,
            status: "started",
            reason: null,
            metadata: {
                mode: input.autonomousInput.mode,
                tenantId: input.autonomousInput.tenantId,
                correlationId: input.autonomousInput.correlationId,
                waId: (0, constants_1.maskAutonomousLoopWaId)(input.autonomousInput.inbound.waId)
            }
        },
        {
            stage: "operational_loop",
            eventType: "operational_loop_completed",
            entityType: "opportunity",
            entityId: input.autonomousInput.commercialContext.opportunityKey ?? input.autonomousInput.correlationId,
            status: input.opportunity && typeof input.opportunity === "object" && input.opportunity !== null && "status" in input.opportunity ? String(input.opportunity.status ?? "unknown") : "unknown",
            reason: null,
            metadata: {
                warnings: input.warnings
            }
        }
    ];
    if (input.action) {
        descriptors.push({
            stage: "action",
            eventType: "action_built",
            entityType: "action",
            entityId: input.action.actionId,
            status: input.action.status,
            reason: input.action.blockReasons[0] ?? input.action.cancelReason ?? null,
            metadata: {
                actionType: input.action.actionType,
                riskLevel: input.action.riskLevel,
                approvalRequirement: input.action.approvalRequirement
            }
        });
    }
    if (input.sandboxEvaluation) {
        descriptors.push({
            stage: "sandbox",
            eventType: "sandbox_evaluated",
            entityType: "action",
            entityId: input.action?.actionId ?? null,
            status: input.action?.status ?? "unknown",
            reason: null,
            metadata: {
                sandboxStatus: input.sandboxEvaluation.status ?? "unknown"
            }
        });
    }
    if (input.executionGateResult) {
        descriptors.push({
            stage: "execution_gate",
            eventType: "execution_gate_evaluated",
            entityType: "action",
            entityId: input.action?.actionId ?? null,
            status: input.executionGateResult.status,
            reason: input.executionGateResult.blockReasons[0] ?? null,
            metadata: {
                blockReasons: input.executionGateResult.blockReasons
            }
        });
    }
    if (input.outboxCommand) {
        descriptors.push({
            stage: "outbox",
            eventType: "outbox_created",
            entityType: "outbox",
            entityId: input.outboxRecord?.rowId ? String(input.outboxRecord.rowId) : input.outboxCommand.commandId,
            status: input.outboxRecord?.status ?? "pending",
            reason: null,
            metadata: {
                commandId: input.outboxCommand.commandId
            }
        });
    }
    if (input.workerResult) {
        descriptors.push({
            stage: "worker",
            eventType: "outbox_processed",
            entityType: "delivery",
            entityId: input.outboxRecord?.rowId ? String(input.outboxRecord.rowId) : input.outboxCommand?.commandId ?? null,
            status: input.workerResult.status,
            reason: input.workerResult.transportResult?.errorCode ?? null,
            metadata: {
                providerMessageId: input.workerResult.transportResult?.providerMessageId ?? null
            }
        });
    }
    if (input.transportResult) {
        descriptors.push({
            stage: "transport",
            eventType: "delivery_reconciled",
            entityType: "delivery",
            entityId: input.outboxRecord?.rowId ? String(input.outboxRecord.rowId) : input.outboxCommand?.commandId ?? null,
            status: input.transportResult.status,
            reason: input.transportResult.errorCode,
            metadata: {
                providerMessageId: input.transportResult.providerMessageId
            }
        });
    }
    if (input.schedulingResult) {
        descriptors.push({
            stage: "follow_up_scheduling",
            eventType: "follow_up_evaluated",
            entityType: "follow_up",
            entityId: input.action?.actionId ?? null,
            status: input.schedulingResult.decision,
            reason: input.schedulingResult.reasons[0] ?? null,
            metadata: {
                nextScheduledFor: input.schedulingResult.nextScheduledFor,
                reasons: input.schedulingResult.reasons
            }
        });
    }
    if (input.mutationPlan) {
        descriptors.push({
            stage: "follow_up_replanning",
            eventType: "follow_up_mutated",
            entityType: "follow_up",
            entityId: input.action?.actionId ?? null,
            status: input.mutationPlan.planType,
            reason: input.mutationPlan.reasons[0] ?? null,
            metadata: {
                planId: input.mutationPlan.planId,
                replacementActionId: input.mutationPlan.replacementActionId
            }
        });
    }
    if (input.mutationApplyResult) {
        descriptors.push({
            stage: "follow_up_replanning",
            eventType: "runtime_state_applied",
            entityType: "runtime",
            entityId: input.autonomousInput.correlationId,
            status: input.mutationApplyResult.applied ? "applied" : "rolled_back",
            reason: input.mutationApplyResult.error,
            metadata: {
                appliedOperationCount: input.mutationApplyResult.appliedOperationCount,
                duplicate: input.mutationApplyResult.duplicate,
                conflict: input.mutationApplyResult.conflict,
                rolledBack: input.mutationApplyResult.rolledBack
            }
        });
    }
    descriptors.push({
        stage: input.stage,
        eventType: "loop_completed",
        entityType: "runtime",
        entityId: input.autonomousInput.correlationId,
        status: input.reconciliation.deliveryStatus ?? "completed",
        reason: input.reconciliation.deliveryStatus,
        metadata: {
            actionStatusBefore: input.reconciliation.actionStatusBefore,
            actionStatusAfter: input.reconciliation.actionStatusAfter,
            deliveryStatus: input.reconciliation.deliveryStatus,
            providerMessageId: input.reconciliation.providerMessageId,
            followUpRequired: input.reconciliation.followUpRequired
        }
    });
    return descriptors;
}
function buildResult(input) {
    const auditTrail = (0, buildAutonomousAuditTrail_1.buildAutonomousAuditTrail)({
        runId: input.runId,
        createdAt: input.completedAt,
        descriptors: buildDescriptors({
            runId: input.runId,
            stage: input.finalStage,
            autonomousInput: input.autonomousInput,
            opportunity: input.opportunity,
            decision: input.decision,
            action: input.action,
            sandboxEvaluation: input.sandboxEvaluation,
            executionGateResult: input.executionGateResult,
            outboxCommand: input.outboxCommand,
            outboxRecord: input.outboxRecord,
            workerResult: input.workerResult,
            transportResult: input.transportResult,
            schedulingResult: input.schedulingResult,
            mutationPlan: input.mutationPlan,
            mutationApplyResult: input.mutationApplyResult,
            reconciliation: input.reconciliation,
            warnings: input.warnings
        })
    });
    return {
        runId: input.runId,
        correlationId: input.autonomousInput.correlationId,
        tenantId: input.autonomousInput.tenantId,
        mode: input.mode,
        status: input.status,
        finalStage: input.finalStage,
        opportunity: input.opportunity,
        decision: input.decision,
        action: input.action,
        sandboxEvaluation: input.sandboxEvaluation,
        executionGateResult: input.executionGateResult,
        outbox: {
            command: input.outboxCommand,
            record: input.outboxRecord,
            workerResult: input.workerResult,
            transportResult: input.transportResult
        },
        followUp: {
            schedulingResult: input.schedulingResult,
            mutationPlan: input.mutationPlan,
            mutationApplyResult: input.mutationApplyResult
        },
        reconciliation: input.reconciliation,
        auditTrail,
        warnings: uniqueStrings(input.warnings),
        errors: input.errors,
        sideEffects: input.sideEffects,
        startedAt: input.startedAt,
        completedAt: input.completedAt
    };
}
function noOpResult(input) {
    return buildResult({
        runId: input.runId,
        autonomousInput: input.autonomousInput,
        mode: input.mode,
        status: input.status,
        finalStage: input.finalStage,
        opportunity: null,
        decision: null,
        action: null,
        sandboxEvaluation: null,
        executionGateResult: null,
        outboxCommand: null,
        outboxRecord: null,
        workerResult: null,
        transportResult: null,
        schedulingResult: null,
        mutationPlan: null,
        mutationApplyResult: null,
        reconciliation: {
            actionStatusBefore: null,
            actionStatusAfter: null,
            deliveryStatus: null,
            providerMessageId: null,
            followUpRequired: false
        },
        warnings: input.warnings,
        errors: input.errors,
        sideEffects: {
            realDatabaseWritten: false,
            realOutboxWritten: false,
            realMessageSent: false,
            metaCalled: false,
            schedulerTriggered: false,
            inMemoryStateChanged: false,
            fakeTransportCalled: false
        },
        startedAt: input.startedAt,
        completedAt: input.completedAt
    });
}
function immediateTransportConfig(input) {
    const context = (0, buildAutonomousLoopContext_1.buildAutonomousLoopContext)(input, (0, inMemoryAutonomousRuntime_1.createEmptyAutonomousLoopRuntimeSnapshot)());
    return context.transportConfig;
}
function buildFollowUpStage(input, action) {
    const schedulingInput = buildFollowUpSchedulingInput(input, action);
    const schedulingResult = (0, follow_up_scheduling_1.evaluateFollowUpSchedule)(schedulingInput);
    const followUpInput = buildFollowUpInput(input, action, schedulingResult);
    const mutationPlan = (0, follow_up_replanning_1.buildFollowUpMutationPlan)(followUpInput);
    const mutationApplyResult = (0, follow_up_replanning_1.applyFollowUpMutationPlanInMemory)(buildFollowUpState(action), mutationPlan);
    return { followUpInput, schedulingResult, mutationPlan, mutationApplyResult };
}
function buildFollowUpOutcomeStatus(decision) {
    switch (decision) {
        case "ready":
        case "replan":
            return "waiting";
        case "cancel":
            return "cancelled";
        case "expire":
            return "expired";
        case "block":
            return "blocked";
        case "invalid":
            return "invalid";
        default:
            return "waiting";
    }
}
function buildImmediateResult(input) {
    return buildResult({
        runId: input.runId,
        autonomousInput: input.autonomousInput,
        mode: input.mode,
        status: input.status,
        finalStage: input.finalStage,
        opportunity: input.opportunity,
        decision: input.decision,
        action: input.action,
        sandboxEvaluation: input.sandboxEvaluation,
        executionGateResult: input.executionGateResult,
        outboxCommand: input.outboxCommand,
        outboxRecord: input.outboxRecord,
        workerResult: input.workerResult,
        transportResult: input.transportResult,
        schedulingResult: null,
        mutationPlan: null,
        mutationApplyResult: null,
        reconciliation: input.reconciliation,
        warnings: input.warnings,
        errors: input.errors,
        sideEffects: input.sideEffects,
        startedAt: input.startedAt,
        completedAt: input.completedAt
    });
}
function buildDuplicateInboundResult(input, runId, startedAt) {
    return noOpResult({
        runId,
        autonomousInput: input,
        mode: input.mode,
        status: "completed",
        finalStage: "complete",
        warnings: ["duplicate_inbound"],
        errors: [],
        startedAt,
        completedAt: startedAt
    });
}
function buildInvalidResult(input, runId, startedAt, error) {
    return noOpResult({
        runId,
        autonomousInput: input,
        mode: input.mode,
        status: "invalid",
        finalStage: "context",
        warnings: [error.code],
        errors: [error],
        startedAt,
        completedAt: startedAt
    });
}
async function evaluateAutonomousLoop(input, snapshot = (0, inMemoryAutonomousRuntime_1.createEmptyAutonomousLoopRuntimeSnapshot)()) {
    const runId = (0, constants_1.buildAutonomousLoopRunId)({
        tenantId: input.tenantId,
        correlationId: input.correlationId,
        messageId: input.inbound.messageId,
        now: input.now
    });
    const startedAt = input.now;
    const validationError = validateInput(input);
    if (validationError) {
        return buildInvalidResult(input, runId, startedAt, validationError);
    }
    const normalizedSnapshot = getSnapshotOrEmpty(snapshot);
    const duplicate = normalizedSnapshot.processedCorrelationIds.includes(input.correlationId) || normalizedSnapshot.processedProviderMessageIds.includes(input.inbound.providerMessageId ?? input.inbound.messageId);
    if (duplicate) {
        return buildDuplicateInboundResult(input, runId, startedAt);
    }
    const context = (0, buildAutonomousLoopContext_1.buildAutonomousLoopContext)(input, normalizedSnapshot);
    const operationalResult = await (0, operational_loop_1.runCommercialOperationalLoop)(context.operationalLoopInput);
    const action = buildAction(input, operationalResult);
    const warnings = uniqueStrings([
        ...(operationalResult.warnings ?? []),
        ...(action?.blockReasons ?? []),
        ...(operationalResult.selectedNextAction?.blockedReasons ?? [])
    ]);
    const caseStatus = (input.caseContext.status ?? "").trim().toLowerCase();
    const lifecycleStatus = (input.caseContext.lifecycleStatus ?? "").trim().toLowerCase();
    const opportunityStatus = (input.commercialContext.opportunityStatus ?? "").trim().toLowerCase();
    if (["closed", "resolved", "cancelled", "archived"].includes(caseStatus) || ["closed", "resolved", "cancelled", "archived"].includes(lifecycleStatus)) {
        return buildResult({
            runId,
            autonomousInput: input,
            mode: input.mode,
            status: "cancelled",
            finalStage: "action",
            opportunity: operationalResult.resultingState,
            decision: operationalResult.selectedNextAction,
            action,
            sandboxEvaluation: null,
            executionGateResult: null,
            outboxCommand: null,
            outboxRecord: null,
            workerResult: null,
            transportResult: null,
            schedulingResult: null,
            mutationPlan: null,
            mutationApplyResult: null,
            reconciliation: {
                actionStatusBefore: action?.status ?? null,
                actionStatusAfter: "cancelled",
                deliveryStatus: null,
                providerMessageId: null,
                followUpRequired: false
            },
            warnings,
            errors: [],
            sideEffects: {
                realDatabaseWritten: false,
                realOutboxWritten: false,
                realMessageSent: false,
                metaCalled: false,
                schedulerTriggered: false,
                inMemoryStateChanged: false,
                fakeTransportCalled: false
            },
            startedAt,
            completedAt: input.now
        });
    }
    if (opportunityStatus === "won" || opportunityStatus === "lost") {
        return buildResult({
            runId,
            autonomousInput: input,
            mode: input.mode,
            status: "cancelled",
            finalStage: "action",
            opportunity: operationalResult.resultingState,
            decision: operationalResult.selectedNextAction,
            action,
            sandboxEvaluation: null,
            executionGateResult: null,
            outboxCommand: null,
            outboxRecord: null,
            workerResult: null,
            transportResult: null,
            schedulingResult: null,
            mutationPlan: null,
            mutationApplyResult: null,
            reconciliation: {
                actionStatusBefore: action?.status ?? null,
                actionStatusAfter: "cancelled",
                deliveryStatus: null,
                providerMessageId: null,
                followUpRequired: false
            },
            warnings,
            errors: [],
            sideEffects: {
                realDatabaseWritten: false,
                realOutboxWritten: false,
                realMessageSent: false,
                metaCalled: false,
                schedulerTriggered: false,
                inMemoryStateChanged: false,
                fakeTransportCalled: false
            },
            startedAt,
            completedAt: input.now
        });
    }
    if (opportunityStatus === "paused") {
        return buildResult({
            runId,
            autonomousInput: input,
            mode: input.mode,
            status: "blocked",
            finalStage: "action",
            opportunity: operationalResult.resultingState,
            decision: operationalResult.selectedNextAction,
            action,
            sandboxEvaluation: null,
            executionGateResult: null,
            outboxCommand: null,
            outboxRecord: null,
            workerResult: null,
            transportResult: null,
            schedulingResult: null,
            mutationPlan: null,
            mutationApplyResult: null,
            reconciliation: {
                actionStatusBefore: action?.status ?? null,
                actionStatusAfter: action?.status ?? null,
                deliveryStatus: null,
                providerMessageId: null,
                followUpRequired: false
            },
            warnings,
            errors: [],
            sideEffects: {
                realDatabaseWritten: false,
                realOutboxWritten: false,
                realMessageSent: false,
                metaCalled: false,
                schedulerTriggered: false,
                inMemoryStateChanged: false,
                fakeTransportCalled: false
            },
            startedAt,
            completedAt: input.now
        });
    }
    if (!action || action.actionType === "no_action") {
        return buildResult({
            runId,
            autonomousInput: input,
            mode: input.mode,
            status: "completed",
            finalStage: "decision",
            opportunity: operationalResult.resultingState,
            decision: operationalResult.selectedNextAction,
            action,
            sandboxEvaluation: null,
            executionGateResult: null,
            outboxCommand: null,
            outboxRecord: null,
            workerResult: null,
            transportResult: null,
            schedulingResult: null,
            mutationPlan: null,
            mutationApplyResult: null,
            reconciliation: {
                actionStatusBefore: action?.status ?? null,
                actionStatusAfter: action?.status ?? null,
                deliveryStatus: null,
                providerMessageId: null,
                followUpRequired: false
            },
            warnings,
            errors: [],
            sideEffects: {
                realDatabaseWritten: false,
                realOutboxWritten: false,
                realMessageSent: false,
                metaCalled: false,
                schedulerTriggered: false,
                inMemoryStateChanged: false,
                fakeTransportCalled: false
            },
            startedAt,
            completedAt: input.now
        });
    }
    if (input.caseContext.aiBlocked) {
        return buildResult({
            runId,
            autonomousInput: input,
            mode: input.mode,
            status: "blocked",
            finalStage: "action",
            opportunity: operationalResult.resultingState,
            decision: operationalResult.selectedNextAction,
            action,
            sandboxEvaluation: null,
            executionGateResult: null,
            outboxCommand: null,
            outboxRecord: null,
            workerResult: null,
            transportResult: null,
            schedulingResult: null,
            mutationPlan: null,
            mutationApplyResult: null,
            reconciliation: {
                actionStatusBefore: action.status,
                actionStatusAfter: action.status,
                deliveryStatus: null,
                providerMessageId: null,
                followUpRequired: false
            },
            warnings,
            errors: [],
            sideEffects: {
                realDatabaseWritten: false,
                realOutboxWritten: false,
                realMessageSent: false,
                metaCalled: false,
                schedulerTriggered: false,
                inMemoryStateChanged: false,
                fakeTransportCalled: false
            },
            startedAt,
            completedAt: input.now
        });
    }
    if (action.actionType === "take_over_case" || input.caseContext.humanOwnerActive || input.caseContext.requiresHuman) {
        return buildResult({
            runId,
            autonomousInput: input,
            mode: input.mode,
            status: "requires_human",
            finalStage: "action",
            opportunity: operationalResult.resultingState,
            decision: operationalResult.selectedNextAction,
            action,
            sandboxEvaluation: null,
            executionGateResult: null,
            outboxCommand: null,
            outboxRecord: null,
            workerResult: null,
            transportResult: null,
            schedulingResult: null,
            mutationPlan: null,
            mutationApplyResult: null,
            reconciliation: {
                actionStatusBefore: action.status,
                actionStatusAfter: action.status,
                deliveryStatus: null,
                providerMessageId: null,
                followUpRequired: false
            },
            warnings,
            errors: [],
            sideEffects: {
                realDatabaseWritten: false,
                realOutboxWritten: false,
                realMessageSent: false,
                metaCalled: false,
                schedulerTriggered: false,
                inMemoryStateChanged: false,
                fakeTransportCalled: false
            },
            startedAt,
            completedAt: input.now
        });
    }
    if (FOLLOW_UP_ACTION_TYPES.has(action.actionType)) {
        const { schedulingResult, mutationPlan, mutationApplyResult } = buildFollowUpStage(input, action);
        const status = buildFollowUpOutcomeStatus(schedulingResult.decision);
        return buildResult({
            runId,
            autonomousInput: input,
            mode: input.mode,
            status,
            finalStage: "follow_up_replanning",
            opportunity: operationalResult.resultingState,
            decision: operationalResult.selectedNextAction,
            action,
            sandboxEvaluation: null,
            executionGateResult: null,
            outboxCommand: null,
            outboxRecord: null,
            workerResult: null,
            transportResult: null,
            schedulingResult,
            mutationPlan,
            mutationApplyResult,
            reconciliation: {
                actionStatusBefore: action.status,
                actionStatusAfter: mutationApplyResult.nextState.actions[0]?.status ?? action.status,
                deliveryStatus: null,
                providerMessageId: null,
                followUpRequired: false
            },
            warnings: uniqueStrings([...warnings, ...schedulingResult.warnings, ...mutationPlan.warnings]),
            errors: [],
            sideEffects: {
                realDatabaseWritten: false,
                realOutboxWritten: false,
                realMessageSent: false,
                metaCalled: false,
                schedulerTriggered: false,
                inMemoryStateChanged: input.mode === "execute_fake" && mutationApplyResult.applied,
                fakeTransportCalled: false
            },
            startedAt,
            completedAt: input.now
        });
    }
    const sandboxEvaluation = (0, autonomy_sandbox_1.evaluateAgentActionForSandbox)(action, context.sandboxContext, context.sandboxConfig);
    const executionGateResult = (0, execution_gate_1.evaluateExecutionGate)({
        now: input.now,
        config: context.executionGateConfig,
        action,
        context: {
            caseId: input.caseContext.caseId === null ? null : String(input.caseContext.caseId),
            caseStatus: input.caseContext.status,
            lifecycleStatus: input.caseContext.lifecycleStatus,
            humanOwnerActive: input.caseContext.humanOwnerActive,
            aiBlocked: input.caseContext.aiBlocked,
            requiresHuman: input.caseContext.requiresHuman,
            policyStatus: action.policyStatus,
            conflictingActionExists: false
        },
        sandboxEvaluation
    });
    const outboxCommand = executionGateResult.allowed && IMMEDIATE_ACTION_TYPES.has(action.actionType) ? (0, execution_gate_1.buildOutboxCommand)({ action, evaluatedAt: input.now }) : null;
    return buildImmediateResult({
        runId,
        autonomousInput: input,
        mode: input.mode,
        status: input.mode === "observe" ? (sandboxEvaluation.eligible ? "completed" : "blocked") : executionGateResult.allowed ? "waiting" : executionGateResult.status === "invalid" ? "invalid" : "blocked",
        finalStage: input.mode === "observe" ? "sandbox" : "execution_gate",
        opportunity: operationalResult.resultingState,
        decision: operationalResult.selectedNextAction,
        action,
        sandboxEvaluation,
        executionGateResult,
        outboxCommand,
        outboxRecord: null,
        workerResult: null,
        transportResult: null,
        reconciliation: {
            actionStatusBefore: action.status,
            actionStatusAfter: action.status,
            deliveryStatus: null,
            providerMessageId: null,
            followUpRequired: false
        },
        warnings,
        errors: [],
        sideEffects: {
            realDatabaseWritten: false,
            realOutboxWritten: false,
            realMessageSent: false,
            metaCalled: false,
            schedulerTriggered: false,
            inMemoryStateChanged: false,
            fakeTransportCalled: false
        },
        startedAt,
        completedAt: input.now
    });
}
function buildSandboxInput(action, input) {
    return {
        now: input.now,
        caseId: input.caseContext.caseId === null ? null : String(input.caseContext.caseId),
        caseStatus: input.caseContext.status,
        lifecycleStatus: input.caseContext.lifecycleStatus,
        humanOwnerActive: input.caseContext.humanOwnerActive,
        aiBlocked: input.caseContext.aiBlocked,
        requiresHuman: input.caseContext.requiresHuman,
        policyStatus: action.policyStatus,
        conflictingActionExists: false
    };
}
function buildFakeTransportScenario(value) {
    switch (value) {
        case "accepted":
            return "accepted";
        case "temporary_failure":
            return "network_error";
        case "permanent_failure":
            return "policy_rejected";
        case "rate_limited":
            return "rate_limited";
        case "timeout":
            return "timeout";
        case "duplicate_accepted":
            return "duplicate_accepted";
        default:
            return "accepted";
    }
}
function buildTransportResultFromWorker(input, action, transportConfig = immediateTransportConfig(input)) {
    const outboxCommand = (0, execution_gate_1.buildOutboxCommand)({ action, evaluatedAt: input.now });
    const outboxRecord = {
        rowId: `outbox:${outboxCommand.commandId}`,
        commandId: outboxCommand.commandId,
        idempotencyKey: outboxCommand.idempotencyKey,
        actionId: outboxCommand.actionId,
        channel: outboxCommand.channel,
        commandType: outboxCommand.commandType,
        recipient: outboxCommand.recipient,
        messageText: outboxCommand.messageText,
        status: "pending",
        attemptCount: 0,
        maxAttempts: 3,
        availableAt: input.now,
        expiresAt: action.expiresAt,
        claimedBy: null,
        claimedAt: null,
        leaseExpiresAt: null,
        lastAttemptAt: null,
        deliveredAt: null,
        providerMessageId: null,
        lastErrorCode: null,
        lastErrorMessageSafe: null,
        metadata: {
            source: "ai_sdr",
            sandbox: true,
            riskLevel: action.riskLevel,
            approvalRequirement: action.approvalRequirement
        },
        createdAt: input.now,
        updatedAt: input.now
    };
    const fakeClient = new whatsapp_transport_1.FakeWhatsAppHttpClient({
        explicitRetryAfterSeconds: 30,
        scenarioByIdempotencyKey: {
            [outboxCommand.idempotencyKey]: buildFakeTransportScenario(input.scenario.transportScenario)
        }
    });
    const transport = new whatsapp_transport_1.WhatsAppMessageTransport({ config: transportConfig, client: fakeClient });
    return { outboxCommand, outboxRecord, transport };
}
async function evaluateAutonomousLoopPreview(input, snapshot) {
    return evaluateAutonomousLoop(input, snapshot ?? undefined);
}
async function evaluateImmediateTransportResult(input, action) {
    const { outboxCommand, outboxRecord, transport } = buildTransportResultFromWorker(input, action);
    const workerResult = await (0, outbox_worker_1.processOutboxMessage)({
        now: input.now,
        record: outboxRecord,
        config: (0, buildAutonomousLoopContext_1.buildAutonomousLoopContext)(input, (0, inMemoryAutonomousRuntime_1.createEmptyAutonomousLoopRuntimeSnapshot)()).outboxConfig
    }, { transport });
    return {
        outboxCommand,
        outboxRecord,
        workerResult,
        transportResult: workerResult.transportResult
    };
}

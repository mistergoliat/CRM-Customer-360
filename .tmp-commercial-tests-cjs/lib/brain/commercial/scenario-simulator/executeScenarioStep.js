"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeScenarioStep = executeScenarioStep;
const follow_up_replanning_1 = require("../follow-up-replanning");
const follow_up_scheduling_1 = require("../follow-up-scheduling");
const autonomous_loop_1 = require("../autonomous-loop");
const constants_1 = require("./constants");
const compareScenarioExpectation_1 = require("./compareScenarioExpectation");
const validateScenarioInvariants_1 = require("./validateScenarioInvariants");
function cloneSnapshot(value) {
    return structuredClone(value);
}
function asText(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function asId(value) {
    if (typeof value === "string" || typeof value === "number")
        return value;
    return null;
}
function getActionSource(action) {
    return typeof action.source === "object" && action.source !== null && !Array.isArray(action.source) ? action.source : null;
}
function mapFollowUpActionToRuntime(action) {
    return {
        actionId: String(action.actionId ?? ""),
        status: String(action.status ?? "planned"),
        createdAt: String(action.createdAt ?? ""),
        updatedAt: action.updatedAt === null || action.updatedAt === undefined ? null : String(action.updatedAt),
        source: action
    };
}
function mapRuntimeActionToMemoryAction(action) {
    const source = getActionSource(action) ?? {};
    return {
        rowId: null,
        actionId: String(source.actionId ?? action.actionId),
        idempotencyKey: typeof source.idempotencyKey === "string" ? source.idempotencyKey : null,
        actionType: String(source.actionType ?? "schedule_followup"),
        status: String(source.status ?? action.status ?? "planned"),
        scheduledFor: source.scheduledFor === null || source.scheduledFor === undefined ? null : String(source.scheduledFor),
        expiresAt: source.expiresAt === null || source.expiresAt === undefined ? null : String(source.expiresAt),
        attemptCount: Number(source.attemptCount ?? 0),
        maxAttempts: Number(source.maxAttempts ?? 3),
        riskLevel: String(source.riskLevel ?? "low"),
        approvalRequirement: String(source.approvalRequirement ?? "none"),
        opportunityId: asId(source.opportunityId),
        conversationCaseId: asId(source.conversationCaseId),
        waId: source.waId === null || source.waId === undefined ? null : String(source.waId),
        draftMessage: source.draftMessage === null || source.draftMessage === undefined ? null : String(source.draftMessage),
        finalMessage: source.finalMessage === null || source.finalMessage === undefined ? null : String(source.finalMessage),
        blockReasons: Array.isArray(source.blockReasons) ? source.blockReasons.map((item) => String(item)) : [],
        cancelReason: source.cancelReason === null || source.cancelReason === undefined ? null : String(source.cancelReason),
        supersededByActionId: source.supersededByActionId === null || source.supersededByActionId === undefined ? null : String(source.supersededByActionId),
        parentActionId: source.parentActionId === null || source.parentActionId === undefined ? null : String(source.parentActionId),
        generation: typeof source.generation === "number" ? source.generation : null,
        lifecycleVersion: source.lifecycleVersion === null || source.lifecycleVersion === undefined ? null : String(source.lifecycleVersion),
        policyVersion: source.policyVersion === null || source.policyVersion === undefined ? null : String(source.policyVersion),
        runtimeVersion: source.runtimeVersion === null || source.runtimeVersion === undefined ? null : String(source.runtimeVersion),
        createdAt: String(source.createdAt ?? action.createdAt),
        updatedAt: source.updatedAt === null || source.updatedAt === undefined ? null : String(source.updatedAt)
    };
}
function buildStateDiff(previousSnapshot, nextSnapshot) {
    const previousOpportunities = new Map(previousSnapshot.opportunities.map((item) => [String(item.opportunityKey ?? item.opportunityId ?? ""), item]));
    const nextOpportunities = new Map(nextSnapshot.opportunities.map((item) => [String(item.opportunityKey ?? item.opportunityId ?? ""), item]));
    const previousDecisions = new Map(previousSnapshot.decisions.map((item) => [String(item.decisionId ?? ""), item]));
    const nextDecisions = new Map(nextSnapshot.decisions.map((item) => [String(item.decisionId ?? ""), item]));
    const previousActions = new Map(previousSnapshot.actions.map((item) => [String(item.actionId ?? ""), item]));
    const nextActions = new Map(nextSnapshot.actions.map((item) => [String(item.actionId ?? ""), item]));
    const previousOutbox = new Map(previousSnapshot.outbox.map((item) => [String(item.rowId ?? item.commandId ?? ""), item]));
    const nextOutbox = new Map(nextSnapshot.outbox.map((item) => [String(item.rowId ?? item.commandId ?? ""), item]));
    return {
        opportunities: {
            added: [...nextOpportunities.keys()].filter((key) => !previousOpportunities.has(key)),
            updated: [...nextOpportunities.keys()].filter((key) => {
                const prev = previousOpportunities.get(key);
                const next = nextOpportunities.get(key);
                return Boolean(prev && next && (prev.status !== next.status || prev.stage !== next.stage));
            }),
            removed: [...previousOpportunities.keys()].filter((key) => !nextOpportunities.has(key))
        },
        decisions: {
            added: [...nextDecisions.keys()].filter((key) => !previousDecisions.has(key))
        },
        actions: {
            added: [...nextActions.keys()].filter((key) => !previousActions.has(key)),
            updated: [...nextActions.keys()].filter((key) => {
                const prev = previousActions.get(key);
                const next = nextActions.get(key);
                return Boolean(prev && next && prev.status !== next.status);
            }),
            removed: [...previousActions.keys()].filter((key) => !nextActions.has(key))
        },
        outbox: {
            added: [...nextOutbox.entries()]
                .filter(([key]) => !previousOutbox.has(key))
                .map(([id, value]) => ({ id, status: String(value.status ?? "") })),
            updated: [...nextOutbox.entries()]
                .filter(([key]) => {
                const prev = previousOutbox.get(key);
                const next = nextOutbox.get(key);
                return Boolean(prev && next && prev.status !== next.status);
            })
                .map(([id, value]) => {
                const previous = previousOutbox.get(id);
                return {
                    id,
                    fromStatus: String(previous?.status ?? ""),
                    toStatus: String(value.status ?? "")
                };
            })
        },
        audit: {
            addedCount: Math.max(0, nextSnapshot.auditEvents.length - previousSnapshot.auditEvents.length)
        }
    };
}
function buildInputSummary(scenarioId, step) {
    const input = step.input;
    return {
        scenarioId,
        stepId: step.stepId,
        mode: step.mode,
        now: step.now,
        correlationId: input.correlationId,
        tenantId: input.tenantId,
        waIdMasked: (0, constants_1.maskScenarioWaId)(input.inbound.waId),
        caseId: input.caseContext.caseId,
        opportunityId: input.commercialContext.opportunityId,
        messageId: input.inbound.messageId,
        actionTypeHint: asText(input.scenario.forceActionType),
        transportScenario: input.scenario.transportScenario,
        noteCount: step.notes.length
    };
}
function findLatestFollowUpAction(snapshot) {
    for (let index = snapshot.actions.length - 1; index >= 0; index -= 1) {
        const action = snapshot.actions[index];
        const source = getActionSource(action);
        if (source && String(source.actionType ?? "") === "schedule_followup") {
            return action;
        }
    }
    return null;
}
function buildFollowUpMutationInputFromRuntime(previousSnapshot, step, sourceAction) {
    const source = getActionSource(sourceAction) ?? {};
    return {
        now: step.now,
        originalAction: {
            rowId: null,
            actionId: String(source.actionId ?? sourceAction.actionId),
            idempotencyKey: typeof source.idempotencyKey === "string" ? source.idempotencyKey : null,
            actionType: String(source.actionType ?? "schedule_followup"),
            status: String(source.status ?? sourceAction.status ?? "planned"),
            createdAt: String(source.createdAt ?? sourceAction.createdAt),
            updatedAt: source.updatedAt === null || source.updatedAt === undefined ? null : String(source.updatedAt),
            scheduledFor: source.scheduledFor === null || source.scheduledFor === undefined ? null : String(source.scheduledFor),
            expiresAt: source.expiresAt === null || source.expiresAt === undefined ? null : String(source.expiresAt),
            attemptCount: Number(source.attemptCount ?? 0),
            maxAttempts: Number(source.maxAttempts ?? 3),
            riskLevel: String(source.riskLevel ?? "low"),
            approvalRequirement: String(source.approvalRequirement ?? "none"),
            opportunityId: asId(source.opportunityId),
            conversationCaseId: asId(source.conversationCaseId),
            waId: source.waId === null || source.waId === undefined ? null : String(source.waId),
            draftMessage: source.draftMessage === null || source.draftMessage === undefined ? null : String(source.draftMessage),
            finalMessage: source.finalMessage === null || source.finalMessage === undefined ? null : String(source.finalMessage),
            blockReasons: Array.isArray(source.blockReasons) ? source.blockReasons.map((item) => String(item)) : [],
            cancelReason: source.cancelReason === null || source.cancelReason === undefined ? null : String(source.cancelReason),
            parentActionId: source.parentActionId === null || source.parentActionId === undefined ? null : String(source.parentActionId),
            supersededByActionId: source.supersededByActionId === null || source.supersededByActionId === undefined ? null : String(source.supersededByActionId),
            lifecycleVersion: source.lifecycleVersion === null || source.lifecycleVersion === undefined ? null : String(source.lifecycleVersion),
            policyVersion: source.policyVersion === null || source.policyVersion === undefined ? null : String(source.policyVersion),
            runtimeVersion: source.runtimeVersion === null || source.runtimeVersion === undefined ? null : String(source.runtimeVersion)
        },
        schedulingResult: (0, follow_up_scheduling_1.evaluateFollowUpSchedule)({
            now: step.now,
            action: {
                actionId: String(source.actionId ?? sourceAction.actionId),
                idempotencyKey: typeof source.idempotencyKey === "string" ? source.idempotencyKey : null,
                actionType: String(source.actionType ?? "schedule_followup"),
                status: String(source.status ?? sourceAction.status ?? "planned"),
                createdAt: String(source.createdAt ?? sourceAction.createdAt),
                updatedAt: source.updatedAt === null || source.updatedAt === undefined ? null : String(source.updatedAt),
                scheduledFor: source.scheduledFor === null || source.scheduledFor === undefined ? null : String(source.scheduledFor),
                expiresAt: source.expiresAt === null || source.expiresAt === undefined ? null : String(source.expiresAt),
                attemptCount: Number(source.attemptCount ?? 0),
                maxAttempts: Number(source.maxAttempts ?? 3),
                riskLevel: String(source.riskLevel ?? "low"),
                approvalRequirement: String(source.approvalRequirement ?? "none"),
                opportunityId: asId(source.opportunityId),
                conversationCaseId: asId(source.conversationCaseId),
                waId: source.waId === null || source.waId === undefined ? null : String(source.waId),
                blockReasons: Array.isArray(source.blockReasons) ? source.blockReasons.map((item) => String(item)) : [],
                cancelReason: source.cancelReason === null || source.cancelReason === undefined ? null : String(source.cancelReason)
            },
            activity: {
                lastInboundAt: step.input.commercialContext.lastInboundAt,
                lastOutboundAt: step.input.commercialContext.lastOutboundAt,
                lastHumanMessageAt: step.input.commercialContext.lastHumanMessageAt,
                lastAiMessageAt: step.input.commercialContext.lastAiMessageAt
            },
            context: {
                caseStatus: step.input.caseContext.status,
                lifecycleStatus: step.input.caseContext.lifecycleStatus,
                humanOwnerActive: step.input.caseContext.humanOwnerActive,
                aiBlocked: step.input.caseContext.aiBlocked,
                requiresHuman: step.input.caseContext.requiresHuman,
                opportunityStatus: step.input.commercialContext.opportunityStatus,
                opportunityStage: step.input.commercialContext.opportunityStage,
                opportunityStageChangedAt: step.input.commercialContext.opportunityStageChangedAt,
                policyStatus: "allowed",
                conflictingActionExists: false,
                duplicateActionExists: false
            },
            policy: {
                followUpEnabled: step.input.configuration.followUpEnabled,
                allowedActionTypes: ["schedule_followup", "send_followup_message", "request_more_context"],
                maxRiskLevel: "high",
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
        }),
        currentContext: {
            caseStatus: step.input.caseContext.status,
            lifecycleStatus: step.input.caseContext.lifecycleStatus,
            humanOwnerActive: step.input.caseContext.humanOwnerActive,
            aiBlocked: step.input.caseContext.aiBlocked,
            requiresHuman: step.input.caseContext.requiresHuman,
            opportunityStatus: step.input.commercialContext.opportunityStatus,
            opportunityStage: step.input.commercialContext.opportunityStage,
            opportunityStageChangedAt: step.input.commercialContext.opportunityStageChangedAt,
            policyStatus: "allowed",
            lastInboundAt: step.input.commercialContext.lastInboundAt,
            lastOutboundAt: step.input.commercialContext.lastOutboundAt,
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
function maybeBuildFollowUpReplay(scenarioId, step, previousSnapshot, nextSnapshot, runtime, applyMutations) {
    const existing = findLatestFollowUpAction(previousSnapshot);
    if (!existing)
        return null;
    const source = getActionSource(existing);
    if (!source)
        return null;
    const createdAt = String(source.createdAt ?? existing.createdAt);
    const triggerHuman = step.input.caseContext.humanOwnerActive;
    const triggerStageChange = Boolean(step.input.commercialContext.opportunityStageChangedAt) &&
        new Date(String(step.input.commercialContext.opportunityStageChangedAt)).getTime() > new Date(createdAt).getTime();
    const triggerCustomerReply = Boolean(step.input.commercialContext.lastInboundAt) &&
        new Date(String(step.input.commercialContext.lastInboundAt)).getTime() > new Date(createdAt).getTime();
    if (!step.replayFollowUp && !triggerHuman && !triggerStageChange && !triggerCustomerReply)
        return null;
    const input = buildFollowUpMutationInputFromRuntime(previousSnapshot, step, existing);
    const mutationPlan = (0, follow_up_replanning_1.buildFollowUpMutationPlan)(input);
    let applyResult = null;
    if (applyMutations && mutationPlan.planType !== "no_change") {
        const baseState = {
            actions: previousSnapshot.actions.map((action) => mapRuntimeActionToMemoryAction(action)),
            auditEvents: [],
            appliedPlanKeys: []
        };
        applyResult = (0, follow_up_replanning_1.applyFollowUpMutationPlanInMemory)(baseState, mutationPlan);
        if (applyResult.applied) {
            const mergedSnapshot = cloneSnapshot(nextSnapshot);
            mergedSnapshot.actions = applyResult.nextState.actions.map(mapFollowUpActionToRuntime);
            mergedSnapshot.auditEvents = [...previousSnapshot.auditEvents, ...applyResult.nextState.auditEvents];
            runtime.replaceSnapshot(mergedSnapshot);
            nextSnapshot.actions = mergedSnapshot.actions;
            nextSnapshot.auditEvents = mergedSnapshot.auditEvents;
        }
    }
    return {
        schedulingResult: input.schedulingResult,
        mutationPlan,
        applyResult
    };
}
async function executeScenarioStep(scenario, step, index, runtime, dependencies = {}) {
    const loopExecutor = dependencies.loopExecutor ?? autonomous_loop_1.executeAutonomousLoop;
    const currentStep = cloneSnapshot(step);
    if (dependencies.modeOverride) {
        currentStep.mode = dependencies.modeOverride;
    }
    currentStep.input.mode = currentStep.mode;
    const previousSnapshot = runtime.getSnapshot();
    const loopResult = await loopExecutor(currentStep.input, runtime);
    const nextSnapshot = runtime.getSnapshot();
    const followUpReplay = maybeBuildFollowUpReplay(scenario.scenarioId, currentStep, previousSnapshot, nextSnapshot, runtime, currentStep.input.mode === "execute_fake");
    const finalSnapshot = runtime.getSnapshot();
    const stateDiff = buildStateDiff(previousSnapshot, finalSnapshot);
    const expectationResults = [];
    for (const expectation of scenario.expectations.filter((item) => item.stepId === currentStep.stepId || item.stepId === null)) {
        const result = (0, compareScenarioExpectation_1.compareScenarioExpectation)(expectation, {
            stepId: currentStep.stepId,
            index,
            title: currentStep.title,
            inputSummary: buildInputSummary(scenario.scenarioId, currentStep),
            loopResult,
            previousSnapshot,
            nextSnapshot: finalSnapshot,
            stateDiff,
            expectationResults: [],
            invariantResults: [],
            followUpReplay,
            passed: false
        }, finalSnapshot);
        expectationResults.push({
            ...result,
            resultId: (0, constants_1.buildScenarioExpectationResultId)({
                runId: (0, constants_1.buildScenarioStepRunId)({
                    runId: scenario.scenarioId,
                    stepId: currentStep.stepId,
                    index,
                    now: currentStep.now
                }),
                stepId: currentStep.stepId,
                expectationId: expectation.expectationId,
                operator: expectation.operator,
                path: expectation.path
            }),
            messageSafe: (0, constants_1.sanitizeScenarioText)(result.messageSafe, 220) ?? result.messageSafe
        });
    }
    const invariantResults = (0, validateScenarioInvariants_1.validateScenarioInvariants)({
        stepId: currentStep.stepId,
        index,
        title: currentStep.title,
        inputSummary: buildInputSummary(scenario.scenarioId, currentStep),
        loopResult,
        previousSnapshot,
        nextSnapshot: finalSnapshot,
        stateDiff,
        expectationResults,
        invariantResults: [],
        followUpReplay,
        passed: false
    }, previousSnapshot, finalSnapshot, currentStep);
    const passed = loopResult.status !== "invalid" && expectationResults.every((item) => item.passed) && invariantResults.every((item) => item.passed);
    return {
        stepId: currentStep.stepId,
        index,
        title: currentStep.title,
        inputSummary: buildInputSummary(scenario.scenarioId, currentStep),
        loopResult,
        previousSnapshot,
        nextSnapshot: finalSnapshot,
        stateDiff,
        expectationResults,
        invariantResults,
        followUpReplay,
        passed
    };
}

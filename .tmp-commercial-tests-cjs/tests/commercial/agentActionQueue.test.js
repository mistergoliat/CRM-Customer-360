"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const action_queue_1 = require("../../lib/brain/commercial/action-queue");
const FIXED_TIME = "2026-06-17T12:00:00.000Z";
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
function makeFollowUpPlan(overrides = {}) {
    return {
        planId: "plan-001",
        opportunityId: "opp-001",
        decisionId: "decision-001",
        caseId: "case-001",
        messageId: "message-001",
        status: "recommended",
        intent: "quote_followup",
        channel: "whatsapp",
        recipient: "56900000001",
        scheduledFor: "2026-06-17T14:00:00.000Z",
        timezone: "America/Santiago",
        draftMessage: "Hola, te escribo para saber si aún quieres que te ayudemos con la cotización.",
        riskLevel: "medium",
        approvalRequirement: "operator_review",
        blockReasons: [],
        cancelReason: null,
        rationale: "Follow-up recommended for quote follow-up based on the current commercial state.",
        policyNotes: ["no_outbox", "no_execution"],
        attemptNumber: 1,
        maxAttempts: 3,
        idempotencyKey: "commercial-followup:test-plan-001",
        executable: false,
        persisted: false,
        createdAt: FIXED_TIME,
        ...overrides
    };
}
function makeNextAction(overrides = {}) {
    return {
        type: "respond",
        reason: "Respond to the customer with a safe draft.",
        confidence: "high",
        riskLevel: "low",
        approvalRequirement: "none",
        recommendedChannel: "whatsapp",
        draftMessage: "Hola, te ayudamos con tu consulta.",
        requiredInformation: [],
        blockedReasons: [],
        executable: false,
        ...overrides
    };
}
function makeValidAction(overrides = {}) {
    return {
        id: null,
        actionId: "crm-agent-action-001",
        idempotencyKey: "crm-agent-action:test-001",
        opportunityId: "42",
        decisionId: "decision-001",
        decisionRowId: 1,
        conversationCaseId: "case-001",
        messageId: "message-001",
        waId: "56900000001",
        channel: "whatsapp",
        actionType: "send_whatsapp_reply",
        status: "proposed",
        riskLevel: "low",
        approvalRequirement: "operator_review",
        draftPayload: {
            text: "Hola"
        },
        finalPayload: null,
        executionPayload: null,
        draftMessage: "Hola",
        finalMessage: null,
        scheduledFor: null,
        expiresAt: null,
        attemptNumber: 1,
        maxAttempts: 3,
        blockReasons: [],
        cancelReason: null,
        failureReason: null,
        policyStatus: "allowed",
        policyNotes: ["note-1"],
        source: "ai_sdr",
        createdBy: "ai",
        approvedBy: null,
        approvedAt: null,
        executedAt: null,
        cancelledAt: null,
        outboxMessageId: null,
        lifecycleVersion: "brain.commercial.action-queue.v1",
        policyVersion: "policy-v1",
        runtimeVersion: "runtime-v1",
        createdAt: FIXED_TIME,
        updatedAt: null,
        ...overrides
    };
}
function createMockAdapter(initialRows = []) {
    const rowsByIdempotencyKey = new Map();
    for (const row of initialRows) {
        const key = typeof row.idempotency_key === "string" ? row.idempotency_key : "";
        if (key)
            rowsByIdempotencyKey.set(key, row);
    }
    let insertCount = 0;
    let updateCount = 0;
    let beginCount = 0;
    let commitCount = 0;
    let rollbackCount = 0;
    const executedSql = [];
    const connection = {
        async execute(sql, params) {
            executedSql.push(sql);
            const normalizedSql = sql.trim().toLowerCase();
            if (normalizedSql.startsWith("select * from crm_agent_actions where idempotency_key")) {
                const key = String(params?.[0] ?? "");
                const row = rowsByIdempotencyKey.get(key);
                return [[row ? { ...row } : undefined].filter(Boolean), []];
            }
            if (normalizedSql.startsWith("insert into crm_agent_actions")) {
                insertCount += 1;
                const nextId = insertCount;
                const key = String(params?.[1] ?? "");
                rowsByIdempotencyKey.set(key, {
                    id: nextId,
                    action_id: String(params?.[0] ?? ""),
                    idempotency_key: key,
                    status: String(params?.[10] ?? "proposed"),
                    wa_id: String(params?.[7] ?? ""),
                    created_at: String(params?.[37] ?? FIXED_TIME),
                    updated_at: String(params?.[38] ?? FIXED_TIME)
                });
                return [{ insertId: nextId }, []];
            }
            if (normalizedSql.startsWith("update crm_agent_actions")) {
                updateCount += 1;
                const key = String(params?.[params.length - 1] ?? "");
                const row = rowsByIdempotencyKey.get(key);
                if (row) {
                    rowsByIdempotencyKey.set(key, {
                        ...row,
                        status: String(params?.[8] ?? row.status),
                        updated_at: String(params?.[35] ?? FIXED_TIME)
                    });
                }
                return [{ affectedRows: 1 }, []];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        },
        async beginTransaction() {
            beginCount += 1;
        },
        async commit() {
            commitCount += 1;
        },
        async rollback() {
            rollbackCount += 1;
        }
    };
    const adapter = {
        async hasTable(tableName) {
            return tableName === "crm_agent_actions";
        },
        async queryRows(sql, params) {
            executedSql.push(sql);
            const normalizedSql = sql.trim().toLowerCase();
            if (normalizedSql.includes("from crm_agent_actions")) {
                const rows = [...rowsByIdempotencyKey.values()];
                if (!params || params.length === 0)
                    return rows;
                const opportunityId = params.find((value) => value !== null && value !== undefined) ?? null;
                if (opportunityId !== null) {
                    return rows.filter((row) => row.opportunity_id === opportunityId || row.conversation_case_id === opportunityId || row.wa_id === opportunityId);
                }
                return rows;
            }
            return [];
        },
        async withConnection(fn) {
            return fn(connection);
        }
    };
    return {
        adapter,
        connection,
        rowsByIdempotencyKey,
        counts: {
            get insertCount() {
                return insertCount;
            },
            get updateCount() {
                return updateCount;
            },
            get beginCount() {
                return beginCount;
            },
            get commitCount() {
                return commitCount;
            },
            get rollbackCount() {
                return rollbackCount;
            },
            executedSql
        }
    };
}
(0, node_test_1.default)("builds action from a follow-up plan", () => {
    const action = (0, action_queue_1.buildAgentActionFromFollowUpPlan)({
        plan: makeFollowUpPlan(),
        context: {
            currentTime: FIXED_TIME,
            timezone: "America/Santiago",
            opportunityId: "opp-001",
            decisionId: "decision-001",
            decisionRowId: 7,
            conversationCaseId: "case-001",
            messageId: "message-001",
            waId: "56900000001",
            channel: "whatsapp",
            policyStatus: "allowed",
            policyVersion: "policy-v1",
            runtimeVersion: "runtime-v1",
            lifecycleVersion: "lifecycle-v1",
            approvedBy: null,
            approvedAt: null,
            attemptNumber: 1,
            maxAttempts: 3
        }
    });
    strict_1.default.equal(action.actionType, "schedule_followup");
    strict_1.default.equal(action.status, "requires_review");
    strict_1.default.equal(action.channel, "whatsapp");
    strict_1.default.equal("executable" in action, false);
    strict_1.default.equal((0, action_queue_1.validateAgentAction)(action).valid, true);
});
(0, node_test_1.default)("blocks a follow-up plan when it is blocked", () => {
    const action = (0, action_queue_1.buildAgentActionFromFollowUpPlan)({
        plan: makeFollowUpPlan({
            status: "blocked",
            blockReasons: ["cooldown_active"],
            approvalRequirement: "blocked",
            draftMessage: null
        }),
        context: {
            currentTime: FIXED_TIME,
            timezone: "America/Santiago",
            opportunityId: "opp-001",
            decisionId: "decision-001",
            conversationCaseId: "case-001",
            messageId: "message-001",
            waId: "56900000001",
            channel: "whatsapp"
        }
    });
    strict_1.default.equal(action.status, "blocked");
    strict_1.default.ok(action.blockReasons.includes("cooldown_active"));
    strict_1.default.equal((0, action_queue_1.validateAgentAction)(action).valid, true);
});
(0, node_test_1.default)("builds action from a next action respond recommendation", () => {
    const action = (0, action_queue_1.buildAgentActionFromNextAction)({
        nextAction: makeNextAction(),
        context: {
            currentTime: FIXED_TIME,
            timezone: "America/Santiago",
            opportunityId: "opp-001",
            decisionId: "decision-001",
            decisionRowId: 7,
            conversationCaseId: "case-001",
            messageId: "message-001",
            waId: "56900000001",
            channel: "whatsapp",
            policyStatus: "allowed",
            policyVersion: "policy-v1",
            runtimeVersion: "runtime-v1",
            lifecycleVersion: "lifecycle-v1",
            approvedBy: null,
            approvedAt: null
        }
    });
    strict_1.default.equal(action.actionType, "send_whatsapp_reply");
    strict_1.default.equal(action.status, "proposed");
    strict_1.default.equal("executable" in action, false);
});
(0, node_test_1.default)("builds action from a next action follow-up recommendation", () => {
    const action = (0, action_queue_1.buildAgentActionFromNextAction)({
        nextAction: makeNextAction({
            type: "propose_followup",
            approvalRequirement: "explicit_operator_approval",
            reason: "Please review the follow-up proposal."
        }),
        context: {
            currentTime: FIXED_TIME,
            timezone: "America/Santiago",
            opportunityId: "opp-001",
            decisionId: "decision-001",
            conversationCaseId: "case-001",
            messageId: "message-001",
            waId: "56900000001",
            channel: "whatsapp"
        }
    });
    strict_1.default.equal(action.actionType, "schedule_followup");
    strict_1.default.equal(action.status, "requires_review");
    strict_1.default.equal(action.approvalRequirement, "explicit_operator_approval");
});
(0, node_test_1.default)("requires idempotency key and valid enums", () => {
    const invalidType = (0, action_queue_1.validateAgentAction)({
        ...makeValidAction({ actionType: "unexpected" }),
        idempotencyKey: "crm-agent-action:test-002"
    });
    const invalidStatus = (0, action_queue_1.validateAgentAction)({
        ...makeValidAction({ status: "bogus" }),
        idempotencyKey: "crm-agent-action:test-003"
    });
    const missingKey = (0, action_queue_1.validateAgentAction)({
        ...makeValidAction({ idempotencyKey: "" }),
        actionId: "crm-agent-action-002"
    });
    strict_1.default.equal(invalidType.valid, false);
    strict_1.default.equal(invalidStatus.valid, false);
    strict_1.default.equal(missingKey.valid, false);
});
(0, node_test_1.default)("rejects WhatsApp actions without waId", () => {
    const result = (0, action_queue_1.validateAgentAction)({
        ...makeValidAction({
            channel: "whatsapp",
            waId: null,
            status: "proposed"
        }),
        actionId: "crm-agent-action-003",
        idempotencyKey: "crm-agent-action:test-004"
    });
    strict_1.default.equal(result.valid, false);
    strict_1.default.equal(result.code, "invalid_channel");
});
(0, node_test_1.default)("requires scheduledFor for scheduled actions", () => {
    const result = (0, action_queue_1.validateAgentAction)({
        ...makeValidAction({
            status: "scheduled",
            scheduledFor: null
        }),
        actionId: "crm-agent-action-004",
        idempotencyKey: "crm-agent-action:test-005"
    });
    strict_1.default.equal(result.valid, false);
    strict_1.default.equal(result.code, "invalid_state");
});
(0, node_test_1.default)("rejects execution status in P1K-012A", () => {
    const result = (0, action_queue_1.validateAgentAction)({
        ...makeValidAction({
            status: "executed",
            executedAt: FIXED_TIME
        }),
        actionId: "crm-agent-action-005",
        idempotencyKey: "crm-agent-action:test-006"
    });
    strict_1.default.equal(result.valid, false);
    strict_1.default.equal(result.code, "execution_not_enabled_in_p1k_012a");
});
(0, node_test_1.default)("rejects outboxMessageId before execution", () => {
    const result = (0, action_queue_1.validateAgentAction)({
        ...makeValidAction({
            outboxMessageId: 99
        }),
        actionId: "crm-agent-action-006",
        idempotencyKey: "crm-agent-action:test-007"
    });
    strict_1.default.equal(result.valid, false);
    strict_1.default.equal(result.code, "outbox_not_allowed");
});
(0, node_test_1.default)("persistence disabled returns dry_run and queue disabled returns skipped_by_flag", async () => {
    const action = makeValidAction();
    const dryRun = await (0, action_queue_1.persistAgentAction)({
        action,
        currentTime: FIXED_TIME,
        featureFlags: {
            queueEnabled: true,
            persistenceEnabled: false
        }
    });
    const skipped = await (0, action_queue_1.persistAgentAction)({
        action,
        currentTime: FIXED_TIME,
        featureFlags: {
            queueEnabled: false,
            persistenceEnabled: false
        }
    });
    strict_1.default.equal(dryRun.status, "dry_run");
    strict_1.default.equal(dryRun.dryRun, true);
    strict_1.default.equal(skipped.status, "skipped_by_flag");
    strict_1.default.equal(skipped.dryRun, true);
});
(0, node_test_1.default)("persists an action and updates the same idempotency key without duplicate insert", async () => {
    const harness = createMockAdapter();
    const action = makeValidAction();
    const first = await (0, action_queue_1.persistAgentAction)({
        action,
        currentTime: FIXED_TIME,
        featureFlags: {
            queueEnabled: true,
            persistenceEnabled: true
        },
        dataAccess: harness.adapter
    });
    const second = await (0, action_queue_1.persistAgentAction)({
        action,
        currentTime: FIXED_TIME,
        featureFlags: {
            queueEnabled: true,
            persistenceEnabled: true
        },
        dataAccess: harness.adapter
    });
    strict_1.default.equal(first.status, "inserted");
    strict_1.default.equal(second.status, "updated_existing");
    strict_1.default.equal(harness.counts.insertCount, 1);
    strict_1.default.equal(harness.counts.updateCount, 1);
    strict_1.default.equal(first.rowId, 1);
});
(0, node_test_1.default)("persist catches permission errors and fails safe", async () => {
    const result = await (0, action_queue_1.persistAgentAction)({
        action: makeValidAction(),
        currentTime: FIXED_TIME,
        featureFlags: {
            queueEnabled: true,
            persistenceEnabled: true
        },
        dataAccess: {
            async hasTable() {
                return true;
            },
            async withConnection() {
                throw new Error("Access denied for user 'pc_consultor' with password=secret token=abc");
            }
        }
    });
    strict_1.default.equal(result.status, "failed");
    strict_1.default.equal(result.error?.includes("password=secret"), false);
    strict_1.default.equal(result.error?.includes("token=abc"), false);
});
(0, node_test_1.default)("loadAgentActions degrades when the table is unavailable", async () => {
    const result = await (0, action_queue_1.loadAgentActions)({
        opportunityId: "opp-001",
        queueEnabled: true
    }, {
        async hasTable() {
            return false;
        },
        async queryRows() {
            return [];
        }
    });
    strict_1.default.equal(result.status, "unavailable");
    strict_1.default.deepEqual(result.actions, []);
});
(0, node_test_1.default)("loadAgentActions reads and validates rows from the queue", async () => {
    const harness = createMockAdapter([
        {
            id: 1,
            action_id: "crm-agent-action-001",
            idempotency_key: "crm-agent-action:test-001",
            opportunity_id: "opp-001",
            decision_id: "decision-001",
            decision_row_id: 1,
            conversation_case_id: "case-001",
            message_id: "message-001",
            wa_id: "56900000001",
            channel: "whatsapp",
            action_type: "send_whatsapp_reply",
            status: "proposed",
            risk_level: "low",
            approval_requirement: "operator_review",
            draft_payload_json: { text: "Hola" },
            final_payload_json: null,
            execution_payload_json: null,
            draft_message: "Hola",
            final_message: null,
            scheduled_for: null,
            expires_at: null,
            attempt_number: 1,
            max_attempts: 3,
            block_reasons_json: [],
            cancel_reason: null,
            failure_reason: null,
            policy_status: "allowed",
            policy_notes_json: ["note-1"],
            source: "ai_sdr",
            created_by: "ai",
            approved_by: null,
            approved_at: null,
            executed_at: null,
            cancelled_at: null,
            outbox_message_id: null,
            lifecycle_version: "brain.commercial.action-queue.v1",
            policy_version: "policy-v1",
            runtime_version: "runtime-v1",
            created_at: FIXED_TIME,
            updated_at: FIXED_TIME
        }
    ]);
    const result = await (0, action_queue_1.loadAgentActions)({
        opportunityId: "opp-001",
        status: ["proposed"],
        actionType: ["send_whatsapp_reply"],
        queueEnabled: true,
        limit: 10
    }, harness.adapter);
    strict_1.default.equal(result.status, "loaded");
    strict_1.default.equal(result.actions.length, 1);
    strict_1.default.equal(result.actions[0]?.actionId, "crm-agent-action-001");
});
(0, node_test_1.default)("sanitizes dangerous metadata and remains JSON serializable", () => {
    const action = makeValidAction({
        draftPayload: {
            token: "secret-token",
            nested: {
                __proto__: { polluted: true },
                safe: "value"
            },
            big: 10n
        }
    });
    const sanitized = (0, action_queue_1.serializeAgentAction)(action);
    strict_1.default.equal(JSON.stringify(sanitized) !== undefined, true);
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(sanitized, "token"), false);
    strict_1.default.ok(JSON.stringify(sanitized));
});
(0, node_test_1.default)("is deterministic for the same input", () => {
    const first = (0, action_queue_1.buildAgentActionFromNextAction)({
        nextAction: makeNextAction(),
        context: {
            currentTime: FIXED_TIME,
            timezone: "America/Santiago",
            opportunityId: "opp-001",
            decisionId: "decision-001",
            conversationCaseId: "case-001",
            messageId: "message-001",
            waId: "56900000001",
            channel: "whatsapp"
        }
    });
    const second = (0, action_queue_1.buildAgentActionFromNextAction)({
        nextAction: cloneJson(makeNextAction()),
        context: {
            currentTime: FIXED_TIME,
            timezone: "America/Santiago",
            opportunityId: "opp-001",
            decisionId: "decision-001",
            conversationCaseId: "case-001",
            messageId: "message-001",
            waId: "56900000001",
            channel: "whatsapp"
        }
    });
    strict_1.default.deepEqual(first, second);
});

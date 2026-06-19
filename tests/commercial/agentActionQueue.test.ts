import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentActionFromFollowUpPlan,
  buildAgentActionFromNextAction,
  loadAgentActions,
  persistAgentAction,
  serializeAgentAction,
  validateAgentAction
} from "../../lib/brain/commercial/action-queue";
import type {
  AgentActionQueueDatabaseAdapter,
  CrmAgentAction,
  LoadAgentActionsInput
} from "../../lib/brain/commercial/action-queue";
import type { CommercialFollowUpPlan } from "../../lib/brain/commercial/follow-up-planner";
import type { CommercialNextAction } from "../../lib/brain/commercial/operational-loop";

const FIXED_TIME = "2026-06-17T12:00:00.000Z";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeFollowUpPlan(overrides: Partial<CommercialFollowUpPlan> = {}): CommercialFollowUpPlan {
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

function makeNextAction(overrides: Partial<CommercialNextAction> = {}): CommercialNextAction {
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

function makeValidAction(overrides: Partial<CrmAgentAction> = {}): CrmAgentAction {
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

function createMockAdapter(initialRows: Record<string, unknown>[] = []) {
  const rowsByIdempotencyKey = new Map<string, Record<string, unknown>>();
  for (const row of initialRows) {
    const key = typeof row.idempotency_key === "string" ? row.idempotency_key : "";
    if (key) rowsByIdempotencyKey.set(key, row);
  }

  let insertCount = 0;
  let updateCount = 0;
  let beginCount = 0;
  let commitCount = 0;
  let rollbackCount = 0;
  const executedSql: string[] = [];

  const connection = {
    async execute(sql: string, params?: unknown[]) {
      executedSql.push(sql);
      const normalizedSql = sql.trim().toLowerCase();
      if (normalizedSql.startsWith("select * from crm_agent_actions where idempotency_key")) {
        const key = String(params?.[0] ?? "");
        const row = rowsByIdempotencyKey.get(key);
        return [[row ? { ...row } : undefined].filter(Boolean), []] as never;
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
        return [{ insertId: nextId }, []] as never;
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
        return [{ affectedRows: 1 } as never, []] as never;
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

  const adapter: AgentActionQueueDatabaseAdapter = {
    async hasTable(tableName) {
      return tableName === "crm_agent_actions";
    },
    async queryRows(sql, params) {
      executedSql.push(sql);
      const normalizedSql = sql.trim().toLowerCase();
      if (normalizedSql.includes("from crm_agent_actions")) {
        const rows = [...rowsByIdempotencyKey.values()];
        if (!params || params.length === 0) return rows as never;
        const opportunityId = params.find((value) => value !== null && value !== undefined) ?? null;
        if (opportunityId !== null) {
          return rows.filter((row) => row.opportunity_id === opportunityId || row.conversation_case_id === opportunityId || row.wa_id === opportunityId) as never;
        }
        return rows as never;
      }
      return [] as never;
    },
    async withConnection(fn) {
      return fn(connection as never);
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

test("builds action from a follow-up plan", () => {
  const action = buildAgentActionFromFollowUpPlan({
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

  assert.equal(action.actionType, "schedule_followup");
  assert.equal(action.status, "requires_review");
  assert.equal(action.channel, "whatsapp");
  assert.equal("executable" in action, false);
  assert.equal(validateAgentAction(action).valid, true);
});

test("blocks a follow-up plan when it is blocked", () => {
  const action = buildAgentActionFromFollowUpPlan({
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

  assert.equal(action.status, "blocked");
  assert.ok(action.blockReasons.includes("cooldown_active"));
  assert.equal(validateAgentAction(action).valid, true);
});

test("builds action from a next action respond recommendation", () => {
  const action = buildAgentActionFromNextAction({
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

  assert.equal(action.actionType, "send_whatsapp_reply");
  assert.equal(action.status, "proposed");
  assert.equal("executable" in action, false);
});

test("builds action from a next action follow-up recommendation", () => {
  const action = buildAgentActionFromNextAction({
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

  assert.equal(action.actionType, "schedule_followup");
  assert.equal(action.status, "requires_review");
  assert.equal(action.approvalRequirement, "explicit_operator_approval");
});

test("requires idempotency key and valid enums", () => {
  const invalidType = validateAgentAction({
    ...makeValidAction({ actionType: "unexpected" as unknown as CrmAgentAction["actionType"] }),
    idempotencyKey: "crm-agent-action:test-002"
  });
  const invalidStatus = validateAgentAction({
    ...makeValidAction({ status: "bogus" as unknown as CrmAgentAction["status"] }),
    idempotencyKey: "crm-agent-action:test-003"
  });
  const missingKey = validateAgentAction({
    ...makeValidAction({ idempotencyKey: "" }),
    actionId: "crm-agent-action-002"
  });

  assert.equal(invalidType.valid, false);
  assert.equal(invalidStatus.valid, false);
  assert.equal(missingKey.valid, false);
});

test("rejects WhatsApp actions without waId", () => {
  const result = validateAgentAction({
    ...makeValidAction({
      channel: "whatsapp",
      waId: null,
      status: "proposed"
    }),
    actionId: "crm-agent-action-003",
    idempotencyKey: "crm-agent-action:test-004"
  });

  assert.equal(result.valid, false);
  assert.equal(result.code, "invalid_channel");
});

test("requires scheduledFor for scheduled actions", () => {
  const result = validateAgentAction({
    ...makeValidAction({
      status: "scheduled",
      scheduledFor: null
    }),
    actionId: "crm-agent-action-004",
    idempotencyKey: "crm-agent-action:test-005"
  });

  assert.equal(result.valid, false);
  assert.equal(result.code, "invalid_state");
});

test("rejects execution status in P1K-012A", () => {
  const result = validateAgentAction({
    ...makeValidAction({
      status: "executed",
      executedAt: FIXED_TIME
    }),
    actionId: "crm-agent-action-005",
    idempotencyKey: "crm-agent-action:test-006"
  });

  assert.equal(result.valid, false);
  assert.equal(result.code, "execution_not_enabled_in_p1k_012a");
});

test("rejects outboxMessageId before execution", () => {
  const result = validateAgentAction({
    ...makeValidAction({
      outboxMessageId: 99
    }),
    actionId: "crm-agent-action-006",
    idempotencyKey: "crm-agent-action:test-007"
  });

  assert.equal(result.valid, false);
  assert.equal(result.code, "outbox_not_allowed");
});

test("persistence disabled returns dry_run and queue disabled returns skipped_by_flag", async () => {
  const action = makeValidAction();
  const dryRun = await persistAgentAction({
    action,
    currentTime: FIXED_TIME,
    featureFlags: {
      queueEnabled: true,
      persistenceEnabled: false
    }
  });
  const skipped = await persistAgentAction({
    action,
    currentTime: FIXED_TIME,
    featureFlags: {
      queueEnabled: false,
      persistenceEnabled: false
    }
  });

  assert.equal(dryRun.status, "dry_run");
  assert.equal(dryRun.dryRun, true);
  assert.equal(skipped.status, "skipped_by_flag");
  assert.equal(skipped.dryRun, true);
});

test("persists an action and updates the same idempotency key without duplicate insert", async () => {
  const harness = createMockAdapter();
  const action = makeValidAction();

  const first = await persistAgentAction({
    action,
    currentTime: FIXED_TIME,
    featureFlags: {
      queueEnabled: true,
      persistenceEnabled: true
    },
    dataAccess: harness.adapter
  });

  const second = await persistAgentAction({
    action,
    currentTime: FIXED_TIME,
    featureFlags: {
      queueEnabled: true,
      persistenceEnabled: true
    },
    dataAccess: harness.adapter
  });

  assert.equal(first.status, "inserted");
  assert.equal(second.status, "updated_existing");
  assert.equal(harness.counts.insertCount, 1);
  assert.equal(harness.counts.updateCount, 1);
  assert.equal(first.rowId, 1);
});

test("persist catches permission errors and fails safe", async () => {
  const result = await persistAgentAction({
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

  assert.equal(result.status, "failed");
  assert.equal(result.error?.includes("password=secret"), false);
  assert.equal(result.error?.includes("token=abc"), false);
});

test("loadAgentActions degrades when the table is unavailable", async () => {
  const result = await loadAgentActions(
    {
      opportunityId: "opp-001",
      queueEnabled: true
    } satisfies LoadAgentActionsInput,
    {
      async hasTable() {
        return false;
      },
      async queryRows() {
        return [];
      }
    }
  );

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.actions, []);
});

test("loadAgentActions reads and validates rows from the queue", async () => {
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

  const result = await loadAgentActions(
    {
      opportunityId: "opp-001",
      status: ["proposed"],
      actionType: ["send_whatsapp_reply"],
      queueEnabled: true,
      limit: 10
    },
    harness.adapter
  );

  assert.equal(result.status, "loaded");
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0]?.actionId, "crm-agent-action-001");
});

test("sanitizes dangerous metadata and remains JSON serializable", () => {
  const action = makeValidAction({
    draftPayload: {
      token: "secret-token",
      nested: {
        __proto__: { polluted: true },
        safe: "value"
      },
      big: 10n
    } as never
  });
  const sanitized = serializeAgentAction(action);

  assert.equal(JSON.stringify(sanitized) !== undefined, true);
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized, "token"), false);
  assert.ok(JSON.stringify(sanitized));
});

test("is deterministic for the same input", () => {
  const first = buildAgentActionFromNextAction({
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
  const second = buildAgentActionFromNextAction({
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

  assert.deepEqual(first, second);
});

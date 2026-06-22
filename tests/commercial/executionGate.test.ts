import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { CrmAgentAction } from "../../lib/brain/commercial/action-queue";
import {
  buildSandboxAutonomyConfig,
  evaluateAgentActionForSandbox,
  maskWaId,
  type SandboxAutonomyAgentActionContext,
  type SandboxAutonomyEvaluationResult
} from "../../lib/brain/commercial/autonomy-sandbox";
import { buildOutboxCommand } from "../../lib/brain/commercial/execution-gate/buildOutboxCommand";
import {
  evaluateExecutionGate,
  executeActionThroughGate,
  InMemoryAgentActionRepository,
  InMemoryExecutionUnitOfWork,
  InMemoryOutboxRepository
} from "../../lib/brain/commercial/execution-gate";

const FIXED_TIME = "2026-06-17T12:00:00.000Z";

type InMemoryFailureFlags = {
  failNextFindByActionId?: boolean;
  failNextFindByIdempotencyKey?: boolean;
  failNextMarkPlanned?: boolean;
  failNextInsert?: boolean;
  failNextCommit?: boolean;
};

type ExecutionHarnessOptions = {
  outboxSeed?: Array<{ id: number; status: string; command: ReturnType<typeof buildOutboxCommand> }>;
  uow?: { failNextCommit?: boolean };
  actionFailures?: InMemoryFailureFlags;
  outboxFailures?: InMemoryFailureFlags;
};

function makeAction(overrides: Partial<CrmAgentAction> = {}): CrmAgentAction {
  return {
    id: null,
    actionId: "action-001",
    idempotencyKey: "gate:test-001",
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
    lifecycleVersion: "brain.commercial.action-lifecycle.v1",
    policyVersion: "brain.commercial.policy.v1",
    runtimeVersion: "brain.commercial.runtime.v1",
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides
  };
}

function makeContext(overrides: Partial<SandboxAutonomyAgentActionContext> = {}): SandboxAutonomyAgentActionContext {
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

function makeSandboxEvaluation(
  action: CrmAgentAction,
  context: SandboxAutonomyAgentActionContext,
  overrides: Partial<SandboxAutonomyEvaluationResult> = {},
  configOverrides: Partial<ReturnType<typeof buildSandboxAutonomyConfig>> = {}
): SandboxAutonomyEvaluationResult {
  const config = buildSandboxAutonomyConfig({
    sandboxEnabled: true,
    autonomousReplyEnabled: true,
    whitelistedWaIds: action.waId ? [action.waId] : [],
    allowedActionTypes: ["send_whatsapp_reply", "request_more_context"],
    maxRiskLevel: "low",
    ...configOverrides
  });

  const base = evaluateAgentActionForSandbox(action, context, config);
  return {
    ...base,
    ...overrides,
    executionPreview: {
      ...base.executionPreview,
      ...(overrides.executionPreview ?? {})
    }
  };
}

function makeGateInput(options: {
  action?: Partial<CrmAgentAction>;
  context?: Partial<SandboxAutonomyAgentActionContext>;
  config?: Partial<{
    executionGateEnabled: boolean;
    outboxBridgeEnabled: boolean;
    sandboxModeRequired: boolean;
  }>;
  sandboxEvaluation?: Partial<SandboxAutonomyEvaluationResult>;
  sandboxConfig?: Partial<ReturnType<typeof buildSandboxAutonomyConfig>>;
} = {}) {
  const action = makeAction(options.action);
  const context = makeContext(options.context);
  const sandboxEvaluation = makeSandboxEvaluation(action, context, options.sandboxEvaluation ?? {}, options.sandboxConfig ?? {});

  return {
    now: FIXED_TIME,
    config: {
      executionGateEnabled: true,
      outboxBridgeEnabled: true,
      sandboxModeRequired: true,
      ...options.config
    },
    action,
    context,
    sandboxEvaluation
  };
}

function makeRepositoryHarness(action: CrmAgentAction, options: ExecutionHarnessOptions = {}) {
  const actionRepo = new InMemoryAgentActionRepository([action], { failureFlags: options.actionFailures });
  const outboxRepo = new InMemoryOutboxRepository(options.outboxSeed ?? [], { failureFlags: options.outboxFailures });
  const unitOfWork = new InMemoryExecutionUnitOfWork(actionRepo, outboxRepo, options.uow);
  return { actionRepo, outboxRepo, unitOfWork };
}

function makeThrowingUnitOfWork() {
  return {
    async run<T>() {
      throw new Error("unit of work should not be called");
    }
  };
}

function readExecutionGateSources() {
  const folder = resolve(process.cwd(), "lib/brain/commercial/execution-gate");
  const files = readdirSync(folder).filter((file) => file.endsWith(".ts"));
  const testFile = resolve(process.cwd(), "tests/commercial/executionGate.test.ts");
  return [...files.map((file) => readFileSync(resolve(folder, file), "utf8")), readFileSync(testFile, "utf8")].join("\n");
}

function hasForbiddenStorageText(source: string) {
  const forbiddenPattern = new RegExp(
    [
      "S" + "ELECT\\b",
      "I" + "NSERT\\b",
      "U" + "PDATE\\b",
      "D" + "ELETE\\b",
      "my" + "sql2",
      "from ['\"]" + "pg" + "['\"]",
      "supa" + "base"
    ].join("|"),
    ""
  );

  return forbiddenPattern.test(source);
}

test("execution gate disabled blocks before repositories are used", async () => {
  const input = makeGateInput({
    config: {
      executionGateEnabled: false
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "disabled");
  assert.equal(result.allowed, false);
  assert.deepEqual(result.blockReasons, ["execution_gate_disabled"]);
});

test("outbox bridge disabled blocks before repositories are used", async () => {
  const input = makeGateInput({
    config: {
      outboxBridgeEnabled: false
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "disabled");
  assert.deepEqual(result.blockReasons, ["execution_gate_disabled"]);
});

test("sandbox not eligible blocks before repositories are used", async () => {
  const input = makeGateInput({
    sandboxEvaluation: {
      status: "blocked",
      eligible: false,
      blockReasons: ["recipient_not_whitelisted"],
      warnings: [],
      executionPreview: {
        canExecute: false,
        channel: "whatsapp",
        recipientMasked: "569*****111",
        messagePreview: null,
        idempotencyKey: "outbox:action:action-001:gate:test-001"
      }
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("sandbox_not_eligible"));
});

test("unsupported action type blocks before repositories are used", async () => {
  const input = makeGateInput({
    action: {
      actionType: "schedule_followup"
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("unsupported_action_type"));
});

test("invalid lifecycle status blocks before repositories are used", async () => {
  const input = makeGateInput({
    action: {
      status: "executed"
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("invalid_lifecycle_transition"));
});

test("risk too high blocks before repositories are used", async () => {
  const input = makeGateInput({
    action: {
      riskLevel: "medium"
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("risk_not_allowed"));
});

test("approval required blocks before repositories are used", async () => {
  const input = makeGateInput({
    action: {
      approvalRequirement: "operator_review"
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("approval_not_satisfied"));
});

test("human owner active blocks before repositories are used", async () => {
  const input = makeGateInput({
    context: {
      humanOwnerActive: true
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("human_owner_active"));
});

test("ai blocked blocks before repositories are used", async () => {
  const input = makeGateInput({
    context: {
      aiBlocked: true
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("ai_blocked"));
});

test("closed case blocks before repositories are used", async () => {
  const input = makeGateInput({
    context: {
      caseStatus: "closed"
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("case_closed"));
});

test("missing recipient blocks before repositories are used", async () => {
  const input = makeGateInput({
    action: {
      waId: null
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("missing_recipient"));
});

test("missing message blocks before repositories are used", async () => {
  const input = makeGateInput({
    action: {
      draftMessage: null,
      finalMessage: null
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("unsafe_message"));
});

test("unsafe message blocks before repositories are used", async () => {
  const input = makeGateInput({
    action: {
      draftMessage: "Hay stock asegurado para hoy.",
      finalMessage: null
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("unsafe_message"));
});

test("expired action blocks before repositories are used", async () => {
  const input = makeGateInput({
    action: {
      expiresAt: "2026-06-16T12:00:00.000Z"
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "expired");
  assert.ok(result.blockReasons.includes("action_expired"));
});

test("conflicting action blocks before repositories are used", async () => {
  const input = makeGateInput({
    context: {
      conflictingActionExists: true
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("conflicting_action"));
});

test("missing idempotency key is invalid", async () => {
  const input = makeGateInput({
    action: {
      idempotencyKey: ""
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: makeThrowingUnitOfWork() as never });

  assert.equal(result.status, "invalid");
  assert.ok(result.blockReasons.includes("missing_idempotency_key"));
});

test("pure evaluator allows an eligible action", () => {
  const evaluation = evaluateExecutionGate(makeGateInput());

  assert.equal(evaluation.status, "allowed");
  assert.equal(evaluation.allowed, true);
  assert.deepEqual(evaluation.blockReasons, []);
});

test("proposed low-risk action plans through the gate", async () => {
  const input = makeGateInput();
  const harness = makeRepositoryHarness(input.action);

  const result = await executeActionThroughGate(input, { unitOfWork: harness.unitOfWork });

  assert.equal(result.status, "allowed");
  assert.equal(result.allowed, true);
  assert.equal(result.outboxCommand?.commandType, "whatsapp_text");
  assert.equal(result.repositoryResult.outboxInserted, true);
  assert.equal(result.repositoryResult.actionUpdated, true);
  assert.equal(result.repositoryResult.duplicateDetected, false);
  assert.equal(result.sideEffects.messageSent, false);
  assert.equal(result.sideEffects.metaCalled, false);
  assert.equal(result.sideEffects.workerTriggered, false);
  assert.equal(harness.actionRepo.snapshot()[0].status, "planned");
  assert.equal(harness.actionRepo.snapshot()[0].outboxMessageId, harness.outboxRepo.snapshot()[0].id);
  assert.equal(harness.outboxRepo.snapshot().length, 1);
  assert.equal(harness.outboxRepo.snapshot()[0].status, "planned");
});

test("approved action also plans through the gate", async () => {
  const input = makeGateInput({
    action: {
      status: "approved"
    }
  });
  const harness = makeRepositoryHarness(input.action);

  const result = await executeActionThroughGate(input, { unitOfWork: harness.unitOfWork });

  assert.equal(result.status, "allowed");
  assert.equal(harness.actionRepo.snapshot()[0].status, "planned");
});

test("command builder is deterministic", () => {
  const action = makeAction();
  const first = buildOutboxCommand({ action, evaluatedAt: FIXED_TIME });
  const second = buildOutboxCommand({ action, evaluatedAt: FIXED_TIME });

  assert.deepEqual(first, second);
  assert.equal(first.commandId, "outbox:action:action-001:gate:test-001");
  assert.equal(first.idempotencyKey, "outbox:action:action-001:gate:test-001");
});

test("duplicate outbox is detected without inserting a second row", async () => {
  const input = makeGateInput();
  const seededCommand = buildOutboxCommand({ action: input.action, evaluatedAt: FIXED_TIME });
  const harness = makeRepositoryHarness(input.action, {
    outboxSeed: [
      {
        id: 7,
        status: "planned",
        command: seededCommand
      }
    ]
  });

  const result = await executeActionThroughGate(input, { unitOfWork: harness.unitOfWork });

  assert.equal(result.status, "duplicate");
  assert.equal(result.repositoryResult.duplicateDetected, true);
  assert.equal(result.repositoryResult.outboxInserted, false);
  assert.equal(harness.actionRepo.snapshot()[0].status, "planned");
  assert.equal(harness.actionRepo.snapshot()[0].outboxMessageId, 7);
  assert.equal(harness.outboxRepo.snapshot().length, 1);
});

test("retry does not duplicate the outbox", async () => {
  const input = makeGateInput();
  const seededCommand = buildOutboxCommand({ action: input.action, evaluatedAt: FIXED_TIME });
  const harness = makeRepositoryHarness(input.action, {
    outboxSeed: [
      {
        id: 7,
        status: "planned",
        command: seededCommand
      }
    ]
  });

  const first = await executeActionThroughGate(input, { unitOfWork: harness.unitOfWork });
  const second = await executeActionThroughGate(input, { unitOfWork: harness.unitOfWork });

  assert.equal(first.status, "duplicate");
  assert.equal(second.status, "duplicate");
  assert.equal(harness.outboxRepo.snapshot().length, 1);
});

test("repository failure returns failed", async () => {
  const input = makeGateInput();
  const harness = makeRepositoryHarness(input.action, {
    outboxFailures: {
      failNextInsert: true
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: harness.unitOfWork });

  assert.equal(result.status, "failed");
  assert.ok(result.blockReasons.includes("repository_failure"));
});

test("transaction failure rolls back and leaves no orphan outbox", async () => {
  const input = makeGateInput();
  const harness = makeRepositoryHarness(input.action, {
    uow: {
      failNextCommit: true
    }
  });

  const result = await executeActionThroughGate(input, { unitOfWork: harness.unitOfWork });

  assert.equal(result.status, "failed");
  assert.ok(result.blockReasons.includes("transaction_failure"));
  assert.equal(harness.outboxRepo.snapshot().length, 0);
  assert.equal(harness.actionRepo.snapshot()[0].status, "proposed");
  assert.equal(harness.actionRepo.snapshot()[0].outboxMessageId, null);
});

test("allowed execution never sends, calls Meta or triggers a worker", async () => {
  const input = makeGateInput();
  const harness = makeRepositoryHarness(input.action);

  const result = await executeActionThroughGate(input, { unitOfWork: harness.unitOfWork });

  assert.deepEqual(result.sideEffects, {
    messageSent: false,
    metaCalled: false,
    workerTriggered: false
  });
});

test("input action is not mutated", async () => {
  const input = makeGateInput();
  const before = JSON.stringify(input.action);
  const harness = makeRepositoryHarness(input.action);

  await executeActionThroughGate(input, { unitOfWork: harness.unitOfWork });

  assert.equal(JSON.stringify(input.action), before);
});

test("in-memory repositories work as a storage-agnostic adapter", async () => {
  const input = makeGateInput({
    action: {
      status: "approved"
    }
  });
  const actionRepo = new InMemoryAgentActionRepository([input.action]);
  const outboxRepo = new InMemoryOutboxRepository([]);
  const unitOfWork = new InMemoryExecutionUnitOfWork(actionRepo, outboxRepo);

  const result = await executeActionThroughGate(input, { unitOfWork });

  assert.equal(result.status, "allowed");
  assert.equal(actionRepo.snapshot()[0].status, "planned");
  assert.equal(outboxRepo.snapshot().length, 1);
});

test("recipient remains masked in previews", () => {
  assert.equal(maskWaId("56912345678"), "569*****678");
});

test("execution gate source stays free of direct storage keywords and adapters", () => {
  const source = readExecutionGateSources();
  assert.equal(hasForbiddenStorageText(source), false);
});

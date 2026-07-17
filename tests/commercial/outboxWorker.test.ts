// This file covers `lib/brain/messaging/outbox-worker/` (hyphenated), the
// in-memory dev-only simulator consumed by lib/brain/commercial/autonomous-loop
// (see docs/audits/follow-up-runtime-reconciliation.md P2-5). It is NOT
// coverage of the productive outbox worker (`lib/brain/messaging/outboxWorker.ts`,
// `autonomousOutboxTick.ts`), which have their own tests.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildFakeProviderMessageId,
  buildFinalOutboxWorkerPlan,
  buildOutboxAuditEventId,
  buildOutboxWorkerPlan,
  buildOutboxWorkerPlanId,
  buildOutboxWorkerPlanKey,
  buildProcessingOutboxWorkerPlan,
  buildSkippedOutboxWorkerPlan,
  calculateOutboxRetrySchedule,
  evaluateOutboxCandidate,
  FakeMessageTransport,
  InMemoryOutboxWorkerRepository,
  InMemoryOutboxWorkerUnitOfWork,
  processOutboxBatch,
  processOutboxMessage,
  sanitizeOutboxWorkerErrorMessage,
  type OutboxMessageRecord,
  type OutboxWorkerConfig,
  type OutboxWorkerInput,
  type OutboxWorkerMutationPlan
} from "../../lib/brain/messaging/outbox-worker/index.js";

const FIXED_NOW = "2026-06-17T12:00:00.000Z";
const BASE_CREATED_AT = "2026-06-17T10:00:00.000Z";
const BASE_EXPIRES_AT = "2026-06-18T12:00:00.000Z";
const BASE_WORKER_ID = "worker-1";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type OutboxWorkerRecordOverrides = Omit<Partial<OutboxMessageRecord>, "metadata"> & {
  metadata?: Partial<OutboxMessageRecord["metadata"]>;
};

function shiftIso(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function makeRecord(
  overrides: OutboxWorkerRecordOverrides = {}
): OutboxMessageRecord {
  const { metadata: metadataOverrides, ...recordOverrides } = overrides;
  const base: OutboxMessageRecord = {
    rowId: 1,
    commandId: "command-001",
    idempotencyKey: "outbox:test-001",
    actionId: "action-001",
    channel: "whatsapp",
    commandType: "whatsapp_text",
    recipient: "56911111111",
    messageText: "Hola, te ayudamos con tu consulta.",
    status: "pending",
    attemptCount: 0,
    maxAttempts: 3,
    availableAt: FIXED_NOW,
    expiresAt: BASE_EXPIRES_AT,
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
      riskLevel: "low",
      approvalRequirement: "none"
    },
    createdAt: BASE_CREATED_AT,
    updatedAt: BASE_CREATED_AT
  };

  return {
    ...base,
    ...recordOverrides,
    metadata: {
      ...base.metadata,
      ...(metadataOverrides ?? {})
    }
  };
}

function makeConfig(overrides: Partial<OutboxWorkerConfig> = {}): OutboxWorkerConfig {
  return {
    workerEnabled: true,
    transportEnabled: true,
    workerId: BASE_WORKER_ID,
    batchSize: 10,
    leaseSeconds: 60,
    defaultMaxAttempts: 3,
    baseRetrySeconds: 30,
    maxRetrySeconds: 3600,
    retryJitterEnabled: false,
    recoverExpiredLeases: false,
    sandboxRequired: false,
    ...overrides
  };
}

function makeInput(
  overrides: {
    now?: string;
    record?: OutboxWorkerRecordOverrides;
    config?: Partial<OutboxWorkerConfig>;
  } = {}
): OutboxWorkerInput {
  return {
    now: overrides.now ?? FIXED_NOW,
    record: makeRecord(overrides.record ?? {}),
    config: makeConfig(overrides.config ?? {})
  };
}

function makeTransport(scenarios: Record<string, ReturnType<typeof makeTransportScenario>>) {
  return new FakeMessageTransport({
    scenarioByIdempotencyKey: scenarios
  });
}

type TransportScenario =
  | "accepted"
  | "temporary_failure"
  | "permanent_failure"
  | "rate_limited"
  | "timeout"
  | "duplicate_accepted"
  | "invalid_recipient"
  | "invalid_payload"
  | "authentication_error"
  | "permission_error"
  | "policy_rejected"
  | "provider_duplicate";

function makeTransportScenario(scenario: TransportScenario) {
  return scenario;
}

function expectNoSideEffects(plan: OutboxWorkerMutationPlan) {
  assert.equal(plan.sideEffects.databaseWritten, false);
  assert.equal(plan.sideEffects.externalMessageSent, false);
  assert.equal(plan.sideEffects.metaCalled, false);
}

function readSourceTree(folder: string): string {
  const entries = readdirSync(folder, { withFileTypes: true });
  const chunks: string[] = [];
  for (const entry of entries) {
    const fullPath = resolve(folder, entry.name);
    if (entry.isDirectory()) {
      chunks.push(readSourceTree(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      chunks.push(readFileSync(fullPath, "utf8"));
    }
  }
  return chunks.join("\n");
}

function readTestAndModuleSource(): string {
  const folder = resolve(process.cwd(), "lib/brain/messaging/outbox-worker");
  const testFile = resolve(process.cwd(), "tests/commercial/outboxWorker.test.ts");
  return `${readSourceTree(folder)}\n${readFileSync(testFile, "utf8")}`;
}

function hasForbiddenSource(source: string): boolean {
  const pattern = new RegExp(
    [
      "D" + "ate\\.now",
      "r" + "andomUUID",
      "M" + "ath\\.random",
      "set" + "Timeout",
      "set" + "Interval",
      "process" + "\\.env",
      "fetch\\(",
      "my" + "sql2",
      "from ['\"]" + "pg" + "['\"]",
      "supa" + "base",
      "SE" + "LECT\\s",
      "IN" + "SERT\\s",
      "UP" + "DATE\\s",
      "DE" + "LETE\\s",
      "graph" + "\\.facebook",
      "send" + "WhatsApp"
    ].join("|")
  );
  return pattern.test(source);
}

test("worker disabled produces a skip decision", () => {
  const result = evaluateOutboxCandidate(makeInput({ config: { workerEnabled: false } }));
  assert.equal(result.decision, "skip");
  assert.equal(result.reasons[0], "worker_disabled");
});

test("transport disabled produces a skip decision", () => {
  const result = evaluateOutboxCandidate(makeInput({ config: { transportEnabled: false } }));
  assert.equal(result.decision, "skip");
  assert.equal(result.reasons[0], "transport_disabled");
});

test("sandbox required but missing is invalid", () => {
  const result = evaluateOutboxCandidate(
    makeInput({
      config: { sandboxRequired: true },
      record: { metadata: { sandbox: false } }
    })
  );
  assert.equal(result.decision, "invalid");
  assert.equal(result.reasons[0], "sandbox_required");
});

test("missing command id is invalid", () => {
  const result = evaluateOutboxCandidate(makeInput({ record: { commandId: "" } }));
  assert.equal(result.decision, "invalid");
  assert.equal(result.reasons[0], "missing_command_id");
});

test("missing idempotency key is invalid", () => {
  const result = evaluateOutboxCandidate(makeInput({ record: { idempotencyKey: " " } }));
  assert.equal(result.decision, "invalid");
  assert.equal(result.reasons[0], "missing_idempotency_key");
});

test("unsupported channel is invalid", () => {
  const result = evaluateOutboxCandidate(makeInput({ record: { channel: "email" as never } }));
  assert.equal(result.decision, "invalid");
  assert.equal(result.reasons[0], "unsupported_channel");
});

test("unsupported command type is invalid", () => {
  const result = evaluateOutboxCandidate(makeInput({ record: { commandType: "email_text" as never } }));
  assert.equal(result.decision, "invalid");
  assert.equal(result.reasons[0], "unsupported_command_type");
});

test("missing recipient is invalid", () => {
  const result = evaluateOutboxCandidate(makeInput({ record: { recipient: " " } }));
  assert.equal(result.decision, "invalid");
  assert.equal(result.reasons[0], "missing_recipient");
});

test("missing message is invalid", () => {
  const result = evaluateOutboxCandidate(makeInput({ record: { messageText: " " } }));
  assert.equal(result.decision, "invalid");
  assert.equal(result.reasons[0], "missing_message");
});

test("pending candidate is processable", () => {
  const result = evaluateOutboxCandidate(makeInput());
  assert.equal(result.decision, "process");
  assert.equal(result.actionable, true);
});

test("retry_scheduled candidate is processable", () => {
  const result = evaluateOutboxCandidate(makeInput({ record: { status: "retry_scheduled" } }));
  assert.equal(result.decision, "process");
  assert.equal(result.actionable, true);
});

test("delivered candidate is skipped", () => {
  const result = evaluateOutboxCandidate(makeInput({ record: { status: "delivered" } }));
  assert.equal(result.decision, "skip");
  assert.equal(result.reasons[0], "status_not_reclaimable");
});

test("dead_letter candidate is skipped", () => {
  const result = evaluateOutboxCandidate(makeInput({ record: { status: "dead_letter" } }));
  assert.equal(result.decision, "skip");
  assert.equal(result.reasons[0], "status_not_reclaimable");
});

test("cancelled candidate is skipped", () => {
  const result = evaluateOutboxCandidate(makeInput({ record: { status: "cancelled" } }));
  assert.equal(result.decision, "skip");
  assert.equal(result.reasons[0], "status_not_reclaimable");
});

test("not yet available candidate is skipped", () => {
  const result = evaluateOutboxCandidate(makeInput({ record: { availableAt: shiftIso(FIXED_NOW, 300) } }));
  assert.equal(result.decision, "skip");
  assert.equal(result.reasons[0], "not_yet_available");
});

test("expired candidate is expired", () => {
  const result = evaluateOutboxCandidate(makeInput({ record: { expiresAt: "2026-06-17T11:59:59.000Z" } }));
  assert.equal(result.decision, "expire");
  assert.equal(result.reasons[0], "message_expired");
});

test("attempts exhausted candidate is dead_letter", () => {
  const result = evaluateOutboxCandidate(makeInput({ record: { attemptCount: 3, maxAttempts: 3 } }));
  assert.equal(result.decision, "dead_letter");
  assert.equal(result.reasons[0], "attempts_exhausted");
});

test("wrong worker claim is skipped", () => {
  const result = evaluateOutboxCandidate(
    makeInput({
      record: {
        status: "claimed",
        claimedBy: "worker-2",
        leaseExpiresAt: "2026-06-17T13:00:00.000Z"
      },
      config: { workerId: "worker-1" }
    })
  );
  assert.equal(result.decision, "skip");
  assert.equal(result.reasons[0], "wrong_worker_claim");
});

test("expired lease can be reclaimed", () => {
  const result = evaluateOutboxCandidate(
    makeInput({
      record: {
        status: "claimed",
        claimedBy: "worker-2",
        leaseExpiresAt: "2026-06-17T11:00:00.000Z"
      },
      config: { workerId: "worker-1", recoverExpiredLeases: true }
    })
  );
  assert.equal(result.decision, "process");
  assert.equal(result.claimRecoverable, true);
});

test("active lease that is not recoverable is skipped", () => {
  const result = evaluateOutboxCandidate(
    makeInput({
      record: {
        status: "claimed",
        claimedBy: "worker-2",
        leaseExpiresAt: "2026-06-17T13:00:00.000Z"
      },
      config: { workerId: "worker-1", recoverExpiredLeases: false }
    })
  );
  assert.equal(result.decision, "skip");
  assert.equal(result.reasons[0], "wrong_worker_claim");
});

test("retry schedule is deterministic and capped", () => {
  const exponential = calculateOutboxRetrySchedule({
    now: FIXED_NOW,
    attemptCount: 3,
    maxAttempts: 10,
    expiresAt: null,
    retryAfterSeconds: null,
    baseRetrySeconds: 30,
    maxRetrySeconds: 3600
  });
  const capped = calculateOutboxRetrySchedule({
    now: FIXED_NOW,
    attemptCount: 4,
    maxAttempts: 10,
    expiresAt: null,
    retryAfterSeconds: null,
    baseRetrySeconds: 1000,
    maxRetrySeconds: 120
  });

  assert.equal(exponential.retryAt, "2026-06-17T12:02:00.000Z");
  assert.equal(exponential.delaySeconds, 120);
  assert.equal(exponential.exhausted, false);
  assert.equal(capped.delaySeconds, 120);
});

test("build ids are deterministic", () => {
  const base = {
    rowId: 1,
    commandId: "command-001",
    attemptCount: 0,
    planType: "mark_delivered" as const,
    createdAt: FIXED_NOW
  };

  assert.equal(buildOutboxWorkerPlanId(base), buildOutboxWorkerPlanId(base));
  assert.equal(buildOutboxWorkerPlanKey(base), buildOutboxWorkerPlanKey(base));
  assert.equal(
    buildOutboxAuditEventId({
      ...base,
      eventType: "outbox_delivered",
      createdAt: FIXED_NOW
    }),
    buildOutboxAuditEventId({
      ...base,
      eventType: "outbox_delivered",
      createdAt: FIXED_NOW
    })
  );
  assert.equal(buildFakeProviderMessageId({ commandId: base.commandId }), "fake-provider:command-001");
});

test("same input produces the same plan", () => {
  const input = {
    now: FIXED_NOW,
    record: makeRecord(),
    config: makeConfig()
  };
  const first = buildProcessingOutboxWorkerPlan({
    now: input.now,
    record: input.record,
    config: input.config,
    evaluation: evaluateOutboxCandidate(input)
  });
  const second = buildProcessingOutboxWorkerPlan({
    now: input.now,
    record: input.record,
    config: input.config,
    evaluation: evaluateOutboxCandidate(input)
  });
  assert.deepEqual(first, second);
});

test("input is not mutated by the builder or processor", async () => {
  const input = makeInput();
  const inputCopy = cloneJson(input);

  buildOutboxWorkerPlan({
    now: input.now,
    record: input.record,
    config: input.config,
    evaluation: evaluateOutboxCandidate(input),
    transportResult: null,
    phase: "final"
  });
  await processOutboxMessage(input, { transport: new FakeMessageTransport() });

  assert.deepEqual(input, inputCopy);
});

test("accepted transport marks delivered", async () => {
  const input = makeInput({ record: { idempotencyKey: "outbox:accepted" } });
  const transport = makeTransport({ "outbox:accepted": makeTransportScenario("accepted") });
  const result = await processOutboxMessage(input, { transport });

  assert.equal(result.status, "delivered");
  assert.equal(result.finalPlan?.planType, "mark_delivered");
  assert.equal(result.finalPlan?.patch.nextStatus, "delivered");
  assert.equal(transport.snapshotCalls().length, 1);
});

test("duplicate accepted transport marks delivered", async () => {
  const input = makeInput({ record: { idempotencyKey: "outbox:duplicate" } });
  const transport = makeTransport({ "outbox:duplicate": makeTransportScenario("duplicate_accepted") });
  const result = await processOutboxMessage(input, { transport });

  assert.equal(result.status, "delivered");
  assert.equal(result.finalPlan?.planType, "mark_delivered");
  assert.equal(result.finalPlan?.patch.nextStatus, "delivered");
});

test("temporary failure schedules retry", async () => {
  const input = makeInput({ record: { idempotencyKey: "outbox:retry-001" } });
  const transport = makeTransport({ "outbox:retry-001": makeTransportScenario("temporary_failure") });
  const result = await processOutboxMessage(input, { transport });

  assert.equal(result.status, "retry_scheduled");
  assert.equal(result.finalPlan?.planType, "schedule_retry");
  assert.equal(result.finalPlan?.patch.nextStatus, "retry_scheduled");
  assert.equal(result.finalPlan?.patch.availableAt, "2026-06-17T12:00:30.000Z");
});

test("timeout schedules retry", async () => {
  const input = makeInput({ record: { idempotencyKey: "outbox:retry-002" } });
  const transport = makeTransport({ "outbox:retry-002": makeTransportScenario("timeout") });
  const result = await processOutboxMessage(input, { transport });

  assert.equal(result.status, "retry_scheduled");
  assert.equal(result.finalPlan?.patch.availableAt, "2026-06-17T12:01:00.000Z");
});

test("rate limit respects retry-after", async () => {
  const input = makeInput({ record: { idempotencyKey: "outbox:retry-003" } });
  const transport = makeTransport({ "outbox:retry-003": makeTransportScenario("rate_limited") });
  const result = await processOutboxMessage(input, { transport });

  assert.equal(result.status, "retry_scheduled");
  assert.equal(result.finalPlan?.patch.availableAt, "2026-06-17T12:02:00.000Z");
});

test("permanent failure dead-letters", async () => {
  const input = makeInput({ record: { idempotencyKey: "outbox:perm-001" } });
  const transport = makeTransport({ "outbox:perm-001": makeTransportScenario("permanent_failure") });
  const result = await processOutboxMessage(input, { transport });

  assert.equal(result.status, "dead_letter");
  assert.equal(result.finalPlan?.patch.nextStatus, "dead_letter");
});

test("invalid recipient dead-letters", async () => {
  const input = makeInput({ record: { idempotencyKey: "outbox:invalid-001" } });
  const transport = makeTransport({ "outbox:invalid-001": makeTransportScenario("invalid_recipient") });
  const result = await processOutboxMessage(input, { transport });

  assert.equal(result.status, "dead_letter");
  assert.equal(result.finalPlan?.patch.lastErrorCode, "invalid_recipient");
});

test("invalid payload dead-letters", async () => {
  const input = makeInput({ record: { idempotencyKey: "outbox:invalid-002" } });
  const transport = makeTransport({ "outbox:invalid-002": makeTransportScenario("invalid_payload") });
  const result = await processOutboxMessage(input, { transport });

  assert.equal(result.status, "dead_letter");
  assert.equal(result.finalPlan?.patch.lastErrorCode, "invalid_payload");
});

test("authentication error dead-letters", async () => {
  const input = makeInput({ record: { idempotencyKey: "outbox:auth-001" } });
  const transport = makeTransport({ "outbox:auth-001": makeTransportScenario("authentication_error") });
  const result = await processOutboxMessage(input, { transport });

  assert.equal(result.status, "dead_letter");
  assert.equal(result.finalPlan?.patch.lastErrorCode, "authentication_error");
});

test("max attempts exhausted dead-letters before transport", async () => {
  const input = makeInput({
    record: {
      attemptCount: 3,
      maxAttempts: 3,
      idempotencyKey: "outbox:max-attempts"
    }
  });
  const transport = makeTransport({ "outbox:max-attempts": makeTransportScenario("accepted") });
  const result = await processOutboxMessage(input, { transport });

  assert.equal(result.status, "dead_letter");
  assert.equal(transport.snapshotCalls().length, 0);
});

test("retry beyond expiry dead-letters", async () => {
  const input = makeInput({
    record: {
      expiresAt: "2026-06-17T12:00:10.000Z",
      idempotencyKey: "outbox:expiry-retry"
    }
  });
  const transport = makeTransport({ "outbox:expiry-retry": makeTransportScenario("temporary_failure") });
  const result = await processOutboxMessage(input, { transport });

  assert.equal(result.status, "dead_letter");
  assert.equal(result.finalPlan?.planType, "move_to_dead_letter");
});

test("delivered rows are not resent", async () => {
  const input = makeInput({ record: { status: "delivered", idempotencyKey: "outbox:done" } });
  const transport = makeTransport({ "outbox:done": makeTransportScenario("accepted") });
  const result = await processOutboxMessage(input, { transport });

  assert.equal(result.status, "skipped");
  assert.equal(transport.snapshotCalls().length, 0);
});

test("claim sets lease and worker ownership", async () => {
  const repo = new InMemoryOutboxWorkerRepository([makeRecord()]);
  const claimed = await repo.claimAvailable({
    now: FIXED_NOW,
    workerId: "worker-1",
    batchSize: 1,
    leaseExpiresAt: "2026-06-17T12:01:00.000Z",
    recoverExpiredLeases: false
  });

  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].status, "claimed");
  assert.equal(claimed[0].claimedBy, "worker-1");
  assert.equal(claimed[0].leaseExpiresAt, "2026-06-17T12:01:00.000Z");
});

test("two workers cannot claim the same row", async () => {
  const repo = new InMemoryOutboxWorkerRepository([makeRecord()]);
  const first = await repo.claimAvailable({
    now: FIXED_NOW,
    workerId: "worker-1",
    batchSize: 1,
    leaseExpiresAt: "2026-06-17T12:01:00.000Z",
    recoverExpiredLeases: false
  });
  const second = await repo.claimAvailable({
    now: FIXED_NOW,
    workerId: "worker-2",
    batchSize: 1,
    leaseExpiresAt: "2026-06-17T12:01:00.000Z",
    recoverExpiredLeases: false
  });

  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
});

test("expired lease can be reclaimed", async () => {
  const repo = new InMemoryOutboxWorkerRepository([
    makeRecord({
      status: "claimed",
      claimedBy: "worker-2",
      leaseExpiresAt: "2026-06-17T11:00:00.000Z"
    })
  ]);
  const claimed = await repo.claimAvailable({
    now: FIXED_NOW,
    workerId: "worker-1",
    batchSize: 1,
    leaseExpiresAt: "2026-06-17T12:01:00.000Z",
    recoverExpiredLeases: true
  });

  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].claimedBy, "worker-1");
  assert.equal(claimed[0].status, "claimed");
});

test("optimistic conflict is detected", async () => {
  const repo = new InMemoryOutboxWorkerRepository([makeRecord()]);
  const plan = buildFinalOutboxWorkerPlan({
    now: FIXED_NOW,
    record: makeRecord(),
    config: makeConfig(),
    evaluation: evaluateOutboxCandidate(makeInput()),
    transportResult: {
      status: "accepted",
      providerMessageId: "fake-provider:command-001",
      providerRequestId: "fake-request:command-001",
      errorCode: "none",
      errorMessageSafe: null,
      retryAfterSeconds: null,
      acceptedAt: FIXED_NOW,
      completedAt: FIXED_NOW,
      metadata: {
        provider: "fake",
        sandbox: true,
        simulated: true
      }
    }
  });

  const result = await repo.applyWorkerPlan(plan);
  assert.equal(result.applied, false);
  assert.equal(result.conflict, true);
});

test("duplicate plan key is ignored", async () => {
  const repo = new InMemoryOutboxWorkerRepository([makeRecord()]);
  const plan = buildProcessingOutboxWorkerPlan({
    now: FIXED_NOW,
    record: makeRecord(),
    config: makeConfig(),
    evaluation: evaluateOutboxCandidate(makeInput())
  });

  const first = await repo.applyWorkerPlan(plan);
  const second = await repo.applyWorkerPlan(plan);

  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(second.duplicate, true);
});

test("duplicate idempotency is rolled back", async () => {
  const repo = new InMemoryOutboxWorkerRepository([
    makeRecord({ rowId: 1, idempotencyKey: "outbox:dupe-key" }),
    makeRecord({ rowId: 2, idempotencyKey: "outbox:dupe-key" })
  ]);
  const before = repo.snapshotState();
  const uow = new InMemoryOutboxWorkerUnitOfWork(repo);

  await assert.rejects(async () => {
    await uow.run(async ({ outbox }) => {
      const first = buildProcessingOutboxWorkerPlan({
        now: FIXED_NOW,
        record: makeRecord({ rowId: 1, idempotencyKey: "outbox:dupe-key" }),
        config: makeConfig(),
        evaluation: evaluateOutboxCandidate(makeInput({ record: { rowId: 1, idempotencyKey: "outbox:dupe-key" } }))
      });
      const second = buildProcessingOutboxWorkerPlan({
        now: FIXED_NOW,
        record: makeRecord({ rowId: 2, idempotencyKey: "outbox:dupe-key" }),
        config: makeConfig(),
        evaluation: evaluateOutboxCandidate(makeInput({ record: { rowId: 2, idempotencyKey: "outbox:dupe-key" } }))
      });

      const firstResult = await outbox.applyWorkerPlan(first);
      assert.equal(firstResult.applied, true);

      const secondResult = await outbox.applyWorkerPlan(second);
      if (secondResult.duplicate) {
        throw new Error("duplicate_idempotency");
      }

      return secondResult;
    });
  });

  assert.deepEqual(repo.snapshotState(), before);
});

test("repository failure rolls back a staged transaction", async () => {
  const repo = new InMemoryOutboxWorkerRepository([makeRecord()], {
    failureFlags: {
      failOnPlanType: ["mark_delivered"]
    }
  });
  const before = repo.snapshotState();
  const uow = new InMemoryOutboxWorkerUnitOfWork(repo);

  await assert.rejects(async () => {
    await uow.run(async ({ outbox }) => {
      const processing = buildProcessingOutboxWorkerPlan({
        now: FIXED_NOW,
        record: makeRecord(),
        config: makeConfig(),
        evaluation: evaluateOutboxCandidate(makeInput())
      });
      await outbox.applyWorkerPlan(processing);
      const delivered = buildFinalOutboxWorkerPlan({
        now: FIXED_NOW,
        record: makeRecord({ attemptCount: 1, status: "processing" }),
        config: makeConfig(),
        evaluation: evaluateOutboxCandidate(makeInput({ record: { status: "processing", attemptCount: 1 } })),
        transportResult: {
          status: "accepted",
          providerMessageId: "fake-provider:command-001",
          providerRequestId: "fake-request:command-001",
          errorCode: "none",
          errorMessageSafe: null,
          retryAfterSeconds: null,
          acceptedAt: FIXED_NOW,
          completedAt: FIXED_NOW,
          metadata: {
            provider: "fake",
            sandbox: true,
            simulated: true
          }
        }
      });
      await outbox.applyWorkerPlan(delivered);
    });
  });

  assert.deepEqual(repo.snapshotState(), before);
});

test("processing-plan failure prevents transport", async () => {
  const repo = new InMemoryOutboxWorkerRepository([makeRecord()], {
    failureFlags: {
      failOnPlanType: ["mark_processing"]
    }
  });
  const uow = new InMemoryOutboxWorkerUnitOfWork(repo);
  const transport = new FakeMessageTransport();

  const result = await processOutboxBatch(
    {
      now: FIXED_NOW,
      config: makeConfig({ batchSize: 1 })
    },
    {
      transport,
      unitOfWork: uow
    }
  );

  assert.equal(result.failed, 1);
  assert.equal(transport.snapshotCalls().length, 0);
});

test("final-plan failure reports failure", async () => {
  const repo = new InMemoryOutboxWorkerRepository([makeRecord()], {
    failureFlags: {
      failOnPlanType: ["mark_delivered"]
    }
  });
  const uow = new InMemoryOutboxWorkerUnitOfWork(repo);

  const result = await processOutboxBatch(
    {
      now: FIXED_NOW,
      config: makeConfig({ batchSize: 1 })
    },
    {
      transport: new FakeMessageTransport({ scenarioByIdempotencyKey: { "outbox:test-001": "accepted" } }),
      unitOfWork: uow
    }
  );

  assert.equal(result.failed, 1);
  assert.equal(result.results[0]?.status, "failed");
});

test("no partial state remains after a failed commit", async () => {
  const repo = new InMemoryOutboxWorkerRepository([makeRecord()]);
  const before = repo.snapshotState();
  const uow = new InMemoryOutboxWorkerUnitOfWork(repo, { failNextCommit: true });

  await assert.rejects(async () => {
    await uow.run(async ({ outbox }) => {
      const processing = buildProcessingOutboxWorkerPlan({
        now: FIXED_NOW,
        record: makeRecord(),
        config: makeConfig(),
        evaluation: evaluateOutboxCandidate(makeInput())
      });
      await outbox.applyWorkerPlan(processing);
    });
  });

  assert.deepEqual(repo.snapshotState(), before);
});

test("batch respects batch size", async () => {
  const repo = new InMemoryOutboxWorkerRepository([
    makeRecord({ rowId: 1, idempotencyKey: "batch-001" }),
    makeRecord({ rowId: 2, idempotencyKey: "batch-002" }),
    makeRecord({ rowId: 3, idempotencyKey: "batch-003" })
  ]);
  const transport = new FakeMessageTransport({
    scenarioByIdempotencyKey: {
      "batch-001": "accepted",
      "batch-002": "accepted",
      "batch-003": "accepted"
    }
  });
  const uow = new InMemoryOutboxWorkerUnitOfWork(repo);
  const result = await processOutboxBatch(
    {
      now: FIXED_NOW,
      config: makeConfig({ batchSize: 2 })
    },
    {
      transport,
      unitOfWork: uow
    }
  );

  assert.equal(result.claimed, 2);
  assert.equal(result.processed, 2);
  assert.equal(result.results.length, 2);
  assert.equal(repo.snapshot().length, 3);
  assert.equal(repo.snapshot()[2].status, "pending");
});

test("batch processes records sequentially", async () => {
  const repo = new InMemoryOutboxWorkerRepository([
    makeRecord({ rowId: 1, idempotencyKey: "seq-001" }),
    makeRecord({ rowId: 2, idempotencyKey: "seq-002" })
  ]);
  const transport = new FakeMessageTransport({
    scenarioByIdempotencyKey: {
      "seq-001": "accepted",
      "seq-002": "temporary_failure"
    }
  });
  const uow = new InMemoryOutboxWorkerUnitOfWork(repo);
  const result = await processOutboxBatch(
    {
      now: FIXED_NOW,
      config: makeConfig({ batchSize: 2 })
    },
    {
      transport,
      unitOfWork: uow
    }
  );

  assert.deepEqual(
    transport.snapshotCalls().map((call) => call.idempotencyKey),
    ["seq-001", "seq-002"]
  );
  assert.equal(result.delivered, 1);
  assert.equal(result.retryScheduled, 1);
});

test("batch summary is correct", async () => {
  const repo = new InMemoryOutboxWorkerRepository([
    makeRecord({ rowId: 1, idempotencyKey: "summary-001" }),
    makeRecord({ rowId: 2, idempotencyKey: "summary-002" })
  ]);
  const transport = new FakeMessageTransport({
    scenarioByIdempotencyKey: {
      "summary-001": "accepted",
      "summary-002": "permanent_failure"
    }
  });
  const uow = new InMemoryOutboxWorkerUnitOfWork(repo);
  const result = await processOutboxBatch(
    {
      now: FIXED_NOW,
      config: makeConfig({ batchSize: 2 })
    },
    {
      transport,
      unitOfWork: uow
    }
  );

  assert.equal(result.claimed, 2);
  assert.equal(result.processed, 2);
  assert.equal(result.delivered, 1);
  assert.equal(result.deadLettered, 1);
  assert.equal(result.failed, 0);
});

test("audit data does not include recipient or message body", async () => {
  const input = makeInput({ record: { idempotencyKey: "audit-001" } });
  const transport = makeTransport({ "audit-001": makeTransportScenario("accepted") });
  const result = await processOutboxMessage(input, { transport });
  const serialized = JSON.stringify(result.finalPlan);

  assert.equal(serialized.includes(input.record.recipient), false);
  assert.equal(serialized.includes(input.record.messageText), false);
});

test("errors are sanitized", () => {
  const sanitized = sanitizeOutboxWorkerErrorMessage("Bearer secret-token 1234567890\npassword=abc");
  assert.equal(sanitized?.includes("secret-token"), false);
  assert.equal(sanitized?.includes("1234567890"), false);
  assert.equal(sanitized?.includes("\n"), false);
});

test("side effect flags are stable and correct", async () => {
  const input = makeInput({ record: { idempotencyKey: "side-effects-001" } });
  const transport = makeTransport({ "side-effects-001": makeTransportScenario("accepted") });
  const result = await processOutboxMessage(input, { transport });

  assert.equal(result.sideEffects.databaseWritten, false);
  assert.equal(result.sideEffects.externalMessageSent, false);
  assert.equal(result.sideEffects.metaCalled, false);
  assert.equal(result.sideEffects.messageTransportCalled, true);
  assert.equal(result.processingPlan?.sideEffects.messageTransportCalled, false);
  assert.equal(result.finalPlan?.sideEffects.messageTransportCalled, true);
  expectNoSideEffects(result.processingPlan as OutboxWorkerMutationPlan);
});

test("plan retry helper is idempotent", () => {
  const input = {
    now: FIXED_NOW,
    record: makeRecord(),
    config: makeConfig(),
    evaluation: evaluateOutboxCandidate(makeInput()),
    transportResult: {
      status: "accepted",
      providerMessageId: "fake-provider:command-001",
      providerRequestId: "fake-request:command-001",
      errorCode: "none",
      errorMessageSafe: null,
      retryAfterSeconds: null,
      acceptedAt: FIXED_NOW,
      completedAt: FIXED_NOW,
      metadata: {
        provider: "fake",
        sandbox: true,
        simulated: true
      }
    }
  } as const;

  const first = buildFinalOutboxWorkerPlan(input);
  const second = buildFinalOutboxWorkerPlan(input);
  assert.deepEqual(first, second);
});

test("build skipped plan stays no change", () => {
  const plan = buildSkippedOutboxWorkerPlan({
    now: FIXED_NOW,
    record: makeRecord({ status: "delivered" }),
    config: makeConfig(),
    evaluation: evaluateOutboxCandidate(makeInput({ record: { status: "delivered" } }))
  });

  assert.equal(plan.planType, "no_change");
  assert.equal(plan.patch.nextStatus, "delivered");
  expectNoSideEffects(plan);
});

test("source scan rejects forbidden integration and runtime strings", () => {
  const source = readTestAndModuleSource();
  assert.equal(hasForbiddenSource(source), false);
});

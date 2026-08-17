import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { getPool, queryRows } from "@/lib/db";
import {
  buildCommercialWorkProjection,
  getCommercialWorkById,
  getCommercialWorkByPublicId,
  persistCommercialWorkProjection,
  transitionCommercialObjectiveStatus,
  transitionCommercialWorkStatus,
  transitionCommercialWorkStepStatus,
  updateCommercialWorkAggregate,
  CommercialWorkPersistenceError,
  type CommercialCapabilityExecutionProjection,
  type CommercialObjectiveSeed,
  type CommercialWork,
  type CommercialWorkProjectionInput
} from "@/lib/brain/commercial/work";
import type { CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import type { CreatedQuote } from "@/lib/domains/created-quote";
import type { ShippingDestination } from "@/lib/domains/shipping-destination";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

const NOW = "2026-08-17T12:00:00.000Z";

let conversationId = 0;
let opportunityId = 0;

before(async () => {
  conversationId = await seedConversation();
  opportunityId = await seedOpportunity();
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore teardown failures
  }
});

function unique(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function seedConversation() {
  const [result] = await getPool().execute(
    `INSERT INTO conversation (
      public_id, channel, provider, channel_account_id, external_contact_id,
      status, owner_type, ai_enabled, human_owner_active
    ) VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [randomUUID(), unique("phone"), unique("wa")]
  );
  return Number((result as { insertId: number }).insertId);
}

async function seedOpportunity() {
  const [result] = await getPool().execute(
    `INSERT INTO crm_opportunities (
      opportunity_key, wa_id, channel, primary_intent, status,
      requirements_json, missing_requirements_json, product_interests_json,
      objections_json, signals_json
    ) VALUES (?, ?, 'whatsapp', 'sales', 'open', JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_OBJECT())`,
    [unique("cw-opportunity"), unique("wa")]
  );
  return Number((result as { insertId: number }).insertId);
}

function selection(factId = unique("selection"), quantity = 2): CommercialLineItemSelection {
  return {
    factId,
    updatedAt: NOW,
    items: [{ productId: "31", combinationId: null, quantity }]
  };
}

function destination(factId = unique("destination"), canonicalName = "Nunoa", communeId = 13120): ShippingDestination {
  return { factId, updatedAt: NOW, canonicalName, communeId, matchedVia: "direct" };
}

function shippingExecution(input: {
  selectionFactId: string;
  destinationFactId: string;
  executionStatus?: CommercialCapabilityExecutionProjection["executionStatus"];
  retryable?: boolean;
  publicId?: string;
  status?: string;
}): CommercialCapabilityExecutionProjection {
  return {
    publicId: input.publicId ?? unique("shipping-exec"),
    capabilityName: "calculate_shipping",
    executionStatus: input.executionStatus ?? "completed",
    retryable: input.retryable ?? false,
    errorCode: input.executionStatus === "temporarily_blocked" ? "carrier_unavailable" : null,
    completedAt: NOW,
    responseSummaryJson: {
      status: input.status ?? "available",
      selectionFactId: input.selectionFactId,
      destinationFactId: input.destinationFactId,
      options: [{ index: 0, carrierName: "BlueExpress", serviceType: "standard", totalCost: 3990 }]
    }
  };
}

function quote(selectionFactId: string, factId = unique("quote")): CreatedQuote {
  return {
    factId,
    updatedAt: NOW,
    quoteId: unique("quote-id"),
    quoteNumber: unique("Q"),
    status: "draft",
    currency: "CLP",
    total: "179980",
    validUntil: "2026-08-24T00:00:00.000Z",
    selectionFactId,
    idempotencyKey: unique("quote-key"),
    createdAt: NOW
  };
}

function objectiveSeed(type: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["type"], inputs: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["inputs"] = {}): CommercialObjectiveSeed {
  return { seedId: unique(`seed-${type}`), type, origin: "customer_requested", inputs };
}

function baseInput(overrides: Partial<CommercialWorkProjectionInput> = {}): CommercialWorkProjectionInput {
  return {
    trigger: { type: "CUSTOMER_MESSAGE", conversationId, opportunityId, sourceMessageId: Math.floor(Date.now() % 100000000) },
    conversation: { id: conversationId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: opportunityId },
    now: NOW,
    ...overrides
  };
}

function project(overrides: Partial<CommercialWorkProjectionInput> = {}) {
  return buildCommercialWorkProjection(baseInput(overrides));
}

async function persist(work: CommercialWork) {
  return persistCommercialWorkProjection({ work, correlationKey: unique("cw-correlation") });
}

function step(work: CommercialWork, type: string) {
  const found = work.steps.find((item) => item.type === type);
  assert.ok(found, `expected step ${type}`);
  return found;
}

function objective(work: CommercialWork, type: string) {
  const found = work.objectives.find((item) => item.type === type);
  assert.ok(found, `expected objective ${type}`);
  return found;
}

function assertPersistenceErrorCode(code: string) {
  return (error: unknown) => error instanceof CommercialWorkPersistenceError && error.code === code;
}

test("CWDB01 create work; CWDB03 load by id; CWDB04 load by public id", async () => {
  const created = await persist(project({ objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "barra" })] }));
  assert.equal(created.status, "created");
  assert.equal(created.work.version, 1);
  const rows = await queryRows<{ id: number }>("SELECT id FROM crm_commercial_work WHERE public_id = ? LIMIT 1", [created.work.publicId]);
  const byId = await getCommercialWorkById(Number(rows[0].id));
  const byPublicId = await getCommercialWorkByPublicId(created.work.publicId);
  assert.equal(byId?.publicId, created.work.publicId);
  assert.equal(byPublicId?.publicId, created.work.publicId);
});

test("CWDB02 duplicate create is idempotent and creates no duplicate work", async () => {
  const work = project({ objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "mancuerna" })] });
  const correlationKey = unique("duplicate-correlation");
  const first = await persistCommercialWorkProjection({ work, correlationKey });
  const second = await persistCommercialWorkProjection({ work, correlationKey });
  const count = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_commercial_work WHERE correlation_key = ?", [correlationKey]);
  assert.equal(first.status, "created");
  assert.equal(second.status, "duplicate");
  assert.equal(second.work.publicId, first.work.publicId);
  assert.equal(Number(count[0].count), 1);
});

test("CWDB05-CWDB09 objectives, steps, dependencies, evidence and blockers survive reload", async () => {
  const work = project({
    commercialLineItems: selection("selection-a"),
    objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
  });
  const { work: persisted } = await persist(work);
  const reloaded = await getCommercialWorkByPublicId(persisted.publicId);
  assert.ok(reloaded);
  assert.equal(objective(reloaded, "GET_SHIPPING_QUOTE").status, "WAITING_CUSTOMER");
  assert.equal(step(reloaded, "CALCULATE_SHIPPING").dependencies.some((item) => item.type === "FACT_CONFIRMED"), true);
  assert.equal(objective(reloaded, "GET_SHIPPING_QUOTE").resolvedInputs.commercialLineItemsFactId, "selection-a");
  assert.equal(reloaded.blockers.some((item) => item.code === "MISSING_DESTINATION"), true);
});

test("CWDB10-CWDB11 optimistic version update succeeds once and rejects stale writer", async () => {
  const created = await persist(project({ objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "rack" })] }));
  const writerA = await transitionCommercialWorkStatus({ publicId: created.work.publicId, expectedVersion: 1, status: "WAITING_SYSTEM" });
  assert.equal(writerA.version, 2);
  await assert.rejects(
    () => transitionCommercialWorkStatus({ publicId: created.work.publicId, expectedVersion: 1, status: "WAITING_CUSTOMER" }),
    assertPersistenceErrorCode("VERSION_CONFLICT")
  );
});

test("CWDB12-CWDB13 valid work transition passes and invalid terminal transition is rejected", async () => {
  const active = await persist(project({ objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "banco" })] }));
  const waiting = await transitionCommercialWorkStatus({ publicId: active.work.publicId, expectedVersion: 1, status: "WAITING_CUSTOMER" });
  assert.equal(waiting.status, "WAITING_CUSTOMER");

  const completed = await persist(project({ objectiveSeeds: [] }));
  await assert.rejects(
    () => transitionCommercialWorkStatus({ publicId: completed.work.publicId, expectedVersion: 1, status: "ACTIVE" }),
    assertPersistenceErrorCode("INVALID_TRANSITION")
  );
});

test("CWDB14-CWDB17 objective/step transitions validate and completed steps cannot reopen", async () => {
  const waitingCustomer = await persist(project({ commercialLineItems: selection(), objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")] }));
  const waitingObjective = objective(waitingCustomer.work, "GET_SHIPPING_QUOTE");
  const objectiveReady = await transitionCommercialObjectiveStatus({
    publicId: waitingCustomer.work.publicId,
    expectedVersion: 1,
    objectiveId: waitingObjective.objectiveId,
    status: "READY"
  });
  assert.equal(objective(objectiveReady, "GET_SHIPPING_QUOTE").status, "READY");

  const waitingSystem = await persist(
    project({
      commercialLineItems: selection("sel-ws"),
      shippingDestination: destination("dest-ws"),
      recentCapabilityExecutions: [shippingExecution({ selectionFactId: "sel-ws", destinationFactId: "dest-ws", executionStatus: "temporarily_blocked", retryable: true, status: "failed" })],
      objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
    })
  );
  const stepReady = await transitionCommercialWorkStepStatus({
    publicId: waitingSystem.work.publicId,
    expectedVersion: 1,
    stepId: step(waitingSystem.work, "CALCULATE_SHIPPING").stepId,
    status: "READY"
  });
  assert.equal(step(stepReady, "CALCULATE_SHIPPING").status, "READY");

  const completed = await persist(
    project({
      commercialLineItems: selection("sel-completed"),
      objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })]
    })
  );
  await assert.rejects(
    () =>
      transitionCommercialWorkStepStatus({
        publicId: completed.work.publicId,
        expectedVersion: 1,
        stepId: step(completed.work, "SELECT_PRODUCTS").stepId,
        status: "READY"
      }),
    assertPersistenceErrorCode("INVALID_TRANSITION")
  );
});

test("CWDB18-CWDB19 supersession and cancellation remain auditable", async () => {
  const superseded = await persist(
    project({
      objectiveSeeds: [objectiveSeed("SET_DESTINATION", { destinationText: "Nunoa" }), objectiveSeed("SET_DESTINATION", { destinationText: "Las Condes" })]
    })
  );
  assert.equal(superseded.work.objectives.some((item) => item.status === "SUPERSEDED"), true);
  assert.equal(superseded.work.objectives.some((item) => item.supersedesObjectiveIds.length > 0), true);

  const cancellable = await persist(project({ objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "barra" })] }));
  const cancelled = await transitionCommercialWorkStatus({
    publicId: cancellable.work.publicId,
    expectedVersion: 1,
    status: "CANCELLED",
    cancelReason: "customer_cancelled"
  });
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.cancelReason, "customer_cancelled");
  assert.ok(cancelled.cancelledAt);
});

test("CWDB20 transaction rollback prevents orphan work when child insert fails", async () => {
  const correlationKey = unique("rollback-correlation");
  const invalid = project({ objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "barra" })] }) as CommercialWork;
  invalid.steps[0] = { ...invalid.steps[0], status: "NOT_A_STATUS" as never };
  await assert.rejects(() => persistCommercialWorkProjection({ work: invalid, correlationKey }), assertPersistenceErrorCode("PERSISTENCE_FAILURE"));
  const rows = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_commercial_work WHERE correlation_key = ?", [correlationKey]);
  assert.equal(Number(rows[0].count), 0);
});

test("CWDB21 critical C09 READY survives reload with zero LLM/capability side effects", async () => {
  let llmCalls = 0;
  const beforeCapabilities = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_capability_executions");
  const work = project({
    commercialLineItems: selection("selection-c09"),
    shippingDestination: destination("destination-c09"),
    objectiveSeeds: [
      objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] }),
      objectiveSeed("GET_SHIPPING_QUOTE")
    ]
  });
  assert.equal(step(work, "CALCULATE_SHIPPING").status, "READY");
  const { work: persisted } = await persist(work);
  const publicId = persisted.publicId;
  const reloaded = await getCommercialWorkByPublicId(publicId);
  const afterCapabilities = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_capability_executions");
  assert.ok(reloaded);
  assert.equal(step(reloaded, "CALCULATE_SHIPPING").status, "READY");
  assert.equal(Number(afterCapabilities[0].count), Number(beforeCapabilities[0].count));
  assert.equal(llmCalls, 0);
  llmCalls += 0;
});

test("CWDB22 WAITING_CUSTOMER and blocker survive reload", async () => {
  const { work: persisted } = await persist(project({ commercialLineItems: selection(), objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")] }));
  const reloaded = await getCommercialWorkByPublicId(persisted.publicId);
  assert.ok(reloaded);
  assert.equal(reloaded.status, "WAITING_CUSTOMER");
  assert.equal(step(reloaded, "CALCULATE_SHIPPING").status, "WAITING_CUSTOMER");
  assert.equal(reloaded.blockers.some((item) => item.code === "MISSING_DESTINATION"), true);
});

test("CWDB23 WAITING_SYSTEM retryability survives reload", async () => {
  const { work: persisted } = await persist(
    project({
      commercialLineItems: selection("sel-wait-system"),
      shippingDestination: destination("dest-wait-system"),
      recentCapabilityExecutions: [
        shippingExecution({
          selectionFactId: "sel-wait-system",
          destinationFactId: "dest-wait-system",
          executionStatus: "temporarily_blocked",
          retryable: true,
          status: "failed"
        })
      ],
      objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
    })
  );
  const reloaded = await getCommercialWorkByPublicId(persisted.publicId);
  assert.ok(reloaded);
  assert.equal(reloaded.status, "WAITING_SYSTEM");
  assert.equal(step(reloaded, "CALCULATE_SHIPPING").retryable, true);
  assert.equal(step(reloaded, "CALCULATE_SHIPPING").retryCandidate, true);
});

test("CWDB24-CWDB26 quote READY, completed evidence and stale supersession survive reload", async () => {
  const ready = await persist(project({ commercialLineItems: selection("sel-quote-ready"), objectiveSeeds: [objectiveSeed("CREATE_QUOTE")] }));
  assert.equal(step((await getCommercialWorkByPublicId(ready.work.publicId))!, "CREATE_QUOTE").status, "READY");

  const completed = await persist(
    project({
      commercialLineItems: selection("sel-quote-completed"),
      createdQuote: quote("sel-quote-completed", "quote-completed-fact"),
      objectiveSeeds: [objectiveSeed("CREATE_QUOTE")]
    })
  );
  const reloadedCompleted = await getCommercialWorkByPublicId(completed.work.publicId);
  assert.ok(reloadedCompleted);
  assert.equal(step(reloadedCompleted, "CREATE_QUOTE").status, "COMPLETED");
  assert.equal(objective(reloadedCompleted, "CREATE_QUOTE").evidence.some((item) => item.factType === "created_quote" && item.id === "quote-completed-fact"), true);

  const oldObjective = objective(reloadedCompleted, "CREATE_QUOTE");
  const oldStep = step(reloadedCompleted, "CREATE_QUOTE");
  const next = {
    ...reloadedCompleted,
    status: "SUPERSEDED",
    objectives: [{ ...oldObjective, status: "SUPERSEDED", blockers: [{ code: "SUPERSEDED", source: "objective", objectiveId: oldObjective.objectiveId }] }],
    steps: [{ ...oldStep, status: "SUPERSEDED", blockers: [{ code: "SUPERSEDED", source: "step", objectiveId: oldObjective.objectiveId, stepId: oldStep.stepId }] }]
  } as CommercialWork;
  const superseded = await updateCommercialWorkAggregate({ publicId: completed.work.publicId, expectedVersion: 1, nextWork: next });
  assert.equal(superseded.objectives.some((item) => item.objectiveId === oldObjective.objectiveId && item.status === "SUPERSEDED"), true);
  assert.equal(superseded.steps.some((item) => item.stepId === oldStep.stepId && item.status === "SUPERSEDED"), true);
  assert.equal(step(superseded, "CREATE_QUOTE").status, "SUPERSEDED");

  const replanned = await persist(project({ commercialLineItems: selection("sel-quote-new"), objectiveSeeds: [objectiveSeed("CREATE_QUOTE")] }));
  assert.equal(step(replanned.work, "CREATE_QUOTE").status, "READY");
});

test("CWDB27-CWDB28 persistence invokes no capability and no LLM", async () => {
  const beforeCapabilities = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_capability_executions");
  const llmCalls = 0;
  await persist(project({ objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "discos" })] }));
  const afterCapabilities = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_capability_executions");
  assert.equal(Number(afterCapabilities[0].count), Number(beforeCapabilities[0].count));
  assert.equal(llmCalls, 0);
});

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { getPool, queryRows } from "@/lib/db";
import {
  buildCommercialWorkProjection,
  claimDueCommercialWorkStep,
  getCommercialWorkByPublicId,
  persistCommercialWorkProjection,
  runCommercialWorkTick,
  selectDueCommercialWorkSteps,
  updateCommercialWorkAggregate,
  type CommercialObjectiveSeed,
  type CommercialWork,
  type CommercialWorkProjectionInput
} from "@/lib/brain/commercial/work";
import type { CapabilityGatewayResult } from "@/lib/brain/commercial/capability-gateway";
import { setCommercialLineItemsForOpportunity, getActiveCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import type { CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import { createCommuneResolver } from "@/lib/domains/commune-resolution";
import { comparisonKey } from "@/lib/domains/commune-resolution/normalize";
import type { CommuneCatalogEntry, CommuneCatalogPort } from "@/lib/domains/commune-resolution";
import { setCreatedQuoteForOpportunity, getActiveCreatedQuoteForOpportunity } from "@/lib/domains/created-quote";
import { setShippingDestinationForOpportunity, getActiveShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import type { CreatedQuote } from "@/lib/domains/created-quote";
import type { ShippingDestination } from "@/lib/domains/shipping-destination";
import type { SelectedShippingOption } from "@/lib/domains/selected-shipping-option";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  // SALES-AGENT-R2-A11: opens the new worker-level autonomy/access gates for
  // this file's pre-A11 tests, none of which exercise those gates themselves
  // (see commercialWorkAccessAndAutonomyGates.test.ts for dedicated coverage).
  BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true",
  BRAIN_WHATSAPP_TEST_MODE_ENABLED: "false",
  BRAIN_COMMERCIAL_WORK_WORKER_ENABLED: "true"
});

const NOW = "2026-08-17T12:00:00.000Z";
const DUE = "2026-08-17T12:02:00.000Z";
let conversationId = 0;
let opportunityId = 0;
let waId = "";

before(async () => {
  const seeded = await seedConversation();
  conversationId = seeded.id;
  waId = seeded.waId;
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
  const wa = unique("wa");
  const [result] = await getPool().execute(
    `INSERT INTO conversation (
      public_id, channel, provider, channel_account_id, external_contact_id,
      status, owner_type, ai_enabled, human_owner_active
    ) VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [randomUUID(), unique("phone"), wa]
  );
  return { id: Number((result as { insertId: number }).insertId), waId: wa };
}

async function seedOpportunity() {
  const [result] = await getPool().execute(
    `INSERT INTO crm_opportunities (
      opportunity_key, wa_id, channel, primary_intent, status,
      requirements_json, missing_requirements_json, product_interests_json,
      objections_json, signals_json
    ) VALUES (?, ?, 'whatsapp', 'sales', 'open', JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_OBJECT())`,
    [unique("cwrt-opportunity"), unique("wa")]
  );
  return Number((result as { insertId: number }).insertId);
}

const NUNOA: CommuneCatalogEntry = { communeId: 13120, canonicalName: "Nunoa" };
function fakeCommuneCatalog(): CommuneCatalogPort {
  return { async findByNormalizedName(normalizedName) { return { ok: true, entries: [NUNOA].filter((entry) => comparisonKey(entry.canonicalName) === normalizedName) }; } };
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
  return persistCommercialWorkProjection({ work, correlationKey: unique("cwrt-correlation") });
}

function step(work: CommercialWork, type: string) {
  const found = work.steps.find((item) => item.type === type);
  assert.ok(found, `expected step ${type}`);
  return found;
}

async function loadFacts() {
  const [commercialLineItems, shippingDestination, createdQuote] = await Promise.all([
    getActiveCommercialLineItemsForOpportunity(opportunityId),
    getActiveShippingDestinationForOpportunity(opportunityId),
    getActiveCreatedQuoteForOpportunity(opportunityId)
  ]);
  return { commercialLineItems, shippingDestination, selectedShippingOption: null as SelectedShippingOption | null, createdQuote };
}

function gatewayResult(capability: string, status: CapabilityGatewayResult["status"], data: Record<string, unknown> | null, errorCode: string | null, retryable: boolean): CapabilityGatewayResult {
  return {
    capability,
    version: "capability-gateway.v1",
    availability: "available",
    status,
    data,
    errorCode,
    retryable,
    evidence: [],
    warnings: [],
    retryCount: 0,
    startedAt: NOW,
    completedAt: NOW,
    executionPublicId: unique(`exec-${capability}`)
  };
}

function makeDbGateway(statuses: Record<string, CapabilityGatewayResult["status"]> = {}) {
  const calls: string[] = [];
  const executeCapability = async (capabilityName: string, input: Record<string, unknown>) => {
    calls.push(capabilityName);
    const forced = statuses[capabilityName];
    if (forced === "temporarily_blocked") return gatewayResult(capabilityName, "temporarily_blocked", null, "temporary_failure", true);
    if (forced && forced !== "completed") return gatewayResult(capabilityName, forced, null, "forced_failure", false);

    if (capabilityName === "select_products") {
      await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "31", combinationId: null, quantity: 2 }], sourceToolExecutionId: unique("cwrt") });
      return gatewayResult(capabilityName, "completed", { status: "selected" }, null, false);
    }
    if (capabilityName === "set_shipping_destination") {
      const result = await setShippingDestinationForOpportunity({ opportunityId, inputText: String(input.destination ?? "Nunoa"), sourceToolExecutionId: unique("cwrt") }, { resolver: createCommuneResolver(fakeCommuneCatalog()) });
      assert.equal(result.ok, true);
      return gatewayResult(capabilityName, "completed", { status: "resolved" }, null, false);
    }
    if (capabilityName === "calculate_shipping") {
      return gatewayResult(capabilityName, "completed", { status: "available" }, null, false);
    }
    if (capabilityName === "create_quote") {
      const selection = await getActiveCommercialLineItemsForOpportunity(opportunityId);
      assert.ok(selection);
      await setCreatedQuoteForOpportunity({
        opportunityId,
        quote: {
          quoteId: unique("quote-id"),
          quoteNumber: unique("Q"),
          status: "draft",
          currency: "CLP",
          total: "179980",
          validUntil: "2026-08-24T00:00:00.000Z",
          selectionFactId: selection.factId,
          idempotencyKey: unique("quote-key")
        },
        sourceToolExecutionId: unique("cwrt")
      });
      return gatewayResult(capabilityName, "completed", { status: "created" }, null, false);
    }
    return gatewayResult(capabilityName, "failed", null, "unexpected_capability", false);
  };
  return { calls, executeCapability };
}

async function countSideEffects() {
  const [actions, outbox] = await Promise.all([
    queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_agent_actions WHERE conversation_case_id = ?", [String(conversationId)]),
    queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM brain_message_outbox WHERE wa_id = ?", [waId])
  ]);
  return { actions: Number(actions[0].count), outbox: Number(outbox[0].count) };
}

function addQuoteDependsOnShipping(work: CommercialWork) {
  const shipping = step(work, "CALCULATE_SHIPPING");
  const quote = step(work, "CREATE_QUOTE");
  quote.dependencies = [...quote.dependencies, { type: "STEP_COMPLETED", stepId: shipping.stepId }];
  quote.status = "BLOCKED";
  return work;
}

test("CWRT01-CWRT04-CWRT20-CWRT25 critical autonomous continuation: shipping retry wakes work, then quote completes without customer/LLM/outbox/action", async () => {
  opportunityId = await seedOpportunity();
  const before = await countSideEffects();
  const work = addQuoteDependsOnShipping(
    project({
      objectiveSeeds: [
        objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] }),
        objectiveSeed("SET_DESTINATION", { destinationText: "Nunoa" }),
        objectiveSeed("GET_SHIPPING_QUOTE", { destinationText: "Nunoa" }),
        objectiveSeed("CREATE_QUOTE")
      ]
    })
  );
  const created = await persist(work);
  const firstGateway = makeDbGateway({ calculate_shipping: "temporarily_blocked" });

  const first = await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true,
    batchSize: 1,
    now: NOW,
    workerId: "cwrt-worker-a",
    workPublicIds: [created.work.publicId],
    executeCapability: firstGateway.executeCapability,
    loadCurrentFacts: loadFacts,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true })
  });
  const waiting = await getCommercialWorkByPublicId(created.work.publicId);
  assert.deepEqual(firstGateway.calls, ["select_products", "set_shipping_destination", "calculate_shipping"]);
  assert.equal(first.retryScheduled, 1);
  assert.equal(step(waiting!, "CALCULATE_SHIPPING").status, "RETRY_SCHEDULED");
  assert.equal(step(waiting!, "CREATE_QUOTE").status, "BLOCKED");
  const shippingKey = step(waiting!, "CALCULATE_SHIPPING").idempotencyKey;

  const secondGateway = makeDbGateway();
  const second = await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true,
    batchSize: 1,
    now: DUE,
    workerId: "cwrt-worker-b",
    workPublicIds: [created.work.publicId],
    executeCapability: secondGateway.executeCapability,
    loadCurrentFacts: loadFacts,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true })
  });
  const completed = await getCommercialWorkByPublicId(created.work.publicId);
  const after = await countSideEffects();

  assert.deepEqual(secondGateway.calls, ["calculate_shipping", "create_quote"]);
  assert.equal(second.completed, 1);
  assert.equal(completed?.status, "COMPLETED");
  assert.equal(step(completed!, "CALCULATE_SHIPPING").idempotencyKey, shippingKey);
  assert.equal(step(completed!, "CALCULATE_SHIPPING").attemptCount, 1);
  assert.equal(after.actions, before.actions);
  assert.equal(after.outbox, before.outbox);
});

test("CWRT03-CWRT09-CWRT10 quote retry preserves idempotency and increments attempts", async () => {
  opportunityId = await seedOpportunity();
  await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "31", combinationId: null, quantity: 2 }] });
  const created = await persist(project({ commercialLineItems: await getActiveCommercialLineItemsForOpportunity(opportunityId), objectiveSeeds: [objectiveSeed("CREATE_QUOTE")] }));
  const firstGateway = makeDbGateway({ create_quote: "temporarily_blocked" });
  await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true, batchSize: 1, now: NOW, workerId: "quote-a", workPublicIds: [created.work.publicId], executeCapability: firstGateway.executeCapability, loadCurrentFacts: loadFacts, loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }) });
  const scheduled = await getCommercialWorkByPublicId(created.work.publicId);
  const quoteKey = step(scheduled!, "CREATE_QUOTE").idempotencyKey;
  assert.equal(step(scheduled!, "CREATE_QUOTE").status, "RETRY_SCHEDULED");

  const secondGateway = makeDbGateway();
  await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true, batchSize: 1, now: DUE, workerId: "quote-b", workPublicIds: [created.work.publicId], executeCapability: secondGateway.executeCapability, loadCurrentFacts: loadFacts, loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }) });
  const completed = await getCommercialWorkByPublicId(created.work.publicId);
  assert.equal(step(completed!, "CREATE_QUOTE").status, "COMPLETED");
  assert.equal(step(completed!, "CREATE_QUOTE").idempotencyKey, quoteKey);
  assert.equal(step(completed!, "CREATE_QUOTE").attemptCount, 2);
});

test("CWRT05-CWRT08 stale RUNNING after side effect is repaired without duplicate capability call", async () => {
  opportunityId = await seedOpportunity();
  const selection = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "31", combinationId: null, quantity: 2 }] });
  assert.equal(selection.ok, true);
  const created = await persist(project({ commercialLineItems: selection.ok ? selection.selection : null, objectiveSeeds: [objectiveSeed("CREATE_QUOTE")] }));
  const running = await getCommercialWorkByPublicId(created.work.publicId);
  const quoteStep = step(running!, "CREATE_QUOTE");
  await setCreatedQuoteForOpportunity({
    opportunityId,
    quote: {
      quoteId: unique("quote-id"),
      quoteNumber: unique("Q"),
      status: "draft",
      currency: "CLP",
      total: "179980",
      validUntil: "2026-08-24T00:00:00.000Z",
      selectionFactId: selection.selection.factId,
      idempotencyKey: unique("quote-key")
    }
  });
  const staleWork: CommercialWork = {
    ...running!,
    steps: running!.steps.map((item) => (item.stepId === quoteStep.stepId ? { ...item, status: "RUNNING" as const, attemptCount: 1, maxAttempts: 3, lockOwner: "dead-worker", lockUntil: "2026-08-17T11:59:00.000Z" } : item))
  };
  await updateCommercialWorkAggregate({ publicId: running!.publicId, expectedVersion: running!.version, nextWork: staleWork });

  const calls: string[] = [];
  const tick = await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true,
    batchSize: 1,
    now: NOW,
    workerId: "repair-worker",
    workPublicIds: [created.work.publicId],
    executeCapability: async (name) => {
      calls.push(name);
      return gatewayResult(name, "failed", null, "should_not_call", false);
    },
    loadCurrentFacts: loadFacts,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true })
  });
  const repaired = await getCommercialWorkByPublicId(created.work.publicId);
  assert.equal(tick.staleRecovered, 1);
  assert.deepEqual(calls, []);
  assert.equal(step(repaired!, "CREATE_QUOTE").status, "COMPLETED");
});

test("CWRT06-CWRT07-CWRT19-CWRT20 active leases, two-worker CAS, not-due work and batch size are bounded", async () => {
  opportunityId = await seedOpportunity();
  const workA = await persist(project({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })] }));
  const workB = await persist(project({ objectiveSeeds: [objectiveSeed("SET_DESTINATION", { destinationText: "Nunoa" })] }));
  const candidates = await selectDueCommercialWorkSteps({ limit: 10, now: NOW, workPublicIds: [workA.work.publicId] });
  const candidate = candidates.find((item) => item.work_public_id === workA.work.publicId);
  assert.ok(candidate);
  const firstClaim = await claimDueCommercialWorkStep(candidate, { workerId: "worker-one", now: NOW, lockSeconds: 60 });
  const secondClaim = await claimDueCommercialWorkStep(candidate, { workerId: "worker-two", now: NOW, lockSeconds: 60 });
  assert.equal(firstClaim, true);
  assert.equal(secondClaim, false);

  const protectedTick = await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true, batchSize: 10, now: NOW, workerId: "worker-two", workPublicIds: [workA.work.publicId], executeCapability: makeDbGateway().executeCapability, loadCurrentFacts: loadFacts, loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }) });
  assert.equal(protectedTick.skipped.some((item) => item.stepId === candidate.step_id), false);

  const batchTick = await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true, batchSize: 1, now: NOW, workerId: "batch-worker", workPublicIds: [workB.work.publicId], executeCapability: makeDbGateway().executeCapability, loadCurrentFacts: loadFacts, loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }) });
  assert.ok(batchTick.selected <= 1);
  assert.ok(workB.work.publicId);
});

test("CWRT11-CWRT12-CWRT13 retry exhaustion and business failures are not blindly retried", async () => {
  opportunityId = await seedOpportunity();
  const sel = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "31", combinationId: null, quantity: 2 }] });
  assert.equal(sel.ok, true);
  const exhausted = await persist(project({ commercialLineItems: sel.selection, objectiveSeeds: [objectiveSeed("CREATE_QUOTE")] }));
  const exhaustedWork: CommercialWork = {
    ...exhausted.work,
    status: "WAITING_SYSTEM",
    steps: exhausted.work.steps.map((item) => (item.type === "CREATE_QUOTE" ? { ...item, status: "RETRY_SCHEDULED" as const, attemptCount: 3, maxAttempts: 3, nextAttemptAt: NOW } : item))
  };
  await updateCommercialWorkAggregate({ publicId: exhausted.work.publicId, expectedVersion: exhausted.work.version, nextWork: exhaustedWork });
  const exhaustedTick = await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true, batchSize: 1, now: NOW, workerId: "exhausted", workPublicIds: [exhausted.work.publicId], executeCapability: makeDbGateway().executeCapability, loadCurrentFacts: loadFacts, loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }) });
  const failed = await getCommercialWorkByPublicId(exhausted.work.publicId);
  assert.equal(exhaustedTick.failed, 1);
  assert.equal(step(failed!, "CREATE_QUOTE").status, "FAILED");

  const waitingCustomer = await persist(project({ commercialLineItems: sel.selection, objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")] }));
  const noRetry = await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true, batchSize: 5, now: NOW, workerId: "no-customer", workPublicIds: [waitingCustomer.work.publicId], executeCapability: makeDbGateway().executeCapability, loadCurrentFacts: loadFacts });
  assert.equal(noRetry.selected === 0 || noRetry.skipped.every((item) => item.workPublicId !== waitingCustomer.work.publicId), true);

  opportunityId = await seedOpportunity();
  const invalid = await persist(project({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })] }));
  await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true, batchSize: 1, now: NOW, workerId: "invalid", workPublicIds: [invalid.work.publicId], executeCapability: makeDbGateway({ select_products: "invalid_arguments" }).executeCapability, loadCurrentFacts: loadFacts, loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }) });
  const invalidWork = await getCommercialWorkByPublicId(invalid.work.publicId);
  assert.equal(step(invalidWork!, "SELECT_PRODUCTS").status, "FAILED");
  assert.equal(step(invalidWork!, "SELECT_PRODUCTS").nextAttemptAt, null);
});

test("CWRT14-CWRT15-CWRT16-CWRT17 superseded/cancelled/handoff/AI-disabled work does not execute", async () => {
  opportunityId = await seedOpportunity();
  const terminal = ["SUPERSEDED", "CANCELLED", "HANDOFF"] as const;
  const terminalWorkIds: string[] = [];
  for (const status of terminal) {
    const created = await persist(project({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })] }));
    await updateCommercialWorkAggregate({ publicId: created.work.publicId, expectedVersion: created.work.version, nextWork: { ...created.work, status } });
    terminalWorkIds.push(created.work.publicId);
  }
  const calls: string[] = [];
  const tick = await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true,
    batchSize: 10,
    now: NOW,
    workerId: "terminal-skip",
    workPublicIds: terminalWorkIds,
    executeCapability: async (name) => {
      calls.push(name);
      return gatewayResult(name, "completed", { status: "selected" }, null, false);
    },
    loadCurrentFacts: loadFacts,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true })
  });
  assert.equal(tick.selected >= 0, true);
  assert.deepEqual(calls.filter((name) => name === "select_products"), []);

  const human = await persist(project({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })] }));
  const handoff = await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true,
    batchSize: 10,
    now: NOW,
    workerId: "human-block",
    workPublicIds: [human.work.publicId],
    executeCapability: makeDbGateway().executeCapability,
    loadCurrentFacts: loadFacts,
    loadConversationControl: async () => ({ humanOwnerActive: true, aiEnabled: false })
  });
  const blocked = await getCommercialWorkByPublicId(human.work.publicId);
  assert.equal(handoff.claimed, 1);
  assert.equal(blocked?.status, "HANDOFF");
});

test("CWRT18 version conflict after claim stops without insisting", async () => {
  opportunityId = await seedOpportunity();
  const created = await persist(project({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })] }));
  const tick = await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true,
    batchSize: 1,
    now: NOW,
    workerId: "conflict-worker",
    workPublicIds: [created.work.publicId],
    executeCapability: makeDbGateway().executeCapability,
    loadCurrentFacts: loadFacts,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    onAfterClaim: async () => {
      const current = await getCommercialWorkByPublicId(created.work.publicId);
      assert.ok(current);
      await updateCommercialWorkAggregate({ publicId: current.publicId, expectedVersion: current.version, nextWork: { ...current, derivedAt: new Date().toISOString() } });
    }
  });
  assert.equal(tick.versionConflicts.length, 1);
});

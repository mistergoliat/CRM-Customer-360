import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { getPool, queryRows } from "@/lib/db";
import {
  buildCommercialWorkProjection,
  executeCommercialWork,
  getCommercialWorkByPublicId,
  persistCommercialWorkProjection,
  type CommercialObjectiveSeed,
  type CommercialWork,
  type CommercialWorkProjectionInput,
  type ExecuteCommercialWorkInput
} from "@/lib/brain/commercial/work";
import type { CapabilityGatewayResult } from "@/lib/brain/commercial/capability-gateway";
import type { CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import type { CreatedQuote } from "@/lib/domains/created-quote";
import type { SelectedShippingOption } from "@/lib/domains/selected-shipping-option";
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
    [unique("cwex-opportunity"), unique("wa")]
  );
  return Number((result as { insertId: number }).insertId);
}

function selection(factId = unique("selection"), quantity = 2): CommercialLineItemSelection {
  return { factId, updatedAt: NOW, items: [{ productId: "31", combinationId: null, quantity }] };
}

function destination(factId = unique("destination"), canonicalName = "Nunoa"): ShippingDestination {
  return { factId, updatedAt: NOW, communeId: 13120, canonicalName, matchedVia: "direct" };
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

function selectedShippingOption(selectionFactId: string, destinationFactId: string): SelectedShippingOption {
  return {
    factId: unique("selected-shipping"),
    updatedAt: NOW,
    carrierName: "BlueExpress",
    serviceType: "standard",
    totalCost: 3990,
    estimatedDelivery: "2 dias",
    optionIndex: 0,
    shippingQuoteExecutionId: unique("shipping-exec"),
    shippingQuoteCorrelationId: null,
    selectionFactId,
    destinationFactId,
    calculatedAt: NOW,
    selectedAt: NOW
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
  return persistCommercialWorkProjection({ work, correlationKey: unique("cwex-correlation") });
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

type MutableFacts = {
  commercialLineItems: CommercialLineItemSelection | null;
  shippingDestination: ShippingDestination | null;
  selectedShippingOption: SelectedShippingOption | null;
  createdQuote: CreatedQuote | null;
};

function makeGateway(facts: MutableFacts, statuses: Record<string, CapabilityGatewayResult["status"]> = {}) {
  const calls: Array<{ capabilityName: string; input: Record<string, unknown> }> = [];
  const executeCapability: ExecuteCommercialWorkInput["executeCapability"] = async (capabilityName, input) => {
    calls.push({ capabilityName, input });
    const status = statuses[capabilityName] ?? "completed";
    if (status === "temporarily_blocked") return gatewayResult(capabilityName, status, null, "temporary_failure", true);
    if (status !== "completed") return gatewayResult(capabilityName, status, null, "forced_failure", false);

    if (capabilityName === "select_products") facts.commercialLineItems = selection(unique("selection"), 2);
    if (capabilityName === "set_shipping_destination") facts.shippingDestination = destination(unique("destination"), String(input.destination ?? "Nunoa"));
    if (capabilityName === "calculate_shipping" && facts.commercialLineItems && facts.shippingDestination) {
      facts.selectedShippingOption = selectedShippingOption(facts.commercialLineItems.factId, facts.shippingDestination.factId);
    }
    if (capabilityName === "create_quote" && facts.commercialLineItems) facts.createdQuote = quote(facts.commercialLineItems.factId);

    return gatewayResult(capabilityName, "completed", { status: capabilityName === "calculate_shipping" ? "available" : capabilityName === "create_quote" ? "created" : "selected" }, null, false);
  };
  return { calls, executeCapability };
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

function baseExecutionInput(workPublicId: string, expectedVersion: number, facts: MutableFacts, executeCapability: ExecuteCommercialWorkInput["executeCapability"], overrides: Partial<ExecuteCommercialWorkInput> = {}): ExecuteCommercialWorkInput {
  return {
    workPublicId,
    expectedVersion,
    context: { correlationId: unique("corr"), conversationId, opportunityId },
    loadCurrentFacts: async () => facts,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    executeCapability,
    ...overrides
  };
}

test("CWEX01-CWEX03 loads by public id + expected version, rejects stale version, and never mutates stale work", async () => {
  const created = await persist(project({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })] }));
  const facts: MutableFacts = { commercialLineItems: null, shippingDestination: null, selectedShippingOption: null, createdQuote: null };
  const gateway = makeGateway(facts);

  const stale = await executeCommercialWork(baseExecutionInput(created.work.publicId, created.work.version + 1, facts, gateway.executeCapability));
  assert.equal(stale.outcome, "version_conflict");
  assert.equal(gateway.calls.length, 0);
  assert.equal((await getCommercialWorkByPublicId(created.work.publicId))?.version, created.work.version);
});

test("CWEX04-CWEX09 executes the C09 bundle sequentially, persists after each step, and completes the work", async () => {
  const created = await persist(
    project({
      objectiveSeeds: [
        objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] }),
        objectiveSeed("SET_DESTINATION", { destinationText: "Nunoa" }),
        objectiveSeed("GET_SHIPPING_QUOTE", { destinationText: "Nunoa" })
      ]
    })
  );
  const facts: MutableFacts = { commercialLineItems: null, shippingDestination: null, selectedShippingOption: null, createdQuote: null };
  const gateway = makeGateway(facts);

  const result = await executeCommercialWork(baseExecutionInput(created.work.publicId, 1, facts, gateway.executeCapability));
  assert.equal(result.outcome, "executed");
  assert.deepEqual(gateway.calls.map((call) => call.capabilityName), ["select_products", "set_shipping_destination", "calculate_shipping"]);
  assert.equal(result.executedStepCount, 3);
  assert.equal(result.finalVersion, 4);
  assert.equal(result.work?.status, "COMPLETED");
  assert.equal(step(result.work!, "CALCULATE_SHIPPING").status, "COMPLETED");
});

test("CWEX10-CWEX11 respects maxSteps and resumes from the persisted version", async () => {
  const created = await persist(
    project({
      objectiveSeeds: [
        objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] }),
        objectiveSeed("SET_DESTINATION", { destinationText: "Nunoa" }),
        objectiveSeed("GET_SHIPPING_QUOTE", { destinationText: "Nunoa" })
      ]
    })
  );
  const facts: MutableFacts = { commercialLineItems: null, shippingDestination: null, selectedShippingOption: null, createdQuote: null };
  const gateway = makeGateway(facts);

  const first = await executeCommercialWork(baseExecutionInput(created.work.publicId, 1, facts, gateway.executeCapability, { maxSteps: 1 }));
  assert.equal(first.outcome, "max_steps_reached");
  assert.equal(first.finalVersion, 2);
  assert.deepEqual(gateway.calls.map((call) => call.capabilityName), ["select_products"]);

  const second = await executeCommercialWork(baseExecutionInput(created.work.publicId, first.finalVersion!, facts, gateway.executeCapability));
  assert.equal(second.work?.status, "COMPLETED");
  assert.deepEqual(gateway.calls.map((call) => call.capabilityName), ["select_products", "set_shipping_destination", "calculate_shipping"]);
});

test("CWEX12-CWEX14 repairs already-current evidence and skips completed work without gateway calls", async () => {
  const created = await persist(project({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })] }));
  const facts: MutableFacts = { commercialLineItems: selection("selection-existing"), shippingDestination: null, selectedShippingOption: null, createdQuote: null };
  const gateway = makeGateway(facts);

  const result = await executeCommercialWork(baseExecutionInput(created.work.publicId, 1, facts, gateway.executeCapability));
  assert.equal(result.records[0].status, "completed");
  assert.equal(gateway.calls.length, 0);
  assert.equal(step(result.work!, "SELECT_PRODUCTS").status, "COMPLETED");

  const replay = await executeCommercialWork(baseExecutionInput(created.work.publicId, result.finalVersion!, facts, gateway.executeCapability));
  assert.equal(replay.outcome, "terminal");
  assert.equal(gateway.calls.length, 0);
});

test("CWEX15-CWEX17 blocks stale anchors and dependency cycles with structured reasons", async () => {
  const oldSelection = selection("selection-old");
  const oldDestination = destination("destination-old");
  const staleWork = project({
    commercialLineItems: oldSelection,
    shippingDestination: oldDestination,
    objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
  });
  const staleCreated = await persist(staleWork);
  const staleFacts: MutableFacts = { commercialLineItems: selection("selection-new"), shippingDestination: oldDestination, selectedShippingOption: null, createdQuote: null };
  const gateway = makeGateway(staleFacts);

  const stale = await executeCommercialWork(baseExecutionInput(staleCreated.work.publicId, 1, staleFacts, gateway.executeCapability));
  assert.equal(stale.records[0].errorCode, "stale_evidence");
  assert.equal(step(stale.work!, "CALCULATE_SHIPPING").status, "BLOCKED");
  assert.equal(gateway.calls.length, 0);

  const cyclic = project({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })] });
  cyclic.steps[0].dependencies = [{ type: "STEP_COMPLETED", stepId: cyclic.steps[0].stepId }];
  const cyclicCreated = await persist(cyclic);
  const cycleResult = await executeCommercialWork(baseExecutionInput(cyclicCreated.work.publicId, 1, staleFacts, gateway.executeCapability));
  assert.equal(cycleResult.outcome, "blocked");
  assert.equal(cycleResult.reason, "dependency_cycle");
});

test("CWEX18-CWEX21 isolates temporary failures, continues independent ready work, and keeps retry state", async () => {
  const sel = selection("selection-ready");
  const dest = destination("destination-ready");
  const created = await persist(
    project({
      commercialLineItems: sel,
      shippingDestination: dest,
      objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE"), objectiveSeed("CREATE_QUOTE")]
    })
  );
  const facts: MutableFacts = { commercialLineItems: sel, shippingDestination: dest, selectedShippingOption: null, createdQuote: null };
  const gateway = makeGateway(facts, { calculate_shipping: "temporarily_blocked" });

  const result = await executeCommercialWork(baseExecutionInput(created.work.publicId, 1, facts, gateway.executeCapability));
  assert.deepEqual(gateway.calls.map((call) => call.capabilityName), ["calculate_shipping", "create_quote"]);
  assert.equal(step(result.work!, "CALCULATE_SHIPPING").status, "WAITING_SYSTEM");
  assert.equal(step(result.work!, "CREATE_QUOTE").status, "COMPLETED");
  assert.equal(result.work?.status, "WAITING_SYSTEM");
});

test("CWEX22-CWEX24 blocks unsupported step types and conversation control before any gateway call", async () => {
  const unsupportedCreated = await persist(project({ objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "barra" })] }));
  const facts: MutableFacts = { commercialLineItems: null, shippingDestination: null, selectedShippingOption: null, createdQuote: null };
  const gateway = makeGateway(facts);

  const unsupported = await executeCommercialWork(baseExecutionInput(unsupportedCreated.work.publicId, 1, facts, gateway.executeCapability));
  assert.equal(unsupported.records[0].errorCode, "unsupported_step_type");
  assert.equal(step(unsupported.work!, "SEARCH_PRODUCTS").status, "BLOCKED");
  assert.equal(gateway.calls.length, 0);

  const handoffCreated = await persist(project({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })] }));
  const handoff = await executeCommercialWork(
    baseExecutionInput(handoffCreated.work.publicId, 1, facts, gateway.executeCapability, {
      loadConversationControl: async () => ({ humanOwnerActive: true, aiEnabled: true })
    })
  );
  assert.equal(handoff.outcome, "handoff");
  assert.equal(handoff.work?.status, "HANDOFF");
  assert.equal(gateway.calls.length, 0);
});

test("CWEX25-CWEX26 does not create customer-facing outbox or agent actions", async () => {
  const beforeActions = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_agent_actions WHERE conversation_case_id = ?", [String(conversationId)]);
  const beforeOutbox = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM brain_message_outbox WHERE wa_id = ?", [waId]);
  const created = await persist(project({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })] }));
  const facts: MutableFacts = { commercialLineItems: null, shippingDestination: null, selectedShippingOption: null, createdQuote: null };
  const gateway = makeGateway(facts);

  await executeCommercialWork(baseExecutionInput(created.work.publicId, 1, facts, gateway.executeCapability));

  const afterActions = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_agent_actions WHERE conversation_case_id = ?", [String(conversationId)]);
  const afterOutbox = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM brain_message_outbox WHERE wa_id = ?", [waId]);
  assert.equal(Number(afterActions[0].count), Number(beforeActions[0].count));
  assert.equal(Number(afterOutbox[0].count), Number(beforeOutbox[0].count));
});

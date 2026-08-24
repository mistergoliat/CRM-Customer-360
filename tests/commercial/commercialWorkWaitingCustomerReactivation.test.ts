import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { getPool } from "@/lib/db";
import {
  buildCommercialWorkProjection,
  executeCommercialWork,
  getCommercialWorkByPublicId,
  persistCommercialWorkProjection,
  reconcileCommercialTrigger,
  runCommercialWorkTick,
  selectDueCommercialWorkSteps,
  settleCommercialWorkProjection,
  type CommercialObjectiveSeed,
  type CommercialWork,
  type CommercialWorkProjectionInput,
  type ExecuteCommercialWorkInput,
  type PersistedCommercialWork
} from "@/lib/brain/commercial/work";
import type { CapabilityGatewayResult } from "@/lib/brain/commercial/capability-gateway";
import type { CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import type { CreatedQuote } from "@/lib/domains/created-quote";
import type { SelectedShippingOption } from "@/lib/domains/selected-shipping-option";
import type { ShippingDestination } from "@/lib/domains/shipping-destination";

/**
 * SALES-AGENT-R2-A10, Part 12/13/15. Regression coverage for the
 * WAITING_CUSTOMER reactivation defect A09 documented (release doc Section
 * 14) and closed here: a step whose capability explicitly returned
 * missing_information must not be silently re-executed just because its
 * pre-call dependencies were (and remain) satisfied - it must stay
 * WAITING_CUSTOMER until a genuinely new, relevant customer input supersedes
 * it. Covers both fix sites: commercialWorkExecutor.ts's canAutoActivateStep
 * (same-cycle re-execution) and buildCommercialWorkProjection.ts's
 * applyObjectiveState (reprojection/settle re-execution).
 */

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
  // SALES-AGENT-R2-A11: opens the new worker-level autonomy/access gates -
  // WC04 tests that the worker never claims a WAITING_CUSTOMER step, not
  // that these newer gates block it.
  BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true",
  BRAIN_WHATSAPP_TEST_MODE_ENABLED: "false",
  BRAIN_COMMERCIAL_WORK_WORKER_ENABLED: "true"
});

const NOW = "2026-08-20T13:00:00.000Z";

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

function toMysqlDatetime(date: Date): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

async function seedConversation(): Promise<number> {
  const [result] = await getPool().execute(
    `INSERT INTO conversation (
      public_id, channel, provider, channel_account_id, external_contact_id,
      status, owner_type, ai_enabled, human_owner_active
    ) VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [randomUUID(), unique("phone"), unique("wa")]
  );
  return Number((result as { insertId: number }).insertId);
}

async function seedOpportunity(): Promise<number> {
  const [result] = await getPool().execute(
    `INSERT INTO crm_opportunities (
      opportunity_key, wa_id, channel, primary_intent, status,
      requirements_json, missing_requirements_json, product_interests_json,
      objections_json, signals_json
    ) VALUES (?, ?, 'whatsapp', 'sales', 'open', JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_OBJECT())`,
    [unique("cwwc-opportunity"), unique("wa")]
  );
  return Number((result as { insertId: number }).insertId);
}

function selection(factId = unique("selection"), quantity = 2): CommercialLineItemSelection {
  return { factId, updatedAt: NOW, items: [{ productId: "31", combinationId: null, quantity }] };
}

function destination(factId = unique("destination"), canonicalName = "Nunoa"): ShippingDestination {
  return { factId, updatedAt: NOW, communeId: 13120, canonicalName, matchedVia: "direct" };
}

function objectiveSeed(type: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["type"], inputs: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["inputs"] = {}): CommercialObjectiveSeed {
  return { seedId: unique(`seed-${type}`), type, origin: "customer_requested", inputs };
}

function baseInput(overrides: Partial<CommercialWorkProjectionInput> = {}): CommercialWorkProjectionInput {
  return {
    trigger: { type: "CUSTOMER_MESSAGE", conversationId, opportunityId, sourceMessageId: Math.floor(Date.now() % 100000000), commercialSequence: 1 },
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
  return persistCommercialWorkProjection({ work, correlationKey: unique("cwwc-correlation") });
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

/** Unlike objective()/step() above, ignores a superseded/cancelled predecessor of the same type - needed once a supersession leaves two same-type entries in one work. */
function activeObjective(work: CommercialWork, type: string) {
  const found = work.objectives.find((item) => item.type === type && item.status !== "SUPERSEDED" && item.status !== "CANCELLED");
  assert.ok(found, `expected an active objective ${type}`);
  return found;
}

function stepFor(work: CommercialWork, objectiveId: string) {
  const found = work.steps.find((item) => item.objectiveIds.includes(objectiveId));
  assert.ok(found, `expected a step for objective ${objectiveId}`);
  return found;
}

type MutableFacts = {
  commercialLineItems: CommercialLineItemSelection | null;
  shippingDestination: ShippingDestination | null;
  selectedShippingOption: SelectedShippingOption | null;
  createdQuote: CreatedQuote | null;
};

function gatewayResult(capability: string, status: CapabilityGatewayResult["status"], data: Record<string, unknown> | null): CapabilityGatewayResult {
  return {
    capability,
    version: "capability-gateway.v1",
    availability: "available",
    status,
    data,
    errorCode: status === "completed" ? null : "forced_outcome",
    retryable: false,
    evidence: [],
    warnings: [],
    retryCount: 0,
    startedAt: NOW,
    completedAt: NOW,
    executionPublicId: unique(`exec-${capability}`)
  };
}

/**
 * Mirrors commercialWorkExecutor.test.ts's makeGateway: statuses forces a
 * capability's outcome; "completed" mutates the matching fact. statuses is
 * read live (by reference) on every call and returned to the caller, so a
 * test can flip a capability from missing_information to completed between
 * two executeCommercialWork calls without rebuilding the gateway (needed by
 * WC06/WC12, which reuse createWaitingCustomerWork()'s gateway for a second,
 * successful attempt).
 */
function makeGateway(facts: MutableFacts, statuses: Record<string, CapabilityGatewayResult["status"]> = {}) {
  const calls: Array<{ capabilityName: string; input: Record<string, unknown> }> = [];
  const executeCapability: ExecuteCommercialWorkInput["executeCapability"] = async (capabilityName, input) => {
    calls.push({ capabilityName, input });
    const status = statuses[capabilityName] ?? "completed";
    if (status !== "completed") return gatewayResult(capabilityName, status, null);

    if (capabilityName === "select_products") {
      const requestedItems = Array.isArray(input.items) ? (input.items as CommercialLineItemSelection["items"]) : [];
      facts.commercialLineItems = { factId: unique("selection"), updatedAt: NOW, items: requestedItems.length ? requestedItems : selection().items };
    }
    if (capabilityName === "set_shipping_destination") facts.shippingDestination = destination(unique("destination"), String(input.destination ?? "Nunoa"));
    return gatewayResult(capabilityName, "completed", { status: "selected" });
  };
  return { calls, executeCapability, statuses };
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

/** Sets up a work with one SELECT_PRODUCTS objective whose capability explicitly returns missing_information. */
async function createWaitingCustomerWork() {
  const created = await persist(project({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })] }));
  const facts: MutableFacts = { commercialLineItems: null, shippingDestination: null, selectedShippingOption: null, createdQuote: null };
  const gateway = makeGateway(facts, { select_products: "missing_information" });
  const result = await executeCommercialWork(baseExecutionInput(created.work.publicId, created.work.version, facts, gateway.executeCapability));
  assert.equal(result.work?.status, "WAITING_CUSTOMER");
  assert.equal(step(result.work!, "SELECT_PRODUCTS").status, "WAITING_CUSTOMER");
  assert.equal(gateway.calls.length, 1);
  return { work: result.work as PersistedCommercialWork, facts, gateway, objectiveId: objective(result.work!, "SELECT_PRODUCTS").objectiveId };
}

/**
 * SALES-AGENT-R2-A11.2-C. The real search_products capability now persists
 * T12's productIntent alongside the legacy items[] view - see registry.ts's
 * searchProductsCapabilityDataFromProductIntent. 2+ items always means
 * clarification_required (matching a real ambiguous search).
 */
function productIntentPayloadFor(query: string, items: Array<{ productId: string; name: string }>) {
  return {
    query: { original: query, normalized: query },
    resolution: { status: "clarification_required", confidence: 0.5 },
    candidates: items.map((item, index) => ({
      product: { productId: item.productId, name: item.name, price: null, stock: { status: "unknown", available: true } },
      match: { rank: index + 1, score: 0.8, reasons: ["NAME_TOKEN_MATCH"] }
    })),
    clarification: { dimension: "unspecified", options: [] },
    statistics: { retrieved: items.length, eligible: items.length, returned: items.length },
    warnings: []
  };
}

/**
 * SALES-AGENT-R2-A11.1, Part 2/4. Seeds a real, completed search_products
 * execution row directly (same table/shape executeGovernedCapability itself
 * persists) so settleCommercialWorkProjection's real DB reload
 * (loadRecentCommercialCapabilityExecutions) finds it, exactly like a real
 * SEARCH_PRODUCTS step execution would have left behind.
 */
async function seedSearchProductsExecution(query: string, items: Array<{ productId: string; name: string }>): Promise<void> {
  const responseSummary = { query, items, productIntent: productIntentPayloadFor(query, items) };
  await getPool().execute(
    `INSERT INTO crm_capability_executions (
      public_id, correlation_id, capability_name, capability_version,
      availability_status, execution_status, retry_count, retryable, error_code,
      request_summary_json, response_summary_json, evidence_json,
      opportunity_id, conversation_id, started_at, completed_at
    ) VALUES (?, ?, 'search_products', '1.0', 'available', 'completed', 0, 0, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), unique("search-corr"), JSON.stringify({ query, limit: 5 }), JSON.stringify(responseSummary), JSON.stringify({}), opportunityId, conversationId, toMysqlDatetime(new Date(NOW)), toMysqlDatetime(new Date(NOW))]
  );
}

/**
 * Sets up a work with one SELECT_PRODUCTS objective already WAITING_CUSTOMER
 * on a real, completed search_products execution that found 2 ambiguous
 * candidates - the exact "una pesa" live-bug shape this task's Part 4/11
 * requires proof of stability for (WC-P equivalent).
 */
async function createAmbiguousProductWaitingWork() {
  const productReference = unique("producto-ambiguo");
  const candidateItems = [
    { productId: "31", name: "Barra Olimpica Classic 20kg" },
    { productId: "32", name: "Barra Olimpica Pro 20kg" }
  ];
  // Seeded in the real DB (for settleCommercialWorkProjection's own reload
  // later in WCP01) AND passed directly into the initial projection below
  // (buildCommercialWorkProjection is pure - it only ever sees what its own
  // recentCapabilityExecutions input carries, never reads the DB itself).
  await seedSearchProductsExecution(productReference, candidateItems);
  const created = await persist(
    project({
      objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { productReference, quantity: 1 })],
      recentCapabilityExecutions: [
        {
          publicId: unique("search-exec"),
          capabilityName: "search_products",
          executionStatus: "completed",
          requestSummaryJson: { query: productReference, limit: 5 },
          responseSummaryJson: { query: productReference, items: candidateItems, productIntent: productIntentPayloadFor(productReference, candidateItems) },
          completedAt: NOW
        }
      ]
    })
  );
  assert.equal(created.work.status, "WAITING_CUSTOMER");
  const select = objective(created.work, "SELECT_PRODUCTS");
  assert.equal(select.missingRequirements.includes("PRODUCT_AMBIGUOUS"), true);
  return { work: created.work as PersistedCommercialWork, objectiveId: select.objectiveId, productReference };
}

test("WCP01 (A11.1) an ambiguous product search stays WAITING_CUSTOMER with the same real candidates across repeated settle rounds - no drift, no infinite re-search", async () => {
  const { work, objectiveId } = await createAmbiguousProductWaitingWork();

  const settled = await settleCommercialWorkProjection({
    work,
    conversationId,
    opportunityId,
    correlationId: unique("settle-corr"),
    now: new Date(NOW)
  });
  assert.equal(settled.status, "WAITING_CUSTOMER");
  const select = objective(settled, "SELECT_PRODUCTS");
  assert.equal(select.objectiveId, objectiveId, "same objective, never superseded merely by reprojecting");
  assert.equal(select.missingRequirements.includes("PRODUCT_AMBIGUOUS"), true);
  assert.equal(select.inputs.productCandidates?.length, 2, "the same 2 real candidates, never dropped or invented");
  // No second search_products call was made - settle re-derives from the
  // SAME already-completed execution, never re-searching an unresolved
  // ambiguity that has not received a new customer answer.
  const [executions] = await getPool().execute("SELECT COUNT(*) AS count FROM crm_capability_executions WHERE opportunity_id = ? AND capability_name = 'search_products'", [opportunityId]);
  const count = Number((executions as Array<{ count: number }>)[0].count);
  assert.equal(count, 1, "settle must not trigger a redundant search when ambiguity is already known");
});

test("WCP02 (A11.1) an irrelevant follow-up message never repeats the wrong question - it stays on the same real ambiguity, not a generic one", async () => {
  const { work, objectiveId } = await createAmbiguousProductWaitingWork();

  const reconciled = await reconcileCommercialTrigger({
    trigger: { type: "CUSTOMER_MESSAGE", conversationId, opportunityId, sourceMessageId: null, commercialSequence: 2 },
    conversation: { id: conversationId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: opportunityId },
    now: NOW,
    previousWork: work,
    // "me puedes ayudar" / "una pesa" style vague follow-up - the planner
    // emits nothing new to plan, so only the carried objective survives.
    semanticObjectives: []
  });
  assert.equal(reconciled.status, "updated");
  const select = objective(reconciled.work, "SELECT_PRODUCTS");
  assert.equal(select.objectiveId, objectiveId, "same objective - a vague reply is never treated as a fresh, unrelated request");
  assert.equal(select.status, "WAITING_CUSTOMER");
  assert.equal(select.missingRequirements.includes("PRODUCT_AMBIGUOUS"), true, "still the real ambiguity, never silently reset to the generic MISSING_PRODUCT question");
  assert.equal(select.inputs.productCandidates?.length, 2);
});

test("WC01/WC02 missing_information keeps the step WAITING_CUSTOMER and calls the capability exactly once, including across a later pass over unchanged state", async () => {
  const { work, facts, gateway } = await createWaitingCustomerWork();
  // WC02: a further executor pass over the exact same unresolved state (no new customer input, facts unchanged) must not reactivate or re-call.
  const again = await executeCommercialWork(baseExecutionInput(work.publicId, work.version, facts, gateway.executeCapability));
  assert.equal(gateway.calls.length, 1, "capability must not be re-called merely because dependencies remained satisfied");
  assert.equal(step(again.work!, "SELECT_PRODUCTS").status, "WAITING_CUSTOMER");
  assert.equal(again.outcome, "no_ready_steps");
});

test("WC03 settleCommercialWorkProjection reprojection does not reactivate a capability-level WAITING_CUSTOMER objective", async () => {
  const { work, facts, gateway } = await createWaitingCustomerWork();
  const settled = await settleCommercialWorkProjection({
    work,
    conversationId,
    opportunityId,
    correlationId: unique("settle-corr"),
    now: new Date(NOW),
    executeCapability: gateway.executeCapability
  });
  assert.equal(gateway.calls.length, 1, "settle must not re-call a capability that already returned missing_information");
  assert.equal(settled.status, "WAITING_CUSTOMER");
  assert.equal(step(settled, "SELECT_PRODUCTS").status, "WAITING_CUSTOMER");
});

test("WC04 the retry worker never selects or claims a WAITING_CUSTOMER step", async () => {
  const { work, gateway } = await createWaitingCustomerWork();
  const due = await selectDueCommercialWorkSteps({ limit: 10, now: NOW, workPublicIds: [work.publicId] });
  assert.equal(due.length, 0, "a WAITING_CUSTOMER work must never surface as a due step for the worker");

  const tick = await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true, workPublicIds: [work.publicId], now: NOW, executeCapability: gateway.executeCapability });
  assert.equal(tick.selected, 0);
  assert.equal(tick.claimed, 0);
  assert.equal(gateway.calls.length, 1, "worker tick must not call the capability again");
});

test("WC05 an irrelevant new customer message does not reactivate the waiting objective/step", async () => {
  const { work, facts, gateway, objectiveId } = await createWaitingCustomerWork();

  const reconciled = await reconcileCommercialTrigger({
    trigger: { type: "CUSTOMER_MESSAGE", conversationId, opportunityId, sourceMessageId: null, commercialSequence: 2 },
    conversation: { id: conversationId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: opportunityId },
    commercialLineItems: facts.commercialLineItems,
    shippingDestination: facts.shippingDestination,
    selectedShippingOption: facts.selectedShippingOption,
    createdQuote: facts.createdQuote,
    now: NOW,
    previousWork: work,
    // A different family (destination) - irrelevant to the waiting SELECT_PRODUCTS objective.
    semanticObjectives: [objectiveSeed("SET_DESTINATION", { destinationText: "Providencia" })]
  });
  assert.equal(reconciled.status, "updated");
  const carried = objective(reconciled.work, "SELECT_PRODUCTS");
  assert.equal(carried.objectiveId, objectiveId, "same objective, never superseded by an unrelated message");
  assert.equal(carried.status, "WAITING_CUSTOMER");
  assert.equal(step(reconciled.work, "SELECT_PRODUCTS").status, "WAITING_CUSTOMER");

  const executed = await executeCommercialWork({
    workPublicId: reconciled.work.publicId,
    expectedVersion: reconciled.work.version,
    context: { correlationId: unique("corr"), conversationId, opportunityId },
    loadCurrentFacts: async () => facts,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    executeCapability: gateway.executeCapability
  });
  assert.equal(gateway.calls.filter((c) => c.capabilityName === "select_products").length, 1, "select_products must not be re-called by an unrelated message");
  assert.equal(step(executed.work!, "SELECT_PRODUCTS").status, "WAITING_CUSTOMER");
});

test("WC06 a genuinely new, relevant customer message supersedes and reactivates a fresh attempt", async () => {
  const { work, facts, gateway, objectiveId } = await createWaitingCustomerWork();

  const reconciled = await reconcileCommercialTrigger({
    trigger: { type: "CUSTOMER_MESSAGE", conversationId, opportunityId, sourceMessageId: null, commercialSequence: 2 },
    conversation: { id: conversationId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: opportunityId },
    commercialLineItems: facts.commercialLineItems,
    shippingDestination: facts.shippingDestination,
    selectedShippingOption: facts.selectedShippingOption,
    createdQuote: facts.createdQuote,
    now: NOW,
    previousWork: work,
    // Same family (selection) with a fresh, unresolved seed - a real new customer answer.
    semanticObjectives: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 3 }] })]
  });
  assert.equal(reconciled.status, "updated");
  const old = reconciled.work.objectives.find((o) => o.objectiveId === objectiveId)!;
  assert.equal(old.status, "SUPERSEDED");
  const fresh = reconciled.work.objectives.find((o) => o.type === "SELECT_PRODUCTS" && o.objectiveId !== objectiveId)!;
  assert.ok(fresh, "a new SELECT_PRODUCTS objective must exist");
  assert.equal(fresh.status, "READY");
  const freshStep = reconciled.work.steps.find((s) => s.type === "SELECT_PRODUCTS" && s.objectiveIds.includes(fresh.objectiveId))!;
  assert.ok(freshStep);
  assert.equal(freshStep.status, "READY");

  // The new, resolved answer succeeds this time (a real capability would not
  // reject the exact same missing_information forever once the customer
  // actually resolved the ambiguity).
  gateway.statuses.select_products = "completed";
  const executed = await executeCommercialWork({
    workPublicId: reconciled.work.publicId,
    expectedVersion: reconciled.work.version,
    context: { correlationId: unique("corr"), conversationId, opportunityId },
    loadCurrentFacts: async () => facts,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    executeCapability: gateway.executeCapability
  });
  assert.equal(gateway.calls.filter((c) => c.capabilityName === "select_products").length, 2, "the fresh attempt must call the capability again");
  assert.equal(stepFor(executed.work!, fresh.objectiveId).status, "COMPLETED");
});

test("WC07 a genuinely new confirmed fact reactivates a WAITING_CUSTOMER objective even though its carried status alone would keep it waiting", () => {
  const seedId = unique("wc07-destination");
  const seed: CommercialObjectiveSeed = { seedId, type: "SET_DESTINATION", origin: "customer_requested", inputs: { destinationText: "Nunoa" }, carriedStatus: "WAITING_CUSTOMER" };
  const trigger = { type: "SYSTEM_EVENT" as const, eventType: "wc07-test", correlationId: unique("corr"), conversationId, opportunityId };

  const stillWaiting = buildCommercialWorkProjection({
    trigger,
    conversation: { id: conversationId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: opportunityId },
    objectiveSeeds: [seed],
    shippingDestination: null,
    now: NOW
  });
  assert.equal(objective(stillWaiting, "SET_DESTINATION").status, "WAITING_CUSTOMER", "structural presence alone (destinationText) must not reactivate");

  const reactivated = buildCommercialWorkProjection({
    trigger,
    conversation: { id: conversationId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: opportunityId },
    objectiveSeeds: [seed],
    shippingDestination: destination(unique("destination"), "Nunoa"),
    now: NOW
  });
  assert.equal(objective(reactivated, "SET_DESTINATION").status, "COMPLETED", "a real confirmed matching fact must reactivate regardless of carried status");
});

test("WC08 cancellation while WAITING_CUSTOMER never reactivates - it terminates instead", async () => {
  const { work, facts, gateway, objectiveId } = await createWaitingCustomerWork();

  const reconciled = await reconcileCommercialTrigger({
    trigger: { type: "CUSTOMER_MESSAGE", conversationId, opportunityId, sourceMessageId: null, commercialSequence: 2 },
    conversation: { id: conversationId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: opportunityId },
    commercialLineItems: facts.commercialLineItems,
    shippingDestination: facts.shippingDestination,
    selectedShippingOption: facts.selectedShippingOption,
    createdQuote: facts.createdQuote,
    now: NOW,
    previousWork: work,
    semanticObjectives: [{ kind: "cancel", targetType: "selection" }]
  });
  const cancelled = reconciled.work.objectives.find((o) => o.objectiveId === objectiveId)!;
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(step(reconciled.work, "SELECT_PRODUCTS").status, "CANCELLED");

  const executed = await executeCommercialWork({
    workPublicId: reconciled.work.publicId,
    expectedVersion: reconciled.work.version,
    context: { correlationId: unique("corr"), conversationId, opportunityId },
    loadCurrentFacts: async () => facts,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    executeCapability: gateway.executeCapability
  });
  assert.equal(gateway.calls.length, 1, "a cancelled objective must never re-call its capability");
  assert.equal(step(executed.work!, "SELECT_PRODUCTS").status, "CANCELLED");
});

test("WC09 handoff while WAITING_CUSTOMER blocks autonomous execution without reactivating the step", async () => {
  const { work, facts, gateway } = await createWaitingCustomerWork();
  const executed = await executeCommercialWork(
    baseExecutionInput(work.publicId, work.version, facts, gateway.executeCapability, {
      loadConversationControl: async () => ({ humanOwnerActive: true, aiEnabled: true })
    })
  );
  assert.equal(executed.outcome, "handoff");
  assert.equal(executed.work?.status, "HANDOFF");
  assert.equal(gateway.calls.length, 1, "handoff must not trigger a new capability call");
  assert.equal(step(executed.work!, "SELECT_PRODUCTS").status, "WAITING_CUSTOMER", "the step itself is untouched by the handoff gate");
});

test("WC10 WAITING_CUSTOMER survives a restart (fresh read from the database)", async () => {
  const { work } = await createWaitingCustomerWork();
  const reloaded = await getCommercialWorkByPublicId(work.publicId);
  assert.equal(reloaded?.status, "WAITING_CUSTOMER");
  assert.equal(step(reloaded! as unknown as CommercialWork, "SELECT_PRODUCTS").status, "WAITING_CUSTOMER");
});

test("WC11 the follow-up runtime never calls the CommercialWork executor directly (architectural)", () => {
  const followUpDir = path.join(process.cwd(), "lib", "brain", "commercial", "work", "followup");
  const files = readdirSync(followUpDir).filter((name) => name.endsWith(".ts"));
  assert.ok(files.length > 0, "expected follow-up source files to audit");
  for (const file of files) {
    const content = readFileSync(path.join(followUpDir, file), "utf8");
    assert.ok(
      !content.includes("executeCommercialWork") && !content.includes("commercialWorkExecutor"),
      `${file} must not call the CommercialWork executor directly - a follow-up firing must only ever go through the ordinary CUSTOMER_MESSAGE/system inbound path, never execute a WAITING_CUSTOMER step on its own`
    );
  }
});

test("WC12 duplicate/replayed customer input does not cause a duplicate capability call", async () => {
  const { work, facts, gateway, objectiveId } = await createWaitingCustomerWork();

  const newSeed = objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 3 }] });
  const reconciled = await reconcileCommercialTrigger({
    trigger: { type: "CUSTOMER_MESSAGE", conversationId, opportunityId, sourceMessageId: null, commercialSequence: 2 },
    conversation: { id: conversationId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: opportunityId },
    commercialLineItems: facts.commercialLineItems,
    shippingDestination: facts.shippingDestination,
    selectedShippingOption: facts.selectedShippingOption,
    createdQuote: facts.createdQuote,
    now: NOW,
    previousWork: work,
    semanticObjectives: [newSeed]
  });
  const freshObjectiveId = activeObjective(reconciled.work, "SELECT_PRODUCTS").objectiveId;
  assert.notEqual(freshObjectiveId, objectiveId);
  gateway.statuses.select_products = "completed";
  const executed = await executeCommercialWork({
    workPublicId: reconciled.work.publicId,
    expectedVersion: reconciled.work.version,
    context: { correlationId: unique("corr"), conversationId, opportunityId },
    loadCurrentFacts: async () => facts,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    executeCapability: gateway.executeCapability
  });
  assert.equal(stepFor(executed.work!, freshObjectiveId).status, "COMPLETED");
  assert.equal(gateway.calls.filter((c) => c.capabilityName === "select_products").length, 2);

  // A duplicate/replayed inbound resolving to the exact same already-resolved
  // items: reconciliation always supersedes on a new same-family seed (no
  // seed-level dedup at this layer - that lives upstream, in
  // assignCommercialTriggerSequence's dedupe key), but the fresh objective it
  // creates must immediately recognize the matching fact (sameItems) and land
  // COMPLETED without ever going through READY - so execution never calls the
  // capability a third time for input that was already fulfilled.
  const duplicateReconciled = await reconcileCommercialTrigger({
    trigger: { type: "CUSTOMER_MESSAGE", conversationId, opportunityId, sourceMessageId: null, commercialSequence: 3 },
    conversation: { id: conversationId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: opportunityId },
    commercialLineItems: facts.commercialLineItems,
    shippingDestination: facts.shippingDestination,
    selectedShippingOption: facts.selectedShippingOption,
    createdQuote: facts.createdQuote,
    now: NOW,
    previousWork: executed.work as PersistedCommercialWork,
    semanticObjectives: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 3 }] })]
  });
  const duplicateFreshObjectiveId = activeObjective(duplicateReconciled.work, "SELECT_PRODUCTS").objectiveId;
  assert.notEqual(duplicateFreshObjectiveId, freshObjectiveId, "the replay still creates a new objective (no seed-level dedup at this layer)");
  assert.equal(activeObjective(duplicateReconciled.work, "SELECT_PRODUCTS").status, "COMPLETED", "matching fact must short-circuit straight to COMPLETED, never READY");
  assert.equal(stepFor(duplicateReconciled.work, duplicateFreshObjectiveId).status, "COMPLETED");

  const duplicateExecuted = await executeCommercialWork({
    workPublicId: duplicateReconciled.work.publicId,
    expectedVersion: duplicateReconciled.work.version,
    context: { correlationId: unique("corr"), conversationId, opportunityId },
    loadCurrentFacts: async () => facts,
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    executeCapability: gateway.executeCapability
  });
  assert.equal(gateway.calls.filter((c) => c.capabilityName === "select_products").length, 2, "a duplicate/matching selection must not call select_products a third time");
  assert.equal(duplicateExecuted.outcome, "terminal");
  assert.equal(stepFor(duplicateExecuted.work!, duplicateFreshObjectiveId).status, "COMPLETED");
});

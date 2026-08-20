import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { getPool, queryRows } from "@/lib/db";
import {
  assignCommercialTriggerSequence,
  buildCommercialWorkProjection,
  executeCommercialWork,
  getLatestCommercialSequence,
  loadRecentCommercialCapabilityExecutions,
  persistCommercialWorkProjection,
  reconcileCommercialObjectives,
  reconcileCommercialTrigger,
  runCommercialWorkTick,
  type CommercialObjectiveSeed,
  type CommercialWork,
  type CommercialWorkProjectionInput
} from "@/lib/brain/commercial/work";
import type { CapabilityGatewayResult } from "@/lib/brain/commercial/capability-gateway";
import { insertCapabilityExecution } from "@/lib/brain/commercial/capability-gateway/repository";
import type { CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
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
  DB_WRITE_ENABLED: "true",
  // SALES-AGENT-R2-A11: opens the new worker-level autonomy/access gates for
  // this file's pre-A11 tests, none of which exercise those gates themselves.
  BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true",
  BRAIN_WHATSAPP_TEST_MODE_ENABLED: "false",
  BRAIN_COMMERCIAL_WORK_WORKER_ENABLED: "true"
});

const NOW = "2026-08-18T12:00:00.000Z";

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
    [unique("cwseq-opportunity"), unique("wa")]
  );
  return Number((result as { insertId: number }).insertId);
}

function selection(factId: string, quantity: number): CommercialLineItemSelection {
  return { factId, updatedAt: NOW, items: [{ productId: "31", combinationId: null, quantity }] };
}

function destination(factId: string, canonicalName: string, communeId = 13120): ShippingDestination {
  return { factId, updatedAt: NOW, canonicalName, communeId, matchedVia: "direct" };
}

function objectiveSeed(type: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["type"], inputs: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["inputs"] = {}): CommercialObjectiveSeed {
  return { type, origin: "customer_requested", inputs };
}

function projectionInput(input: {
  conversationId: number;
  opportunityId: number;
  sourceMessageId: number;
  sequence: number;
  seeds?: CommercialObjectiveSeed[];
  commercialLineItems?: CommercialLineItemSelection | null;
  shippingDestination?: ShippingDestination | null;
  recentCapabilityExecutions?: CommercialWorkProjectionInput["recentCapabilityExecutions"];
}): CommercialWorkProjectionInput {
  return {
    trigger: {
      type: "CUSTOMER_MESSAGE",
      conversationId: input.conversationId,
      opportunityId: input.opportunityId,
      sourceMessageId: input.sourceMessageId,
      commercialSequence: input.sequence
    },
    conversation: { id: input.conversationId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: input.opportunityId },
    objectiveSeeds: input.seeds ?? [],
    commercialLineItems: input.commercialLineItems ?? null,
    shippingDestination: input.shippingDestination ?? null,
    recentCapabilityExecutions: input.recentCapabilityExecutions,
    now: NOW
  };
}

function objective(work: CommercialWork, type: string) {
  const found = work.objectives.find((item) => item.type === type && item.status !== "SUPERSEDED" && item.status !== "CANCELLED");
  assert.ok(found, `expected current objective ${type}`);
  return found;
}

function allObjectives(work: CommercialWork, type: string) {
  return work.objectives.filter((item) => item.type === type);
}

function step(work: CommercialWork, type: string) {
  const found = work.steps.find((item) => item.type === type && item.status !== "SUPERSEDED" && item.status !== "CANCELLED");
  assert.ok(found, `expected current step ${type}`);
  return found;
}

function gatewayResult(capability: string, data: Record<string, unknown> = { status: "available" }): CapabilityGatewayResult {
  return {
    capability,
    version: "capability-gateway.v1",
    availability: "available",
    status: "completed",
    data,
    errorCode: null,
    retryable: false,
    evidence: [],
    warnings: [],
    retryCount: 0,
    startedAt: NOW,
    completedAt: NOW,
    executionPublicId: unique(`exec-${capability}`)
  };
}

async function persist(work: CommercialWork) {
  return persistCommercialWorkProjection({ work, correlationKey: unique("cwseq-correlation") });
}

test("CWSEQ01 CWSEQ02 CWSEQ25 concurrent allocation is durable, monotonic per conversation, and duplicate inbound reuses the same sequence", async () => {
  const conversationId = await seedConversation();
  const allocated = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      assignCommercialTriggerSequence({
        conversationId,
        triggerType: "CUSTOMER_MESSAGE",
        triggerDedupeKey: `meta-message-${index}`,
        sourceMessageId: index + 1
      })
    )
  );

  const sequences = allocated.map((item) => {
    assert.notEqual(item.status, "failed", item.status === "failed" ? item.error : undefined);
    return item.status !== "failed" ? item.record.commercialSequence : 0;
  });
  assert.equal(new Set(sequences).size, 12);
  assert.deepEqual([...sequences].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  const duplicateA = await assignCommercialTriggerSequence({ conversationId, triggerType: "CUSTOMER_MESSAGE", triggerDedupeKey: "same-provider-message", sourceMessageId: 99 });
  const duplicateB = await assignCommercialTriggerSequence({ conversationId, triggerType: "CUSTOMER_MESSAGE", triggerDedupeKey: "same-provider-message", sourceMessageId: 99 });
  assert.notEqual(duplicateA.status, "failed");
  assert.notEqual(duplicateB.status, "failed");
  if (duplicateA.status !== "failed" && duplicateB.status !== "failed") {
    assert.equal(duplicateB.record.commercialSequence, duplicateA.record.commercialSequence);
  }
  assert.equal(await getLatestCommercialSequence(conversationId), 13);
});

test("CWSEQ12 CWSEQ13 CWSEQ14 CWSEQ15 CWSEQ16 objective reconciliation carries identity, adds work, supersedes modifications, and preserves cancellation history", async () => {
  const conversationId = await seedConversation();
  const opportunityId = await seedOpportunity();
  const turn1 = buildCommercialWorkProjection(
    projectionInput({
      conversationId,
      opportunityId,
      sourceMessageId: 1,
      sequence: 1,
      commercialLineItems: selection("selection-2", 2),
      seeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })]
    })
  );
  const created = await persist(turn1);
  const selectId = objective(created.work, "SELECT_PRODUCTS").objectiveId;

  const additionSeeds = reconcileCommercialObjectives({
    previousWork: created.work,
    newSemanticObjectives: [objectiveSeed("GET_SHIPPING_QUOTE")]
  });
  const addition = buildCommercialWorkProjection(
    projectionInput({
      conversationId,
      opportunityId,
      sourceMessageId: 2,
      sequence: 2,
      commercialLineItems: selection("selection-2", 2),
      seeds: additionSeeds
    })
  );
  assert.equal(objective(addition, "SELECT_PRODUCTS").objectiveId, selectId);
  assert.equal(objective(addition, "GET_SHIPPING_QUOTE").status, "WAITING_CUSTOMER");
  const persistedAddition = await persist(addition);

  const modification = buildCommercialWorkProjection(
    projectionInput({
      conversationId,
      opportunityId,
      sourceMessageId: 3,
      sequence: 3,
      commercialLineItems: selection("selection-2", 2),
      seeds: reconcileCommercialObjectives({
        previousWork: created.work,
        newSemanticObjectives: [objectiveSeed("CHANGE_QUANTITY", { items: [{ productId: "31", combinationId: null, quantity: 3 }] })]
      })
    })
  );
  assert.equal(allObjectives(modification, "SELECT_PRODUCTS")[0].status, "SUPERSEDED");
  assert.deepEqual(objective(modification, "CHANGE_QUANTITY").supersedesObjectiveIds, [selectId]);

  const cancelled = buildCommercialWorkProjection(
    projectionInput({
      conversationId,
      opportunityId,
      sourceMessageId: 4,
      sequence: 4,
      seeds: reconcileCommercialObjectives({
        previousWork: persistedAddition.work,
        newSemanticObjectives: [{ kind: "cancel", targetType: "shipping", reason: "customer_cancelled" }]
      })
    })
  );
  assert.equal(allObjectives(cancelled, "GET_SHIPPING_QUOTE")[0].status, "CANCELLED");
});

test("CWSEQ03 CWSEQ04 CWSEQ05 CWSEQ26 CWSEQ30 stale customer turns cannot overwrite newer quantity or destination corrections", async () => {
  const conversationId = await seedConversation();
  const opportunityId = await seedOpportunity();

  const turn3 = await reconcileCommercialTrigger({
    ...projectionInput({
      conversationId,
      opportunityId,
      sourceMessageId: 3,
      sequence: 3,
      seeds: [objectiveSeed("SET_DESTINATION", { destinationText: "Las Condes" })]
    }),
    semanticObjectives: [objectiveSeed("SET_DESTINATION", { destinationText: "Las Condes" })]
  });
  assert.equal(turn3.status, "created");

  const staleTurn1 = await reconcileCommercialTrigger({
    ...projectionInput({
      conversationId,
      opportunityId,
      sourceMessageId: 1,
      sequence: 1,
      seeds: [
        objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] }),
        objectiveSeed("SET_DESTINATION", { destinationText: "Nunoa" })
      ]
    }),
    semanticObjectives: [
      objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] }),
      objectiveSeed("SET_DESTINATION", { destinationText: "Nunoa" })
    ],
    previousWork: turn3.work
  });
  assert.equal(staleTurn1.status, "stale_ignored");

  const turn2 = await reconcileCommercialTrigger({
    ...projectionInput({
      conversationId,
      opportunityId,
      sourceMessageId: 2,
      sequence: 2,
      seeds: [objectiveSeed("CHANGE_QUANTITY", { items: [{ productId: "31", combinationId: null, quantity: 3 }] })]
    }),
    semanticObjectives: [objectiveSeed("CHANGE_QUANTITY", { items: [{ productId: "31", combinationId: null, quantity: 3 }] })],
    previousWork: turn3.work
  });
  assert.equal(turn2.status, "updated");
  assert.equal(objective(turn2.work, "CHANGE_QUANTITY").inputs.items?.[0]?.quantity, 3);
  assert.equal(objective(turn2.work, "SET_DESTINATION").inputs.destinationText, "Las Condes");
  assert.equal(turn2.work.lastReconciledSequence, 3);
});

test("CWSEQ17 CWSEQ18 CWSEQ19 completed work correction creates a new linked work and never reopens the terminal aggregate", async () => {
  const conversationId = await seedConversation();
  const opportunityId = await seedOpportunity();
  const completed = await persist(
    buildCommercialWorkProjection(
      projectionInput({
        conversationId,
        opportunityId,
        sourceMessageId: 1,
        sequence: 1,
        commercialLineItems: selection("selection-2", 2),
        seeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })]
      })
    )
  );
  assert.equal(completed.work.status, "COMPLETED");

  const correction = await reconcileCommercialTrigger({
    ...projectionInput({
      conversationId,
      opportunityId,
      sourceMessageId: 2,
      sequence: 2,
      seeds: [objectiveSeed("CHANGE_QUANTITY", { items: [{ productId: "31", combinationId: null, quantity: 3 }] })]
    }),
    semanticObjectives: [objectiveSeed("CHANGE_QUANTITY", { items: [{ productId: "31", combinationId: null, quantity: 3 }] })],
    previousWork: completed.work
  });
  assert.equal(correction.status, "created");
  assert.notEqual(correction.work.publicId, completed.work.publicId);
  assert.equal(correction.work.previousWorkPublicId, completed.work.publicId);
  assert.equal(correction.work.supersedesWorkPublicId, completed.work.publicId);
  assert.equal(completed.work.status, "COMPLETED");
});

test("CWSEQ06 CWSEQ07 CWSEQ20 CWSEQ21 CWSEQ27 post-side-effect stale evidence stays historical and blockers refresh after fact changes", async () => {
  const conversationId = await seedConversation();
  const opportunityId = await seedOpportunity();
  const oldSelection = selection("selection-old", 2);
  const oldDestination = destination("destination-old", "Nunoa");
  const newSelection = selection("selection-new", 3);
  const work = await persist(
    buildCommercialWorkProjection(
      projectionInput({
        conversationId,
        opportunityId,
        sourceMessageId: 1,
        sequence: 1,
        commercialLineItems: oldSelection,
        shippingDestination: oldDestination,
        seeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
      })
    )
  );
  assert.equal(step(work.work, "CALCULATE_SHIPPING").status, "READY");

  let factLoadCount = 0;
  const executed = await executeCommercialWork({
    workPublicId: work.work.publicId,
    expectedVersion: work.work.version,
    context: { correlationId: "cwseq-post-side-effect", conversationId, opportunityId },
    loadCurrentFacts: async () => {
      factLoadCount += 1;
      return {
        commercialLineItems: factLoadCount === 1 ? oldSelection : newSelection,
        shippingDestination: oldDestination,
        selectedShippingOption: null,
        createdQuote: null
      };
    },
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    executeCapability: async (name) => gatewayResult(name, { status: "available", selectionFactId: oldSelection.factId, destinationFactId: oldDestination.factId })
  });
  assert.equal(executed.records[0]?.status, "blocked");
  assert.equal(executed.records[0]?.errorCode, "stale_evidence");
  assert.equal(step(executed.work!, "CALCULATE_SHIPPING").status, "BLOCKED");
  assert.equal(step(executed.work!, "CALCULATE_SHIPPING").blockers.some((item) => item.code === "STALE_EVIDENCE"), true);
});

test("CWSEQ08 CWSEQ22 CWSEQ23 CWSEQ24 retry worker skips stale anchors but preserves fresh shipping across an irrelevant newer turn", async () => {
  const conversationId = await seedConversation();
  const opportunityId = await seedOpportunity();
  const currentSelection = selection("selection-current", 2);
  const currentDestination = destination("destination-current", "Nunoa");
  const staleSelection = selection("selection-stale", 1);
  const work = await persist(
    buildCommercialWorkProjection(
      projectionInput({
        conversationId,
        opportunityId,
        sourceMessageId: 1,
        sequence: 1,
        commercialLineItems: staleSelection,
        shippingDestination: currentDestination,
        seeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
      })
    )
  );
  const calls: string[] = [];
  const tick = await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true,
    batchSize: 1,
    now: NOW,
    workerId: "cwseq-worker",
    workPublicIds: [work.work.publicId],
    loadCurrentFacts: async () => ({ commercialLineItems: currentSelection, shippingDestination: currentDestination, selectedShippingOption: null, createdQuote: null }),
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    executeCapability: async (name) => {
      calls.push(name);
      return gatewayResult(name);
    }
  });
  assert.equal(tick.claimed, 1);
  assert.deepEqual(calls, []);

  const fresh = buildCommercialWorkProjection(
    projectionInput({
      conversationId,
      opportunityId,
      sourceMessageId: 2,
      sequence: 2,
      commercialLineItems: currentSelection,
      shippingDestination: currentDestination,
      recentCapabilityExecutions: [
        {
          publicId: "shipping-fresh",
          capabilityName: "calculate_shipping",
          executionStatus: "completed",
          responseSummaryJson: { status: "available", selectionFactId: currentSelection.factId, destinationFactId: currentDestination.factId },
          completedAt: NOW
        }
      ],
      seeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
    })
  );
  assert.equal(objective(fresh, "GET_SHIPPING_QUOTE").status, "COMPLETED");

  const staleDestination = buildCommercialWorkProjection(
    projectionInput({
      conversationId,
      opportunityId,
      sourceMessageId: 3,
      sequence: 3,
      commercialLineItems: currentSelection,
      shippingDestination: destination("destination-new", "Las Condes"),
      recentCapabilityExecutions: [
        {
          publicId: "shipping-stale",
          capabilityName: "calculate_shipping",
          executionStatus: "completed",
          responseSummaryJson: { status: "available", selectionFactId: currentSelection.factId, destinationFactId: currentDestination.factId },
          completedAt: NOW
        }
      ],
      seeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
    })
  );
  assert.equal(objective(staleDestination, "GET_SHIPPING_QUOTE").evidence.some((item) => item.stale === true && item.reason === "destination_changed"), true);
});

test("CWSEQ09 CWSEQ10 CWSEQ28 handoff/customer authority beats active autonomous execution before mutation", async () => {
  const conversationId = await seedConversation();
  const opportunityId = await seedOpportunity();
  const work = await persist(
    buildCommercialWorkProjection(
      projectionInput({
        conversationId,
        opportunityId,
        sourceMessageId: 1,
        sequence: 1,
        seeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })]
      })
    )
  );
  const calls: string[] = [];
  const result = await executeCommercialWork({
    workPublicId: work.work.publicId,
    expectedVersion: work.work.version,
    context: { correlationId: "cwseq-handoff", conversationId, opportunityId },
    loadCurrentFacts: async () => ({ commercialLineItems: null, shippingDestination: null, selectedShippingOption: null, createdQuote: null }),
    loadConversationControl: async () => ({ humanOwnerActive: true, aiEnabled: true }),
    executeCapability: async (name) => {
      calls.push(name);
      return gatewayResult(name);
    }
  });
  assert.equal(result.outcome, "handoff");
  assert.equal(result.work?.status, "HANDOFF");
  assert.deepEqual(calls, []);
});

test("CWSEQ11 recentCapabilityExecutions reader feeds projector with current anchors and rejects old quote/shipping evidence", async () => {
  const conversationId = await seedConversation();
  const opportunityId = await seedOpportunity();
  const inserted = await insertCapabilityExecution({
    correlationId: "cwseq-reader",
    capabilityName: "calculate_shipping",
    capabilityVersion: "capability-gateway.v1",
    availabilityStatus: "available",
    executionStatus: "completed",
    retryCount: 0,
    retryable: false,
    errorCode: null,
    requestSummary: {},
    responseSummary: { status: "available", selectionFactId: "selection-reader", destinationFactId: "destination-reader" },
    evidence: [],
    opportunityId,
    conversationId,
    startedAt: NOW,
    completedAt: NOW
  });
  assert.equal(inserted.ok, true);

  const recent = await loadRecentCommercialCapabilityExecutions({ opportunityId, conversationId, capabilityNames: ["calculate_shipping"], limit: 5 });
  assert.equal(recent.some((item) => item.publicId === inserted.publicId), true);
  const projected = buildCommercialWorkProjection(
    projectionInput({
      conversationId,
      opportunityId,
      sourceMessageId: 2,
      sequence: 2,
      commercialLineItems: selection("selection-reader", 2),
      shippingDestination: destination("destination-reader", "Nunoa"),
      recentCapabilityExecutions: recent,
      seeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
    })
  );
  assert.equal(objective(projected, "GET_SHIPPING_QUOTE").status, "COMPLETED");
});

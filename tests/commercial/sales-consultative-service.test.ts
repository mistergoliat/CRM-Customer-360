import assert from "node:assert/strict";
import test from "node:test";
import { createMemorySalesConsultativeProductRepository, runSalesConsultativeService } from "../../lib/brain/commercial/sales-consultative";
import type {
  SalesConsultativeOperationsRepository,
  SalesConsultativeProduct,
  SalesNeedProfile
} from "../../lib/brain/commercial/sales-consultative";
import type { BrainOutboxWorkerResponse } from "../../lib/brain/messaging/types";

const FIXED_TIME = "2026-06-25T12:00:00.000Z";

function makeProfile(overrides: Partial<SalesNeedProfile> = {}): SalesNeedProfile {
  return {
    useCase: "entrenamiento",
    customerType: "particular",
    goals: ["entrenar en casa"],
    requiredFeatures: [],
    preferredFeatures: [],
    budgetMin: 100000,
    budgetMax: 500000,
    availableSpace: null,
    location: null,
    deliveryDeadline: null,
    experienceLevel: null,
    purchaseUrgency: null,
    decisionReadiness: null,
    missingInformation: [],
    lastUpdatedAt: FIXED_TIME,
    ...overrides
  };
}

function makeProduct(overrides: Partial<SalesConsultativeProduct> & Pick<SalesConsultativeProduct, "id" | "name">): SalesConsultativeProduct {
  return {
    reference: null,
    category: "strength",
    description: null,
    price: 250000,
    currency: "CLP",
    stockQuantity: 5,
    dimensions: {
      width: 100,
      height: 200,
      length: 120,
      unit: "cm"
    },
    features: ["compacto"],
    compatibility: [],
    relatedProductIds: [],
    manufacturer: "TestLab",
    imageUrl: null,
    source: "test",
    ...overrides
  };
}

function buildCustomerContext() {
  return {
    waId: "56912345678",
    phoneNumberId: "phone-001",
    email: "cliente@example.com",
    phone: "+56912345678",
    idCustomer: 2001,
    idOrder: 9001,
    invoiceNumber: 8001,
    contactId: 3001
  };
}

function makeOpsHarness() {
  const calls = {
    queueCustomerMessage: 0
  };

  const repo: SalesConsultativeOperationsRepository = {
    async saveSalesNeedProfile() {
      return { ok: true, profileId: 1, warning: null };
    },
    async createOrUpdateOpportunity() {
      return { ok: true, opportunityId: 42, opportunityKey: "opp-1", warning: null };
    },
    async recordProductInterest() {
      return { ok: true, warning: null };
    },
    async recordObjection() {
      return { ok: true, warning: null };
    },
    async createFollowUpAction() {
      return { ok: true, actionId: 77, warning: null };
    },
    async cancelFollowUpAction() {
      return { ok: true, warning: null };
    },
    async prepareQuote() {
      return { ok: true, quoteId: "quote-1", warning: null };
    },
    async queueCustomerMessage() {
      calls.queueCustomerMessage += 1;
      return { ok: true, queued: true, outboxId: 777, warning: null };
    },
    async requestHumanHandoff() {
      return { ok: true, warning: null };
    },
    async writeAudit() {}
  };

  return { calls, repo };
}

function makeDispatchResponse(): BrainOutboxWorkerResponse {
  return {
    ok: true,
    disabled: false,
    status: "sent",
    dryRun: false,
    lockOnly: false,
    sendLocked: false,
    debug: false,
    locked_count: 1,
    sent_count: 1,
    failed_count: 0,
    skipped_count: 0,
    candidates: [],
    locked_records: [],
    skipped_records: [],
    sent_records: [],
    failed_records: [],
    blocked_reasons: [],
    warnings: [],
    plan: {
      mode: "planned_send",
      enabled: true,
      allowRealSend: true,
      dryRun: false,
      lockOnly: false,
      sendLocked: false,
      debug: false,
      limit: 1,
      batchSize: 1,
      lockSeconds: 60,
      candidateCount: 1,
      lockedCount: 1,
      skippedCount: 0,
      selectedCount: 1,
      candidates: [],
      lockedRecords: [],
      skippedRecords: [],
      transitionResults: [],
      blocked_reasons: [],
      warnings: [],
      notes: []
    },
    metadata: {
      version: "test",
      generatedAt: FIXED_TIME,
      processingMs: 0,
      enabled: true,
      allowRealSend: true,
      dryRun: false,
      lockOnly: false,
      sendLocked: false,
      debug: false,
      limit: 1,
      batchSize: 1,
      lockSeconds: 60,
      outboxId: 777
    }
  };
}

test("consultative service dispatches best-effort outbox after persistence", async () => {
  const productRepo = createMemorySalesConsultativeProductRepository([
    makeProduct({ id: "rack-compact", name: "Rack Compact" })
  ]);
  const ops = makeOpsHarness();
  const dispatchCalls: Array<Record<string, unknown>> = [];

  const result = await runSalesConsultativeService({
    currentTime: FIXED_TIME,
    messageText: "Busco una jaula para entrenar en casa.",
    customerContext: buildCustomerContext(),
    opportunity: null,
    existingProfile: makeProfile(),
    recentInteractions: [],
    productRepository: productRepo,
    operationsRepository: ops.repo,
    currentStageHint: null,
    metadata: { sourceMessageId: "wamid.test.1" }
  }, {
    requestId: "req-001",
    dispatchOutboxWorker: async (request) => {
      dispatchCalls.push(request);
      return makeDispatchResponse();
    }
  });

  assert.equal(result.result.persistence.outboundQueued, true);
  assert.equal(result.result.persistence.outboxId, 777);
  assert.equal(ops.calls.queueCustomerMessage, 1);
  assert.equal(dispatchCalls.length, 1);
  assert.equal(dispatchCalls[0].outboxId, 777);
  assert.equal(dispatchCalls[0].dryRun, false);
  assert.equal(dispatchCalls[0].lockOnly, false);
});

test("consultative service skips dispatch when no outbox id is returned", async () => {
  const productRepo = createMemorySalesConsultativeProductRepository([
    makeProduct({ id: "rack-compact", name: "Rack Compact" })
  ]);
  const ops: SalesConsultativeOperationsRepository = {
    async saveSalesNeedProfile() {
      return { ok: true, profileId: 1, warning: null };
    },
    async createOrUpdateOpportunity() {
      return { ok: true, opportunityId: 42, opportunityKey: "opp-1", warning: null };
    },
    async recordProductInterest() {
      return { ok: true, warning: null };
    },
    async recordObjection() {
      return { ok: true, warning: null };
    },
    async createFollowUpAction() {
      return { ok: true, actionId: 77, warning: null };
    },
    async cancelFollowUpAction() {
      return { ok: true, warning: null };
    },
    async prepareQuote() {
      return { ok: true, quoteId: "quote-1", warning: null };
    },
    async queueCustomerMessage() {
      return { ok: true, queued: true, outboxId: null, warning: null };
    },
    async requestHumanHandoff() {
      return { ok: true, warning: null };
    },
    async writeAudit() {}
  };

  let dispatched = false;
  const result = await runSalesConsultativeService({
    currentTime: FIXED_TIME,
    messageText: "Busco una jaula para entrenar en casa.",
    customerContext: buildCustomerContext(),
    opportunity: null,
    existingProfile: makeProfile(),
    recentInteractions: [],
    productRepository: productRepo,
    operationsRepository: ops,
    currentStageHint: null,
    metadata: { sourceMessageId: "wamid.test.2" }
  }, {
    dispatchOutboxWorker: async () => {
      dispatched = true;
      return makeDispatchResponse();
    }
  });

  assert.equal(result.result.persistence.outboundQueued, true);
  assert.equal(result.result.persistence.outboxId, null);
  assert.equal(dispatched, false);
});

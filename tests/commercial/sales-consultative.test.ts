import assert from "node:assert/strict";
import test from "node:test";
import { createMemorySalesConsultativeProductRepository } from "../../lib/brain/commercial/sales-consultative";
import type {
  SalesConsultativeOperationsRepository,
  SalesConsultativeProduct,
  SalesConsultativeResult,
  SalesNeedProfile
} from "../../lib/brain/commercial/sales-consultative";
import { runSalesConsultativeFlow } from "../../lib/brain/commercial/sales-consultative";

const FIXED_TIME = "2026-06-25T12:00:00.000Z";

function makeProfile(overrides: Partial<SalesNeedProfile> = {}): SalesNeedProfile {
  return {
    useCase: null,
    customerType: null,
    goals: [],
    requiredFeatures: [],
    preferredFeatures: [],
    budgetMin: null,
    budgetMax: null,
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
    category: "cardio",
    description: null,
    price: 100000,
    currency: "CLP",
    stockQuantity: 10,
    dimensions: {
      width: 50,
      height: 120,
      length: 120,
      unit: "cm"
    },
    features: [],
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

function createOpsHarness() {
  const calls = {
    saveSalesNeedProfile: 0,
    createOrUpdateOpportunity: 0,
    recordProductInterest: 0,
    recordObjection: 0,
    createFollowUpAction: 0,
    cancelFollowUpAction: 0,
    prepareQuote: 0,
    queueCustomerMessage: 0,
    requestHumanHandoff: 0,
    writeAudit: 0
  };

  const repo: SalesConsultativeOperationsRepository = {
    async saveSalesNeedProfile(input) {
      calls.saveSalesNeedProfile += 1;
      return { ok: true, profileId: 1, warning: null };
    },
    async createOrUpdateOpportunity(input) {
      calls.createOrUpdateOpportunity += 1;
      return { ok: true, opportunityId: 42, opportunityKey: input.opportunity?.opportunityKey ?? "opp-test", warning: null };
    },
    async recordProductInterest() {
      calls.recordProductInterest += 1;
      return { ok: true, warning: null };
    },
    async recordObjection() {
      calls.recordObjection += 1;
      return { ok: true, warning: null };
    },
    async createFollowUpAction() {
      calls.createFollowUpAction += 1;
      return { ok: true, actionId: 77, warning: null };
    },
    async cancelFollowUpAction() {
      calls.cancelFollowUpAction += 1;
      return { ok: true, warning: null };
    },
    async prepareQuote() {
      calls.prepareQuote += 1;
      return { ok: true, quoteId: "quote-test", warning: null };
    },
    async queueCustomerMessage() {
      calls.queueCustomerMessage += 1;
      return { ok: true, queued: true, outboxId: 99, warning: null };
    },
    async requestHumanHandoff() {
      calls.requestHumanHandoff += 1;
      return { ok: true, warning: null };
    },
    async writeAudit() {
      calls.writeAudit += 1;
    }
  };

  return { calls, repo };
}

function toIdValue(value: unknown, fallback: string | number | null = null): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && String(parsed) === trimmed ? parsed : trimmed;
  }
  return fallback;
}

function buildFlowInput(messageText: string, options: {
  profile?: SalesNeedProfile | null;
  opportunity?: Record<string, unknown> | null;
  products: SalesConsultativeProduct[];
  related?: Record<string, SalesConsultativeProduct[]>;
  currentTime?: string;
}) {
  const productRepo = createMemorySalesConsultativeProductRepository(options.products);
  const related = options.related ?? {};
  const wrappedProductRepo = {
    ...productRepo,
    async getRelatedProducts(productId: string) {
      return related[productId] ?? productRepo.getRelatedProducts(productId);
    }
  };
  const ops = createOpsHarness();
  const opportunity = options.opportunity
    ? {
        id: toIdValue(options.opportunity.id, 1),
        opportunityKey: String(options.opportunity.opportunityKey ?? "opp-1"),
        status: String(options.opportunity.status ?? "engaged"),
        stage: (options.opportunity.stage as string | null) ?? null,
        primaryIntent: String(options.opportunity.primaryIntent ?? "product_recommendation"),
        currentSummary: (options.opportunity.currentSummary as string | null) ?? null,
        nextActionType: (options.opportunity.nextActionType as string | null) ?? null,
        nextActionDueAt: (options.opportunity.nextActionDueAt as string | null) ?? null,
        waitingFor: (options.opportunity.waitingFor as string | null) ?? null,
        humanOwnerActive: Boolean(options.opportunity.humanOwnerActive),
        aiBlocked: Boolean(options.opportunity.aiBlocked),
        customerCandidateId: toIdValue(options.opportunity.customerCandidateId),
        customerMasterId: toIdValue(options.opportunity.customerMasterId),
        leadId: toIdValue(options.opportunity.leadId),
        conversationCaseId: toIdValue(options.opportunity.conversationCaseId),
        waId: options.opportunity.waId ? String(options.opportunity.waId) : "56912345678",
        requirements: (options.opportunity.requirements as unknown[] | undefined) ?? [],
        missingRequirements: (options.opportunity.missingRequirements as unknown[] | undefined) ?? [],
        productInterests: (options.opportunity.productInterests as unknown[] | undefined) ?? [],
        objections: (options.opportunity.objections as never[] | undefined) ?? [],
        signals: (options.opportunity.signals as string[] | undefined) ?? [],
        version: Number(options.opportunity.version ?? 1),
        lastActivityAt: String(options.opportunity.lastActivityAt ?? FIXED_TIME),
        closedAt: (options.opportunity.closedAt as string | null) ?? null
      }
    : null;

  return {
    input: {
      currentTime: options.currentTime ?? FIXED_TIME,
      messageText,
      customerContext: buildCustomerContext(),
      opportunity,
      existingProfile: options.profile ?? null,
      recentInteractions: [],
      productRepository: wrappedProductRepo,
      operationsRepository: ops.repo,
      currentStageHint: null,
      metadata: { sourceMessageId: "wamid.test.1" }
    },
    ops,
    productRepo: wrappedProductRepo
  };
}

function assertMainProduct(result: SalesConsultativeResult, expectedId: string) {
  assert.ok(result.recommendation.main);
  assert.equal(result.recommendation.main?.product.id, expectedId);
}

test("1. recomendación con información incompleta", async () => {
  const products = [makeProduct({ id: "bike-basic", name: "Bike Basic", price: 90000, stockQuantity: 10 })];
  const { input } = buildFlowInput("hola, necesito ayuda", { products, profile: null });
  const result = await runSalesConsultativeFlow(input);

  assert.equal(result.nextBestAction, "ask_qualification_question");
  assert.equal(result.stage, "discovery");
  assert.equal(result.recommendation.main, null);
  assert.ok(result.responseText.includes("me falta"));
});

test("2. recomendación con presupuesto", async () => {
  const products = [
    makeProduct({ id: "bike-premium", name: "Bike Premium", price: 280000, stockQuantity: 10, features: ["compacto", "premium"] }),
    makeProduct({ id: "bike-basic", name: "Bike Basic", price: 120000, stockQuantity: 10, features: ["compacto", "economico"] })
  ];
  const { input } = buildFlowInput("Busco una bici para gimnasio con presupuesto de 150 mil", {
    products,
    profile: makeProfile({
      useCase: "gimnasio",
      customerType: "empresa",
      budgetMin: 100000,
      budgetMax: 180000,
      missingInformation: []
    })
  });
  const result = await runSalesConsultativeFlow(input);

  assertMainProduct(result, "bike-basic");
  assert.equal(result.recommendation.main?.isValid, true);
  assert.ok(result.responseText.includes("presupuesto"));
});

test("3. recomendación con restricción de espacio", async () => {
  const products = [
    makeProduct({
      id: "treadmill-xl",
      name: "Treadmill XL",
      price: 300000,
      stockQuantity: 5,
      dimensions: { width: 180, height: 150, length: 220, unit: "cm" }
    }),
    makeProduct({
      id: "bike-mini",
      name: "Bike Mini",
      price: 180000,
      stockQuantity: 10,
      dimensions: { width: 50, height: 110, length: 120, unit: "cm" }
    })
  ];
  const { input } = buildFlowInput("Solo tengo 0.8 x 1.2 x 1.0 m de espacio", {
    products,
    profile: makeProfile({
      useCase: "hogar",
      availableSpace: { width: 80, height: 120, length: 100, unit: "cm" },
      missingInformation: []
    })
  });
  const result = await runSalesConsultativeFlow(input);

  assertMainProduct(result, "bike-mini");
  assert.equal(result.recommendation.candidates.find((candidate) => candidate.product.id === "treadmill-xl")?.isValid, false);
});

test("4. alternativa económica", async () => {
  const products = [
    makeProduct({ id: "premium-rower", name: "Premium Rower", price: 350000, stockQuantity: 10, features: ["premium", "resistente"] }),
    makeProduct({ id: "basic-rower", name: "Basic Rower", price: 120000, stockQuantity: 10, features: ["economico", "resistente"] })
  ];
  const { input } = buildFlowInput("Quiero algo profesional pero sin disparar el presupuesto", {
    products,
    profile: makeProfile({
      useCase: "gimnasio",
      budgetMin: 100000,
      budgetMax: 400000,
      missingInformation: []
    })
  });
  const result = await runSalesConsultativeFlow(input);

  assertMainProduct(result, "premium-rower");
  assert.equal(result.recommendation.alternative?.product.id, "basic-rower");
  assert.ok((result.recommendation.alternative?.product.price ?? 0) < (result.recommendation.main?.product.price ?? Infinity));
});

test("5. upsell justificado", async () => {
  const products = [
    makeProduct({ id: "bike-pro", name: "Bike Pro", price: 290000, stockQuantity: 8, features: ["compacto", "premium"] }),
    makeProduct({ id: "bundle-mat", name: "Bundle Mat", price: 40000, stockQuantity: 20, features: ["compacto", "bundle"] })
  ];
  const { input } = buildFlowInput("Quiero comprar una bici premium ahora", {
    products,
    related: {
      "bike-pro": [products[1]]
    },
    profile: makeProfile({
      useCase: "hogar",
      customerType: "particular",
      budgetMax: 400000,
      missingInformation: []
    })
  });
  const result = await runSalesConsultativeFlow(input);

  assert.equal(result.nextBestAction, "offer_bundle");
  assertMainProduct(result, "bike-pro");
  assert.equal(result.recommendation.complements[0]?.id, "bundle-mat");
});

test("6. cross-sell compatible", async () => {
  const products = [
    makeProduct({ id: "bike-pro", name: "Bike Pro", price: 290000, stockQuantity: 8, features: ["compacto", "premium"] }),
    makeProduct({ id: "sensor-hr", name: "Sensor HR", price: 35000, stockQuantity: 20, features: ["compacto", "silencioso"] })
  ];
  const { input } = buildFlowInput("Busco una bici y accesorios compatibles", {
    products,
    related: {
      "bike-pro": [products[1]]
    },
    profile: makeProfile({
      useCase: "hogar",
      requiredFeatures: ["compatibilidad"],
      missingInformation: []
    })
  });
  const result = await runSalesConsultativeFlow(input);

  assert.equal(result.nextBestAction, "offer_bundle");
  assert.ok(result.recommendation.complements.some((product) => product.id === "sensor-hr"));
  assert.ok(result.responseText.includes("Complementos compatibles"));
});

test("7. producto sin stock", async () => {
  const products = [
    makeProduct({ id: "out-stock-bike", name: "Out Stock Bike", price: 150000, stockQuantity: 0, features: ["compacto"] }),
    makeProduct({ id: "in-stock-bike", name: "In Stock Bike", price: 170000, stockQuantity: 5, features: ["compacto"] })
  ];
  const { input } = buildFlowInput("Quiero una bici compacta", {
    products,
    profile: makeProfile({
      useCase: "hogar",
      missingInformation: []
    })
  });
  const result = await runSalesConsultativeFlow(input);

  assert.equal(result.recommendation.candidates.find((candidate) => candidate.product.id === "out-stock-bike")?.isValid, false);
  assertMainProduct(result, "in-stock-bike");
});

test("8. objeción de precio", async () => {
  const products = [
    makeProduct({ id: "bike-premium", name: "Bike Premium", price: 280000, stockQuantity: 10, features: ["compacto", "premium"] }),
    makeProduct({ id: "bike-basic", name: "Bike Basic", price: 120000, stockQuantity: 10, features: ["compacto", "economico"] })
  ];
  const { input, ops } = buildFlowInput("Está muy caro", {
    products,
    profile: makeProfile({
      useCase: "hogar",
      customerType: "particular",
      missingInformation: []
    })
  });
  const result = await runSalesConsultativeFlow(input);

  assert.equal(result.objections[0]?.type, "price");
  assert.equal(result.nextBestAction, "recommend_alternative");
  assert.equal(ops.calls.recordObjection, 1);
});

test("9. cliente indeciso", async () => {
  const products = [makeProduct({ id: "bike-basic", name: "Bike Basic", price: 120000, stockQuantity: 10 })];
  const { input } = buildFlowInput("Estoy comparando y no estoy listo, hablamos después", {
    products,
    profile: makeProfile({
      useCase: "hogar",
      missingInformation: []
    })
  });
  const result = await runSalesConsultativeFlow(input);

  assert.equal(result.nextBestAction, "schedule_follow_up");
  assert.equal(result.followUp.scheduled, true);
});

test("10. intención inmediata de compra", async () => {
  const products = [makeProduct({ id: "bike-pro", name: "Bike Pro", price: 280000, stockQuantity: 10, features: ["compacto"] })];
  const { input } = buildFlowInput("Lo compro ahora, envíame el link de pago", {
    products,
    profile: makeProfile({
      useCase: "hogar",
      missingInformation: []
    })
  });
  const result = await runSalesConsultativeFlow(input);

  assert.equal(result.nextBestAction, "provide_checkout_link");
  assert.ok(result.responseText.includes("link"));
});

test("11. seguimiento programado", async () => {
  const products = [makeProduct({ id: "bike-basic", name: "Bike Basic", price: 120000, stockQuantity: 10 })];
  const { input, ops } = buildFlowInput("No estoy listo, escríbeme la próxima semana", {
    products,
    profile: makeProfile({
      useCase: "hogar",
      missingInformation: []
    })
  });
  const result = await runSalesConsultativeFlow(input);

  assert.equal(result.nextBestAction, "schedule_follow_up");
  assert.equal(ops.calls.createFollowUpAction, 1);
  assert.equal(result.persistence.actionSaved, true);
});

test("12. cancelación de seguimiento al recibir respuesta", async () => {
  const products = [makeProduct({ id: "bike-basic", name: "Bike Basic", price: 120000, stockQuantity: 10 })];
  const { input, ops } = buildFlowInput("Sí, retomemos la conversación", {
    products,
    opportunity: {
      id: 1,
      opportunityKey: "opp-followup",
      status: "followup_scheduled",
      stage: "follow_up",
      nextActionType: "schedule_follow_up",
      waitingFor: "customer_reply",
      waId: "56912345678"
    },
    profile: makeProfile({
      useCase: "hogar",
      missingInformation: []
    })
  });
  const result = await runSalesConsultativeFlow(input);

  assert.equal(ops.calls.cancelFollowUpAction, 1);
  assert.equal(result.followUp.cancelled, true);
});

test("13. producto inexistente", async () => {
  const { input } = buildFlowInput("Busco un producto inexistente", {
    products: [],
    profile: makeProfile({ missingInformation: [] })
  });
  const result = await runSalesConsultativeFlow(input);

  assert.equal(result.recommendation.main, null);
  assert.ok(["ask_qualification_question", "wait_for_customer"].includes(result.nextBestAction));
});

test("14. tool fallida", async () => {
  const products = [makeProduct({ id: "bike-basic", name: "Bike Basic", price: 120000, stockQuantity: 10 })];
  const productRepo = {
    async searchProducts() {
      throw new Error("catalog tool failed");
    },
    async getProductDetails(productId: string) {
      return products.find((product) => product.id === productId) ?? null;
    },
    async getProductPrice(productId: string) {
      return products.find((product) => product.id === productId)?.price ?? null;
    },
    async getProductStock(productId: string) {
      return products.find((product) => product.id === productId)?.stockQuantity ?? null;
    },
    async getProductDimensions(productId: string) {
      return products.find((product) => product.id === productId)?.dimensions ?? null;
    },
    async getProductCompatibility(productId: string) {
      return products.find((product) => product.id === productId)?.compatibility ?? [];
    },
    async getRelatedProducts() {
      return [];
    }
  };
  const ops = createOpsHarness();
  const result = await runSalesConsultativeFlow({
    currentTime: FIXED_TIME,
    messageText: "Quiero ver catálogo",
    customerContext: buildCustomerContext(),
    opportunity: null,
    existingProfile: null,
    recentInteractions: [],
    productRepository: productRepo,
    operationsRepository: ops.repo,
    currentStageHint: null,
    metadata: {}
  });

  assert.equal(result.handled, true);
  assert.ok(result.warnings.some((warning) => warning.includes("catalog tool failed")));
});

test("15. handoff humano", async () => {
  const products = [makeProduct({ id: "bike-basic", name: "Bike Basic", price: 120000, stockQuantity: 10 })];
  const { input, ops } = buildFlowInput("Quiero hablar con una persona", {
    products,
    profile: makeProfile({
      useCase: "hogar",
      missingInformation: []
    })
  });
  const result = await runSalesConsultativeFlow(input);

  assert.equal(result.nextBestAction, "handoff_to_human");
  assert.equal(ops.calls.requestHumanHandoff, 1);
  assert.equal(result.persistence.humanHandoffRequested, true);
});

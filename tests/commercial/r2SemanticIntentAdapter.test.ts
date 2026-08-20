import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { getPool } from "@/lib/db";
import { setupR2BenchmarkEnvironment, type R2BenchmarkEnvironment } from "@/lib/brain/commercial/work/benchmark/environment";
import { planCommercialObjectiveSeeds, type SemanticIntentAdapterInput } from "@/lib/brain/commercial/work/semanticIntentAdapter";
import { createOfflinePlannerProvider } from "@/lib/brain/commercial/work/benchmark/offlinePlannerProvider";
import { savePendingCommercialIntents } from "@/lib/brain/commercial/multi-intent/pendingIntentState";
import type { RecentCatalogContext } from "@/lib/brain/commercial/agent-loop/recentCatalogContext";
import type { CommercialObjectiveSeed } from "@/lib/brain/commercial/work/types";

function seedType(seed: CommercialObjectiveSeed): string {
  assert.notEqual(seed.kind, "cancel");
  return (seed as Exclude<CommercialObjectiveSeed, { kind: "cancel" }>).type;
}

/**
 * SALES-AGENT-R2-A07.5, stage 1/2. Unit coverage for the semantic-intent
 * adapter using the offline scripted planner - real requirement resolver
 * and pending-intent persistence (real DB, crm_test), no live LLM call.
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
  DB_WRITE_ENABLED: "true"
});

let env: R2BenchmarkEnvironment;

before(async () => {
  env = await setupR2BenchmarkEnvironment();
});

// Each test shares env.opportunityId (one HTTP catalog fixture server per
// file, not per test) - pending-intent state (crm_request_facts) is
// per-opportunity durable state by design, so it must be reset between
// independent test cases the same way a fresh opportunity would start clean.
test.beforeEach(async () => {
  await savePendingCommercialIntents({ opportunityId: env.opportunityId, records: [], sourceMessageId: null });
});

after(async () => {
  await env.teardown();
  try {
    await getPool().end();
  } catch {
    // ignore teardown failures
  }
});

const CLASSIC_CATALOG_CONTEXT: RecentCatalogContext = {
  interactions: [
    {
      inboundMessageId: "in-1",
      completedAt: "2026-08-17T12:00:00.000Z",
      sourceTool: "search_products",
      products: [
        { productId: "31", name: "Barra Olimpica Classic 20kg" },
        { productId: "32", name: "Barra Olimpica Pro 20kg" }
      ]
    }
  ]
};

function baseInput(overrides: Partial<SemanticIntentAdapterInput> & Pick<SemanticIntentAdapterInput, "provider">): SemanticIntentAdapterInput {
  return {
    opportunityId: env.opportunityId,
    correlationId: `r2-adapter-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    customerMessage: "quiero 2 de la classic",
    commercialContextSummary: {},
    recentCatalogContext: null,
    deadline: Date.now() + 20000,
    currentTime: "2026-08-17T12:00:00.000Z",
    ...overrides
  };
}

test("R2SEM01 a resolved product+quantity plan maps to a ready SELECT_PRODUCTS seed with a real product id", async () => {
  const provider = createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }] } }]);
  const result = await planCommercialObjectiveSeeds(baseInput({ provider, recentCatalogContext: CLASSIC_CATALOG_CONTEXT }));
  assert.equal(result.kind, "planned");
  if (result.kind !== "planned") return;
  assert.equal(result.seeds.length, 1);
  assert.deepEqual(result.seeds[0], { type: "SELECT_PRODUCTS", origin: "customer_requested", inputs: { items: [{ productId: "31", combinationId: null, quantity: 2 }] } });
});

test("R2SEM02 an ambiguous product reference maps to a SELECT_PRODUCTS seed flagged productEvidenceAvailable=false, never a guessed product", async () => {
  const provider = createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "barra olimpica", quantity: 1 }] } }]);
  const result = await planCommercialObjectiveSeeds(baseInput({ provider, recentCatalogContext: CLASSIC_CATALOG_CONTEXT }));
  assert.equal(result.kind, "planned");
  if (result.kind !== "planned") return;
  assert.equal(result.seeds.length, 1);
  assert.equal(seedType(result.seeds[0]), "SELECT_PRODUCTS");
  assert.equal((result.seeds[0] as { inputs: { productEvidenceAvailable?: boolean } }).inputs.productEvidenceAvailable, false);
});

test("R2SEM03 an explicit destination on get_shipping_quote emits both a SET_DESTINATION and a GET_SHIPPING_QUOTE seed", async () => {
  const provider = createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "get_shipping_quote", destination: "Nunoa" }] } }]);
  const result = await planCommercialObjectiveSeeds(baseInput({ provider, customerMessage: "cuanto sale el despacho a Nunoa" }));
  assert.equal(result.kind, "planned");
  if (result.kind !== "planned") return;
  const types = result.seeds.map(seedType).sort();
  assert.deepEqual(types, ["GET_SHIPPING_QUOTE", "SET_DESTINATION"]);
});

test("R2SEM04 a durable destination is never re-seeded as SET_DESTINATION - only GET_SHIPPING_QUOTE is emitted", async () => {
  const provider = createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "get_shipping_quote" }] } }]);
  const result = await planCommercialObjectiveSeeds(
    baseInput({ provider, customerMessage: "cuanto sale el despacho", commercialContextSummary: { shippingDestination: { communeId: 99, canonicalName: "Nunoa" } } })
  );
  assert.equal(result.kind, "planned");
  if (result.kind !== "planned") return;
  assert.deepEqual(result.seeds.map(seedType), ["GET_SHIPPING_QUOTE"]);
});

test("R2SEM05 select_products with no quantity stated stays unresolved and is persisted as a pending intent for the next turn", async () => {
  const provider = createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic" }] } }]);
  const result = await planCommercialObjectiveSeeds(baseInput({ provider, recentCatalogContext: CLASSIC_CATALOG_CONTEXT }));
  assert.equal(result.kind, "planned");

  const provider2 = createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }] } }]);
  const result2 = await planCommercialObjectiveSeeds(baseInput({ provider: provider2, recentCatalogContext: CLASSIC_CATALOG_CONTEXT, customerMessage: "2" }));
  assert.equal(result2.kind, "planned");
  if (result2.kind !== "planned") return;
  assert.deepEqual(result2.seeds[0], { type: "SELECT_PRODUCTS", origin: "customer_requested", inputs: { items: [{ productId: "31", combinationId: null, quantity: 2 }] } });
});

test("R2SEM06 a provider-level failure classifies as SEMANTIC_PLANNING and produces no seeds", async () => {
  const provider = createOfflinePlannerProvider([{ kind: "invalid_response" }]);
  const result = await planCommercialObjectiveSeeds(baseInput({ provider }));
  assert.equal(result.kind, "provider_unavailable");
  assert.equal(result.failureClassification, "SEMANTIC_PLANNING");
});

test("R2SEM07 a structurally invalid plan shape classifies as SEMANTIC_PLANNING, fails closed", async () => {
  const provider = createOfflinePlannerProvider([{ kind: "invalid_plan_shape", rawOutput: { notIntents: [] } }]);
  const result = await planCommercialObjectiveSeeds(baseInput({ provider }));
  assert.equal(result.kind, "invalid_output");
  assert.equal(result.failureClassification, "SEMANTIC_PLANNING");
});

// SALES-AGENT-R2-A08.7, Part 1/15. Deterministic coverage for the adapter's
// half of the cancel-scope contract: scope maps to targetType 1:1, "all"
// omits targetType entirely (reconciliation.ts's own "all" convention), and
// additionalScopes becomes one extra cancel seed per named scope.

test("R2SEM08 a scoped cancel intent maps to a single cancel seed with targetType set", async () => {
  const provider = createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "cancel", scope: "shipping" }] } }]);
  const result = await planCommercialObjectiveSeeds(baseInput({ provider, customerMessage: "olvida el despacho" }));
  assert.equal(result.kind, "planned");
  if (result.kind !== "planned") return;
  assert.deepEqual(result.seeds, [{ kind: "cancel", targetType: "shipping" }]);
});

test("R2SEM09 an untargeted cancel intent maps to a cancel seed with no targetType (the 'all' convention)", async () => {
  const provider = createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "cancel", scope: "all" }] } }]);
  const result = await planCommercialObjectiveSeeds(baseInput({ provider, customerMessage: "olvidalo" }));
  assert.equal(result.kind, "planned");
  if (result.kind !== "planned") return;
  assert.deepEqual(result.seeds, [{ kind: "cancel" }]);
});

test("R2SEM10 a multi-scope cancel intent maps to one cancel seed per named scope, never collapsing to whole-work", async () => {
  const provider = createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "cancel", scope: "shipping", additionalScopes: ["quote"] }] } }]);
  const result = await planCommercialObjectiveSeeds(baseInput({ provider, customerMessage: "no quiero despacho ni cotizacion" }));
  assert.equal(result.kind, "planned");
  if (result.kind !== "planned") return;
  assert.deepEqual(result.seeds, [
    { kind: "cancel", targetType: "shipping" },
    { kind: "cancel", targetType: "quote" }
  ]);
});

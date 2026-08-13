import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { runCommercialMultiIntentLoop } from "@/lib/brain/commercial/multi-intent/runCommercialMultiIntentLoop";
import { loadPendingCommercialIntents } from "@/lib/brain/commercial/multi-intent/pendingIntentState";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import { setupBenchmarkEnvironment, seedBenchmarkSelection, BENCHMARK_PRODUCTS } from "@/lib/brain/commercial/agent-loop/benchmark/environment";
import type { RecentCatalogContext } from "@/lib/brain/commercial/agent-loop/recentCatalogContext";
import type { RunAgentToolLoopInput } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { buildMultiIntentPlannerFeatureFlags } from "@/lib/brain/commercial/config/commercialCycleConfig";

// LLM-R1-T09A. Same local dev DB bootstrap tests/agent-loop/runAgentToolLoop.test.ts
// and tests/commercial/selectProductsCapability.test.ts already establish -
// select_products/set_shipping_destination genuinely persist durable state.
Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: ""
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures - test results already reported
  }
});

function uniqueOpportunityId() {
  return 831000000 + Math.floor(Math.random() * 9999999);
}

const CLASSIC = BENCHMARK_PRODUCTS["31"];

function classicCatalogContext(): RecentCatalogContext {
  return { interactions: [{ inboundMessageId: "m1", completedAt: new Date().toISOString(), sourceTool: "search_products", products: [{ productId: CLASSIC.productId, name: CLASSIC.name, position: 1 }] }] };
}

function baseLoopInput(overrides: Partial<RunAgentToolLoopInput>): RunAgentToolLoopInput {
  return {
    correlationId: `mi-test-${Math.random().toString(36).slice(2)}`,
    conversationId: null,
    opportunityId: null,
    currentTime: new Date().toISOString(),
    customerMessage: "",
    commercialContextSummary: {},
    provider: null,
    ...overrides
  };
}

// Part 21 test 1.
test("[MI-Loop-1] single select_products intent: resolves, executes, and produces one consolidated respond", async () => {
  const env = await setupBenchmarkEnvironment();
  try {
    const provider = createFakeAgentLoopProvider({
      script: [
        { intents: [{ type: "select_products", productReference: "Classic", quantity: 2 }] },
        { type: "respond", message: "Listo, quedaron seleccionadas 2 unidades de Barra Olimpica Classic 20kg." }
      ]
    });

    const result = await runCommercialMultiIntentLoop(
      baseLoopInput({ opportunityId: env.opportunityId, customerMessage: "quiero 2 de la classic", recentCatalogContext: classicCatalogContext(), provider })
    );

    assert.equal(result.terminalReason, "responded");
    assert.equal(result.toolExecutionCount, 1);
    const selectStep = result.steps.find((s) => s.step.type === "use_tool" && s.step.tool === "select_products");
    assert.equal(selectStep?.observation?.status, "completed");
    assert.equal(result.finalMessage, "Listo, quedaron seleccionadas 2 unidades de Barra Olimpica Classic 20kg.");
    assert.ok(!result.warnings.some((w) => w.startsWith("agent_loop_mutation_claim_blocked:")), "a genuinely backed claim is never blocked");
  } finally {
    await env.teardown();
  }
});

// Part 21 test 2.
test("[MI-Loop-2] single get_shipping_quote with a durable selection and a stated destination: resolves and executes a real quote", async () => {
  const env = await setupBenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: CLASSIC.productId, quantity: 1 }]);
    const provider = createFakeAgentLoopProvider({
      script: [{ intents: [{ type: "get_shipping_quote", destination: "Ñuñoa" }] }, { type: "respond", message: "El despacho a Ñuñoa cuesta $4.990, llega en 2-3 dias habiles." }]
    });

    const result = await runCommercialMultiIntentLoop(
      baseLoopInput({
        opportunityId: env.opportunityId,
        customerMessage: "cuanto sale el despacho a Ñuñoa",
        commercialContextSummary: { commercialLineItems: { items: [{ productId: CLASSIC.productId, combinationId: null, quantity: 1 }] } },
        provider
      })
    );

    assert.equal(result.terminalReason, "responded");
    const shippingStep = result.steps.find((s) => s.step.type === "use_tool" && s.step.tool === "calculate_shipping");
    assert.equal(shippingStep?.observation?.status, "completed");
    assert.equal((shippingStep?.observation?.data as { status?: string } | undefined)?.status, "available");
  } finally {
    await env.teardown();
  }
});

// Part 21 test 3 (MI01).
test("[MI-Loop-3] select_products + get_shipping_quote fully resolvable in one turn plans and executes all three steps in order", async () => {
  const env = await setupBenchmarkEnvironment();
  try {
    const provider = createFakeAgentLoopProvider({
      script: [
        { intents: [{ type: "select_products", productReference: "Classic", quantity: 2 }, { type: "get_shipping_quote", destination: "Ñuñoa" }] },
        { type: "respond", message: "Perfecto, quedan 2 Barra Olimpica Classic 20kg y el despacho a Ñuñoa cuesta $4.990." }
      ]
    });

    const result = await runCommercialMultiIntentLoop(
      baseLoopInput({ opportunityId: env.opportunityId, customerMessage: "quiero 2 de la classic y cuanto sale el despacho a Ñuñoa", recentCatalogContext: classicCatalogContext(), provider })
    );

    assert.equal(result.terminalReason, "responded");
    const toolSteps = result.steps.filter((s) => s.step.type === "use_tool");
    assert.deepEqual(toolSteps.map((s) => (s.step as { tool: string }).tool), ["select_products", "set_shipping_destination", "calculate_shipping"]);
    assert.ok(toolSteps.every((s) => s.observation?.status === "completed"));
    assert.equal(result.toolExecutionCount, 3);
  } finally {
    await env.teardown();
  }
});

// Part 21 test 4 (MI02): partial completion - never aborts the whole plan because a second intent is incomplete.
test("[MI-Loop-4] select_products completes while get_shipping_quote (no destination given) stays waiting - only destination is asked", async () => {
  const env = await setupBenchmarkEnvironment();
  try {
    const provider = createFakeAgentLoopProvider({
      script: [
        { intents: [{ type: "select_products", productReference: "Classic", quantity: 2 }, { type: "get_shipping_quote" }] },
        { type: "respond", message: "Perfecto, quedan 2 Barra Olimpica Classic 20kg. Cual es tu comuna para calcular el despacho?" }
      ]
    });

    const result = await runCommercialMultiIntentLoop(
      baseLoopInput({ opportunityId: env.opportunityId, customerMessage: "quiero 2 de la classic y cuanto sale el despacho", recentCatalogContext: classicCatalogContext(), provider })
    );

    assert.equal(result.terminalReason, "responded");
    const toolNames = result.steps.filter((s) => s.step.type === "use_tool").map((s) => (s.step as { tool: string }).tool);
    assert.deepEqual(toolNames, ["select_products"], "set_shipping_destination/calculate_shipping are never planned while DESTINATION is missing");
    assert.equal(result.steps[0].observation?.status, "completed");

    const pending = await loadPendingCommercialIntents(env.opportunityId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].intent.type, "get_shipping_quote");
    assert.deepEqual(pending[0].missingRequirements, ["DESTINATION"]);
  } finally {
    await env.teardown();
  }
});

// Part 21 test 5: continuation across two turns.
test("[MI-Loop-5] a later bare-destination reply resolves the pending get_shipping_quote without repeating the whole request", async () => {
  const env = await setupBenchmarkEnvironment();
  try {
    const turn1Provider = createFakeAgentLoopProvider({
      script: [
        { intents: [{ type: "select_products", productReference: "Classic", quantity: 2 }, { type: "get_shipping_quote" }] },
        { type: "respond", message: "Perfecto, quedan 2 Barra Olimpica Classic 20kg. Cual es tu comuna para el despacho?" }
      ]
    });
    const turn1 = await runCommercialMultiIntentLoop(
      baseLoopInput({ opportunityId: env.opportunityId, customerMessage: "quiero 2 de la classic y cuanto sale el despacho", recentCatalogContext: classicCatalogContext(), provider: turn1Provider })
    );
    assert.equal(turn1.terminalReason, "responded");
    const pendingAfterTurn1 = await loadPendingCommercialIntents(env.opportunityId);
    assert.equal(pendingAfterTurn1.length, 1);

    // Turn 2: the durable selection is now real (persisted by turn 1's own select_products call) -
    // the caller (runNativeAgentToolLoopCycle in production) would reload this from the DB; here it is
    // passed the same way every other test in this file passes commercialContextSummary directly.
    const turn2Provider = createFakeAgentLoopProvider({
      script: [{ intents: [{ type: "get_shipping_quote", destination: "Ñuñoa" }] }, { type: "respond", message: "El despacho a Ñuñoa cuesta $4.990." }]
    });
    const turn2 = await runCommercialMultiIntentLoop(
      baseLoopInput({
        opportunityId: env.opportunityId,
        customerMessage: "Ñuñoa",
        commercialContextSummary: { commercialLineItems: { items: [{ productId: CLASSIC.productId, combinationId: null, quantity: 2 }] } },
        provider: turn2Provider
      })
    );

    assert.equal(turn2.terminalReason, "responded");
    const turn2ToolSteps = turn2.steps.filter((s) => s.step.type === "use_tool");
    assert.deepEqual(turn2ToolSteps.map((s) => (s.step as { tool: string }).tool), ["set_shipping_destination", "calculate_shipping"], "no select_products replanned - only the pending shipping quote continues");
    assert.ok(turn2ToolSteps.every((s) => s.observation?.status === "completed"));

    const pendingAfterTurn2 = await loadPendingCommercialIntents(env.opportunityId);
    assert.equal(pendingAfterTurn2.length, 0, "the pending intent is cleared once it completes");
  } finally {
    await env.teardown();
  }
});

// Part 21 test 14: the Commercial Mutation Execution Guard still gates the multi-intent finalizer's output.
test("[MI-Loop-6] the mutation guard blocks an unbacked claim even when no product was ever selected this turn", async () => {
  const env = await setupBenchmarkEnvironment();
  try {
    const provider = createFakeAgentLoopProvider({
      script: [{ intents: [{ type: "unsupported", description: "reservar para otra persona" }] }, { type: "respond", message: "Listo, te dejo 3 unidades reservadas." }]
    });

    const result = await runCommercialMultiIntentLoop(baseLoopInput({ opportunityId: env.opportunityId, customerMessage: "resérvamelo para mi hermano", provider }));

    assert.equal(result.terminalReason, "responded");
    assert.equal(
      result.finalMessage,
      "Necesito un momento mas para confirmar tu seleccion antes de continuar - ¿puedes confirmarme nuevamente que producto y cantidad quieres?"
    );
    assert.ok(result.warnings.some((w) => w.startsWith("agent_loop_mutation_claim_blocked:")));
    assert.equal(result.toolExecutionCount, 0, "an unsupported intent never triggers a capability call");
  } finally {
    await env.teardown();
  }
});

// Part 21 test 8 (integration angle): unknown intent asks for clarification, never invents a tool.
test("[MI-Loop-7] an unsupported intent never executes a tool and asks for clarification instead", async () => {
  const env = await setupBenchmarkEnvironment();
  try {
    const provider = createFakeAgentLoopProvider({
      script: [{ intents: [{ type: "unsupported", description: "reservar para otra persona" }] }, { type: "respond", message: "Por ahora no puedo dejarlo reservado para otra persona. Puedes contarme mas sobre lo que necesitas?" }]
    });

    const result = await runCommercialMultiIntentLoop(baseLoopInput({ opportunityId: env.opportunityId, customerMessage: "resérvamelo para mi hermano", provider }));

    assert.equal(result.terminalReason, "responded");
    assert.equal(result.toolExecutionCount, 0);
    assert.equal(result.finalMessage, "Por ahora no puedo dejarlo reservado para otra persona. Puedes contarme mas sobre lo que necesitas?");
  } finally {
    await env.teardown();
  }
});

// Part 21 test 9: malformed planner output (both attempts) fails closed - never executes a partially parsed plan.
test("[MI-Loop-8] a malformed planner response on both attempts fails closed to a real handoff, never guesses a plan", async () => {
  const env = await setupBenchmarkEnvironment();
  try {
    const provider = createFakeAgentLoopProvider({ script: [{ notIntents: "garbage" }, { alsoNotIntents: true }] });

    const result = await runCommercialMultiIntentLoop(baseLoopInput({ opportunityId: env.opportunityId, customerMessage: "quiero algo", provider }));

    assert.equal(result.terminalReason, "handoff");
    assert.equal(result.handoffReason, "multi_intent_planner_invalid_output");
    assert.equal(result.steps.length, 0);
    assert.equal(result.toolExecutionCount, 0);
  } finally {
    await env.teardown();
  }
});

// Part 21 test 15.
test("[MI-Loop-9] the multi-intent planner feature flag defaults to disabled", () => {
  assert.equal(buildMultiIntentPlannerFeatureFlags().multiIntentPlannerEnabled, false);
});

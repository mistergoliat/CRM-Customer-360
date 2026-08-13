import assert from "node:assert/strict";
import test from "node:test";
import { checkUnbackedCommercialMutationClaim } from "@/lib/brain/commercial/agent-loop/benchmark/unbackedCommercialMutationClaims";
import type { AgentLoopStepRecord } from "@/lib/brain/commercial/agent-loop/agentStepTypes";

function completedSelectProductsStep(): AgentLoopStepRecord {
  return {
    stepIndex: 0,
    phase: "gathering",
    governance: "authorized",
    step: { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "31", quantity: 2 }] } },
    observation: { tool: "select_products", status: "completed", data: { status: "selected", items: [{ productId: "31", quantity: 2 }], changed: true } }
  };
}

function blockedSelectProductsStep(): AgentLoopStepRecord {
  return {
    stepIndex: 0,
    phase: "gathering",
    governance: "authorized",
    step: { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "31", quantity: 2 }] } },
    observation: { tool: "select_products", status: "blocked", errorCode: "source_product_not_observed" }
  };
}

test("[UMC1] a message claiming completion (real T08B phrasing) with select_products completed this turn is claimed and backed, never unbacked", () => {
  const result = checkUnbackedCommercialMutationClaim({
    terminalReason: "responded",
    finalMessage: "Perfecto, quedaron seleccionadas 3 unidades de Barra Olimpica Classic 20kg.",
    steps: [completedSelectProductsStep()]
  });
  assert.equal(result.claimed, true);
  assert.equal(result.backed, true);
  assert.equal(result.unbacked, false);
});

test("[UMC2] the exact unbacked phrasing observed in T08B's C04 live data - claimed, not backed, unbacked", () => {
  const result = checkUnbackedCommercialMutationClaim({
    terminalReason: "responded",
    finalMessage: "Perfecto, te dejo 3 unidades de la Barra Olímpica Classic 20kg. ¿Quieres que te envíe el link?",
    steps: []
  });
  assert.equal(result.claimed, true);
  assert.equal(result.backed, false);
  assert.equal(result.unbacked, true);
});

test("[UMC3] the exact unbacked phrasing observed in T08B's C09 live data (implicit confirmation, no explicit verb) - claimed, not backed, unbacked", () => {
  const result = checkUnbackedCommercialMutationClaim({
    terminalReason: "responded",
    finalMessage: "Perfecto, 2 unidades de la Barra Olimpica Classic 20kg. Quedan 15 unidades disponibles. Para calcular el despacho...",
    steps: [{ stepIndex: 0, phase: "gathering", governance: "authorized", step: { type: "use_tool", tool: "get_product_details", arguments: { productId: "31" } }, observation: { tool: "get_product_details", status: "completed", data: {} } }]
  });
  assert.equal(result.claimed, true);
  assert.equal(result.backed, false);
  assert.equal(result.unbacked, true);
});

test("[UMC4] select_products blocked (never completed) this turn - a claim on top of that is still unbacked", () => {
  const result = checkUnbackedCommercialMutationClaim({
    terminalReason: "responded",
    finalMessage: "Listo, agregué 2 unidades a tu pedido.",
    steps: [blockedSelectProductsStep()]
  });
  assert.equal(result.claimed, true);
  assert.equal(result.backed, false);
  assert.equal(result.unbacked, true);
});

test("[UMC5] a clarifying question with no completion claim - never flagged", () => {
  const result = checkUnbackedCommercialMutationClaim({
    terminalReason: "responded",
    finalMessage: "¿Cuántas unidades de la Barra Olimpica Classic quieres?",
    steps: []
  });
  assert.equal(result.claimed, false);
  assert.equal(result.unbacked, false);
});

test("[UMC6] a turn that never produced a customer-facing message (timeout) is never flagged - it never claimed anything", () => {
  const result = checkUnbackedCommercialMutationClaim({ terminalReason: "timeout", finalMessage: null, steps: [] });
  assert.equal(result.claimed, false);
  assert.equal(result.unbacked, false);
});

test("[UMC7] a handoff turn is never flagged - no customer-facing claim was made", () => {
  const result = checkUnbackedCommercialMutationClaim({ terminalReason: "handoff", finalMessage: null, steps: [] });
  assert.equal(result.claimed, false);
  assert.equal(result.unbacked, false);
});

// --- Patterns widened after validating against T08B's real C02/C04/C09
// output (initial version missed these two real phrasings entirely,
// undercounting T08B's known 29/30 by 8 - see the release doc). ---

test("[UMC8] present-tense \"te agrego\"/\"te preparo\" (real T08B C02 phrasing) is claimed and unbacked, not just past-tense \"te dejo\"", () => {
  const result = checkUnbackedCommercialMutationClaim({
    terminalReason: "responded",
    finalMessage: "Perfecto, te agrego 2 unidades de la Barra Olimpica Classic 20kg. ¿Quieres que calcule el despacho?",
    steps: []
  });
  assert.equal(result.claimed, true);
  assert.equal(result.unbacked, true);
});

test("[UMC9] bare \"son N unidades\" restatement (real T08B C02 phrasing) is claimed and unbacked, not just the verb-less \"Perfecto, N unidades\" form", () => {
  const result = checkUnbackedCommercialMutationClaim({
    terminalReason: "responded",
    finalMessage: "Perfecto, son 2 unidades de la Barra Olimpica Classic 20kg. Quedan 15 unidades disponibles.",
    steps: []
  });
  assert.equal(result.claimed, true);
  assert.equal(result.unbacked, true);
});

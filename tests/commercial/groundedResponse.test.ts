import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroundedResponseInput,
  composeDeterministicResponse,
  generateGroundedResponse
} from "@/lib/brain/commercial/multi-request";
import type { GroundedResponseInput, GroundedResponseProvider } from "@/lib/brain/commercial/multi-request";
import type { AppliedRequestOperation } from "@/lib/brain/commercial/multi-request";
import type { ConversationRequest } from "@/lib/brain/commercial/conversation-request";

function makeRequest(overrides: Partial<ConversationRequest> = {}): ConversationRequest {
  return {
    contractName: "ConversationRequest",
    schemaVersion: "1.0.0",
    requestId: "req-quote",
    creationKey: "key-quote",
    conversationId: 1,
    opportunityId: null,
    intentType: "product_quote",
    intentDomain: "sales",
    status: "active",
    priority: "normal",
    parentRequestId: null,
    createdFromMessageId: "cm-1",
    resolution: null,
    createdAt: "2026-07-03T12:00:00.000Z",
    updatedAt: "2026-07-03T12:00:00.000Z",
    resolvedAt: null,
    ...overrides
  };
}

function makeApplied(overrides: Partial<AppliedRequestOperation> = {}): AppliedRequestOperation {
  const request = makeRequest();
  return {
    detectionId: "det-1",
    operation: "create",
    requestId: request.requestId,
    status: "applied",
    warning: null,
    request,
    ...overrides
  };
}

function makeInput(overrides: Partial<GroundedResponseInput> = {}): GroundedResponseInput {
  return {
    customerMessage: "Quiero cotizar una banca y saber dónde está mi pedido",
    requestResults: [
      { requestId: "req-quote", intentType: "product_quote", status: "active", summary: "Registré tu cotización y ya estoy trabajando en ella.", resolved: false },
      { requestId: "req-order", intentType: "order_status", status: "active", summary: "Sigo avanzando con el estado de tu pedido.", resolved: false }
    ],
    missingFacts: [],
    deferredActions: [],
    escalations: [],
    mandatoryStatements: [],
    forbiddenClaims: [],
    ...overrides
  };
}

test("buildGroundedResponseInput only carries verified operations, never failed or skipped ones", () => {
  const quote = makeRequest();
  const order = makeRequest({ requestId: "req-order", creationKey: "key-order", intentType: "order_status", intentDomain: "order" });

  const input = buildGroundedResponseInput({
    customerMessage: "hola",
    activeRequests: [quote, order],
    appliedOperations: [
      makeApplied(),
      makeApplied({ detectionId: "det-2", operation: "continue", requestId: order.requestId, request: order }),
      makeApplied({ detectionId: "det-3", operation: "create", requestId: null, status: "failed", warning: "boom", request: null }),
      makeApplied({ detectionId: "det-4", operation: "continue", requestId: "req-skip", status: "skipped", warning: "no id", request: null })
    ]
  });

  assert.equal(input.requestResults.length, 2);
  assert.equal(input.requestResults[0].summary?.includes("Registré"), true);
  assert.equal(input.requestResults[1].summary?.includes("Sigo avanzando"), true);
});

test("deterministic composer covers every request, pending questions, deferrals and escalations in one message", () => {
  const text = composeDeterministicResponse(
    makeInput({
      missingFacts: [{ requestId: "req-quote", factKey: "quantity", question: "¿cuántas unidades necesitas?" }],
      deferredActions: [{ requestId: "req-order", actionType: "find_order", reason: "budget" }],
      escalations: [{ requestId: "req-quote", category: "policy_approval", reason: "discount requested" }],
      mandatoryStatements: ["Nuestro horario de despacho es de lunes a viernes."]
    })
  );

  assert.ok(text.includes("cotización"));
  assert.ok(text.includes("pedido"));
  assert.ok(text.includes("¿cuántas unidades necesitas?"));
  assert.ok(text.includes("te aviso apenas tenga novedades"));
  assert.ok(text.includes("Derivé"));
  assert.ok(text.includes("Nuestro horario de despacho"));
});

test("deterministic composer degrades to a safe acknowledgement when the turn produced nothing", () => {
  const text = composeDeterministicResponse(makeInput({ requestResults: [] }));
  assert.equal(text, "Recibí tu mensaje y lo estoy revisando. Te respondo en breve.");
});

test("without a provider the generator uses the deterministic composer directly", async () => {
  const result = await generateGroundedResponse(makeInput());
  assert.equal(result.usedFallback, false);
  assert.equal(result.providerName, null);
  assert.ok(result.text.includes("cotización"));
});

test("a provider failure falls back to the template, never to a second model attempt", async () => {
  let calls = 0;
  const provider: GroundedResponseProvider = {
    name: "exploding",
    async generate() {
      calls += 1;
      throw new Error("model down");
    }
  };

  const result = await generateGroundedResponse(makeInput(), provider);
  assert.equal(calls, 1);
  assert.equal(result.usedFallback, true);
  assert.equal(result.providerName, "exploding");
  assert.equal(result.warnings[0]?.startsWith("grounded_response_provider_failed"), true);
  assert.ok(result.text.includes("cotización"));
});

test("provider output violating constraints is rejected: forbidden claims, empty text, missing mandatory statements", async () => {
  const forbidden = await generateGroundedResponse(makeInput({ forbiddenClaims: ["descuento del 50%"] }), {
    name: "liar",
    async generate() {
      return { text: "Te confirmo un descuento del 50% en tu compra." };
    }
  });
  assert.equal(forbidden.usedFallback, true);
  assert.equal(forbidden.warnings[0]?.includes("forbidden_claim"), true);

  const empty = await generateGroundedResponse(makeInput(), {
    name: "mute",
    async generate() {
      return { text: "   " };
    }
  });
  assert.equal(empty.usedFallback, true);
  assert.equal(empty.warnings[0]?.includes("empty_response"), true);

  const missingMandatory = await generateGroundedResponse(makeInput({ mandatoryStatements: ["retiro en tienda disponible"] }), {
    name: "forgetful",
    async generate() {
      return { text: "Tu cotización va en camino." };
    }
  });
  assert.equal(missingMandatory.usedFallback, true);
  assert.equal(missingMandatory.warnings[0]?.includes("missing_mandatory_statement"), true);
});

test("a compliant provider output is used verbatim", async () => {
  const result = await generateGroundedResponse(makeInput(), {
    name: "well-behaved",
    async generate() {
      return { text: "Perfecto, estoy preparando tu cotización y reviso tu pedido. Te escribo apenas tenga ambas respuestas." };
    }
  });
  assert.equal(result.usedFallback, false);
  assert.equal(result.providerName, "well-behaved");
  assert.equal(result.text.startsWith("Perfecto"), true);
});

test("the generator does not mutate its input", async () => {
  const input = makeInput();
  const before = JSON.stringify(input);
  await generateGroundedResponse(input, {
    name: "noop",
    async generate() {
      return { text: "Listo." };
    }
  });
  assert.equal(JSON.stringify(input), before);
});

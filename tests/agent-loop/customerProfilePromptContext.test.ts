import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentStepPromptPackage } from "@/lib/brain/commercial/agent-loop/buildAgentStepPromptPackage";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT } from "@/lib/brain/commercial/sales-agent-configuration";

const baseInput = {
  currentTime: "2026-08-05T12:00:00.000Z",
  customerMessage: "busco una kettlebell",
  availableTools: [],
  priorSteps: [],
  stepsRemaining: 3,
  identityConfiguration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT
};

test("customer purchase history rules are present in gathering and finalization", () => {
  for (const phase of ["gathering", "finalization"] as const) {
    const prompt = buildAgentStepPromptPackage({
      ...baseInput,
      phase,
      commercialContextSummary: {
        customerPurchaseHistory: {
          status: "AVAILABLE",
          reasonCodes: ["CUSTOMER_PROFILE_AVAILABLE"],
          summary: { validatedOrderCount: 4, historicalPurchaseValueTaxIncl: "120000.00", monetaryInterpretation: "INFORMATIONAL_ONLY" }
        }
      }
    });

    const system = prompt.messages[0].content;
    assert.match(system, /use it only as supporting evidence/);
    assert.match(system, /Do not infer RFM, customer segment, purchasing power, VIP status, or lifetime value/);
    assert.match(system, /Treat historicalPurchaseValueTaxIncl as informational only/);
    assert.match(system, /Do not automatically exclude previously purchased products/);
    assert.match(system, /Do not modify Catalog ranking solely from purchase history/);
    assert.match(system, /do not claim any historical purchase facts/);
  }
});

test("customer purchase history is serialized as compact user payload context only when present", () => {
  const withHistory = buildAgentStepPromptPackage({
    ...baseInput,
    commercialContextSummary: {
      customerPurchaseHistory: {
        status: "PARTIAL",
        reasonCodes: ["CUSTOMER_PROFILE_PARTIAL", "RFM_NOT_AVAILABLE"],
        summary: {
          validatedOrderCount: 4,
          firstPurchaseAt: "2026-01-01T00:00:00.000Z",
          lastPurchaseAt: "2026-07-20T00:00:00.000Z",
          historicalPurchaseValueTaxIncl: "120000.00",
          currencyIsoCode: "CLP",
          monetaryInterpretation: "INFORMATIONAL_ONLY"
        },
        purchasedProducts: [{ productId: 501, name: "Kettlebell 16kg", orderCount: 2 }]
      }
    }
  });
  const withPayload = JSON.parse(withHistory.messages[1].content) as { commercialContext: { customerPurchaseHistory?: Record<string, unknown> } };
  assert.equal(withPayload.commercialContext.customerPurchaseHistory?.status, "PARTIAL");
  assert.deepEqual(withPayload.commercialContext.customerPurchaseHistory?.reasonCodes, ["CUSTOMER_PROFILE_PARTIAL", "RFM_NOT_AVAILABLE"]);

  const withoutHistory = buildAgentStepPromptPackage({
    ...baseInput,
    commercialContextSummary: {}
  });
  const withoutPayload = JSON.parse(withoutHistory.messages[1].content) as { commercialContext: Record<string, unknown> };
  assert.equal("customerPurchaseHistory" in withoutPayload.commercialContext, false);
});

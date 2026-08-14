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
        },
        customerRfm: {
          status: "AVAILABLE",
          snapshot: { referenceTime: "2026-08-03T00:00:00.000Z", publishedAt: "2026-08-03T01:00:00.000Z", calculationVersion: "rfm-population-v1" },
          rfm: { recencyDays: 2, frequencyOrders: 3, grossOrderValueTaxIncl: "123456.780000", averageOrderValueTaxIncl: "41152.260000", recencyScore: 5, frequencyScore: 3, monetaryScore: 4, rfmCode: "R5F3M4" },
          segment: { code: "LOYAL", version: "rfm-commercial-v1" }
        }
      }
    });

    const system = prompt.messages[0].content;
    assert.match(system, /use it only as supporting evidence/);
    assert.match(system, /Do not infer RFM, customer segment, purchasing power, VIP status, or lifetime value/);
    assert.match(system, /Never use segment code alone as the complete summary of the customer/);
    assert.match(system, /Never generate discounts, campaigns, promotions, follow-up rules/);
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
      },
      customerRfm: {
        status: "AVAILABLE",
        contractVersion: "customer-rfm-runtime-v1",
        snapshot: {
          referenceTime: "2026-08-03T00:00:00.000Z",
          publishedAt: "2026-08-03T01:00:00.000Z",
          calculationVersion: "rfm-population-v1"
        },
        rfm: {
          recencyDays: 35,
          frequencyOrders: 1,
          grossOrderValueTaxIncl: "123456.780000",
          averageOrderValueTaxIncl: "123456.780000",
          recencyScore: 4,
          frequencyScore: 1,
          monetaryScore: 4,
          rfmCode: "R4F1M4"
        },
        segment: {
          code: "RECENT_HIGH_VALUE",
          version: "rfm-commercial-v1"
        }
      }
    }
  });
  const withPayload = JSON.parse(withHistory.messages[1].content) as { commercialContext: { customerPurchaseHistory?: Record<string, unknown>; customerRfm?: Record<string, unknown> } };
  assert.equal(withPayload.commercialContext.customerPurchaseHistory?.status, "PARTIAL");
  assert.deepEqual(withPayload.commercialContext.customerPurchaseHistory?.reasonCodes, ["CUSTOMER_PROFILE_PARTIAL", "RFM_NOT_AVAILABLE"]);
  assert.equal(withPayload.commercialContext.customerRfm?.status, "AVAILABLE");
  assert.deepEqual(withPayload.commercialContext.customerRfm?.segment, { code: "RECENT_HIGH_VALUE", version: "rfm-commercial-v1" });

  const withoutHistory = buildAgentStepPromptPackage({
    ...baseInput,
    commercialContextSummary: {}
  });
  const withoutPayload = JSON.parse(withoutHistory.messages[1].content) as { commercialContext: Record<string, unknown> };
  assert.equal("customerPurchaseHistory" in withoutPayload.commercialContext, false);
  assert.equal("customerRfm" in withoutPayload.commercialContext, false);
});

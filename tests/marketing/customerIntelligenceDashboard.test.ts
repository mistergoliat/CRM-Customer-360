import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerIntelligenceDashboardWorkspace } from "@/components/marketing/CustomerIntelligenceDashboardWorkspace";
import { buildCopilotMessagePayload } from "@/components/marketing/MarketingCopilotWorkspace";
import {
  EMPTY_CUSTOMER_INTELLIGENCE_FILTER_SELECTION,
  buildCustomerIntelligenceCopilotUiContext,
  buildCustomerIntelligenceFilterTree
} from "@/lib/marketing/customerIntelligenceDashboard";

test("customer intelligence dashboard builds one canonical T03 filter tree", () => {
  const filters = buildCustomerIntelligenceFilterTree({
    ...EMPTY_CUSTOMER_INTELLIGENCE_FILTER_SELECTION,
    rfmSegmentCode: "CHAMPION",
    clusterId: 3,
    commercial: {
      ...EMPTY_CUSTOMER_INTELLIGENCE_FILTER_SELECTION.commercial,
      daysSinceLastOrderGte: "30",
      totalSpentLte: "500000",
      averageOrderValueGte: "25000",
      validOrdersLte: "8"
    }
  });

  assert.deepEqual(filters, {
    and: [
      { field: "rfm.segmentCode", operator: "eq", value: "CHAMPION" },
      { field: "cluster.clusterId", operator: "eq", value: 3 },
      { field: "commercial.daysSinceLastOrder", operator: "gte", value: 30 },
      { field: "commercial.totalSpentTaxIncl", operator: "lte", value: 500000 },
      { field: "commercial.averageOrderValueTaxIncl", operator: "gte", value: 25000 },
      { field: "commercial.validOrders", operator: "lte", value: 8 }
    ]
  });
});

test("customer intelligence dashboard omits uiContext until filters exist", () => {
  const filters = buildCustomerIntelligenceFilterTree(EMPTY_CUSTOMER_INTELLIGENCE_FILTER_SELECTION);

  assert.equal(filters, null);
  assert.equal(buildCustomerIntelligenceCopilotUiContext(filters), undefined);
  assert.deepEqual(buildCopilotMessagePayload("Cuantos clientes hay?", filters), { question: "Cuantos clientes hay?" });
});

test("customer intelligence copilot payload contains only contract version and canonical filters", () => {
  const filters = { and: [{ field: "rfm.segmentCode", operator: "eq", value: "CHAMPION" }] } as const;
  const payload = buildCopilotMessagePayload("Que ves?", filters);

  assert.deepEqual(payload, {
    question: "Que ves?",
    uiContext: {
      intersection: {
        contractVersion: "customer-intelligence-copilot-ui-context-v1",
        filters
      }
    }
  });
  assert.equal(JSON.stringify(payload).includes("matchingPopulation"), false);
  assert.equal(JSON.stringify(payload).includes("businessLabel"), false);
});

test("customer intelligence dashboard initial render exposes the usable workspace sections", () => {
  const html = renderToStaticMarkup(React.createElement(CustomerIntelligenceDashboardWorkspace, { copilotData: { quickReplies: [] } }));

  assert.match(html, /Overview/);
  assert.match(html, /RFM/);
  assert.match(html, /Clusters/);
  assert.match(html, /Selected population/);
  assert.match(html, /Workspace conversacional/);
  assert.doesNotMatch(html, /Audience/);
});

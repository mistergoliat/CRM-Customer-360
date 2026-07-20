import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "../../lib/db";
import { processInbound } from "../../lib/brain/processInbound";
import { processSalesInbound } from "../../lib/brain/native-whatsapp";
import { makeBrainActionResolveResponse, makeBrainContextResolveResponse, makeInboundRequest } from "./fixtures";
import type { SalesConsultativeServiceResult } from "../../lib/brain/commercial/sales-consultative/service";

// ACS-R1-05.1-T01: single commercial runtime authority. WhatsApp real traffic
// (processNativeWhatsAppInbound -> runNativeAutonomousCycle -> operational-loop
// -> persistCommercialState) is already covered by
// tests/native/native-whatsapp.test.ts's "native inbound path does not invoke
// consultative engine or outbox writers" regression. This file covers the two
// remaining call sites of the legacy sales-consultative engine
// (lib/brain/commercial/sales-consultative), both gated fail-closed by
// BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED (default false):
//   1. processInbound.ts's /api/brain/process-inbound endpoint (n8n's live
//      integration route, docs/n8n-brain-integration.md line 44).
//   2. native-whatsapp/service.ts's processSalesInbound (zero production
//      callers today, guarded so a future accidental wire-up fails closed).

function makeFakeSalesConsultativeHook(result: SalesConsultativeServiceResult) {
  return async () => result;
}

const FAKE_SALES_CONSULTATIVE_RESULT: SalesConsultativeServiceResult = {
  result: {
    stage: "recommendation",
    nextBestAction: "send_recommendation",
    responseText: "fixture response",
    opportunityStatus: "open",
    opportunityStage: "recommendation",
    recommendation: { missingInformation: [], candidates: [], notes: [] },
    action: null,
    followUp: null,
    warnings: [],
    objections: [],
    persistence: { outboundQueued: false, outboxId: null }
  } as unknown as SalesConsultativeServiceResult["result"],
  dispatchResult: null,
  dispatchWarnings: []
};

test("legacy sales consultative flow is disabled by default in processInbound", async () => {
  const previous = process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;
  delete process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;

  let hookCalls = 0;
  try {
    const result = await processInbound(makeInboundRequest(), Date.parse("2026-06-17T12:00:00.000Z"), {
      resolveBackendBrainContext: async () => makeBrainContextResolveResponse(),
      resolveBrainAction: async () => makeBrainActionResolveResponse(),
      legacySalesConsultative: {
        legacySalesConsultativeHook: async () => {
          hookCalls += 1;
          throw new Error("legacy sales consultative hook must not be called by default");
        }
      }
    });

    assert.equal(hookCalls, 0);
    assert.equal(result.ok, true);
    assert.equal(result.adapters.salesConsultative, null);
    assert.ok(result.warnings.includes("legacy_sales_consultative_disabled"));
  } finally {
    if (typeof previous === "undefined") delete process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;
    else process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED = previous;
  }
});

test("legacy sales consultative flow requires an explicit true flag, not just an env typo", async () => {
  const previous = process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;
  process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED = "yes"; // not the literal "true"

  let hookCalls = 0;
  try {
    const result = await processInbound(makeInboundRequest(), Date.parse("2026-06-17T12:00:00.000Z"), {
      resolveBackendBrainContext: async () => makeBrainContextResolveResponse(),
      resolveBrainAction: async () => makeBrainActionResolveResponse(),
      legacySalesConsultative: {
        legacySalesConsultativeHook: async () => {
          hookCalls += 1;
          throw new Error("legacy sales consultative hook must not be called for a non-'true' flag value");
        }
      }
    });

    assert.equal(hookCalls, 0);
    assert.ok(result.warnings.includes("legacy_sales_consultative_disabled"));
  } finally {
    if (typeof previous === "undefined") delete process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;
    else process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED = previous;
  }
});

test("legacy sales consultative flow runs only when explicitly enabled", async () => {
  let hookCalls = 0;
  const result = await processInbound(makeInboundRequest(), Date.parse("2026-06-17T12:00:00.000Z"), {
    resolveBackendBrainContext: async () => makeBrainContextResolveResponse(),
    resolveBrainAction: async () => makeBrainActionResolveResponse(),
    legacySalesConsultative: {
      legacySalesConsultativeFlags: { legacySalesConsultativeEnabled: true },
      legacySalesConsultativeHook: async () => {
        hookCalls += 1;
        return FAKE_SALES_CONSULTATIVE_RESULT;
      }
    }
  });

  assert.equal(hookCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.adapters.salesConsultative, FAKE_SALES_CONSULTATIVE_RESULT.result);
  assert.ok(!result.warnings.includes("legacy_sales_consultative_disabled"));
});

test("processSalesInbound fails closed by default without touching the database", async () => {
  const previous = process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;
  delete process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;

  try {
    await assert.rejects(
      () => processSalesInbound({ conversationId: 999999999, messageId: 999999999, correlationId: "corr-legacy-gate" }),
      /legacy_sales_consultative_disabled/
    );
  } finally {
    if (typeof previous === "undefined") delete process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;
    else process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED = previous;
  }
});

after(async () => {
  await getPool().end();
});

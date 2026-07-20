import assert from "node:assert/strict";
import test from "node:test";
import { processInbound } from "../../lib/brain/processInbound";
import { processSalesInbound } from "../../lib/brain/native-whatsapp";
import { makeBrainActionResolveResponse, makeBrainContextResolveResponse, makeInboundRequest } from "./fixtures";
import type { SalesConsultativeServiceResult } from "../../lib/brain/commercial/sales-consultative/service";
import { LegacySalesConsultativeDisabledError } from "../../lib/brain/commercial/config/commercialCycleConfig";

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

test("legacy sales consultative flow is disabled by default in processInbound, and the rest of the contract is unaffected", async () => {
  const previous = process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;
  delete process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;

  let hookCalls = 0;
  try {
    // A rejected promise here would fail this test with an unhandled
    // rejection - there is no try/catch around the gate itself. This is the
    // "no 500 solely from the gate" proof at the function-contract level:
    // the route (app/api/brain/process-inbound/route.ts) always responds
    // Response.json(await processInbound(...)) with a 200, so a thrown
    // exception here is the only way the gate could cause a 500, and it does
    // not happen.
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

    // No legacy commercial writer ran.
    assert.equal(hookCalls, 0);
    assert.equal(result.adapters.salesConsultative, null);
    assert.ok(result.warnings.includes("legacy_sales_consultative_disabled"));

    // The existing contract (non-commercial processing) is untouched by the
    // gate: context resolution, action policy and instructions still run and
    // populate the response exactly as they would without this task's change.
    assert.equal(result.ok, true);
    assert.ok(result.context_summary);
    assert.equal(result.requestId, result.context_summary.requestId);
    assert.equal(result.context_summary.primaryService, "sales");
    assert.ok(result.action_policy);
    assert.ok(result.instructions);
    assert.deepEqual(result.errors, []);
    assert.equal(result.metadata.version, "brain.process-inbound.v2");
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
  // Exceptional-enable compatibility: the rest of the contract still holds.
  assert.ok(result.action_policy);
  assert.ok(result.instructions);
});

test("processSalesInbound fails closed by default with a named domain error, before any database access", async () => {
  const previous = process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;
  delete process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;

  try {
    // conversationId/messageId below do not correspond to any real row. If
    // the guard performed any database lookup before throwing, this would
    // either hang/fail on a real DB or surface a completely different error
    // (e.g. "conversation_not_found" from loadConversationById, or a
    // connection error) - not LegacySalesConsultativeDisabledError. Getting
    // exactly this error, synchronously on the first line, is the proof the
    // guard runs before any DB access.
    await assert.rejects(
      () => processSalesInbound({ conversationId: 999999999, messageId: 999999999, correlationId: "corr-legacy-gate" }),
      (error: unknown) => {
        assert.ok(error instanceof LegacySalesConsultativeDisabledError, `expected LegacySalesConsultativeDisabledError, got ${String(error)}`);
        assert.equal(error.message, "legacy_sales_consultative_disabled");
        assert.equal(error.name, "LegacySalesConsultativeDisabledError");
        return true;
      }
    );
  } finally {
    if (typeof previous === "undefined") delete process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;
    else process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED = previous;
  }
});

test("processSalesInbound stays fail-closed for non-'true' flag values too", async () => {
  const previous = process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;
  process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED = "1";

  try {
    await assert.rejects(
      () => processSalesInbound({ conversationId: 999999999, messageId: 999999999, correlationId: "corr-legacy-gate-invalid" }),
      (error: unknown) => error instanceof LegacySalesConsultativeDisabledError
    );
  } finally {
    if (typeof previous === "undefined") delete process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;
    else process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED = previous;
  }
});

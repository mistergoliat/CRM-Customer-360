import assert from "node:assert/strict";
import test from "node:test";
import {
  runNativeAgentToolLoopCycle,
  runNativeAgentToolLoopCycleConfigurationFailure
} from "@/lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import type { CommercialContextSnapshot } from "@/lib/brain/commercial/context/buildNativeCommercialContext";
import {
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
  type ResolvedSalesAgentConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration";

/**
 * ACS-R1-05.1-T02.3B (fix). A real Sales Agent Configuration resolution
 * failure must never invoke the model, must dispatch a real, neutral
 * handoff to the customer, and must keep the actual technical cause
 * internal only. BRAIN_AGENT_ACTION_QUEUE_ENABLED=true (persistence stays
 * disabled/default) is enough to observe the real dispatched message
 * without any database: persistAgentAction resolves to "dry_run" (no DB
 * touched) while dispatchAgentLoopResponse still computes and returns the
 * message text before ever attempting to persist it.
 */
Object.assign(process.env, {
  BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true"
});

function buildSnapshot(signalOverrides: Partial<CommercialContextSnapshot["signals"]> = {}): CommercialContextSnapshot {
  return {
    contractName: "CommercialContext",
    schemaVersion: "1.0",
    status: "success",
    completeness: "minimal",
    customer: null,
    conversation: null,
    recentMessages: [],
    opportunity: null,
    needProfile: null,
    actions: [],
    signals: {
      hasCustomer: false,
      hasOpportunity: false,
      hasNeedProfile: false,
      hasRecentMessages: false,
      humanOwnerActive: false,
      aiBlocked: false,
      staleContext: false,
      identityConflict: false,
      ...signalOverrides
    },
    identityConflict: null,
    availableCapabilities: [],
    warnings: [],
    customer360: null,
    customer360State: "not_requested",
    customerSession: null,
    metadata: {
      source: "native_mariadb",
      conversationPublicId: "test-conv",
      currentTime: "2026-07-22T15:00:00.000Z"
    }
  };
}

function buildResolvedConfig(overrides: Partial<ResolvedSalesAgentConfiguration> = {}): ResolvedSalesAgentConfiguration {
  return {
    source: "safe_default",
    scopeKey: SALES_AGENT_CONFIGURATION_SCOPE,
    recordId: null,
    version: null,
    configurationHash: null,
    configuration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
    effectiveModelConfiguration: SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
    effectiveLoopConfiguration: SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
    ...overrides
  };
}

const baseInput = {
  conversationId: 1,
  waId: "56900000000",
  inboundMessageId: "msg-1",
  correlationId: "corr-1",
  currentTime: "2026-07-22T15:00:00.000Z"
};

const FAKE_DB_ERROR_REASON = "sales_agent_configuration_resolution_failed:ECONNREFUSED 127.0.0.1:3306";

test("[CF0] absence of a publication is not an error - the resolver's own default still runs the model normally", async () => {
  const provider = createFakeAgentLoopProvider({ script: [{ type: "respond", message: "hola, en que te puedo ayudar" }] });
  const result = await runNativeAgentToolLoopCycle({
    ...baseInput,
    customerMessage: "hola",
    abortSignal: null,
    snapshot: buildSnapshot(),
    provider,
    // source: "safe_default" - exactly what the resolver returns when
    // nothing is published, never a thrown error.
    resolvedSalesAgentConfiguration: buildResolvedConfig({ source: "safe_default" })
  });
  assert.equal(result.loop.ran, true);
  assert.equal(result.loop.terminalReason, "responded");
  assert.equal(result.loop.finalMessage, "hola, en que te puedo ayudar");
});

test("[CF1] a configuration resolution failure never invokes the model - zero decisions, zero tool calls", async () => {
  const result = await runNativeAgentToolLoopCycleConfigurationFailure({
    ...baseInput,
    snapshot: buildSnapshot(),
    technicalReason: FAKE_DB_ERROR_REASON
  });
  assert.equal(result.loop.steps.length, 0);
  assert.equal(result.loop.toolExecutionCount, 0);
});

test("[CF2] a configuration resolution failure produces a real, dispatched handoff", async () => {
  const result = await runNativeAgentToolLoopCycleConfigurationFailure({
    ...baseInput,
    snapshot: buildSnapshot(),
    technicalReason: FAKE_DB_ERROR_REASON
  });
  assert.equal(result.loop.ran, true);
  assert.equal(result.loop.terminalReason, "handoff");
  // dispatch.attempted reflects a real (non-dry-run) persistence attempt,
  // which needs a real DB (BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED, off by
  // default and intentionally left off here) - what this test proves
  // without a database is that a real message was actually computed and
  // handed to the dispatch pipeline, not skipped.
  assert.ok(result.dispatch.messageSent, "a real handoff message must have been computed for dispatch");
});

test("[CF3] the customer receives a neutral message - no table names, SQL errors, timeouts, or stack traces", async () => {
  const result = await runNativeAgentToolLoopCycleConfigurationFailure({
    ...baseInput,
    snapshot: buildSnapshot(),
    technicalReason: FAKE_DB_ERROR_REASON
  });
  const message = result.dispatch.messageSent;
  assert.ok(message, "a message must have been computed for the customer");
  // Same generic acknowledgement every other terminal handoff already uses
  // - never a bespoke "something went wrong" or technical string.
  assert.match(message!, /conectar tu conversaci[oó]n con alguien del equipo/i);
  const lower = message!.toLowerCase();
  for (const forbidden of ["sql", "econnrefused", "timeout", "stack", "table", "sales_agent_configuration", "3306", "error:"]) {
    assert.ok(!lower.includes(forbidden), `message must not leak "${forbidden}": ${message}`);
  }
});

test("[CF4] the real technical cause is recorded internally (loop.warnings), never in the customer message", async () => {
  const result = await runNativeAgentToolLoopCycleConfigurationFailure({
    ...baseInput,
    snapshot: buildSnapshot(),
    technicalReason: FAKE_DB_ERROR_REASON
  });
  assert.ok(result.loop.warnings.includes(FAKE_DB_ERROR_REASON), "the technical cause must be preserved internally");
  assert.ok(!result.dispatch.messageSent?.includes("ECONNREFUSED"));
});

test("[CF5] a human-owned or AI-blocked conversation still gets zero AI-authored dispatch, even on a configuration failure (A4 invariant)", async () => {
  const humanOwned = await runNativeAgentToolLoopCycleConfigurationFailure({
    ...baseInput,
    snapshot: buildSnapshot({ humanOwnerActive: true }),
    technicalReason: FAKE_DB_ERROR_REASON
  });
  assert.equal(humanOwned.loop.ran, false);
  assert.equal(humanOwned.dispatch.attempted, false);

  const aiBlocked = await runNativeAgentToolLoopCycleConfigurationFailure({
    ...baseInput,
    snapshot: buildSnapshot({ aiBlocked: true }),
    technicalReason: FAKE_DB_ERROR_REASON
  });
  assert.equal(aiBlocked.loop.ran, false);
  assert.equal(aiBlocked.dispatch.attempted, false);
});

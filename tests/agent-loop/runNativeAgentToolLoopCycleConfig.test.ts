import assert from "node:assert/strict";
import test from "node:test";
import { runNativeAgentToolLoopCycle } from "@/lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import type { AgentLoopProvider, AgentLoopProviderRequest } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import type { CommercialContextSnapshot } from "@/lib/brain/commercial/context/buildNativeCommercialContext";
import {
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
  type ResolvedSalesAgentConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration";

/**
 * ACS-R1-05.1-T02.3B wiring tests: prove runNativeAgentToolLoopCycle
 * actually forwards resolvedSalesAgentConfiguration into the real loop
 * (never a routing decision made by this test itself) - no DB and no
 * registered Capability Gateway tool needed, since these specifically
 * target the loop's own decision/tool BUDGET wiring (structural: how many
 * gathering steps happen, not whether an individual tool call succeeds -
 * that mechanism is already covered by tests/agent-loop/runAgentToolLoop.test.ts).
 */

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
  currentTime: "2026-07-22T15:00:00.000Z",
  customerMessage: "hola, busco una jaula",
  abortSignal: null
};

test("[W1] effectiveLoopConfiguration.maxToolCallsPerTurn=0 controls the real loop - gathering never starts", async () => {
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "jaula" } },
      { type: "respond", message: "no puedo buscar ahora" }
    ]
  });
  const result = await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot: buildSnapshot(),
    provider,
    resolvedSalesAgentConfiguration: buildResolvedConfig({
      effectiveLoopConfiguration: { maxAgentStepsPerTurn: 3, maxToolCallsPerTurn: 0 }
    })
  });
  const gatheringSteps = result.loop.steps.filter((step) => step.phase === "gathering");
  assert.equal(gatheringSteps.length, 0, "a zero tool-call budget must skip gathering entirely, straight to finalization");
  assert.equal(result.loop.toolExecutionCount, 0);
  assert.ok(result.loop.warnings.includes("agent_loop_finalization_entered"));
});

test("[W2] effectiveLoopConfiguration.maxAgentStepsPerTurn=1 controls the real loop - exactly one gathering decision", async () => {
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "jaula" } },
      { type: "respond", message: "resultado final" }
    ]
  });
  const result = await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot: buildSnapshot(),
    provider,
    resolvedSalesAgentConfiguration: buildResolvedConfig({
      effectiveLoopConfiguration: { maxAgentStepsPerTurn: 1, maxToolCallsPerTurn: 2 }
    })
  });
  const gatheringSteps = result.loop.steps.filter((step) => step.phase === "gathering");
  assert.equal(gatheringSteps.length, 1, "the decision budget must cap gathering at exactly 1 step");
  assert.equal(result.loop.terminalReason, "responded");
});

test("[W3] a human-owned/AI-blocked conversation never reaches the model, regardless of configuration", async () => {
  const provider = createFakeAgentLoopProvider({ script: [{ type: "respond", message: "should never be called" }] });
  const result = await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot: buildSnapshot({ humanOwnerActive: true }),
    provider,
    resolvedSalesAgentConfiguration: buildResolvedConfig()
  });
  assert.equal(result.loop.ran, false);
});

test("[W4] identityConfiguration reaches the real system prompt sent to the provider", async () => {
  const capturedRequests: AgentLoopProviderRequest[] = [];
  const capturingProvider: AgentLoopProvider = {
    name: "capturing-test-provider",
    async invoke(request) {
      capturedRequests.push(request);
      return { rawOutput: { type: "respond", message: "hola" } };
    }
  };

  await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot: buildSnapshot(),
    provider: capturingProvider,
    resolvedSalesAgentConfiguration: buildResolvedConfig({
      configuration: {
        agentName: "Camila",
        companyName: "Tienda de Prueba",
        role: "Vendedora",
        companyDescription: "Vendemos articulos de prueba.",
        customInstructions: "",
        prohibitedPhrases: []
      }
    })
  });

  assert.ok(capturedRequests.length > 0, "the provider must have been invoked at least once");
  const systemMessage = capturedRequests[0].messages.find((message) => message.role === "system");
  assert.ok(systemMessage?.content.includes("Camila"));
  assert.ok(systemMessage?.content.includes("Tienda de Prueba"));
});

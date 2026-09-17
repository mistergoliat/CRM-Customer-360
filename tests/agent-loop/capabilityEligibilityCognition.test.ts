import assert from "node:assert/strict";
import test from "node:test";
import { runAgentToolLoop } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { buildToolDescriptions } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import type { AgentLoopProvider, AgentLoopProviderRequest } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT } from "@/lib/brain/commercial/sales-agent-configuration";

function providerCapturing(requests: AgentLoopProviderRequest[]): AgentLoopProvider {
  return {
    name: "p6.3-capture",
    version: "1",
    async invoke(request) {
      requests.push(request);
      return { rawOutput: { type: "respond", message: "Entendido." }, model: "test", inputTokens: null, outputTokens: null, providerRequestId: null, finishReason: "stop" };
    }
  };
}

async function run(capabilityEligibility?: { schemaVersion: "1"; metadataVersion: string; eligible: readonly string[]; blocked: readonly { capability: string; reasonCodes: readonly "MISSING_QUOTE"[] }[] } | null) {
  const requests: AgentLoopProviderRequest[] = [];
  const result = await runAgentToolLoop({
    correlationId: "corr-p6.3",
    conversationId: null,
    opportunityId: null,
    currentTime: "2026-09-17T00:00:00.000Z",
    customerMessage: "gracias",
    commercialContextSummary: {},
    provider: providerCapturing(requests),
    identityConfiguration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
    maxDecisions: 1,
    maxToolExecutions: 1,
    ...(capabilityEligibility !== undefined ? { capabilityEligibility } : {})
  });
  return { result, requests };
}

test("[P6.3-C] flag-off loop request remains compatible; flag-on provider sees the compact view with one provider call", async () => {
  const off = await run();
  const on = await run({ schemaVersion: "1", metadataVersion: "p6.2-b.1", eligible: ["create_quote"], blocked: [{ capability: "get_quote", reasonCodes: ["MISSING_QUOTE"] }] });
  const offPayload = JSON.parse(off.requests[0].messages.at(-1)!.content) as Record<string, unknown>;
  const onPayload = JSON.parse(on.requests[0].messages.at(-1)!.content) as Record<string, unknown>;

  assert.equal(off.result.providerCallCount, 1);
  assert.equal(on.result.providerCallCount, 1);
  assert.equal("capabilityEligibility" in offPayload, false);
  assert.deepEqual(onPayload.capabilityEligibility, { schemaVersion: "1", metadataVersion: "p6.2-b.1", eligible: ["create_quote"], blocked: [{ capability: "get_quote", reasonCodes: ["MISSING_QUOTE"] }] });
  for (const tool of buildToolDescriptions()) {
    assert.match(off.requests[0].messages[0].content, new RegExp(`\\b${tool.name}\\b`));
    assert.match(on.requests[0].messages[0].content, new RegExp(`\\b${tool.name}\\b`));
  }
});

test("[P6.3-D] an unavailable snapshot reaches the provider as null, never as fabricated eligibility", async () => {
  const { result, requests } = await run(null);
  const payload = JSON.parse(requests[0].messages.at(-1)!.content) as Record<string, unknown>;
  assert.equal(result.providerCallCount, 1);
  assert.equal(payload.capabilityEligibility, null);
  assert.match(requests[0].messages[0].content, /Eligibility information is unavailable/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildAgentStepPromptPackage, renderToolLine, type AgentLoopPromptInput } from "@/lib/brain/commercial/agent-loop/buildAgentStepPromptPackage";
import { buildToolDescriptions, runAgentToolLoop } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import type { AgentLoopProvider, AgentLoopProviderRequest, AgentLoopProviderResponse } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import { AUTONOMOUS_PROMPT_VERSION, buildAutonomousStepPromptPackage, buildAutonomousSystemInstructions } from "@/lib/brain/commercial/agent-loop/benchmark/r3AutonomousAB/autonomousPrompt";
import { computePromptStats } from "@/lib/brain/commercial/agent-loop/benchmark/r3AutonomousAB/analysis";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT } from "@/lib/brain/commercial/sales-agent-configuration";
import type { EnsureCommercialActionOpportunityResult } from "@/lib/brain/commercial/commercial-action-request/ensureCommercialActionOpportunity";

/**
 * SALES-AGENT-R3-P7.8. Pure/in-memory tests for variant B's prompt layer and
 * the promptBuilder seam. No DB, no network.
 */

const VIEW = { schemaVersion: "1", metadataVersion: "test", eligible: ["search_products"], blocked: [{ capability: "select_products", reasonCodes: ["OBJECTIVE_REQUIRED"] }] } as const;

function promptInput(overrides: Partial<AgentLoopPromptInput> = {}): AgentLoopPromptInput {
  return {
    currentTime: "2026-09-21T15:00:00.000Z",
    customerMessage: "quiero la barra olimpica classic",
    commercialContextSummary: {},
    capabilityEligibility: VIEW,
    availableTools: buildToolDescriptions(),
    priorSteps: [],
    stepsRemaining: 3,
    phase: "gathering",
    identityConfiguration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
    harnessAlignedMessageModelEnabled: true,
    commercialProposalShadowEnabled: true,
    ...overrides
  };
}

const systemOf = (messages: { role: string; content: string }[]) => messages.find((message) => message.role === "system")!.content;

test("P7.8-D: A and B expose the same tools with byte-identical tool lines (same schemas, useWhen/doNotUseWhen, semantics)", () => {
  const input = promptInput();
  const a = systemOf(buildAgentStepPromptPackage(input).messages);
  const b = systemOf(buildAutonomousStepPromptPackage(input).messages);
  assert.ok(input.availableTools.length >= 5);
  for (const tool of input.availableTools) {
    const line = renderToolLine(tool);
    assert.ok(a.includes(line), `A must render ${tool.name}`);
    assert.ok(b.includes(line), `B must render ${tool.name} identically`);
  }
});

test("P7.8-G: B never renders capability eligibility even when a view is passed; A does with the same input", () => {
  const input = promptInput();
  const aText = JSON.stringify(buildAgentStepPromptPackage(input).messages);
  const bText = JSON.stringify(buildAutonomousStepPromptPackage(input).messages);
  assert.ok(aText.includes("capabilityEligibility"), "control: A renders the P6.3 view");
  assert.equal(bText.includes("capabilityEligibility"), false);
  assert.equal(bText.includes("OBJECTIVE_REQUIRED"), false);
});

test("P7.8: B carries the general autonomy policy and none of the hybrid steering / P4 contract", () => {
  const system = systemOf(buildAutonomousStepPromptPackage(promptInput()).messages);
  assert.ok(system.includes("continue using the available tools until the requested outcome is completed, genuinely blocked, or requires information that only the customer can provide"));
  assert.ok(system.includes("Do not stop at informational grounding when an executable requested action remains pending"));
  // Hybrid-only steering (P7.7 closing rule, select_products rules, P4 contract, capability selection policy, eligibility advisory):
  for (const forbidden of ["¿Quieres que te envíe el link para revisarlo?", "commercialProposal", "Capability eligibility is advisory", "Choose capabilities according to the unresolved problem", "Explicit purchase or selection intent", "Actively move a qualified commercial conversation"]) {
    assert.equal(system.includes(forbidden), false, `B must not contain: ${forbidden}`);
  }
  // B prescribes no rigid workflow sequence:
  assert.equal(/search_products\s*(->|→)\s*get_product_details/.test(system), false);
});

test("P7.8: B finalization phase offers no tools and only respond/handoff", () => {
  const system = buildAutonomousSystemInstructions({ phase: "finalization", availableTools: [], identityConfiguration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT, priorAttemptFailure: null });
  assert.ok(system.includes("type must be one of: respond, handoff."));
  assert.equal(system.includes("Available tools:"), false);
  assert.equal(system.includes('"type":"use_tool"'), false);
});

test("P7.8: B repair lines exist only for a prior failure (same one-shot discipline as A)", () => {
  const withFailure = buildAutonomousSystemInstructions({ phase: "gathering", availableTools: [], identityConfiguration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT, priorAttemptFailure: { kind: "invalid_agent_step", reasonCode: "missing_required_field" } });
  const without = buildAutonomousSystemInstructions({ phase: "gathering", availableTools: [], identityConfiguration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT, priorAttemptFailure: null });
  assert.ok(withFailure.includes("missing_required_field"));
  assert.equal(without.includes("rejected"), false);
});

test("P7.8: prompt size - B is measurably smaller than A and stats split policy vs tool catalog", () => {
  const input = promptInput();
  const a = computePromptStats(systemOf(buildAgentStepPromptPackage(input).messages), 1);
  const b = computePromptStats(systemOf(buildAutonomousStepPromptPackage(input).messages), 1);
  assert.ok(b.systemPromptChars < a.systemPromptChars);
  assert.ok(b.policyLineCount < a.policyLineCount);
  assert.ok(a.toolCatalogChars > 0 && b.toolCatalogChars > 0);
  // The tool catalog is shared verbatim: exactly the same size in A and B (only the policy volume differs).
  assert.equal(a.toolCatalogChars, b.toolCatalogChars);
  assert.equal(AUTONOMOUS_PROMPT_VERSION, "p7.8-autonomous-v1");
});

// ---------------------------------------------------------------------------
// The promptBuilder seam in the real loop
// ---------------------------------------------------------------------------

function capturingProvider(steps: unknown[]): { provider: AgentLoopProvider; requests: AgentLoopProviderRequest[] } {
  const requests: AgentLoopProviderRequest[] = [];
  let index = 0;
  return {
    requests,
    provider: {
      name: "capture",
      version: "test",
      async invoke(request: AgentLoopProviderRequest): Promise<AgentLoopProviderResponse> {
        requests.push(request);
        const step = steps[Math.min(index, steps.length - 1)];
        index += 1;
        return { rawOutput: step, model: "fake", inputTokens: 1, outputTokens: 1, providerRequestId: `c-${index}`, finishReason: "stop" };
      }
    }
  };
}

const neverEnsure = async (): Promise<EnsureCommercialActionOpportunityResult> => {
  throw new Error("ensureOpportunity must not be called");
};

const loopBase = {
  correlationId: "corr-p78",
  conversationId: 4200,
  opportunityId: null,
  currentTime: "2026-09-21T15:00:00.000Z",
  customerMessage: "quiero la barra olimpica classic",
  commercialContextSummary: {},
  ensureOpportunity: neverEnsure,
  harnessAlignedMessageModelEnabled: true,
  openTurnExecutionEnabled: true
};

test("P7.8: promptBuilder seam - absent means the hybrid builder (byte-identical to passing it explicitly)", async () => {
  const absent = capturingProvider([{ type: "respond", message: "hola" }]);
  const explicit = capturingProvider([{ type: "respond", message: "hola" }]);
  await runAgentToolLoop({ ...loopBase, provider: absent.provider });
  await runAgentToolLoop({ ...loopBase, provider: explicit.provider, promptBuilder: buildAgentStepPromptPackage });
  assert.deepEqual(absent.requests[0].messages, explicit.requests[0].messages);
  assert.ok(systemOf(absent.requests[0].messages).includes("Choose capabilities according to the unresolved problem"), "default path is the hybrid prompt");
});

test("P7.8-A: with promptBuilder=B the loop still runs the same loop/tool pool - only the prompt differs", async () => {
  const hybrid = capturingProvider([{ type: "respond", message: "hola" }]);
  const autonomous = capturingProvider([{ type: "respond", message: "hola" }]);
  const a = await runAgentToolLoop({ ...loopBase, provider: hybrid.provider });
  const b = await runAgentToolLoop({ ...loopBase, provider: autonomous.provider, promptBuilder: buildAutonomousStepPromptPackage });
  assert.equal(a.terminalReason, "responded");
  assert.equal(b.terminalReason, "responded");
  assert.equal(b.finalMessage, "hola", "I: the final response is captured");
  const toolNames = (system: string) => [...system.matchAll(/^- ([a-z_]+): /gm)].map((match) => match[1]);
  assert.deepEqual(toolNames(systemOf(autonomous.requests[0].messages)), toolNames(systemOf(hybrid.requests[0].messages)), "same tool pool, same order");
  assert.equal(systemOf(autonomous.requests[0].messages).includes("Choose capabilities according to the unresolved problem"), false);
});

test("P7.8-H: B under open-turn terminates on a pathological provider (no_progress), never loops forever", async () => {
  const claims = capturingProvider([{ type: "respond", message: "Perfecto, 2 unidades listas." }]);
  const result = await runAgentToolLoop({ ...loopBase, provider: claims.provider, promptBuilder: buildAutonomousStepPromptPackage });
  assert.equal(result.terminalReason, "no_progress");
  assert.ok(claims.requests.length <= 12, `bounded provider calls, got ${claims.requests.length}`);
});

test("P7.8-H: B under the legacy 3/2 budget terminates within the decision budget", async () => {
  const unknownTool = capturingProvider([{ type: "use_tool", tool: "definitely_not_a_tool", arguments: {} }]);
  const result = await runAgentToolLoop({ ...loopBase, openTurnExecutionEnabled: false, provider: unknownTool.provider, promptBuilder: buildAutonomousStepPromptPackage, maxDecisions: 3, maxToolExecutions: 2 });
  assert.ok(unknownTool.requests.length <= 6, `bounded provider calls, got ${unknownTool.requests.length}`);
  assert.ok(["responded", "handoff", "invalid_output", "max_steps_exceeded", "no_progress", "timeout"].includes(result.terminalReason));
});

test("P7.8-B/C: B's cognition modules import no DB, HTTP client, Gateway executor or domain writer (DeepSeek decides, Gateway validates, domain mutates)", () => {
  const dir = join(process.cwd(), "lib/brain/commercial/agent-loop/benchmark/r3AutonomousAB");
  const forbidden = [/from ["'].*lib\/db["']/, /from ["']@\/lib\/db["']/, /executeCapability/, /capability-gateway\/registry/, /lib\/domains\//, /@\/lib\/domains/, /\bfetch\(/, /mysql/i, /safeExecute/, /getPool/];
  for (const file of ["autonomousPrompt.ts", "variants.ts", "analysis.ts", "abCorpus.ts"]) {
    const source = readFileSync(join(dir, file), "utf8");
    for (const pattern of forbidden) assert.equal(pattern.test(source), false, `${file} must not match ${pattern}`);
  }
});

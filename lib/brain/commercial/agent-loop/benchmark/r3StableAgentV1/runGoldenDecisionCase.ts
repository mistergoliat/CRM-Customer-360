import { randomUUID } from "node:crypto";
import { buildAgentStepPromptPackage } from "../../buildAgentStepPromptPackage";
import { buildToolDescriptions, DEFAULT_MAX_DECISIONS } from "../../runAgentToolLoop";
import { validateAgentStep } from "../../validateAgentStep";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT } from "../../../sales-agent-configuration";
import type { AgentLoopProvider } from "../../agentLoopProviderTypes";
import type { SemanticVocabulary } from "../../../capability-gateway/searchProductsBySemanticsCapability";
import { scoreGoldenCase } from "./scoreGoldenCase";
import type { GoldenDecisionCase, GoldenDecisionRunResult } from "./types";

/**
 * R3 Stable Agent Acceptance Harness V1, category D (observation -> replan).
 * Deliberately bypasses runAgentToolLoop's own turn bookkeeping and tests
 * exactly one model decision given a real-shaped, injected prior
 * ToolObservation - the same technique this repo's own
 * scripts/live-semantic-discovery-benchmark.ts#askAgentStep already
 * established (buildAgentStepPromptPackage + buildToolDescriptions +
 * validateAgentStep, all real production code, unmodified). Not a second
 * planner: this never decides anything itself, it only records what the real
 * one decided.
 *
 * A small, fixed, real-shaped SemanticVocabulary fixture (mirrors the shape
 * tests/agent-loop/benchmark/liveSemanticDiscoveryBenchmarkWiring.test.ts's
 * own fake catalog port produces) is always passed - harmless for cases that
 * never call search_products_by_semantics, and gives RP-001/RP-003 the same
 * canonical-vocabulary context production would have resolved.
 */
const FIXTURE_SEMANTIC_VOCABULARY: SemanticVocabulary = {
  axes: [
    { axis: "BODY_REGION", codes: [{ code: "LOWER_BODY", label: "Tren inferior" }] },
    { axis: "PRODUCT_FAMILY", codes: [{ code: "LEG_PRESS", label: "Leg press" }] }
  ]
};

export async function runGoldenDecisionCase(testCase: GoldenDecisionCase, provider: AgentLoopProvider, runIndex: number): Promise<GoldenDecisionRunResult> {
  const availableTools = buildToolDescriptions();
  const { messages } = buildAgentStepPromptPackage({
    currentTime: new Date().toISOString(),
    customerMessage: testCase.customerMessage,
    commercialContextSummary: {},
    recentCatalogContext: null,
    pendingCatalogAction: null,
    availableTools,
    priorSteps: testCase.priorSteps,
    stepsRemaining: Math.max(1, DEFAULT_MAX_DECISIONS - testCase.priorSteps.length),
    phase: "gathering",
    identityConfiguration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
    harnessAlignedMessageModelEnabled: true,
    semanticVocabulary: FIXTURE_SEMANTIC_VOCABULARY
  });

  const startedAt = Date.now();
  const response = await provider.invoke({ messages, correlationId: randomUUID() }, { signal: new AbortController().signal, timeoutMs: 20000 });
  const elapsedMs = Date.now() - startedAt;

  const validated = validateAgentStep(response.rawOutput, ["use_tool", "respond", "handoff"]);
  const nextStep = validated.status === "valid" ? validated.step : null;
  const invalidOutputReason = validated.status === "valid" ? null : `${validated.reasonCode}: ${validated.reason}`;

  const score = scoreGoldenCase(testCase, runIndex, { nextStep, invalidOutputReason });

  return {
    caseId: testCase.caseId,
    category: testCase.category,
    runIndex,
    mode: "decision",
    nextStep,
    invalidOutputReason,
    elapsedMs,
    inputTokens: response.inputTokens ?? null,
    outputTokens: response.outputTokens ?? null,
    score
  };
}

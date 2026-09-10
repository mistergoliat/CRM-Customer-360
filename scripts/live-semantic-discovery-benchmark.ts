/**
 * SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B5. Bounded live-DeepSeek acceptance
 * for search_products_by_semantics tool selection / canonicalization /
 * post-tool reasoning, run through the REAL harness-aligned prompt-building
 * code (buildAgentStepPromptPackage.ts + buildToolDescriptions() from the
 * real Capability Gateway registry) and a REAL DeepSeek call
 * (createLiveBenchmarkProvider, same helper live-r2-semantic-variants-benchmark.ts
 * and live-c09-benchmark.ts already use) - never a scripted/mocked provider.
 *
 * Explicit, documented scope reduction (see the release doc for the full
 * rationale): the real Catalog Service (CATALOG_SERVICE_BASE_URL=127.0.0.1:4010)
 * and MariaDB are NOT reachable from this implementation session - same
 * vantage-point limitation documented across every prior task in this
 * release (confirmed here via scripts/manual-test/catalog-service-smoke.ts:
 * real timeout, not a guess). This script therefore:
 *   - Never calls runAgentToolLoop() (which would need both DB and Catalog).
 *   - Uses the REAL tool registry/schemas/useWhen/doNotUseWhen (buildToolDescriptions()) -
 *     these are code, not data, and are fully reachable.
 *   - Runs with semanticVocabulary ABSENT (the registry itself is
 *     unreachable) - this is the ONE deviation from full production fidelity,
 *     called out on every case's output line, never silently omitted.
 *   - Simulates tool OBSERVATIONS (NO_MATCH / invalid_code) using the exact
 *     shape buildToolObservation.ts's own real projection functions produce -
 *     never invented ad hoc - to test post-tool reasoning without requiring a
 *     live catalog round trip.
 *
 * Usage (requires a real, funded DeepSeek key - never runs in CI):
 *   BENCHMARK_LIVE_LLM_ENABLED=true npx tsx scripts/live-semantic-discovery-benchmark.ts
 */
import { randomUUID } from "node:crypto";
import { resolveLiveBenchmarkProviderConfig, createLiveBenchmarkProvider } from "../lib/brain/commercial/agent-loop/benchmark/liveProvider";
import { buildAgentStepPromptPackage } from "../lib/brain/commercial/agent-loop/buildAgentStepPromptPackage";
import { buildToolDescriptions } from "../lib/brain/commercial/agent-loop/runAgentToolLoop";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT } from "../lib/brain/commercial/sales-agent-configuration";
import { validateAgentStep } from "../lib/brain/commercial/agent-loop/validateAgentStep";
import type { AgentLoopStepRecord } from "../lib/brain/commercial/agent-loop/agentStepTypes";
import type { AgentLoopProvider } from "../lib/brain/commercial/agent-loop/agentLoopProviderTypes";

const DEFAULT_MAX_DECISIONS = 3;

type CaseResult = {
  label: string;
  customerMessage: string;
  elapsedMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  outcome: "use_tool" | "respond" | "handoff" | "invalid_output" | "provider_error";
  tool?: string;
  argumentsJson?: string;
  message?: string;
};

const results: CaseResult[] = [];

async function askAgentStep(input: { label: string; customerMessage: string; priorSteps?: AgentLoopStepRecord[] }, provider: AgentLoopProvider): Promise<CaseResult> {
  const availableTools = buildToolDescriptions();
  const priorSteps = input.priorSteps ?? [];
  const { messages } = buildAgentStepPromptPackage({
    currentTime: new Date().toISOString(),
    customerMessage: input.customerMessage,
    commercialContextSummary: {},
    recentCatalogContext: null,
    pendingCatalogAction: null,
    availableTools,
    priorSteps,
    stepsRemaining: DEFAULT_MAX_DECISIONS - priorSteps.length,
    phase: "gathering",
    identityConfiguration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
    harnessAlignedMessageModelEnabled: true,
    // Deliberately absent: the real Catalog Service registry is unreachable
    // from this session (see file header) - never a fabricated vocabulary.
    semanticVocabulary: null
  });

  const correlationId = randomUUID();
  const startedAt = Date.now();
  let response;
  try {
    response = await provider.invoke({ messages, correlationId }, { signal: new AbortController().signal, timeoutMs: 20000 });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    console.error(`[${input.label}] provider call threw: ${error instanceof Error ? error.message : String(error)}`);
    return { label: input.label, customerMessage: input.customerMessage, elapsedMs, inputTokens: null, outputTokens: null, outcome: "provider_error" };
  }
  const elapsedMs = Date.now() - startedAt;

  const validated = validateAgentStep(response.rawOutput, ["use_tool", "respond", "handoff"]);
  if (validated.status !== "valid") {
    console.error(`[${input.label}] model output failed AgentStep validation: ${validated.reasonCode} - ${validated.reason}`);
    return { label: input.label, customerMessage: input.customerMessage, elapsedMs, inputTokens: response.inputTokens ?? null, outputTokens: response.outputTokens ?? null, outcome: "invalid_output" };
  }

  const step = validated.step;
  const base = { label: input.label, customerMessage: input.customerMessage, elapsedMs, inputTokens: response.inputTokens ?? null, outputTokens: response.outputTokens ?? null };
  if (step.type === "use_tool") return { ...base, outcome: "use_tool", tool: step.tool, argumentsJson: JSON.stringify(step.arguments) };
  if (step.type === "respond") return { ...base, outcome: "respond", message: step.message };
  return { ...base, outcome: "handoff", message: step.reason };
}

function printResult(result: CaseResult) {
  console.log(`\n=== ${result.label} ===`);
  console.log(`customerMessage: "${result.customerMessage}"`);
  console.log(`elapsedMs=${result.elapsedMs} inputTokens=${result.inputTokens ?? "n/a"} outputTokens=${result.outputTokens ?? "n/a"} outcome=${result.outcome}`);
  if (result.outcome === "use_tool") {
    console.log(`tool=${result.tool}`);
    console.log(`arguments=${result.argumentsJson}`);
  } else if (result.outcome === "respond" || result.outcome === "handoff") {
    console.log(`message="${result.message}"`);
  }
}

function syntheticSemanticDiscoveryObservation(requirements: Array<{ axis: string; codes: string[]; mode: string; match: string }>, outcome: "no_match" | "invalid_code") {
  if (outcome === "no_match") {
    return {
      tool: "search_products_by_semantics" as const,
      status: "completed" as const,
      data: { outcome: "no_match", results: [], totalMatches: 0, truncated: false }
    };
  }
  return {
    tool: "search_products_by_semantics" as const,
    status: "blocked" as const,
    errorCode: "invalid_code",
    data: { invalidRequirements: requirements.map((requirement) => ({ axis: requirement.axis, codes: requirement.codes })) }
  };
}

async function main() {
  const resolution = resolveLiveBenchmarkProviderConfig();
  if (!resolution.ok) {
    console.error(`Live benchmark disabled or unconfigured: ${resolution.reason}`);
    console.error("Set BENCHMARK_LIVE_LLM_ENABLED=true and ensure BRAIN_MODEL_API_URL/BRAIN_MODEL_API_KEY/BRAIN_MODEL_NAME are set.");
    process.exitCode = 1;
    return;
  }
  // R3 PILOT HOTFIX parity (runNativeAutonomousCycle.ts, 2026-08-31): the
  // real R3 runtime always disables `thinking` for its own provider calls.
  // Reproduced here so this benchmark matches the real R3 configuration,
  // not a generic default (task section 1: "Confirm ... Do not change
  // budgets unless required to reproduce the current production configuration").
  const provider = createLiveBenchmarkProvider({ ...resolution.config, thinking: "disabled" });

  console.log(`Live Semantic Discovery benchmark - model=${resolution.config.model} temperature=${resolution.config.temperature}`);
  console.log("semanticVocabulary: ABSENT this run (Catalog Service registry unreachable from this session - see file header)");

  // Section 4 - live cases A-E (single-shot tool-selection/canonicalization)
  const cases: Array<{ label: string; message: string }> = [
    { label: "CASE_A_piernas_casa", message: "quiero algo para entrenar piernas en mi casa" },
    { label: "CASE_B_leg_press_obelix", message: "tienen la Leg Press Obelix?" },
    { label: "CASE_C_pecho_home_gym", message: "quiero algo para entrenar pecho en mi home gym" },
    { label: "CASE_D_maquina_leg_press", message: "quiero una máquina para hacer leg press" },
    { label: "CASE_E_estructura_barra", message: "quiero una estructura para apoyar la barra" }
  ];
  for (const testCase of cases) {
    const result = await askAgentStep({ label: testCase.label, customerMessage: testCase.message }, provider);
    results.push(result);
    printResult(result);
  }

  // Section 5 - NO_MATCH must be reasoned about as a valid empty result.
  const noMatchPriorSteps: AgentLoopStepRecord[] = [
    {
      stepIndex: 0,
      phase: "gathering",
      governance: "authorized",
      step: { type: "use_tool", tool: "search_products_by_semantics", arguments: { requirements: [{ axis: "BODY_REGION", codes: ["LOWER_BODY"], mode: "required", match: "any" }] } },
      observation: syntheticSemanticDiscoveryObservation([{ axis: "BODY_REGION", codes: ["LOWER_BODY"], mode: "required", match: "any" }], "no_match")
    }
  ];
  const noMatchResult = await askAgentStep({ label: "CASE_NO_MATCH", customerMessage: "quiero algo para entrenar piernas en mi casa", priorSteps: noMatchPriorSteps }, provider);
  results.push(noMatchResult);
  printResult(noMatchResult);

  // Section 6 - invalid_code repairable observation.
  const invalidCodePriorSteps: AgentLoopStepRecord[] = [
    {
      stepIndex: 0,
      phase: "gathering",
      governance: "authorized",
      step: { type: "use_tool", tool: "search_products_by_semantics", arguments: { requirements: [{ axis: "BODY_REGION", codes: ["PIERNA_INVENTADA_XYZ"], mode: "required", match: "any" }] } },
      observation: syntheticSemanticDiscoveryObservation([{ axis: "BODY_REGION", codes: ["PIERNA_INVENTADA_XYZ"], mode: "required", match: "any" }], "invalid_code")
    }
  ];
  const invalidCodeResult = await askAgentStep({ label: "CASE_INVALID_CODE_REPAIR", customerMessage: "quiero algo para entrenar piernas en mi casa", priorSteps: invalidCodePriorSteps }, provider);
  results.push(invalidCodeResult);
  printResult(invalidCodeResult);

  console.log("\n=== Summary (metrics) ===");
  for (const result of results) {
    console.log(
      `${result.label}: outcome=${result.outcome} tool=${result.tool ?? "-"} elapsedMs=${result.elapsedMs} inputTokens=${result.inputTokens ?? "n/a"} outputTokens=${result.outputTokens ?? "n/a"}`
    );
  }
}

main().catch((error) => {
  console.error("Live semantic discovery benchmark crashed unexpectedly:", error);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { renderToolLine } from "@/lib/brain/commercial/agent-loop/buildAgentStepPromptPackage";
import { AGENT_LOOP_TOOL_POOL, buildToolDescriptions } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";
import type { CapabilityGatewayResult } from "@/lib/brain/commercial/capability-gateway/types";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT } from "@/lib/brain/commercial/sales-agent-configuration";
import { buildCurrentToolSurface, buildThinToolSurface, THIN_RELEVANT_TOOL_NAMES, TRUE_HARNESS_TOOL_NAMES } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/toolSurface";
import { runTrueHarnessTurn, type TrueHarnessDependencies } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/trueHarnessLoop";
import { buildTrueHarnessRuntimeContextMessage, buildTrueHarnessSystemPrompt, TRUE_HARNESS_PROMPT_VERSION } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/trueHarnessPrompt";
import type { NativeChatMessage, NativeModelCallResult, NativeModelCaller } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/nativeToolClient";

/**
 * SALES-AGENT-R3-P7.8-R. Pure/in-memory tests: the true harness is NOT the R3
 * loop (static proof), the tool contracts (B unchanged, C1 deterministic and
 * domain-faithful) and the loop mechanics (Gateway call, refreshed state,
 * evidence gate, bounds). No DB, no network.
 */

const DIR = join(process.cwd(), "lib/brain/commercial/agent-loop/benchmark/r3TrueAB");
const HARNESS_FILES = ["trueHarnessLoop.ts", "trueHarnessPrompt.ts", "toolSurface.ts", "nativeToolClient.ts", "scriptedNativeModel.ts"];
const read = (file: string) => readFileSync(join(DIR, file), "utf8");
const importsOf = (source: string) => [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);

// ---- static proof: B/C do not use the R3 (ATL) loop ---------------------------------

test("P7.8-R/19: the true harness files import neither the R3 loop, the AgentStep protocol/validator, the R3 prompt package, the open-turn checkpoint nor any DB/domain/service", () => {
  const forbiddenImports = [/runAgentToolLoop/, /buildAgentStepPromptPackage/, /validateAgentStep/, /agentStepTypes/, /harnessAlignedMessageProjection/, /turnStoppingCheckpoint/, /openTurnProgress/, /sales-agent-runtime/, /commercial-proposal/, /objective-reconciliation/, /capability-eligibility/, /agent-turn-input/, /lib\/db/, /lib\/domains/, /lib\/catalog/, /capability-gateway\/repository/];
  for (const file of HARNESS_FILES) {
    for (const specifier of importsOf(read(file))) {
      for (const pattern of forbiddenImports) assert.equal(pattern.test(specifier), false, `${file} must not import ${specifier}`);
    }
  }
});

test("P7.8-R/19: the true harness never constructs an AgentStep nor the ATL phases/vocabulary", () => {
  for (const file of ["trueHarnessLoop.ts", "trueHarnessPrompt.ts", "nativeToolClient.ts"]) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [/\bAgentStep\b/, /AgentLoopStepRecord/, /"use_tool"/, /"handoff"/, /gathering/i, /finalization/i, /Steps remaining/i, /stepsRemaining/, /commercialProposal/i, /pendingCatalogAction/]) {
      assert.equal(forbidden.test(source), false, `${file} must not contain ${forbidden}`);
    }
  }
});

test("P7.8-R/20: the loop executes tools through the existing Capability Gateway (executeGovernedCapability) - no fake gateway, no direct executor", () => {
  const loop = read("trueHarnessLoop.ts");
  assert.ok(importsOf(loop).includes("../../../capability-gateway/executeCapability"));
  assert.ok(/import \{ executeGovernedCapability \}/.test(loop));
  assert.ok(/input\.deps\.executeCapability \?\? executeGovernedCapability/.test(loop), "default executor is the real Gateway");
  // the model-facing adapter only maps names/arguments; it never executes anything
  const surface = read("toolSurface.ts").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/executeGovernedCapability|\.execute\(|checkAvailability/.test(surface), false);
});

// ---- tool contracts ------------------------------------------------------------------

test("P7.8-R: the mirrored tool list equals the production pool (no drift)", () => {
  assert.deepEqual([...TRUE_HARNESS_TOOL_NAMES], [...AGENT_LOOP_TOOL_POOL]);
  assert.deepEqual(buildCurrentToolSurface().tools.map((tool) => tool.name), buildToolDescriptions().map((tool) => tool.name));
});

test("P7.8-R/6: B's tool contract is unchanged - every tool carries exactly the content the R3 prompt renders (description, useWhen, doNotUseWhen, semantics, JSON schema)", () => {
  const surface = buildCurrentToolSurface();
  for (const description of buildToolDescriptions()) {
    const line = renderToolLine(description);
    const tool = surface.tools.find((candidate) => candidate.name === description.name)!;
    assert.ok(tool, description.name);
    assert.ok(line.includes(description.description) && tool.description.includes(description.description));
    if (description.useWhen) assert.ok(tool.description.includes(`Use when: ${description.useWhen}.`));
    if (description.doNotUseWhen) assert.ok(tool.description.includes(`Do not use when: ${description.doNotUseWhen}.`));
    assert.deepEqual(tool.parameters, description.inputSchema, `${description.name}: schema verbatim`);
    // whatever the semantics sentence is, the R3 line ends with the same text B's description ends with
    const semanticsTail = line.slice(line.lastIndexOf("Do not use when:") >= 0 ? line.lastIndexOf("Do not use when:") : 0);
    if (description.operationSemantics) assert.ok(semanticsTail.endsWith(tool.description.slice(tool.description.lastIndexOf(". ") + 2)), `${description.name}: semantics sentence identical`);
  }
});

test("P7.8-R/7/27: C1 thin surface is deterministic, keeps the same tool set, thins exactly the 7 relevant tools and keeps quantity REQUIRED", () => {
  const a = buildThinToolSurface();
  const b = buildThinToolSurface();
  assert.equal(JSON.stringify(a.tools), JSON.stringify(b.tools), "deterministic");
  const current = buildCurrentToolSurface();
  assert.deepEqual(a.tools.map((tool) => tool.name), current.tools.map((tool) => tool.name), "same tool set and order as B");
  const relevant = new Set<string>(THIN_RELEVANT_TOOL_NAMES);
  for (const tool of a.tools) {
    const currentTool = current.tools.find((candidate) => candidate.name === tool.name)!;
    if (relevant.has(tool.name)) assert.notEqual(tool.description, currentTool.description, `${tool.name} is thinned`);
    else assert.deepEqual(tool, currentTool, `${tool.name} keeps its current contract`);
  }
  const select = a.tools.find((tool) => tool.name === "select_products")!;
  const item = ((select.parameters.properties as Record<string, { items: { required: string[] } }>).items).items;
  assert.deepEqual(item.required, ["productId", "quantity"], "quantity stays required (no default, no optional)");
  assert.ok(a.stats.relevantToolChars < current.stats.relevantToolChars / 2, "the thin contract is materially smaller on the relevant tools");
  assert.equal(a.stats.toolCount, current.stats.toolCount);
});

test("P7.8-R/7: thin schemas never change a domain requirement - required fields equal the real capability's, properties are a subset", () => {
  for (const name of THIN_RELEVANT_TOOL_NAMES) {
    const real = resolveCapabilityGatewayDefinition(name)!.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
    const thin = buildThinToolSurface().tools.find((tool) => tool.name === name)!.parameters as { required?: string[]; properties?: Record<string, unknown> };
    assert.deepEqual([...(thin.required ?? [])].sort(), [...(real.required ?? [])].sort(), `${name}: same required fields`);
    for (const property of Object.keys(thin.properties ?? {})) assert.ok(property in (real.properties ?? {}), `${name}.${property} exists in the real schema`);
  }
});

test("P7.8-R/5: the frozen prompt has only the allowed content and none of the hybrid steering", () => {
  const system = buildTrueHarnessSystemPrompt(SALES_AGENT_CONFIGURATION_SAFE_DEFAULT);
  assert.ok(system.includes("Complete the customer's requested commercial outcome using the available tools. Continue until the requested result is completed, a genuine blocker exists, or information only the customer can provide is missing. Do not claim actions that have not succeeded. Do not mutate commercial state for purely informational requests."));
  for (const forbidden of ["¿Quieres que te envíe el link", "select_products", "Explicit purchase", "commercialProposal", "eligib", "Steps remaining", "AgentStep", "quantity"]) assert.equal(system.includes(forbidden), false, forbidden);
  assert.equal(TRUE_HARNESS_PROMPT_VERSION, "p7.8r-true-harness-v1");
  const context = buildTrueHarnessRuntimeContextMessage({ currentTime: "t", commercialState: { selection: [] } });
  assert.ok(context.role === "system" && context.content.includes('"commercialState":{"selection":[]}'));
});

// ---- loop mechanics (fakes) ------------------------------------------------------------

function completedResult(capability: string, data: unknown): CapabilityGatewayResult {
  return { capability, version: "1", availability: "available", status: "completed", data, errorCode: null, retryable: false, evidence: [], warnings: [], retryCount: 0, startedAt: "t", completedAt: "t", executionPublicId: "x" } as unknown as CapabilityGatewayResult;
}

function scripted(steps: (NativeModelCallResult | ((messages: NativeChatMessage[]) => NativeModelCallResult))[]): { caller: NativeModelCaller; seen: NativeChatMessage[][] } {
  const seen: NativeChatMessage[][] = [];
  let index = 0;
  return {
    seen,
    caller: async ({ messages }) => {
      seen.push([...messages]);
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      return typeof step === "function" ? step(messages) : step;
    }
  };
}
const ok = (over: Partial<Extract<NativeModelCallResult, { kind: "ok" }>>): NativeModelCallResult => ({ kind: "ok", content: null, toolCalls: [], finishReason: "stop", inputTokens: 1, outputTokens: 1, reasoningTokens: 0, elapsedMs: 1, ...over });
const call = (id: string, name: string, args: unknown) => ({ id, name, arguments: typeof args === "string" ? args : JSON.stringify(args) });

const baseRun = (deps: TrueHarnessDependencies, over: Partial<Parameters<typeof runTrueHarnessTurn>[0]> = {}) =>
  runTrueHarnessTurn({
    messages: [{ role: "system", content: "s" }, { role: "user", content: "quiero la classic" }],
    surface: buildCurrentToolSurface(),
    gatewayContext: { correlationId: "c", conversationId: 1, opportunityId: 1 },
    recentCatalogContext: null,
    deadlineMs: Date.now() + 30000,
    deps,
    ...over
  });

test("P7.8-R: plain text ends the turn as the final response (no tool executed)", async () => {
  const model = scripted([ok({ content: "  Hola  " })]);
  const result = await baseRun({ callModel: model.caller, refreshState: async () => ({}) });
  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "Hola");
  assert.equal(result.toolCalls.length, 0);
});

test("P7.8-R/21: after each tool the canonical state is rebuilt and the NEXT model call sees it (selection CURRENT after select_products)", async () => {
  const executed: string[] = [];
  let saved: { productId: string; quantity: number }[] = [];
  const model = scripted([
    ok({ toolCalls: [call("1", "get_product_details", { productId: "31" })] }),
    ok({ toolCalls: [call("2", "select_products", { items: [{ productId: "31", quantity: 2 }] })] }),
    ok({ content: "Listo" })
  ]);
  const result = await baseRun({
    callModel: model.caller,
    executeCapability: async (capability, input) => {
      executed.push(capability);
      if (capability === "select_products") saved = (input.items as typeof saved).map((item) => ({ productId: item.productId, quantity: item.quantity }));
      return completedResult(capability, capability === "get_product_details" ? { productId: "31", name: "Barra" } : { status: "selected" });
    },
    refreshState: async () => ({ selection: saved })
  });
  assert.deepEqual(executed, ["get_product_details", "select_products"]);
  assert.equal(result.stateRefreshCount, 2);
  const toolMessage = (call: number) => model.seen[call].filter((message) => message.role === "tool").map((message) => JSON.parse((message as { content: string }).content));
  assert.deepEqual(toolMessage(1)[0].commercialState, { selection: [] }, "2nd call: state after the read");
  assert.deepEqual(toolMessage(2)[1].commercialState, { selection: [{ productId: "31", quantity: 2 }] }, "3rd call: the durable selection is visible");
  assert.equal(result.terminalReason, "responded");
});

test("P7.8-R: an unknown tool and unparseable arguments are rejected before the Gateway (never executed) and reported to the model", async () => {
  let executions = 0;
  const model = scripted([ok({ toolCalls: [call("1", "drop_database", {}), call("2", "search_products", "{not json")] }), ok({ content: "no puedo" })]);
  const result = await baseRun({ callModel: model.caller, executeCapability: async (capability) => { executions += 1; return completedResult(capability, {}); }, refreshState: async () => ({}) });
  assert.equal(executions, 0);
  assert.deepEqual(result.toolCalls.map((record) => record.rejectedBeforeGateway), ["capability_not_registered", "invalid_arguments_json"]);
  assert.equal(result.toolCalls.every((record) => record.gatewayStatus === null), true);
  assert.equal(model.seen[1].filter((message) => message.role === "tool").length, 2, "every tool_call_id gets a tool message");
});

test("P7.8-R: the evidence gate holds - select_products for a product never observed is blocked before the Gateway; after get_product_details it passes", async () => {
  const executed: string[] = [];
  const execute: TrueHarnessDependencies["executeCapability"] = async (capability) => {
    executed.push(capability);
    return completedResult(capability, capability === "get_product_details" ? { productId: "31", name: "Barra" } : { status: "selected" });
  };
  const blocked = scripted([ok({ toolCalls: [call("1", "select_products", { items: [{ productId: "31", quantity: 1 }] })] }), ok({ content: "x" })]);
  const first = await baseRun({ callModel: blocked.caller, executeCapability: execute, refreshState: async () => ({}) });
  assert.equal(first.toolCalls[0].rejectedBeforeGateway !== null, true);
  assert.deepEqual(executed, []);

  const grounded = scripted([ok({ toolCalls: [call("1", "get_product_details", { productId: "31" })] }), ok({ toolCalls: [call("2", "select_products", { items: [{ productId: "31", quantity: 1 }] })] }), ok({ content: "x" })]);
  const second = await baseRun({ callModel: grounded.caller, executeCapability: execute, refreshState: async () => ({}) });
  assert.deepEqual(executed, ["get_product_details", "select_products"]);
  assert.equal(second.toolCalls[1].gatewayStatus, "completed");
});

test("P7.8-R/H: the loop terminates under every bound - tool limit, model-call limit, deadline, provider error, empty output", async () => {
  const looping = scripted([ok({ toolCalls: [call("1", "get_quote", {})] })]);
  const limited = await baseRun({ callModel: looping.caller, executeCapability: async (capability) => completedResult(capability, {}), refreshState: async () => ({}) }, { limits: { maxModelCalls: 50, maxToolCalls: 3 } });
  assert.equal(limited.terminalReason, "emergency_limit_exceeded");
  assert.equal(limited.toolCalls.length, 3);

  const modelLimited = await baseRun({ callModel: scripted([ok({ content: "" })]).caller, refreshState: async () => ({}) }, { limits: { maxModelCalls: 1, maxToolCalls: 5 } });
  assert.equal(modelLimited.terminalReason, "emergency_limit_exceeded");

  assert.equal((await baseRun({ callModel: scripted([ok({ content: "x" })]).caller, refreshState: async () => ({}) }, { deadlineMs: Date.now() - 1 })).terminalReason, "timeout");
  assert.equal((await baseRun({ callModel: scripted([{ kind: "timeout", elapsedMs: 5 }]).caller, refreshState: async () => ({}) })).terminalReason, "timeout");
  const failed = await baseRun({ callModel: scripted([{ kind: "error", reason: "http_error", httpStatus: 500, elapsedMs: 5 }]).caller, refreshState: async () => ({}) });
  assert.equal(failed.terminalReason, "provider_unavailable");
  assert.deepEqual(failed.warnings, ["true_harness_provider_error:http_error"]);
  const empty = scripted([ok({ content: "  " })]);
  assert.equal((await baseRun({ callModel: empty.caller, refreshState: async () => ({}) })).terminalReason, "invalid_output");
  assert.equal(empty.seen.length, 2, "exactly one re-ask before giving up");
});

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { buildTrueArtifactFiles, buildTruePlan, runTrueAB, type TrueBundle } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/runTrueAB";
import { runTrueHarnessCase } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/runTrueHarnessCase";
import { createScriptedNativeModel } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/scriptedNativeModel";
import { buildCurrentToolSurface, buildThinToolSurface } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/toolSurface";
import type { NativeChatMessage, NativeModelCaller, NativeToolDefinition } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/nativeToolClient";
import { buildP78AbCorpus, P78_NEGATIVE_CONTROL_CASE_IDS, P78_PRIMARY_CASE_IDS } from "@/lib/brain/commercial/agent-loop/benchmark/r3AutonomousAB/abCorpus";
import { BENCHMARK_E2E_CORPUS } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/corpus";
import { TRUE_ARM_IDS } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/trueAnalysis";

/**
 * SALES-AGENT-R3-P7.8-R. DB-backed, OFFLINE (scripted native model, no LLM)
 * tests against the real Capability Gateway and crm_test. They prove WIRING:
 * Gateway execution with audit rows, identity gate, refreshed durable state,
 * identical configuration/initial state, artifacts. Behavior is measured live.
 */
Object.assign(process.env, {
  NODE_ENV: "test",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "crm_test",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

const CORPUS = buildP78AbCorpus();
const pick = (...ids: string[]) => ids.map((id) => CORPUS.find((testCase) => testCase.caseId === id) ?? BENCHMARK_E2E_CORPUS.find((testCase) => testCase.caseId === id)!);

test("P7.8-R: the plan is deterministic, triples run back to back and the leading arm rotates (counterbalanced); 10 cases x3 x3 arms = 90 runs", () => {
  const plan = buildTruePlan([...P78_PRIMARY_CASE_IDS, ...P78_NEGATIVE_CONTROL_CASE_IDS], 3);
  assert.equal(plan.length, 90);
  assert.deepEqual(plan, buildTruePlan([...P78_PRIMARY_CASE_IDS, ...P78_NEGATIVE_CONTROL_CASE_IDS], 3));
  for (let index = 0; index < plan.length; index += 3) {
    assert.equal(new Set(plan.slice(index, index + 3).map((entry) => entry.pairId)).size, 1);
    assert.equal(new Set(plan.slice(index, index + 3).map((entry) => entry.arm)).size, 3);
  }
  const leaders = plan.filter((entry) => entry.positionInTriple === 0).map((entry) => entry.arm);
  for (const arm of TRUE_ARM_IDS) assert.equal(leaders.filter((leader) => leader === arm).length, 10, `${arm} leads a third of the triples`);
  assert.deepEqual(plan.slice(0, 9).map((entry) => entry.arm), ["A_R3_CURRENT", "B_PURE_CURRENT_TOOLS", "C1_PURE_THIN_TOOLS", "B_PURE_CURRENT_TOOLS", "C1_PURE_THIN_TOOLS", "A_R3_CURRENT", "C1_PURE_THIN_TOOLS", "A_R3_CURRENT", "B_PURE_CURRENT_TOOLS"]);
});

let bundlePromise: Promise<TrueBundle> | null = null;
function offlineBundle(): Promise<TrueBundle> {
  bundlePromise ??= (async () => {
    const result = await runTrueAB({ mode: "offline", runsPerCase: 1, corpus: pick("E02", "E12", "N01") });
    assert.equal(result.ok, true, "MariaDB crm_test must be reachable for these tests");
    if (!result.ok) throw new Error("environment blocked");
    return result.bundle;
  })();
  return bundlePromise;
}
const run = (bundle: TrueBundle, caseId: string, arm: string) => bundle.runs.find((candidate) => candidate.caseId === caseId && candidate.arm === arm)!;

test("P7.8-R/20: B and C1 execute through the real Capability Gateway - non-null gateway outcome AND an audit row in crm_capability_executions per tool call", async () => {
  const bundle = await offlineBundle();
  assert.equal(bundle.runs.length, 9);
  for (const arm of ["B_PURE_CURRENT_TOOLS", "C1_PURE_THIN_TOOLS"] as const) {
    const turn = run(bundle, "E02", arm).trace!.turns[0];
    const select = turn.toolInvocations.find((invocation) => invocation.capability === "select_products");
    assert.equal(select?.gateway?.status, "completed", `${arm}: select_products reached the Gateway`);
    const rows = await queryRows<{ capability_name: string; execution_status: string }>("SELECT capability_name, execution_status FROM crm_capability_executions WHERE correlation_id = ? ORDER BY id ASC", [turn.correlationId]);
    assert.deepEqual(rows.map((row) => row.capability_name), ["get_product_details", "select_products"], `${arm}: Gateway audit rows`);
    assert.equal(rows[1].execution_status, "completed");
    assert.equal(turn.durableStateAfterTurn?.selection.present, true);
    assert.deepEqual(turn.durableStateAfterTurn?.selection.items, [{ productId: "31", quantity: 1 }]);
    assert.equal(turn.proposal, null);
    assert.ok(turn.response.finalMessage);
  }
});

test("P7.8-R/20: B and C1 cannot bypass identity - create_quote under an anonymous session is denied by the Gateway identity gate and no quote exists", async () => {
  const bundle = await offlineBundle();
  const denial = new Set(["master_identity_required", "identity_context_unavailable", "identity_requirement_unresolved"]);
  for (const arm of ["B_PURE_CURRENT_TOOLS", "C1_PURE_THIN_TOOLS"] as const) {
    const record = run(bundle, "E12", arm);
    const quote = record.trace!.turns[0].toolInvocations.find((invocation) => invocation.capability === "create_quote");
    assert.ok(quote);
    assert.ok(denial.has(quote!.gateway?.errorCode ?? "") || denial.has(quote!.toolObservation.errorCode ?? ""));
    assert.equal(record.trace!.finalState?.quote.present, false);
  }
});

test("P7.8-R/10/20: same model configuration, same initial durable state and same fixtures for A, B and C1", async () => {
  const bundle = await offlineBundle();
  for (const caseId of ["E02", "E12", "N01"]) {
    const records = TRUE_ARM_IDS.map((arm) => run(bundle, caseId, arm));
    const shape = (state: NonNullable<(typeof records)[number]["trace"]>["initialState"]) => JSON.stringify({ s: state?.selection.present, d: state?.destination.present, q: state?.quote.present, i: state?.identityLevel, w: state?.workStatus, v: state?.workVersion });
    assert.equal(new Set(records.map((record) => shape(record.trace!.initialState))).size, 1, `${caseId}: same initial state`);
    const config = (record: (typeof records)[number]) => {
      const c = record.runConfig;
      return JSON.stringify({ model: c.model, temperature: c.temperature, thinking: c.thinking, timeoutMs: c.timeoutMs, maxOutputTokens: c.maxOutputTokens, maxModelRetries: c.maxModelRetries, maxDecisions: c.maxDecisions, maxToolExecutions: c.maxToolExecutions });
    };
    assert.equal(new Set(records.map(config)).size, 1, `${caseId}: identical model/timeout/token/retry/budget configuration`);
    assert.equal(new Set(records.map((record) => record.trace!.turns[0].correlationId)).size, 3, "durable state is never shared between arms");
  }
  assert.equal(bundle.runs.find((candidate) => candidate.arm === "A_R3_CURRENT")!.runConfig.usesR3Loop, true);
  assert.equal(bundle.runs.filter((candidate) => candidate.arm !== "A_R3_CURRENT").every((candidate) => candidate.runConfig.usesR3Loop === false), true);
  assert.equal(bundle.runs.find((candidate) => candidate.arm === "C1_PURE_THIN_TOOLS")!.runConfig.toolSurface, "thin");
});

test("P7.8-R/22: artifacts carry the arm per run and the three comparisons (harness tax, capability tax, total difference)", async () => {
  const files = buildTrueArtifactFiles(await offlineBundle());
  assert.deepEqual(Object.keys(files).sort(), ["comparison.json", "failures.json", "manifest.json", "runs.jsonl", "summary.json"]);
  const lines = files["runs.jsonl"].split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 9);
  for (const line of lines) {
    assert.ok(["A_R3_CURRENT", "B_PURE_CURRENT_TOOLS", "C1_PURE_THIN_TOOLS"].includes(line.arm));
    assert.equal(line.runConfig.arm, line.arm);
    assert.ok(Array.isArray(line.turnAnalyses));
  }
  assert.equal(files["runs.jsonl"].includes("requestMessages"), false);
  const comparison = JSON.parse(files["comparison.json"]);
  for (const key of ["A_vs_B_harness_tax", "B_vs_C_capability_tax", "A_vs_C_total_difference", "capabilityContractTax", "architectureSignal", "complexity", "toolSurfaces"]) assert.ok(comparison[key], key);
  assert.equal(comparison.B_vs_C_capability_tax.from, "B_PURE_CURRENT_TOOLS");
  assert.equal(comparison.B_vs_C_capability_tax.to, "C1_PURE_THIN_TOOLS");
  assert.ok(comparison.toolSurfaces.thin.relevantToolChars < comparison.toolSurfaces.current.relevantToolChars);
  const manifest = JSON.parse(files["manifest.json"]);
  assert.equal(manifest.phase, "P7.8-R");
  assert.equal(manifest.plan.length, 9);
  assert.ok(manifest.notReproducibleInHarness.some((note: string) => note.includes("Quote Service")));
});

// ---- real-DB state refresh and "not the R3 loop" at runtime -------------------------------

function recordingModel(script: ReturnType<typeof createScriptedNativeModel>, log: { messages: NativeChatMessage[]; tools: NativeToolDefinition[] }[]): NativeModelCaller {
  return async (input) => {
    log.push({ messages: [...input.messages], tools: input.tools });
    return script(input);
  };
}

for (const [label, surface] of [["B current", buildCurrentToolSurface()], ["C1 thin", buildThinToolSurface()]] as const) {
  test(`P7.8-R/19/21 (${label}): the durable state is rebuilt from the DB after each tool and the next model call sees it; the R3 loop machinery never appears at runtime`, async () => {
    const e02 = pick("E02")[0];
    const log: { messages: NativeChatMessage[]; tools: NativeToolDefinition[] }[] = [];
    const model = recordingModel(createScriptedNativeModel(e02.turns.flatMap((turn) => turn.offlineScript)), log);
    const result = await runTrueHarnessCase(e02, { arm: label === "B current" ? "B_PURE_CURRENT_TOOLS" : "C1_PURE_THIN_TOOLS", surface, runOrdinal: 0, benchmarkRunId: `p78r-refresh-${label}-${Date.now()}`, timeoutMs: 30000, callModel: model });
    assert.equal(log.length, 3, "get_product_details -> select_products -> final answer");
    const toolStates = (callIndex: number) => log[callIndex].messages.filter((message) => message.role === "tool").map((message) => JSON.parse((message as { content: string }).content).commercialState);
    assert.deepEqual(log[0].messages.filter((message) => message.role === "tool"), [], "first call: nothing executed yet");
    assert.deepEqual(toolStates(1)[0].selection, [], "after the read: nothing selected yet (CURRENT state, rebuilt)");
    assert.deepEqual(toolStates(2)[1].selection, [{ productId: "31", quantity: 1 }], "after select_products: the durable selection is what the next call receives");
    assert.equal(result.trace.turns[0].durableStateAfterTurn?.selection.present, true);

    // not the R3 loop: native tools, no AgentStep vocabulary, no R3 policy, no eligibility/proposal, all 14 tools on the surface
    const everything = log.map((entry) => JSON.stringify(entry.messages)).join("\n");
    for (const forbidden of ["AgentStep", "Steps remaining", "commercialProposal", "capabilityEligibility", "Choose capabilities according", "¿Quieres que te envíe el link", "pendingCatalogAction"]) assert.equal(everything.includes(forbidden), false, forbidden);
    assert.equal(log[0].tools.length, 14);
    assert.deepEqual(log[0].tools.map((tool) => tool.name), surface.tools.map((tool) => tool.name));
    assert.equal(result.trace.turns[0].runtimeWarnings.some((warning) => warning.startsWith("agent_loop_") && !warning.startsWith("agent_loop_provider_error")), false);
  });
}

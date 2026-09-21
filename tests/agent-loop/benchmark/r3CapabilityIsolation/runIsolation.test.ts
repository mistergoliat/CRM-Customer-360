import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { analyzeIsolationRun } from "@/lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/isolationAnalysis";
import { ISOLATION_VARIANT_IDS, buildIsolationSurface } from "@/lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/isolationSurfaces";
import { buildIsolationArtifactFiles, computeFreezeHashes, diffFreeze, FREEZE_FILE_GROUPS, runIsolation, sha256File, type IsolationBundle } from "@/lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/runIsolation";

/**
 * SALES-AGENT-R3-P7.9. DB-backed, OFFLINE (scripted native model, no LLM) tests against the
 * real Capability Gateway and crm_test. They prove WIRING (same harness/config/state for
 * every variant, Gateway used, classification of Q+/Q-/negative, denominators, artifacts,
 * freeze hashes). Behavior is measured live.
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

const CASES = ["M01", "K01", "K05", "I01"];
let bundlePromise: Promise<IsolationBundle> | null = null;
function offlineBundle(): Promise<IsolationBundle> {
  bundlePromise ??= (async () => {
    const result = await runIsolation({ mode: "offline", runsPerScenario: 1, caseIds: CASES });
    assert.equal(result.ok, true, "MariaDB crm_test must be reachable for these tests");
    if (!result.ok) throw new Error("environment blocked");
    return result.bundle;
  })();
  return bundlePromise;
}
const run = (bundle: IsolationBundle, caseId: string, variant: string) => bundle.runs.find((candidate) => candidate.caseId === caseId && candidate.variant === variant)!;

test("P7.9: every variant of every scenario runs through the real Capability Gateway (non-null outcome AND an audit row per tool call)", async () => {
  const bundle = await offlineBundle();
  assert.equal(bundle.runs.length, CASES.length * ISOLATION_VARIANT_IDS.length);
  assert.equal(bundle.runs.every((record) => record.harnessError === null), true);
  for (const variant of ISOLATION_VARIANT_IDS) {
    const turn = run(bundle, "K01", variant).trace!.turns[0];
    const select = turn.toolInvocations.find((invocation) => invocation.capability === "select_products");
    assert.equal(select?.gateway?.status, "completed", `${variant}: select_products reached the Gateway`);
    const rows = await queryRows<{ capability_name: string; execution_status: string }>("SELECT capability_name, execution_status FROM crm_capability_executions WHERE correlation_id = ? ORDER BY id ASC", [turn.correlationId]);
    assert.deepEqual(rows.map((row) => row.capability_name), ["get_product_details", "select_products"], `${variant}: Gateway audit rows`);
    assert.deepEqual(turn.durableStateAfterTurn?.selection.items, [{ productId: "31", quantity: 2 }], `${variant}: K01 durable selection`);
  }
});

test("P7.9: same autonomous harness, prompt, model config and initial state for every variant - the tool contract is the only difference", async () => {
  const bundle = await offlineBundle();
  for (const caseId of CASES) {
    const records = ISOLATION_VARIANT_IDS.map((variant) => run(bundle, caseId, variant));
    const config = (record: (typeof records)[number]) => {
      const c = record.runConfig;
      return JSON.stringify({ model: c.model, temperature: c.temperature, thinking: c.thinking, timeoutMs: c.timeoutMs, maxOutputTokens: c.maxOutputTokens, maxModelRetries: c.maxModelRetries, promptVersion: c.promptVersion, promptSha256: c.promptSha256 });
    };
    assert.equal(new Set(records.map(config)).size, 1, `${caseId}: identical model/prompt/config`);
    const shape = (state: NonNullable<(typeof records)[number]["trace"]>["initialState"]) => JSON.stringify({ s: state?.selection.present, items: state?.selection.items, d: state?.destination.present, q: state?.quote.present, i: state?.identityLevel, w: state?.workStatus });
    assert.equal(new Set(records.map((record) => shape(record.trace!.initialState))).size, 1, `${caseId}: same initial durable state`);
    assert.equal(new Set(records.map((record) => record.runConfig.toolContractSha16)).size, ISOLATION_VARIANT_IDS.length, `${caseId}: every variant carries a different tool contract`);
    assert.equal(new Set(records.map((record) => record.trace!.turns[0].correlationId)).size, ISOLATION_VARIANT_IDS.length, "durable state is never shared between variants");
  }
  for (const variant of ISOLATION_VARIANT_IDS) assert.equal(run(bundle, "M01", variant).runConfig.toolContractSha16.length, 16);
  assert.equal(run(bundle, "M01", "B0_CURRENT").runConfig.toolContractSha16 === run(bundle, "M01", "B6_FULL_THIN").runConfig.toolContractSha16, false);
  // the seeded selection scenario really starts from the seeded durable state in every variant
  for (const variant of ISOLATION_VARIANT_IDS) assert.deepEqual(run(bundle, "K05", variant).trace!.initialState?.selection.items, [{ productId: "31", quantity: 1 }]);
});

test("P7.9: Q-, Q+ and negative turns are classified with their own semantics (scripted behavior: asks quantity / commits / informs)", async () => {
  const bundle = await offlineBundle();
  for (const variant of ISOLATION_VARIANT_IDS) {
    const [m] = analyzeIsolationRun(run(bundle, "M01", variant));
    assert.equal(m.scenarioGroup, "Q-");
    assert.equal(m.replyClass, "CORRECT_QUANTITY_REQUEST");
    assert.equal(m.asksQuantity && m.grounded && m.progressAfterGrounding && m.progressFixed && !m.selectAttempted && !m.assumedQuantity, true);
    const [k] = analyzeIsolationRun(run(bundle, "K01", variant));
    assert.equal(k.scenarioGroup, "Q+");
    assert.equal(k.selectCompleted && k.progressFixed && k.progressAfterGrounding && k.durableSelectionAfterTurn && k.qPlusFailureMode === null && !k.wrongQuantity && !k.wrongProduct, true);
    const [k5] = analyzeIsolationRun(run(bundle, "K05", variant));
    assert.deepEqual(run(bundle, "K05", variant).trace!.turns[0].durableStateAfterTurn?.selection.items, [{ productId: "32", quantity: 2 }], "full replacement of the seeded selection");
    assert.equal(k5.selectCompleted && !k5.wrongProduct && !k5.wrongQuantity, true);
    const [i] = analyzeIsolationRun(run(bundle, "I01", variant));
    assert.equal(i.scenarioGroup, "NEG");
    assert.equal(i.replyClass, "PRODUCT_INFORMATION");
    assert.equal(i.mutationRequested.length, 0);
    assert.equal(i.progressFixed, false, "negatives have no progress notion");
  }
});

test("P7.9: comparison denominators are per group and identical across variants; the pooled aggregate is only a summary", async () => {
  const bundle = await offlineBundle();
  for (const variant of ISOLATION_VARIANT_IDS) {
    const m = bundle.summary[variant];
    assert.deepEqual([m.qMinus.turns, m.qPlus.turns, m.negatives.turns], [1, 2, 1]);
    assert.equal(m.qMinus.explicitQuantityRequestRate.denominator, 1);
    assert.equal(m.qPlus.commitRate.denominator, 2);
    assert.equal(m.qMinus.commercialProgressAfterGroundingRate.denominator, m.qMinus.groundedTurns);
    assert.equal(m.aggregate.commercialProgressAfterGroundingRate.denominator, m.qMinus.groundedTurns + m.qPlus.groundedTurns);
    assert.equal(m.aggregate.commercialProgressFixedCohortRate.denominator, 3);
    assert.equal(m.harnessFailures, 0);
    assert.equal(m.negatives.overMutationRate.numerator, 0);
  }
  assert.equal(bundle.comparison.dataQuality.sufficient, false, "1 run of 4 scenarios is below the minimum turns per group");
});

test("P7.9: artifacts - the six files, the arm per run, contract matrix per variant, manifest with freeze hashes, detector, corpus and execution order", async () => {
  const bundle = await offlineBundle();
  const files = buildIsolationArtifactFiles(bundle);
  assert.deepEqual(Object.keys(files).sort(), ["comparison.json", "contract-matrix.json", "failures.json", "manifest.json", "runs.jsonl", "summary.json"]);
  const lines = files["runs.jsonl"].split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 28);
  for (const line of lines) {
    assert.ok((ISOLATION_VARIANT_IDS as readonly string[]).includes(line.variant));
    assert.equal(line.runConfig.variant, line.variant);
    assert.ok(Array.isArray(line.turnAnalyses));
  }
  assert.equal(files["runs.jsonl"].includes("requestMessages"), false, "no full prompts in artifacts");
  const manifest = JSON.parse(files["manifest.json"]);
  assert.equal(manifest.phase, "P7.9");
  assert.equal(manifest.plan.length, 28);
  assert.deepEqual(Object.keys(manifest.freezeHashes).sort(), Object.keys(FREEZE_FILE_GROUPS).sort());
  assert.equal(manifest.detector.version, "p7.9-reply-detector-v1");
  assert.equal(manifest.detector.sha256, sha256File("lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/replyClassifier.ts"));
  assert.equal(manifest.corpus.version, "r3-p7-9.v1");
  assert.deepEqual(Object.keys(manifest.variants), [...ISOLATION_VARIANT_IDS]);
  const matrix = JSON.parse(files["contract-matrix.json"]);
  assert.deepEqual(Object.keys(matrix.variants), [...ISOLATION_VARIANT_IDS]);
  assert.equal(matrix.variants.B0_CURRENT.totalChars, buildIsolationSurface("B0_CURRENT").stats.totalChars);
  for (const key of ["replication", "signals", "promotion", "deltasVsB0", "dataQuality"]) assert.ok(JSON.parse(files["comparison.json"])[key], key);
});

test("P7.9: freeze hashes are stable, LF-normalised, cover prompt/loop/adapter/corpus/analyzer/fixture/detector, and a changed file is detected", () => {
  const a = computeFreezeHashes();
  assert.deepEqual(a, computeFreezeHashes());
  for (const group of ["autonomousPrompt", "autonomousLoop", "gatewayAdapter", "corpus", "analyzer", "initialFixtureBuilder", "detector"]) assert.ok(Object.keys(a[group]).length > 0, group);
  const tampered = JSON.parse(JSON.stringify(a)) as typeof a;
  tampered.corpus[Object.keys(tampered.corpus)[0]] = "0".repeat(64);
  assert.deepEqual(diffFreeze(tampered, a), [`corpus:${Object.keys(a.corpus)[0]}`]);
  assert.deepEqual(diffFreeze(a, a), []);
});

test("P7.9: static - the isolation orchestration reuses the P7.8-R true harness only (no R3 loop, no own executor, no DB/service access from the model path)", () => {
  const DIR = join(process.cwd(), "lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation");
  const importsOf = (source: string) => [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  for (const file of ["runIsolation.ts", "isolationSurfaces.ts", "isolationCorpus.ts", "isolationAnalysis.ts", "replyClassifier.ts"]) {
    const source = readFileSync(join(DIR, file), "utf8");
    for (const specifier of importsOf(source)) for (const pattern of [/runAgentToolLoop/, /buildAgentStepPromptPackage/, /validateAgentStep/, /agentStepTypes/, /sales-agent-runtime/, /commercial-proposal/, /capability-gateway\/repository/]) assert.equal(pattern.test(specifier), false, `${file} must not import ${specifier}`);
    assert.equal(/executeGovernedCapability|\.execute\(/.test(source.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), false, `${file} never executes a capability itself`);
  }
  const runner = readFileSync(join(DIR, "runIsolation.ts"), "utf8");
  assert.ok(importsOf(runner).includes("../r3TrueAB/runTrueHarnessCase"), "every variant goes through runTrueHarnessCase (own loop -> Capability Gateway)");
  assert.ok(/arm: entry\.variant,\s*surface,/.test(runner), "the surface is the only per-variant input to the harness");
});

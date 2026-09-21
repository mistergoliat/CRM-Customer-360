import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { analyzeSemanticsRun } from "@/lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/semanticsAnalysis";
import { SEMANTICS_VARIANT_IDS, buildSemanticsSurface } from "@/lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/semanticsSurfaces";
import { buildSemanticsArtifactFiles, classifierGoldenReport, computeFreezeHashes, diffFreeze, FREEZE_FILE_GROUPS, runSemantics, sha256File, type SemanticsBundle } from "@/lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/runSemantics";

/**
 * SALES-AGENT-R3-P7.10. DB-backed, OFFLINE (scripted native model, no LLM) tests against the real
 * Capability Gateway and crm_test. They prove WIRING: same harness/config/state for S0, S1 and S2,
 * the Gateway used, classification per speech act, denominators, artifacts and freeze hashes.
 * Behavior is measured live.
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

const CASES = ["D01", "IM01", "N01", "F01", "F02", "R01"];
const VARIANTS = SEMANTICS_VARIANT_IDS.length;
let bundlePromise: Promise<SemanticsBundle> | null = null;
function offlineBundle(): Promise<SemanticsBundle> {
  bundlePromise ??= (async () => {
    const result = await runSemantics({ mode: "offline", runsPerScenario: 1, caseIds: CASES });
    assert.equal(result.ok, true, "MariaDB crm_test must be reachable for these tests");
    if (!result.ok) throw new Error("environment blocked");
    return result.bundle;
  })();
  return bundlePromise;
}
const run = (bundle: SemanticsBundle, caseId: string, variant: string) => bundle.runs.find((candidate) => candidate.caseId === caseId && candidate.variant === variant)!;

test("P7.10: every variant (S0, S1, S2) of every scenario runs through the real Capability Gateway (non-null outcome AND an audit row per tool call)", async () => {
  const bundle = await offlineBundle();
  assert.equal(VARIANTS, 3);
  assert.equal(bundle.runs.length, CASES.length * VARIANTS);
  assert.equal(bundle.runs.every((record) => record.harnessError === null), true);
  for (const variant of SEMANTICS_VARIANT_IDS) {
    const turn = run(bundle, "D01", variant).trace!.turns[0];
    const select = turn.toolInvocations.find((invocation) => invocation.capability === "select_products");
    assert.equal(select?.gateway?.status, "completed", `${variant}: select_products reached the Gateway`);
    const rows = await queryRows<{ capability_name: string; execution_status: string }>("SELECT capability_name, execution_status FROM crm_capability_executions WHERE correlation_id = ? ORDER BY id ASC", [turn.correlationId]);
    assert.deepEqual(rows.map((row) => row.capability_name), ["get_product_details", "select_products"], `${variant}: Gateway audit rows`);
    assert.deepEqual(turn.durableStateAfterTurn?.selection.items, [{ productId: "31", quantity: 2 }], `${variant}: D01 durable selection`);
  }
});

test("P7.10: same autonomous harness, prompt, model config and initial state for S0, S1 and S2 - the select_products prose is the only difference", async () => {
  const bundle = await offlineBundle();
  for (const caseId of CASES) {
    const records = SEMANTICS_VARIANT_IDS.map((variant) => run(bundle, caseId, variant));
    const config = (record: (typeof records)[number]) => {
      const c = record.runConfig;
      return JSON.stringify({ model: c.model, temperature: c.temperature, thinking: c.thinking, timeoutMs: c.timeoutMs, maxOutputTokens: c.maxOutputTokens, maxModelRetries: c.maxModelRetries, promptVersion: c.promptVersion, promptSha256: c.promptSha256 });
    };
    assert.equal(new Set(records.map(config)).size, 1, `${caseId}: identical model/prompt/config`);
    const shape = (state: NonNullable<(typeof records)[number]["trace"]>["initialState"]) => JSON.stringify({ s: state?.selection.present, items: state?.selection.items, d: state?.destination.present, q: state?.quote.present, i: state?.identityLevel, w: state?.workStatus });
    assert.equal(new Set(records.map((record) => shape(record.trace!.initialState))).size, 1, `${caseId}: same initial durable state`);
    assert.equal(new Set(records.map((record) => record.runConfig.toolContractSha16)).size, 3, `${caseId}: the three contracts differ`);
    assert.equal(new Set(records.map((record) => record.trace!.turns[0].correlationId)).size, 3, "durable state is never shared between variants");
  }
  // the seeded selection scenario starts from the seeded durable state in every variant
  for (const variant of SEMANTICS_VARIANT_IDS) assert.deepEqual(run(bundle, "R01", variant).trace!.initialState?.selection.items, [{ productId: "31", quantity: 2 }]);
  // the contract each run used is exactly the S0/S1/S2 surface
  for (const variant of SEMANTICS_VARIANT_IDS) {
    const surface = buildSemanticsSurface(variant);
    assert.equal(run(bundle, "D01", variant).runConfig.toolContractSha16.length, 16);
    assert.equal(run(bundle, "D01", variant).promptStats?.toolContractChars, surface.stats.totalChars, `${variant}: the run's contract size is the surface's`);
  }
});

test("P7.10: D / I / N / F / R turns are classified with their own semantics (scripted behavior: selects / informs)", async () => {
  const bundle = await offlineBundle();
  for (const variant of SEMANTICS_VARIANT_IDS) {
    const [d] = analyzeSemanticsRun(run(bundle, "D01", variant));
    assert.deepEqual([d.group, d.actionable, d.selectCompleted, d.durableSelection, d.correctDurable, d.category, d.confirmationClass, d.residual], ["D", true, true, true, true, "SELECTION_SUCCESS", "ACTION_EXECUTED", null]);
    const [i] = analyzeSemanticsRun(run(bundle, "IM01", variant));
    assert.deepEqual([i.group, i.selectCompleted, i.category], ["I", true, "SELECTION_SUCCESS"]);
    const [n] = analyzeSemanticsRun(run(bundle, "N01", variant));
    assert.deepEqual([n.group, n.actionable, n.overMutationAny, n.category], ["N", false, false, "CONTROL_OK"]);
    const [f1] = analyzeSemanticsRun(run(bundle, "F01", variant));
    assert.deepEqual([f1.actionable, f1.expectedItems, f1.category], [true, [{ productId: "31", quantity: 2 }], "SELECTION_SUCCESS"], "F01: the scripted context reply names exactly one product");
    const [f2] = analyzeSemanticsRun(run(bundle, "F02", variant));
    assert.equal(f2.category, "SELECTION_SUCCESS");
    const [r] = analyzeSemanticsRun(run(bundle, "R01", variant));
    assert.deepEqual(run(bundle, "R01", variant).trace!.turns[0].durableStateAfterTurn?.selection.items, [{ productId: "32", quantity: 1 }], "full replacement of the seeded selection");
    assert.deepEqual([r.correctDurable, r.category], [true, "SELECTION_SUCCESS"]);
  }
});

test("P7.10: per-speech-act denominators are identical across variants, the ACTIONABLE pool is only a summary, and speechActGap is computed per variant", async () => {
  const bundle = await offlineBundle();
  for (const variant of SEMANTICS_VARIANT_IDS) {
    const m = bundle.summary[variant];
    assert.deepEqual([m.bySpeechAct.D.turns, m.bySpeechAct.I.turns, m.bySpeechAct.Q.turns, m.bySpeechAct.F.turns, m.bySpeechAct.R.turns, m.informational.turns], [1, 1, 0, 2, 1, 1]);
    assert.equal(m.actionable.turns, 5);
    assert.equal(m.actionable.selectionRate.denominator, 5);
    assert.equal(m.bySpeechAct.D.selectionRate.denominator, 1);
    assert.equal(m.harnessFailures, 0);
    assert.equal(m.informational.informationalOverMutationRate.numerator, 0);
    assert.equal(m.speechActGapPp, 0, "scripted I and D both select: gap 0");
    assert.deepEqual(Object.keys(m.bySpeechAct.D.residuals).sort(), ["INFORMATIONAL_CLOSE", "OTHER", "PRODUCT_REQUESTION", "QUANTITY_REQUESTION", "UNNECESSARY_CONFIRMATION"]);
  }
  assert.deepEqual(bundle.comparison.speechActGap.deltaByStepPp, { S0_to_S1: 0, S1_to_S2: 0, S0_to_S2: 0 });
  assert.equal(bundle.comparison.dataQuality.sufficient, false, "1 run of 6 scenarios is below the minimum D turns");
  assert.ok(["REVERSIBLE_SEMANTICS_SUPPORTED", "CONSEQUENCE_STATEMENT_SUFFICIENT", "DISTRIBUTED_SEMANTIC_CONTRADICTION_SUPPORTED", "SEMANTICS_NOT_CAUSAL", "PARTIAL_SEMANTIC_EFFECT"].includes(bundle.comparison.signal.signal));
});

test("P7.10: artifacts - the six files, variant/speech act/scenario/product/quantity/initial state per run, manifest with hashes for S0/S1/S2, classifier golden, corpus and execution order", async () => {
  const bundle = await offlineBundle();
  const files = buildSemanticsArtifactFiles(bundle);
  assert.deepEqual(Object.keys(files).sort(), ["classifier-golden.json", "comparison.json", "failures.json", "manifest.json", "runs.jsonl", "summary.json"]);
  const lines = files["runs.jsonl"].split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, CASES.length * VARIANTS);
  for (const line of lines) {
    assert.ok((SEMANTICS_VARIANT_IDS as readonly string[]).includes(line.variant));
    assert.equal(line.runConfig.variant, line.variant);
    assert.ok(Array.isArray(line.turnAnalyses));
    assert.ok(["declarative_desire", "imperative", "quote_action", "informational_negative", "follow_up", "replacement"].includes(line.scenario.speechAct));
    assert.ok("expected" in line.scenario && "initialSelection" in line.scenario);
  }
  assert.deepEqual(lines.find((line) => line.caseId === "R01" && line.variant === "S2_COHERENT_REVERSIBLE_SEMANTICS").scenario.initialSelection, [{ productId: "31", quantity: 2 }]);
  assert.equal(files["runs.jsonl"].includes("requestMessages"), false, "no full prompts in artifacts");
  const manifest = JSON.parse(files["manifest.json"]);
  assert.equal(manifest.phase, "P7.10");
  assert.equal(manifest.plan.length, CASES.length * VARIANTS);
  assert.deepEqual(Object.keys(manifest.freezeHashes).sort(), [...Object.keys(FREEZE_FILE_GROUPS), "contracts", "signal"].sort());
  assert.deepEqual(Object.keys(manifest.freezeHashes.contracts).sort(), ["S0:select_products", "S0:select_products.schema", "S0:tools", "S1:select_products", "S1:select_products.schema", "S1:tools", "S2:select_products", "S2:select_products.schema", "S2:tools"]);
  assert.deepEqual(Object.keys(manifest.freezeHashes.signal).sort(), ["rule", "thresholds"]);
  assert.equal(manifest.classifier.version, "p7.10-confirmation-classifier-v1");
  assert.equal(manifest.classifier.sha256, sha256File("lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/confirmationClassifier.ts"));
  assert.equal(manifest.classifier.goldenDiscrepancies, 0);
  assert.ok(manifest.classifier.goldenEntries >= 70);
  assert.equal(manifest.corpus.version, "r3-p7-10.v1");
  assert.deepEqual(Object.keys(manifest.variants), [...SEMANTICS_VARIANT_IDS]);
  assert.equal(manifest.harness.systemPromptSha16.length, 16);
  assert.deepEqual(Object.keys(manifest.contracts.rows), [...SEMANTICS_VARIANT_IDS]);
  assert.equal(new Set(Object.values(manifest.contracts.rows as Record<string, { selectProductsSchemaChars: number }>).map((row) => row.selectProductsSchemaChars)).size, 1);
  const golden = JSON.parse(files["classifier-golden.json"]);
  assert.equal(golden.discrepancies, 0);
  const comparison = JSON.parse(files["comparison.json"]);
  for (const key of ["signal", "signalRule", "steps", "deltasByStep", "speechActGap", "perSpeechAct", "declarativeResiduals", "sensitivityDExcludingFlagged", "dataQuality", "exploratory"]) assert.ok(comparison[key], key);
  assert.deepEqual(Object.keys(comparison.deltasByStep), ["S0_to_S1", "S1_to_S2", "S0_to_S2"]);
});

test("P7.10: the golden report has 0 discrepancies and freeze hashes are stable, LF-normalised, cover prompt/loop/S0-S1-S2 contracts/schema/corpus/classifier/analyzer/fixtures/signal thresholds, and a changed file, contract or threshold is detected", () => {
  assert.equal(classifierGoldenReport().discrepancies, 0);
  const a = computeFreezeHashes();
  assert.deepEqual(a, computeFreezeHashes());
  for (const group of ["autonomousPrompt", "autonomousLoop", "contractBuilders", "corpus", "classifier", "analyzer", "fixtures", "contracts", "signal"]) assert.ok(Object.keys(a[group]).length > 0, group);
  const tampered = JSON.parse(JSON.stringify(a)) as typeof a;
  tampered.corpus[Object.keys(tampered.corpus)[0]] = "0".repeat(64);
  tampered.contracts["S2:tools"] = "0".repeat(64);
  tampered.signal.thresholds = "0".repeat(64);
  assert.deepEqual(diffFreeze(tampered, a), [`corpus:${Object.keys(a.corpus)[0]}`, "contracts:S2:tools", "signal:thresholds"]);
  assert.deepEqual(diffFreeze(a, a), []);
});

test("P7.10: static - the orchestration reuses the P7.8-R true harness only (no R3 loop, no P4/P5/P6, no own executor, no DB/service access from the model path)", () => {
  const DIR = join(process.cwd(), "lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics");
  const importsOf = (source: string) => [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  for (const file of ["runSemantics.ts", "semanticsSurfaces.ts", "semanticsCorpus.ts", "semanticsAnalysis.ts", "confirmationClassifier.ts"]) {
    const source = readFileSync(join(DIR, file), "utf8");
    for (const specifier of importsOf(source)) for (const pattern of [/runAgentToolLoop/, /buildAgentStepPromptPackage/, /validateAgentStep/, /agentStepTypes/, /sales-agent-runtime/, /commercial-proposal/, /capability-gateway\/repository/, /objective-reconciliation|agent-turn-input|eligibility/i]) assert.equal(pattern.test(specifier), false, `${file} must not import ${specifier}`);
    assert.equal(/executeGovernedCapability|\.execute\(/.test(source.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), false, `${file} never executes a capability itself`);
  }
  const runner = readFileSync(join(DIR, "runSemantics.ts"), "utf8");
  assert.ok(importsOf(runner).includes("../r3TrueAB/runTrueHarnessCase"), "every variant goes through runTrueHarnessCase (own loop -> Capability Gateway)");
  assert.ok(/arm: entry\.variant,\s*surface,/.test(runner), "the surface is the only per-variant input to the harness");
});

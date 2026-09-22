import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { analyzeReplicationRun } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConfirmationBoundary/analysis";
import { buildReplicationSurface, REPLICATION_VARIANT_IDS } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConfirmationBoundary/surfaces";
import { buildReplicationArtifactFiles, computeFreezeHashes, diffFreeze, REPLICATION_FREEZE_FILE_GROUPS, runReplication, type ReplicationBundle } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConfirmationBoundary/run";

/**
 * SALES-AGENT-R3-P7.11. DB-backed, OFFLINE (scripted native model, no LLM) tests against the real
 * Capability Gateway and crm_test. They prove WIRING: same harness/config/state for R0 and R1, the
 * Gateway used, classification per group, denominators, artifacts and freeze hashes. Behavior is
 * measured live (script + docs/audits/r3-p7-11-...).
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

const CASES = ["P11A01", "P11B01", "P11C01", "P11D01", "P11E01", "P11F01"];
const VARIANTS = REPLICATION_VARIANT_IDS.length;
let bundlePromise: Promise<ReplicationBundle> | null = null;
function offlineBundle(): Promise<ReplicationBundle> {
  bundlePromise ??= (async () => {
    const result = await runReplication({ mode: "offline", runsPerScenario: 1, caseIds: CASES });
    assert.equal(result.ok, true, "MariaDB crm_test must be reachable for these tests");
    if (!result.ok) throw new Error("environment blocked");
    return result.bundle;
  })();
  return bundlePromise;
}
const run = (bundle: ReplicationBundle, caseId: string, variant: string) => bundle.runs.find((candidate) => candidate.caseId === caseId && candidate.variant === variant)!;

test("P7.11: every variant (R0, R1) of every scenario runs through the real Capability Gateway (non-null outcome AND an audit row per tool call)", async () => {
  const bundle = await offlineBundle();
  assert.equal(VARIANTS, 2);
  assert.equal(bundle.runs.length, CASES.length * VARIANTS);
  assert.equal(bundle.runs.every((record) => record.harnessError === null), true);
  for (const variant of REPLICATION_VARIANT_IDS) {
    const turn = run(bundle, "P11A01", variant).trace!.turns[0];
    const select = turn.toolInvocations.find((invocation) => invocation.capability === "select_products");
    assert.equal(select?.gateway?.status, "completed", `${variant}: select_products reached the Gateway`);
    const rows = await queryRows<{ capability_name: string; execution_status: string }>("SELECT capability_name, execution_status FROM crm_capability_executions WHERE correlation_id = ? ORDER BY id ASC", [turn.correlationId]);
    assert.deepEqual(rows.map((row) => row.capability_name), ["get_product_details", "select_products"], `${variant}: Gateway audit rows`);
    assert.deepEqual(turn.durableStateAfterTurn?.selection.items, [{ productId: "31", quantity: 2 }], `${variant}: P11A01 durable selection`);
  }
});

test("P7.11: same autonomous harness, prompt, model config and initial state for R0 and R1 - the select_products prose is the only difference", async () => {
  const bundle = await offlineBundle();
  for (const caseId of CASES) {
    const records = REPLICATION_VARIANT_IDS.map((variant) => run(bundle, caseId, variant));
    const config = (record: (typeof records)[number]) => JSON.stringify({ model: record.runConfig.model, temperature: record.runConfig.temperature, thinking: record.runConfig.thinking, timeoutMs: record.runConfig.timeoutMs, maxOutputTokens: record.runConfig.maxOutputTokens, maxModelRetries: record.runConfig.maxModelRetries, promptVersion: record.runConfig.promptVersion, promptSha256: record.runConfig.promptSha256 });
    assert.equal(new Set(records.map(config)).size, 1, `${caseId}: identical model/prompt/config`);
    const shape = (state: NonNullable<(typeof records)[number]["trace"]>["initialState"]) => JSON.stringify({ s: state?.selection.present, items: state?.selection.items, d: state?.destination.present, q: state?.quote.present, i: state?.identityLevel, w: state?.workStatus });
    assert.equal(new Set(records.map((record) => shape(record.trace!.initialState))).size, 1, `${caseId}: same initial durable state`);
    assert.equal(new Set(records.map((record) => record.runConfig.toolContractSha16)).size, 2, `${caseId}: the two contracts differ`);
    assert.equal(new Set(records.map((record) => record.trace!.turns[0].correlationId)).size, 2, "durable state is never shared between variants");
  }
  for (const variant of REPLICATION_VARIANT_IDS) assert.deepEqual(run(bundle, "P11F01", variant).trace!.initialState?.selection.items, [{ productId: "31", quantity: 2 }]);
  for (const variant of REPLICATION_VARIANT_IDS) {
    const surface = buildReplicationSurface(variant);
    assert.equal(run(bundle, "P11A01", variant).runConfig.toolContractSha16.length, 16);
    assert.equal(run(bundle, "P11A01", variant).promptStats?.toolContractChars, surface.stats.totalChars, `${variant}: the run's contract size is the surface's`);
  }
});

test("P7.11: A / B / C / D / E / F turns are classified with their own semantics (scripted behavior: selects / informs); group B's product is resolved from turn text, never the assistant reply", async () => {
  const bundle = await offlineBundle();
  for (const variant of REPLICATION_VARIANT_IDS) {
    const [a1] = analyzeReplicationRun(run(bundle, "P11A01", variant));
    assert.deepEqual([a1.group, a1.actionable, a1.selectCompleted, a1.durableSelection, a1.correctDurable, a1.category], ["A", true, true, true, true, "SELECTION_SUCCESS"]);
    const bTurns = analyzeReplicationRun(run(bundle, "P11B01", variant));
    assert.equal(bTurns.length, 1, "only the last (analysed) turn of a B scenario is annotated");
    assert.deepEqual([bTurns[0].group, bTurns[0].actionable, bTurns[0].expectedItems, bTurns[0].category], ["B", true, [{ productId: "31", quantity: 2 }], "SELECTION_SUCCESS"]);
    const [c1] = analyzeReplicationRun(run(bundle, "P11C01", variant));
    assert.deepEqual([c1.group, c1.selectCompleted, c1.category], ["C", true, "SELECTION_SUCCESS"]);
    const [d1] = analyzeReplicationRun(run(bundle, "P11D01", variant));
    assert.deepEqual([d1.group, d1.selectCompleted, d1.quoteProgress, d1.category], ["D", true, true, "SELECTION_SUCCESS"]);
    const [e1] = analyzeReplicationRun(run(bundle, "P11E01", variant));
    assert.deepEqual([e1.group, e1.actionable, e1.overMutationAny, e1.category], ["E", false, false, "CONTROL_OK"]);
    const [f1] = analyzeReplicationRun(run(bundle, "P11F01", variant));
    assert.deepEqual(run(bundle, "P11F01", variant).trace!.turns[0].durableStateAfterTurn?.selection.items, [{ productId: "32", quantity: 1 }], "full replacement of the seeded selection");
    assert.deepEqual([f1.correctDurable, f1.category], [true, "SELECTION_SUCCESS"]);
  }
});

test("P7.11: per-group denominators are identical across variants, the ACTIONABLE pool is only a summary, and multiTurn aliases the B block", async () => {
  const bundle = await offlineBundle();
  for (const variant of REPLICATION_VARIANT_IDS) {
    const m = bundle.summary[variant];
    assert.deepEqual([m.byGroup.A.turns, m.byGroup.B.turns, m.byGroup.C.turns, m.byGroup.D.turns, m.byGroup.F.turns, m.informational.turns], [1, 1, 1, 1, 1, 1]);
    assert.equal(m.actionable.turns, 5);
    assert.equal(m.actionable.selectionRate.denominator, 5);
    assert.equal(m.harnessFailures, 0);
    assert.equal(m.informational.informationalOverMutationRate.numerator, 0);
    assert.deepEqual(m.multiTurn.selectionAfterFactsCompleteRate, m.byGroup.B.selectionRate, "multiTurn.selectionAfterFactsCompleteRate aliases byGroup.B.selectionRate");
    assert.deepEqual(m.multiTurn.confirmationAfterFactsCompleteRate, m.byGroup.B.unnecessaryConfirmationRate, "multiTurn.confirmationAfterFactsCompleteRate aliases byGroup.B.unnecessaryConfirmationRate");
  }
  assert.equal(bundle.comparison.dataQuality.sufficient, false, "1 run of 6 scenarios is well below the minimum group A turns");
  assert.ok(["S1_REPLICATED_AND_GENERALIZES", "S1_REPLICATED", "S1_PARTIAL_REPLICATION", "S1_NOT_REPLICATED"].includes(bundle.comparison.signal.signal));
});

test("P7.11: artifacts - the six files, variant/group/scenario/product/quantity/initial state per run, manifest with hashes for R0/R1, classifier golden, corpus and execution order", async () => {
  const bundle = await offlineBundle();
  const files = buildReplicationArtifactFiles(bundle);
  assert.deepEqual(Object.keys(files).sort(), ["classifier-golden.json", "comparison.json", "failures.json", "manifest.json", "runs.jsonl", "summary.json"]);
  const lines = files["runs.jsonl"].split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, CASES.length * VARIANTS);
  for (const line of lines) {
    assert.ok((REPLICATION_VARIANT_IDS as readonly string[]).includes(line.variant));
    assert.equal(line.runConfig.variant, line.variant);
    assert.ok(Array.isArray(line.turnAnalyses));
    assert.ok(["direct_declarative_actionable", "multi_turn_intent_completion", "imperative_explicit_action", "quote_oriented", "informational_negative", "correction_replacement"].includes(line.scenario.group));
    assert.ok("expected" in line.scenario && "initialSelection" in line.scenario);
  }
  assert.deepEqual(lines.find((line) => line.caseId === "P11F01" && line.variant === "R1_CONSEQUENCE_STATEMENT").scenario.initialSelection, [{ productId: "31", quantity: 2 }]);
  assert.equal(files["runs.jsonl"].includes("requestMessages"), false, "no full prompts in artifacts");
  const manifest = JSON.parse(files["manifest.json"]);
  assert.equal(manifest.phase, "P7.11");
  assert.equal(manifest.plan.length, CASES.length * VARIANTS);
  assert.deepEqual(Object.keys(manifest.freezeHashes).sort(), [...Object.keys(REPLICATION_FREEZE_FILE_GROUPS), "contracts", "signal"].sort());
  assert.deepEqual(Object.keys(manifest.freezeHashes.contracts).sort(), ["S0:select_products", "S0:tools", "S1:select_products", "S1:tools"]);
  assert.deepEqual(Object.keys(manifest.freezeHashes.signal), ["thresholds"]);
  assert.equal(manifest.classifier.goldenDiscrepancies, 0);
  assert.ok(manifest.classifier.goldenEntries >= 70);
  assert.equal(manifest.corpus.version, "r3-p7-11.v1");
  assert.deepEqual(Object.keys(manifest.variants), [...REPLICATION_VARIANT_IDS]);
  assert.equal(manifest.harness.systemPromptSha16.length, 16);
  const golden = JSON.parse(files["classifier-golden.json"]);
  assert.equal(golden.discrepancies, 0);
  const comparison = JSON.parse(files["comparison.json"]);
  for (const key of ["signal", "deltas", "perGroup", "residuals", "dataQuality"]) assert.ok(comparison[key], key);
});

test("P7.11: freeze hashes are stable, LF-normalised, cover prompt/loop/R0-R1 contracts/schema/corpus/classifier/analyzer/fixtures/signal thresholds, and a changed file/contract/threshold is detected", () => {
  const a = computeFreezeHashes();
  assert.deepEqual(a, computeFreezeHashes());
  for (const group of ["autonomousPrompt", "autonomousLoop", "contractBuilders", "corpus", "classifier", "analyzer", "fixtures", "contracts", "signal"]) assert.ok(Object.keys(a[group]).length > 0, group);
  const tampered = JSON.parse(JSON.stringify(a)) as typeof a;
  tampered.corpus[Object.keys(tampered.corpus)[0]] = "0".repeat(64);
  tampered.contracts["S1:tools"] = "0".repeat(64);
  tampered.signal.thresholds = "0".repeat(64);
  assert.deepEqual(diffFreeze(tampered, a), [`corpus:${Object.keys(a.corpus)[0]}`, "contracts:S1:tools", "signal:thresholds"]);
  assert.deepEqual(diffFreeze(a, a), []);
});

test("P7.11: static - the orchestration reuses the P7.8-R/P7.10 true harness only (no R3 loop, no P4/P5/P6, no own executor); R0/R1 route through runTrueHarnessCase exactly like P7.10 S0/S1", () => {
  const runner = readSource("run.ts");
  for (const pattern of [/runAgentToolLoop/, /buildAgentStepPromptPackage/, /validateAgentStep/, /agentStepTypes/, /sales-agent-runtime/, /commercial-proposal/, /capability-gateway\/repository/, /objective-reconciliation|agent-turn-input|eligibility/i]) assert.equal(pattern.test(runner), false, `run.ts must not import ${pattern}`);
  assert.ok(/from\s+["']\.\.\/r3TrueAB\/runTrueHarnessCase["']/.test(runner), "every variant goes through runTrueHarnessCase (own loop -> Capability Gateway)");
  assert.ok(/arm: entry\.variant,\s*surface,/.test(runner), "the surface is the only per-variant input to the harness");
});

function readSource(file: string): string {
  return readFileSync(join(process.cwd(), "lib/brain/commercial/agent-loop/benchmark/r3ConfirmationBoundary", file), "utf8");
}

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { buildAbArtifactFiles, buildAbPlan, runAutonomousAB, type AbBundle } from "@/lib/brain/commercial/agent-loop/benchmark/r3AutonomousAB/runAutonomousAB";
import { buildP78AbCorpus, P78_AB_CORPUS_VERSION, P78_NEGATIVE_CONTROL_CASE_IDS, P78_PRIMARY_CASE_IDS } from "@/lib/brain/commercial/agent-loop/benchmark/r3AutonomousAB/abCorpus";
import { BENCHMARK_E2E_CORPUS } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/corpus";

/**
 * SALES-AGENT-R3-P7.8. DB-backed, OFFLINE (scripted provider, no LLM) tests of
 * the A/B runner against the real R3 cycle in crm_test - same discipline as
 * tests/agent-loop/benchmark/r3CommercialE2E/runCommercialE2ECorpus.test.ts.
 * The scripted provider ignores the prompt, so these prove WIRING (variant
 * flags, Gateway path, identity gate, durable state, artifacts), not model
 * behavior - behavior is what the live run measures.
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

test("P7.8: the corpus is exactly the P7.7 primary cohort (by reference, unmodified) plus N01-N04", () => {
  assert.deepEqual(CORPUS.map((testCase) => testCase.caseId), [...P78_PRIMARY_CASE_IDS, ...P78_NEGATIVE_CONTROL_CASE_IDS]);
  for (const id of P78_PRIMARY_CASE_IDS) assert.strictEqual(CORPUS.find((testCase) => testCase.caseId === id), BENCHMARK_E2E_CORPUS.find((testCase) => testCase.caseId === id), `${id} must be the very same E2E case object`);
  const n01 = CORPUS.find((testCase) => testCase.caseId === "N01")!;
  assert.equal(n01.turns[0].customerMessage, "¿Cuánto cuesta la barra Classic?");
  assert.equal(CORPUS.find((testCase) => testCase.caseId === "N04")!.turns[0].customerMessage, "¿Cuál me recomiendas?");
  // section 11/12 run counts: 6 primary x3 x2 = 36; 4 controls x3 x2 = 24
  assert.equal(buildAbPlan(P78_PRIMARY_CASE_IDS, 3).length, 36);
  assert.equal(buildAbPlan(P78_NEGATIVE_CONTROL_CASE_IDS, 3).length, 24);
});

test("P7.8-21: the plan is deterministic, interleaved (A/B adjacent per pair) and counterbalanced (first mover alternates)", () => {
  const plan = buildAbPlan(["E02", "N01"], 3);
  assert.deepEqual(plan, buildAbPlan(["E02", "N01"], 3), "no unrecorded randomness");
  assert.equal(plan.length, 12);
  for (let index = 0; index < plan.length; index += 2) {
    assert.equal(plan[index].pairId, plan[index + 1].pairId, "both variants of a pair run back to back");
    assert.notEqual(plan[index].variant, plan[index + 1].variant);
    assert.equal(plan[index].firstInPair, true);
    assert.equal(plan[index + 1].firstInPair, false);
  }
  assert.deepEqual(plan.slice(0, 4).map((entry) => `${entry.pairId}:${entry.variant}`), ["E02-r0:A_HYBRID", "E02-r0:B_AUTONOMOUS", "E02-r1:B_AUTONOMOUS", "E02-r1:A_HYBRID"]);
  assert.equal(plan.filter((entry) => entry.variant === "A_HYBRID").length, 6);
  assert.equal(plan.filter((entry) => entry.variant === "B_AUTONOMOUS").length, 6);
  assert.deepEqual(plan.map((entry) => entry.sequenceIndex), plan.map((_, index) => index));
});

let bundlePromise: Promise<AbBundle> | null = null;
function offlineBundle(): Promise<AbBundle> {
  bundlePromise ??= (async () => {
    const result = await runAutonomousAB({ mode: "offline", runsPerCase: 1, corpus: pick("E02", "E12", "N01"), corpusVersion: P78_AB_CORPUS_VERSION });
    assert.equal(result.ok, true, "MariaDB crm_test must be reachable for these tests");
    if (!result.ok) throw new Error("environment blocked");
    return result.bundle;
  })();
  return bundlePromise;
}

const byVariant = (bundle: AbBundle, caseId: string, variant: string) => bundle.runs.find((run) => run.caseId === caseId && run.variant === variant)!;

test("P7.8-E: A and B start from equivalent durable state and are configured identically except for the cognitive layer", async () => {
  const bundle = await offlineBundle();
  assert.equal(bundle.runs.length, 6);
  for (const caseId of ["E02", "E12", "N01"]) {
    const a = byVariant(bundle, caseId, "A_HYBRID");
    const b = byVariant(bundle, caseId, "B_AUTONOMOUS");
    const shape = (state: NonNullable<typeof a.trace>["initialState"]) => ({ selection: state?.selection.present, destination: state?.destination.present, quote: state?.quote.present, identity: state?.identityLevel, workStatus: state?.workStatus, workVersion: state?.workVersion });
    assert.deepEqual(shape(a.trace!.initialState), shape(b.trace!.initialState), `${caseId}: same initial fixture semantics`);
    assert.notEqual(a.trace!.turns[0].correlationId, b.trace!.turns[0].correlationId, "durable state is never shared between variants");

    const { variant: _va, promptVersion: _pa, promptSha256: _ha, eligibilityInfluencedCognition: _ea, flags: fa, ...sharedA } = a.runConfig;
    const { variant: _vb, promptVersion: _pb, promptSha256: _hb, eligibilityInfluencedCognition: _eb, flags: fb, ...sharedB } = b.runConfig;
    assert.deepEqual(sharedA, sharedB, "model/temperature/thinking/timeout/retries/tokens/budgets are identical");
    const differing = (Object.keys(fa) as (keyof typeof fa)[]).filter((key) => fa[key] !== fb[key]).sort();
    assert.deepEqual(differing, ["capabilityEligibilityInputEnabled", "commercialObjectiveReconciliationEnabled", "commercialProposalShadowEnabled"]);
  }
});

test("P7.8-F: the variant, effective flags and prompt version are captured per run and in the manifest/artifacts", async () => {
  const bundle = await offlineBundle();
  const files = buildAbArtifactFiles(bundle);
  assert.deepEqual(Object.keys(files).sort(), ["comparison.json", "failures.json", "manifest.json", "runs.jsonl", "summary.json"]);
  const lines = files["runs.jsonl"].split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 6);
  for (const line of lines) {
    assert.ok(["A_HYBRID", "B_AUTONOMOUS"].includes(line.variant));
    assert.equal(line.runConfig.variant, line.variant);
    assert.equal(line.runConfig.promptVersion, line.variant === "A_HYBRID" ? "hybrid-current@P7.7" : "p7.8-autonomous-v1");
    assert.equal(typeof line.runConfig.flags.openTurnExecutionEnabled, "boolean");
    assert.ok(Array.isArray(line.turnAnalyses));
  }
  assert.equal(files["runs.jsonl"].includes("requestMessages"), false, "raw prompts/customer text are not persisted");
  const manifest = JSON.parse(files["manifest.json"]);
  assert.equal(manifest.phase, "P7.8");
  assert.equal(manifest.variants.B_AUTONOMOUS.effectiveFlags.commercialProposalShadowEnabled, false);
  assert.equal(manifest.variants.A_HYBRID.effectiveFlags.commercialProposalShadowEnabled, true);
  assert.deepEqual([...manifest.flagDifferencesBetweenVariants].sort(), ["capabilityEligibilityInputEnabled", "commercialObjectiveReconciliationEnabled", "commercialProposalShadowEnabled"]);
  assert.equal(manifest.plan.length, 6);
  assert.ok(manifest.notReproducibleInHarness.some((note: string) => note.includes("live_turn_assimilation")), "live assimilation is marked NOT_REPRODUCIBLE_IN_HARNESS for both variants");
  const comparison = JSON.parse(files["comparison.json"]);
  assert.ok(comparison.architectureSignal.signal);
  assert.ok(comparison.complexity.B.autonomousSpecificCodeLines);
  const summary = JSON.parse(files["summary.json"]);
  assert.deepEqual(Object.keys(summary).sort(), ["A_HYBRID", "B_AUTONOMOUS"]);
});

test("P7.8-A/J/I: under B the tool call goes through the real Gateway, durable state is captured, the final response is captured and P4 is not requested", async () => {
  const bundle = await offlineBundle();
  const b = byVariant(bundle, "E02", "B_AUTONOMOUS");
  const turn = b.trace!.turns[0];
  const select = turn.toolInvocations.find((invocation) => invocation.capability === "select_products");
  assert.ok(select, "select_products was requested");
  assert.equal(select!.gateway?.status, "completed", "a non-null gateway outcome exists only when executeGovernedCapability ran");
  assert.equal(turn.durableStateAfterTurn?.selection.present, true, "J: durable selection captured");
  assert.deepEqual(turn.durableStateAfterTurn?.selection.items, [{ productId: "31", quantity: 1 }]);
  assert.ok(turn.response.finalMessage && turn.response.finalMessage.length > 0, "I: final response captured");
  // (outbox writing needs BRAIN_AUTONOMOUS_RESPONSES_ENABLED=true, set for the live batch - not asserted in this offline wiring test)
  assert.equal(turn.proposal, null, "B does not ask the model for a CommercialProposal");
  assert.equal(turn.objectiveReconciliation.decided, null, "P5 does not run in B");
});

test("P7.8-B: B cannot bypass identity - create_quote under an anonymous session is denied by the Gateway identity gate, no quote exists", async () => {
  const bundle = await offlineBundle();
  const b = byVariant(bundle, "E12", "B_AUTONOMOUS");
  const quote = b.trace!.turns[0].toolInvocations.find((invocation) => invocation.capability === "create_quote");
  assert.ok(quote, "create_quote was requested");
  const denial = new Set(["master_identity_required", "identity_context_unavailable", "identity_requirement_unresolved"]);
  assert.ok(denial.has(quote!.gateway?.errorCode ?? "") || denial.has(quote!.toolObservation.errorCode ?? ""), `identity gate must deny (got ${quote!.gateway?.errorCode}/${quote!.toolObservation.errorCode})`);
  assert.equal(b.trace!.finalState?.quote.present, false);
  assert.equal(quote!.toolObservation.status === "completed", false);
});

test("P7.8: prompt statistics are captured per run and B's system prompt is smaller than A's", async () => {
  const bundle = await offlineBundle();
  const a = byVariant(bundle, "E02", "A_HYBRID");
  const b = byVariant(bundle, "E02", "B_AUTONOMOUS");
  assert.ok(a.promptStats && b.promptStats);
  assert.ok(b.promptStats!.systemPromptChars < a.promptStats!.systemPromptChars);
  assert.notEqual(a.runConfig.promptSha256, b.runConfig.promptSha256);
  assert.equal(a.promptStats!.toolCatalogChars, b.promptStats!.toolCatalogChars, "same tool catalog");
});

test("P7.8-L: negative control N01 is analyzed as informational and the scripted informational answer is not over-mutation", async () => {
  const bundle = await offlineBundle();
  for (const variant of ["A_HYBRID", "B_AUTONOMOUS"] as const) {
    const run = byVariant(bundle, "N01", variant);
    assert.equal(run.isNegativeControl, true);
    assert.equal(bundle.summary[variant].negativeControls.informationalTurns, 1);
    assert.equal(bundle.summary[variant].negativeControls.overMutation.numerator, 0);
  }
});

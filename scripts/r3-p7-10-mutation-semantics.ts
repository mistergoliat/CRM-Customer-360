/**
 * SALES-AGENT-R3-P7.10 (Mutation Semantics & Confirmation Boundary). Three model-facing
 * select_products semantics variants (S0 current / S1 consequence statement / S2 coherent reversible semantics) through the SAME
 * P7.8-R true autonomous harness, interleaved. R3 does not participate.
 * Writes manifest/runs/summary/comparison/failures/classifier-golden to benchmark-results/<run-id>/.
 *
 * REQUIRES NODE_ENV=test and the local crm_test database. Never production. Live only with
 * BENCHMARK_LIVE_LLM_ENABLED=true AND --mode=live, and with the P7.8-R model overrides:
 *   BENCHMARK_E2E_CATALOG_QUERY_AWARE=true BENCHMARK_E2E_THINKING=disabled
 *   BENCHMARK_E2E_MODEL_TIMEOUT_MS=60000 BENCHMARK_E2E_MAX_OUTPUT_TOKENS=4000 BENCHMARK_E2E_MAX_MODEL_RETRIES=5
 *
 *   ... --mode=live --smoke --write-freeze=<file>            # smoke, then record the freeze hashes
 *   ... --mode=live --runs=3 --freeze=<file>                 # full batch (refuses to start if a frozen file changed)
 *   ... --mode=live --plan-only                              # prints the execution plan, runs nothing
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSemanticsArtifactFiles, buildSemanticsPlan, classifierGoldenReport, computeFreezeHashes, diffFreeze, interleavedScenarioIds, runSemantics } from "../lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/runSemantics";
import { SEMANTICS_VARIANT_IDS } from "../lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/semanticsSurfaces";
import { resetPoolForTests } from "../lib/db";
import { assertConnectedToCrmTest, assertLocalTestEnv, loadLocalBenchmarkEnv, printGate } from "./p7-10-env-gate";

const ARTIFACT_ROOT = join(process.cwd(), "benchmark-results");
const REQUIRED_LIVE_ENV: Record<string, string> = {
  BENCHMARK_LIVE_LLM_ENABLED: "true",
  BENCHMARK_E2E_CATALOG_QUERY_AWARE: "true",
  BENCHMARK_E2E_THINKING: "disabled",
  BENCHMARK_E2E_MODEL_TIMEOUT_MS: "60000",
  BENCHMARK_E2E_MAX_OUTPUT_TOKENS: "4000",
  BENCHMARK_E2E_MAX_MODEL_RETRIES: "5"
};
/** Smoke: 1 declarative, 1 imperative, 1 informational negative, 1 follow-up (product fixed by the user turn) x S0/S1/S2, once = 12 runs. */
const SMOKE_CASE_IDS = ["D01", "IM01", "N01", "F02"];

function parseArgs(argv: string[]) {
  const args = new Map(argv.filter((arg) => arg.startsWith("--")).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length > 0 ? rest.join("=") : "true"] as const;
  }));
  const runs = Number.parseInt(args.get("runs") ?? "1", 10);
  return {
    mode: (args.get("mode") === "live" ? "live" : "offline") as "offline" | "live",
    smoke: args.get("smoke") === "true",
    planOnly: args.get("plan-only") === "true",
    runsPerScenario: Number.isFinite(runs) && runs > 0 ? runs : 1,
    cases: args.get("cases")?.split(",").map((id) => id.trim()).filter((id) => id.length > 0) ?? null,
    freeze: args.get("freeze") ?? null,
    writeFreeze: args.get("write-freeze") ?? null,
    label: args.get("label") ?? null
  };
}

const fmt = (value: { numerator: number; denominator: number }) => `${value.numerator}/${value.denominator}`;

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const caseIds = args.cases ?? (args.smoke ? SMOKE_CASE_IDS : interleavedScenarioIds());
    const runsPerScenario = args.smoke ? 1 : args.runsPerScenario;

    if (args.planOnly) {
      const plan = buildSemanticsPlan(caseIds, runsPerScenario);
      console.log(JSON.stringify({ runs: plan.length, first9: plan.slice(0, 9), variantsLeading: Object.fromEntries(SEMANTICS_VARIANT_IDS.map((variant) => [variant, plan.filter((entry) => entry.positionInGroup === 0 && entry.variant === variant).length])) }, null, 2));
      return;
    }
    // Local-only gate: load the project .env (it wins over the shell), then ABORT unless NODE_ENV=test, the database is exactly
    // the local crm_test and every external side effect is off. Prints only NODE_ENV/host/port/database (never a secret).
    await loadLocalBenchmarkEnv();
    printGate(assertLocalTestEnv());
    if (args.mode === "live") {
      const wrong =Object.entries(REQUIRED_LIVE_ENV).filter(([key, value]) => process.env[key]?.trim().toLowerCase() !== value);
      if (wrong.length > 0) {
        console.error(`refusing to run: P7.8-R parity env missing/different: ${wrong.map(([key, value]) => `${key}=${value}`).join(" ")}`);
        process.exitCode = 1;
        return;
      }
    }
    const golden = classifierGoldenReport();
    if (golden.discrepancies > 0) {
      console.error(`refusing to run: the confirmation classifier disagrees with ${golden.discrepancies} golden entries (0 required before the freeze).`);
      process.exitCode = 1;
      return;
    }
    if (args.freeze) {
      const changed = diffFreeze(JSON.parse(readFileSync(args.freeze, "utf8")), computeFreezeHashes());
      if (changed.length > 0) {
        console.error(`refusing to run: frozen files/contracts changed since the smoke: ${changed.join(", ")}`);
        process.exitCode = 1;
        return;
      }
      console.log("freeze verified: harness, prompt, contracts, corpus, classifier, analyzer and fixture hashes match the smoke.");
    }
    if (args.writeFreeze) {
      writeFileSync(args.writeFreeze, JSON.stringify(computeFreezeHashes(), null, 2), "utf8");
      console.log(`freeze hashes written to ${args.writeFreeze}`);
    }

    console.log(`P7.10 mutation semantics - ${args.mode}, ${caseIds.length} scenario(s) x ${runsPerScenario} run(s) x ${SEMANTICS_VARIANT_IDS.length} variants = ${caseIds.length * runsPerScenario * SEMANTICS_VARIANT_IDS.length} runs.`);
    console.log(`SELECT DATABASE() before the run = ${(await assertConnectedToCrmTest()).database}`);
    const result = await runSemantics({
      mode: args.mode,
      runsPerScenario,
      caseIds,
      onRunFinished: (record, total) => console.log(`[${record.sequenceIndex + 1}/${total}] ${record.caseId} r${record.runOrdinal} ${record.variant} ${record.harnessError ? `HARNESS_ERROR ${record.harnessError}` : `ok turns=${record.trace?.turns.length ?? 0}`}`)
    });
    if (!result.ok) {
      console.error("ENVIRONMENT_BLOCKED: MariaDB is unreachable - nothing was run or scored.");
      console.error(JSON.stringify(result.environmentHealth, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(`SELECT DATABASE() after the run  = ${(await assertConnectedToCrmTest()).database}`);
    const runId = `p7-10-${String(result.bundle.manifest.startedAt).replace(/[:.]/g, "-")}-${args.mode}${args.smoke ? "-smoke" : args.cases ? "-partial" : ""}${args.label ? `-${args.label}` : ""}`;
    const runDir = join(ARTIFACT_ROOT, runId);
    mkdirSync(runDir, { recursive: true });
    for (const [fileName, content] of Object.entries(buildSemanticsArtifactFiles(result.bundle))) writeFileSync(join(runDir, fileName), content, "utf8");

    // Only the aggregate outcome lines here; the preregistered signal is computed in comparison.json and traces are inspected AFTER it (task section 30).
    console.log("");
    for (const variant of SEMANTICS_VARIANT_IDS) {
      const m = result.bundle.summary[variant];
      console.log(`${variant.padEnd(34)} D-select=${fmt(m.bySpeechAct.D.selectionRate)} D-unnecessaryConfirmation=${fmt(m.bySpeechAct.D.unnecessaryConfirmationRate)} I-select=${fmt(m.bySpeechAct.I.selectionRate)} N-overMutation=${fmt(m.informational.informationalOverMutationRate)} harnessFailures=${m.harnessFailures}`);
    }
    const comparison = result.bundle.comparison;
    console.log(`preregistered signal: ${comparison.signal.signal} (${comparison.signal.reason}); data sufficient: ${comparison.signal.dataSufficient}`);
    console.log(`\nArtifacts written to: ${runDir}`);
  } finally {
    await resetPoolForTests();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error("P7.10 benchmark crashed unexpectedly:", error);
    process.exitCode = 1;
  });
}

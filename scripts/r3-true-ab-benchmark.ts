/**
 * SALES-AGENT-R3-P7.8-R (True Harness & Capability Tax). Three arms through the
 * same cases/fixtures/model configuration, interleaved:
 *   A  = R3 current            (runAgentToolLoop, hybrid prompt, P4/P5/P6.3)
 *   B  = true autonomous harness + CURRENT tool contract
 *   C1 = true autonomous harness + THIN tool contract (quantity still required)
 * Writes manifest/runs/summary/failures/comparison to benchmark-results/<run-id>/.
 *
 * REQUIRES NODE_ENV=test and the local crm_test database (enforced by
 * setupR3BenchmarkEnvironment). Never production. Live only with BOTH
 * BENCHMARK_LIVE_LLM_ENABLED=true and --mode=live.
 *
 *   NODE_ENV=test npx tsx --env-file=.env scripts/r3-true-ab-benchmark.ts --mode=live --smoke      # E02, E15, N01 x1 x3 arms (9 runs)
 *   NODE_ENV=test npx tsx --env-file=.env scripts/r3-true-ab-benchmark.ts --mode=live --runs=3     # full: 10 cases x3 x3 arms (90 runs)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildP78AbCorpus } from "../lib/brain/commercial/agent-loop/benchmark/r3AutonomousAB/abCorpus";
import { buildTrueArtifactFiles, runTrueAB } from "../lib/brain/commercial/agent-loop/benchmark/r3TrueAB/runTrueAB";
import { TRUE_ARM_IDS } from "../lib/brain/commercial/agent-loop/benchmark/r3TrueAB/trueAnalysis";
import { resetPoolForTests } from "../lib/db";

const ARTIFACT_ROOT = join(process.cwd(), "benchmark-results");

function parseArgs(argv: string[]) {
  const args = new Map(argv.filter((arg) => arg.startsWith("--")).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? "true"] as const;
  }));
  const smoke = args.get("smoke") === "true";
  const runs = Number.parseInt(args.get("runs") ?? "1", 10);
  const casesRaw = args.get("cases");
  return {
    mode: (args.get("mode") === "live" ? "live" : "offline") as "offline" | "live",
    runsPerCase: smoke ? 1 : Number.isFinite(runs) && runs > 0 ? runs : 1,
    caseFilter: smoke ? ["E02", "E15", "N01"] : casesRaw ? casesRaw.split(",").map((id) => id.trim()).filter((id) => id.length > 0) : null
  };
}

const fmt = (value: { numerator: number; denominator: number }) => `${value.numerator}/${value.denominator}`;

async function main() {
  try {
    const { mode, runsPerCase, caseFilter } = parseArgs(process.argv.slice(2));
    const fullCorpus = buildP78AbCorpus();
    const corpus = caseFilter ? fullCorpus.filter((testCase) => caseFilter.includes(testCase.caseId)) : fullCorpus;
    const missing = (caseFilter ?? []).filter((id) => !fullCorpus.some((testCase) => testCase.caseId === id));
    if (missing.length > 0) {
      console.error(`unknown caseId(s): ${missing.join(", ")}`);
      process.exitCode = 1;
      return;
    }
    console.log(`P7.8-R true A/B/C1 - ${mode}, ${runsPerCase} run(s)/case/arm, ${corpus.length} case(s) => ${corpus.length * runsPerCase * 3} runs.`);
    const result = await runTrueAB({
      mode,
      runsPerCase,
      corpus,
      onRunFinished: (record, total) => console.log(`[${record.sequenceIndex + 1}/${total}] ${record.caseId} r${record.runOrdinal} ${record.arm} ${record.harnessError ? `HARNESS_ERROR ${record.harnessError}` : `ok turns=${record.trace?.turns.length ?? 0}`}`)
    });
    if (!result.ok) {
      console.error("ENVIRONMENT_BLOCKED: MariaDB is unreachable - nothing was run or scored.");
      console.error(JSON.stringify(result.environmentHealth, null, 2));
      process.exitCode = 1;
      return;
    }
    const runId = `true-ab-${String(result.bundle.manifest.startedAt).replace(/[:.]/g, "-")}-${mode}${caseFilter === null ? "" : "-partial"}`;
    const runDir = join(ARTIFACT_ROOT, runId);
    mkdirSync(runDir, { recursive: true });
    for (const [fileName, content] of Object.entries(buildTrueArtifactFiles(result.bundle))) writeFileSync(join(runDir, fileName), content, "utf8");

    console.log("");
    for (const arm of TRUE_ARM_IDS) {
      const m = result.bundle.summary[arm];
      console.log(`${arm.padEnd(22)} progress(grounded)=${fmt(m.commercialProgressAfterGroundingRate)} progress(fixed)=${fmt(m.commercialProgressFixedCohortRate)} commitAfterGrounding=${fmt(m.commitAfterGroundingRate)} overMutation=${fmt(m.negativeControls.overMutation)} harnessFailures=${m.harnessFailures}`);
    }
    console.log(`signal (candidate): ${result.bundle.comparison.architectureSignal.signal}`);
    console.log(`\nArtifacts written to: ${runDir}`);
  } finally {
    await resetPoolForTests();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error("P7.8-R benchmark crashed unexpectedly:", error);
    process.exitCode = 1;
  });
}

/**
 * SALES-AGENT-R3-P7.8 (Autonomous Harness A/B). Runs the P7.7 primary cohort
 * (E02/E04/E05/E07/E14/E15) plus the informational negative controls
 * (N01-N04) under two cognitive layers - A: hybrid R3, B: minimal autonomous
 * harness - through the SAME real native R3 cycle, interleaved, and writes
 * manifest/runs/summary/failures/comparison to benchmark-results/<ab-run-id>/.
 *
 * REQUIRES NODE_ENV=test and the local crm_test database (enforced by
 * setupR3BenchmarkEnvironment). Never production. Live only with BOTH
 * BENCHMARK_LIVE_LLM_ENABLED=true and --mode=live.
 *
 * Usage:
 *   NODE_ENV=test npx tsx scripts/r3-autonomous-ab-benchmark.ts --mode=live --smoke     # E02 + N01, 1 run each, A and B (4 runs)
 *   NODE_ENV=test npx tsx scripts/r3-autonomous-ab-benchmark.ts --mode=live --runs=3    # full batch (60 runs)
 *   NODE_ENV=test npx tsx scripts/r3-autonomous-ab-benchmark.ts --mode=offline --cases=E02,N01
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildP78AbCorpus, P78_AB_CORPUS_VERSION } from "../lib/brain/commercial/agent-loop/benchmark/r3AutonomousAB/abCorpus";
import { buildAbArtifactFiles, runAutonomousAB } from "../lib/brain/commercial/agent-loop/benchmark/r3AutonomousAB/runAutonomousAB";
import { resetPoolForTests } from "../lib/db";

const ARTIFACT_ROOT = join(process.cwd(), "benchmark-results");

function parseArgs(argv: string[]) {
  const args = new Map(
    argv
      .filter((arg) => arg.startsWith("--"))
      .map((arg) => {
        const [key, value] = arg.replace(/^--/, "").split("=");
        return [key, value ?? "true"] as const;
      })
  );
  const smoke = args.get("smoke") === "true";
  const runs = Number.parseInt(args.get("runs") ?? "1", 10);
  const casesRaw = args.get("cases");
  return {
    mode: (args.get("mode") === "live" ? "live" : "offline") as "offline" | "live",
    runsPerCase: smoke ? 1 : Number.isFinite(runs) && runs > 0 ? runs : 1,
    caseFilter: smoke ? ["E02", "N01"] : casesRaw ? casesRaw.split(",").map((id) => id.trim()).filter((id) => id.length > 0) : null
  };
}

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

    console.log(`P7.8 A/B - ${mode}, ${runsPerCase} run(s)/case/variant, ${corpus.length} case(s) => ${corpus.length * runsPerCase * 2} runs.`);
    const result = await runAutonomousAB({
      mode,
      runsPerCase,
      corpus,
      corpusVersion: P78_AB_CORPUS_VERSION,
      onRunFinished: (record, total) => {
        const turns = record.trace?.turns.length ?? 0;
        console.log(`[${record.sequenceIndex + 1}/${total}] ${record.caseId} r${record.runOrdinal} ${record.variant} ${record.harnessError ? `HARNESS_ERROR ${record.harnessError}` : `ok turns=${turns}`}`);
      }
    });
    if (!result.ok) {
      console.error("ENVIRONMENT_BLOCKED: MariaDB is unreachable - nothing was run or scored.");
      console.error(JSON.stringify(result.environmentHealth, null, 2));
      process.exitCode = 1;
      return;
    }

    const runId = `ab-${result.bundle.manifest.startedAt.replace(/[:.]/g, "-")}-${mode}${caseFilter === null ? "" : "-partial"}`;
    const runDir = join(ARTIFACT_ROOT, runId);
    mkdirSync(runDir, { recursive: true });
    for (const [fileName, content] of Object.entries(buildAbArtifactFiles(result.bundle))) writeFileSync(join(runDir, fileName), content, "utf8");

    const { A_HYBRID: a, B_AUTONOMOUS: b } = result.bundle.summary;
    console.log(`\ncommitAfterGrounding  A=${a.primary.commitAfterGroundingRate.numerator}/${a.primary.commitAfterGroundingRate.denominator}  B=${b.primary.commitAfterGroundingRate.numerator}/${b.primary.commitAfterGroundingRate.denominator}`);
    console.log(`durableCommit         A=${a.primary.durableCommitAfterGroundingRate.numerator}/${a.primary.durableCommitAfterGroundingRate.denominator}  B=${b.primary.durableCommitAfterGroundingRate.numerator}/${b.primary.durableCommitAfterGroundingRate.denominator}`);
    console.log(`overMutation          A=${a.negativeControls.overMutation.numerator}/${a.negativeControls.overMutation.denominator}  B=${b.negativeControls.overMutation.numerator}/${b.negativeControls.overMutation.denominator}`);
    console.log(`harnessFailures       A=${a.harnessFailures}  B=${b.harnessFailures}`);
    console.log(`signal (candidate)    ${result.bundle.comparison.architectureSignal.signal}`);
    console.log(`\nArtifacts written to: ${runDir}`);
  } finally {
    await resetPoolForTests();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error("P7.8 A/B benchmark crashed unexpectedly:", error);
    process.exitCode = 1;
  });
}

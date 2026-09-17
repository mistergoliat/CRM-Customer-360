/**
 * SALES-AGENT-R3-P7.4 (E2E Benchmark Harness Integration). Runs the new
 * commercial-outcome corpus (lib/brain/commercial/agent-loop/benchmark/
 * r3CommercialE2E/corpus.ts, 15 cases) through the REAL native R3 cycle
 * (runSalesAgentRuntimeCycle - kernel, DRM/eligibility, provider/Agent Tool
 * Loop/Gateway, P4 proposal, P5 reconciliation, terminal dispatch/outbox),
 * writing a manifest/runs/summary/failures artifact bundle to
 * benchmark-results/<run-id>/.
 *
 * REQUIRES: NODE_ENV=test and DB_* pointed at the local crm_test database -
 * this is enforced by setupR3BenchmarkEnvironment's own safety gate
 * (assertCrmTestDurableFixtureIsSafe), never main_management, never
 * production. Never runs live unless BENCHMARK_LIVE_LLM_ENABLED=true AND
 * --mode=live are both given (same double-gate discipline as
 * r3-stable-agent-benchmark.ts).
 *
 * Usage:
 *   NODE_ENV=test npx tsx scripts/r3-commercial-e2e-benchmark.ts                     # offline, 1 run/case (15 runs)
 *   NODE_ENV=test npx tsx scripts/r3-commercial-e2e-benchmark.ts --runs=3            # offline, 3 runs/case (45 runs - the P7.5 batch)
 *   NODE_ENV=test BENCHMARK_LIVE_LLM_ENABLED=true npx tsx scripts/r3-commercial-e2e-benchmark.ts --mode=live --runs=3
 *   NODE_ENV=test npx tsx scripts/r3-commercial-e2e-benchmark.ts --case=E09          # only this case, all other flags unchanged
 *
 * This script does not itself decide whether a 45-run batch "passed" -
 * see docs/R3_COMMERCIAL_AGENT_HANDOFF.md's P7.4 section for how to read
 * ENVIRONMENT_BLOCKED vs a real per-case failure. P7.5 is the phase that
 * draws conclusions from a real batch's results.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BENCHMARK_E2E_CORPUS, BENCHMARK_E2E_CORPUS_VERSION } from "../lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/corpus";
import { runCommercialE2ECorpus } from "../lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/runCommercialE2ECorpus";
import { buildArtifactFiles } from "../lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/artifacts";

const ARTIFACT_ROOT = join(process.cwd(), "benchmark-results");

function parseArgs(argv: string[]) {
  const args = new Map(
    argv
      .filter((arg) => arg.startsWith("--"))
      .map((arg) => {
        const [key, value] = arg.replace(/^--/, "").split("=");
        return [key, value ?? "true"];
      })
  );
  const mode = args.get("mode") === "live" ? "live" : "offline";
  const runs = Number.parseInt(args.get("runs") ?? "1", 10);
  const caseFilterRaw = args.get("case");
  const caseFilter = caseFilterRaw ? caseFilterRaw.split(",").map((id) => id.trim()).filter((id) => id.length > 0) : null;
  return { mode: mode as "offline" | "live", runsPerCase: Number.isFinite(runs) && runs > 0 ? runs : 1, caseFilter };
}

async function main() {
  const { mode, runsPerCase, caseFilter } = parseArgs(process.argv.slice(2));

  let corpus = BENCHMARK_E2E_CORPUS;
  if (caseFilter) {
    const caseFilterSet = new Set(caseFilter);
    corpus = BENCHMARK_E2E_CORPUS.filter((testCase) => caseFilterSet.has(testCase.caseId));
    const missing = caseFilter.filter((id) => !BENCHMARK_E2E_CORPUS.some((testCase) => testCase.caseId === id));
    if (missing.length > 0) {
      console.error(`--case referenced unknown caseId(s): ${missing.join(", ")}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`R3 Commercial E2E Benchmark - ${mode} mode, ${runsPerCase} run(s)/case, ${corpus.length} case(s).`);

  const result = await runCommercialE2ECorpus({ mode, runsPerCase, corpus, corpusVersion: BENCHMARK_E2E_CORPUS_VERSION });
  if (!result.ok) {
    console.error("ENVIRONMENT_BLOCKED: MariaDB is unreachable - no case was run, nothing was scored as a model failure.");
    console.error(JSON.stringify(result.environmentHealth, null, 2));
    process.exitCode = 1;
    return;
  }

  const runId = `${result.bundle.manifest.startedAt.replace(/[:.]/g, "-")}-${mode}`;
  const runDir = join(ARTIFACT_ROOT, runId);
  mkdirSync(runDir, { recursive: true });

  const files = buildArtifactFiles(result.bundle);
  for (const [fileName, content] of Object.entries(files)) {
    writeFileSync(join(runDir, fileName), content, "utf8");
  }

  console.log(`environmentHealth.status=${result.bundle.manifest.environmentHealth.status}`);
  console.log(`runCompletionRate=${result.bundle.summary.runCompletionRate}`);
  console.log(`failures=${result.bundle.failures.length}`);
  console.log(`\nArtifacts written to: ${runDir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error("R3 Commercial E2E Benchmark crashed unexpectedly:", error);
    process.exitCode = 1;
  });
}

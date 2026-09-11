/**
 * R3 Stable Agent Acceptance Harness V1 (task sections 4/7). Runs the frozen
 * golden case set (lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/corpus.ts)
 * against either the deterministic offline scripted provider (default, CI-safe)
 * or a real live DeepSeek call (explicit opt-in only), and writes the
 * JSON+MD artifact pair to artifacts/benchmarks/r3-stable-agent-v1/.
 *
 * Usage:
 *   npx tsx scripts/r3-stable-agent-benchmark.ts                    # offline, 1 run/case
 *   npx tsx scripts/r3-stable-agent-benchmark.ts --runs=3           # offline, 3 runs/case
 *   BENCHMARK_LIVE_LLM_ENABLED=true npx tsx scripts/r3-stable-agent-benchmark.ts --mode=live --runs=3
 *
 * Never runs live unless BENCHMARK_LIVE_LLM_ENABLED=true AND --mode=live are
 * both given - same explicit double-gate discipline liveProvider.ts already
 * establishes (see resolveLiveBenchmarkProviderConfig).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { R3_STABLE_AGENT_V1_CORPUS } from "../lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/corpus";
import { validateGoldenCorpus } from "../lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/validateCorpus";
import { runGoldenSuite } from "../lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/runGoldenSuite";
import { buildGoldenReport, renderGoldenReportMarkdown } from "../lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/report";
import { resolveLiveBenchmarkProviderConfig } from "../lib/brain/commercial/agent-loop/benchmark/liveProvider";

const ARTIFACT_DIR = join(process.cwd(), "artifacts", "benchmarks", "r3-stable-agent-v1");

export function parseArgs(argv: string[]) {
  const args = new Map(argv.filter((arg) => arg.startsWith("--")).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? "true"];
  }));
  const mode = args.get("mode") === "live" ? "live" : "offline";
  const runs = Number.parseInt(args.get("runs") ?? (mode === "live" ? "3" : "1"), 10);
  return { mode: mode as "offline" | "live", runsPerCase: Number.isFinite(runs) && runs > 0 ? runs : 1 };
}

async function main() {
  const { mode, runsPerCase } = parseArgs(process.argv.slice(2));

  const validation = validateGoldenCorpus(R3_STABLE_AGENT_V1_CORPUS);
  if (!validation.ok) {
    console.error("Golden corpus failed validation:");
    for (const error of validation.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  let summary;
  if (mode === "offline") {
    console.log(`R3 Stable Agent Acceptance Harness V1 - offline mode, ${runsPerCase} run(s)/case, ${R3_STABLE_AGENT_V1_CORPUS.length} cases.`);
    summary = await runGoldenSuite(R3_STABLE_AGENT_V1_CORPUS, { mode: "offline", runsPerCase });
  } else {
    const resolution = resolveLiveBenchmarkProviderConfig();
    if (!resolution.ok) {
      console.error(`LIVE_BASELINE_NOT_EXECUTED: live benchmark disabled or unconfigured (${resolution.reason}).`);
      console.error("Set BENCHMARK_LIVE_LLM_ENABLED=true and ensure BRAIN_MODEL_API_URL/BRAIN_MODEL_API_KEY/BRAIN_MODEL_NAME are set.");
      process.exitCode = 1;
      return;
    }
    console.log(`R3 Stable Agent Acceptance Harness V1 - live mode, model=${resolution.config.model}, ${runsPerCase} run(s)/case, ${R3_STABLE_AGENT_V1_CORPUS.length} cases.`);
    summary = await runGoldenSuite(R3_STABLE_AGENT_V1_CORPUS, { mode: "live", runsPerCase, liveConfig: resolution.config });
  }

  const report = buildGoldenReport(summary);
  const markdown = renderGoldenReportMarkdown(report);

  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const timestamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = join(ARTIFACT_DIR, `${timestamp}.json`);
  const mdPath = join(ARTIFACT_DIR, `${timestamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(mdPath, markdown, "utf8");

  console.log(markdown);
  console.log(`\nArtifacts written:\n  ${jsonPath}\n  ${mdPath}`);

  if (report.aggregateMetrics.falseCommercialConfirmationCount > 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error("R3 Stable Agent Acceptance Harness V1 benchmark crashed unexpectedly:", error);
    process.exitCode = 1;
  });
}

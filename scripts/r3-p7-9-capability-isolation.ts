/**
 * SALES-AGENT-R3-P7.9 (Capability Contract Isolation). Seven model-facing tool-contract
 * variants (B0..B6) through the SAME P7.8-R true autonomous harness, interleaved.
 * Writes manifest/runs/summary/comparison/failures/contract-matrix to benchmark-results/<run-id>/.
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
import { buildIsolationArtifactFiles, buildIsolationPlan, computeFreezeHashes, diffFreeze, interleavedScenarioIds, runIsolation } from "../lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/runIsolation";
import { ISOLATION_VARIANT_IDS } from "../lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/isolationSurfaces";
import { resetPoolForTests } from "../lib/db";

const ARTIFACT_ROOT = join(process.cwd(), "benchmark-results");
const REQUIRED_LIVE_ENV: Record<string, string> = {
  BENCHMARK_LIVE_LLM_ENABLED: "true",
  BENCHMARK_E2E_CATALOG_QUERY_AWARE: "true",
  BENCHMARK_E2E_THINKING: "disabled",
  BENCHMARK_E2E_MODEL_TIMEOUT_MS: "60000",
  BENCHMARK_E2E_MAX_OUTPUT_TOKENS: "4000",
  BENCHMARK_E2E_MAX_MODEL_RETRIES: "5"
};

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
    // Smoke (task section 20): Q- / Q+ / negative scenario x B0..B6 once. (B0/B6 first, then one scenario each for B1-B5 is covered by the same 7-variant group.)
    const caseIds = args.cases ?? (args.smoke ? ["M01", "K01", "I01"] : interleavedScenarioIds());
    const runsPerScenario = args.smoke ? 1 : args.runsPerScenario;

    if (args.planOnly) {
      const plan = buildIsolationPlan(caseIds, runsPerScenario);
      console.log(JSON.stringify({ runs: plan.length, first14: plan.slice(0, 14), variantsLeading: Object.fromEntries(ISOLATION_VARIANT_IDS.map((variant) => [variant, plan.filter((entry) => entry.positionInGroup === 0 && entry.variant === variant).length])) }, null, 2));
      return;
    }
    if (args.mode === "live") {
      const wrong = Object.entries(REQUIRED_LIVE_ENV).filter(([key, value]) => process.env[key]?.trim().toLowerCase() !== value);
      if (wrong.length > 0) {
        console.error(`refusing to run: P7.8-R parity env missing/different: ${wrong.map(([key, value]) => `${key}=${value}`).join(" ")}`);
        process.exitCode = 1;
        return;
      }
    }
    if (args.freeze) {
      const changed = diffFreeze(JSON.parse(readFileSync(args.freeze, "utf8")), computeFreezeHashes());
      if (changed.length > 0) {
        console.error(`refusing to run: frozen files changed since the smoke: ${changed.join(", ")}`);
        process.exitCode = 1;
        return;
      }
      console.log("freeze verified: harness, prompt, adapter, corpus, analyzer and detector hashes match the smoke.");
    }
    if (args.writeFreeze) {
      writeFileSync(args.writeFreeze, JSON.stringify(computeFreezeHashes(), null, 2), "utf8");
      console.log(`freeze hashes written to ${args.writeFreeze}`);
    }

    console.log(`P7.9 capability isolation - ${args.mode}, ${caseIds.length} scenario(s) x ${runsPerScenario} run(s) x ${ISOLATION_VARIANT_IDS.length} variants = ${caseIds.length * runsPerScenario * ISOLATION_VARIANT_IDS.length} runs.`);
    const result = await runIsolation({
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
    const runId = `p7-9-${String(result.bundle.manifest.startedAt).replace(/[:.]/g, "-")}-${args.mode}${args.smoke ? "-smoke" : args.cases ? "-partial" : ""}${args.label ? `-${args.label}` : ""}`;
    const runDir = join(ARTIFACT_ROOT, runId);
    mkdirSync(runDir, { recursive: true });
    for (const [fileName, content] of Object.entries(buildIsolationArtifactFiles(result.bundle))) writeFileSync(join(runDir, fileName), content, "utf8");

    console.log("");
    for (const variant of ISOLATION_VARIANT_IDS) {
      const m = result.bundle.summary[variant];
      console.log(`${variant.padEnd(32)} Q-ask=${fmt(m.qMinus.explicitQuantityRequestRate)} Q+commit=${fmt(m.qPlus.commitRate)} progress(grounded)=${fmt(m.aggregate.commercialProgressAfterGroundingRate)} overMutation=${fmt(m.negatives.overMutationRate)} harnessFailures=${m.harnessFailures}`);
    }
    const comparison = result.bundle.comparison;
    console.log(`replication: ${comparison.replication.status}; signal (candidate): ${comparison.signals.overall.signal}`);
    console.log(`\nArtifacts written to: ${runDir}`);
  } finally {
    await resetPoolForTests();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error("P7.9 benchmark crashed unexpectedly:", error);
    process.exitCode = 1;
  });
}

/**
 * SALES-AGENT-R3-P7.13 (Continuity Vulnerability & Degradation Audit). Five
 * independent, interleaved, persistent conversations through the REAL R3
 * runtime (runSalesAgentRuntimeCycle via r3CommercialE2E's harness pieces -
 * never the r3TrueAB/r3ConversationalSoak native harness). Writes artifacts
 * to benchmark-results/<run-id>/. See
 * docs/audits/r3-p7-13-continuity-vulnerability-degradation.md for the
 * architecture audit this harness is built against.
 *
 * REQUIRES NODE_ENV=test and the local crm_test database. Live only with
 * BENCHMARK_LIVE_LLM_ENABLED=true, and with the same model-parity overrides
 * P7.10-P7.12 used:
 *   BENCHMARK_E2E_CATALOG_QUERY_AWARE=true BENCHMARK_E2E_THINKING=disabled
 *   BENCHMARK_E2E_MODEL_TIMEOUT_MS=60000 BENCHMARK_E2E_MAX_OUTPUT_TOKENS=4000 BENCHMARK_E2E_MAX_MODEL_RETRIES=5
 * plus, specific to this diagnostic:
 *   BENCHMARK_E2E_SESSION_COMPACTION_ENABLED=true   (task sections 19-29 require observable compaction)
 *
 *   ... --smoke --write-freeze=<file>   # ~20-30 turns/conversation instrument smoke, then record freeze hashes
 *   ... --freeze=<file>                 # main run (750-1250+ turns, plan exhaustion is the real limit)
 *   ... --plan-only                     # prints the 5 stress plans' shape, runs nothing
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContinuityArtifactFiles } from "../lib/brain/commercial/agent-loop/benchmark/r3ContinuityAudit/artifacts";
import { computeContinuityFreezeHashes, diffContinuityFreeze } from "../lib/brain/commercial/agent-loop/benchmark/r3ContinuityAudit/freeze";
import { runContinuityAudit } from "../lib/brain/commercial/agent-loop/benchmark/r3ContinuityAudit/runContinuityAudit";
import { buildContinuityStressPlans } from "../lib/brain/commercial/agent-loop/benchmark/r3ContinuityAudit/stressPlans/index";
import { CONTINUITY_CONVERSATION_LABELS } from "../lib/brain/commercial/agent-loop/benchmark/r3ContinuityAudit/types";
import { classifierGoldenReport } from "../lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/runSemantics";
import { resetPoolForTests } from "../lib/db";
import { assertConnectedToCrmTest, assertLocalTestEnv, loadLocalBenchmarkEnv, printGate } from "./p7-10-env-gate";

const ARTIFACT_ROOT = join(process.cwd(), "benchmark-results");
const REQUIRED_LIVE_ENV: Record<string, string> = {
  BENCHMARK_LIVE_LLM_ENABLED: "true",
  BENCHMARK_E2E_CATALOG_QUERY_AWARE: "true",
  BENCHMARK_E2E_THINKING: "disabled",
  BENCHMARK_E2E_MODEL_TIMEOUT_MS: "60000",
  BENCHMARK_E2E_MAX_OUTPUT_TOKENS: "4000",
  BENCHMARK_E2E_MAX_MODEL_RETRIES: "5",
  BENCHMARK_E2E_SESSION_COMPACTION_ENABLED: "true"
};

const SMOKE_MAX_TURNS_PER_CONVERSATION = 25;
const SMOKE_MAX_WALL_CLOCK_MS = 10 * 60 * 1000;
const MAIN_MAX_WALL_CLOCK_MS = 90 * 60 * 1000;

function parseArgs(argv: string[]) {
  const args = new Map(
    argv.filter((arg) => arg.startsWith("--")).map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, "").split("=");
      return [key, rest.length > 0 ? rest.join("=") : "true"] as const;
    })
  );
  return {
    smoke: args.get("smoke") === "true",
    planOnly: args.get("plan-only") === "true",
    freeze: args.get("freeze") ?? null,
    writeFreeze: args.get("write-freeze") ?? null,
    label: args.get("label") ?? null
  };
}

function currentGitSha(): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim();
  } catch {
    return null;
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

    if (args.planOnly) {
      const plans = buildContinuityStressPlans();
      console.log(
        JSON.stringify(
          {
            totalTurns: CONTINUITY_CONVERSATION_LABELS.reduce((sum, label) => sum + plans[label].length, 0),
            byConversation: Object.fromEntries(CONTINUITY_CONVERSATION_LABELS.map((label) => [label, plans[label].length])),
            probeCounts: Object.fromEntries(CONTINUITY_CONVERSATION_LABELS.map((label) => [label, plans[label].filter((turn) => turn.probe !== null).length]))
          },
          null,
          2
        )
      );
      return;
    }

    await loadLocalBenchmarkEnv();
    // This machine's local .env is shared with other (non-test) work and points several
    // integrations at real external endpoints (LOGISTICS_DB_HOST=a real RDS host, a real
    // META_ACCESS_TOKEN/N8N_BASE_URL, no TEST_DATABASE_NAME) - loadLocalBenchmarkEnv() always
    // lets .env win over the shell, so these overrides must happen here, in-process, AFTER
    // loading .env and BEFORE the gate check, never by editing the shared .env file itself.
    // resolveNamedDatabaseConnection("app") - what lib/db.ts's pool actually uses - reads
    // DATABASE_NAME/DB_NAME, never TEST_DATABASE_NAME (that alias set only applies to the
    // separate target="test" connection, unused by the runtime this harness drives).
    process.env.DATABASE_NAME = "crm_test";
    process.env.DB_NAME = "crm_test";
    process.env.DATABASE_USER = process.env.TEST_DATABASE_USER ?? process.env.DATABASE_USER;
    process.env.DATABASE_PASSWORD = process.env.TEST_DATABASE_PASSWORD ?? process.env.DATABASE_PASSWORD;
    process.env.LOGISTICS_DB_ENABLED = "false";
    process.env.META_ACCESS_TOKEN = "";
    process.env.DEFAULT_PHONE_NUMBER_ID = "";
    process.env.N8N_BASE_URL = "";
    process.env.LOGISTICS_DB_HOST = "";
    printGate(assertLocalTestEnv());
    const wrong = Object.entries(REQUIRED_LIVE_ENV).filter(([key, value]) => process.env[key]?.trim().toLowerCase() !== value.toLowerCase());
    if (wrong.length > 0) {
      console.error(`refusing to run: required env missing/different: ${wrong.map(([key, value]) => `${key}=${value}`).join(" ")}`);
      process.exitCode = 1;
      return;
    }

    const golden = classifierGoldenReport();
    if (golden.discrepancies > 0) {
      console.error(`refusing to run: the (P7.10, reused unchanged) confirmation classifier disagrees with ${golden.discrepancies} golden entries.`);
      process.exitCode = 1;
      return;
    }

    if (args.freeze) {
      const changed = diffContinuityFreeze(JSON.parse(readFileSync(args.freeze, "utf8")), computeContinuityFreezeHashes());
      if (changed.length > 0) {
        console.error(`refusing to run: frozen files/plans changed since the smoke: ${changed.join(", ")}`);
        process.exitCode = 1;
        return;
      }
      console.log("freeze verified: harness, analyzer, stress plans and fixture hashes match the smoke.");
    }
    if (args.writeFreeze) {
      writeFileSync(args.writeFreeze, JSON.stringify(computeContinuityFreezeHashes(), null, 2), "utf8");
      console.log(`freeze hashes written to ${args.writeFreeze}`);
    }

    console.log(`P7.13 continuity audit - ${args.smoke ? "SMOKE" : "MAIN"}, maxWallClockMs=${args.smoke ? SMOKE_MAX_WALL_CLOCK_MS : MAIN_MAX_WALL_CLOCK_MS}`);
    console.log(`SELECT DATABASE() before the run = ${(await assertConnectedToCrmTest()).database}`);

    const result = await runContinuityAudit({
      mode: args.smoke ? "smoke" : "main",
      maxTurnsPerConversation: args.smoke ? SMOKE_MAX_TURNS_PER_CONVERSATION : undefined,
      maxWallClockMs: args.smoke ? SMOKE_MAX_WALL_CLOCK_MS : MAIN_MAX_WALL_CLOCK_MS,
      onTurnFinished: ({ turn, plan, index, total }) => {
        const flags = [turn.compactionHappenedThisTurn ? "COMPACTION" : null, turn.falseSuccessClaim ? "FALSE_SUCCESS" : null, turn.regreeted ? "REGREETING" : null].filter(Boolean).join(",");
        console.log(`[${index + 1}/${total}] ${plan.conversation}${plan.localIndex} ${plan.category} tools=${turn.toolCalls.length} ${flags ? `FLAGS=${flags}` : ""}`);
      }
    });

    if (!result.ok) {
      console.error("ENVIRONMENT_BLOCKED: a required dependency is unreachable - nothing was run.");
      console.error(JSON.stringify(result.environmentHealth, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log(`SELECT DATABASE() after the run  = ${(await assertConnectedToCrmTest()).database}`);
    const runId = `${result.benchmarkRunId}${args.label ? `-${args.label}` : ""}`;
    const runDir = join(ARTIFACT_ROOT, runId);
    mkdirSync(runDir, { recursive: true });
    const files = buildContinuityArtifactFiles(result, currentGitSha(), computeContinuityFreezeHashes().plans?.sha256 ?? "unknown");
    for (const [fileName, content] of Object.entries(files)) writeFileSync(join(runDir, fileName), content, "utf8");

    const summary = JSON.parse(files["summary.json"]);
    console.log("");
    console.log(`wall-clock: ${(result.wallClockMs / 1000 / 60).toFixed(1)} min; turns executed: ${result.allTurns.length}; planExhausted=${result.planExhausted}`);
    console.log(`preregistered signal: ${summary.preregisteredSignal} (${summary.preregisteredSignalReason})`);
    console.log(`\nArtifacts written to: ${runDir}`);
  } finally {
    await resetPoolForTests();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .catch((error) => {
      console.error("P7.13 continuity audit crashed unexpectedly:", error);
      process.exitCode = 1;
    })
    .finally(() => {
      // P7.12/earlier scripts leave this implicit and rely on the event loop draining on
      // its own - observed here (first P7.13 smoke attempt) to leave the process alive
      // indefinitely after an early ENVIRONMENT_BLOCKED return with open DB-pool handles.
      // Forcing exit here is scoped to this script only.
      process.exit(process.exitCode ?? 0);
    });
}

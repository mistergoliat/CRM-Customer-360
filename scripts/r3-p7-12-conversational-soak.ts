/**
 * SALES-AGENT-R3-P7.12 (Conversational Soak & Adversarial Stress Test). Three independent,
 * interleaved, persistent conversations against the SAME P7.8-R/P7.10/P7.11 true autonomous
 * harness, S1 semantics fixed (P7.11 R1 = P7.10 S1). Writes artifacts to
 * benchmark-results/<run-id>/.
 *
 * REQUIRES NODE_ENV=test and the local crm_test database. Never production. Live only with
 * BENCHMARK_LIVE_LLM_ENABLED=true AND --mode=live, and with the P7.8-R/P7.10/P7.11 model overrides:
 *   BENCHMARK_E2E_CATALOG_QUERY_AWARE=true BENCHMARK_E2E_THINKING=disabled
 *   BENCHMARK_E2E_MODEL_TIMEOUT_MS=60000 BENCHMARK_E2E_MAX_OUTPUT_TOKENS=4000 BENCHMARK_E2E_MAX_MODEL_RETRIES=5
 *
 *   ... --mode=live --smoke --write-freeze=<file>   # 5-minute instrument smoke, then record freeze hashes
 *   ... --mode=live --freeze=<file>                 # main soak (~60 min wall-clock, full plan)
 *   ... --mode=live --plan-only                     # prints the plan, runs nothing
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifierGoldenReport, sha256File } from "../lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/runSemantics";
import { sha256Text } from "../lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/semanticsSurfaces";
import { buildSoakArtifactFiles, runSoak } from "../lib/brain/commercial/agent-loop/benchmark/r3ConversationalSoak/runSoak";
import { STRESS_PLAN } from "../lib/brain/commercial/agent-loop/benchmark/r3ConversationalSoak/stressPlan";
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

const SMOKE_MAX_TURNS = 24; // ~8 per conversation, includes the first (earliest) fault-injection turns
const SMOKE_MAX_WALL_CLOCK_MS = 5 * 60 * 1000;
const MAIN_MAX_WALL_CLOCK_MS = 60 * 60 * 1000;

const B = "lib/brain/commercial/agent-loop/benchmark";
const S = `${B}/r3ConversationalSoak`;
export const SOAK_FREEZE_FILE_GROUPS: Record<string, string[]> = {
  autonomousPrompt: [`${B}/r3TrueAB/trueHarnessPrompt.ts`],
  autonomousLoop: [`${B}/r3TrueAB/trueHarnessLoop.ts`, `${B}/r3TrueAB/nativeToolClient.ts`],
  s1Semantics: [`${B}/r3MutationSemantics/semanticsSurfaces.ts`, `${B}/r3ConfirmationBoundary/surfaces.ts`, `${S}/surface.ts`],
  soakHarness: [`${S}/soakSession.ts`],
  stressPlan: [`${S}/stressPlan.ts`],
  faultInjection: [`${S}/faultInjection.ts`],
  invariants: [`${S}/invariants.ts`],
  classifier: [`${B}/r3MutationSemantics/confirmationClassifier.ts`, "tests/agent-loop/benchmark/r3MutationSemantics/goldenConfirmations.json"],
  analyzer: [`${S}/analysis.ts`, `${B}/r3AutonomousAB/analysis.ts`, `${B}/r3CommercialE2E/metrics.ts`],
  fixtures: [`${B}/r3TrueAB/runTrueHarnessCase.ts`, `${B}/r3StableAgentV1/environment.ts`, `${B}/environment.ts`]
};

function computeFreezeHashes(): Record<string, Record<string, string>> {
  return {
    ...Object.fromEntries(Object.entries(SOAK_FREEZE_FILE_GROUPS).map(([group, files]) => [group, Object.fromEntries(files.map((file) => [file, sha256File(file)]))])),
    plan: { sha256: sha256Text(JSON.stringify(STRESS_PLAN)) }
  };
}

function diffFreeze(expected: Record<string, Record<string, string>>, actual: Record<string, Record<string, string>>): string[] {
  const changed: string[] = [];
  for (const [group, files] of Object.entries(expected)) for (const [file, hash] of Object.entries(files)) if (actual[group]?.[file] !== hash) changed.push(`${group}:${file}`);
  return changed;
}

function parseArgs(argv: string[]) {
  const args = new Map(argv.filter((arg) => arg.startsWith("--")).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length > 0 ? rest.join("=") : "true"] as const;
  }));
  const cycles = Number.parseInt(args.get("cycles") ?? "1", 10);
  return {
    mode: (args.get("mode") === "live" ? "live" : "offline") as "offline" | "live",
    smoke: args.get("smoke") === "true",
    planOnly: args.get("plan-only") === "true",
    freeze: args.get("freeze") ?? null,
    writeFreeze: args.get("write-freeze") ?? null,
    label: args.get("label") ?? null,
    cycles: Number.isFinite(cycles) && cycles > 0 ? cycles : 1
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

    if (args.planOnly) {
      console.log(JSON.stringify({ totalTurns: STRESS_PLAN.length, byConversation: { A: STRESS_PLAN.filter((t) => t.conversation === "A").length, B: STRESS_PLAN.filter((t) => t.conversation === "B").length, C: STRESS_PLAN.filter((t) => t.conversation === "C").length }, faults: STRESS_PLAN.filter((t) => t.fault).map((t) => `${t.conversation}${t.localIndex}:${t.fault!.kind}`), first9: STRESS_PLAN.slice(0, 9).map((t) => `${t.conversation}${t.localIndex}`) }, null, 2));
      return;
    }
    await loadLocalBenchmarkEnv();
    printGate(assertLocalTestEnv());
    if (args.mode === "live") {
      const wrong = Object.entries(REQUIRED_LIVE_ENV).filter(([key, value]) => process.env[key]?.trim().toLowerCase() !== value);
      if (wrong.length > 0) {
        console.error(`refusing to run: P7.8-R/P7.10/P7.11 parity env missing/different: ${wrong.map(([key, value]) => `${key}=${value}`).join(" ")}`);
        process.exitCode = 1;
        return;
      }
    }
    const golden = classifierGoldenReport();
    if (golden.discrepancies > 0) {
      console.error(`refusing to run: the (P7.10, reused unchanged) confirmation classifier disagrees with ${golden.discrepancies} golden entries.`);
      process.exitCode = 1;
      return;
    }
    if (args.freeze) {
      const changed = diffFreeze(JSON.parse(readFileSync(args.freeze, "utf8")), computeFreezeHashes());
      if (changed.length > 0) {
        console.error(`refusing to run: frozen files/plan changed since the smoke: ${changed.join(", ")}`);
        process.exitCode = 1;
        return;
      }
      console.log("freeze verified: harness, S1 semantics, stress plan, invariants, classifier and fixture hashes match the smoke.");
    }
    if (args.writeFreeze) {
      writeFileSync(args.writeFreeze, JSON.stringify(computeFreezeHashes(), null, 2), "utf8");
      console.log(`freeze hashes written to ${args.writeFreeze}`);
    }

    const cycles = args.smoke ? 1 : args.cycles;
    console.log(`P7.12 conversational soak - ${args.mode}${args.smoke ? " SMOKE" : " MAIN"}, plan=${STRESS_PLAN.length} turns x ${cycles} cycle(s), maxWallClockMs=${args.smoke ? SMOKE_MAX_WALL_CLOCK_MS : MAIN_MAX_WALL_CLOCK_MS}${args.smoke ? `, maxTurns=${SMOKE_MAX_TURNS}` : ""}`);
    console.log(`SELECT DATABASE() before the run = ${(await assertConnectedToCrmTest()).database}`);
    const startedAt = Date.now();
    const result = await runSoak({
      mode: args.mode,
      maxTurns: args.smoke ? SMOKE_MAX_TURNS : undefined,
      maxWallClockMs: args.smoke ? SMOKE_MAX_WALL_CLOCK_MS : MAIN_MAX_WALL_CLOCK_MS,
      cycles,
      onTurnFinished: ({ plan, analysis, elapsedMs, index, total }) => {
        const flags = [analysis.hardFailure ? "HARD_FAILURE" : null, ...analysis.integrityFailures].filter(Boolean).join(",");
        console.log(`[${index + 1}/${total}] t+${Math.round(elapsedMs / 1000)}s ${plan.conversation}${plan.localIndex} ${plan.stressCategory} matches=${analysis.matches} ${flags ? `FLAGS=${flags}` : ""}`);
      }
    });
    if (!result.ok) {
      console.error("ENVIRONMENT_BLOCKED: MariaDB is unreachable - nothing was run or scored.");
      console.error(JSON.stringify(result.environmentHealth, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(`SELECT DATABASE() after the run  = ${(await assertConnectedToCrmTest()).database}`);
    const runId = `p7-12-${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}-${args.mode}${args.smoke ? "-smoke" : ""}${args.label ? `-${args.label}` : ""}`;
    const runDir = join(ARTIFACT_ROOT, runId);
    mkdirSync(runDir, { recursive: true });
    const files = buildSoakArtifactFiles(result);
    for (const [fileName, content] of Object.entries(files)) writeFileSync(join(runDir, fileName), content, "utf8");

    const summary = JSON.parse(files["summary.json"]);
    console.log("");
    console.log(`wall-clock: ${(result.wallClockMs / 1000 / 60).toFixed(1)} min; turns executed: ${result.allTurns.length}/${STRESS_PLAN.length}; planExhausted=${result.planExhausted}`);
    console.log(`HARD_FAILURE: ${result.hardFailure ? JSON.stringify(result.hardFailure) : "none"}`);
    console.log(`robustness signal: ${summary.robustness.signal} (${summary.robustness.reason})`);
    console.log(`\nArtifacts written to: ${runDir}`);
  } finally {
    await resetPoolForTests();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error("P7.12 soak crashed unexpectedly:", error);
    process.exitCode = 1;
  });
}

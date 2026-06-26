import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadQualityGateEnv } from "./local-env";

type RunReport = {
  run: number;
  dbReset: { ok: boolean; exitCode: number | null; signal: NodeJS.Signals | null; error: string | null };
  tests: { ok: boolean; exitCode: number | null; signal: NodeJS.Signals | null; durationMs: number; error: string | null };
  totalDurationMs: number;
};

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv, shell = false) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
    shell
  });

  return {
    ok: result.status === 0 && !result.error,
    exitCode: result.status,
    signal: result.signal,
    error: result.error ? result.error.message : null
  };
}

async function main() {
  await loadQualityGateEnv();

  const env = { ...process.env };
  const testFile = path.resolve(process.cwd(), "tests/qa/autonomous-commerce-quality-gate.test.ts");
  const report: { branch: string; worktree: string; baseCommit: string; runs: RunReport[] } = {
    branch: process.env.QA_BRANCH ?? "ai/codex/ac-quality-gate-01",
    worktree: process.cwd(),
    baseCommit: process.env.QA_BASE_COMMIT ?? "fd23066f88b30c0e1b7550cd1b8c977e75f9a076",
    runs: []
  };

  const npmCli = process.env.npm_execpath ?? null;
  const dbResetCommand = npmCli ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
  const dbResetArgs = npmCli ? [npmCli, "run", "db:test:reset"] : ["run", "db:test:reset"];
  const dbResetShell = !npmCli && process.platform === "win32";
  const testCommand = npmCli ? process.execPath : (process.platform === "win32" ? "npx.cmd" : "npx");
  const testArgs = npmCli ? [npmCli, "exec", "--yes", "tsx@4.20.5", "--", "--test", testFile] : ["--yes", "tsx@4.20.5", "--test", testFile];
  const testShell = !npmCli && process.platform === "win32";

  let allOk = true;
  for (let run = 1; run <= 2; run += 1) {
    const startedAt = Date.now();
    const dbReset = runCommand(dbResetCommand, dbResetArgs, env, dbResetShell);
    const testsStartedAt = Date.now();
    let tests = { ok: false, exitCode: null as number | null, signal: null as NodeJS.Signals | null, error: null as string | null };

    if (dbReset.ok) {
      tests = runCommand(testCommand, testArgs, env, testShell);
    }

    const totalDurationMs = Date.now() - startedAt;
    const testsDurationMs = Date.now() - testsStartedAt;
    const runReport: RunReport = {
      run,
      dbReset,
      tests: { ...tests, durationMs: testsDurationMs },
      totalDurationMs
    };
    report.runs.push(runReport);

    if (!dbReset.ok || !tests.ok) {
      allOk = false;
    }
  }

  const reportDir = path.resolve(process.cwd(), "tmp");
  try {
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(path.join(reportDir, "autonomous-commerce-quality-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch {
    // Best-effort artifact only.
  }

  console.log(JSON.stringify(report, null, 2));

  if (!allOk) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

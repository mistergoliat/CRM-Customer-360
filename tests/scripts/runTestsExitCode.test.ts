import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// scripts/run-tests.ts derives its test directory from process.cwd(), so
// spawning it against an isolated temp cwd exercises the real exit-code path
// end to end without depending on (or polluting) the real tests/ tree.
const RUN_TESTS_SCRIPT = join(process.cwd(), "scripts", "run-tests.ts");

function runIsolatedFixtureSuite(fixtureTestSource: string): number | null {
  const dir = mkdtempSync(join(tmpdir(), "run-tests-exitcode-"));
  try {
    mkdirSync(join(dir, "tests"));
    writeFileSync(join(dir, "tests", "fixture.test.ts"), fixtureTestSource);
    // shell:true (needed on Windows to resolve npx.cmd) joins the args array
    // into one command line without auto-quoting - the repo root itself
    // contains a space, so the script's absolute path must be quoted here.
    const scriptArg = process.platform === "win32" ? `"${RUN_TESTS_SCRIPT}"` : RUN_TESTS_SCRIPT;
    // Node's test runner refuses to run --test recursively within a process
    // tree it recognizes as already running under --test (this file is
    // itself invoked via `tsx --test`). Stripping NODE_* env vars from the
    // grandchild (except NODE_ENV, which real callers rely on) breaks that
    // inherited signal so the isolated fixture suite actually executes
    // instead of being silently skipped.
    const strippedEnv: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(strippedEnv)) {
      if (key.startsWith("NODE_") && key !== "NODE_ENV") delete strippedEnv[key];
    }
    const result = spawnSync("npx", ["--yes", "tsx@4.20.5", scriptArg], {
      cwd: dir,
      stdio: "ignore",
      shell: process.platform === "win32",
      env: strippedEnv
    });
    return result.status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("run-tests.ts exits non-zero when a test fails", () => {
  const status = runIsolatedFixtureSuite(
    `import assert from "node:assert/strict";
     import test from "node:test";
     test("deliberate failure", () => { assert.strictEqual(1, 2); });`
  );
  assert.notEqual(status, 0, "a failing suite must never report success via the process exit code");
});

test("run-tests.ts exits zero when the suite passes", () => {
  const status = runIsolatedFixtureSuite(
    `import assert from "node:assert/strict";
     import test from "node:test";
     test("control pass", () => { assert.strictEqual(1, 1); });`
  );
  assert.equal(status, 0);
});

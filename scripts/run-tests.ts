import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const TESTS_DIR = join(ROOT, "tests");
const BATCH_SIZE = 25;

function collectTestFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(relative(ROOT, fullPath));
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

const requestedPaths = process.argv.slice(2);
const allTestFiles = collectTestFiles(TESTS_DIR);
const testFiles =
  requestedPaths.length === 0
    ? allTestFiles
    : allTestFiles.filter((file) =>
        requestedPaths.some((requested) => file === requested || file.endsWith(`/${requested}`))
      );

if (testFiles.length === 0) {
  console.error("No test files found under tests/.");
  process.exit(1);
}

let exitCode = 0;

for (let index = 0; index < testFiles.length; index += BATCH_SIZE) {
  const batch = testFiles.slice(index, index + BATCH_SIZE);
  const result =
    process.platform === "win32"
      ? spawnSync("npx", ["--yes", "tsx@4.20.5", "--test", ...batch], {
          cwd: ROOT,
          stdio: "inherit",
          shell: true
        })
      : spawnSync("npx", ["--yes", "tsx@4.20.5", "--test", ...batch], {
          cwd: ROOT,
          stdio: "inherit",
          shell: false
        });

  if (result.error) {
    console.error(result.error.message);
    exitCode = 1;
    continue;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    exitCode = result.status;
  }
}

process.exit(exitCode);

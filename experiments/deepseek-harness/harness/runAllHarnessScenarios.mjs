// SALES-AGENT-R2-A13-H0 bake-off. Runs every scenario in the shared corpus
// against the Harness runner, one fresh process per scenario (matching
// bootBakeoff.mts's one-agent-per-process design), and writes one
// consolidated results file.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const node24 = "C:/Users/joaqu/AppData/Local/nvm/v24.14.0/node.exe";
const tsxCli = join(here, "..", "node_modules", "tsx", "dist", "cli.mjs");
const bootScript = join(here, "bootBakeoff.mts");

const corpus = JSON.parse(readFileSync(join(here, "..", "scenarios", "bakeoff-scenarios.json"), "utf8"));
const results = [];

for (const scenario of corpus.scenarios) {
  const startedAt = Date.now();
  try {
    const stderr = execFileSync(node24, [tsxCli, bootScript, scenario.id], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 });
    console.error(`[batch] ${scenario.id} ok in ${Date.now() - startedAt}ms`);
    void stderr;
    results.push({ scenarioId: scenario.id, status: "ok", wallMs: Date.now() - startedAt });
  } catch (error) {
    console.error(`[batch] ${scenario.id} FAILED: ${error.message}`);
    results.push({ scenarioId: scenario.id, status: "failed", wallMs: Date.now() - startedAt, error: error.message });
  }
}

writeFileSync(join(here, "..", "harness-batch-summary.json"), JSON.stringify(results, null, 2));
console.error("[batch] done");

// SALES-AGENT-R2-A13-H0 bake-off. Runs every scenario in the shared corpus
// through the R2 planner probe, one process per scenario.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const tsxCli = join(here, "..", "node_modules", "tsx", "dist", "cli.mjs");
const probeScript = join(here, "runR2PlannerProbe.ts");
// Node 20, not 24: tsx's ESM alias/transform hook does not reliably win over
// Node 24's built-in TypeScript type-stripping for this file's export-chain
// pattern (confirmed by direct A/B: identical script, identical tsx,
// "does not provide an export" only reproduces under Node >=22). The R2
// probe has no Promise.withResolvers/native-zstd dependency, so it never
// needed the newer runtime the Harness half requires.
const nodeBin = "C:/Users/joaqu/AppData/Local/nvm/v20.19.0/node.exe";

const corpus = JSON.parse(readFileSync(join(here, "..", "scenarios", "bakeoff-scenarios.json"), "utf8"));
const results = [];

for (const scenario of corpus.scenarios) {
  const startedAt = Date.now();
  try {
    execFileSync(nodeBin, [tsxCli, probeScript, scenario.id], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 });
    console.error(`[batch-r2] ${scenario.id} ok in ${Date.now() - startedAt}ms`);
    results.push({ scenarioId: scenario.id, status: "ok", wallMs: Date.now() - startedAt });
  } catch (error) {
    console.error(`[batch-r2] ${scenario.id} FAILED: ${error.message}`);
    results.push({ scenarioId: scenario.id, status: "failed", wallMs: Date.now() - startedAt, error: error.message });
  }
}

writeFileSync(join(here, "..", "r2-batch-summary.json"), JSON.stringify(results, null, 2));
console.error("[batch-r2] done");

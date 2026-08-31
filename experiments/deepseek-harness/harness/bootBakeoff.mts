// SALES-AGENT-R2-A13-H0 bake-off. Boots the Harness (dsh-base + our patch)
// for exactly one scenario and exits. Usage:
//   DEEPSEEK_HARNESS_SMOKE=1 node --import tsx harness/bootBakeoff.mts <scenarioId>
import { fileURLToPath } from "node:url";
import util from "node:util";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { boot, loadOverlayPatches } from "@deepseek-ai/dsh-app-boot";
import { startCatalogFixtureServer } from "../fixtures/catalogFixtureServer.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

function loadRepoEnv(): void {
  const envPath = join(repoRoot, ".env");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) process.env[key] = value.trim();
  }
}

async function main(): Promise<void> {
  const scenarioId = process.argv[2];
  if (!scenarioId) throw new Error("usage: bootBakeoff.mts <scenarioId>");

  loadRepoEnv();

  const fixture = await startCatalogFixtureServer(0);
  process.env.CATALOG_SERVICE_BASE_URL = fixture.baseUrl;
  process.env.CATALOG_SERVICE_API_KEY = "bakeoff-fixture-key";
  console.error(`[bakeoff] catalog fixture at ${fixture.baseUrl}`);

  const scenarioPath = join(here, "..", "scenarios", "bakeoff-scenarios.json");
  const corpus = JSON.parse(readFileSync(scenarioPath, "utf8")) as { scenarios: Array<{ id: string; seedIdentityLevel?: string }> };
  const scenario = corpus.scenarios.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`unknown scenario: ${scenarioId}`);

  process.env.BAKEOFF_SCENARIO_PATH = scenarioPath;
  process.env.BAKEOFF_SCENARIO_ID = scenarioId;
  process.env.BAKEOFF_IDENTITY_LEVEL = scenario.seedIdentityLevel ?? "LEVEL_0_ANONYMOUS";

  const outDir = join(here, "..", "results");
  mkdirSync(outDir, { recursive: true });
  const outputPath = join(outDir, `${scenarioId}.harness.json`);
  process.env.BAKEOFF_OUTPUT_PATH = outputPath;

  const rootConfigPath = join(here, "empty.cordis.yml");
  writeFileSync(rootConfigPath, "[]\n");

  const dshBasePkgDir = join(here, "..", "node_modules", "@deepseek-ai", "dsh-base");
  const basePatches = loadOverlayPatches("bakeoff", join(dshBasePkgDir, "cordis.patch.yml"));
  const bakeoffPatches = loadOverlayPatches("bakeoff", join(here, "bakeoff.cordis.patch.yml"));

  const bareModuleBaseUrl = new URL("../node_modules/", import.meta.url).toString();

  const ctx = await boot("bakeoff", rootConfigPath, [...basePatches, ...bakeoffPatches], undefined, bareModuleBaseUrl);

  console.error(`[bakeoff] booted, waiting for scenario ${scenarioId} to finish`);
  void ctx;
}

main().catch((error) => {
  console.error("[bakeoff] fatal", util.inspect(error, { depth: null, colors: false }));
  process.exit(1);
});

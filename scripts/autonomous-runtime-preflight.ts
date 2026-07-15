/**
 * autonomous-runtime-preflight (ACS-R1-05-T06.1)
 *
 * Validates the pilot's operational configuration WITHOUT starting any
 * worker, calling Meta or touching the database - reads config only. Prints
 * a JSON report of booleans/counts (never a raw env value, never a wa_id)
 * and exits non-zero when the configuration is invalid, so it can gate a
 * deploy/smoke step. All validation logic lives in
 * lib/brain/runtime/autonomousRuntimeConfig.ts#buildAutonomousRuntimePreflightReport
 * (unit-tested there) - this file is only the env-loading + printing + exit
 * code wrapper.
 *
 * Usage:
 *   npm run preflight:autonomous
 */

import path from "node:path";
import { loadLocalEnv, loadEnvFile, PROJECT_ROOT } from "./db-utils";
import { buildAutonomousRuntimePreflightReport } from "../lib/brain/runtime/autonomousRuntimeConfig";

async function loadRuntimeEnv() {
  await loadLocalEnv();
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env.local"), false);
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env"), false);
}

async function main() {
  await loadRuntimeEnv();
  const report = buildAutonomousRuntimePreflightReport();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, pilotAllowlistCount: 0, errors: [error instanceof Error ? error.message : String(error)] }, null, 2));
  process.exitCode = 1;
});

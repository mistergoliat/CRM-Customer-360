import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import test from "node:test";

/**
 * ACS-R1-05-T05 static authority tests. These do not exercise runtime
 * behavior - they verify, from source text and the real import graph, that
 * the parallel/dead follow-up runtimes identified by
 * docs/audits/follow-up-runtime-reconciliation.md stay disconnected from
 * production:
 *
 *   P2-1 - no planner competes with `planCommercialFollowUp` for schedule_followup.
 *   P2-2 - `multi-request/requestFollowups.ts` keeps no scheduler/persister.
 *   P2-5 - `messaging/outbox-worker/` (hyphenated) stays unreachable from production.
 */

const ROOT = resolve(process.cwd());

const SCAN_ROOTS = ["app", "lib", "scripts", "components"];
const SCAN_EXTENSIONS = [".ts", ".tsx"];
const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".next", ".tmp-commercial-tests-cjs", ".git"]);

// Directory prefixes (relative to repo root, forward slashes) allowed to
// import the isolated dev-only sandbox family. Anything outside this list
// importing these modules would resurrect a competing productive path.
const ALLOWED_SANDBOX_IMPORTER_PREFIXES = [
  "app/(hub)/dev/ai-sdr-simulator/",
  "components/cases/ai-sdr/scenario-simulator/",
  "lib/brain/commercial/autonomous-loop/",
  "lib/brain/commercial/scenario-simulator/",
  "lib/brain/commercial/follow-up-scheduling/",
  "lib/brain/commercial/follow-up-replanning/",
  "lib/brain/messaging/outbox-worker/"
];

const SANDBOX_IMPORT_PATTERN = /from\s+["'][^"']*(?:\/autonomous-loop|\/scenario-simulator|\/messaging\/outbox-worker)(?:\/[^"']*)?["']/g;

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

function walk(dir: string, out: string[]): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
      continue;
    }
    if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(fullPath);
  }
}

function listProductionSourceFiles(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = resolve(ROOT, root);
    if (existsSync(abs)) walk(abs, files);
  }
  return files;
}

function isAllowedSandboxImporter(relPath: string): boolean {
  return ALLOWED_SANDBOX_IMPORTER_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

test("no production file outside the dev sandbox boundary imports autonomous-loop, scenario-simulator or the hyphenated outbox-worker", () => {
  const offenders: string[] = [];
  for (const absPath of listProductionSourceFiles()) {
    const relPath = toPosix(absPath.slice(ROOT.length + 1));
    if (isAllowedSandboxImporter(relPath)) continue;
    const source = readFileSync(absPath, "utf8");
    const matches = source.match(SANDBOX_IMPORT_PATTERN);
    if (matches && matches.length > 0) offenders.push(`${relPath}: ${matches.join(", ")}`);
  }
  assert.deepEqual(offenders, [], `Unexpected productive import of the dev-only sandbox family:\n${offenders.join("\n")}`);
});

test("the commercial and messaging production barrels do not re-export the dev-only sandbox family", () => {
  const commercialBarrel = readFileSync(resolve(ROOT, "lib/brain/commercial/index.ts"), "utf8");
  assert.equal(/export\s+\*\s+from\s+["']\.\/autonomous-loop["']/.test(commercialBarrel), false);
  assert.equal(/export\s+\*\s+from\s+["']\.\/scenario-simulator["']/.test(commercialBarrel), false);
  assert.equal(/export\s+\*\s+from\s+["']\.\/follow-up-scheduling["']/.test(commercialBarrel), false);
  assert.equal(/export\s+\*\s+from\s+["']\.\/follow-up-replanning["']/.test(commercialBarrel), false);
  assert.equal(/from\s+["']\.\.\/messaging\/outbox-worker["']/.test(commercialBarrel), false);
  // follow-up-planner (the canonical calculation source) must remain exported.
  assert.equal(/export\s+\*\s+from\s+["']\.\/follow-up-planner["']/.test(commercialBarrel), true);

  const messagingBarrel = readFileSync(resolve(ROOT, "lib/brain/messaging/index.ts"), "utf8");
  assert.equal(/export\s+\*\s+from\s+["']\.\/outbox-worker["']/.test(messagingBarrel), false);
});

test("multi-request/requestFollowups.ts keeps only the read-only projection, no scheduler/persister", () => {
  const source = readFileSync(resolve(ROOT, "lib/brain/commercial/multi-request/requestFollowups.ts"), "utf8");
  for (const deadExport of ["scheduleRequestFollowup", "scheduleFollowupFromDefinition", "runRequestFollowupTick"]) {
    const declarationPattern = new RegExp(`(export\\s+)?(async\\s+)?function\\s+${deadExport}\\b`);
    assert.equal(declarationPattern.test(source), false, `requestFollowups.ts must not define ${deadExport} anymore`);
  }
  assert.match(source, /export async function listPendingFollowupsForRequest/);
});

// scripts/e2e-autonomous-harness.ts (npm run e2e:autonomous) directly seeds a
// raw `schedule_followup` fixture row to exercise the real worker end-to-end;
// it computes nothing (no attempt/cooldown/policy logic) and is not reachable
// outside that manual harness, so it is not a competing planner.
const KNOWN_TEST_FIXTURE_SEED_SCRIPTS = new Set(["scripts/e2e-autonomous-harness.ts"]);

/**
 * ACS-R1-05.1-T02.3D: before this task, action-queue/persistAgentAction.ts
 * (the generic, action-type-agnostic writer the NATIVE runtime uses) never
 * mentioned "schedule_followup" as a literal string anywhere in its own
 * source - it just inserted whatever action_type value the caller passed in,
 * opaque to a source-text grep. That's exactly why the native path's
 * schedule_followup rows persisted with scheduled_for = NULL for so long
 * without this static check ever catching it: the row really was being
 * written there, just with no real scheduling behind it. This task fixes
 * that (execution-bridge/runCommercialExecutionBridge.ts now computes a
 * real schedule) and adds a literal 'schedule_followup' reference to
 * persistAgentAction.ts itself (the active-sequence dedup query,
 * loadActiveFollowUpForSequence) - so persistAgentAction.ts is now, by
 * design, a second legitimate productive persister alongside the legacy
 * sales-consultative/repository.ts (kept intact and disabled per this same
 * task's decisions - reference only, never runtime authority). Any THIRD
 * file doing this is still exactly what this test exists to catch.
 */
const KNOWN_PRODUCTIVE_SCHEDULE_FOLLOWUP_PERSISTERS = new Set([
  "lib/brain/commercial/sales-consultative/repository.ts",
  "lib/brain/commercial/action-queue/persistAgentAction.ts"
]);

test("sales-consultative/repository.ts and action-queue/persistAgentAction.ts are the only productive schedule_followup persisters", () => {
  const repositorySource = readFileSync(resolve(ROOT, "lib/brain/commercial/sales-consultative/repository.ts"), "utf8");
  assert.match(repositorySource, /from ["']\.\.\/follow-up-planner["']/);
  assert.match(repositorySource, /planCommercialFollowUp/);

  // No other production file may write action_type = 'schedule_followup' into
  // crm_agent_actions specifically - matched against THAT table, never just
  // "any INSERT anywhere in a file that also mentions the string
  // schedule_followup" (ACS-R1-05.1-T02.3D review correction: optOutStore.ts
  // legitimately does both - it INSERTs into the unrelated crm_customer_opt_outs
  // table, and separately UPDATEs crm_agent_actions rows WHERE action_type =
  // 'schedule_followup' to cancel them - neither is a new persister of
  // schedule_followup rows, so the check now requires the INSERT itself to
  // target crm_agent_actions before flagging a file).
  const offenders: string[] = [];
  for (const absPath of listProductionSourceFiles()) {
    const relPath = toPosix(absPath.slice(ROOT.length + 1));
    if (KNOWN_PRODUCTIVE_SCHEDULE_FOLLOWUP_PERSISTERS.has(relPath)) continue;
    if (isAllowedSandboxImporter(relPath)) continue; // in-memory only, never a real INSERT
    if (KNOWN_TEST_FIXTURE_SEED_SCRIPTS.has(relPath)) continue;
    const source = readFileSync(absPath, "utf8");
    if (/schedule_followup/.test(source) && /INSERT\s+(IGNORE\s+)?INTO\s+`?crm_agent_actions`?/i.test(source)) {
      offenders.push(relPath);
    }
  }
  assert.deepEqual(offenders, []);
});

test("canonicalOutboxWriter.ts remains the only productive SQL writer of brain_message_outbox", () => {
  const offenders: string[] = [];
  for (const absPath of listProductionSourceFiles()) {
    const relPath = toPosix(absPath.slice(ROOT.length + 1));
    if (relPath === "lib/brain/messaging/canonicalOutboxWriter.ts") continue;
    if (isAllowedSandboxImporter(relPath)) continue; // in-memory fixtures/tests, never real SQL
    const source = readFileSync(absPath, "utf8");
    if (/INSERT\s+(IGNORE\s+)?INTO\s+`?brain_message_outbox`?/i.test(source)) offenders.push(relPath);
  }
  assert.deepEqual(offenders, []);
});

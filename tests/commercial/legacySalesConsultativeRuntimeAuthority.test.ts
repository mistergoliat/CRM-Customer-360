import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import test from "node:test";

/**
 * ACS-R1-05.1-T01 static authority tests. Same shape as
 * tests/commercial/followUpRuntimeAuthority.test.ts: these do not exercise
 * runtime behavior - they verify, from source text across the whole
 * production tree (never a single hand-picked file, never a line number),
 * that the legacy sales-consultative engine
 * (lib/brain/commercial/sales-consultative) stays a closed, fully-enumerated,
 * flag-gated surface and cannot silently gain a new productive caller.
 *
 * Runtime/behavioral proof that the gate actually holds when exercised lives
 * in tests/commercial/legacySalesConsultativeAuthority.test.ts. This file
 * only proves the shape of the import/call graph.
 */

const ROOT = resolve(process.cwd());

// Production runtime in this repo (a non-`src` Next.js app) is formally
// limited to these four directories - the same premise
// followUpRuntimeAuthority.test.ts (ACS-R1-05-T05) uses - plus any
// standalone .ts/.tsx file sitting directly at the repo root, since a
// directory-only walk cannot see those. middleware.ts is the concrete case:
// it runs on every matched request but lives outside app/lib/scripts/
// components, so it would otherwise be silently excluded from this scan.
// database/ and infra/ contain only .sql/.sh files (checked: no .ts/.tsx),
// so they carry nothing this scan's extensions would match.
const SCAN_ROOTS = ["app", "lib", "scripts", "components"];
const SCAN_EXTENSIONS = [".ts", ".tsx"];
const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".next", ".tmp-commercial-tests-cjs", ".git", "coverage"]);

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

function listRootLevelSourceFiles(): string[] {
  const files: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(ROOT, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) files.push(join(ROOT, entry.name));
  }
  return files;
}

function listProductionSourceFiles(): string[] {
  const files: string[] = listRootLevelSourceFiles();
  for (const root of SCAN_ROOTS) {
    const abs = resolve(ROOT, root);
    if (existsSync(abs)) walk(abs, files);
  }
  return files;
}

function relPathOf(absPath: string): string {
  return toPosix(absPath.slice(ROOT.length + 1));
}

function findProductionFilesMatching(pattern: RegExp): string[] {
  const matches: string[] = [];
  for (const absPath of listProductionSourceFiles()) {
    const source = readFileSync(absPath, "utf8");
    if (pattern.test(source)) matches.push(relPathOf(absPath));
  }
  return matches.sort();
}

// The full, closed set of production files allowed to reference the
// runSalesConsultativeService identifier at all - its own definition plus the
// two flag-gated legacy entry points named in ACS-R1-05.1-T01's spec. Any
// other file referencing it (import, type usage or call) is an unauthorized
// caller and must fail this test, not be silently allowlisted.
const RUN_SALES_CONSULTATIVE_SERVICE_ALLOWED_FILES = [
  "lib/brain/commercial/sales-consultative/service.ts",
  "lib/brain/native-whatsapp/service.ts",
  "lib/brain/processInbound.ts"
].sort();

// processSalesInbound has zero production callers today (verified below): it
// must not gain one outside its own definition without this test failing, so
// that "no HTTP caller turns the disabled-state error into a 500" stays true.
const PROCESS_SALES_INBOUND_ALLOWED_FILES = ["lib/brain/native-whatsapp/service.ts"].sort();

test("runSalesConsultativeService has no productive reference outside its definition and the two flag-gated legacy entry points", () => {
  const found = findProductionFilesMatching(/\brunSalesConsultativeService\b/);
  assert.deepEqual(
    found,
    RUN_SALES_CONSULTATIVE_SERVICE_ALLOWED_FILES,
    `Unexpected set of files referencing runSalesConsultativeService. Found:\n${found.join("\n")}\nExpected exactly:\n${RUN_SALES_CONSULTATIVE_SERVICE_ALLOWED_FILES.join("\n")}`
  );
});

test("processSalesInbound has no production caller today (a thrown LegacySalesConsultativeDisabledError cannot become an HTTP 500)", () => {
  const found = findProductionFilesMatching(/\bprocessSalesInbound\b/);
  assert.deepEqual(
    found,
    PROCESS_SALES_INBOUND_ALLOWED_FILES,
    `Unexpected set of files referencing processSalesInbound. Found:\n${found.join("\n")}\nExpected exactly:\n${PROCESS_SALES_INBOUND_ALLOWED_FILES.join("\n")}`
  );
});

test("both legacy entry points read the shared BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED gate, not an ad-hoc check", () => {
  const gatedFiles = ["lib/brain/native-whatsapp/service.ts", "lib/brain/processInbound.ts"];
  for (const relPath of gatedFiles) {
    const source = readFileSync(resolve(ROOT, relPath), "utf8");
    assert.match(source, /buildLegacySalesConsultativeFeatureFlags/, `${relPath} must call buildLegacySalesConsultativeFeatureFlags`);
    assert.match(source, /legacySalesConsultativeEnabled/, `${relPath} must branch on legacySalesConsultativeEnabled`);
  }
});

test("BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED has no direct process.env property-access reader anywhere", () => {
  // The codebase convention (readEnvFlag) always reads process.env[name]
  // where name is a runtime string argument - never a literal
  // process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED property access. If
  // one ever appears, it bypassed the shared reader.
  const found = findProductionFilesMatching(/process\.env(?:\.|\[["'])BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED/);
  assert.deepEqual(found, []);
});

test("BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED is read via readEnvFlag in exactly one file: commercialCycleConfig.ts", () => {
  const found = findProductionFilesMatching(/readEnvFlag\(\s*["']BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED["']/);
  assert.deepEqual(found, ["lib/brain/commercial/config/commercialCycleConfig.ts"]);
});

test("app/api/integrations/whatsapp/webhook does not import the sales-consultative module family", () => {
  const source = readFileSync(resolve(ROOT, "app/api/integrations/whatsapp/webhook/route.ts"), "utf8");
  assert.doesNotMatch(source, /sales-consultative/);
  assert.doesNotMatch(source, /runSalesConsultativeService/);
  assert.doesNotMatch(source, /processSalesInbound/);
});

test("runNativeAutonomousCycle does not reference the legacy sales-consultative engine", () => {
  const source = readFileSync(resolve(ROOT, "lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts"), "utf8");
  assert.doesNotMatch(source, /sales-consultative/);
  assert.doesNotMatch(source, /runSalesConsultativeService/);
  assert.doesNotMatch(source, /processSalesInbound/);
});

test("middleware.ts (root-level request runtime, outside app/lib/scripts/components) does not reference the legacy sales-consultative engine", () => {
  const source = readFileSync(resolve(ROOT, "middleware.ts"), "utf8");
  assert.doesNotMatch(source, /sales-consultative/);
  assert.doesNotMatch(source, /runSalesConsultativeService/);
  assert.doesNotMatch(source, /processSalesInbound/);
});

test("the legacy disabled-state throw is a named domain error, not a generic Error", () => {
  const source = readFileSync(resolve(ROOT, "lib/brain/native-whatsapp/service.ts"), "utf8");
  assert.doesNotMatch(source, /throw new Error\(["']legacy_sales_consultative_disabled["']\)/);
  assert.match(source, /throw new LegacySalesConsultativeDisabledError\(\)/);

  const configSource = readFileSync(resolve(ROOT, "lib/brain/commercial/config/commercialCycleConfig.ts"), "utf8");
  assert.match(configSource, /class LegacySalesConsultativeDisabledError extends Error/);
});

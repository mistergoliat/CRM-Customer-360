import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * LLM-R1-T05 safety requirement: offline mode must never be able to reach
 * Meta/WhatsApp/outbox. Since these modules are only reachable through an
 * explicit ESM import, a static import-list check on every source file the
 * offline benchmark path actually runs is a reliable, honest proxy for "this
 * code cannot touch that system" - not a mock that could itself be wrong.
 */
const BENCHMARK_DIR = path.join(process.cwd(), "lib", "brain", "commercial", "agent-loop", "benchmark");
const OFFLINE_PATH_SOURCE_FILES = ["types.ts", "validateCorpus.ts", "scoring.ts", "metrics.ts", "offlineProvider.ts", "instrumentedProvider.ts", "environment.ts", "runCorpus.ts"];
const FORBIDDEN_IMPORT_PATTERN = /from\s+["'][^"']*(whatsapp|outbox|messaging|meta-?client|meta-?graph)[^"']*["']/i;

test("[T05] offline benchmark source files never import WhatsApp/outbox/Meta messaging modules", () => {
  for (const fileName of OFFLINE_PATH_SOURCE_FILES) {
    const source = readFileSync(path.join(BENCHMARK_DIR, fileName), "utf8");
    assert.doesNotMatch(source, FORBIDDEN_IMPORT_PATTERN, `${fileName} must not import a WhatsApp/outbox/Meta messaging module`);
  }
});

test("[T05] environment.ts only ever binds its Catalog Service mock to the loopback interface", () => {
  const source = readFileSync(path.join(BENCHMARK_DIR, "environment.ts"), "utf8");
  assert.match(source, /server\.listen\(0,\s*"127\.0\.0\.1"/, "the benchmark Catalog Service mock must bind to 127.0.0.1 only");
});

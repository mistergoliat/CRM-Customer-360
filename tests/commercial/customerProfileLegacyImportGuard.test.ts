import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const filesToGuard = [
  "lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts",
  "lib/brain/commercial/customer-profile-context/types.ts",
  "lib/brain/commercial/customer-profile-context/config.ts",
  "lib/brain/commercial/customer-profile-context/loader.ts",
  "lib/brain/commercial/customer-profile-context/policy.ts",
  "lib/brain/commercial/customer-profile-context/summary.ts",
  "lib/brain/commercial/customer-profile-context/compareRecommendationsWithPurchaseHistory.ts"
];

test("T12C wiring never imports the legacy customer-profile adapter module", () => {
  for (const relativePath of filesToGuard) {
    const absolutePath = path.join(repoRoot, relativePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    assert.doesNotMatch(source, /@\/lib\/customer-profile(?:\/|["'])|(?:\.\.\/)+customer-profile(?:\/|["'])|lib\/customer-profile(?:\/|["'])/, relativePath);
  }
});

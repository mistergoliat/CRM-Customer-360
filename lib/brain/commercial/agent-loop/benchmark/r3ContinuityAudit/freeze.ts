import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildContinuityStressPlans } from "./stressPlans/index";

/**
 * P7.13 (task section 43). Same discipline as P7.12's computeFreezeHashes:
 * every file this diagnostic's OWN new logic lives in, plus every reused
 * P7.4-P7.12 file it depends on for behavior that must not drift mid-run,
 * plus a content hash of the generated stress plans. Congelado antes del
 * smoke; the main run refuses to start if anything here changed.
 */

const B = "lib/brain/commercial/agent-loop/benchmark";
const C = `${B}/r3ContinuityAudit`;

export const CONTINUITY_FREEZE_FILE_GROUPS: Record<string, string[]> = {
  continuityHarness: [`${C}/continuitySession.ts`, `${C}/runContinuityAudit.ts`],
  continuityAnalysis: [`${C}/continuityAnalysis.ts`, `${C}/summary.ts`, `${C}/toolSurfaceHash.ts`, `${C}/falseSuccessDetector.ts`],
  stressPlans: [`${C}/stressPlans/shared.ts`, `${C}/stressPlans/index.ts`],
  reusedRuntime: [`${B}/r3CommercialE2E/runCommercialE2ECase.ts`, `${B}/r3CommercialE2E/benchmarkOverrides.ts`, `${B}/r3CommercialE2E/durableStateSnapshot.ts`, `${B}/r3CommercialE2E/buildTurnTrace.ts`, `${B}/r3CommercialE2E/environmentHealthPrecheck.ts`],
  reusedClassifier: [`${B}/r3MutationSemantics/confirmationClassifier.ts`, "tests/agent-loop/benchmark/r3MutationSemantics/goldenConfirmations.json"],
  reusedFixtures: [`${B}/r3StableAgentV1/environment.ts`, `${B}/environment.ts`],
  falseSuccessGolden: ["tests/agent-loop/benchmark/r3ContinuityAudit/goldenFalseSuccess.json"]
};

export const sha256File = (path: string): string => createHash("sha256").update(readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n")).digest("hex");
export const sha256Text = (text: string): string => createHash("sha256").update(text).digest("hex");

export function computeContinuityFreezeHashes(): Record<string, Record<string, string>> {
  const plans = buildContinuityStressPlans();
  return {
    ...Object.fromEntries(Object.entries(CONTINUITY_FREEZE_FILE_GROUPS).map(([group, files]) => [group, Object.fromEntries(files.map((file) => [file, sha256File(file)]))])),
    plans: { sha256: sha256Text(JSON.stringify(plans)) }
  };
}

export function diffContinuityFreeze(expected: Record<string, Record<string, string>>, actual: Record<string, Record<string, string>>): string[] {
  const changed: string[] = [];
  for (const [group, files] of Object.entries(expected)) for (const [file, hash] of Object.entries(files)) if (actual[group]?.[file] !== hash) changed.push(`${group}:${file}`);
  return changed;
}

import type { BenchmarkE2EArtifactBundle } from "./types";

/**
 * SALES-AGENT-R3-P7.4 (Section "OUTPUT ARTIFACTS"). Pure serialization only -
 * no fs access here (the CLI script owns mkdirSync/writeFileSync, same
 * separation scripts/r3-stable-agent-benchmark.ts already establishes
 * between report.ts's pure builders and its own file writes). No PII: every
 * field in BenchmarkE2ERunTrace is already a bounded, typed projection
 * (customerMessage/finalMessage are the corpus's own fixed strings in
 * offline mode, and this repo's benchmark corpora never encode real
 * customer data by design - same discipline as the legacy corpus).
 */
export type BenchmarkE2EArtifactFiles = {
  "manifest.json": string;
  "runs.jsonl": string;
  "summary.json": string;
  "failures.json": string;
};

export function buildArtifactFiles(bundle: BenchmarkE2EArtifactBundle): BenchmarkE2EArtifactFiles {
  return {
    "manifest.json": JSON.stringify(bundle.manifest, null, 2),
    "runs.jsonl": bundle.runs.map((run) => JSON.stringify(run)).join("\n"),
    "summary.json": JSON.stringify(bundle.summary, null, 2),
    "failures.json": JSON.stringify(bundle.failures, null, 2)
  };
}

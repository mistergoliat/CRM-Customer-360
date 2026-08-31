import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, "..", "results");
const files = readdirSync(resultsDir).filter((f) => f.endsWith(".r2-planner.json"));

const rows = [];
for (const file of files) {
  const j = JSON.parse(readFileSync(join(resultsDir, file), "utf8"));
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let llmCalls = 0;
  const outcomes = [];
  const plans = [];

  for (const turn of j.turns) {
    llmCalls++;
    inputTokens += turn.inputTokens ?? 0;
    outputTokens += turn.outputTokens ?? 0;
    reasoningTokens += turn.reasoningTokens ?? 0;
    outcomes.push(turn.outcome);
    plans.push(turn.extractedPlan);
  }

  rows.push({
    scenarioId: j.scenarioId,
    category: j.category,
    turnCount: j.turns.length,
    totalElapsedMs: j.totalElapsedMs,
    llmCalls,
    inputTokens,
    outputTokens,
    reasoningTokens,
    outcomes,
    plans
  });
}

rows.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId, undefined, { numeric: true }));
writeFileSync(join(here, "r2-aggregate.json"), JSON.stringify(rows, null, 2));

const totals = rows.reduce(
  (acc, r) => ({
    scenarios: acc.scenarios + 1,
    turns: acc.turns + r.turnCount,
    llmCalls: acc.llmCalls + r.llmCalls,
    inputTokens: acc.inputTokens + r.inputTokens,
    outputTokens: acc.outputTokens + r.outputTokens,
    reasoningTokens: acc.reasoningTokens + r.reasoningTokens,
    elapsedMs: acc.elapsedMs + r.totalElapsedMs
  }),
  { scenarios: 0, turns: 0, llmCalls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, elapsedMs: 0 }
);

console.log(JSON.stringify(totals, null, 2));
console.log("per-turn averages:", {
  llmCallsPerTurn: (totals.llmCalls / totals.turns).toFixed(2),
  inputTokensPerTurn: Math.round(totals.inputTokens / totals.turns),
  outputTokensPerTurn: Math.round(totals.outputTokens / totals.turns),
  reasoningTokensPerTurn: Math.round(totals.reasoningTokens / totals.turns),
  reasoningShareOfOutput: ((totals.reasoningTokens / totals.outputTokens) * 100).toFixed(1) + "%",
  wallMsPerTurn: Math.round(totals.elapsedMs / totals.turns)
});

const invalidCount = rows.reduce((n, r) => n + r.outcomes.filter((o) => o !== "valid" && o !== "success").length, 0);
console.log("non-valid outcomes:", invalidCount, "/", totals.turns);

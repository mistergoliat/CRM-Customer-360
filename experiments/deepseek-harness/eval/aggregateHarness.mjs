import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, "..", "results");
const files = readdirSync(resultsDir).filter((f) => f.endsWith(".harness.json"));

const rows = [];
for (const file of files) {
  const j = JSON.parse(readFileSync(join(resultsDir, file), "utf8"));
  let toolCalls = 0;
  let modelSteps = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cacheReadTokens = 0;
  const toolNames = [];
  const finalResponses = [];

  for (const turn of j.turns) {
    for (const event of turn.rawEvents) {
      if (event.type === "tool/call") {
        toolCalls++;
        toolNames.push(event.data.name);
      }
      if (event.type === "assistant/message") {
        modelSteps++;
        const usage = event.data.usage ?? {};
        inputTokens += usage.inputTokens ?? 0;
        outputTokens += usage.outputTokens ?? 0;
        reasoningTokens += usage.reasoningTokens ?? 0;
        cacheReadTokens += usage.cacheReadTokens ?? 0;
      }
    }
    finalResponses.push(turn.assistantResponse);
  }

  rows.push({
    scenarioId: j.scenarioId,
    category: j.category,
    turnCount: j.turns.length,
    totalElapsedMs: j.totalElapsedMs,
    toolCalls,
    toolNames,
    modelSteps,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    finalResponses
  });
}

rows.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId, undefined, { numeric: true }));
writeFileSync(join(here, "harness-aggregate.json"), JSON.stringify(rows, null, 2));

const totals = rows.reduce(
  (acc, r) => ({
    scenarios: acc.scenarios + 1,
    turns: acc.turns + r.turnCount,
    toolCalls: acc.toolCalls + r.toolCalls,
    modelSteps: acc.modelSteps + r.modelSteps,
    inputTokens: acc.inputTokens + r.inputTokens,
    outputTokens: acc.outputTokens + r.outputTokens,
    reasoningTokens: acc.reasoningTokens + r.reasoningTokens,
    cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
    elapsedMs: acc.elapsedMs + r.totalElapsedMs
  }),
  { scenarios: 0, turns: 0, toolCalls: 0, modelSteps: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, elapsedMs: 0 }
);

console.log(JSON.stringify(totals, null, 2));
console.log("per-turn averages:", {
  toolCallsPerTurn: (totals.toolCalls / totals.turns).toFixed(2),
  modelStepsPerTurn: (totals.modelSteps / totals.turns).toFixed(2),
  inputTokensPerTurn: Math.round(totals.inputTokens / totals.turns),
  outputTokensPerTurn: Math.round(totals.outputTokens / totals.turns),
  reasoningTokensPerTurn: Math.round(totals.reasoningTokens / totals.turns),
  reasoningShareOfOutput: ((totals.reasoningTokens / totals.outputTokens) * 100).toFixed(1) + "%",
  wallMsPerTurn: Math.round(totals.elapsedMs / totals.turns)
});

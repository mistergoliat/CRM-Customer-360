export * from "./types";
export * from "./constants";
export * from "./scenarioCatalog";
export * from "./validateScenarioDefinition";
export * from "./compareScenarioExpectation";
export * from "./validateScenarioInvariants";
export * from "./buildScenarioReport";
export * from "./executeScenarioStep";
export * from "./executeScenario";
export * from "./inMemoryScenarioRuntime";

import type { ScenarioExecutionResult, ScenarioReportExport, ScenarioSafeReport } from "./types";

function normalizeReport(input: ScenarioExecutionResult | ScenarioSafeReport): ScenarioSafeReport {
  if ("scenario" in input && "result" in input && "steps" in input && "failures" in input) {
    return input;
  }
  return input.report;
}

export function exportScenarioSafeResult(result: ScenarioExecutionResult | ScenarioSafeReport): string {
  const report = normalizeReport(result);
  const payload: ScenarioReportExport = "runId" in result
    ? {
        runId: result.runId,
        scenarioId: result.scenarioId,
        scenarioName: result.scenarioName,
        report
      }
    : {
        runId: "scenario-report:standalone",
        scenarioId: report.scenario.id,
        scenarioName: report.scenario.name,
        report
      };
  return JSON.stringify(payload, null, 2);
}

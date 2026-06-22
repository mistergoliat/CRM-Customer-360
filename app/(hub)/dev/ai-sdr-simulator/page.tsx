import { ScenarioSimulatorPanel } from "@/components/cases/ai-sdr/scenario-simulator/ScenarioSimulatorPanel";
import {
  SCENARIO_CATALOG,
  executeScenario,
  exportScenarioSafeResult,
  type ScenarioExecutionMode,
  type ScenarioExecutionResult
} from "@/lib/brain/commercial/scenario-simulator";

type SimulatorPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getParam(searchParams: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function parseMode(value: string | undefined): ScenarioExecutionMode {
  if (value === "observe" || value === "simulate" || value === "execute_fake") return value;
  return "simulate";
}

function buildScenarioFlags() {
  return {
    enabled: process.env.BRAIN_SCENARIO_SIMULATOR_ENABLED === "true",
    allowExecuteFake: process.env.BRAIN_SCENARIO_SIMULATOR_ALLOW_EXECUTE_FAKE === "true"
  };
}

export const dynamic = "force-dynamic";

export default async function AiSdrSimulatorPage({ searchParams }: SimulatorPageProps) {
  const sp = await searchParams;
  const flags = buildScenarioFlags();
  const selectedScenarioId = getParam(sp, "scenarioId") ?? SCENARIO_CATALOG[0]?.scenarioId ?? "";
  const requestedMode = parseMode(getParam(sp, "mode"));
  const selectedMode = requestedMode === "execute_fake" && !flags.allowExecuteFake ? "simulate" : requestedMode;
  const selectedScenario = SCENARIO_CATALOG.find((scenario) => scenario.scenarioId === selectedScenarioId) ?? SCENARIO_CATALOG[0];

  let result: ScenarioExecutionResult | null = null;
  let reportJson: string | null = null;
  if (flags.enabled && selectedScenario) {
    const scenario = structuredClone(selectedScenario);
    scenario.steps = scenario.steps.map((step) => ({
      ...step,
      mode: step.mode === "execute_fake" && !flags.allowExecuteFake ? "simulate" : selectedMode,
      input: {
        ...step.input,
        mode: step.mode === "execute_fake" && !flags.allowExecuteFake ? "simulate" : selectedMode
      }
    }));
    result = await executeScenario(scenario);
    reportJson = exportScenarioSafeResult(result);
  }

  return (
    <ScenarioSimulatorPanel
      scenarios={SCENARIO_CATALOG}
      selectedScenarioId={selectedScenario?.scenarioId ?? selectedScenarioId}
      selectedMode={selectedMode}
      enabled={flags.enabled}
      allowExecuteFake={flags.allowExecuteFake}
      result={result}
      reportJson={reportJson}
    />
  );
}

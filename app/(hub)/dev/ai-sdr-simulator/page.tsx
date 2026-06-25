import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { ScenarioSimulatorPanel } from "@/components/cases/ai-sdr/scenario-simulator/ScenarioSimulatorPanel";
import {
  SCENARIO_CATALOG,
  executeScenario,
  exportScenarioSafeResult,
  type ScenarioExecutionMode,
  type ScenarioExecutionResult
} from "@/lib/brain/commercial/scenario-simulator";
import { getLocalAiSdrOverview } from "@/lib/brain/local-ai-sdr";
import { LocalAiSdrSimulatorPanel } from "@/components/dev/ai-sdr";

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
  const localOverview = await getLocalAiSdrOverview(getParam(sp, "conversationId"));

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
    <div>
      <PageHeader
        eyebrow="AI SDR"
        title="Local Operational Simulator"
        description="Loop local para inbound, lookup, creación y vínculo de clientes reales sobre MariaDB. El simulador legacy se mantiene debajo como sandbox histórico."
        status={localOverview.writeEnabled ? "Local ready" : "Read only"}
        actions={
          <>
            <StatusChip label={localOverview.executionMode} tone={localOverview.executionMode === "simulate" ? "blue" : "gray"} />
            <StatusChip label={localOverview.writeEnabled ? "writes on" : "writes off"} tone={localOverview.writeEnabled ? "green" : "amber"} />
          </>
        }
      />

      <LocalAiSdrSimulatorPanel overview={localOverview} />

      <details className="mt-8 rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
          Legacy scenario simulator
        </summary>
        <div className="mt-4">
          <ScenarioSimulatorPanel
            scenarios={SCENARIO_CATALOG}
            selectedScenarioId={selectedScenario?.scenarioId ?? selectedScenarioId}
            selectedMode={selectedMode}
            enabled={flags.enabled}
            allowExecuteFake={flags.allowExecuteFake}
            result={result}
            reportJson={reportJson}
          />
        </div>
      </details>

      {/* Legacy flags kept for commercial scenario tests: BRAIN_SCENARIO_SIMULATOR_ENABLED / BRAIN_SCENARIO_SIMULATOR_ALLOW_EXECUTE_FAKE */}
    </div>
  );
}

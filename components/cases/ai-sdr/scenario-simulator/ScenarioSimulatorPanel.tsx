import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import type { ScenarioDefinition, ScenarioExecutionMode, ScenarioExecutionResult } from "@/lib/brain/commercial/scenario-simulator";
import { ScenarioInvariantList } from "./ScenarioInvariantList";
import { ScenarioRunSummary } from "./ScenarioRunSummary";
import { ScenarioSelector } from "./ScenarioSelector";
import { ScenarioStateDiff } from "./ScenarioStateDiff";
import { ScenarioTimeline } from "./ScenarioTimeline";

type ScenarioSimulatorPanelProps = {
  scenarios: readonly ScenarioDefinition[];
  selectedScenarioId: string;
  selectedMode: ScenarioExecutionMode;
  enabled: boolean;
  allowExecuteFake: boolean;
  result: ScenarioExecutionResult | null;
  reportJson: string | null;
};

export function ScenarioSimulatorPanel({
  scenarios,
  selectedScenarioId,
  selectedMode,
  enabled,
  allowExecuteFake,
  result,
  reportJson
}: ScenarioSimulatorPanelProps) {
  const selectedScenario = scenarios.find((scenario) => scenario.scenarioId === selectedScenarioId) ?? scenarios[0] ?? null;

  return (
    <>
      <PageHeader
        eyebrow="AI SDR"
        title="End-to-End Scenario Simulator"
        description="Capa read-only para ejecutar escenarios sintéticos, comparar expectativas, inspeccionar invariantes y exportar evidencia segura."
        status={enabled ? "Active" : "Disabled"}
        actions={
          <>
            <StatusChip label={selectedMode} tone={selectedMode === "execute_fake" ? "blue" : selectedMode === "simulate" ? "amber" : "gray"} />
            <StatusChip label={allowExecuteFake ? "fake enabled" : "fake off"} tone={allowExecuteFake ? "green" : "amber"} />
          </>
        }
      />

      {!enabled ? (
        <section className="rounded-[28px] border border-amber-200 bg-amber-50 p-4 text-amber-900">
          El simulador estÃ¡ desactivado por defecto. Activa `BRAIN_SCENARIO_SIMULATOR_ENABLED=true` en la boundary de desarrollo para ejecutar escenarios.
        </section>
      ) : null}

      {selectedScenario ? (
        <div className="mt-6 grid gap-6">
          <ScenarioSelector
            scenarios={scenarios}
            selectedScenarioId={selectedScenario.scenarioId}
            selectedMode={selectedMode}
            enabled={enabled}
            allowExecuteFake={allowExecuteFake}
          />
          <ScenarioRunSummary result={result} />
          <ScenarioTimeline result={result} />
          <div className="grid gap-6 xl:grid-cols-2">
            <ScenarioInvariantList result={result} />
            <ScenarioStateDiff result={result} />
          </div>
          <section className="rounded-[28px] border border-slate-200 bg-slate-950 p-4 text-slate-100">
            <p className="text-label-bold uppercase text-slate-400">Scenario report JSON</p>
            <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-200">
              {reportJson ?? "No report available."}
            </pre>
          </section>
        </div>
      ) : null}
    </>
  );
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScenarioSimulatorPanel = ScenarioSimulatorPanel;
const PageHeader_1 = require("@/components/ui/PageHeader");
const StatusChip_1 = require("@/components/ui/StatusChip");
const ScenarioInvariantList_1 = require("./ScenarioInvariantList");
const ScenarioRunSummary_1 = require("./ScenarioRunSummary");
const ScenarioSelector_1 = require("./ScenarioSelector");
const ScenarioStateDiff_1 = require("./ScenarioStateDiff");
const ScenarioTimeline_1 = require("./ScenarioTimeline");
function ScenarioSimulatorPanel({ scenarios, selectedScenarioId, selectedMode, enabled, allowExecuteFake, result, reportJson }) {
    const selectedScenario = scenarios.find((scenario) => scenario.scenarioId === selectedScenarioId) ?? scenarios[0] ?? null;
    return (<>
      <PageHeader_1.PageHeader eyebrow="AI SDR" title="End-to-End Scenario Simulator" description="Capa read-only para ejecutar escenarios sintéticos, comparar expectativas, inspeccionar invariantes y exportar evidencia segura." status={enabled ? "Active" : "Disabled"} actions={<>
            <StatusChip_1.StatusChip label={selectedMode} tone={selectedMode === "execute_fake" ? "blue" : selectedMode === "simulate" ? "amber" : "gray"}/>
            <StatusChip_1.StatusChip label={allowExecuteFake ? "fake enabled" : "fake off"} tone={allowExecuteFake ? "green" : "amber"}/>
          </>}/>

      {!enabled ? (<section className="rounded-[28px] border border-amber-200 bg-amber-50 p-4 text-amber-900">
          El simulador estÃ¡ desactivado por defecto. Activa `BRAIN_SCENARIO_SIMULATOR_ENABLED=true` en la boundary de desarrollo para ejecutar escenarios.
        </section>) : null}

      {selectedScenario ? (<div className="mt-6 grid gap-6">
          <ScenarioSelector_1.ScenarioSelector scenarios={scenarios} selectedScenarioId={selectedScenario.scenarioId} selectedMode={selectedMode} enabled={enabled} allowExecuteFake={allowExecuteFake}/>
          <ScenarioRunSummary_1.ScenarioRunSummary result={result}/>
          <ScenarioTimeline_1.ScenarioTimeline result={result}/>
          <div className="grid gap-6 xl:grid-cols-2">
            <ScenarioInvariantList_1.ScenarioInvariantList result={result}/>
            <ScenarioStateDiff_1.ScenarioStateDiff result={result}/>
          </div>
          <section className="rounded-[28px] border border-slate-200 bg-slate-950 p-4 text-slate-100">
            <p className="text-label-bold uppercase text-slate-400">Scenario report JSON</p>
            <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-200">
              {reportJson ?? "No report available."}
            </pre>
          </section>
        </div>) : null}
    </>);
}

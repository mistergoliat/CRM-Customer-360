import Link from "next/link";
import { StatusChip } from "@/components/ui/StatusChip";
import type { ScenarioDefinition, ScenarioExecutionMode } from "@/lib/brain/commercial/scenario-simulator";

type ScenarioSelectorProps = {
  scenarios: readonly ScenarioDefinition[];
  selectedScenarioId: string;
  selectedMode: ScenarioExecutionMode;
  enabled: boolean;
  allowExecuteFake: boolean;
};

export function ScenarioSelector({
  scenarios,
  selectedScenarioId,
  selectedMode,
  enabled,
  allowExecuteFake
}: ScenarioSelectorProps) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white/95 p-4 shadow-[0_24px_90px_-45px_rgba(15,23,42,0.35)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-label-bold uppercase text-slate-500">Scenario</p>
          <h2 className="mt-1 text-headline-md text-on-surface">Selector</h2>
          <p className="mt-2 max-w-2xl text-body-md text-slate-600">
            Escenarios sintéticos, determinísticos y read-only para validar el loop autónomo extremo a extremo.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusChip label={enabled ? "enabled" : "disabled"} tone={enabled ? "green" : "amber"} />
          <StatusChip label={allowExecuteFake ? "execute_fake" : "simulate_only"} tone={allowExecuteFake ? "blue" : "gray"} />
        </div>
      </div>

      <form method="get" action="/dev/ai-sdr-simulator" className="mt-4 grid gap-3 lg:grid-cols-[1.3fr_0.8fr_auto]">
        <label className="grid gap-2">
          <span className="text-label-sm uppercase text-slate-500">Escenario</span>
          <select
            name="scenarioId"
            defaultValue={selectedScenarioId}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-body-md text-on-surface outline-none ring-0 transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {scenarios.map((scenario) => (
              <option key={scenario.scenarioId} value={scenario.scenarioId}>
                {scenario.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-label-sm uppercase text-slate-500">Mode</span>
          <select
            name="mode"
            defaultValue={selectedMode}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-body-md text-on-surface outline-none ring-0 transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="observe">observe</option>
            <option value="simulate">simulate</option>
            <option value="execute_fake" disabled={!allowExecuteFake}>
              execute_fake
            </option>
          </select>
        </label>

        <div className="flex items-end gap-2">
          <button type="submit" className="hub-button-primary w-full">
            Ejecutar
          </button>
          <Link href="/dev/ai-sdr-simulator" className="hub-button-ghost">
            Reiniciar
          </Link>
        </div>
      </form>
    </section>
  );
}

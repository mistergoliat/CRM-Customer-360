import { StatusChip } from "@/components/ui/StatusChip";
import type { ScenarioExecutionResult } from "@/lib/brain/commercial/scenario-simulator";

function toneForStatus(status: string) {
  const text = status.toLowerCase();
  if (text.includes("fail") || text.includes("invalid") || text.includes("blocked")) return "red" as const;
  if (text.includes("pass") || text.includes("complete") || text.includes("deliver")) return "green" as const;
  if (text.includes("partial") || text.includes("wait") || text.includes("retry")) return "amber" as const;
  return "gray" as const;
}

type ScenarioRunSummaryProps = {
  result: ScenarioExecutionResult | null;
};

export function ScenarioRunSummary({ result }: ScenarioRunSummaryProps) {
  if (!result) {
    return (
      <section className="rounded-[28px] border border-dashed border-slate-300 bg-white/70 p-4 text-slate-500">
        Ejecuta un escenario para ver un resumen seguro del run.
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white/95 p-4 shadow-[0_24px_90px_-45px_rgba(15,23,42,0.35)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-label-bold uppercase text-slate-500">Run</p>
          <h2 className="mt-1 text-headline-md text-on-surface">{result.scenarioName}</h2>
          <p className="mt-2 text-body-md text-slate-600">{result.scenarioId}</p>
        </div>
        <StatusChip label={result.status} tone={toneForStatus(result.status)} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-label-sm uppercase text-slate-500">Steps</p>
          <p className="mt-1 text-headline-md text-on-surface">{result.summary.totalSteps}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-label-sm uppercase text-slate-500">Expectations</p>
          <p className="mt-1 text-headline-md text-on-surface">{result.summary.passedExpectations}/{result.summary.totalExpectations}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-label-sm uppercase text-slate-500">Invariants</p>
          <p className="mt-1 text-headline-md text-on-surface">{result.summary.passedInvariants}/{result.summary.totalInvariants}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-label-sm uppercase text-slate-500">Logical ms</p>
          <p className="mt-1 text-headline-md text-on-surface">{result.report.result.durationLogicalMs}</p>
        </div>
      </div>
    </section>
  );
}

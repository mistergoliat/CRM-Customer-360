"use client";

import { StatCard } from "@/components/ui/StatCard";
import type { AudienceEvaluationSummary } from "@/lib/marketing/customerIntelligenceAudience";

export function AudienceSummary({ summary }: { readonly summary: AudienceEvaluationSummary }) {
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Poblacion evaluada" value={summary.population.toLocaleString("es-CL")} icon="groups" state="muted" />
        <StatCard title="Clientes en audiencia" value={summary.matched.toLocaleString("es-CL")} icon="check_circle" state="ok" />
        <StatCard title="Fuera de audiencia" value={summary.notMatched.toLocaleString("es-CL")} icon="cancel" state="muted" />
        <StatCard title="Sin datos suficientes" value={summary.unknown.toLocaleString("es-CL")} icon="help" state={summary.unknown > 0 ? "warning" : "muted"} />
      </div>

      <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-label-bold uppercase text-slate-500">Detalle avanzado</summary>
        <dl className="mt-2 grid gap-2 text-body-sm text-slate-600 sm:grid-cols-3">
          <div>
            <dt className="text-label-sm uppercase text-slate-400">Checksum de definicion</dt>
            <dd className="font-mono">{summary.definitionChecksum ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-label-sm uppercase text-slate-400">Referencia analitica</dt>
            <dd>{summary.referenceTime ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-label-sm uppercase text-slate-400">Feature snapshot</dt>
            <dd className="font-mono">{summary.snapshotId ?? "-"}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

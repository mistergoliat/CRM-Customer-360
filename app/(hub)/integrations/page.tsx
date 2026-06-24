import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { getIntegrationsViewModel } from "@/lib/p1m/read-models";
import { stateForTone } from "@/lib/status";

export default function IntegrationsPage() {
  const data = getIntegrationsViewModel();
  const selected = data.selected;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sistema"
        title="Integraciones"
        description="Salud, cobertura, latencia y detalle lateral de cada integración."
        status="Parcial"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <SectionCard title="Estado de integraciones" eyebrow="Connectivity" description="Cada fila muestra cobertura y latencia.">
          <div className="space-y-3">
            {data.rows.map((row) => (
              <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-on-surface">{row.name}</p>
                    <p className="text-label-sm text-slate-500">{row.type}</p>
                  </div>
                  <StatusChip label={row.status} tone={row.status === "Connected" ? "green" : row.status === "Delayed" ? "amber" : "gray"} />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-label-sm text-slate-500">Sync</p>
                    <p className="mt-1 text-body-md font-semibold text-on-surface">{row.synced}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-label-sm text-slate-500">Cobertura</p>
                    <p className="mt-1 text-body-md font-semibold text-on-surface">{row.coverage}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-label-sm text-slate-500">Latencia</p>
                    <p className="mt-1 text-body-md font-semibold text-on-surface">{row.latency}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-label-sm text-slate-500">Warning</p>
                    <p className="mt-1 text-body-md font-semibold text-on-surface">{row.warning}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Detalle" eyebrow="Selected" description={selected.name}>
          <InfoGrid
            items={[
              { label: "Status", value: selected.status },
              { label: "Coverage", value: selected.coverage },
              { label: "Synced", value: selected.synced },
              { label: "Latency", value: selected.latency },
              { label: "Warning", value: selected.warning }
            ]}
            columns={3}
          />
          <div className="mt-4">
            <p className="text-label-bold uppercase text-slate-500">Datos disponibles</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {selected.data.map((item) => <StatusChip key={item} label={item} tone="blue" />)}
            </div>
          </div>
          <div className="mt-4">
            <p className="text-label-bold uppercase text-slate-500">Notas</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
              {selected.notes.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div className="mt-4 grid gap-2">
            <button className="hub-button-primary" type="button" disabled>
              Inspeccionar
            </button>
            <button className="hub-button-secondary" type="button" disabled>
              Reintentar sync
            </button>
          </div>
        </SectionCard>
      </section>
    </div>
  );
}

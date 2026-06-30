import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { getKnowledgeViewModel } from "@/lib/p1m/read-models";
import { stateForTone } from "@/lib/status";

export default function KnowledgePage() {
  const data = getKnowledgeViewModel();
  const selected = data.selected;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inteligencia"
        title="Biblioteca de conocimiento"
        description="Master-detail rico para artículos, versiones, vigencia y señales de uso."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_360px]">
        <SectionCard title="Biblioteca" eyebrow="Knowledge library" description="Búsqueda y filtros visuales.">
          <div className="flex flex-wrap gap-2">
            {["Ventas", "Postventa", "CRM", "Marketing", "Operación"].map((filter, index) => (
              <StatusChip key={filter} label={filter} tone={index === 0 ? "blue" : "gray"} />
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {data.rows.map((row) => (
              <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-on-surface">{row.title}</p>
                    <p className="text-label-sm text-slate-500">{row.category} · {row.owner}</p>
                  </div>
                  <StatusChip label={row.status} tone={row.status === "Activo" ? "green" : "amber"} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-label-sm text-slate-500">
                  <span>Vigencia: {row.freshness}</span>
                  <span>Confianza: {row.confidence}</span>
                  <span>Uso: {row.usage}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title={selected.title} eyebrow="Article" description={selected.summary}>
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {selected.breadcrumb.map((item) => <StatusChip key={item} label={item} tone="gray" />)}
            </div>
            <InfoGrid items={selected.metadata} columns={3} />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Resumen</p>
                <p className="mt-2 text-body-md text-slate-700">{selected.summary}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Fuente</p>
                <p className="mt-2 text-body-md text-slate-700">{selected.source}</p>
              </div>
            </div>
            {selected.sections.map((section) => (
              <div key={section.title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-label-bold uppercase text-slate-500">{section.title}</p>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-body-md text-slate-700">
                  {section.body.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {selected.related.map((item) => <StatusChip key={item} label={item} tone="blue" />)}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Metadatos" eyebrow="Detail" description="Atribución, uso y gaps detectados.">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Versión</p>
              <p className="mt-2 text-headline-md text-on-surface">{selected.version}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Estado</p>
              <p className="mt-2 text-body-md text-slate-700">{selected.status}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Propietario</p>
              <p className="mt-2 text-body-md text-slate-700">{selected.owner}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Audiencia</p>
              <p className="mt-2 text-body-md text-slate-700">{selected.audience}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Confianza</p>
              <p className="mt-2 text-body-md text-slate-700">{selected.confidence}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Gaps</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
                {selected.gaps.map((gap) => <li key={gap}>{gap}</li>)}
              </ul>
            </div>
          </div>
        </SectionCard>
      </section>
    </div>
  );
}

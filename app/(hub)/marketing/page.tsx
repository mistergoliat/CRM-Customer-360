import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { SectionCard } from "@/components/p1m/SectionCard";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { getMarketingOverviewViewModel } from "@/lib/p1m/read-models";
import { stateForTone } from "@/lib/status";

export default function MarketingPage() {
  const data = getMarketingOverviewViewModel();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Crecimiento"
        title="Marketing"
        description="Resumen del módulo de crecimiento con campañas, segmentos, automatizaciones y recomendaciones."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <SectionCard title="Campañas activas" eyebrow="Campaigns" description="Entrada rápida al estado de campañas.">
          <div className="space-y-3">
            {data.campaigns.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="font-semibold text-on-surface">{item.label}</p>
                  <p className="text-label-sm text-slate-500">{item.value}</p>
                </div>
                <StatusChip label={item.state} tone={item.state === "Activa" ? "green" : item.state === "Programada" ? "amber" : "blue"} />
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Segmentos destacados" eyebrow="Segments" description="Segmentos visibles y su cobertura.">
          <div className="space-y-3">
            {data.segments.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="font-semibold text-on-surface">{item.label}</p>
                  <p className="text-label-sm text-slate-500">{item.value}</p>
                </div>
                <StatusChip label={item.state} tone={item.state === "Activa" ? "green" : "amber"} />
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Recomendaciones AI" eyebrow="Copilot" description="Sugerencias de dirección visual para campañas.">
          <ul className="list-disc space-y-2 pl-5 text-body-md text-slate-700">
            {data.recommendations.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]" id="performance">
        <SectionCard title="Rendimiento" eyebrow="Performance" description="Métricas visibles sin backend real." >
          <div className="grid gap-4 md:grid-cols-3">
            {data.performance.map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">{item.label}</p>
                <p className="mt-2 text-headline-md text-on-surface">{item.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2" id="templates">
            {data.templates.map((item) => <StatusChip key={item} label={item} tone="blue" />)}
          </div>
        </SectionCard>

        <SectionCard title="Automatizaciones activas" eyebrow="Automations" description="Resumen de automatizaciones relacionadas.">
          <div className="space-y-3">
            {data.automations.map((item) => (
              <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="font-semibold text-on-surface">{item.label}</p>
                <StatusChip label={item.value} tone={item.value === "Activa" ? "green" : "amber"} className="mt-2" />
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-2">
            <Link href="/marketing/copilot" className="hub-button-primary">Ir al copilot</Link>
            <Link href="/marketing/segments" className="hub-button-secondary">Ver segmentos</Link>
          </div>
        </SectionCard>
      </section>
    </div>
  );
}

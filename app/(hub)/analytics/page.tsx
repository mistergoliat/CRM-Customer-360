import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { ChartCard } from "@/components/p1m/ChartCard";
import { getAnalyticsViewModel } from "@/lib/p1m/read-models";
import { stateForTone } from "@/lib/status";

export default function AnalyticsPage() {
  const data = getAnalyticsViewModel();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inteligencia"
        title="Analítica"
        description="Dashboard transversal con foco comercial, servicio, marketing, IA y calidad de datos."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <ChartCard title="Funnel comercial" eyebrow="Comercial" description="Etapas de pipeline y volumen." series={data.funnel} />
        <ChartCard title="Costo y ahorro" eyebrow="IA" description="Escala de costo y ROI mensual." series={data.monthly} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ChartCard title="Servicio" eyebrow="Support" description="Casos por categoría y SLA." series={data.service} />
        <ChartCard title="Marketing" eyebrow="Growth" description="Open rate, CTR, conversion y opt-out." series={data.marketing} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ChartCard title="IA" eyebrow="Copilot" description="Tokens, acciones y override rate." series={data.ai} />
        <ChartCard title="Calidad de datos" eyebrow="Data" description="Cobertura y conflictos de identidad." series={data.quality} />
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <SectionCard title="Calidad de datos" eyebrow="Tables" description="Cobertura y frescura.">
          <div className="space-y-3">
            {data.dataQualityRows.map((row) => (
              <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-on-surface">{row.label}</p>
                  <StatusChip label={row.status} tone="blue" />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-label-sm text-slate-500">
                  <span>Propietario: {row.owner}</span>
                  <span>Frescura: {row.freshness}</span>
                  <span>Confianza: {row.confidence}</span>
                  <span>Gaps: {row.gaps}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Operadores" eyebrow="Team" description="Actividad y overrides.">
          <div className="space-y-3">
            {data.operatorsRows.map((row) => (
              <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-on-surface">{row.label}</p>
                  <StatusChip label={row.status} tone="blue" />
                </div>
                <p className="mt-2 text-label-sm text-slate-500">{row.owner}</p>
                <p className="mt-1 text-body-md text-slate-700">{row.freshness}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Integraciones" eyebrow="Systems" description="Cobertura visible de plataformas.">
          <div className="space-y-3">
            {data.integrationRows.map((row) => (
              <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-on-surface">{row.label}</p>
                  <StatusChip label={row.status} tone={row.label === "SAP Business One" ? "amber" : "green"} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-label-sm text-slate-500">
                  <span>Propietario: {row.owner}</span>
                  <span>Frescura: {row.freshness}</span>
                  <span>Confianza: {row.confidence}</span>
                  <span>Gaps: {row.gaps}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Scorecards" eyebrow="Summary" description="Lectura ejecutiva del modelo.">
          <div className="grid gap-4 md:grid-cols-2">
            {data.scorecards.map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">{item.label}</p>
                <p className="mt-2 text-headline-md text-on-surface">{item.value}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Comparación comercial" eyebrow="Business" description="Ingresos por etapa y pipeline futuro.">
          <div className="space-y-3">
            {data.commercialBreakdown.map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-on-surface">{item.label}</p>
                  <StatusChip label={item.value} tone="green" />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>
    </div>
  );
}

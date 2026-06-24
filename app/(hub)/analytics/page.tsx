import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { getAnalyticsViewModel } from "@/lib/p1m/read-models";
import { stateForTone } from "@/lib/status";

export default function AnalyticsPage() {
  const data = getAnalyticsViewModel();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inteligencia"
        title="Analytics"
        description="BI transversal con foco comercial, servicio, marketing, IA y calidad de datos."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <SectionCard title="Resumen" eyebrow="Analytics" description="Tabs visuales para las distintas lecturas.">
        <div className="flex flex-wrap gap-2">
          {data.tabs.map((tab, index) => (
            <StatusChip key={tab} label={tab} tone={index === 0 ? "blue" : "gray"} />
          ))}
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-4">
          {data.scorecards.map((item) => (
            <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">{item.label}</p>
              <p className="mt-2 text-headline-md text-on-surface">{item.value}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.sections.map((item) => (
            <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-label-bold uppercase text-slate-500">{item.label}</p>
              <p className="mt-2 text-body-md text-slate-700">{item.value}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { ChartCard } from "@/components/p1m/ChartCard";
import { getMarketingOverviewViewModel } from "@/lib/p1m/read-models";
import { stateForTone } from "@/lib/status";

export default function MarketingPage() {
  const data = getMarketingOverviewViewModel();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Crecimiento"
        title="Marketing"
        description="Resumen del módulo de crecimiento con campañas, segmentos, automatizaciones, plantillas y performance."
        status="Preview"
        actions={
          <>
            <SurfaceBadge kind="fixture" />
            <Link href="/marketing/copilot" className="hub-button-primary">
              Abrir copilot
            </Link>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_360px]">
        <SectionCard title="Campañas recientes" eyebrow="Campaigns" description="Entradas con estado, alcance y conversión.">
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Campaña</th>
                  <th>Estado</th>
                  <th>Segmento</th>
                  <th>Canal</th>
                  <th>Programación</th>
                  <th>Alcance</th>
                  <th>Apertura</th>
                  <th>Clics</th>
                  <th>Conv.</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>
                      <Link href={campaign.href} className="font-semibold text-primary hover:underline">
                        {campaign.label}
                      </Link>
                    </td>
                    <td><StatusChip label={campaign.status} tone={campaign.status === "Activa" ? "green" : campaign.status === "Programada" ? "amber" : campaign.status === "Borrador" ? "gray" : "blue"} /></td>
                    <td>{campaign.segment}</td>
                    <td>{campaign.channel}</td>
                    <td>{campaign.schedule}</td>
                    <td>{campaign.reach}</td>
                    <td>{campaign.opens}</td>
                    <td>{campaign.clicks}</td>
                    <td>{campaign.conversion}</td>
                    <td>{campaign.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="AI Marketing" eyebrow="Copilot" description="Recomendaciones accionables y acceso al workspace.">
          <div className="space-y-3">
            {data.recommendations.map((item) => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-body-md text-slate-700">{item}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-2">
            <Link href="/marketing/copilot" className="hub-button-primary">
              Ir al copilot
            </Link>
            <Link href="/marketing/campaigns" className="hub-button-secondary">
              Ver campañas
            </Link>
            <Link href="/marketing/templates" className="hub-button-secondary">
              Ver plantillas
            </Link>
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <ChartCard title="Rendimiento temporal" eyebrow="Performance" description="Open rate y conversión observables por periodo." series={data.performance.map((item, index) => ({ label: item.label, value: Number(String(item.value).replace("%", "")) || index }))} unit="%" />

        <SectionCard title="Segmentos destacados" eyebrow="Segments" description="Cobertura y uso en campañas.">
          <div className="space-y-3">
            {data.segments.map((segment) => (
              <div key={segment.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-on-surface">{segment.label}</p>
                      <p className="text-label-sm text-slate-500">Estado: {segment.state}</p>
                    </div>
                  <StatusChip label={segment.value} tone="blue" />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <SectionCard title="Plantillas" eyebrow="Templates" description="Cards visuales con miniaturas, canal y uso.">
          <div className="grid gap-4 md:grid-cols-2">
            {data.templates.map((template) => (
              <div key={template.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="h-16 w-20 rounded-2xl bg-gradient-to-br from-primary-fixed via-white to-slate-100" />
                  <StatusChip label={template.channel} tone="blue" />
                </div>
                <p className="mt-4 text-headline-md text-on-surface">{template.name}</p>
                <p className="mt-1 text-label-sm text-slate-500">{template.category}</p>
                <p className="mt-3 text-body-md text-slate-700">{template.preview}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <StatusChip label={template.usage} tone="green" />
                  <StatusChip label={template.performance} tone="amber" />
                  <StatusChip label={`Actualizado ${template.updated}`} tone="gray" />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Automatizaciones" eyebrow="Automations" description="Estados, ejecuciones y conversión.">
          <div className="space-y-3">
            {data.automations.map((automation) => (
              <div key={automation.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-on-surface">{automation.label}</p>
                    <p className="text-label-sm text-slate-500">{automation.trigger}</p>
                  </div>
                  <StatusChip label={automation.status} tone={automation.status === "Activa" ? "green" : automation.status === "Pausada" ? "amber" : "gray"} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusChip label={automation.executions ?? "0"} tone="blue" />
                  <StatusChip label={automation.conversions ?? "0%"} tone="green" />
                  <StatusChip label={automation.channel ?? "Preview"} tone="gray" />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>
    </div>
  );
}

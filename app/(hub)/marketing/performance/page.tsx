import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { ChartCard } from "@/components/p1m/ChartCard";
import { getMarketingPerformanceViewModel } from "@/lib/p1m/read-models";
import { stateForTone } from "@/lib/status";

export default function MarketingPerformancePage() {
  const data = getMarketingPerformanceViewModel();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Crecimiento"
        title="Rendimiento"
        description="Dashboard de alcance, apertura, CTR, conversión, revenue, costo y ROI."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <ChartCard title="Tendencia mensual" eyebrow="Trend" description="Comparación temporal de performance." series={data.trend} />

        <SectionCard title="Comparación por canal" eyebrow="Channel mix" description="Email vs WhatsApp.">
          <div className="space-y-3">
            {data.channelComparison.map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-semibold text-on-surface">{item.label}</p>
                  <StatusChip label={`${item.value}%`} tone={item.label === "WhatsApp" ? "green" : "blue"} />
                </div>
                <div className="h-3 rounded-full bg-slate-100">
                  <div className={`h-3 rounded-full ${item.label === "WhatsApp" ? "bg-emerald-500" : "bg-sky-500"}`} style={{ width: `${item.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Top campañas" eyebrow="Campaigns" description="Mejor desempeño por campaña.">
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Campaña</th>
                  <th>Estado</th>
                  <th>Segmento</th>
                  <th>Canal</th>
                  <th>Alcance</th>
                  <th>Apertura</th>
                  <th>Clics</th>
                  <th>Conv.</th>
                </tr>
              </thead>
              <tbody>
                {data.topCampaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>{campaign.label}</td>
                    <td><StatusChip label={campaign.status} tone={campaign.status === "Activa" ? "green" : campaign.status === "Programada" ? "amber" : "gray"} /></td>
                    <td>{campaign.segment}</td>
                    <td>{campaign.channel}</td>
                    <td>{campaign.reach}</td>
                    <td>{campaign.opens}</td>
                    <td>{campaign.clicks}</td>
                    <td>{campaign.conversion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="Top segmentos" eyebrow="Segments" description="Segmentos que más mueven el resultado.">
          <div className="space-y-3">
            {data.topSegments.map((segment) => (
              <div key={segment.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-on-surface">{segment.label}</p>
                    <p className="text-label-sm text-slate-500">Alcance: {segment.value}</p>
                  </div>
                  <StatusChip label={segment.state} tone={segment.state === "Activa" ? "green" : "amber"} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusChip label="42% open" tone="blue" />
                  <StatusChip label="11% CTR" tone="blue" />
                  <StatusChip label="4.3% conv." tone="green" />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <SectionCard title="Calidad de datos" eyebrow="Data quality" description="Cobertura y frescura.">
          <div className="space-y-3">
            {["Cobertura cliente", "Cobertura orden", "Cobertura WhatsApp"].map((label, index) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-on-surface">{label}</p>
                  <StatusChip label={index === 0 ? "92%" : index === 1 ? "88%" : "96%"} tone="blue" />
                </div>
                <p className="mt-2 text-label-sm text-slate-500">{index === 0 ? "Alta cobertura" : index === 1 ? "Cobertura media" : "Cobertura muy alta"}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Operadores" eyebrow="Team" description="Actividad y override rate.">
          <div className="space-y-3">
            {["Admin User", "Laura Perez"].map((name, index) => (
              <div key={name} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-semibold text-on-surface">{name}</p>
                <p className="mt-1 text-label-sm text-slate-500">{index === 0 ? "124 acciones · Override 8%" : "86 acciones · Override 12%"}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Integraciones" eyebrow="Systems" description="Top integraciones visibles.">
          <div className="space-y-3">
            {["PrestaShop", "WhatsApp / Meta", "SAP Business One"].map((label, index) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-on-surface">{label}</p>
                  <StatusChip label={index === 2 ? "76%" : index === 0 ? "98%" : "100%"} tone={index === 2 ? "amber" : "green"} />
                </div>
                <p className="mt-1 text-label-sm text-slate-500">Cobertura y latencia visibles</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>
    </div>
  );
}

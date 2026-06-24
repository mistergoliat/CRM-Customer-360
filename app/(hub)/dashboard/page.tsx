import Link from "next/link";
import { getDashboardViewModel } from "@/lib/p1m/read-models";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { DataTable } from "@/components/ui/DataTable";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { stateForTone } from "@/lib/status";

export default function DashboardPage() {
  const data = getDashboardViewModel();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Home"
        title="Centro operacional"
        description="Clientes, conversaciones, oportunidades, casos y acciones gobernadas en una sola vista."
        status="Activo"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {data.metrics.map((metric) => (
          <Link key={metric.key} href={metric.href ?? "#"} className="block">
            <StatCard title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
          </Link>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <SectionCard title="Trabajo prioritario" eyebrow="Lo que requiere tu atención ahora" description="Vista operativa principal con estados y acceso rápido a la entidad relacionada." actions={<StatusChip label="Preview only" tone="amber" />}>
          <DataTable headers={["Prioridad", "Cliente", "Tipo de trabajo", "Entidad relacionada", "Estado", "Motivo", "Tiempo esperando", "Responsable", "Acción"]}>
            {data.priorityRows.map((row) => (
              <tr key={row.id}>
                <td><StatusChip label={row.priority} tone={row.priority === "P0" ? "red" : row.priority === "P1" ? "amber" : "blue"} /></td>
                <td>
                  <p className="font-semibold text-on-surface">{row.client}</p>
                  <p className="text-label-sm text-slate-500">{row.phone}</p>
                </td>
                <td>{row.work_type}</td>
                <td>
                  <p className="font-semibold text-on-surface">{row.related_entity}</p>
                  <p className="text-label-sm text-slate-500">
                    <Link href={row.href ?? "#"} className="text-primary hover:underline">Abrir</Link>
                  </p>
                </td>
                <td><StatusChip label={row.status} /></td>
                <td className="max-w-[280px]">{row.reason}</td>
                <td>
                  <p className="whitespace-pre-line text-slate-700">{row.waiting_time}</p>
                </td>
                <td>{row.owner}</td>
                <td>
                  <Link href={row.href ?? "#"} className="hub-button-secondary min-w-[96px]">
                    {row.action}
                  </Link>
                </td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="AI SDR - Revisión prioritaria" eyebrow="Preview only" description="Esta tarjeta refleja el foco comercial de la pantalla y no ejecuta nada.">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <InfoGrid
                  items={[
                    { label: "Cliente", value: data.aiReview.customer },
                    { label: "Oportunidad", value: data.aiReview.opportunity },
                    { label: "Señal detectada", value: data.aiReview.signal },
                    { label: "Acción propuesta", value: data.aiReview.action }
                  ]}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-bold uppercase text-slate-500">Confianza</p>
                  <p className="mt-2 text-headline-md text-on-surface">{data.aiReview.confidence}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-bold uppercase text-slate-500">Riesgo</p>
                  <p className="mt-2 text-headline-md text-on-surface">{data.aiReview.risk}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-bold uppercase text-slate-500">Aprobación</p>
                  <p className="mt-2 text-headline-md text-on-surface">{data.aiReview.approval}</p>
                </div>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Información faltante</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
                  {data.aiReview.missing.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <button className="hub-button-secondary w-full" type="button" disabled>
                Revisar propuesta
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Calidad de identidad" eyebrow="Identity" description="Señales de resolución y conflicto para Customer Candidate." >
            <div className="space-y-3">
              {data.identityQuality.map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-body-md text-slate-600">{item.label}</span>
                  <span className="text-body-md font-semibold text-on-surface">{item.value}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Salud de integraciones" eyebrow="System" description="Estado operativo visible sin fingir conectividad real.">
            <div className="space-y-3">
              {data.integrationHealth.map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-body-md text-slate-700">{item.label}</span>
                  <StatusChip label={item.status} tone={item.status.toLowerCase().includes("retras") ? "amber" : "green"} />
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <SectionCard title="Pipeline comercial" eyebrow="Resumen" description="Indicadores de la situación comercial resumida.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {data.pipeline.map((stage) => (
              <div key={stage.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-bold uppercase text-slate-500">{stage.label}</p>
                <p className="mt-2 text-headline-md text-on-surface">{stage.count}</p>
                <p className="text-label-sm text-slate-500">{stage.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-label-bold uppercase text-slate-500">Valor total</p>
            <StatusChip label="CLP $14.2M" tone="green" />
          </div>
        </SectionCard>

        <SectionCard title="Actividad reciente" eyebrow="Timeline" description="Eventos operativos de los últimos minutos.">
          <div className="space-y-3">
            {data.recentActivity.map((item) => (
              <div key={item.id} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm">
                  <span className="material-symbols-outlined">{item.icon}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-on-surface">{item.title}</p>
                    {item.chips?.map((chip) => <StatusChip key={chip.label} label={chip.label} tone={chip.tone} />)}
                  </div>
                  <p className="text-body-md text-slate-600">{item.subtitle}</p>
                  <p className="text-label-sm text-slate-500">{item.time}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <SectionCard title="Oportunidades estancadas" eyebrow="Alertas" description="Entrada rápida a oportunidades que necesitan seguimiento.">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2 text-label-bold uppercase text-slate-500">
              <span>Cliente</span>
              <span>Estado</span>
            </div>
            {data.priorityRows.slice(0, 2).map((row) => (
              <div key={row.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
                <div>
                  <p className="font-semibold text-on-surface">{row.related_entity}</p>
                  <p className="text-label-sm text-slate-500">{row.client}</p>
                </div>
                <div className="text-right">
                  <p className="text-label-sm text-primary">{row.reason}</p>
                  <Link href={row.href ?? "#"} className="text-label-sm font-bold text-primary hover:underline">
                    Ver oportunidad
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Estado de fuentes" eyebrow="Connectivity" description="Fuentes visibles y su estado resumido.">
          <div className="space-y-3">
            {data.sourceStatus.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="font-semibold text-on-surface">{item.label}</p>
                  {item.detail ? <p className="text-label-sm text-slate-500">{item.detail}</p> : null}
                </div>
                <StatusChip label={item.status} tone={item.status.toLowerCase().includes("retr") ? "amber" : "green"} />
              </div>
            ))}
          </div>
          <p className="mt-4 text-label-sm text-slate-500">Última sincronización global: Hoy 14:02:11</p>
        </SectionCard>
      </section>
    </div>
  );
}

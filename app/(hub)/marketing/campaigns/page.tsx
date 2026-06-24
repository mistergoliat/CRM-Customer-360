import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { getMarketingCampaignsViewModel } from "@/lib/p1m/read-models";

export default function CampaignsPage() {
  const data = getMarketingCampaignsViewModel();
  const selected = data.rows[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Crecimiento"
        title="Campañas"
        description="Listado visual de campañas activas, programadas, borradores y completadas."
        status="Preview"
        actions={
          <>
            <SurfaceBadge kind="fixture" />
            <Link href="/marketing/campaigns/new" className="hub-button-primary">
              Nueva campaña
            </Link>
          </>
        }
      />

      <SectionCard title="Listado de campañas" eyebrow="Campaigns" description="Acceso a detalle y creación desde una sola vista.">
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
              {data.rows.map((row) => (
                <tr key={row.id} className={row.id === selected.id ? "bg-primary-fixed/20" : undefined}>
                  <td>
                    <Link href={row.href} className="font-semibold text-primary hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td><StatusChip label={row.status} tone={row.status === "Active" ? "green" : row.status === "Scheduled" ? "amber" : row.status === "Completed" ? "blue" : "gray"} /></td>
                  <td>{row.segment}</td>
                  <td>{row.channel}</td>
                  <td>{row.schedule}</td>
                  <td>{row.reach}</td>
                  <td>{row.opens}</td>
                  <td>{row.clicks}</td>
                  <td>{row.conversion}</td>
                  <td>{row.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Detalle rápido" eyebrow="Selected" description={selected.name}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
          <InfoGrid
            items={[
              { label: "Estado", value: selected.status },
              { label: "Segmento", value: selected.segment },
              { label: "Canal", value: selected.channel },
              { label: "Programación", value: selected.schedule },
              { label: "Alcance", value: selected.reach },
              { label: "Conv.", value: selected.conversion }
            ]}
            columns={3}
          />
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">CTA</p>
              <p className="mt-2 text-body-md text-slate-700">{selected.name}</p>
            </div>
            <Link href={selected.href} className="hub-button-primary">
              Abrir detalle
            </Link>
            <Link href="/marketing/campaigns/new" className="hub-button-secondary">
              Crear nueva
            </Link>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

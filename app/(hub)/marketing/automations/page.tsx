import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { getMarketingAutomationsViewModel } from "@/lib/p1m/read-models";

export default function AutomationsPage() {
  const data = getMarketingAutomationsViewModel();
  const selected = data.rows[0];
  const detail = data.automations[selected.id as keyof typeof data.automations];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Crecimiento"
        title="Automatizaciones"
        description="Lista de flujos visuales con acceso al builder de cada automatización."
        status="Preview"
        actions={
          <>
            <SurfaceBadge kind="fixture" />
            <Link href="/marketing/automations/demo-automation-1" className="hub-button-primary">
              Abrir builder
            </Link>
          </>
        }
      />

      <SectionCard title="Listado de automatizaciones" eyebrow="Automations" description="Estados, ejecuciones, conversiones y acceso al builder.">
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Automatización</th>
                <th>Estado</th>
                <th>Trigger</th>
                <th>Ejecuciones</th>
                <th>Conv.</th>
                <th>Owner</th>
                <th>Canal</th>
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
                  <td><StatusChip label={row.status} tone={row.status === "Activa" ? "green" : row.status === "Pausada" ? "amber" : "gray"} /></td>
                  <td>{row.trigger}</td>
                  <td>{row.executions}</td>
                  <td>{row.conversions}</td>
                  <td>{row.owner}</td>
                  <td>{row.channel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Detalle" eyebrow="Selected" description={detail.name}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
          <div className="space-y-4">
            <InfoGrid
              items={[
                { label: "Trigger", value: detail.trigger },
                { label: "Wait", value: detail.wait },
                { label: "Condition", value: detail.condition },
                { label: "Owner", value: detail.owner },
                { label: "Ejecuciones", value: detail.executions ?? "—" },
                { label: "Conversión", value: detail.conversions ?? "—" }
              ]}
              columns={3}
            />
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-label-bold uppercase text-slate-500">Canvas</p>
              <div className="mt-4 space-y-3">
                {(detail.nodes ?? []).map((node, index) => (
                  <div key={node.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-on-surface">{node.label}</p>
                      <StatusChip
                        label={{
                          green: "OK",
                          amber: "Revisión",
                          red: "Bloqueada",
                          blue: "Preview",
                          gray: "Preview"
                        }[node.tone ?? "gray"]}
                        tone={node.tone}
                      />
                    </div>
                    {index < (detail.nodes?.length ?? 0) - 1 ? <p className="mt-3 text-label-sm text-slate-500">↓ siguiente</p> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Estado</p>
              <p className="mt-2 text-body-md text-slate-700">{detail.status ?? "Preview"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Canal</p>
              <p className="mt-2 text-body-md text-slate-700">{detail.channel ?? "Preview"}</p>
            </div>
            <Link href={detail.id === "demo-automation-1" ? "/marketing/automations/demo-automation-1" : "/marketing/automations/demo-automation-2"} className="hub-button-primary">
              Abrir builder
            </Link>
            <button type="button" className="hub-button-secondary" disabled>
              Duplicar
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

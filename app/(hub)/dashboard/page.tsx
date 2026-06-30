import Link from "next/link";
import { getDashboardData } from "@/lib/dashboard";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { DataTable } from "@/components/ui/DataTable";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";

function asText(value: unknown, fallback = "—") {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return fallback;
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Home"
        title="Centro modular"
        description="El HUB ahora expone módulos reales, parciales y fixture sin ocultar el estado de cada fuente."
        status="Modular"
        actions={<SurfaceBadge kind="preview" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={metric.state} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <SectionCard title="Estado de datos" eyebrow="Capabilities" description="Respuesta de /api/system/capabilities con modo y fuente por módulo.">
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <DataTable headers={["Módulo", "Modo", "Fuente", "Disponible", "Warnings"]}>
              {data.capabilities.modules.map((module) => (
                <tr key={module.module}>
                  <td className="font-semibold text-on-surface">{module.module}</td>
                  <td>
                    <StatusChip
                      label={module.mode}
                      tone={module.mode === "real" ? "green" : module.mode === "partial" ? "amber" : module.mode === "fixture" ? "gray" : module.mode === "disabled" ? "slate" : "red"}
                    />
                  </td>
                  <td>{module.source}</td>
                  <td>{module.available ? "Sí" : "No"}</td>
                  <td className="max-w-md text-slate-600">{module.warnings.length > 0 ? module.warnings.join(", ") : "—"}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Salud del sistema" eyebrow="Runtime" description="Resumen aislado de disponibilidad y configuración.">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-body-md text-slate-600">DB health</span>
                <StatusChip label={data.dbHealth.ok ? "ok" : "error"} tone={data.dbHealth.ok ? "green" : "red"} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-body-md text-slate-600">n8n</span>
                <StatusChip label={data.n8nHealth.status} tone={data.n8nHealth.status === "ok" ? "green" : data.n8nHealth.status === "warning" ? "amber" : "red"} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-body-md text-slate-600">Clientes reales</span>
                <StatusChip label={String(data.customerCount)} tone="blue" />
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Meta</p>
                <p className="mt-2 text-body-md text-slate-700">{data.metaConfigured ? "Configurado" : "No configurado"}</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Conversations / Cases" eyebrow="Core" description="Vistas reales separadas del resto del HUB.">
            <div className="space-y-2">
              <Link className="hub-button-secondary w-full" href="/conversations">
                Abrir conversaciones
              </Link>
              <Link className="hub-button-secondary w-full" href="/cases">
                Abrir casos
              </Link>
              <Link className="hub-button-secondary w-full" href="/customers">
                Abrir clientes
              </Link>
            </div>
          </SectionCard>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionCard title="Casos recientes" eyebrow="Operational" description="Sección aislada de datos reales.">
          {data.recentCases.ok ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <DataTable headers={["Caso", "Cliente", "Estado", "Último mensaje"]}>
                {data.recentCases.rows.slice(0, 8).map((row: Record<string, unknown>) => (
                  <tr key={String(row.conversation_case_id ?? row.id ?? row.case_id ?? Math.random())}>
                    <td>
                      <Link className="font-semibold text-primary hover:underline" href={`/cases/${asText(row.conversation_case_id ?? row.id ?? row.case_id, "0")}`}>
                        #{asText(row.conversation_case_id ?? row.id ?? row.case_id, "0")}
                      </Link>
                    </td>
                    <td>{asText(row.contact_name ?? row.wa_id)}</td>
                    <td>{asText(row.status ?? row.priority)}</td>
                    <td className="max-w-md">{asText(row.last_message)}</td>
                  </tr>
                ))}
              </DataTable>
            </div>
          ) : (
            <p className="text-body-md text-slate-600">{data.recentCases.error}</p>
          )}
        </SectionCard>

        <SectionCard title="Auditoría reciente" eyebrow="Traceability" description="Eventos auditable separados del resto.">
          {data.recentAudit.ok ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <DataTable headers={["Evento", "Entidad", "ID", "Fecha"]}>
                {data.recentAudit.rows.slice(0, 8).map((row: Record<string, unknown>, index: number) => (
                  <tr key={String(row.id ?? index)}>
                    <td>{asText(row.action)}</td>
                    <td>{asText(row.entity_type ?? row.entityType)}</td>
                    <td>{asText(row.entity_id ?? row.entityId)}</td>
                    <td>{asText(row.created_at ?? row.createdAt)}</td>
                  </tr>
                ))}
              </DataTable>
            </div>
          ) : (
            <p className="text-body-md text-slate-600">{data.recentAudit.error}</p>
          )}
        </SectionCard>
      </section>
    </div>
  );
}

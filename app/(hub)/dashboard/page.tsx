import Link from "next/link";
import { getDashboardData } from "@/lib/dashboard";
import { formatDateTime, truncate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { HealthStatusCard } from "@/components/ui/HealthStatusCard";
import { AuditTable } from "@/components/ui/AuditTable";

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <>
      <PageHeader
        eyebrow="AI Operations"
        title="Ops Dashboard"
        description="Centro operativo independiente para continuidad del HUB: casos, WhatsApp manual, auditoria y salud basica sin depender de webhooks n8n."
        status="Activo"
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={metric.state} />
        ))}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <HealthStatusCard
          title="DB"
          status={data.dbHealth.ok ? "ok" : "error"}
          description={data.dbHealth.ok ? "Conexion disponible." : "No se pudo consultar SELECT 1."}
          details={data.dbHealth.ok ? undefined : data.dbHealth.error}
        />
        <HealthStatusCard
          title="Meta config"
          status={data.metaConfigured ? "ok" : "warning"}
          description={data.metaConfigured ? "Variables Meta configuradas." : "Falta token o phone_number_id."}
          details="No se llama a Meta desde dashboard para evitar trafico innecesario."
        />
        <HealthStatusCard
          title="n8n"
          status={data.n8nHealth.status}
          description={data.n8nHealth.description}
          details={data.n8nHealth.details}
        />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-headline-md text-on-surface">Casos recientes</h2>
            <Link href="/cases" className="hub-button-ghost">
              Ver casos
            </Link>
          </div>
          {!data.recentCases.ok ? (
            <ErrorState message={data.recentCases.error} />
          ) : data.recentCases.rows.length === 0 ? (
            <EmptyState title="Sin casos" description="La vista n8n_vw_hub_cases no devolvio registros." />
          ) : (
            <DataTable headers={["Caso", "Cliente", "Estado", "Ultimo mensaje"]}>
              {data.recentCases.rows.map((row) => (
                <tr key={String(row.conversation_case_id)}>
                  <td>
                    <Link href={`/cases/${row.conversation_case_id}`} className="font-bold text-primary hover:underline">
                      #{String(row.conversation_case_id)}
                    </Link>
                    <p className="text-label-sm text-slate-500">{String(row.wa_id ?? "sin wa_id")}</p>
                  </td>
                  <td>{String(row.contact_name ?? "sin nombre")}</td>
                  <td>
                    <StatusChip label={String(row.status ?? "sin estado")} />
                  </td>
                  <td>
                    <p>{truncate(row.last_message, 80)}</p>
                    <p className="text-label-sm text-slate-500">{formatDateTime(row.last_message_at || row.updated_at)}</p>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
        <div>
          <h2 className="mb-3 text-headline-md text-on-surface">Ultima auditoria</h2>
          {data.recentAudit.ok ? <AuditTable rows={data.recentAudit.rows} /> : <ErrorState message={data.recentAudit.error} />}
        </div>
      </section>
    </>
  );
}

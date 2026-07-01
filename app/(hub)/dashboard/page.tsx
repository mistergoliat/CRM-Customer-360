import Link from "next/link";
import { getDashboardData } from "@/lib/dashboard";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { DataTable } from "@/components/ui/DataTable";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { formatDateTime } from "@/lib/format";
import { platformOriginLabel } from "@/lib/domains/customers/platform-origin";
import type { ChipTone } from "@/lib/status";

function isWindowOpen(lastMessageAt: string | null): boolean {
  if (!lastMessageAt) return false;
  const date = new Date(lastMessageAt);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() < 24 * 60 * 60 * 1000;
}

function statusTone(value: string): ChipTone {
  const normalized = value.trim().toLowerCase();
  if (normalized === "real" || normalized === "ok" || normalized === "connected") return "green";
  if (normalized === "active" || normalized === "sent" || normalized === "outbound" || normalized === "manual") return "blue";
  if (normalized === "partial" || normalized === "warning" || normalized === "review" || normalized === "requires_review" || normalized === "open" || normalized === "pending" || normalized === "waiting" || normalized === "waiting_human") return "amber";
  if (normalized === "disabled" || normalized === "fixture") return "gray";
  if (normalized === "error" || normalized === "failed" || normalized === "blocked" || normalized === "urgent" || normalized === "high") return "red";
  if (normalized === "normal" || normalized === "low") return "gray";
  return "blue";
}

function healthTone(status: "ok" | "warning" | "error"): ChipTone {
  if (status === "ok") return "green";
  if (status === "warning") return "amber";
  return "red";
}

export default async function DashboardPage() {
  const data = await getDashboardData();
  const hasModuleErrors = data.moduleStates.some((module) => module.mode === "error");
  const hasPartialModules = data.moduleStates.some((module) => module.mode === "partial");
  const hasRuntimeErrors = data.health.some((item) => item.status === "error");
  const surfaceKind = hasModuleErrors || hasRuntimeErrors ? "notAvailable" : hasPartialModules ? "preview" : "real";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Home"
        title="Centro operativo"
        description="Datos reales de conversaciones, clientes, oportunidades y acciones. El legacy se expone como parcial, no se disimula."
        status={hasModuleErrors || hasRuntimeErrors ? "Con alertas" : hasPartialModules ? "Mixto" : "Operativo"}
        actions={<SurfaceBadge kind={surfaceKind} />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {data.metrics.map((metric) => (
          <StatCard
            key={metric.key}
            title={metric.title}
            value={metric.value}
            description={metric.description}
            icon={metric.icon}
            state={metric.state}
          />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <SectionCard title="Conversaciones recientes" eyebrow="Inbox" description="La vista operativa que mejor refleja el loop autonomo">
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            {data.recentConversations.length > 0 ? (
              <DataTable headers={["Cliente", "Estado", "Prioridad", "Ventana", "Ultimo mensaje"]}>
                {data.recentConversations.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={row.href} className="font-semibold text-primary hover:underline">
                        {row.contactName}
                      </Link>
                      <p className="text-label-sm text-slate-500">{row.waId}</p>
                    </td>
                    <td>
                      <StatusChip label={row.status} tone={statusTone(row.status)} />
                    </td>
                    <td>
                      <StatusChip label={row.priority} tone={statusTone(row.priority)} />
                    </td>
                    <td>
                      <StatusChip label={isWindowOpen(row.lastMessageAt) ? "abierta" : "cerrada"} tone={isWindowOpen(row.lastMessageAt) ? "green" : "amber"} />
                    </td>
                    <td className="max-w-md">
                      <p>{row.lastMessage}</p>
                      <p className="text-label-sm text-slate-500">{formatDateTime(row.lastMessageAt)}</p>
                    </td>
                  </tr>
                ))}
              </DataTable>
            ) : (
              <div className="p-4 text-body-md text-slate-600">No hay conversaciones disponibles.</div>
            )}
          </div>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Pulso autonomo" eyebrow="Runtime" description="Sintesis del estado vivo del sistema">
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-label-bold uppercase text-slate-500">Decisiones hoy</p>
                  <p className="mt-2 text-headline-md text-on-surface">{data.pulse.decisionsToday}</p>
                  <p className="mt-1 text-label-sm text-slate-500">Registros del loop comercial</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-label-bold uppercase text-slate-500">Pendientes</p>
                  <p className="mt-2 text-headline-md text-on-surface">{data.pulse.actionsPending}</p>
                  <p className="mt-1 text-label-sm text-slate-500">Acciones en review / plan / schedule</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-label-bold uppercase text-slate-500">Outbox</p>
                  <p className="mt-2 text-headline-md text-on-surface">{data.pulse.outboxPending}</p>
                  <p className="mt-1 text-label-sm text-slate-500">Borradores esperando worker</p>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Ultima decision</p>
                {data.pulse.latestDecision ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-body-md text-slate-700">
                      {data.pulse.latestDecision.decisionId} {" -> "} {data.pulse.latestDecision.nextStatus}
                      {data.pulse.latestDecision.nextStage ? ` / ${data.pulse.latestDecision.nextStage}` : ""}
                    </p>
                    <p className="text-body-md text-slate-600">{data.pulse.latestDecision.rationale}</p>
                    <p className="text-label-sm text-slate-500">{formatDateTime(data.pulse.latestDecision.createdAt)}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-body-md text-slate-600">No hay decisiones registradas.</p>
                )}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Ultima actividad</p>
                <div className="mt-2 space-y-1 text-body-md text-slate-700">
                  <p>Conversacion: {formatDateTime(data.pulse.latestMessageAt)}</p>
                  <p>Accion: {formatDateTime(data.pulse.latestActionAt)}</p>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Salud del runtime" eyebrow="Controls" description="Estado de conexiones y switches">
            <div className="space-y-3">
              {data.health.map((item) => (
                <div key={item.key} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-body-md font-semibold text-on-surface">{item.label}</span>
                    <StatusChip label={item.status} tone={healthTone(item.status)} />
                  </div>
                  <p className="mt-2 text-body-md text-slate-700">{item.description}</p>
                  <p className="mt-1 text-label-sm text-slate-500">{item.details}</p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Atajos" eyebrow="Navigation" description="Entradas directas al harness operativo">
            <div className="grid gap-2">
              <Link className="hub-button-secondary w-full" href="/conversations">
                Abrir conversaciones
              </Link>
              <Link className="hub-button-secondary w-full" href="/customers">
                Abrir clientes
              </Link>
              <Link className="hub-button-secondary w-full" href="/opportunities">
                Abrir oportunidades
              </Link>
              <Link className="hub-button-secondary w-full" href="/actions">
                Abrir acciones
              </Link>
              <Link className="hub-button-secondary w-full" href="/cases">
                Abrir cases
              </Link>
            </div>
          </SectionCard>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Oportunidades activas" eyebrow="Pipeline" description="Estado de crm_opportunities sin maquillar">
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            {data.recentOpportunities.length > 0 ? (
              <DataTable headers={["Oportunidad", "Estado", "Etapa", "Siguiente", "Ultima actividad"]}>
                {data.recentOpportunities.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="font-semibold text-on-surface">{row.customer}</span>
                      <p className="text-label-sm text-slate-500">{row.opportunityKey}</p>
                    </td>
                    <td>
                      <StatusChip label={row.status} tone={statusTone(row.status)} />
                    </td>
                    <td>{row.stage}</td>
                    <td>{row.nextAction}</td>
                    <td>{formatDateTime(row.lastActivityAt)}</td>
                  </tr>
                ))}
              </DataTable>
            ) : (
              <div className="p-4 text-body-md text-slate-600">No hay oportunidades activas disponibles.</div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Action queue" eyebrow="Governance" description="Acciones gobernadas y visibles para el operador">
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            {data.recentActions.length > 0 ? (
              <DataTable headers={["Cliente", "Accion", "Estado", "Riesgo", "Aprobacion"]}>
                {data.recentActions.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="font-semibold text-on-surface">{row.client}</span>
                      <p className="text-label-sm text-slate-500">{row.actionId}</p>
                    </td>
                    <td>{row.actionType}</td>
                    <td>
                      <StatusChip label={row.status} tone={statusTone(row.status)} />
                    </td>
                    <td>
                      <StatusChip label={row.riskLevel} tone={statusTone(row.riskLevel)} />
                    </td>
                    <td>{row.approvalRequirement}</td>
                  </tr>
                ))}
              </DataTable>
            ) : (
              <div className="p-4 text-body-md text-slate-600">No hay acciones disponibles.</div>
            )}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SectionCard title="Clientes recientes" eyebrow="Customer 360" description="Directorio real de master_customer">
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            {data.recentCustomers.length > 0 ? (
              <DataTable headers={["Cliente", "Email", "Origen", "Estado", "Ultima actividad"]}>
                {data.recentCustomers.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={row.href} className="font-semibold text-primary hover:underline">
                        {row.displayName}
                      </Link>
                      <p className="text-label-sm text-slate-500">{row.id}</p>
                    </td>
                    <td>{row.email}</td>
                    <td>{platformOriginLabel(row.platformOrigin)}</td>
                    <td>
                      <StatusChip label={row.identityState} tone={statusTone(row.identityState)} />
                    </td>
                    <td>{formatDateTime(row.lastActivity)}</td>
                  </tr>
                ))}
              </DataTable>
            ) : (
              <div className="p-4 text-body-md text-slate-600">No hay clientes recientes disponibles.</div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Módulos operativos" eyebrow="Source map" description="La tabla muestra que esta vivo y que sigue parcial">
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <DataTable headers={["Modulo", "Modo", "Fuente", "Resumen", "Warnings"]}>
              {data.moduleStates.map((module) => (
                <tr key={module.module}>
                  <td className="font-semibold text-on-surface">
                    <Link href={module.href} className="hover:underline">
                      {module.label}
                    </Link>
                  </td>
                  <td>
                    <StatusChip label={module.mode} tone={statusTone(module.mode)} />
                  </td>
                  <td>{module.source}</td>
                  <td className="max-w-xs text-slate-600">{module.summary}</td>
                  <td className="max-w-xs text-slate-600">{module.warnings.length > 0 ? module.warnings.join(", ") : "—"}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        </SectionCard>
      </section>
    </div>
  );
}

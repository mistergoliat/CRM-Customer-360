import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { listActions } from "@/lib/domains/actions/service";
import { getModuleModeLabel, type ModuleDataMode } from "@/lib/domains/runtime/data-source-status";
import { stateForTone } from "@/lib/status";

type ActionsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function param(searchParams: Record<string, string | string[] | undefined>, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function withPage(q: string, page: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("page", String(page));
  return `/actions?${params.toString()}`;
}

function surfaceKindForMode(mode: ModuleDataMode) {
  if (mode === "real") return "real" as const;
  if (mode === "partial") return "preview" as const;
  return "notAvailable" as const;
}

function toneForStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (["blocked", "failed", "cancelled"].includes(normalized)) return "red" as const;
  if (["requires_review", "review", "planned", "scheduled"].includes(normalized)) return "amber" as const;
  if (["sent", "delivered", "read", "executed"].includes(normalized)) return "green" as const;
  if (["draft", "proposed", "pending"].includes(normalized)) return "blue" as const;
  return "gray" as const;
}

function toneForRisk(risk: string) {
  if (risk === "Alto") return "red" as const;
  if (risk === "Medio") return "amber" as const;
  if (risk === "Bajo") return "green" as const;
  return "gray" as const;
}

function toneForApproval(approval: string) {
  const normalized = approval.trim().toLowerCase();
  if (normalized.includes("review") || normalized.includes("operator")) return "red" as const;
  if (normalized.includes("auto") || normalized.includes("none")) return "green" as const;
  return "amber" as const;
}

export default async function ActionsPage({ searchParams }: ActionsPageProps) {
  const sp = await searchParams;
  const q = param(sp, "q")?.trim() ?? "";
  const page = Number(param(sp, "page") || 1);
  const data = await listActions({ q, page });
  const selected = data.items[0] ?? null;
  const totalPages = Math.max(1, Math.ceil(data.pagination.total / data.pagination.pageSize));
  const blockedCount = data.items.filter((item) => ["blocked", "failed", "cancelled"].includes(item.status.trim().toLowerCase())).length;
  const reviewCount = data.items.filter((item) => ["requires_review", "review", "planned", "scheduled"].includes(item.status.trim().toLowerCase())).length;
  const scheduledCount = data.items.filter((item) => item.schedule !== "Pending").length;
  const badgeKind = surfaceKindForMode(data.meta.mode);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM"
        title="Acciones"
        description="Cola operativa gobernada por backend real, con estado y aprobacion visibles."
        status={getModuleModeLabel(data.meta.mode)}
        actions={<SurfaceBadge kind={badgeKind} />}
      />

      <form className="hub-card grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto]" action="/actions">
        <input className="hub-input" name="q" defaultValue={q} placeholder="Buscar por cliente, entidad, estado o id" />
        <button className="hub-button-primary" type="submit">
          Buscar
        </button>
      </form>

      {data.meta.warnings.length > 0 ? <ErrorState title="Warnings de acciones" message={data.meta.warnings.join(", ")} /> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Acciones" value={data.pagination.total.toLocaleString("es-CL")} description="Registros totales del queue" icon="playlist_add_check" state={stateForTone("blue")} />
        <StatCard title="En revision" value={reviewCount.toLocaleString("es-CL")} description="Pueden requerir aprobacion humana" icon="rule" state={stateForTone("amber")} />
        <StatCard title="Bloqueadas" value={blockedCount.toLocaleString("es-CL")} description="No pueden avanzar aun" icon="block" state={stateForTone("red")} />
        <StatCard title="Programadas" value={scheduledCount.toLocaleString("es-CL")} description="Tienen fecha de ejecucion" icon="schedule" state={stateForTone("green")} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <SectionCard
          title="Action queue"
          eyebrow="Global queue"
          description="La lista sale del backend. No hay filas hardcoded."
          actions={<StatusChip label={data.meta.source} tone="gray" />}
        >
          {data.items.length === 0 ? (
            <EmptyState title="Sin acciones" description="El backend no devolvio acciones para este filtro." />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <table className="hub-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Entidad</th>
                    <th>Estado</th>
                    <th>Riesgo</th>
                    <th>Aprobacion</th>
                    <th>Origen</th>
                    <th>Programacion</th>
                    <th>Responsable</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id} className={row.id === selected?.id ? "bg-primary-fixed/30" : undefined}>
                      <td>
                        <Link href={row.href} className="font-semibold text-primary hover:underline">
                          {row.client}
                        </Link>
                      </td>
                      <td>{row.relatedEntity}</td>
                      <td><StatusChip label={row.status} tone={toneForStatus(row.status)} /></td>
                      <td><StatusChip label={row.risk} tone={toneForRisk(row.risk)} /></td>
                      <td><StatusChip label={row.approval} tone={toneForApproval(row.approval)} /></td>
                      <td>{row.origin}</td>
                      <td>{row.schedule}</td>
                      <td>{row.owner}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Detalle lateral"
          eyebrow="Action preview"
          description={selected?.client ?? "Sin seleccion"}
          actions={selected ? <StatusChip label={selected.status} tone={toneForStatus(selected.status)} /> : undefined}
        >
          {selected ? (
            <div className="space-y-4">
              <InfoGrid
                items={[
                  { label: "Cliente", value: selected.client },
                  { label: "Entidad", value: selected.relatedEntity },
                  { label: "Programacion", value: selected.schedule },
                  { label: "Responsable", value: selected.owner },
                  { label: "Riesgo", value: selected.risk },
                  { label: "Aprobacion", value: selected.approval }
                ]}
                columns={2}
              />
              <div className="grid gap-2">
                <Link href={selected.href} className="hub-button-primary">
                  Abrir detalle
                </Link>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-label-bold uppercase text-slate-500">Origen</p>
                  <p className="mt-1 text-body-md text-slate-700">{selected.origin}</p>
                </div>
              </div>
            </div>
          ) : null}
        </SectionCard>
      </section>

      <div className="flex items-center justify-between gap-3">
        <p className="text-body-md text-slate-500">
          Pagina {data.pagination.page} de {totalPages}. Total: {data.pagination.total}
        </p>
        <div className="flex gap-2">
          <Link className="hub-button-secondary" href={withPage(q, Math.max(1, data.pagination.page - 1))}>
            Anterior
          </Link>
          <Link className="hub-button-secondary" href={withPage(q, Math.min(totalPages, data.pagination.page + 1))}>
            Siguiente
          </Link>
        </div>
      </div>
    </div>
  );
}

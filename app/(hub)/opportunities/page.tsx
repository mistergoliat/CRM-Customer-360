import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { listOpportunities } from "@/lib/domains/opportunities/service";
import { getModuleModeLabel, type ModuleDataMode } from "@/lib/domains/runtime/data-source-status";
import { stateForTone } from "@/lib/status";

type OpportunitiesPageProps = {
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
  return `/opportunities?${params.toString()}`;
}

function surfaceKindForMode(mode: ModuleDataMode) {
  if (mode === "real") return "real" as const;
  if (mode === "partial") return "preview" as const;
  return "notAvailable" as const;
}

function toneForStage(stage: string) {
  const normalized = stage.trim().toLowerCase();
  if (["won"].includes(normalized)) return "green" as const;
  if (["lost", "archived", "cancelled"].includes(normalized)) return "red" as const;
  if (["quote_pending", "purchase_intent", "checkout_support"].includes(normalized)) return "amber" as const;
  if (["discovery", "qualification", "recommendation", "objection_handling", "follow_up", "handoff"].includes(normalized)) return "blue" as const;
  return "gray" as const;
}

function toneForStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (["won"].includes(normalized)) return "green" as const;
  if (["lost", "archived", "cancelled"].includes(normalized)) return "red" as const;
  if (["requires_review", "pending", "waiting", "blocked"].includes(normalized)) return "amber" as const;
  if (["active", "open"].includes(normalized)) return "blue" as const;
  return "gray" as const;
}

function toneForRisk(risk: string) {
  if (risk === "Alto") return "red" as const;
  if (risk === "Medio") return "amber" as const;
  if (risk === "Bajo") return "green" as const;
  return "gray" as const;
}

export default async function OpportunitiesPage({ searchParams }: OpportunitiesPageProps) {
  const sp = await searchParams;
  const q = param(sp, "q")?.trim() ?? "";
  const page = Number(param(sp, "page") || 1);
  const data = await listOpportunities({ q, page });
  const selected = data.items[0] ?? null;
  const totalPages = Math.max(1, Math.ceil(data.pagination.total / data.pagination.pageSize));
  const totalActive = data.items.filter((item) => !["won", "lost", "archived", "cancelled"].includes(item.status.trim().toLowerCase())).length;
  const highRisk = data.items.filter((item) => item.risk === "Alto").length;
  const withNextAction = data.items.filter((item) => item.nextAction !== "No disponible").length;
  const selectedMode = surfaceKindForMode(data.meta.mode);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM"
        title="Oportunidades"
        description="Inbox de pipeline con datos reales del backend de oportunidades."
        status={getModuleModeLabel(data.meta.mode)}
        actions={<SurfaceBadge kind={selectedMode} />}
      />

      <form className="hub-card grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto]" action="/opportunities">
        <input className="hub-input" name="q" defaultValue={q} placeholder="Buscar por cliente, etapa, estado o id" />
        <button className="hub-button-primary" type="submit">
          Buscar
        </button>
      </form>

      {data.meta.warnings.length > 0 ? <ErrorState title="Warnings de oportunidades" message={data.meta.warnings.join(", ")} /> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Oportunidades" value={data.pagination.total.toLocaleString("es-CL")} description="Registros totales en el read model" icon="inventory" state={stateForTone("blue")} />
        <StatCard title="Activas" value={totalActive.toLocaleString("es-CL")} description="No cerradas ni archivadas" icon="trending_up" state={stateForTone("green")} />
        <StatCard title="Riesgo alto" value={highRisk.toLocaleString("es-CL")} description="Requieren seguimiento cercano" icon="warning" state={stateForTone("red")} />
        <StatCard title="Con siguiente paso" value={withNextAction.toLocaleString("es-CL")} description="Tienen accion posterior definida" icon="task" state={stateForTone("amber")} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <SectionCard
          title="Pipeline"
          eyebrow="Opportunity inbox"
          description="Cada fila viene del backend real. Si falta algo, se muestra como no disponible."
          actions={<StatusChip label={data.meta.source} tone="gray" />}
        >
          {data.items.length === 0 ? (
            <EmptyState title="Sin oportunidades" description="El backend no devolvio registros para este filtro." />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <table className="hub-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Etapa</th>
                    <th>Estado</th>
                    <th>Valor</th>
                    <th>Actividad</th>
                    <th>Proxima accion</th>
                    <th>Responsable</th>
                    <th>Riesgo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id} className={row.id === selected?.id ? "bg-primary-fixed/30" : undefined}>
                      <td>
                        <Link href={row.href} className="font-semibold text-primary hover:underline">
                          {row.customer}
                        </Link>
                      </td>
                      <td><StatusChip label={row.stage} tone={toneForStage(row.stage)} /></td>
                      <td><StatusChip label={row.status} tone={toneForStatus(row.status)} /></td>
                      <td>{row.estimatedValue}</td>
                      <td>{row.activity}</td>
                      <td>{row.nextAction}</td>
                      <td>{row.owner}</td>
                      <td><StatusChip label={row.risk} tone={toneForRisk(row.risk)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Panel lateral"
          eyebrow="Opportunity preview"
          description={selected?.customer ?? "Sin seleccion"}
          actions={selected ? <StatusChip label={selected.status} tone={toneForStatus(selected.status)} /> : undefined}
        >
          {selected ? (
            <div className="space-y-4">
              <InfoGrid
                items={[
                  { label: "Etapa", value: selected.stage },
                  { label: "Estado", value: selected.status },
                  { label: "Valor estimado", value: selected.estimatedValue },
                  { label: "Responsable", value: selected.owner },
                  { label: "Ultima actividad", value: selected.activity },
                  { label: "Riesgo", value: selected.risk }
                ]}
                columns={3}
              />
              <div>
                <p className="text-label-bold uppercase text-slate-500">Proxima accion</p>
                <p className="mt-2 text-body-md text-slate-700">{selected.nextAction}</p>
              </div>
              <div className="grid gap-2">
                <Link href={selected.href} className="hub-button-primary">
                  Abrir detalle
                </Link>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-label-bold uppercase text-slate-500">Origen</p>
                  <p className="mt-1 text-body-md text-slate-700">{selected.source}</p>
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

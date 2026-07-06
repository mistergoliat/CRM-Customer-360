import Link from "next/link";
import { listCases } from "@/lib/domains/cases";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";

type CasesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function param(searchParams: Record<string, string | string[] | undefined>, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function withPage(filters: Record<string, string>, page: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  params.set("page", String(page));
  return `/cases?${params.toString()}`;
}

function surfaceKindForMode(mode: string) {
  if (mode === "real") return "real" as const;
  if (mode === "partial") return "preview" as const;
  return "notAvailable" as const;
}

export default async function CasesPage({ searchParams }: CasesPageProps) {
  const sp = await searchParams;
  const rawFilters = {
    q: param(sp, "q") || "",
    status: param(sp, "status") || "",
    department: param(sp, "department") || "",
    priority: param(sp, "priority") || "",
    requires_human: param(sp, "requires_human") || "",
    page: String(param(sp, "page") || 1)
  };

  const data = await listCases({
    q: rawFilters.q,
    status: rawFilters.status,
    department: rawFilters.department,
    priority: rawFilters.priority,
    requiresHuman: rawFilters.requires_human,
    page: Number(rawFilters.page)
  });
  const totalPages = Math.max(1, Math.ceil(data.pagination.total / data.pagination.pageSize));
  const badgeKind = surfaceKindForMode(data.meta.mode);

  return (
    <>
      <PageHeader
        eyebrow="Casos"
        title="Bandeja operacional"
        description="Casos reales encapsulados por el dominio nuevo sobre el legado n8n."
        status={data.meta.mode}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SurfaceBadge kind={badgeKind} />
            <StatusChip label={data.meta.source} tone="green" />
          </div>
        }
      />

      <form className="hub-card mb-5 grid gap-3 p-4 md:grid-cols-6" action="/cases">
        <input className="hub-input md:col-span-2" name="q" defaultValue={rawFilters.q} placeholder="wa_id, cliente, orden, factura" />
        <select className="hub-input" name="status" defaultValue={rawFilters.status}>
          <option value="">Estado</option>
          {["open", "pending", "human_required", "closed", "resolved"].map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select className="hub-input" name="department" defaultValue={rawFilters.department}>
          <option value="">Departamento</option>
          {["ventas", "sac", "postventa", "operaciones"].map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select className="hub-input" name="priority" defaultValue={rawFilters.priority}>
          <option value="">Prioridad</option>
          {["urgent", "high", "normal", "low"].map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select className="hub-input" name="requires_human" defaultValue={rawFilters.requires_human}>
          <option value="">Humano</option>
          <option value="1">Requiere humano</option>
          <option value="0">No requiere</option>
        </select>
        <button className="hub-button-primary md:col-start-6">Filtrar</button>
      </form>

      {data.meta.warnings.length > 0 ? <ErrorState title="Warnings de casos" message={data.meta.warnings.join(", ")} /> : null}

      {data.items.length === 0 ? (
        <EmptyState title="Sin casos para estos filtros" description="La vista existe pero no devolvió registros." icon="assignment" />
      ) : (
        <DataTable headers={["Caso", "Cliente", "Estado", "Prioridad", "Ventana", "Último mensaje", "Acción"]}>
          {data.items.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/cases/${row.id}`} className="font-bold text-primary hover:underline">
                  #{row.id}
                </Link>
              </td>
              <td>
                <p className="font-semibold text-on-surface">{row.contactName ?? "—"}</p>
                <p className="text-label-sm text-slate-500">{row.waId ?? "—"}</p>
              </td>
              <td>
                <div className="flex flex-wrap gap-1">
                  <StatusChip label={row.status ?? "unknown"} />
                  {row.requiresHuman ? <StatusChip label="humano" tone="red" /> : null}
                </div>
              </td>
              <td>
                <StatusChip label={row.priority ?? "normal"} />
              </td>
              <td>
                <StatusChip label={row.whatsappWindowOpen ? "abierta" : "cerrada"} tone={row.whatsappWindowOpen ? "green" : "amber"} />
              </td>
              <td className="max-w-md">
                <p>{row.lastMessage ?? "Sin mensaje"}</p>
                <p className="text-label-sm text-slate-500">{row.lastMessageAt ?? row.updatedAt ?? "—"}</p>
              </td>
              <td>
                <div className="flex justify-center">
                  <Link className="hub-button-primary min-w-[108px]" href={`/cases/${row.id}`}>
                    Ver caso
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      <div className="mt-4 flex items-center justify-between">
        <p className="text-body-md text-slate-500">
          Página {data.pagination.page} de {totalPages}. Total: {data.pagination.total}
        </p>
        <div className="flex gap-2">
          <Link className="hub-button-secondary" href={withPage(rawFilters, Math.max(1, data.pagination.page - 1))}>
            Anterior
          </Link>
          <Link className="hub-button-secondary" href={withPage(rawFilters, Math.min(totalPages, data.pagination.page + 1))}>
            Siguiente
          </Link>
        </div>
      </div>
    </>
  );
}

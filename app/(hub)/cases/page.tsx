import Link from "next/link";
import { getCaseFilterOptions, listCases } from "@/lib/cases";
import { asText, formatDateTime, truncate } from "@/lib/format";
import { isDbWriteEnabled } from "@/lib/write-access";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";

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
  const filters = {
    q: rawFilters.q,
    status: rawFilters.status,
    department: rawFilters.department,
    priority: rawFilters.priority,
    requiresHuman: rawFilters.requires_human,
    page: Number(rawFilters.page)
  };
  const [cases, statuses, departments, priorities] = await Promise.all([
    listCases(filters),
    getCaseFilterOptions("status"),
    getCaseFilterOptions("department"),
    getCaseFilterOptions("priority")
  ]);
  const totalPages = Math.max(1, Math.ceil(cases.total / cases.pageSize));
  const writeEnabled = isDbWriteEnabled();

  return (
    <>
      <PageHeader
        eyebrow="Casos"
        title="Bandeja operacional"
        description="Casos reales desde n8n_vw_hub_cases con filtros de operacion humana, prioridad, departamento y ventana WhatsApp."
        status="Activo"
        actions={<StatusChip label={writeEnabled ? "writer enabled" : "writer disabled"} tone={writeEnabled ? "green" : "amber"} />}
      />

      <form className="hub-card mb-5 grid gap-3 p-4 md:grid-cols-6" action="/cases">
        <input className="hub-input md:col-span-2" name="q" defaultValue={filters.q} placeholder="wa_id, cliente, orden, factura" />
        <select className="hub-input" name="status" defaultValue={filters.status}>
          <option value="">Estado</option>
          {statuses.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select className="hub-input" name="department" defaultValue={filters.department}>
          <option value="">Departamento</option>
          {departments.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select className="hub-input" name="priority" defaultValue={filters.priority}>
          <option value="">Prioridad</option>
          {priorities.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select className="hub-input" name="requires_human" defaultValue={filters.requiresHuman}>
          <option value="">Humano</option>
          <option value="1">Requiere humano</option>
          <option value="0">No requiere</option>
        </select>
        <button className="hub-button-primary md:col-start-6">Filtrar</button>
      </form>

      {cases.error ? (
        <ErrorState title="Consulta de casos fallo" message={cases.error} />
      ) : cases.rows.length === 0 ? (
        <EmptyState title="Sin casos para estos filtros" description="La vista existe pero no devolvio registros." icon="assignment" />
      ) : (
        <DataTable headers={["Caso", "Cliente", "Estado", "Prioridad", "Ventana", "Ultimo mensaje", "Accion"]}>
          {cases.rows.map((row) => (
            <tr key={String(row.conversation_case_id)}>
              <td>
                <Link href={`/cases/${row.conversation_case_id}`} className="font-bold text-primary hover:underline">
                  #{String(row.conversation_case_id)}
                </Link>
                <p className="text-label-sm text-slate-500">{asText(row.active_case_key)}</p>
              </td>
              <td>
                <p className="font-semibold text-on-surface">{asText(row.contact_name)}</p>
                <p className="text-label-sm text-slate-500">{asText(row.wa_id)}</p>
              </td>
              <td>
                <div className="flex flex-wrap gap-1">
                  <StatusChip label={asText(row.status)} />
                  {row.requires_human ? <StatusChip label="humano" tone="red" /> : null}
                </div>
              </td>
              <td>
                <StatusChip label={asText(row.priority, "normal")} />
              </td>
              <td>
                <StatusChip label={row.whatsapp_window_open ? "abierta" : "cerrada"} tone={row.whatsapp_window_open ? "green" : "amber"} />
              </td>
              <td className="max-w-md">
                <p>{truncate(row.last_message, 110)}</p>
                <p className="text-label-sm text-slate-500">{formatDateTime(row.last_message_at || row.updated_at)}</p>
              </td>
              <td>
                <div className="flex justify-center">
                  <Link className="hub-button-primary min-w-[108px]" href={`/cases/${row.conversation_case_id}`}>
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
          Pagina {cases.page} de {totalPages}. Total: {cases.total}
        </p>
        <div className="flex gap-2">
          <Link className="hub-button-secondary" href={withPage(rawFilters, Math.max(1, cases.page - 1))}>
            Anterior
          </Link>
          <Link className="hub-button-secondary" href={withPage(rawFilters, Math.min(totalPages, cases.page + 1))}>
            Siguiente
          </Link>
        </div>
      </div>
    </>
  );
}

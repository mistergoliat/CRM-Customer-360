"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = CasesPage;
const link_1 = __importDefault(require("next/link"));
const cases_1 = require("@/lib/cases");
const format_1 = require("@/lib/format");
const write_access_1 = require("@/lib/write-access");
const PageHeader_1 = require("@/components/ui/PageHeader");
const DataTable_1 = require("@/components/ui/DataTable");
const StatusChip_1 = require("@/components/ui/StatusChip");
const EmptyState_1 = require("@/components/ui/EmptyState");
const ErrorState_1 = require("@/components/ui/ErrorState");
function param(searchParams, key) {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
}
function withPage(filters, page) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
        if (value)
            params.set(key, value);
    }
    params.set("page", String(page));
    return `/cases?${params.toString()}`;
}
async function CasesPage({ searchParams }) {
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
        (0, cases_1.listCases)(filters),
        (0, cases_1.getCaseFilterOptions)("status"),
        (0, cases_1.getCaseFilterOptions)("department"),
        (0, cases_1.getCaseFilterOptions)("priority")
    ]);
    const totalPages = Math.max(1, Math.ceil(cases.total / cases.pageSize));
    const writeEnabled = (0, write_access_1.isDbWriteEnabled)();
    return (<>
      <PageHeader_1.PageHeader eyebrow="Casos" title="Bandeja operacional" description="Casos reales desde n8n_vw_hub_cases con filtros de operacion humana, prioridad, departamento y ventana WhatsApp." status="Activo" actions={<StatusChip_1.StatusChip label={writeEnabled ? "writer enabled" : "writer disabled"} tone={writeEnabled ? "green" : "amber"}/>}/>

      <form className="hub-card mb-5 grid gap-3 p-4 md:grid-cols-6" action="/cases">
        <input className="hub-input md:col-span-2" name="q" defaultValue={filters.q} placeholder="wa_id, cliente, orden, factura"/>
        <select className="hub-input" name="status" defaultValue={filters.status}>
          <option value="">Estado</option>
          {statuses.map((option) => (<option key={option} value={option}>
              {option}
            </option>))}
        </select>
        <select className="hub-input" name="department" defaultValue={filters.department}>
          <option value="">Departamento</option>
          {departments.map((option) => (<option key={option} value={option}>
              {option}
            </option>))}
        </select>
        <select className="hub-input" name="priority" defaultValue={filters.priority}>
          <option value="">Prioridad</option>
          {priorities.map((option) => (<option key={option} value={option}>
              {option}
            </option>))}
        </select>
        <select className="hub-input" name="requires_human" defaultValue={filters.requiresHuman}>
          <option value="">Humano</option>
          <option value="1">Requiere humano</option>
          <option value="0">No requiere</option>
        </select>
        <button className="hub-button-primary md:col-start-6">Filtrar</button>
      </form>

      {cases.error ? (<ErrorState_1.ErrorState title="Consulta de casos fallo" message={cases.error}/>) : cases.rows.length === 0 ? (<EmptyState_1.EmptyState title="Sin casos para estos filtros" description="La vista existe pero no devolvio registros." icon="assignment"/>) : (<DataTable_1.DataTable headers={["Caso", "Cliente", "Estado", "Prioridad", "Ventana", "Ultimo mensaje", "Accion"]}>
          {cases.rows.map((row) => (<tr key={String(row.conversation_case_id)}>
              <td>
                <link_1.default href={`/cases/${row.conversation_case_id}`} className="font-bold text-primary hover:underline">
                  #{String(row.conversation_case_id)}
                </link_1.default>
                <p className="text-label-sm text-slate-500">{(0, format_1.asText)(row.active_case_key)}</p>
              </td>
              <td>
                <p className="font-semibold text-on-surface">{(0, format_1.asText)(row.contact_name)}</p>
                <p className="text-label-sm text-slate-500">{(0, format_1.asText)(row.wa_id)}</p>
              </td>
              <td>
                <div className="flex flex-wrap gap-1">
                  <StatusChip_1.StatusChip label={(0, format_1.asText)(row.status)}/>
                  {row.requires_human ? <StatusChip_1.StatusChip label="humano" tone="red"/> : null}
                </div>
              </td>
              <td>
                <StatusChip_1.StatusChip label={(0, format_1.asText)(row.priority, "normal")}/>
              </td>
              <td>
                <StatusChip_1.StatusChip label={row.whatsapp_window_open ? "abierta" : "cerrada"} tone={row.whatsapp_window_open ? "green" : "amber"}/>
              </td>
              <td className="max-w-md">
                <p>{(0, format_1.truncate)(row.last_message, 110)}</p>
                <p className="text-label-sm text-slate-500">{(0, format_1.formatDateTime)(row.last_message_at || row.updated_at)}</p>
              </td>
              <td>
                <div className="flex justify-center">
                  <link_1.default className="hub-button-primary min-w-[108px]" href={`/cases/${row.conversation_case_id}`}>
                    Ver caso
                  </link_1.default>
                </div>
              </td>
            </tr>))}
        </DataTable_1.DataTable>)}

      <div className="mt-4 flex items-center justify-between">
        <p className="text-body-md text-slate-500">
          Pagina {cases.page} de {totalPages}. Total: {cases.total}
        </p>
        <div className="flex gap-2">
          <link_1.default className="hub-button-secondary" href={withPage(rawFilters, Math.max(1, cases.page - 1))}>
            Anterior
          </link_1.default>
          <link_1.default className="hub-button-secondary" href={withPage(rawFilters, Math.min(totalPages, cases.page + 1))}>
            Siguiente
          </link_1.default>
        </div>
      </div>
    </>);
}

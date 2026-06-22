"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = DashboardPage;
const link_1 = __importDefault(require("next/link"));
const dashboard_1 = require("@/lib/dashboard");
const format_1 = require("@/lib/format");
const PageHeader_1 = require("@/components/ui/PageHeader");
const StatCard_1 = require("@/components/ui/StatCard");
const StatusChip_1 = require("@/components/ui/StatusChip");
const DataTable_1 = require("@/components/ui/DataTable");
const EmptyState_1 = require("@/components/ui/EmptyState");
const ErrorState_1 = require("@/components/ui/ErrorState");
const HealthStatusCard_1 = require("@/components/ui/HealthStatusCard");
const AuditTable_1 = require("@/components/ui/AuditTable");
async function DashboardPage() {
    const data = await (0, dashboard_1.getDashboardData)();
    return (<>
      <PageHeader_1.PageHeader eyebrow="AI Operations" title="Ops Dashboard" description="Centro operativo independiente para continuidad del HUB: casos, WhatsApp manual, auditoria y salud basica sin depender de webhooks n8n." status="Activo"/>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (<StatCard_1.StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={metric.state}/>))}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <HealthStatusCard_1.HealthStatusCard title="DB" status={data.dbHealth.ok ? "ok" : "error"} description={data.dbHealth.ok ? "Conexion disponible." : "No se pudo consultar SELECT 1."} details={data.dbHealth.ok ? undefined : data.dbHealth.error}/>
        <HealthStatusCard_1.HealthStatusCard title="Meta config" status={data.metaConfigured ? "ok" : "warning"} description={data.metaConfigured ? "Variables Meta configuradas." : "Falta token o phone_number_id."} details="No se llama a Meta desde dashboard para evitar trafico innecesario."/>
        <HealthStatusCard_1.HealthStatusCard title="n8n" status={data.n8nHealth.status} description={data.n8nHealth.description} details={data.n8nHealth.details}/>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-headline-md text-on-surface">Casos recientes</h2>
            <link_1.default href="/cases" className="hub-button-ghost">
              Ver casos
            </link_1.default>
          </div>
          {!data.recentCases.ok ? (<ErrorState_1.ErrorState message={data.recentCases.error}/>) : data.recentCases.rows.length === 0 ? (<EmptyState_1.EmptyState title="Sin casos" description="La vista n8n_vw_hub_cases no devolvio registros."/>) : (<DataTable_1.DataTable headers={["Caso", "Cliente", "Estado", "Ultimo mensaje"]}>
              {data.recentCases.rows.map((row) => (<tr key={String(row.conversation_case_id)}>
                  <td>
                    <link_1.default href={`/cases/${row.conversation_case_id}`} className="font-bold text-primary hover:underline">
                      #{String(row.conversation_case_id)}
                    </link_1.default>
                    <p className="text-label-sm text-slate-500">{String(row.wa_id ?? "sin wa_id")}</p>
                  </td>
                  <td>{String(row.contact_name ?? "sin nombre")}</td>
                  <td>
                    <StatusChip_1.StatusChip label={String(row.status ?? "sin estado")}/>
                  </td>
                  <td>
                    <p>{(0, format_1.truncate)(row.last_message, 80)}</p>
                    <p className="text-label-sm text-slate-500">{(0, format_1.formatDateTime)(row.last_message_at || row.updated_at)}</p>
                  </td>
                </tr>))}
            </DataTable_1.DataTable>)}
        </div>
        <div>
          <h2 className="mb-3 text-headline-md text-on-surface">Ultima auditoria</h2>
          {data.recentAudit.ok ? <AuditTable_1.AuditTable rows={data.recentAudit.rows}/> : <ErrorState_1.ErrorState message={data.recentAudit.error}/>}
        </div>
      </section>
    </>);
}

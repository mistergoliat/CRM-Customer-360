"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = WhatsAppPage;
const link_1 = __importDefault(require("next/link"));
const cases_1 = require("@/lib/cases");
const format_1 = require("@/lib/format");
const PageHeader_1 = require("@/components/ui/PageHeader");
const DataTable_1 = require("@/components/ui/DataTable");
const EmptyState_1 = require("@/components/ui/EmptyState");
const ErrorState_1 = require("@/components/ui/ErrorState");
const HealthStatusCard_1 = require("@/components/ui/HealthStatusCard");
const StatusChip_1 = require("@/components/ui/StatusChip");
async function WhatsAppPage() {
    const [inbound, outbound] = await Promise.all([(0, cases_1.recentInboundMessages)(20), (0, cases_1.recentOutboundMessages)(20)]);
    const metaOk = Boolean(process.env.META_ACCESS_TOKEN && (process.env.DEFAULT_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID));
    return (<>
      <PageHeader_1.PageHeader eyebrow="WhatsApp" title="Canal WhatsApp" description="Vista parcial del canal. El envío manual operativo se realiza desde el detalle del caso para mantener contexto y auditoría." status="Parcial" actions={<link_1.default href="/cases" className="hub-button-primary">
            Ir a casos
          </link_1.default>}/>

      <section className="mb-6 grid gap-4 md:grid-cols-2">
        <HealthStatusCard_1.HealthStatusCard title="Meta Graph API" status={metaOk ? "ok" : "warning"} description={metaOk ? "Configuración mínima disponible." : "Falta token o phone_number_id."} details="No hay broadcast ni templates en fase 1."/>
        <HealthStatusCard_1.HealthStatusCard title="Templates" status="warning" description="No conectado en esta fase." details="Si la ventana 24h está cerrada, el detalle del caso devuelve error claro."/>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div>
          <h2 className="mb-3 text-headline-md text-on-surface">Inbound recientes</h2>
          {!inbound.ok ? (<ErrorState_1.ErrorState message={inbound.error}/>) : inbound.rows.length === 0 ? (<EmptyState_1.EmptyState title="Sin inbound" description="No hay mensajes inbound disponibles." icon="call_received"/>) : (<DataTable_1.DataTable headers={["Fecha", "Contacto", "Mensaje"]}>
              {inbound.rows.map((row, index) => (<tr key={String(row.id ?? index)}>
                  <td>{(0, format_1.formatDateTime)(row.occurred_at || row.message_at || row.created_at)}</td>
                  <td>
                    <p className="font-semibold text-on-surface">{String(row.contact_name ?? "sin nombre")}</p>
                    <p className="text-label-sm text-slate-500">{String(row.wa_id ?? "sin wa_id")}</p>
                  </td>
                  <td>{(0, format_1.truncate)(row.message_text || row.text || row.body || row.message || row.content, 120)}</td>
                </tr>))}
            </DataTable_1.DataTable>)}
        </div>
        <div>
          <h2 className="mb-3 text-headline-md text-on-surface">Outbound recientes</h2>
          {!outbound.ok ? (<ErrorState_1.ErrorState message={outbound.error}/>) : outbound.rows.length === 0 ? (<EmptyState_1.EmptyState title="Sin outbound" description="No hay mensajes outbound/manual registrados." icon="send"/>) : (<DataTable_1.DataTable headers={["Fecha", "Dirección", "Mensaje"]}>
              {outbound.rows.map((row, index) => (<tr key={String(row.id ?? index)}>
                  <td>{(0, format_1.formatDateTime)(row.occurred_at || row.message_at || row.created_at)}</td>
                  <td>
                    <StatusChip_1.StatusChip label={String(row.direction || row.message_direction || "outbound")} tone="blue"/>
                  </td>
                  <td>{(0, format_1.truncate)(row.message_text || row.text || row.body || row.message || row.content, 120)}</td>
                </tr>))}
            </DataTable_1.DataTable>)}
        </div>
      </section>
    </>);
}

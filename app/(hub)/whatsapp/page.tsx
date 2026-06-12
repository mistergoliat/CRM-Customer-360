import Link from "next/link";
import { recentInboundMessages, recentOutboundMessages } from "@/lib/cases";
import { formatDateTime, truncate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { HealthStatusCard } from "@/components/ui/HealthStatusCard";
import { StatusChip } from "@/components/ui/StatusChip";

export default async function WhatsAppPage() {
  const [inbound, outbound] = await Promise.all([recentInboundMessages(20), recentOutboundMessages(20)]);
  const metaOk = Boolean(process.env.META_ACCESS_TOKEN && (process.env.DEFAULT_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID));

  return (
    <>
      <PageHeader
        eyebrow="WhatsApp"
        title="Canal WhatsApp"
        description="Vista parcial del canal. El envío manual operativo se realiza desde el detalle del caso para mantener contexto y auditoría."
        status="Parcial"
        actions={
          <Link href="/cases" className="hub-button-primary">
            Ir a casos
          </Link>
        }
      />

      <section className="mb-6 grid gap-4 md:grid-cols-2">
        <HealthStatusCard
          title="Meta Graph API"
          status={metaOk ? "ok" : "warning"}
          description={metaOk ? "Configuración mínima disponible." : "Falta token o phone_number_id."}
          details="No hay broadcast ni templates en fase 1."
        />
        <HealthStatusCard
          title="Templates"
          status="warning"
          description="No conectado en esta fase."
          details="Si la ventana 24h está cerrada, el detalle del caso devuelve error claro."
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div>
          <h2 className="mb-3 text-headline-md text-on-surface">Inbound recientes</h2>
          {!inbound.ok ? (
            <ErrorState message={inbound.error} />
          ) : inbound.rows.length === 0 ? (
            <EmptyState title="Sin inbound" description="No hay mensajes inbound disponibles." icon="call_received" />
          ) : (
            <DataTable headers={["Fecha", "Contacto", "Mensaje"]}>
              {inbound.rows.map((row, index) => (
                <tr key={String(row.id ?? index)}>
                  <td>{formatDateTime(row.occurred_at || row.message_at || row.created_at)}</td>
                  <td>
                    <p className="font-semibold text-on-surface">{String(row.contact_name ?? "sin nombre")}</p>
                    <p className="text-label-sm text-slate-500">{String(row.wa_id ?? "sin wa_id")}</p>
                  </td>
                  <td>{truncate(row.message_text || row.text || row.body || row.message || row.content, 120)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
        <div>
          <h2 className="mb-3 text-headline-md text-on-surface">Outbound recientes</h2>
          {!outbound.ok ? (
            <ErrorState message={outbound.error} />
          ) : outbound.rows.length === 0 ? (
            <EmptyState title="Sin outbound" description="No hay mensajes outbound/manual registrados." icon="send" />
          ) : (
            <DataTable headers={["Fecha", "Dirección", "Mensaje"]}>
              {outbound.rows.map((row, index) => (
                <tr key={String(row.id ?? index)}>
                  <td>{formatDateTime(row.occurred_at || row.message_at || row.created_at)}</td>
                  <td>
                    <StatusChip label={String(row.direction || row.message_direction || "outbound")} tone="blue" />
                  </td>
                  <td>{truncate(row.message_text || row.text || row.body || row.message || row.content, 120)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
      </section>
    </>
  );
}

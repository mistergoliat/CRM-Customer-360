import Link from "next/link";
import { listConversations, getConversationById } from "@/lib/domains/conversations";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { formatDateTime } from "@/lib/format";

type ConversationsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function param(searchParams: Record<string, string | string[] | undefined>, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function ConversationsPage({ searchParams }: ConversationsPageProps) {
  const sp = await searchParams;
  const q = param(sp, "q") || "";
  const page = Number(param(sp, "page") || 1);
  const data = await listConversations({ q, page });
  const selected = data.items[0] ? await getConversationById(data.items[0].id) : null;
  const selectedConversation = selected?.conversation ?? data.items[0] ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operación"
        title="Conversaciones"
        description="Inbox real sobre conversaciones nativas en MariaDB."
        status="Real"
        actions={<SurfaceBadge kind="real" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Conversaciones" value={data.pagination.total} description="Total en la consulta actual" icon="forum" state="ok" />
        <StatCard title="Pagina" value={data.pagination.page} description={`Page size ${data.pagination.pageSize}`} icon="table_view" state="muted" />
        <StatCard title="Fuente" value={data.meta.source} description={data.meta.warnings.length > 0 ? data.meta.warnings.join(", ") : "Sin warnings"} icon="dataset" state={data.meta.warnings.length > 0 ? "warning" : "ok"} />
        <StatCard title="Modo" value={data.meta.mode} description="Estado de datos del módulo" icon="hub" state={data.meta.mode === "real" ? "ok" : "warning"} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <SectionCard title="Inbox" eyebrow="Listado" description="Búsqueda operativa, prioridad y ventana WhatsApp." actions={<StatusChip label="real" tone="green" />}>
          <form className="mb-4 flex flex-wrap gap-2" action="/conversations">
            <input className="hub-input min-w-[260px] flex-1" name="q" defaultValue={q} placeholder="Buscar por cliente, wa_id o caso" />
            <button className="hub-button-primary" type="submit">
              Buscar
            </button>
          </form>

          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <DataTable headers={["Cliente", "Estado", "Prioridad", "Ventana", "Último mensaje", "Fuente"]}>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link href={`/conversations/${row.id}`} className="font-semibold text-primary hover:underline">
                      {row.contactName ?? row.waId ?? row.id}
                    </Link>
                    <p className="text-label-sm text-slate-500">{row.waId}</p>
                  </td>
                  <td>
                    <StatusChip label={row.status ?? "unknown"} tone={row.status === "open" || row.status === "active" ? "green" : row.status === "pending" ? "amber" : "gray"} />
                  </td>
                  <td>
                    <StatusChip label={row.priority ?? "normal"} tone={row.priority === "urgent" ? "red" : row.priority === "high" ? "amber" : "blue"} />
                  </td>
                  <td>
                    <StatusChip label={row.whatsappWindowOpen ? "abierta" : "cerrada"} tone={row.whatsappWindowOpen ? "green" : "amber"} />
                  </td>
                  <td className="max-w-md">
                    <p>{row.lastMessage ?? "Sin mensaje"}</p>
                    <p className="text-label-sm text-slate-500">{formatDateTime(row.lastMessageAt)}</p>
                  </td>
                  <td>{row.source}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        </SectionCard>

        <SectionCard title="Detalle" eyebrow="Workspace preview" description={selectedConversation ? selectedConversation.contactName ?? selectedConversation.waId ?? selectedConversation.id : "Sin selección"}>
          {selectedConversation ? (
            <div className="space-y-4">
              <InfoGrid
                items={[
                  { label: "Cliente", value: selectedConversation.contactName ?? "Sin nombre" },
                  { label: "wa_id", value: selectedConversation.waId ?? "—" },
                  { label: "Estado", value: selectedConversation.status ?? "—" },
                  { label: "Prioridad", value: selectedConversation.priority ?? "—" },
                  { label: "Departamento", value: selectedConversation.department ?? "—" },
                  { label: "Ventana", value: selectedConversation.whatsappWindowOpen ? "Abierta" : "Cerrada" }
                ]}
                columns={3}
              />
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Último mensaje</p>
                <p className="mt-2 text-body-md text-slate-700">{selectedConversation.lastMessage ?? "Sin datos"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Data quality</p>
                <p className="mt-2 text-body-md text-slate-700">{selected?.dataQuality.status}</p>
                <p className="mt-1 text-label-sm text-slate-500">{selected?.dataQuality.warnings.join(", ") || "Sin warnings"}</p>
              </div>
              <div className="flex gap-2">
                <Link href={`/conversations/${selectedConversation.id}`} className="hub-button-primary">
                  Abrir workspace
                </Link>
              </div>
            </div>
          ) : null}
        </SectionCard>
      </section>
    </div>
  );
}

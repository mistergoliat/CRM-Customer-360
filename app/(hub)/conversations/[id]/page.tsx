import Link from "next/link";
import { notFound } from "next/navigation";
import { getConversationById } from "@/lib/domains/conversations";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { formatDateTime } from "@/lib/format";

type ConversationDetailProps = {
  params: Promise<{ id: string }>;
};

export default async function ConversationDetailPage({ params }: ConversationDetailProps) {
  const { id } = await params;
  const result = await getConversationById(id);
  if (!result) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operación"
        title={`Conversación #${id}`}
        description="Workspace real con timeline legado y data quality visible."
        status={result.dataQuality.status}
        actions={<SurfaceBadge kind={result.dataQuality.status === "valid" ? "real" : "fixture"} />}
      />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_360px]">
        <SectionCard title="Timeline" eyebrow="Mensajes" description={`${result.messages.length} mensajes recuperados`}>
          <div className="space-y-3">
            {result.messages.map((message) => (
              <div key={message.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusChip label={message.direction} tone={message.direction === "inbound" ? "green" : message.direction === "outbound" ? "blue" : "gray"} />
                  {message.status ? <StatusChip label={message.status} tone="gray" /> : null}
                  <span className="text-label-sm text-slate-500">{formatDateTime(message.occurredAt)}</span>
                </div>
                <p className="text-body-md text-slate-700">{message.body}</p>
                <p className="mt-2 text-label-sm text-slate-500">{message.timelineSource}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Resumen" eyebrow="Conversation" description={result.conversation?.contactName ?? "Sin selección"}>
            <InfoGrid
              items={[
                { label: "Cliente", value: result.conversation?.contactName ?? "—" },
                { label: "wa_id", value: result.conversation?.waId ?? "—" },
                { label: "Estado", value: result.conversation?.status ?? "—" },
                { label: "Prioridad", value: result.conversation?.priority ?? "—" },
                { label: "Departamento", value: result.conversation?.department ?? "—" },
                { label: "Ventana", value: result.conversation?.whatsappWindowOpen ? "Abierta" : "Cerrada" }
              ]}
              columns={3}
            />
          </SectionCard>

          <SectionCard title="Data quality" eyebrow="Checks" description={result.dataQuality.source}>
            <div className="space-y-3">
              <p className="text-body-md text-slate-700">{result.customer.summary}</p>
              <p className="text-body-md text-slate-700">{result.case.summary}</p>
              {result.dataQuality.warnings.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {result.dataQuality.warnings.map((warning) => (
                    <StatusChip key={warning} label={warning} tone="amber" />
                  ))}
                </div>
              ) : (
                <StatusChip label="valid" tone="green" />
              )}
            </div>
          </SectionCard>

          <SectionCard title="Acciones" eyebrow="Navigation" description="Navegación al caso y al inbox.">
            <div className="space-y-2">
              <Link href="/conversations" className="hub-button-secondary w-full">
                Volver al inbox
              </Link>
              <Link href={`/cases/${id}`} className="hub-button-primary w-full">
                Ver caso relacionado
              </Link>
            </div>
          </SectionCard>
        </div>
      </section>
    </div>
  );
}

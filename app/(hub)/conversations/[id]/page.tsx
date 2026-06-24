import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { WorkspaceShell } from "@/components/p1m/WorkspaceShell";
import { TabStrip } from "@/components/p1m/TabStrip";
import { getConversationWorkspaceViewModel } from "@/lib/p1m/read-models";

type ConversationDetailProps = {
  params: Promise<{ id: string }>;
};

export default async function ConversationDetailPage({ params }: ConversationDetailProps) {
  const { id } = await params;
  const conversation = getConversationWorkspaceViewModel(id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Conversaciones"
        title={conversation.customer}
        description="Workspace conversacional con contexto del cliente, chat central y AI SDR Copilot lateral."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <WorkspaceShell
        sidebar={
          <SectionCard title="Contexto" eyebrow="Customer" description={conversation.identity}>
            <div className="space-y-4">
              <InfoGrid
                items={[
                  { label: "Estado", value: conversation.status },
                  { label: "Responsable", value: conversation.owner },
                  { label: "Canal", value: conversation.channel },
                  { label: "Caso vinculado", value: conversation.linked_case },
                  { label: "Oportunidad", value: conversation.linked_opportunity }
                ]}
              />
              <div>
                <p className="text-label-bold uppercase text-slate-500">Sistemas fuente</p>
                <div className="mt-2 space-y-2">
                  {conversation.source_systems.map((item) => (
                    <div key={item.label} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <span className="text-body-md text-slate-700">{item.label}</span>
                      <StatusChip label={item.value} tone={item.tone} />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Notas internas</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
                  {conversation.notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Señales</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {conversation.signals.map((signal) => (
                    <StatusChip key={signal.label} label={`${signal.label}: ${signal.value}`} tone={signal.tone} />
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>
        }
        main={
          <SectionCard title="Chat completo" eyebrow="WhatsApp" description="Vista central del hilo conversacional. No hay envío real en esta fase.">
            <div className="mb-4 flex flex-wrap gap-2">
              <TabStrip
                tabs={[
                  { label: "Mensajes", active: true },
                  { label: "Notas", active: false },
                  { label: "Plantillas", active: false }
                ]}
              />
            </div>
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-[#efeae2] p-4">
              {conversation.messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[82%] rounded-3xl px-4 py-3 shadow-sm ${
                    message.direction === "inbound"
                      ? "border border-slate-200 bg-white"
                      : message.direction === "system"
                        ? "border border-amber-100 bg-amber-50"
                        : "ml-auto border border-emerald-100 bg-emerald-50"
                  }`}
                >
                  <div className="mb-2 flex flex-wrap gap-2">
                    <StatusChip label={message.direction} tone={message.tone} />
                    {message.chips?.map((chip) => <StatusChip key={chip.label} label={chip.label} tone={chip.tone} />)}
                  </div>
                  <p className="whitespace-pre-wrap text-body-md text-on-surface">{message.body}</p>
                  <p className="mt-3 text-label-sm text-slate-500">
                    {message.author} · {message.time}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Composer</p>
              <textarea className="hub-textarea mt-3 min-h-28 w-full bg-white" placeholder="Respuesta preview" disabled readOnly />
              <p className="mt-3 text-body-md text-slate-500">Los botones y el composer se muestran en modo preview-only.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {conversation.composer.templates.map((template) => (
                  <button key={template} className="hub-button-secondary" type="button" disabled>
                    {template}
                  </button>
                ))}
              </div>
            </div>
          </SectionCard>
        }
        rail={
          <SectionCard title="AI SDR Copilot" eyebrow="Preview" description="Asistente contextual con Action Queue y guardrails.">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Resumen</p>
                <p className="mt-2 text-body-md text-slate-700">{conversation.copilot.summary}</p>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Siguiente acción</p>
                <p className="mt-2 text-body-md font-semibold text-on-surface">{conversation.copilot.next_action}</p>
                <p className="mt-2 text-body-md text-slate-600">{conversation.copilot.rationale}</p>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Evidencia</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
                  {conversation.copilot.evidence.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Faltante</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
                  {conversation.copilot.missing.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Guardrails</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
                  {conversation.copilot.guardrails.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Action Queue</p>
                <div className="mt-2 space-y-2">
                  {conversation.action_queue.map((action) => (
                    <div key={action.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-on-surface">{action.title}</p>
                        <StatusChip label={action.status} tone="amber" />
                      </div>
                      <p className="mt-2 text-body-md text-slate-600">{action.preview}</p>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-label-sm text-slate-500">Due in {action.due}</span>
                        <button className="hub-button-secondary" type="button" disabled>
                          Preview
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>
        }
      />
    </div>
  );
}

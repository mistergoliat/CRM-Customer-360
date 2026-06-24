"use client";

import { useMemo, useState } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";

type MarketingCopilotWorkspaceProps = {
  data: {
    messages: { id: string; role: string; label: string; body: string }[];
    quickReplies: string[];
    draft: {
      name: string;
      objective: string;
      segment: string;
      channels: string;
      schedule: string;
      approval: string;
      utm: string;
      subject: string;
      preheader: string;
      cta: string;
      audience: string;
      rules: string[];
      exclusions: string[];
      content: string[];
      variants: { label: string; content: string }[];
      lastEdit: string;
    };
    governance: string[];
    summary: string[];
  };
};

export function MarketingCopilotWorkspace({ data }: MarketingCopilotWorkspaceProps) {
  const [messages, setMessages] = useState(data.messages);
  const [draftText, setDraftText] = useState("");
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [campaignDraft, setCampaignDraft] = useState(data.draft);

  const recentMessage = useMemo(() => messages[messages.length - 1], [messages]);

  const pushMessage = (body: string, role: "user" | "copilot") => {
    const next = { id: `${role}-${messages.length + 1}`, role, label: role === "user" ? "Usuario" : "Copilot", body };
    setMessages((current) => [...current, next]);
  };

  const handleQuickReply = (reply: string) => {
    setDraftText(reply);
    pushMessage(reply, "user");
    pushMessage(`Tomado: ${reply}. Ajusto la propuesta localmente para la demo.`, "copilot");
    setCampaignDraft((current) => ({
      ...current,
      lastEdit: "Actualizado localmente",
      subject: reply.includes("asunto") ? "Asunto ajustado" : current.subject,
      preheader: reply.includes("tono") ? "Preheader más urgente" : current.preheader
    }));
  };

  const handleSend = () => {
    if (!draftText.trim()) return;
    const message = draftText.trim();
    setDraftText("");
    pushMessage(message, "user");
    pushMessage("Actualización local aplicada. La campaña queda como borrador visual sin side effects.", "copilot");
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)_360px]">
      <SectionCard title="Chat" eyebrow="Copilot" description="Historial conversacional y composer local.">
        <div className="flex flex-wrap gap-2">
          {data.quickReplies.map((reply) => (
            <button key={reply} type="button" className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-label-sm font-semibold text-slate-700 hover:bg-white" onClick={() => handleQuickReply(reply)}>
              {reply}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-3 rounded-3xl border border-slate-200 bg-[#efeae2] p-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[90%] rounded-3xl px-4 py-3 shadow-sm ${
                message.role === "user"
                  ? "ml-auto border border-emerald-100 bg-emerald-50"
                  : "border border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center gap-2">
                <StatusChip label={message.label} tone={message.role === "user" ? "blue" : "amber"} />
              </div>
              <p className="mt-2 text-body-md text-on-surface">{message.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <label className="text-label-bold uppercase text-slate-500">Composer</label>
          <textarea
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            placeholder="Escribe una instrucción para el copilot..."
            className="hub-textarea mt-3 min-h-28 w-full bg-white"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-label-sm text-slate-500">Último mensaje: {recentMessage?.body}</p>
            <button className="hub-button-primary" type="button" onClick={handleSend}>
              Enviar
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Campaña estructurada" eyebrow="Draft" description="Estado local de la campaña generada.">
        <div className="space-y-5">
          <InfoGrid
            items={[
              { label: "Nombre", value: campaignDraft.name },
              { label: "Objetivo", value: campaignDraft.objective },
              { label: "Segmento", value: campaignDraft.segment },
              { label: "Canales", value: campaignDraft.channels },
              { label: "Programación", value: campaignDraft.schedule },
              { label: "Aprobación", value: campaignDraft.approval },
              { label: "UTM", value: campaignDraft.utm }
            ]}
            columns={3}
          />

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-label-bold uppercase text-slate-500">Preview mode</p>
                <p className="text-body-md text-slate-600">Desktop y mobile alternables localmente.</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPreviewMode("desktop")} className={`rounded-full px-3 py-1.5 text-label-sm font-bold uppercase ${previewMode === "desktop" ? "bg-primary text-white" : "bg-white text-slate-600"}`}>
                  Desktop
                </button>
                <button type="button" onClick={() => setPreviewMode("mobile")} className={`rounded-full px-3 py-1.5 text-label-sm font-bold uppercase ${previewMode === "mobile" ? "bg-primary text-white" : "bg-white text-slate-600"}`}>
                  Mobile
                </button>
              </div>
            </div>
            <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-label-bold uppercase text-slate-500">{previewMode === "desktop" ? "Vista desktop" : "Vista mobile"}</p>
                  <h3 className="mt-1 text-headline-md text-on-surface">{campaignDraft.subject}</h3>
                  <p className="mt-1 text-body-md text-slate-500">{campaignDraft.preheader}</p>
                </div>
                <StatusChip label={previewMode === "desktop" ? "1280 px" : "390 px"} tone="blue" />
              </div>
              <div className={`mt-4 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 ${previewMode === "mobile" ? "max-w-[390px]" : ""}`}>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <StatusChip label="Email" tone="blue" />
                    <StatusChip label={campaignDraft.approval} tone="amber" />
                  </div>
                  <div className="mt-4 space-y-3">
                    {campaignDraft.content.map((line) => (
                      <div key={line} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-body-md text-slate-700">
                        {line}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded-2xl bg-primary-fixed p-4 text-primary">
                    <p className="text-label-bold uppercase">CTA</p>
                    <p className="mt-1 text-body-md font-semibold">{campaignDraft.cta}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Reglas</p>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-body-md text-slate-700">
                {campaignDraft.rules.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Exclusiones</p>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-body-md text-slate-700">
                {campaignDraft.exclusions.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Variantes</p>
              <div className="mt-2 space-y-2">
                {campaignDraft.variants.map((variant) => (
                  <div key={variant.label} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="text-label-bold uppercase text-slate-500">Versión {variant.label}</p>
                    <p className="mt-1 text-body-md text-slate-700">{variant.content}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Última edición</p>
              <p className="mt-2 text-body-md text-slate-700">{campaignDraft.lastEdit}</p>
              <p className="mt-2 text-label-sm text-slate-500">La edición es local y no persiste en backend.</p>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Governance" eyebrow="Approval" description="Límites y acciones disponibles en preview.">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {data.summary.map((item) => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-body-md text-slate-700">{item}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="text-label-bold uppercase text-slate-500">Controles</p>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-body-md text-slate-700">
              {data.governance.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div className="grid gap-2">
            <button className="hub-button-primary" type="button" disabled>
              Guardar borrador
            </button>
            <button className="hub-button-secondary" type="button" disabled>
              Solicitar aprobación
            </button>
            <button className="hub-button-secondary" type="button" disabled>
              Programar
            </button>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-label-bold uppercase text-slate-500">Integración de salida</p>
            <p className="mt-2 text-body-md text-slate-700">Todo permanece en preview. No se envía ninguna campaña real.</p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

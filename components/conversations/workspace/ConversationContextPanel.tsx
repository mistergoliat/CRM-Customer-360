"use client";

import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import { StatusChip } from "@/components/ui/StatusChip";
import { formatDateTime } from "@/lib/format";
import type { ConversationWorkspaceData } from "./types";

type TabKey = "summary" | "customer" | "commercial" | "autonomous";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "summary", label: "Resumen" },
  { key: "customer", label: "Cliente" },
  { key: "commercial", label: "Comercial" },
  { key: "autonomous", label: "IA y acciones" }
];

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2 last:border-0">
      <span className="text-[11px] font-bold uppercase text-slate-400">{label}</span>
      <span className="text-body-md text-slate-700">{value && String(value).trim() ? value : <span className="italic text-slate-400">No disponible</span>}</span>
    </div>
  );
}

function Unavailable({ title, note }: { title: string; note?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-label-sm font-bold text-slate-500">{title}</p>
      <p className="text-label-sm text-slate-400">{note ?? "No disponible en este entorno."}</p>
    </div>
  );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-2">
      <p className="text-label-bold uppercase text-slate-500">{title}</p>
      {note ? <p className="text-label-sm text-slate-400">{note}</p> : null}
    </div>
  );
}

export function ConversationContextPanel({ data, onClose }: { data: ConversationWorkspaceData; onClose?: () => void }) {
  const [tab, setTab] = useState<TabKey>("summary");
  const { summary, customer, commercial, autonomous, customerDetail } = data.context;

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-body-lg font-bold text-slate-800">Contexto</h2>
        {onClose ? (
          <button type="button" className="hub-button-secondary xl:hidden" onClick={onClose}>
            Cerrar
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={clsx(
              "rounded-lg px-3 py-1.5 text-label-sm font-bold transition",
              tab === t.key ? "bg-primary text-white" : "text-slate-500 hover:bg-slate-100"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tab === "summary" ? (
          <div>
            <Field label="Estado" value={summary.status} />
            <Field label="Prioridad" value={summary.priority} />
            <Field label="Responsable" value={summary.owner} />
            <Field label="Departamento" value={summary.department} />
            <Field label="Ventana WhatsApp" value={summary.windowOpen ? "Abierta" : "Cerrada"} />
            <Field label="Intención" value={summary.intent} />
            <Field label="Esperando" value={summary.waitingFor} />
            <Field label="Próxima acción" value={summary.nextActionType} />
            <Field label="Vence" value={summary.nextActionDueAt ? formatDateTime(summary.nextActionDueAt) : null} />
            <Field label="Resumen" value={summary.summary} />
          </div>
        ) : null}

        {tab === "customer" ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 p-3">
              <SectionTitle title="Identidad operativa" note="Resolución provisional conectada al backend." />
              <Field label="Identidad" value={customer.resolutionStatus} />
              <Field label="Nombre" value={customer.name} />
              <Field label="wa_id / teléfono" value={customer.waId} />
              <Field label="Email" value={customer.email} />
              <Field label="Origen plataforma" value={customer.platformOrigin} />
              <Field label="ID cliente" value={customer.customerId} />
            </div>

            {customerDetail ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 p-3">
                  <SectionTitle title="Observaciones de identidad" note={customerDetail.identity.source} />
                  <div className="flex flex-wrap gap-2">
                    <StatusChip label={customerDetail.identity.state} tone={customerDetail.identity.state === "real" ? "green" : customerDetail.identity.state === "error" ? "red" : "amber"} />
                    {customerDetail.identity.warnings.length > 0 ? customerDetail.identity.warnings.map((warning) => <StatusChip key={warning} label={warning} tone="amber" />) : <StatusChip label="sin warnings" tone="green" />}
                  </div>
                  <div className="mt-3 space-y-2">
                    {customerDetail.identity.observations.length > 0 ? customerDetail.identity.observations.map((observation) => (
                      <div key={`${observation.source}-${observation.matchedBy}-${observation.identityValue}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <p className="text-label-sm font-bold text-slate-600">{observation.source}</p>
                        <p className="text-label-sm text-slate-500">{observation.matchedBy} · {observation.identityValue ?? "No disponible"}</p>
                      </div>
                    )) : <Unavailable title="Observaciones" note="Sin observaciones de identidad disponibles." />}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <SectionTitle title="Fuentes vinculadas" note={customerDetail.linkedSources.source} />
                  <div className="space-y-2">
                    {customerDetail.linkedSources.items.map((item) => (
                      <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <span className="text-label-sm text-slate-600">{item.label}</span>
                        <span className="text-label-sm font-semibold text-slate-800">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <SectionTitle title="Conversaciones relacionadas" note={customerDetail.relatedConversations.source} />
                  <div className="space-y-2">
                    {customerDetail.relatedConversations.items.length > 0 ? customerDetail.relatedConversations.items.map((item) => (
                      <Link key={item.id} href={item.href} className="block rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 hover:border-primary">
                        <p className="text-label-sm font-bold text-slate-700">{item.label}</p>
                        <p className="text-label-sm text-slate-500">{item.meta}</p>
                      </Link>
                    )) : <Unavailable title="Conversaciones relacionadas" note="No hay filas vinculadas para este cliente." />}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <SectionTitle title="Casos relacionados" note={customerDetail.relatedCases.source} />
                  <div className="space-y-2">
                    {customerDetail.relatedCases.items.length > 0 ? customerDetail.relatedCases.items.map((item) => (
                      <Link key={item.id} href={item.href} className="block rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 hover:border-primary">
                        <p className="text-label-sm font-bold text-slate-700">{item.label}</p>
                        <p className="text-label-sm text-slate-500">{item.meta}</p>
                      </Link>
                    )) : <Unavailable title="Casos relacionados" note="No hay casos vinculados para este cliente." />}
                  </div>
                </div>
              </div>
            ) : (
              <Unavailable title="Detalle de cliente" note="No hay Customer 360 conectado para esta conversación." />
            )}
          </div>
        ) : null}

        {tab === "commercial" ? (
          <div className="space-y-3">
            {commercial.opportunity ? (
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-label-bold uppercase text-slate-500">{commercial.opportunity.opportunityKey}</span>
                  <StatusChip label={commercial.opportunity.status} />
                </div>
                <Field label="Etapa" value={commercial.opportunity.stage} />
                <Field label="Resumen comercial" value={commercial.opportunity.currentSummary} />
              </div>
            ) : (
              <Unavailable title="Oportunidad activa" note="No hay oportunidad vinculada a esta conversación." />
            )}

            {commercial.salesNeedProfile ? (
              <div className="rounded-xl border border-slate-200 p-3">
                <SectionTitle title="SalesNeedProfile" note="Perfil comercial conectado al backend." />
                <Field label="Caso de uso" value={commercial.salesNeedProfile.useCase} />
                <Field label="Tipo de cliente" value={commercial.salesNeedProfile.customerType} />
                <Field label="Presupuesto mínimo" value={commercial.salesNeedProfile.budgetMin !== null ? String(commercial.salesNeedProfile.budgetMin) : null} />
                <Field label="Presupuesto máximo" value={commercial.salesNeedProfile.budgetMax !== null ? String(commercial.salesNeedProfile.budgetMax) : null} />
                <Field label="Urgencia" value={commercial.salesNeedProfile.purchaseUrgency} />
                <Field label="Preparación" value={commercial.salesNeedProfile.decisionReadiness} />
                <Field label="Experiencia" value={commercial.salesNeedProfile.experienceLevel} />
                <Field label="Faltantes" value={commercial.salesNeedProfile.missingInformation.length > 0 ? commercial.salesNeedProfile.missingInformation.join(", ") : null} />
              </div>
            ) : (
              <Unavailable title="SalesNeedProfile" note="No hay perfil comercial conectado para esta conversación." />
            )}

            <Unavailable title="Pedidos / cotizaciones / facturas" note="Sin fuente autoritativa conectada aún." />
          </div>
        ) : null}

        {tab === "autonomous" ? (
          <div className="space-y-3">
            {autonomous.error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-label-sm text-red-700">{autonomous.error}</div>
            ) : null}
            {autonomous.lastDecision ? (
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-label-bold uppercase text-slate-500">Última decisión</p>
                <Field label="Próximo estado" value={autonomous.lastDecision.nextStatus} />
                <Field label="Próxima etapa" value={autonomous.lastDecision.nextStage} />
                <Field label="Justificación" value={autonomous.lastDecision.rationale} />
                <Field label="Creada" value={formatDateTime(autonomous.lastDecision.createdAt)} />
              </div>
            ) : (
              <Unavailable title="Última decisión autónoma" note="Sin decisiones registradas para esta conversación." />
            )}

            <div className="flex gap-2">
              <StatusChip label={`Pendientes: ${autonomous.pendingActions}`} tone={autonomous.pendingActions > 0 ? "amber" : "gray"} />
              <StatusChip label={`Completadas: ${autonomous.completedActions}`} tone="gray" />
            </div>

            {autonomous.actions.length === 0 ? (
              <Unavailable title="Acciones" note="Sin acciones autónomas registradas." />
            ) : (
              <div className="space-y-2">
                {autonomous.actions.map((action) => (
                  <div key={action.actionId} className="rounded-xl border border-slate-200 p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <StatusChip label={action.actionType} tone="blue" />
                      <StatusChip label={action.status} tone={action.status === "failed" ? "red" : action.status === "executed" ? "green" : "gray"} />
                      <span className="text-[11px] text-slate-400">{formatDateTime(action.createdAt)}</span>
                    </div>
                    <p className="text-body-md text-slate-700">{action.narration}</p>
                    {action.executions.length > 0 || action.outcomes.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {action.executions.map((e) => (
                          <StatusChip key={e.executionId} label={`ejec: ${e.status}`} tone={e.status === "failed" ? "red" : e.status === "succeeded" ? "green" : "gray"} />
                        ))}
                        {action.outcomes.map((o, idx) => (
                          <StatusChip key={`${action.actionId}-o-${idx}`} label={`outcome: ${o.outcomeType}`} tone="gray" />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

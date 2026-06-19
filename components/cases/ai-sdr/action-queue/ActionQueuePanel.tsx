import React from "react";
import { CaseInlineNote, CasePanelFrame, CaseDetailField } from "../../CaseDetailPrimitives";
import { ActionQueueItemCard } from "./ActionQueueItemCard";
import { ActionQueueStatusBadge } from "./ActionQueueStatusBadge";
import type { ActionQueueViewModel } from "@/lib/brain/commercial/action-queue";

const PILOT_ACTION_LABELS = ["Aprobar", "Editar", "Cancelar", "Enviar", "Programar"] as const;

export function ActionQueuePanel({
  caseId,
  actionQueue
}: {
  caseId: string | number;
  actionQueue: ActionQueueViewModel;
}) {
  void React;
  const hasActions = actionQueue.actions.length > 0;

  return (
    <CasePanelFrame
      title="AI Action Queue"
      description="Vista read-only de acciones propuestas, bloqueadas o sugeridas para revision futura."
      accent="blue"
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <ActionQueueStatusBadge label={actionQueue.status} />
            <ActionQueueStatusBadge label={actionQueue.origin} />
            <ActionQueueStatusBadge label={actionQueue.diagnostics.source} />
          </div>
          <span className="text-label-sm text-slate-500">Caso #{caseId}</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <CaseDetailField label="Tabla" value={actionQueue.diagnostics.tableAvailable === null ? "desconocida" : actionQueue.diagnostics.tableAvailable ? "disponible" : "no disponible"} />
          <CaseDetailField label="Permiso" value={actionQueue.diagnostics.permissionError ? "error" : "ok"} />
          <CaseDetailField label="Fallback preview" value={actionQueue.diagnostics.usedPreviewFallback ? "si" : "no"} />
          <CaseDetailField label="Sandbox eligibility" value={actionQueue.sandboxAutonomy.status} />
          <CaseDetailField label="Observed at" value={actionQueue.observedAt ?? "sin dato"} date={Boolean(actionQueue.observedAt)} />
        </div>

        {actionQueue.sandboxAutonomy.status !== "eligible" ? (
          <CaseInlineNote tone={actionQueue.sandboxAutonomy.status === "disabled" ? "info" : "warning"} title="Sandbox autonomy" body={actionQueue.sandboxAutonomy.note} />
        ) : null}

        {actionQueue.status === "error" ? (
          <CaseInlineNote tone="warning" title="Error seguro" body={actionQueue.error ?? "No se pudo leer la cola de acciones de forma segura."} />
        ) : null}

        {actionQueue.status === "unavailable" ? (
          <CaseInlineNote tone="info" title="Cola no disponible" body={actionQueue.disabledReason ?? "La cola durable todavia no esta disponible para esta corrida."} />
        ) : null}

        {actionQueue.status === "empty" ? (
          <CaseInlineNote tone="info" title="Sin acciones" body={actionQueue.disabledReason ?? "No hay acciones ni previews comerciales disponibles."} />
        ) : null}

        {actionQueue.status === "preview_only" ? (
          <CaseInlineNote tone="info" title="Vista previa" body={actionQueue.disabledReason ?? "Solo hay previews read-only hasta que exista persistencia duradera."} />
        ) : null}

        {hasActions ? (
          <div className="grid gap-4">
            {actionQueue.actions.map((item) => (
              <ActionQueueItemCard key={item.idempotencyKey ?? item.actionId} item={item} />
            ))}
          </div>
        ) : null}

        {!hasActions && actionQueue.status === "empty" ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-label-bold uppercase text-slate-500">Estado vacio</p>
            <p className="mt-2 text-body-md text-slate-600">
              No hay acciones persistidas ni previews de cola para este caso en este momento.
            </p>
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-label-bold uppercase text-slate-500">Controles piloto bloqueados</p>
            <ActionQueueStatusBadge label={actionQueue.status} />
          </div>
          <p className="mt-2 text-body-md text-slate-600">Disponible cuando Action Persistence y Execution Gate esten habilitados.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {PILOT_ACTION_LABELS.map((label) => (
              <button key={label} type="button" className="hub-button-secondary" disabled title={actionQueue.disabledReason ?? "Controles bloqueados por diseno"}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </CasePanelFrame>
  );
}

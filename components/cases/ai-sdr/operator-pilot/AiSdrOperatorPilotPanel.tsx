import React from "react";
import { CaseInlineNote, CasePanelFrame } from "../../CaseDetailPrimitives";
import { StatusChip } from "@/components/ui/StatusChip";
import type { AiSdrOperatorPilotViewModel } from "@/lib/brain/commercial/operator-pilot";
import { AiSdrKnownMissingInfo } from "./AiSdrKnownMissingInfo";
import { AiSdrNextActionCard } from "./AiSdrNextActionCard";
import { AiSdrOperatorSummary } from "./AiSdrOperatorSummary";
import { AiSdrPilotControls } from "./AiSdrPilotControls";
import { AiSdrPilotEmptyState } from "./AiSdrPilotEmptyState";

function toneForStatus(status: AiSdrOperatorPilotViewModel["status"]) {
  if (status === "available") return "green" as const;
  if (status === "waiting_for_operational_loop") return "amber" as const;
  if (status === "disabled") return "gray" as const;
  if (status === "error") return "red" as const;
  return "gray" as const;
}

export function AiSdrOperatorPilotPanel({
  caseId,
  pilot
}: {
  caseId: string | number;
  pilot: AiSdrOperatorPilotViewModel;
}) {
  void React;

  return (
    <CasePanelFrame
      title="AI SDR Operator Pilot"
      description="Vista operacional read-only para revisar la próxima acción sugerida por el loop comercial."
      accent="blue"
    >
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusChip label={pilot.status} tone={toneForStatus(pilot.status)} />
          <span className="text-label-sm text-slate-500">Caso #{caseId}</span>
        </div>

        {pilot.status === "not_found" || pilot.status === "disabled" || pilot.status === "error" ? (
          <AiSdrPilotEmptyState pilot={pilot} />
        ) : null}

        {pilot.status === "waiting_for_operational_loop" ? (
          <CaseInlineNote
            tone="info"
            title="Observación parcial"
            body="Todavía no existe un resultado operacional persistido. El shell usa la observación shadow como referencia provisional."
          />
        ) : null}

        {pilot.commercialState ? <AiSdrOperatorSummary pilot={pilot} /> : null}
        {pilot.nextAction ? <AiSdrNextActionCard pilot={pilot} /> : null}
        <AiSdrKnownMissingInfo pilot={pilot} />
        <AiSdrPilotControls pilot={pilot} />

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-label-bold uppercase text-slate-500">Diagnóstico técnico</p>
            <StatusChip label={pilot.diagnosticsLink.label} tone="gray" />
          </div>
          <p className="mt-2 text-body-md text-slate-600">La superficie técnica AI SDR sigue disponible debajo como detalle colapsable.</p>
        </div>

        {pilot.warnings.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-label-bold uppercase text-amber-800">Warnings</p>
            <ul className="mt-3 space-y-2 text-body-md text-amber-900">
              {pilot.warnings.map((warning) => (
                <li key={warning} className="rounded-lg bg-white px-3 py-2">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </CasePanelFrame>
  );
}
